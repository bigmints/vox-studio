import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {createLocalTts,localCatalog,validateLocal,prepareVoicePreview,savedLocalVoice} from '../lib/local-tts.mjs';
import {createApp} from '../server.mjs';

async function fixture(t,runner){
 const dir=await mkdtemp(join(tmpdir(),'mytwin-local-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'media'));await mkdir(join(dir,'local-tts/venv/bin'),{recursive:true});await writeFile(join(dir,'local-tts/venv/bin/python'),'test');
 for(const [key,m]of Object.entries(localCatalog))await writeFile(join(dir,'local-tts',key+'.ready.json'),JSON.stringify({revision:m.revision,runtimeVersion:m.runtimeVersion||1}));
 const store=await createStore(dir);await store.update(s=>s.jobs=[{id:'j',kind:'voice',provider:'local',status:'prepared',engine:'kokoro',voice:'af_heart',language:'en',text:'Hello',sectionTitle:'Opening'}]);
 return {dir,store,client:createLocalTts(store,dir,runner)};
}
function wav(){const b=Buffer.alloc(100);b.write('RIFF');b.writeUInt32LE(92,4);b.write('WAVE',8);return b;}
test('all 54 Kokoro presets validate in their language and reject mismatched languages',()=>{
 assert.equal(Object.keys(localCatalog.kokoro.voices).length,54);
 for(const [voice,language] of Object.entries(localCatalog.kokoro.voiceLanguages)){
  assert.doesNotThrow(()=>validateLocal({kind:'voice',engine:'kokoro',voice},language,''));
  assert.throws(()=>validateLocal({kind:'voice',engine:'kokoro',voice},language==='en'?'ja':'en',''),/matching/);
 }
 for(const voice of Object.keys(localCatalog['qwen3-custom'].voices))assert.doesNotThrow(()=>validateLocal({kind:'voice',engine:'qwen3-custom',voice,instruct:'Warm and clear'},'en',''));
 assert.equal(Object.keys(localCatalog['qwen3-custom'].voices).length,9);
});
test('preview validation bounds text and requires design instructions',()=>{
 const request={engine:'qwen3-design',language:'en',text:'Welcome to the studio.',instruct:'Warm female voice.'};
 assert.equal(prepareVoicePreview(request).purpose,'voice-preview');
 assert.throws(()=>prepareVoicePreview({...request,instruct:''}),/Describe/);
 assert.throws(()=>prepareVoicePreview({...request,text:'x'.repeat(301)}),/300/);
 assert.throws(()=>prepareVoicePreview({...request,instruct:'x'.repeat(2001)}),/2,000/);
 assert.throws(()=>prepareVoicePreview({...request,engine:'qwen3-custom',voice:'missing'}),/preset/);
});
test('cloned previews require an audio asset and transcript and snapshot the recording',()=>{
 const body={engine:'qwen3-hq',language:'en',text:'A new sentence to audition.',voiceAssetId:'ref',voiceTranscript:'The exact recorded words.'};
 const state={assets:[{id:'ref',type:'audio/wav'}]};
 const job=prepareVoicePreview(body,state);
 assert.equal(job.voiceMode,'clone');assert.equal(job.inputs.voice,'ref');assert.equal(job.referenceText,body.voiceTranscript);
 body.voiceTranscript='Changed later';assert.equal(job.referenceText,'The exact recorded words.');
 assert.throws(()=>prepareVoicePreview({...body,voiceTranscript:''},state),/transcript/);
 assert.throws(()=>prepareVoicePreview(body,{assets:[]}),/recording/);
 assert.throws(()=>prepareVoicePreview(body,{assets:[{id:'ref',type:'video/mp4'}]}),/recording/);
 assert.throws(()=>prepareVoicePreview({...body,voiceTranscript:'x'.repeat(3001)},state),/3,000/);
});
test('cloned preview uses the chosen reference without changing a saved twin',async t=>{
 const f=await fixture(t,async(root,op,r)=>{assert.equal(r.reference,join(f.dir,'media','ref'));assert.equal(r.referenceText,'Original words.');await writeFile(r.output,wav());return {duration:5};});
 await f.store.update(s=>{s.assets.push({id:'ref',type:'audio/wav'});s.profiles=[{id:'t',name:'Original twin',voiceAssetId:'ref'}];});
 const job=await f.client.preview({engine:'qwen3-hq',language:'en',text:'Trying my voice.',voiceAssetId:'ref',voiceTranscript:'Original words.'});
 await f.client.run(job.id);assert.equal(f.store.read().jobs.find(j=>j.id===job.id).status,'completed');assert.deepEqual(f.store.read().profiles,[{id:'t',name:'Original twin',voiceAssetId:'ref'}]);
});
test('designed twins bind to the exact completed preview and reject stale or missing audio',()=>{
 const job={...prepareVoicePreview({engine:'qwen3-design',language:'en',text:'Exact preview words.',instruct:'Warm female voice.'}),status:'completed',duration:8,outputId:'audio'};
 const state={jobs:[job],assets:[{id:'audio',type:'audio/wav'}]};
 const body={voiceProvider:'local',localEngine:'qwen3-design',localVoiceInstruction:job.instruct,localVoiceLanguage:'en',voicePreviewJobId:job.id};
 const saved=savedLocalVoice(body,state);
 assert.equal(saved.localEngine,'qwen3-hq');assert.equal(saved.voiceAssetId,'audio');assert.equal(saved.voiceTranscript,job.text);assert.equal(saved.voiceDesign.previewJobId,job.id);
 assert.throws(()=>savedLocalVoice({...body,localVoiceInstruction:'Different voice'},state),/preview/);
 assert.throws(()=>savedLocalVoice(body,{...state,assets:[]}),/preview/);
 assert.throws(()=>savedLocalVoice(body,{...state,jobs:[{...job,duration:31}]}),/30 seconds/);
 assert.throws(()=>savedLocalVoice(body,{...state,jobs:[{...job,status:'running'}]}),/preview/);
});
test('preview jobs generate without a project, preserve instructions, and can become a saved twin',async t=>{
 const f=await fixture(t,async(root,op,r)=>{assert.equal(r.instruct,'Warm female voice.');assert.equal(r.reference,undefined);await writeFile(r.output,wav());return {duration:8};});
 const job=await f.client.preview({engine:'qwen3-design',language:'en',text:'Exact preview words.',instruct:'Warm female voice.'});
 await f.client.run(job.id);
 const done=f.store.read().jobs.find(j=>j.id===job.id);assert.equal(done.status,'completed');
 const saved=savedLocalVoice({voiceProvider:'local',localEngine:'qwen3-design',localVoiceInstruction:done.instruct,localVoiceLanguage:'en',voicePreviewJobId:done.id},f.store.read());
 assert.equal(saved.voiceAssetId,done.outputId);
});
test('old Kokoro installs require multilingual setup before advertising readiness',async t=>{
 const f=await fixture(t,async()=>{});await writeFile(join(f.dir,'local-tts/kokoro.ready.json'),JSON.stringify({revision:localCatalog.kokoro.revision}));
 assert.equal((await f.client.status()).models.kokoro.ready,false);
 await assert.rejects(f.client.preview({engine:'kokoro',voice:'af_heart',language:'en',text:'Welcome to the studio.'}),/Download/);
});
test('local take saves output, never submits twice, and snapshots cloning inputs',async t=>{
 let calls=0;const f=await fixture(t,async(root,op,request)=>{calls++;assert.equal(op,'generate');assert.equal(request.referenceText,'Exact words');assert.equal(request.reference,join(f.dir,'media','ref'));await writeFile(request.output,wav());return {duration:1};});
 await f.store.update(s=>{s.assets=[{id:'ref',type:'audio/wav'}];Object.assign(s.jobs[0],{engine:'qwen3',referenceText:'Exact words',inputs:{voice:'ref'}});});
 await f.client.claim('j');await assert.rejects(f.client.claim('j'));await f.client.run('j');await f.client.run('j');
 const j=f.store.read().jobs[0];assert.equal(j.status,'completed');assert.equal(calls,1);assert.equal(j.duration,1);assert.deepEqual(await readFile(join(f.dir,'media',j.outputId)),wav());
});
test('local queue serializes inference and cancels queued work without invoking model',async t=>{
 let release,started;const ready=new Promise(r=>started=r);let calls=0;
 const f=await fixture(t,async(root,op,r)=>{calls++;started();await new Promise(r=>release=r);await writeFile(r.output,wav());return {duration:1};});
 await f.store.update(s=>s.jobs.push({...s.jobs[0],id:'k'}));await f.client.claim('j');await f.client.claim('k');
 const first=f.client.run('j');await ready;const second=f.client.run('k');await f.client.cancel('k');release();await Promise.all([first,second]);assert.equal(calls,1);assert.equal(f.store.read().jobs[1].status,'cancelled');
});
test('missing model and invalid audio fail visibly without creating a take',async t=>{
 const f=await fixture(t,async(root,op,r)=>{await writeFile(r.output,'bad audio');return {};});await f.client.claim('j');await f.client.run('j');assert.equal(f.store.read().jobs[0].status,'failed');assert.equal(f.store.read().assets.length,0);
 await rm(join(f.dir,'local-tts/kokoro.ready.json'));await f.store.update(s=>s.jobs[0].status='prepared');await f.client.claim('j');await f.client.run('j');assert.match(f.store.read().jobs[0].error,/Download/);
});
test('local validation rejects unsupported languages, missing transcripts and unknown voices',()=>{
 assert.throws(()=>validateLocal({kind:'voice',engine:'qwen3'},'en',''),/transcript/);
 assert.throws(()=>validateLocal({kind:'voice',engine:'qwen3'},'ml','hello'),/language/);
 assert.throws(()=>validateLocal({kind:'voice',engine:'kokoro',voice:'made-up'},'en',''),/preset/);
 assert.throws(()=>validateLocal({kind:'voice',engine:'qwen3-hq'},'en',''),/transcript/);
 assert.doesNotThrow(()=>validateLocal({kind:'voice',engine:'qwen3-hq'},'en','Exact words'));
});
test('quality Qwen3 passes the original reference and keeps its distinct model identity',async t=>{
 const f=await fixture(t,async(root,op,r)=>{assert.equal(r.engine,'qwen3-hq');assert.equal(r.reference,join(f.dir,'media','ref'));assert.equal(r.referenceText,'Exact words');await writeFile(r.output,wav());return {duration:1};});
 await f.store.update(s=>{s.assets=[{id:'ref',type:'audio/wav'}];Object.assign(s.jobs[0],{engine:'qwen3-hq',referenceText:'Exact words',inputs:{voice:'ref'}});});
 await f.client.claim('j');await f.client.run('j');assert.equal(f.store.read().jobs[0].status,'completed');assert.equal(f.store.read().jobs[0].engine,'qwen3-hq');
});
test('HTTP local preparation preserves provider and reference transcript; presets need no recording',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mytwin-local-api-'));const {server,store}=await createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const call=async(path,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
 await store.update(s=>{s.projects=[{id:'p',profileId:'t',language:'en',sections:[{id:'s',text:'Hello'}]}];s.profiles=[{id:'t',name:'Twin',voiceTranscript:'Original transcript'}];});
 const preset=await call('/jobs',{projectId:'p',sectionId:'s',kind:'voice',provider:'local',engine:'kokoro',voice:'af_heart',voiceMode:'preset'});assert.equal(preset.status,201);assert.equal(preset.data.provider,'local');assert.deepEqual(preset.data.speech,{speed:1,sentencePause:0,volume:1});
 await store.update(s=>s.settings.localSpeech={speed:1.25,sentencePause:.4,volume:.8});
 const adjusted=await call('/jobs',{projectId:'p',sectionId:'s',kind:'voice',provider:'local',engine:'kokoro',voice:'af_heart'});assert.equal(adjusted.status,201);assert.deepEqual(adjusted.data.speech,{speed:1.25,sentencePause:.4,volume:.8});
 await store.update(s=>s.settings.localSpeech.speed=1);assert.equal(store.read().jobs.find(j=>j.id===adjusted.data.id).speech.speed,1.25);
 const invalid=await call('/jobs',{projectId:'p',sectionId:'s',kind:'voice',provider:'local',engine:'kokoro',voice:'af_heart',speech:{speed:4}});assert.equal(invalid.status,400);
 const clone=await call('/jobs',{projectId:'p',sectionId:'s',kind:'voice',provider:'local',engine:'qwen3'});assert.equal(clone.status,400);
 await store.update(s=>s.profiles[0].voiceAssetId='ref');const result=await call('/jobs',{projectId:'p',sectionId:'s',kind:'voice',provider:'local',engine:'qwen3'});assert.equal(result.status,201);assert.equal(result.data.referenceText,'Original transcript');
});
test('twin preset choices persist without a recording and prepare a local preset take',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mytwin-twin-voice-'));const {server,store}=await createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const call=async(path,method,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(r.ok);return r.json();};
 let twin=await call('/profiles','POST',{name:'Preset twin',voiceProvider:'local',localEngine:'kokoro',localVoice:'af_heart'});
 assert.equal(twin.voiceAssetId,'');assert.equal(twin.voiceProvider,'local');assert.equal(twin.localVoice,'af_heart');
 twin=await call('/profiles/'+twin.id,'PUT',{...twin,localVoice:'bf_emma'});
 assert.equal(store.read().profiles.find(p=>p.id===twin.id).localVoice,'bf_emma');
 await store.update(s=>s.projects=[{id:'p',profileId:twin.id,language:'en',sections:[{id:'s',text:'Hello.'}]}]);
 const job=await call('/jobs','POST',{projectId:'p',sectionId:'s',kind:'voice',provider:twin.voiceProvider,engine:twin.localEngine,voice:twin.localVoice});
 assert.equal(job.provider,'local');assert.equal(job.engine,'kokoro');assert.equal(job.voice,'bf_emma');assert.equal(job.voiceMode,'preset');
});
