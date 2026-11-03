import {createVoiceStudio} from './lib/voicestudio.mjs';
import {createLocalTts,validateLocal,speechOptions} from './lib/local-tts.mjs';
import {createVideo,prepareVideo,validateAvatar,avatarOptions} from './lib/video.mjs';
import {createOpenRouter} from './lib/openrouter.mjs';
import http from 'node:http';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore,id,now } from './lib/store.mjs';
import { createOrchestrator,workerClient } from './lib/worker.mjs';

const root=dirname(fileURLToPath(import.meta.url));
try{process.loadEnvFile(join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
async function jsonBody(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>2*1024*1024)throw fail('Request is too large.',413);chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw fail('Invalid JSON.');}}
const str=(v,max=500)=>typeof v==='string'?v.slice(0,max):'';

export async function createApp({dataDir=join(root,'data'),fetcher=fetch}={}) {
  await mkdir(join(dataDir,'media'),{recursive:true});
  const store=await createStore(dataDir);
  let secrets={};try{secrets=JSON.parse(await readFile(join(dataDir,'secrets.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const token=async()=>secrets.workerToken||process.env.GX10_TOKEN||'';
  const orchestrator=createOrchestrator(store,dataDir,token,fetcher);
  const openrouter=createOpenRouter(store,dataDir,()=>secrets.openrouterKey||process.env.OPENROUTER_API_KEY,fetcher);
  const voicestudio=createVoiceStudio(store,dataDir,()=>secrets.voicestudioKey,fetcher);
const localTts=createLocalTts(store,dataDir);
  await store.update(s=>{for(const j of s.jobs)if(['local','voicestudio'].includes(j.provider)&&['running','queued','submitting'].includes(j.status))Object.assign(j,{status:'failed',error:'Local speech was interrupted. Generate a new take.'});});
  const video=createVideo(store,dataDir,()=>secrets.openrouterKey||process.env.OPENROUTER_API_KEY,fetcher);
  await store.update(s=>{for(const j of s.jobs)if(!j.videoRemoteId&&j.provider==='openrouter'&&['running','submitting'].includes(j.status))Object.assign(j,{status:'failed',error:'Interrupted. Check OpenRouter activity before starting another take; credits may have been used.'});});
  const server=http.createServer(async(req,res)=>{
    const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const host=req.headers.host;
      if(!host||!/^((localhost|127\.0\.0\.1)(:\d+)?)$/.test(host))throw fail('Only localhost access is enabled.',403);
      const origin=req.headers.origin;
      if(origin&&origin!==`http://${host}`)throw fail('Cross-origin requests are not allowed.',403);
      if(req.headers['sec-fetch-site']==='cross-site')throw fail('Cross-site requests are not allowed.',403);
      const url=new URL(req.url,`http://${host}`),path=url.pathname;
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");
      if(path==='/api/state'&&req.method==='GET'){
        const s=store.read();s.settings.voicestudioConfigured=!!secrets.voicestudioKey;s.settings.openrouterConfigured=!!(secrets.openrouterKey||process.env.OPENROUTER_API_KEY);s.settings.workerTokenConfigured=!!await token();return send(s);
      }
      if(path==='/api/openrouter/video-models'&&req.method==='GET')return send(await video.models());
      if(path==='/api/openrouter/models'&&req.method==='GET')return send(await openrouter.models());
      if(path==='/api/openrouter/check'&&req.method==='POST')return send(await openrouter.check());
      if(path==='/api/openrouter/details'&&req.method==='POST')return send(await openrouter.details((await jsonBody(req)).model));
      if(path==='/api/voicestudio/check'&&req.method==='POST')return send(await voicestudio.check());
if(path==='/api/local-tts/status'&&req.method==='GET')return send(await localTts.status());
      if(path==='/api/local-tts/download'&&req.method==='POST')return send(await localTts.download((await jsonBody(req)).engine));
      if(path==='/api/listen'&&req.method==='POST')return send(await openrouter.listen((await jsonBody(req)).assetId));
      if(path==='/api/projects'&&req.method==='POST'){
        const b=await jsonBody(req);const p={id:id(),title:str(b.title)||'Untitled production',mode:'voice',sections:[{id:id(),title:'Opening',text:''}],profileId:'',language:'en',audioId:'',createdAt:now(),updatedAt:now()};
        await store.update(s=>s.projects.unshift(p));return send(p,201);
      }
      const pm=path.match(/^\/api\/projects\/([\w-]+)$/);
      if(pm&&req.method==='PUT'){
        const b=await jsonBody(req);
        if(!Array.isArray(b.sections)||!b.sections.length||b.sections.length>100)throw fail('Use between 1 and 100 sections.');
        if(b.tracks!==undefined&&(!Array.isArray(b.tracks)||b.tracks.length>16||b.tracks.some(t=>!t.id||typeof t.name!=='string'||!Number.isFinite(t.volume)||t.volume<0||t.volume>1)))throw fail('Invalid audio tracks.');
        for(const x of b.sections){if(x.offset!==undefined&&(!Number.isFinite(x.offset)||x.offset<0||x.offset>7200))throw fail('Invalid clip position.');if(x.trims!==undefined){if(!x.trims||typeof x.trims!=='object'||Array.isArray(x.trims)||Object.keys(x.trims).length>100)throw fail('Invalid trims.');for(const r of Object.values(x.trims))if(!r||!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start)throw fail('Invalid trim range.');}}
        const sections=b.sections.map(x=>({id:str(x.id,100)||id(),title:str(x.title,100)||'Section',text:str(x.text,50000),sceneImageId:str(x.sceneImageId,100),scenePrompt:str(x.scenePrompt,10000),...(x.trackId?{trackId:str(x.trackId,100)}:{}),...(x.offset!==undefined?{offset:x.offset}:{}),...(x.trims?{trims:x.trims}:{}),...(typeof x.previousText==='string'?{previousText:str(x.previousText,50000)}:{})}));
        const p=await store.update(s=>{const p=s.projects.find(p=>p.id===pm[1]);if(!p)throw fail('Production not found.',404);Object.assign(p,{videoTrack:!!b.videoTrack,title:str(b.title)||'Untitled production',mode:['voice','avatar','audio','video'].includes(b.mode)?b.mode:'voice',sections,...(b.tracks?{tracks:b.tracks.map(t=>({id:str(t.id,100),name:str(t.name,100),volume:t.volume,muted:!!t.muted}))}:{}),profileId:str(b.profileId,100),language:str(b.language,20)||'en',audioId:str(b.audioId,100),updatedAt:now()});return p;});return send(p);
      }
      const profileMatch=path.match(/^\/api\/profiles\/([\w-]+)$/);
      if(path==='/api/profiles'&&req.method==='POST'||profileMatch&&req.method==='PUT'){
        const b=await jsonBody(req);if(!str(b.name).trim())throw fail('Give your twin a name.');
        const s=store.read();for(const [key,type]of [['voiceAssetId','audio/'],['avatarAssetId',null]]){if(b[key]){const a=s.assets.find(a=>a.id===b[key]);if(!a||(type?!a.type.startsWith(type):!(/^(image|video)\//.test(a.type))))throw fail('Select a valid reference file.');}}
        if(profileMatch){const updated=await store.update(s=>{const p=s.profiles.find(p=>p.id===profileMatch[1]);if(!p)throw fail('Twin not found.',404);Object.assign(p,{name:str(b.name),notes:str(b.notes,3000),voiceTranscript:str(b.voiceTranscript,3000),voiceAssetId:str(b.voiceAssetId,100),avatarAssetId:str(b.avatarAssetId,100),updatedAt:now()});return p;});return send(updated);}
        const p={id:id(),name:str(b.name),voiceAssetId:str(b.voiceAssetId,100),avatarAssetId:str(b.avatarAssetId,100),notes:str(b.notes,3000),voiceTranscript:str(b.voiceTranscript,3000),createdAt:now()};await store.update(s=>s.profiles.push(p));return send(p,201);
      }
      if(path==='/api/assets'&&req.method==='POST'){
        const allowed=['audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/x-m4a','audio/flac','audio/ogg','audio/webm','video/mp4','video/quicktime','video/webm','image/png','image/jpeg','image/webp'];
        const type=req.headers['content-type']?.split(';')[0];if(!allowed.includes(type))throw fail('Use WAV, MP3, M4A, FLAC, OGG, MP4, MOV, WebM, PNG, JPG or WebP.');
        const asset={id:id(),name:str(decodeURIComponent(req.headers['x-filename']||'upload')),type,size:0,createdAt:now()};
        const file=join(dataDir,'media',asset.id);const limit=new Transform({transform(c,e,cb){asset.size+=c.length;cb(asset.size>512*1024*1024?fail('Maximum upload is 512 MB.',413):null,c);}});
        try{await pipeline(req,limit,createWriteStream(file,{mode:0o600}));if(!asset.size)throw fail('The file is empty.');await store.update(s=>s.assets.push(asset));}catch(e){await unlink(file).catch(()=>{});throw e;}return send(asset,201);
      }
      const am=path.match(/^\/api\/assets\/([\w-]+)$/);
      if(am&&req.method==='GET'){
        const a=store.read().assets.find(a=>a.id===am[1]);if(!a)throw fail('Asset not found.',404);
        const file=join(dataDir,'media',a.id),size=(await stat(file)).size;
        res.setHeader('Content-Type',a.type);res.setHeader('Accept-Ranges','bytes');
        if(url.searchParams.has('download'))res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`);
        const range=req.headers.range;
        if(range){const m=range.match(/^bytes=(\d+)-(\d*)$/);if(!m){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}const start=Number(m[1]),end=Math.min(m[2]?Number(m[2]):size-1,size-1);if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});return createReadStream(file,{start,end}).pipe(res);}
        res.setHeader('Content-Length',size);return createReadStream(file).pipe(res);
      }
      if(path==='/api/settings'&&req.method==='PUT'){
        const b=await jsonBody(req);if(b.localSpeech!==undefined)b.localSpeech=speechOptions(b.localSpeech);if(b.workerUrl)workerClient(b.workerUrl);
        if(b.voicestudioKey!==undefined)secrets.voicestudioKey=str(b.voicestudioKey,1000);
if(b.openrouterKey!==undefined)secrets.openrouterKey=str(b.openrouterKey,1000);
        if(b.workerToken!==undefined)secrets.workerToken=str(b.workerToken,1000);
        await writeFile(join(dataDir,'secrets.json'),JSON.stringify(secrets),{mode:0o600});
        await store.update(s=>{if(b.localSpeech!==undefined)s.settings.localSpeech=b.localSpeech;for(const k of ['model','speechModel','listeningModel','voiceMode','voice','voiceProvider','avatarProvider','localEngine','localVoice'])if(b[k]!==undefined)s.settings[k]=str(b[k],200);if(b.workerUrl!==undefined&&(b.workerUrl!==s.settings.workerUrl||b.workerToken!==undefined))Object.assign(s.settings,{workerUrl:str(b.workerUrl,1000),workerStatus:'disconnected',capabilities:null});});return send({ok:true});
      }
      if(path==='/api/worker/check'&&req.method==='POST'){
        const s=store.read();if(!s.settings.workerUrl)throw fail('Add the GX10 worker URL first.');
        try{const cap=await (await workerClient(s.settings.workerUrl,await token(),fetcher)('/v1/capabilities')).json();if(cap.apiVersion!==1||!Array.isArray(cap.engines))throw fail('This endpoint is not a MyTwin v1 worker.');await store.update(s=>Object.assign(s.settings,{workerStatus:'connected',capabilities:cap}));return send(cap);}catch(e){await store.update(s=>s.settings.workerStatus='disconnected');throw fail(e.message,502);}
      }
      if(path==='/api/write'&&req.method==='POST'){
        const b=await jsonBody(req),key=secrets.openrouterKey||process.env.OPENROUTER_API_KEY;
        if(!key)throw fail('Add an OpenRouter API key in Settings.',422);
        const model=store.read().settings.model;if(!model)throw fail('Choose an OpenRouter model in Settings.',422);
        const actions={polish:'Polish the narration for natural spoken delivery. Preserve facts and intent.',shorten:'Shorten the narration while preserving the essential facts.',expand:'Expand these notes into spoken narration. Do not invent factual claims.',draft:'Turn these notes into a clear spoken script. Do not invent factual claims.'};
        if(!actions[b.action]||!str(b.text,50000).trim())throw fail('Enter a script or notes first.');
        const response=await fetcher('https://openrouter.ai/api/v1/chat/completions',{method:'POST',signal:AbortSignal.timeout(90000),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','X-OpenRouter-Title':'MyTwin Studio'},body:JSON.stringify({model,messages:[{role:'system',content:`${actions[b.action]} Return only the script, without commentary or markdown. Keep the input language unless instructed otherwise.`},{role:'user',content:str(b.text,50000)}],max_tokens:4000})});
        if(!response.ok)throw fail(`OpenRouter returned HTTP ${response.status}. Check your key, model access and credits.`,502);
        const result=await response.json(),text=result.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw fail('The model returned no usable script.',502);return send({text,model});
      }
      if(path==='/api/jobs'&&req.method==='POST'){
        const b=await jsonBody(req),s=store.read(),p=s.projects.find(p=>p.id===b.projectId),section=p?.sections.find(x=>x.id===b.sectionId),profile=s.profiles.find(x=>x.id===p?.profileId);
        if(!p||!section)throw fail('Select a saved production and section.');
        if(b.provider==='voicestudio'&&(b.kind!=='voice'||b.engine!=='omnivoice'))throw fail('VoiceStudio supports OmniVoice speech.');
 if(b.kind==='video'){if(b.provider!=='openrouter')throw fail('Choose OpenRouter for video generation.');const j=prepareVideo(s,b);await store.update(s=>s.jobs.unshift(j));return send(j,201);}
        if(!['voice','avatar'].includes(b.kind))throw fail('Invalid generation kind.');
        if(!profile)throw fail('Create and select your twin profile first.');
        if(b.provider==='local')validateLocal(b,p.language,profile.voiceTranscript);
        const inputs={};let sourceJobId='';
        if(b.kind==='voice'){if(!section.text.trim())throw fail('Enter narration first.');if(!((b.provider==='openrouter'&&b.voiceMode==='preset'||b.provider==='local'&&b.engine==='kokoro'))&&!profile.voiceAssetId)throw fail('Your twin needs a voice reference.');inputs.voice=profile.voiceAssetId;}
        else{if(!profile.avatarAssetId)throw fail('Your twin needs an appearance reference.');inputs.avatar=profile.avatarAssetId;
          if(p.mode==='audio'){if(!s.assets.some(a=>a.id===p.audioId&&a.type.startsWith('audio/')))throw fail('Upload narration audio first.');inputs.audio=p.audioId;}
          else{const source=s.jobs.find(j=>j.id===b.sourceJobId&&j.projectId===p.id&&j.sectionId===section.id&&j.kind==='voice'&&j.status==='completed'&&j.approved&&j.text===section.text);if(!source)throw fail('Approve a current voice take before generating the avatar.');inputs.audio=source.outputId;sourceJobId=source.id;}}
        if(!str(b.engine,200))throw fail('Choose an engine.');if(b.provider==='openrouter'&&b.kind==='avatar')validateAvatar(s,inputs,b.engine);
        const job={speech:b.provider==='local'?speechOptions(b.speech===undefined?s.settings.localSpeech:b.speech):undefined,id:id(),projectId:p.id,sectionId:section.id,projectTitle:p.title,sectionTitle:section.title,profileName:profile.name,kind:b.kind,provider:b.provider==='voicestudio'?'voicestudio':b.provider==='local'?'local':b.provider==='openrouter'?'openrouter':'gx10',referenceText:profile.voiceTranscript||'',voiceMode:b.provider==='local'?(b.engine==='kokoro'?'preset':'clone'):str(b.voiceMode),voice:str(b.voice),engine:str(b.engine,200),text:section.text,language:p.language,inputs,sourceJobId,video:b.kind==='avatar'&&b.provider==='openrouter'?avatarOptions(b.video):undefined,audioShare:b.audioShare===true,status:'prepared',stage:b.provider==='local'?'Ready to generate on this Mac':'Ready to submit when GX10 is available',createdAt:now(),updatedAt:now(),approved:false};
        await store.update(s=>s.jobs.unshift(job));return send(job,201);
      }
      const jm=path.match(/^\/api\/jobs\/([\w-]+)\/(submit|refresh|cancel|approve)$/);
      if(jm&&req.method==='POST'){
        const job=store.read().jobs.find(j=>j.id===jm[1]);if(!job)throw fail('Job not found.',404);
        if(job.provider==='voicestudio'&&jm[2]!=='approve'){if(jm[2]==='submit'){await voicestudio.claim(job.id);void voicestudio.run(job.id);}else if(jm[2]==='cancel'){if(job.status!=='prepared')throw fail('Speech is already running.');await store.update(s=>s.jobs.find(j=>j.id===job.id).status='cancelled');}return send({ok:true});}
if(job.provider==='local'&&jm[2]!=='approve'){if(jm[2]==='submit'){await localTts.claim(job.id);void localTts.run(job.id);}if(jm[2]==='cancel')await localTts.cancel(job.id);return send({ok:true});}
        if(job.provider==='openrouter'&&jm[2]!=='approve'){
          if(jm[2]==='submit'){const client=['video','avatar'].includes(job.kind)?video:openrouter;await client.claim(job.id);void client.run(job.id,true);}
          if(jm[2]==='refresh'&&['video','avatar'].includes(job.kind))void video.run(job.id);
          if(jm[2]==='cancel'){if(job.status!=='prepared')throw fail('A submitted OpenRouter request cannot be cancelled here');await store.update(s=>s.jobs.find(j=>j.id===job.id).status='cancelled');}
          return send({ok:true});
        }
        if(jm[2]==='approve'){if(job.status!=='completed')throw fail('Only completed takes can be approved.');await store.update(s=>{for(const j of s.jobs)if(j.projectId===job.projectId&&j.sectionId===job.sectionId&&j.kind===job.kind)j.approved=j.id===job.id;});}
        else if(jm[2]==='cancel')await orchestrator.cancel(job.id);
        else {void orchestrator.run(job.id);}
        return send({ok:true});
      }
      if(path.startsWith('/api/'))throw fail('Endpoint not found.',404);
      if(req.method!=='GET')throw fail('Method not allowed.',405);
      const files={'/':'index.html','/app.js':'app.js','/job-status.js':'job-status.js','/global-queue.js':'global-queue.js','/model-pricing.js':'model-pricing.js','/voice-recorder.js':'voice-recorder.js','/timeline-editor.js':'timeline-editor.js','/timeline-export.js':'timeline-export.js','/timeline-model.js':'timeline-model.js','/audio-timeline.js':'audio-timeline.js','/style.css':'style.css'};
      if(!files[path])throw fail('Not found.',404);
      const body=await readFile(join(root,'public',files[path]));res.setHeader('Content-Type',({'html':'text/html','js':'text/javascript','css':'text/css'})[extname(files[path]).slice(1)]);res.end(body);
    }catch(e){if(!res.headersSent)send({error:e.status?e.message:'The operation failed. Check the connection or retry.'},e.status||500);else res.end();}
  });
  const timer=setInterval(()=>{for(const j of store.read().jobs)if(j.remoteId&&['queued','running','cancel_requested','waiting'].includes(j.status))void orchestrator.run(j.id);},5000);timer.unref();
  const videoTimer=setInterval(()=>{for(const j of store.read().jobs)if(j.videoRemoteId&&['queued','running'].includes(j.status))void video.run(j.id);},30000);videoTimer.unref();
  server.on('close',()=>{clearInterval(timer);clearInterval(videoTimer);});
  return {server,store,orchestrator};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const {server}=await createApp();const port=Number(process.env.PORT)||4317;
  server.listen(port,'127.0.0.1',()=>console.log(`MyTwin Studio: http://127.0.0.1:${port}`));
}
