#!/usr/bin/env python3
"""Single-job InfiniteTalk launcher with conservative fail-closed resource checks."""
import fcntl,json,os,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
GiB=1024**3
BLOCKED_MODELS={'vllm-nemotron35-bolt-74b','sglang-qwen38-27b','deepseek-v4-flash','deepseek-v4','voicestudio','comfyui','fooocus','invokeai'}
START_AVAILABLE=96*GiB
STOP_AVAILABLE=24*GiB
MAX_RSS=90_000_000_000
MAX_SECONDS=7200

def available():
    return int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024

def preflight():
    # Persistent lockout after a whole-machine power-off; never bypass via a preset.
    if (ROOT/'.generation-disabled').exists():
        raise RuntimeError('InfiniteTalk generation is disabled pending investigation of unexpected GX10 power-offs. No model was loaded.')
    running=subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True,timeout=10).splitlines()
    # Large inference containers can reserve memory later even while idle.
    conflicts=[n for n in running if n in BLOCKED_MODELS or n.startswith(('vllm-','sglang-','nim-'))]
    if conflicts:raise RuntimeError('Stop these model services before InfiniteTalk: '+', '.join(conflicts))
    if available()<START_AVAILABLE:raise RuntimeError('Insufficient memory: at least 96 GiB available is required. No models were stopped.')

def main():
    import psutil
    lock=open(ROOT/'.generation.lock','w')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise SystemExit('Another InfiniteTalk job is already running.')
    try:preflight()
    except Exception as e:print(str(e),flush=True);return 75
    env=os.environ.copy();env.update(OMP_NUM_THREADS='4',TOKENIZERS_PARALLELISM='false',PYTHONUNBUFFERED='1',HF_HUB_OFFLINE='1')
    env['PATH']=str(ROOT/'bin')+':'+env['PATH']
    cmd=[sys.executable,str(ROOT/'gx10_infer.py'),'--ckpt_dir','weights/Wan2.1-I2V-14B-480P','--wav2vec_dir','weights/chinese-wav2vec2-base','--infinitetalk_dir','weights/InfiniteTalk/single/infinitetalk.safetensors','--quant','int8','--quant_dir','weights/InfiniteTalk/quant_models/infinitetalk_single_int8.safetensors','--size','infinitetalk-480','--offload_model','False','--t5_cpu','--mode','streaming','--motion_frame','9',*sys.argv[1:]]
    child=subprocess.Popen(cmd,cwd=ROOT,env=env,start_new_session=True)
    start=time.monotonic();swap=psutil.swap_memory().used
    def stop():
        if child.poll() is not None:return
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:return
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
    def interrupted(*_):stop();sys.exit(143)
    signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
    try:
        while child.poll() is None:
            reason=''
            try:
                proc=psutil.Process(child.pid)
                rss=sum(p.memory_info().rss for p in [proc]+proc.children(recursive=True) if p.is_running())
                if available()<STOP_AVAILABLE:reason='available system memory below 24 GiB'
                elif rss>MAX_RSS:reason='process RSS above 90 GB'
                elif psutil.swap_memory().used-swap>512*1024**2:reason='swap grew by more than 512 MiB'
                elif time.monotonic()-start>MAX_SECONDS:reason='2-hour job time limit'
            except psutil.NoSuchProcess:break
            if reason:print('Memory guard: '+reason+'; stopping job.',flush=True);stop();return 75
            time.sleep(.1)
        return child.wait()
    finally:stop()
if __name__=='__main__':sys.exit(main())
