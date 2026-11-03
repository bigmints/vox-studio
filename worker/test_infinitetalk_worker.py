import io,json,tempfile,unittest,wave
from unittest.mock import patch,MagicMock
from pathlib import Path
from fastapi.testclient import TestClient
from PIL import Image
import infinitetalk_worker as w

class WorkerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();w.ROOT=Path(self.temp.name);w.DATA=w.ROOT/'data';w.TOKEN_FILE=w.ROOT/'token';w.TOKEN_FILE.write_text('test-key')
  (w.ROOT/'.weights-ready').touch();(w.ROOT/'gx10_launch.py').touch();w.initialize()
  self.client=TestClient(w.app);self.auth={'Authorization':'Bearer test-key'}
 def tearDown(self):self.client.close();self.temp.cleanup()
 def upload(self,kind='image',key='portrait',seconds=.5):
  buf=io.BytesIO()
  if kind=='image':Image.new('RGB',(64,64)).save(buf,format='PNG');mime='image/png'
  else:
   with wave.open(buf,'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000);f.writeframes(b'\0\0'*int(16000*seconds))
   mime='audio/wav'
  return self.client.post('/v1/assets',headers={**self.auth,'Idempotency-Key':key,'Content-Type':mime},content=buf.getvalue())
 def payload(self):
  return {'kind':'avatar','engine':'infinitetalk','language':'en','inputs':{'avatar':self.upload().json()['id'],'audio':self.upload('audio','audio').json()['id']}}
 def submit(self,payload,key='job'):
  return self.client.post('/v1/jobs',headers={**self.auth,'Idempotency-Key':key},json=payload)
 def test_authentication_and_capability(self):
  self.assertEqual(self.client.get('/v1/capabilities').status_code,401)
  self.assertEqual(self.client.get('/v1/capabilities',headers=self.auth).json()['engines'][0]['maxDurationSeconds'],30)
 def test_asset_retry_and_validation(self):
  a=self.upload();self.assertEqual(a.status_code,200);self.assertEqual(a.json(),self.upload().json())
  r=self.client.post('/v1/assets',headers={**self.auth,'Idempotency-Key':'invalid','Content-Type':'image/png'},content=b'not an image');self.assertEqual(r.status_code,422)
  self.assertEqual(self.upload('audio','too-long',30.1).status_code,422)
 def test_idempotency_survives_restart_and_conflicts(self):
  p=self.payload();a=self.submit(p);self.assertEqual(a.status_code,200)
  w.initialize();self.assertEqual(a.json(),self.submit(p).json())
  p['text']='changed';self.assertEqual(self.submit(p).status_code,409)
 def test_queue_cancel_and_recovery(self):
  p=self.payload();i=self.submit(p).json()['id']
  self.assertEqual(self.client.post(f'/v1/jobs/{i}/cancel',headers=self.auth).status_code,200)
  self.assertEqual(self.client.get(f'/v1/jobs/{i}',headers=self.auth).json()['status'],'cancelled')
  j=self.submit(p,'job2').json()['id'];w.patch(j,status='running');w.initialize()
  self.assertEqual(w.lookup('jobs',j)['status'],'failed')
  self.assertEqual(self.client.get(f'/v1/artifacts/{j}',headers=self.auth).status_code,404)
 def test_invalid_engine_and_roles(self):
  p=self.payload();p['engine']='unknown';self.assertEqual(self.submit(p).status_code,422)
  p['engine']='infinitetalk';p['inputs']['audio']=p['inputs']['avatar'];self.assertEqual(self.submit(p).status_code,422)

 def test_short_audio_is_padded_to_a_complete_window(self):
  p=self.payload();identifier=self.submit(p).json()['id'];w.patch(identifier,status='running')
  process=MagicMock();process.wait.return_value=1
  with patch.object(w.subprocess,'Popen',return_value=process):w.run_job(w.lookup('jobs',identifier))
  with wave.open(str(w.DATA/'jobs'/identifier/'audio.wav')) as audio:
   self.assertEqual(audio.getframerate(),16000)
   self.assertGreaterEqual(audio.getnframes()/16000,14/25)
 def test_active_cancel_signals_only_its_launcher(self):
  identifier=self.submit(self.payload()).json()['id'];w.patch(identifier,status='running')
  process=MagicMock();process.poll.return_value=None;w.PROCESS=process;w.ACTIVE_ID=identifier
  try:
   self.client.post(f'/v1/jobs/{identifier}/cancel',headers=self.auth)
   process.terminate.assert_called_once()
   self.assertEqual(w.lookup('jobs',identifier)['status'],'cancel_requested')
  finally:w.PROCESS=None;w.ACTIVE_ID=None

if __name__=='__main__':unittest.main()
