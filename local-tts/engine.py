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
    if model["mode"] == "preset" and request.get("voice") not in model["voices"]:
        raise ValueError("Choose a supported preset voice.")
    if engine == "kokoro" and model["voiceLanguages"][request["voice"]] != request["language"]:
        raise ValueError("Choose a Kokoro voice matching the selected language.")
    instruction = request.get("instruct", "")
    if not isinstance(instruction, str) or len(instruction) > 2000:
        raise ValueError("Use a voice instruction of at most 2,000 characters.")
    if model["mode"] == "design" and not instruction.strip():
        raise ValueError("Describe the voice you want to create.")
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


def kokoro_delivery_chunks(model, text, voice):
    # Non-English pipelines otherwise silently truncate at 510 phoneme characters.
    pipeline = model._get_pipeline(voice[0]) if voice[0] not in "ab" else None

    def bounded(part):
        if pipeline is None or len(pipeline.g2p(part)[0]) <= 500:
            yield part
            return
        if len(part) < 2:
            raise ValueError("This text cannot fit Kokoro's phoneme limit.")
        midpoint = len(part) // 2
        space = part.rfind(" ", 0, midpoint + 1)
        cut = space if space > midpoint // 2 else midpoint
        yield from bounded(part[:cut].strip())
        yield from bounded(part[cut:].strip())

    for segment, pause_after in delivery_chunks(text):
        parts = list(bounded(segment))
        for index, part in enumerate(parts):
            yield part, pause_after and index == len(parts) - 1


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


def load_reference(path, sample_rate=24000):
    """Decode references with the private runtime or the built-in macOS decoder."""
    import numpy as np
    import soundfile as sf
    try:
        info = sf.info(path)
    except sf.LibsndfileError:
        if sys.platform == "darwin":
            import subprocess
            import tempfile
            with tempfile.TemporaryDirectory(prefix="mytwin-reference-") as directory:
                decoded = str(Path(directory) / "reference.wav")
                result = subprocess.run(
                    ["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16", str(path), decoded],
                    capture_output=True, timeout=60,
                )
                if result.returncode == 0:
                    return load_reference(decoded, sample_rate)
        # Retain support for container formats such as browser-recorded WebM.
        from mlx_audio.utils import load_audio
        try:
            audio = np.asarray(load_audio(path, sample_rate=sample_rate), dtype=np.float32)
        except Exception as exc:
            raise ValueError("Cannot decode this voice recording. Import a WAV, FLAC or MP3 recording, or record it again in MyTwin.") from exc
    else:
        if not 3 <= info.frames / info.samplerate <= 30:
            raise ValueError("Use a clean voice reference between 3 and 30 seconds.")
        audio, rate = sf.read(path, dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)
        if rate != sample_rate:
            from math import gcd
            from scipy.signal import resample_poly
            divisor = gcd(rate, sample_rate)
            audio = resample_poly(audio, sample_rate // divisor, rate // divisor)
    if not 3 <= len(audio) / sample_rate <= 30:
        raise ValueError("Use a clean voice reference between 3 and 30 seconds.")
    if not np.all(np.isfinite(audio)):
        raise ValueError("The voice reference contains invalid audio. Record it again.")
    return np.asarray(audio, dtype=np.float32)


def operate(root, operation, request):
    root.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(root / "models")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_XET"] = "1"
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
    if key == "kokoro":
        # misaki[ja] depends on the UniDic loader without shipping its dictionary.
        # Point Fugashi's discovery at our pinned, bundled dictionary in this worker.
        # This avoids an unversioned first-use download and works entirely offline.
        import unidic
        import unidic_lite
        unidic.DICDIR = unidic_lite.DICDIR
    model = load_model(path, model_type="kokoro" if key == "kokoro" else "qwen3_tts")
    if operation == "download":
        # Warm up text processing and every offered voice while online. This also
        # catches incompatible runtime/model pairs before marking the model ready.
        if key == "kokoro":
            samples = {"a":"Ready.", "b":"Ready.", "j":"こんにちは。", "z":"你好。", "e":"Hola.", "f":"Bonjour.", "h":"नमस्ते।", "i":"Ciao.", "p":"Olá."}
            for voice in spec["voices"]:
                for result in model.generate(samples[voice[0]], voice=voice, lang_code=voice[0]):
                    np.asarray(result.audio)
        marker = root / (key + ".ready.json")
        temp = marker.with_suffix(".tmp")
        temp.write_text(json.dumps({"revision": spec["revision"], "runtimeVersion": spec.get("runtimeVersion", 1)}))
        temp.replace(marker)
        return {"ready": True}
    validate(request)
    controls = speech_options(request.get("speech"))
    kwargs = {}
    if key in ("qwen3", "qwen3-hq"):
        import mlx.core as mx
        audio = mx.array(load_reference(request["reference"]), dtype=mx.float32)
        peak = float(mx.max(mx.abs(audio)))
        if peak < 0.0001:
            raise ValueError("The voice reference is too quiet. Record a clearer sample.")
        # Microphone recordings can be much quieter than model training audio.
        # Normalize only the in-memory reference; preserve the original file.
        audio = audio * min(20.0, 0.9 / peak)
        kwargs = {"ref_audio": audio, "ref_text": request["referenceText"],
                  "lang_code": spec["languages"][request["language"]]}
    elif key == "kokoro":
        kwargs = {"voice": request["voice"], "lang_code": request["voice"][0]}
    else:
        kwargs = {"lang_code": spec["languages"][request["language"]], "instruct": request.get("instruct", "")}
        if spec["mode"] == "preset":
            kwargs["voice"] = request["voice"]
    output = Path(request["output"])
    partial = output.with_suffix(".partial.wav")
    frames = 0
    try:
        with sf.SoundFile(str(partial), mode="w", samplerate=24000, channels=1, subtype="PCM_16") as target:
            # A design preview is one generation so its identity cannot change at sentence boundaries.
            segments = [(request["text"], False)] if spec["mode"] == "design" else kokoro_delivery_chunks(model, request["text"], request["voice"]) if key == "kokoro" else delivery_chunks(request["text"])
            for segment, pause_after in segments:
                segment_audio = []
                if key != "kokoro":
                    kwargs["max_tokens"] = min(1024, max(192, len(segment) * 3))
                for result in model.generate(segment, **kwargs):
                    if key != "kokoro" and result.token_count >= kwargs["max_tokens"]:
                        raise ValueError("Qwen3 did not finish cleanly. Try shorter text or another preview; for cloning, check the reference and transcript.")
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
