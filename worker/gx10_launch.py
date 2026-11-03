#!/usr/bin/env python3
"""Single-job launcher with unified-memory checks for InfiniteTalk on GX10."""
import fcntl, json, os, signal, subprocess, sys, time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
GiB=1024**3
MODELS=['vllm-nemotron35-bolt-74b','sglang-qwen38-27b']
def available():
    return int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines() if x.startswith('MemAvailable:')))*1024
def main():
    lock=open(ROOT/'.generation.lock','w')
    try: fcntl.flock(lock,fcntl.LOCK_EX if os.environ.get("INFINITETALK_WAIT_FOR_LOCK")=="1" else fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: raise SystemExit('Another InfiniteTalk job is already running.')
    if available()<90*GiB:
        running=subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines()
        targets=[n for n in MODELS if n in running]
        if targets:
            print('Stopping model containers for memory:', ', '.join(targets),flush=True)
            subprocess.run(['docker','stop','-t','60',*targets],check=True)
            (ROOT/'stopped-models.json').write_text(json.dumps(targets))
    if available()<90*GiB:
        raise SystemExit(f'Insufficient memory: {available()/GiB:.1f} GiB available; 90 GiB required.')
    env=os.environ.copy();env['OMP_NUM_THREADS']='8';env['TOKENIZERS_PARALLELISM']='false'
    ffmpeg=subprocess.check_output([sys.executable,'-c','import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],text=True).strip()
    bindir=ROOT/'bin';bindir.mkdir(exist_ok=True)
    link=bindir/'ffmpeg'
    if not link.exists(): link.symlink_to(ffmpeg)
    env['PATH']=str(bindir)+':'+env['PATH']
    cmd=[sys.executable,str(ROOT/'gx10_infer.py'),
         '--ckpt_dir','weights/Wan2.1-I2V-14B-480P',
         '--wav2vec_dir','weights/chinese-wav2vec2-base',
         '--infinitetalk_dir','weights/InfiniteTalk/single/infinitetalk.safetensors',
         '--quant','int8','--quant_dir','weights/InfiniteTalk/quant_models/infinitetalk_single_int8.safetensors',
         '--size','infinitetalk-480','--num_persistent_param_in_dit','0',
         '--t5_cpu','--mode','streaming','--motion_frame','9',*sys.argv[1:]]
    child=subprocess.Popen(cmd,cwd=ROOT,env=env,start_new_session=True)
    def stop(*_):
        if child.poll() is None:
            try: os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError: return
            try: child.wait(timeout=15)
            except subprocess.TimeoutExpired: os.killpg(child.pid,signal.SIGKILL);child.wait()
    signal.signal(signal.SIGTERM,lambda *_: (stop(),sys.exit(143)))
    signal.signal(signal.SIGINT,lambda *_: (stop(),sys.exit(130)))
    try:
        while child.poll() is None:
            if available()<12*GiB:
                print('Memory guard: less than 12 GiB available; stopping this job.',flush=True)
                stop();return 75
            time.sleep(0.5)
        return child.returncode
    finally: stop()
if __name__=='__main__': sys.exit(main())
