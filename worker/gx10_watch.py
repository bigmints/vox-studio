import time,subprocess,sqlite3,json,signal,sys
from pathlib import Path
root=Path(__file__).resolve().parent
started=time.time()
identifier=sys.argv[1] if len(sys.argv)>1 else None
while identifier is None:
 with sqlite3.connect(root/'mytwin-data/worker.sqlite',timeout=5) as c:row=c.execute("SELECT id FROM jobs WHERE created>=? AND status IN ('queued','running') ORDER BY created LIMIT 1",(started,)).fetchone()
 if row:identifier=row[0]
 elif time.time()-started>180:sys.exit('No new job submitted')
 else:time.sleep(.1)
log=root/'mytwin-data/jobs'/identifier/'resource-watch.json'
log.parent.mkdir(parents=True,exist_ok=True)
gib=1024**3
start=time.monotonic();minimum=999*gib;peak=0
control=Path('/sys/fs/cgroup'+subprocess.check_output(['systemctl','--user','show','mytwin-worker.service','-p','ControlGroup','--value'],text=True).strip())
def info():return {l.split(':')[0]:int(l.split()[1])*1024 for l in Path('/proc/meminfo').read_text().splitlines() if l.startswith(('MemAvailable:','SwapTotal:','SwapFree:'))}
x=info();swap0=x['SwapTotal']-x['SwapFree'];initial_available=x['MemAvailable']
while True:
 with sqlite3.connect(root/'mytwin-data/worker.sqlite',timeout=5) as c:status=c.execute('SELECT status FROM jobs WHERE id=?',(identifier,)).fetchone()[0]
 x=info();minimum=min(minimum,x['MemAvailable']);used=int((control/'memory.current').read_text()) if (control/'memory.current').exists() else 0;peak=max(peak,used)
 reason=''
 if x['MemAvailable']<24*gib:reason='Available system memory below 24 GiB safety reserve'
 elif used>38_000_000_000:reason='Worker cgroup exceeded 38 GB early stop'
 elif initial_available-x['MemAvailable']>100_000_000_000:reason='Total host memory growth exceeded 100 GB allowance'
 elif x['SwapTotal']-x['SwapFree']-swap0>256*1024**2:reason='Swap grew by over 256 MiB'
 elif time.monotonic()-start>7235:reason='Watchdog time limit'
 report={'status':status,'min_available_gib':round(minimum/gib,2),'peak_worker_cgroup_gib':round(peak/gib,2),'elapsed_seconds':round(time.monotonic()-start,1),'stopped_reason':reason};log.write_text(json.dumps(report))
 if status in ['completed','failed','cancelled']:break
 if reason:
  subprocess.run(['systemctl','--user','stop','mytwin-worker.service'],timeout=25)
  with sqlite3.connect(root/'mytwin-data/worker.sqlite') as c:c.execute("UPDATE jobs SET status='failed',stage='Safety stop',error=? WHERE id=? AND status NOT IN ('completed','failed','cancelled')",(reason,identifier))
  break
 time.sleep(.25)
