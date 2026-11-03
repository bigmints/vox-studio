import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {createLocalTts,localCatalog,validateLocal} from '../lib/local-tts.mjs';
import {createApp} from '../server.mjs';

async function fixture(t,runner){
 const dir=await mkdtemp(join(tmpdir(),'mytwin-local-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'media'));await mkdir(join(dir,'local-tts/venv/bin'),{recursive:true});await writeFile(join(dir,'local-tts/venv/bin/python'),'test');
 for(const [key,m]of Object.entries(localCatalog))await writeFile(join(dir,'local-tts',key+'.ready.json'),JSON.stringify({revision:m.revision}));
 const store=await createStore(dir);await store.update(s=>s.jobs=[{id:'j',kind:'voice',provider:'local',status:'prepared',engine:'kokoro',voice:'af_heart',language:'en',text:'Hello',sectionTitle:'Opening'}]);
 return {dir,store,client:createLocalTts(store,dir,runner)};
}
function wav(){const b=Buffer.alloc(100);b.write('RIFF');b.writeUInt32LE(92,4);b.write('WAVE',8);return b;}
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
