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


if __name__ == "__main__":
    unittest.main()
