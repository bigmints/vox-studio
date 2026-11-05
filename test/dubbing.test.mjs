import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createApp} from '../server.mjs';
import {createDubbing} from '../lib/dubbing.mjs';
import {defaultDubbing,normalizeDubbing,prepareDub,currentDubVoice,dubMatches,dubbingVoiceRequest} from '../public/dubbing-model.js';
import {voiceSnapshot} from '../public/podcast-audio.js';
import {prepareVideo,createVideo} from '../lib/video.mjs';
import {wavBytes} from '../public/voice-recorder.js';
const exec=promisify(execFile);

function stateFixture(){
 const p={id:'p',projectType:'dubbing',title:'My dub',profileId:'t',language:'en',sections:[{id:'s',title:'Narration',text:'Hello from my twin.'}],dubbing:{...defaultDubbing(),videoAssetId:'video'}};
 const s={projects:[p],profiles:[{id:'t',name:'My twin',voiceProvider:'local',localEngine:'qwen3',voiceAssetId:'reference',voiceTranscript:'Reference words'}],assets:[{id:'video',type:'video/mp4'},{id:'voice',type:'audio/wav'}],jobs:[],settings:{}};
 const j={...voiceSnapshot(s,p,p.sections[0]),id:'voice-job',status:'completed',outputId:'voice'};s.jobs.push(j);return {s,p,j};
}
test('dubbing uses a current cloned voice and invalidates changed input snapshots',()=>{
 const {s,p,j}=stateFixture();assert.equal(currentDubVoice(s,p),j);const dub=prepareDub(s,{projectId:p.id,voiceJobId:j.id});assert.ok(dubMatches(dub,p,j));
 for(const mutate of [s=>s.jobs[0].text='Old script',s=>s.jobs[0].profileId='other',s=>s.jobs[0].language='ar',s=>s.jobs[0].voiceMode='preset',s=>s.profiles[0].voiceAssetId='replacement',s=>s.jobs[0].status='failed',s=>s.assets=s.assets.filter(a=>a.id!=='voice')]){const fresh=stateFixture();mutate(fresh.s);assert.throws(()=>prepareDub(fresh.s,{projectId:'p',voiceJobId:'voice-job'}));}
 p.dubbing.start=1;assert.ok(!dubMatches(dub,p,j));p.sections[0].text='Updated';assert.equal(currentDubVoice(s,p),undefined);
 s.profiles[0].localEngine='kokoro';assert.throws(()=>dubbingVoiceRequest(s,p),/preset voice/);
});
test('validates source metadata and independent generated visual prompt',()=>{
 const {s,p}=stateFixture();assert.throws(()=>normalizeDubbing({start:NaN}));assert.throws(()=>normalizeDubbing({start:-1}));assert.throws(()=>normalizeDubbing({timing:'crop'}));assert.throws(()=>normalizeDubbing({videoAssetId:'voice'},s));
 p.sections[0].text='';p.dubbing.prompt='A forest at sunrise';s.settings.videoModels=[{id:'test/video',supported_durations:[5]}];const j=prepareVideo(s,{projectId:'p',sectionId:'s',engine:'test/video',video:{duration:5}});assert.equal(j.prompt,p.dubbing.prompt);assert.equal(j.text,'');assert.equal(j.video.generate_audio,false);
});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'mytwin-dub-test-')),app=await createApp({dataDir:dir});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.server.address().port}`;
 t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});});
 const call=async(path,method='GET',body)=>{const r=await fetch(base+'/api'+path,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 return {...app,dir,base,call};
}
test('dubbing projects persist both source modes, serve modules, and reject invalid saves',async t=>{
 const f=await fixture(t),p=(await f.call('/projects','POST',{projectType:'dubbing',title:'Upload and dub'})).data;
 assert.equal(p.projectType,'dubbing');assert.deepEqual(p.dubbing,defaultDubbing());
 p.dubbing={...p.dubbing,source:'generate',prompt:'A forest',start:.4,timing:'fit'};assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,200);
 const disk=JSON.parse(await readFile(join(f.dir,'studio.json'),'utf8'));assert.deepEqual(disk.projects[0].dubbing,p.dubbing);
 p.dubbing.videoAssetId='missing';assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,400);assert.equal(f.store.read().projects[0].dubbing.videoAssetId,'');
 for(const path of ['/dubbing.js','/dubbing-model.js'])assert.equal((await fetch(f.base+path)).status,200);
 assert.equal((await f.call('/dubbing/render','POST',{projectId:p.id,voiceJobId:'missing'})).status,400);
 await f.store.update(s=>s.jobs.push({id:'interrupted',projectId:p.id,kind:'dub',status:'running'}));
 const restarted=await createApp({dataDir:f.dir});t.after(()=>restarted.server.emit('close'));
 assert.equal(restarted.store.read().jobs[0].status,'failed');assert.match(restarted.store.read().jobs[0].error,/interrupted/);
});
async function waitRender(store,id){for(let i=0;i<900;i++){const j=store.read().jobs.find(j=>j.id===id);if(j.status!=='running')return j;await new Promise(r=>setTimeout(r,200));}throw Error('Render did not finish');}
test('real media: replace audio, preserve video length, fit voice, reject truncation, and extract transcript WAV',{skip:process.platform!=='darwin',timeout:240000},async t=>{
 const f=await fixture(t),{s,p}=stateFixture();await f.store.update(state=>Object.assign(state,s));
 const path=join(f.dir,'media','video');await exec('/usr/bin/swift',[new URL('./fixtures/make-video.swift',import.meta.url).pathname,path]);const original=await readFile(path);
 const tone=seconds=>wavBytes([Float32Array.from({length:16000*seconds},(_,i)=>.2*Math.sin(2*Math.PI*440*i/16000))],16000);
 await writeFile(join(f.dir,'media','voice'),tone(1));
 const processor=createDubbing(f.store,f.dir),info=await processor.inspect('video');assert.ok(Math.abs(info.duration-2)<.1);assert.equal(info.hasAudio,false);
 await assert.rejects(processor.extract('video'),/no audio/);
 await f.store.update(s=>s.projects[0].dubbing.start=.25);
 const first=await f.call('/dubbing/render','POST',{projectId:'p',voiceJobId:'voice-job'});assert.equal(first.status,202);
 assert.equal((await f.call('/dubbing/render','POST',{projectId:'p',voiceJobId:'voice-job'})).status,400);
 assert.equal((await f.call('/jobs/'+first.data.id+'/cancel','POST')).status,400);
 const result=await waitRender(f.store,first.data.id);assert.equal(result.status,'completed',result.error);
 const probe=await processor.inspect(result.outputId);assert.equal(probe.hasAudio,true);assert.ok(Math.abs(probe.duration-2)<.1);
 const audio=await processor.extract(result.outputId);assert.equal(audio.type,'audio/wav');const bytes=await readFile(join(f.dir,'media',audio.id));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.ok(bytes.length>30000);
 const download=await fetch(f.base+'/api/assets/'+result.outputId+'?download');assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'video/mp4');
 // Dub an already audible source: output still has exactly one replacement audio track.
 await f.store.update(s=>{s.projects[0].dubbing.videoAssetId=result.outputId;s.projects[0].dubbing.start=0;});await writeFile(join(f.dir,'media','voice'),tone(3));
 const tooLong=await processor.start({projectId:'p',voiceJobId:'voice-job'}),failed=await waitRender(f.store,tooLong.id);assert.equal(failed.status,'failed');assert.match(failed.error,/longer/);
 await f.store.update(s=>s.projects[0].dubbing.timing='fit');const fitted=await processor.start({projectId:'p',voiceJobId:'voice-job'}),fit=await waitRender(f.store,fitted.id);assert.equal(fit.status,'completed',fit.error);
 const fittedPath=join(f.dir,'fitted.mp4');await copyFile(join(f.dir,'media',fit.outputId),fittedPath);const {stdout}=await exec('/usr/bin/swift',[new URL('./fixtures/probe-video.swift',import.meta.url).pathname,fittedPath]);const [duration,tracks]=stdout.trim().split(',').map(Number);assert.ok(Math.abs(duration-2)<.1);assert.equal(tracks,1);
 assert.deepEqual(await readFile(path),original);
 // A generated clip enters the exact same renderer, without changing narration.
 await f.store.update(s=>{s.settings.videoModels=[{id:'test/video',supported_durations:[2]}];s.projects[0].dubbing={...defaultDubbing(),source:'generate',prompt:'A studio scene'};});
 const generated=prepareVideo(f.store.read(),{projectId:'p',sectionId:'s',engine:'test/video',video:{duration:2}});await f.store.update(s=>s.jobs.unshift(generated));
 let submitted;
 const client=createVideo(f.store,f.dir,()=> 'mock-key',async(url,options={})=>{
  if(options.method==='POST'){submitted=JSON.parse(options.body);return Response.json({id:'mock-remote'});}
  if(url.includes('/content'))return new Response(original,{headers:{'content-type':'video/mp4'}});
  return Response.json({status:'completed'});
 });
 await client.claim(generated.id);await client.run(generated.id,true);await client.run(generated.id);
 assert.equal(submitted.prompt,'A studio scene');assert.equal(submitted.generate_audio,false);
 const source=f.store.read().jobs.find(j=>j.id===generated.id);assert.equal(source.status,'completed');
 await f.store.update(s=>{s.projects[0].dubbing.videoAssetId=source.outputId;s.projects[0].dubbing.timing='fit';});
 const connected=await processor.start({projectId:'p',voiceJobId:'voice-job'}),connectedOutput=await waitRender(f.store,connected.id);
 assert.equal(connectedOutput.status,'completed',connectedOutput.error);assert.equal(connectedOutput.inputs.video,source.outputId);
});
