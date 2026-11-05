import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import soundfile as sf
spec = importlib.util.spec_from_file_location('engine', Path(__file__).parents[1] / 'local-tts/engine.py')
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)

class ReferenceAudioTests(unittest.TestCase):
    def test_wav_loads_without_system_audio_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            for rate, channels in [(24000, 1), (48000, 2), (44100, 2)]:
                t = np.arange(rate * 4) / rate
                tone = .2 * np.sin(2 * np.pi * 440 * t)
                audio = tone if channels == 1 else np.column_stack([tone, tone * .5])
                path = str(Path(directory) / 'reference.wav')
                sf.write(path, audio, rate, subtype='PCM_16')
                with patch('subprocess.Popen', side_effect=AssertionError('System tool invoked')):
                    decoded = engine.load_reference(path)
                self.assertEqual(decoded.shape, (24000 * 4,))
                self.assertEqual(decoded.dtype, np.float32)
                frequency = np.argmax(abs(np.fft.rfft(decoded))) / 4
                self.assertAlmostEqual(frequency, 440, delta=1)
                self.assertAlmostEqual(float(abs(decoded).max()), .2 if channels == 1 else .15, delta=.002)

    def test_macos_decoder_receives_literal_paths(self):
        import types
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'voice with spaces.m4a')
            Path(path).write_bytes(b'not a WAV')
            def decode(args, **kwargs):
                self.assertEqual(args[:-1], ['/usr/bin/afconvert','-f','WAVE','-d','LEI16',path])
                sf.write(args[-1], np.zeros(24000 * 4), 24000)
                return types.SimpleNamespace(returncode=0)
            with patch.object(engine.sys, 'platform', 'darwin'), patch('subprocess.run', side_effect=decode):
                self.assertEqual(engine.load_reference(path).shape, (96000,))

    def test_invalid_reference_duration_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'reference.wav')
            for seconds in [1, 31]:
                sf.write(path, np.zeros(24000 * seconds), 24000)
                with self.assertRaisesRegex(ValueError, '3 and 30'):
                    engine.load_reference(path)

if __name__ == '__main__': unittest.main()
