from http.server import BaseHTTPRequestHandler,HTTPServer
import subprocess
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  data=b"<html><head><title>InfiniteTalk GX10</title></head><body style='background:#171d20;color:#ddd;font:18px system-ui;max-width:700px;margin:50px auto'><h1>InfiniteTalk - GX10</h1><p>Models load only when you submit a new take from MyTwin.</p><ul><li>INT8 checkpoint converted to native BF16; portrait input, 480p, maximum 16 seconds</li><li>100 GB budget: 60 GB PyTorch GPU allocation cap and 40 GB host cgroup cap</li><li>24 GiB host-memory reserve; 90 GB process RSS stop</li><li>One job at a time; 2-hour limit</li><li>No automatic resume or reboot startup</li></ul><p>GPU allocations outside PyTorch and driver faults are not contained by these limits. Rendering stability remains unverified.</p><a style='color:#acd' href='http://100.77.38.96:9999'>Dashboard start/stop controls</a></body></html>"
  self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
HTTPServer(('100.77.38.96',8418),Handler).serve_forever()
