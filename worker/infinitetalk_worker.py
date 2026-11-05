"""MyTwin v1 adapter for the installed, memory-guarded InfiniteTalk launcher."""
import asyncio, hashlib, hmac, json, math, os, re, signal, sqlite3, subprocess, sys, threading, time, uuid
from contextlib import asynccontextmanager
from pathlib import Path
import av
from PIL import Image, ImageOps
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import FileResponse, JSONResponse

ROOT=Path(os.environ.get('INFINITETALK_ROOT',Path(__file__).resolve().parent))
DATA=Path(os.environ.get('MYTWIN_WORKER_DATA',ROOT/'mytwin-data'))
MAX_BYTES=512*1024*1024
MAX_SECONDS=16
STEPS=int(os.environ.get('MYTWIN_SAMPLE_STEPS','8'))
ACCEL_FILENAME='Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank32.safetensors'
MOTION_PROMPTS={
    'restrained':'Locked-off podcast close-up. A composed person speaks in a quiet, matter-of-fact interview. Neutral relaxed face, relaxed forehead and eyebrows, calm eyes. Head stays upright and steady. Torso and shoulders stay still. Small precise mouth articulation follows the speech, with occasional gentle blinking. Minimal movement throughout. The framing, lighting and background remain completely stable.',
    'podcast':'Fixed camera podcast shot. The person speaks calmly with natural blinking, subtle head nods, breathing and restrained shoulder motion. Stable lighting and background. No camera movement, zoom, pan, cuts or exaggerated gestures.',
}
MOTION_PROMPTS['minimal']=MOTION_PROMPTS['restrained']
MINIMAL_NEGATIVE='exaggerated facial expressions, theatrical acting, raised eyebrows, wide eyes, squinting, excessive blinking, grinning, big smiles, head nodding, head bobbing, head turning, torso movement, shoulder movement, emphatic gestures, camera movement, zoom, pan, cuts'
TOKEN_FILE=Path(os.environ.get('MYTWIN_TOKEN_FILE',ROOT/'mytwin-token'))
STOP=threading.Event()
PROCESS_LOCK=threading.Lock()
PROCESS=None
ACTIVE_ID=None

def db():
    con=sqlite3.connect(DATA/'worker.sqlite',timeout=30)
    con.row_factory=sqlite3.Row
    con.execute('PRAGMA foreign_keys=ON')
    return con

def initialize():
    DATA.mkdir(parents=True,exist_ok=True)
    (DATA/'assets').mkdir(exist_ok=True);(DATA/'jobs').mkdir(exist_ok=True)
    with db() as con:
        con.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, duration REAL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, stage TEXT, error TEXT, created REAL NOT NULL);
        ''')
        con.execute("UPDATE jobs SET status='failed',error='Generation was interrupted when InfiniteTalk stopped. Create a new take to retry.',stage='Interrupted' WHERE status='running'")
        con.execute("UPDATE jobs SET status='cancelled',stage='Cancelled at startup',error='Automatic resume is disabled. Submit a new take.' WHERE status IN ('queued','cancel_requested')")

def lookup(table, identifier):
    with db() as con:return con.execute(f'SELECT * FROM {table} WHERE id=?',(identifier,)).fetchone()

def patch(identifier, **values):
    with db() as con:con.execute('UPDATE jobs SET '+','.join(k+'=?' for k in values)+' WHERE id=?',(*values.values(),identifier))

def inspect_media(path, mime):
    if mime in ('image/png','image/jpeg','image/webp'):
        with Image.open(path) as im:
            if im.format not in ('PNG','JPEG','WEBP') or im.width*im.height>25_000_000 or min(im.size)<64:
                raise ValueError('Use a PNG, JPEG, or WebP portrait between 64 pixels and 25 megapixels.')
            im.verify()
        return None
    if mime not in ('audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/flac','audio/ogg','audio/webm'):
        raise ValueError('Upload a PNG/JPEG/WebP portrait and WAV, MP3, M4A, FLAC, Ogg, or WebM audio.')
    duration=0.0
    with av.open(str(path)) as container:
        if not container.streams.audio or container.streams.video:raise ValueError('Upload an audio-only narration file.')
        for frame in container.decode(audio=0):
            duration+=frame.samples/frame.sample_rate
            if duration>MAX_SECONDS+0.02:raise ValueError(f'InfiniteTalk supports up to {MAX_SECONDS} seconds per take. Shorten this narration or split it into sections.')
    if duration<0.1:raise ValueError('Narration must contain at least 0.1 seconds of decodable audio.')
    return duration

def terminate():
    # Signal the guarded launcher; its handler also stops its separate inference process group.
    with PROCESS_LOCK:
        if PROCESS is not None and PROCESS.poll() is None:
            PROCESS.terminate()

def run_job(job):
    global PROCESS,ACTIVE_ID
    identifier=job['id'];folder=DATA/'jobs'/identifier;folder.mkdir(exist_ok=True)
    payload=json.loads(job['payload'])
    avatar=lookup('assets',payload['inputs']['avatar']);audio=lookup('assets',payload['inputs']['audio'])
    with Image.open(DATA/'assets'/avatar['id']) as im:
        ImageOps.exif_transpose(im).convert('RGB').save(folder/'portrait.png')
    frames=max(13,math.ceil((audio['duration']*25-1)/4)*4+1)
    import soundfile as sf
    import numpy as np
    from av.audio.resampler import AudioResampler
    resampler=AudioResampler(format='s16',layout='mono',rate=16000)
    with av.open(str(DATA/'assets'/audio['id'])) as container, sf.SoundFile(str(folder/'audio.wav'),mode='w',samplerate=16000,channels=1,subtype='PCM_16') as out:
        for frame in container.decode(audio=0):
            for part in resampler.resample(frame):out.write(part.to_ndarray().reshape(-1))
        for part in resampler.resample(None):out.write(part.to_ndarray().reshape(-1))
        # Wan requires an entire 4n+1-frame input window. Preserve all speech,
        # padding only the tail to the next complete window plus one frame.
        missing=math.ceil((frames+1)*16000/25)-out.tell()
        if missing>0:out.write(np.zeros(missing,dtype=np.int16))
    style=payload.get('motionStyle','restrained')
    spec={'prompt':MOTION_PROMPTS[style],'cond_video':str(folder/'portrait.png'),'cond_audio':{'person1':str(folder/'audio.wav')}}
    if style=='minimal':spec['negative_prompt']=MINIMAL_NEGATIVE
    (folder/'input.json').write_text(json.dumps(spec))
    chunk=min(81,frames)
    output_frames=min(81,frames) if payload.get('preview',False) else frames
    env=os.environ.copy();env['INFINITETALK_WAIT_FOR_LOCK']='1'
    accelerated=payload.get('preset')=='lightx2v-4'
    command=[sys.executable,str(ROOT/'gx10_launch.py'),'--input_json',str(folder/'input.json'),'--sample_steps',str(4 if accelerated else STEPS),'--frame_num',str(chunk),'--max_frame_num',str(output_frames),'--save_file',str(folder/'video')]
    if accelerated:
        command += ['--lora_dir',str(ROOT/'weights/acceleration'/ACCEL_FILENAME),'--lora_scale','1.0','--sample_text_guide_scale','2.0' if style=='minimal' else '1.0','--sample_audio_guide_scale','2.0','--sample_shift','2']
    if 'seed' in payload:
        command += ['--base_seed',str(payload['seed'])]
    with (folder/'generation.log').open('w') as log:
        with PROCESS_LOCK:
            if STOP.is_set() or lookup('jobs',identifier)['status']=='cancel_requested':
                patch(identifier,status='cancelled',stage='Cancelled');return
            ACTIVE_ID=identifier
            PROCESS=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
        try:
            patch(identifier,stage='Loading models and generating video. This can take many minutes.')
            code=PROCESS.wait()
        finally:
            with PROCESS_LOCK:
                child=PROCESS
            if child is not None and child.poll() is None:
                child.terminate();child.wait(timeout=25)
            with PROCESS_LOCK:PROCESS=None;ACTIVE_ID=None
    if lookup('jobs',identifier)['status']=='cancel_requested':
        patch(identifier,status='cancelled',stage='Cancelled');return
    if code:
        tail=(folder/'generation.log').read_text(errors='replace')[-2400:]
        if 'Memory guard:' in tail:
            detail=next((line.split('Memory guard:',1)[1].strip() for line in reversed(tail.splitlines()) if 'Memory guard:' in line),'Resource safety threshold reached.')
            error='Safety stop: '+detail
        elif 'Insufficient memory' in tail:
            error='The GX10 memory preflight refused this job. Check available memory before creating a new take.'
        elif STOP.is_set():error='InfiniteTalk was stopped. Create a new take to retry.'
        else:error='InfiniteTalk could not finish this take. See the GX10 worker job log for details.'
        patch(identifier,status='failed',stage='Generation stopped',error=error);return
    output=folder/'video.mp4'
    if not output.exists() or not 1000<output.stat().st_size<=MAX_BYTES:raise ValueError('Generated video is missing or exceeds 512 MB.')
    with av.open(str(output)) as container:
        if not container.streams.audio:raise ValueError('Generated video has no audio.')
        next(container.decode(video=0))
    with output.open('rb') as f:os.fsync(f.fileno())
    patch(identifier,status='completed',stage='Video ready',error=None)

def consume():
    while not STOP.is_set():
        with db() as con:
            con.execute('BEGIN IMMEDIATE')
            job=con.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if job:con.execute("UPDATE jobs SET status='running',stage='Preparing portrait and audio' WHERE id=?",(job['id'],))
        if not job:STOP.wait(0.3);continue
        try:run_job(job)
        except Exception as exc:
            cancelled=lookup('jobs',job['id'])['status']=='cancel_requested'
            patch(job['id'],status='cancelled' if cancelled else 'failed',stage='Cancelled' if cancelled else 'Generation stopped',error=None if cancelled else str(exc)[:500])

@asynccontextmanager
async def lifespan(app):
    initialize();STOP.clear()
    thread=threading.Thread(target=consume,daemon=True);thread.start()
    yield
    STOP.set();terminate();await asyncio.to_thread(thread.join,20)

app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None)
@app.middleware('http')
async def authorize(request,call_next):
    token=TOKEN_FILE.read_text().strip()
    if not token or not hmac.compare_digest(request.headers.get('authorization',''),'Bearer '+token):
        return JSONResponse({'error':'A valid MyTwin connection key is required.'},status_code=401)
    return await call_next(request)
@app.exception_handler(HTTPException)
async def http_error(request,exc):return JSONResponse({'error':str(exc.detail)},status_code=exc.status_code)

@app.get('/v1/capabilities')
def capabilities():
    disabled=(ROOT/'.generation-disabled').exists()
    ready=(ROOT/'.weights-ready').exists() and (ROOT/'gx10_launch.py').exists() and not disabled
    accelerated=ready and (ROOT/'weights/acceleration'/ACCEL_FILENAME).is_file()
    note='Generation disabled while unexpected GX10 power-offs are investigated.' if disabled else 'Uses approved audio. One job at a time; stops automatically if memory gets tight.'
    return {'apiVersion':1,'engines':[{'id':'infinitetalk','name':'InfiniteTalk · GX10','kind':'avatar','ready':ready,'maxDurationSeconds':MAX_SECONDS,'portraitOnly':True,'defaultPreset':'lightx2v-4' if accelerated else 'baseline','presets':[{'id':'lightx2v-4','name':'Accelerated · 4 steps','ready':accelerated},{'id':'baseline','name':'Baseline · 8 steps','ready':ready}],'note':note}]}

def key(request):
    value=request.headers.get('idempotency-key','')
    if not value or len(value)>200:raise HTTPException(400,'A valid Idempotency-Key is required.')
    return value

@app.post('/v1/assets')
async def upload(request:Request):
    idem=key(request);identifier=uuid.uuid4().hex;temporary=DATA/'assets'/(identifier+'.part')
    mime=request.headers.get('content-type','').split(';')[0].lower()
    digest=hashlib.sha256();size=0
    try:
        with temporary.open('wb') as f:
            async for chunk in request.stream():
                size+=len(chunk)
                if size>MAX_BYTES:raise HTTPException(413,'Media exceeds 512 MB.')
                digest.update(chunk);f.write(chunk)
            f.flush();os.fsync(f.fileno())
        if not size:raise HTTPException(400,'The uploaded file is empty.')
        fingerprint=digest.hexdigest()
        with db() as con:old=con.execute('SELECT * FROM assets WHERE idem=?',(idem,)).fetchone()
        if old:
            if old['digest']!=fingerprint or old['type']!=mime:raise HTTPException(409,'This upload key already belongs to another file.')
            return {'id':old['id']}
        try:duration=await asyncio.to_thread(inspect_media,temporary,mime)
        except Exception as exc:raise HTTPException(422,str(exc)) from exc
        with db() as con:
            con.execute('BEGIN IMMEDIATE')
            old=con.execute('SELECT * FROM assets WHERE idem=?',(idem,)).fetchone()
            if old:
                if old['digest']!=fingerprint or old['type']!=mime:raise HTTPException(409,'Upload key conflict.')
                return {'id':old['id']}
            temporary.rename(DATA/'assets'/identifier)
            con.execute('INSERT INTO assets VALUES(?,?,?,?,?,?)',(identifier,idem,fingerprint,mime,request.headers.get('x-filename','media')[:200],duration))
        return {'id':identifier}
    finally:temporary.unlink(missing_ok=True)

@app.post('/v1/jobs')
async def submit(request:Request):
    idem=key(request)
    raw=b''
    async for chunk in request.stream():
        raw+=chunk
        if len(raw)>65536:raise HTTPException(413,'Job request is too large.')
    try:payload=json.loads(raw)
    except Exception:raise HTTPException(400,'Invalid job JSON.')
    if not isinstance(payload,dict):raise HTTPException(400,'Expected a job object.')
    digest=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
    with db() as con:
        con.execute('BEGIN IMMEDIATE')
        old=con.execute('SELECT * FROM jobs WHERE idem=?',(idem,)).fetchone()
        if old:
            if old['digest']!=digest:raise HTTPException(409,'This job key already belongs to another request.')
            return {'id':old['id']}
        if payload.get('kind')!='avatar' or payload.get('engine')!='infinitetalk':raise HTTPException(422,'This worker supports InfiniteTalk avatar videos only. Generate or upload voice audio in MyTwin first.')
        if payload.get('preset','baseline') not in ('baseline','lightx2v-4'):raise HTTPException(422,'Unsupported InfiniteTalk preset.')
        style=payload.get('motionStyle','restrained')
        if not isinstance(style,str) or style not in MOTION_PROMPTS:raise HTTPException(422,'Unsupported avatar motion style.')
        if type(payload.get('preview',False)) is not bool:raise HTTPException(422,'Preview must be true or false.')
        if payload.get('preset')=='lightx2v-4' and not (ROOT/'weights/acceleration'/ACCEL_FILENAME).is_file():raise HTTPException(503,'The Lightx2v adapter is not installed.')
        if 'seed' in payload and (type(payload['seed']) is not int or not 0<=payload['seed']<=2**32-1):raise HTTPException(422,'Seed must be an unsigned 32-bit integer.')
        if not capabilities()['engines'][0]['ready']:raise HTTPException(503,'InfiniteTalk is not ready.')
        inputs=payload.get('inputs',{})
        if not isinstance(inputs,dict):raise HTTPException(422,'Portrait and audio inputs are required.')
        for role in ('avatar','audio'):
            aid=inputs.get(role)
            if not isinstance(aid,str):raise HTTPException(422,f'Missing {role} reference.')
            asset=con.execute('SELECT * FROM assets WHERE id=?',(aid,)).fetchone()
            if not asset or not asset['type'].startswith('image/' if role=='avatar' else 'audio/'):
                raise HTTPException(422,f'Invalid {role} reference.')
        if con.execute("SELECT COUNT(*) FROM jobs WHERE status IN ('queued','running','cancel_requested')").fetchone()[0]>=4:raise HTTPException(429,'The GX10 queue is full. Wait for a take to finish.')
        identifier=uuid.uuid4().hex
        con.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?)',(identifier,idem,digest,json.dumps(payload),'queued','Queued on GX10',None,time.time()))
    return {'id':identifier}

@app.get('/v1/jobs/{identifier}')
def status(identifier:str):
    job=lookup('jobs',identifier)
    if not job:raise HTTPException(404,'Job not found.')
    result={'id':identifier,'status':job['status'],'stage':job['stage'],'error':job['error']}
    if job['status']=='running':
        result['stage']=generation_progress(job) or job['stage']
    if job['status']=='completed':result['output']={'id':identifier,'name':'avatar.mp4','type':'video/mp4'}
    return result

def generation_progress(job):
    """Expose the current streaming window without changing the queue state."""
    try:
        payload=json.loads(job['payload'])
        audio=lookup('assets',payload['inputs']['audio'])
        frames=max(13,math.ceil((audio['duration']*25-1)/4)*4+1)
        if payload.get('preview',False):frames=min(81,frames)
        windows=1+math.ceil(max(0,frames-81)/72)
        steps=4 if payload.get('preset')=='lightx2v-4' else STEPS
        path=DATA/'jobs'/job['id']/'generation.log'
        with path.open('rb') as f:
            f.seek(max(0,path.stat().st_size-65536));log=f.read().decode(errors='replace')
        bars=[(int(p),int(n)) for p,n,total in re.findall(r'(\d+)%\|[^\r\n]*?\|\s*(\d+)/(\d+)\s+\[',log) if int(total)==steps]
        if not bars:return None
        completed=0;previous=None
        for percent,_ in bars:
            if percent==100 and previous!=100:completed+=1
            previous=percent
        percent,step=bars[-1]
        if completed>=windows:return 'Finishing video'
        if percent==100:return f'Finishing segment {completed} of {windows}'
        return f'Generating segment {completed+1} of {windows} · step {step} of {steps}'
    except (OSError,KeyError,TypeError,ValueError):return None

@app.get('/v1/artifacts/{identifier}')
def artifact(identifier:str):
    job=lookup('jobs',identifier)
    if not job or job['status']!='completed':raise HTTPException(404,'Completed video not found.')
    return FileResponse(DATA/'jobs'/job['id']/'video.mp4',media_type='video/mp4',filename='avatar.mp4')

@app.post('/v1/jobs/{identifier}/cancel')
def cancel(identifier:str):
    with PROCESS_LOCK:
        with db() as con:
            con.execute('BEGIN IMMEDIATE')
            job=con.execute('SELECT * FROM jobs WHERE id=?',(identifier,)).fetchone()
            if not job:raise HTTPException(404,'Job not found.')
            if job['status'] in ('completed','failed','cancelled'):return {'ok':True}
            state='cancelled' if job['status']=='queued' else 'cancel_requested'
            con.execute('UPDATE jobs SET status=?,stage=? WHERE id=?',(state,'Cancellation requested',identifier))
        if ACTIVE_ID==identifier and PROCESS is not None and PROCESS.poll() is None:PROCESS.terminate()
    return {'ok':True}

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host=os.environ.get('MYTWIN_WORKER_HOST','100.77.38.96'),port=int(os.environ.get('MYTWIN_WORKER_PORT','8420')),access_log=False,timeout_graceful_shutdown=5)
