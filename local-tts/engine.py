"""MyTwin-owned, one-operation MLX process. JSON on stdin; final JSON on stdout.

Downloads are explicit. Generation uses only the local cache, and process exit
releases Metal memory. No HTTP listener or third-party desktop app is involved.
"""
import contextlib
import json
import os
from pathlib import Path
import re
import sys
import threading
import time

CATALOG = json.loads(Path(__file__).with_name("catalog.json").read_text())


def validate(request):
    engine = request.get("engine")
    if engine not in CATALOG:
        raise ValueError("Choose Qwen3 or Kokoro.")
    model = CATALOG[engine]
    if request.get("language") not in model["languages"]:
        raise ValueError("This local model does not support the selected language.")
    if not isinstance(request.get("text"), str) or not request["text"].strip() or len(request["text"]) > 12000:
        raise ValueError("Use 1–12,000 characters per local voice take.")
    if engine == "kokoro" and request.get("voice") not in model["voices"]:
        raise ValueError("Choose a Kokoro preset voice.")
    if engine in ("qwen3", "qwen3-hq") and (not request.get("reference") or not request.get("referenceText", "").strip()):
        raise ValueError("Add a voice recording and its exact transcript to your twin.")
    return model


def chunks(text, limit=350):
    # Bound generation context without dropping any input, including unspaced text.
    parts = re.split(r"(?<=[.!?。！？])\s+|\n+", text.strip())
    for part in parts:
        while len(part) > limit:
            cut = part.rfind(" ", 0, limit)
            cut = cut if cut > limit // 2 else limit
            yield part[:cut].strip()
            part = part[cut:].strip()
        if part.strip():
            yield part.strip()


def speech_options(value=None):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("Invalid speech controls")
    result = {}
    for key, low, high, default in [("speed", .75, 1.5, 1), ("sentencePause", 0, 2, 0), ("volume", 0, 2, 1)]:
        n = value.get(key, default)
        if isinstance(n, bool) or not isinstance(n, (float, int)) or not low <= n <= high:
            raise ValueError("Invalid speech " + key)
        result[key] = n
    return result


def delivery_chunks(text):
    sentences = [part.strip() for part in re.split(r"(?<=[.!?。！？])\s+|\n+", text.strip()) if part.strip()]
    for index, sentence in enumerate(sentences):
        parts = list(chunks(sentence))
        for part_index, part in enumerate(parts):
            yield part, index < len(sentences) - 1 and part_index == len(parts) - 1


def adjust_audio(audio, controls, sample_rate=24000):
    import numpy as np
    if controls["speed"] != 1:
        try:
            from pedalboard import time_stretch
        except ImportError:
            raise ValueError("Repair the local model in Settings → Local speech to enable speed controls.")
        audio = time_stretch(audio, sample_rate, controls["speed"])
    audio = np.asarray(audio, dtype=np.float32).reshape(-1) * controls["volume"]
    peak = float(np.max(np.abs(audio))) if len(audio) else 0
    if peak > 1:
        audio *= .999 / peak
    return audio


def operate(root, operation, request):
    root.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(root / "models")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    if operation != "download":
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from huggingface_hub import snapshot_download
    from mlx_audio.tts.utils import load_model
    import numpy as np
    import soundfile as sf

    key = request["engine"]
    if key not in CATALOG:
        raise ValueError("Unknown local model")
    spec = CATALOG[key]
    path = snapshot_download(spec["repo"], revision=spec["revision"],
                             local_files_only=operation != "download",
                             ignore_patterns=["samples/*", "*.pt", "*.md", ".gitattributes"])
    model = load_model(path, model_type="kokoro" if key == "kokoro" else "qwen3_tts")
    if operation == "download":
        # Warm up text processing and every offered voice while online. This also
        # catches incompatible runtime/model pairs before marking the model ready.
        if key == "kokoro":
            for voice in spec["voices"]:
                for result in model.generate("Ready.", voice=voice, lang_code="b" if voice.startswith("b") else "a"):
                    np.asarray(result.audio)
        marker = root / (key + ".ready.json")
        temp = marker.with_suffix(".tmp")
        temp.write_text(json.dumps({"revision": spec["revision"]}))
        temp.replace(marker)
        return {"ready": True}
    validate(request)
    controls = speech_options(request.get("speech"))
    kwargs = {}
    if key in ("qwen3", "qwen3-hq"):
        from mlx_audio.utils import load_audio
        audio = load_audio(request["reference"], sample_rate=24000)
        seconds = audio.shape[0] / 24000
        if not 3 <= seconds <= 30:
            raise ValueError("Use a clean voice reference between 3 and 30 seconds.")
        import mlx.core as mx
        peak = float(mx.max(mx.abs(audio)))
        if peak < 0.0001:
            raise ValueError("The voice reference is too quiet. Record a clearer sample.")
        # Microphone recordings can be much quieter than model training audio.
        # Normalize only the in-memory reference; preserve the original file.
        audio = audio * min(20.0, 0.9 / peak)
        kwargs = {"ref_audio": audio, "ref_text": request["referenceText"],
                  "lang_code": spec["languages"][request["language"]]}
    else:
        kwargs = {"voice": request["voice"], "lang_code": "b" if request["voice"].startswith("b") else "a"}
    output = Path(request["output"])
    partial = output.with_suffix(".partial.wav")
    frames = 0
    try:
        with sf.SoundFile(str(partial), mode="w", samplerate=24000, channels=1, subtype="PCM_16") as target:
            for segment, pause_after in delivery_chunks(request["text"]):
                segment_audio = []
                if key in ("qwen3", "qwen3-hq"):
                    kwargs["max_tokens"] = min(1024, max(192, len(segment) * 3))
                for result in model.generate(segment, **kwargs):
                    if key in ("qwen3", "qwen3-hq") and result.token_count >= kwargs["max_tokens"]:
                        raise ValueError("Qwen3 did not finish cleanly. Try a clear 5–10 second reference and check its transcript.")
                    if result.sample_rate != 24000:
                        raise ValueError("Unexpected model sample rate")
                    audio = np.asarray(result.audio, dtype=np.float32).reshape(-1)
                    if not np.all(np.isfinite(audio)):
                        raise ValueError("The model returned invalid audio.")
                    segment_audio.append(audio)
                if not segment_audio:
                    raise ValueError("The model returned no audio.")
                audio = adjust_audio(np.concatenate(segment_audio), controls)
                pause_frames = round(24000 * controls["sentencePause"]) if pause_after else 0
                frames += len(audio) + pause_frames
                if frames > 24000 * 1800:
                    raise ValueError("Local take exceeds 30 minutes. Split the script.")
                target.write(audio)
                if pause_frames:
                    target.write(np.zeros(pause_frames, dtype=np.float32))
        if not frames:
            raise ValueError("The model returned no audio.")
        partial.replace(output)
    finally:
        partial.unlink(missing_ok=True)
    return {"duration": frames / 24000, "sampleRate": 24000}


if __name__ == "__main__":
    try:
        parent = int(os.environ.get("MYTWIN_PARENT_PID", "0"))
        def watch_parent():
            while parent:
                time.sleep(2)
                try:
                    os.kill(parent, 0)
                except ProcessLookupError:
                    os._exit(1)
        threading.Thread(target=watch_parent, daemon=True).start()
        request = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            result = operate(Path(sys.argv[1]), sys.argv[2], request)
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
