import importlib.util,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('launcher',Path(__file__).with_name('gx10_launch.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class GuardTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.root=patch.object(m,'ROOT',Path(self.temp.name));self.root.start();self.addCleanup(self.root.stop)
 def test_poweroff_lockout_never_starts_an_inference_process(self):
  (m.ROOT/'.generation-disabled').touch()
  with patch.object(m.subprocess,'check_output',return_value='') as docker,patch.object(m,'available',return_value=116*m.GiB),patch.object(m.subprocess,'Popen') as spawn:
   with self.assertRaisesRegex(RuntimeError,'disabled pending investigation'):m.preflight()
   self.assertEqual(m.main(),75)
   docker.assert_not_called();spawn.assert_not_called()
 def test_refuses_busy_model_services_without_stopping_them(self):
  with patch.object(m.subprocess,'check_output',return_value='vllm-nemotron35-bolt-74b\n'),patch.object(m,'available',return_value=116*m.GiB):
   with self.assertRaisesRegex(RuntimeError,'Stop these'):m.preflight()
 def test_refuses_low_available_memory(self):
  with patch.object(m.subprocess,'check_output',return_value=''),patch.object(m,'available',return_value=95*m.GiB):
   with self.assertRaisesRegex(RuntimeError,'Insufficient'):m.preflight()
 def test_docker_status_failure_fails_closed(self):
  with patch.object(m.subprocess,'check_output',side_effect=TimeoutError):
   with self.assertRaises(TimeoutError):m.preflight()
 def test_accepts_idle_host_with_reserve(self):
  with patch.object(m.subprocess,'check_output',return_value='control-panel\n'),patch.object(m,'available',return_value=116*m.GiB):m.preflight()
if __name__=='__main__':unittest.main()
