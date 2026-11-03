import importlib.util
from pathlib import Path
import unittest
import numpy as np
spec = importlib.util.spec_from_file_location('engine', Path(__file__).parents[1] / 'local-tts/engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
class DeliveryTests(unittest.TestCase):
    def test_speed_preserves_pitch(self):
        rate = 24000
        original = (.2 * np.sin(2*np.pi*440*np.arange(rate*2)/rate)).astype(np.float32)
        for speed in [.75, 1.25, 1.5]:
            audio = engine.adjust_audio(original, engine.speech_options({'speed': speed}))
            self.assertAlmostEqual(len(audio)/rate, 2/speed, delta=.03)
            spectrum = abs(np.fft.rfft(audio))
            frequency = np.argmax(spectrum)*rate/len(audio)
            self.assertAlmostEqual(frequency, 440, delta=2)
    def test_volume_and_defaults(self):
        audio = np.array([-.2, 0, .3],dtype=np.float32)
        np.testing.assert_array_equal(engine.adjust_audio(audio,engine.speech_options()),audio)
        np.testing.assert_allclose(engine.adjust_audio(audio,engine.speech_options({'volume':.5})),audio*.5)
        self.assertLessEqual(abs(engine.adjust_audio(audio*3,engine.speech_options({'volume':2}))).max(),1)
    def test_pauses_only_between_sentences(self):
        chunks = list(engine.delivery_chunks('Hello. ' + 'word '*180 + 'end. Last sentence.'))
        self.assertEqual(sum(pause for _,pause in chunks),2)
        self.assertFalse(chunks[-1][1])
        self.assertEqual(' '.join(text for text,_ in chunks).split(), ('Hello. '+'word '*180+'end. Last sentence.').split())
if __name__ == '__main__': unittest.main()
