import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("engine", Path(__file__).parents[1] / "local-tts/engine.py")
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)


class InputTests(unittest.TestCase):
    def test_chunking_preserves_words_and_bounds_unspaced_text(self):
        text = "This is a sentence. " * 200
        parts = list(engine.chunks(text))
        self.assertEqual(" ".join(parts).split(), text.split())
        self.assertTrue(all(len(p) <= 350 for p in parts))
        text = "文" * 1000
        self.assertEqual("".join(engine.chunks(text)), text)

    def test_cloning_requires_reference_and_transcript(self):
        for model in ("qwen3", "qwen3-hq"):
            with self.assertRaises(ValueError):
                engine.validate({"engine":model, "language":"en", "text":"hello"})

    def test_all_presets_and_language_matching(self):
        for voice, language in engine.CATALOG['kokoro']['voiceLanguages'].items():
            engine.validate({'engine':'kokoro', 'voice':voice, 'language':language, 'text':'hello'})
            with self.assertRaisesRegex(ValueError, 'matching'):
                engine.validate({'engine':'kokoro', 'voice':voice, 'language':'ja' if language == 'en' else 'en', 'text':'hello'})
        for voice in engine.CATALOG['qwen3-custom']['voices']:
            engine.validate({'engine':'qwen3-custom', 'voice':voice, 'language':'en', 'text':'hello'})

    def test_design_requires_description(self):
        with self.assertRaisesRegex(ValueError, 'Describe'):
            engine.validate({'engine':'qwen3-design', 'language':'en', 'text':'hello'})
        engine.validate({'engine':'qwen3-design', 'language':'en', 'text':'hello', 'instruct':'Warm adult female voice'})

    def test_non_english_chunks_preserve_text_without_phoneme_truncation(self):
        from types import SimpleNamespace
        pipeline = SimpleNamespace(g2p=lambda text: (text * 6, None))
        model = SimpleNamespace(_get_pipeline=lambda language: pipeline)
        text = '文字' * 200 + '。\n' + '言葉' * 30
        parts = list(engine.kokoro_delivery_chunks(model, text, 'zf_xiaobei'))
        self.assertEqual(''.join(part for part, _ in parts), text.replace('\n', ''))
        self.assertTrue(all(len(part) * 6 <= 500 for part, _ in parts))
        self.assertEqual(sum(pause for _, pause in parts), 1)


if __name__ == "__main__":
    unittest.main()
