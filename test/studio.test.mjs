import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';

async function fixture(t,fetcher){const dir=await mkdtemp(join(tmpdir(),'mytwin-test-'));const app=await createApp({dataDir:dir,fetcher});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});});
 const call=async(path,method='GET',body)=>{const res=await fetch(base+'/api'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};};
 const upload=async(type,name)=>{const r=await fetch(base+'/api/assets',{method:'POST',headers:{'Content-Type':type,'X-Filename':name},body:Buffer.from('test media')});return r.json();};return {...app,base,dir,call,upload};}
async function prepare(f){const p=(await f.call('/projects','POST',{title:'First episode'})).data;p.sections[0].text='Hello from my twin.';const voice=await f.upload('audio/wav','reference.wav'),avatar=await f.upload('image/png','portrait.png');const profile=(await f.call('/profiles','POST',{name:'My voice',voiceAssetId:voice.id,avatarAssetId:avatar.id})).data;p.profileId=profile.id;await f.call('/projects/'+p.id,'PUT',p);return p;}

test('projects and uploaded references persist; prepared jobs stay offline',async t=>{const f=await fixture(t);const p=await prepare(f);const job=(await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'voice',engine:'chatterbox'})).data;assert.equal(job.status,'prepared');await f.orchestrator.run(job.id);assert.equal(f.store.read().jobs[0].status,'waiting');const disk=JSON.parse(await readFile(join(f.dir,'studio.json'),'utf8'));assert.equal(disk.projects[0].sections[0].text,p.sections[0].text);assert.equal(disk.profiles.length,1);const second=await createApp({dataDir:f.dir});assert.equal(second.store.read().jobs[0].id,job.id);second.server.emit('close');});
test('worker handoff uploads inputs once, polls and retrieves output, then validates approved voice',async t=>{const calls=[];let polls=0;const fetcher=async(url,opt={})=>{calls.push([url,opt]);const path=new URL(url).pathname;if(path==='/v1/capabilities')return Response.json({apiVersion:1,engines:[{id:'chatterbox',kind:'voice',ready:true}]});if(path==='/v1/assets')return Response.json({id:'remote-ref'});if(path==='/v1/jobs')return Response.json({id:'remote-job'});if(path==='/v1/jobs/remote-job')return Response.json(++polls===1?{status:'running',stage:'Generating speech'}:{status:'completed',output:{id:'out',type:'audio/wav',name:'take.wav'}});if(path==='/v1/artifacts/out')return new Response('wave bytes');throw Error('Unexpected request');};const f=await fixture(t,fetcher),p=await prepare(f);await f.call('/settings','PUT',{workerUrl:'http://gx10.local:8000',workerToken:'test-token',model:'test/model'});const job=(await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'voice',engine:'chatterbox'})).data;await f.orchestrator.run(job.id);assert.equal(f.store.read().jobs[0].status,'running');await f.orchestrator.run(job.id);assert.equal(f.store.read().jobs[0].status,'completed');assert.equal(calls.filter(([u])=>u.endsWith('/v1/assets')).length,1);assert.equal(calls.find(([u])=>u.endsWith('/v1/jobs'))[1].headers['Idempotency-Key'],job.id);assert.equal(calls[0][1].headers.Authorization,'Bearer test-token');assert.equal((await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'avatar',engine:'infinitetalk',sourceJobId:job.id})).status,400);await f.call('/jobs/'+job.id+'/approve','POST');const fast=(await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'avatar',engine:'infinitetalk',sourceJobId:job.id}));assert.equal(fast.status,201);assert.equal(fast.data.preset,'lightx2v-4');const baseline=await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'avatar',engine:'infinitetalk',preset:'baseline',sourceJobId:job.id});assert.equal(baseline.data.preset,'baseline');assert.equal((await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'avatar',engine:'infinitetalk',preset:'unknown',sourceJobId:job.id})).status,400);p.sections[0].text='Changed script';await f.call('/projects/'+p.id,'PUT',p);assert.equal((await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'avatar',engine:'infinitetalk',sourceJobId:job.id})).status,400);});
test('OpenRouter keys stay out of browser state and exact model is used',async t=>{let sent;const f=await fixture(t,async(url,options)=>{assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');sent=JSON.parse(options.body);return Response.json({choices:[{message:{content:'A polished script.'}}]});});await f.call('/settings','PUT',{openrouterKey:'secret-test-value',model:'provider/my-model',workerUrl:''});const state=(await f.call('/state')).data;assert.equal(state.settings.openrouterConfigured,true);assert.ok(!JSON.stringify(state).includes('secret-test-value'));const result=await f.call('/write','POST',{action:'polish',text:'My rough notes.'});assert.equal(result.data.text,'A polished script.');assert.equal(sent.model,'provider/my-model');assert.equal(sent.messages[1].content,'My rough notes.');});
test('host/origin checks, missing setup and media range support',async t=>{const f=await fixture(t);const bad=await fetch(f.base+'/api/projects',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,403);const voice=await f.upload('audio/wav','voice.wav');const ranged=await fetch(f.base+'/api/assets/'+voice.id,{headers:{Range:'bytes=0-3'}});assert.equal(ranged.status,206);assert.equal(await ranged.text(),'test');assert.equal((await f.call('/write','POST',{action:'polish',text:'Hello'})).status,422);assert.equal((await f.call('/jobs','POST',{kind:'voice'})).status,400);});
test('cancel before submission and reject worker replacement on remote jobs',async t=>{const f=await fixture(t),p=await prepare(f);const j=(await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'voice',engine:'chatterbox'})).data;await f.orchestrator.cancel(j.id);assert.equal(f.store.read().jobs[0].status,'cancelled');await f.store.update(s=>{s.settings.workerUrl='http://new-worker';Object.assign(s.jobs[0],{status:'running',remoteId:'r',workerUrl:'http://old-worker'});});await f.orchestrator.run(j.id);assert.match(f.store.read().jobs[0].error,/different worker/);});

test('partial model settings preserve other selections, worker connection and secrets',async t=>{const f=await fixture(t);await f.call('/settings','PUT',{model:'writing/model',speechModel:'speech/model',listeningModel:'audio/model',workerUrl:'http://gx10.local:8000',openrouterKey:'private-key'});await f.store.update(s=>s.settings.workerStatus='connected');await f.call('/settings','PUT',{voice:'alice'});const s=(await f.call('/state')).data;assert.equal(s.settings.model,'writing/model');assert.equal(s.settings.speechModel,'speech/model');assert.equal(s.settings.listeningModel,'audio/model');assert.equal(s.settings.workerUrl,'http://gx10.local:8000');assert.equal(s.settings.workerStatus,'connected');assert.equal(s.settings.openrouterConfigured,true);assert.ok(!JSON.stringify(s).includes('private-key'));});

test('editing a twin preserves identity and existing take references',async t=>{const f=await fixture(t),p=await prepare(f);const twin=f.store.read().profiles[0];const original=twin.voiceAssetId;const job=(await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[0].id,kind:'voice',engine:'chatterbox'})).data;const replacement=await f.upload('audio/wav','new.wav');const result=await f.call('/profiles/'+twin.id,'PUT',{...twin,name:'Updated twin',notes:'New notes',voiceAssetId:replacement.id});assert.equal(result.status,200);assert.equal(result.data.id,twin.id);assert.equal(f.store.read().profiles.length,1);assert.equal(f.store.read().projects[0].profileId,twin.id);assert.equal(f.store.read().jobs[0].inputs.voice,original);assert.equal(f.store.read().jobs[0].id,job.id);assert.equal(result.data.avatarAssetId,twin.avatarAssetId);assert.equal((await f.call('/profiles/'+twin.id,'PUT',{...twin,voiceAssetId:twin.avatarAssetId})).status,400);assert.equal(f.store.read().profiles[0].voiceAssetId,replacement.id);});

test('timeline trims and order persist, invalid ranges leave saved edits intact',async t=>{const f=await fixture(t),p=await prepare(f);p.sections[0].trims={take:{start:1.2,end:8.4}};p.sections.unshift({id:'second',title:'First now',text:'Intro'});assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,200);const disk=JSON.parse(await readFile(join(f.dir,'studio.json'),'utf8'));assert.equal(disk.projects[0].sections[0].id,'second');assert.deepEqual(disk.projects[0].sections[1].trims.take,{start:1.2,end:8.4});p.sections[1].trims.take.end=0;assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,400);assert.equal(f.store.read().projects[0].sections[1].trims.take.end,8.4);});

test('audio track placement and mix controls persist and validate',async t=>{const f=await fixture(t),p=await prepare(f);p.tracks=[{id:'voice',name:'Voice',volume:.7,muted:false},{id:'music',name:'Music',volume:.3,muted:true}];p.sections[0].trackId='music';p.sections[0].offset=2.5;assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,200);const disk=JSON.parse(await readFile(join(f.dir,'studio.json'),'utf8'));assert.deepEqual(disk.projects[0].tracks,p.tracks);assert.equal(disk.projects[0].sections[0].offset,2.5);assert.equal(disk.projects[0].sections[0].trackId,'music');p.sections[0].offset=-1;assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,400);p.sections[0].offset=0;p.tracks[0].volume=2;assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,400);});

test('music sources, split references, and preview preferences survive saving and restart',async t=>{
 const f=await fixture(t),p=await prepare(f),music=await f.upload('audio/wav','music.wav');
 p.tracks=[{id:'voice',name:'Voice',volume:1,muted:false},{id:'music',name:'Music',kind:'music',volume:.35,muted:false}];
 p.previewRatio='9:16';p.previewFit='cover';
 p.sections.push({id:'music-section',title:'Music',text:'',audioAssetId:music.id,trackId:'music',offset:1,trims:{[music.id]:{start:2,end:5}}});
 p.sections.push({id:'split',title:'Split',text:'Hello',audioAssetId:music.id,sourceSectionId:p.sections[0].id,sourceTakeId:'voice-take',offset:4});
 assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,200);
 const restarted=await createApp({dataDir:f.dir});t.after(()=>restarted.server.emit('close'));
 const saved=restarted.store.read().projects[0];assert.equal(saved.previewRatio,'9:16');assert.equal(saved.previewFit,'cover');
 assert.equal(saved.tracks[1].kind,'music');assert.equal(saved.sections[1].audioAssetId,music.id);
 assert.deepEqual(saved.sections[1].trims,p.sections[1].trims);assert.equal(saved.sections[2].sourceTakeId,'voice-take');
});

test('browser settings and spending modules are served as JavaScript', async t => {
  const f = await fixture(t);
  for(const name of ['settings.js','spending.js','spending-model.js','page-gallery.js','twin-editor.js','twin-models.js']){
    const response = await fetch(f.base + '/' + name);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.equal(await response.text(), await readFile(new URL('../public/'+name, import.meta.url), 'utf8'));
  }
});

test('VoiceStudio URL persists, checks the chosen server, and rejects invalid edits before changing keys', async t => {
  const calls=[];
  const f=await fixture(t,async(url,options)=>{calls.push({url,token:options.headers.Authorization});return Response.json({ok:true});});
  assert.equal((await f.call('/settings','PUT',{voicestudioUrl:'http://localhost:9555/voice/',voicestudioKey:'test-voice-key'})).status,200);
  assert.equal((await f.call('/voicestudio/check','POST')).status,200);
  assert.deepEqual(calls.pop(),{url:'http://localhost:9555/voice/health',token:'Bearer test-voice-key'});
  assert.equal((await f.call('/settings','PUT',{voicestudioUrl:'file:///bad',voicestudioKey:'bad-replacement'})).status,400);
  assert.equal((await f.call('/state')).data.settings.voicestudioUrl,'http://localhost:9555/voice');
  await f.call('/settings','PUT',{voicestudioUrl:'https://voice.example/base'});
  await f.call('/voicestudio/check','POST');
  assert.deepEqual(calls.pop(),{url:'https://voice.example/base/health',token:'Bearer test-voice-key'});
  const disk=JSON.parse(await readFile(join(f.dir,'studio.json'),'utf8'));
  assert.equal(disk.settings.voicestudioUrl,'https://voice.example/base');
  assert.ok(!JSON.stringify(disk).includes('test-voice-key'));
  await f.call('/settings','PUT',{voicestudioUrl:'',voicestudioKey:''});
  const state=(await f.call('/state')).data;
  assert.equal(state.settings.voicestudioUrl,'');assert.equal(state.settings.voicestudioConfigured,false);
});
test('legacy VoiceStudio credentials retain their old endpoint on upgrade', async t => {
  const f=await fixture(t);await f.call('/settings','PUT',{voicestudioKey:'legacy-test-key'});
  const reopened=await createApp({dataDir:f.dir});
  t.after(()=>reopened.server.emit('close'));
  assert.equal(reopened.store.read().settings.voicestudioUrl,'https://gx10-54fa.tail5903e7.ts.net:9444');
});
