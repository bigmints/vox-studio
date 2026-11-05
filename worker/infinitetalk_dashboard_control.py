import os,json,socketserver,subprocess
from pathlib import Path
from http.server import BaseHTTPRequestHandler
p=Path(__file__).resolve().parent/'dashboard-control';p.mkdir(mode=0o700,exist_ok=True);sock=p/'control.sock';sock.unlink(missing_ok=True)
def run(*cmd):return subprocess.run(cmd,capture_output=True,text=True,timeout=35)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def handle_action(self):
  try:
   if self.command=='GET' and self.path=='/status':
    active=run('systemctl','--user','is-active','infinitetalk.service').returncode==0;result={'running':active,'online':active}
   elif self.command=='GET' and self.path=='/logs':result={'logs':run('journalctl','--user','-u','mytwin-worker.service','-n','60','--no-pager').stdout}
   elif self.command=='POST' and self.path in ['/start','/stop','/restart']:
    r=run('systemctl','--user',self.path[1:],'infinitetalk.service');result={'ok':r.returncode==0,'error':r.stderr[:500]}
   else:self.send_error(404);return
   data=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  except Exception:self.send_error(503)
 do_GET=handle_action
 do_POST=handle_action
class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):daemon_threads=True
server=Server(str(sock),Handler);os.chmod(sock,0o600);server.serve_forever()
