import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {defaultPodcast,parsePodcastScript,isPodcast,matchesSpeaker,projectSection} from '../public/project-model.js';
import {prepareVideo} from '../lib/video.mjs';
import {linkedVideo} from '../public/timeline-model.js';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'mytwin-podcast-')),app=await createApp({dataDir:dir});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});});
  const call=async(path,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
  return {...app,dir,call};
}
test('concurrent episode preparation reuses identical snapshots; changed voices create a new take',async t=>{
 const f=await fixture(t),p=(await f.call('/projects','POST',{projectType:'podcast'})).data;
 await f.store.update(s=>{s.profiles=[{id:'a',name:'Host',voiceProvider:'local',localEngine:'kokoro'}];});
 p.podcast.speakers[0].profileId='a';p.podcast.speakers[0].voice='af_heart';p.sections[0].text='Welcome.';await f.call('/projects/'+p.id,'PUT',p);
 const request={projectId:p.id,sectionId:p.sections[0].id,kind:'voice',provider:'local',engine:'kokoro',voice:'am_adam',voiceMode:'preset',reuseCurrent:true};
 const results=await Promise.all([f.call('/jobs','POST',request),f.call('/jobs','POST',request)]);
 results.forEach(r=>assert.equal(r.status,201));assert.equal(results[0].data.id,results[1].data.id);assert.equal(f.store.read().jobs.length,1);assert.equal(results[0].data.voice,'af_heart');
 p.podcast.speakers[0].voice='bm_george';await f.call('/projects/'+p.id,'PUT',p);
 const next=await f.call('/jobs','POST',request);assert.equal(next.status,201);assert.notEqual(next.data.id,results[0].data.id);assert.equal(next.data.voice,'bm_george');
});
test('browser serves every Podcast audio module dependency',async t=>{
 const f=await fixture(t);
 for(const path of ['/app.js','/podcast-audio.js','/podcast-tracks.js','/podcast-markdown.js','/audio-pacing.js','/project-model.js','/gx10-presets.js','/audio-timeline.js','/audio-cache.js','/timeline-export.js']){
  const response=await fetch(`http://127.0.0.1:${f.server.address().port}${path}`);assert.equal(response.status,200,path);assert.match(response.headers.get('content-type'),/javascript/);
 }
});
test('speaker tracks and extra guests persist with independent mix settings',async t=>{
 const f=await fixture(t),podcast=defaultPodcast();podcast.speakers.push({id:'guest-2',name:'Second guest',profileId:'',voice:''});
 const result=await f.call('/projects','POST',{projectType:'podcast',podcast});assert.equal(result.status,201);const p=result.data;
 assert.deepEqual(p.sections.map(s=>s.trackId),['speaker-host','speaker-guest','speaker-guest-2']);
 p.tracks[0].volume=.8;p.tracks[1].muted=true;assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,200);
 const restarted=await createApp({dataDir:f.dir});t.after(()=>restarted.server.emit('close'));const saved=restarted.store.read().projects[0];
 assert.equal(saved.tracks[0].kind,'speaker');assert.equal(saved.tracks[1].speakerId,'guest');assert.equal(saved.tracks[1].muted,true);assert.equal(saved.tracks[0].volume,.8);assert.equal(saved.podcast.speakers.length,3);
});
test('new project types persist; legacy projects retain the storytelling workflow',async t=>{
  const f=await fixture(t);
  const story=(await f.call('/projects','POST',{title:'My story'})).data;
  assert.equal(story.projectType,'storytelling');assert.equal(story.sections.length,1);assert.equal(isPodcast({}),false);
  const result=await f.call('/projects','POST',{title:'My podcast',projectType:'podcast'});assert.equal(result.status,201);
  const p=result.data;assert.equal(p.podcast.speakers.length,2);assert.deepEqual(p.sections.map(s=>s.speakerId),['host','guest']);
  const restarted=await createApp({dataDir:f.dir});t.after(()=>restarted.server.emit('close'));
  assert.equal(restarted.store.read().projects[0].projectType,'podcast');
  assert.equal((await f.call('/projects','POST',{projectType:'unknown'})).status,400);
  story.projectType='podcast';story.podcast=defaultPodcast();story.sections[0].speakerId='host';
  assert.equal((await f.call('/projects/'+story.id,'PUT',story)).status,400);
});
test('dialogue import preserves speaker order, multiline dialogue and rejects unknown speakers',()=>{
  const speakers=[{id:'host',name:'Alex'},{id:'guest',name:'Sam'}];
  assert.deepEqual(parsePodcastScript('Alex: Welcome.\r\nA second line.\r\n\r\nGuest: Thank you.\nSpeaker 1: Let’s begin.',speakers),[
    {speakerId:'host',text:'Welcome.\nA second line.'},{speakerId:'guest',text:'Thank you.'},{speakerId:'host',text:'Let’s begin.'}
  ]);
  for(const text of ['', 'Unlabeled opening', 'Narrator: Hello.', 'Alex:\nSam: Hi.']) assert.throws(()=>parsePodcastScript(text,speakers));
  assert.throws(()=>parsePodcastScript(Array.from({length:101},()=> 'Alex: Hi.').join('\n'),speakers),/100/);
});
test('each podcast turn snapshots its assigned voice and avatar; reassignment invalidates old takes',async t=>{
  const f=await fixture(t),p=(await f.call('/projects','POST',{title:'Interview',projectType:'podcast'})).data;
  await f.store.update(s=>{
    s.assets=[{id:'audio-a',type:'audio/wav'},{id:'audio-b',type:'audio/wav'},{id:'photo-a',type:'image/png'},{id:'photo-b',type:'image/png'}];
    s.profiles=[{id:'a',name:'Alex',voiceAssetId:'audio-a',avatarAssetId:'photo-a'},{id:'b',name:'Sam',voiceAssetId:'audio-b',avatarAssetId:'photo-b'}];
  });
  p.profileId='a'; // A legacy global profile must never replace the guest.
  p.podcast.speakers[0].profileId='a';p.podcast.speakers[1].profileId='b';
  p.sections[0].text='Hello.';p.sections[1].text='Hello.';
  assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,200);
  const jobs=[];
  for(const sec of p.sections){const r=await f.call('/jobs','POST',{projectId:p.id,sectionId:sec.id,kind:'voice',engine:'chatterbox'});assert.equal(r.status,201);jobs.push(r.data);}
  assert.deepEqual(jobs.map(j=>j.inputs.voice),['audio-a','audio-b']);assert.deepEqual(jobs.map(j=>j.profileId),['a','b']);
  await f.store.update(s=>{for(const j of s.jobs)Object.assign(j,{status:'completed',approved:true,outputId:'generated-audio'});});
  const avatar=await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[1].id,kind:'avatar',engine:'infinitetalk',sourceJobId:jobs[1].id});
  assert.equal(avatar.status,201);assert.equal(avatar.data.inputs.avatar,'photo-b');
  p.sections[1].speakerId='host';assert.equal((await f.call('/projects/'+p.id,'PUT',p)).status,200);
  assert.equal(matchesSpeaker(p,p.sections[1],jobs[1]),false);
  assert.equal((await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[1].id,kind:'avatar',engine:'infinitetalk',sourceJobId:jobs[1].id})).status,400);
  p.sections[1].speakerId='guest';p.podcast.speakers[1].profileId='';await f.call('/projects/'+p.id,'PUT',p);
  assert.equal((await f.call('/jobs','POST',{projectId:p.id,sectionId:p.sections[1].id,kind:'voice',engine:'chatterbox'})).status,400);
});
test('podcast cast, scene and turn validation protect saved data',async t=>{
  const f=await fixture(t),p=(await f.call('/projects','POST',{projectType:'podcast'})).data;
  for(const mutate of [p=>p.podcast.speakers.pop(),p=>p.podcast.speakers[1].name='Host',p=>p.podcast.speakers[0].profileId='missing',p=>p.sections[0].speakerId='missing',p=>p.podcast.sceneImageId='missing']){
    const bad=structuredClone(p);mutate(bad);assert.equal((await f.call('/projects/'+p.id,'PUT',bad)).status,400);
  }
  assert.deepEqual(f.store.read().projects[0],p);
});
test('podcast scene videos use the shared set, correct character and current voice; scene changes invalidate links',()=>{
  const p={id:'p',projectType:'podcast',podcast:defaultPodcast(),sections:[{id:'s',speakerId:'guest',text:'Thanks for having me.',scenePrompt:'Medium shot.'}]};
  p.podcast.speakers[1].profileId='sam';p.podcast.sceneImageId='studio';
  const take={id:'voice',projectId:'p',sectionId:'s',speakerId:'guest',profileId:'sam',kind:'voice',status:'completed',text:p.sections[0].text};
  const s={projects:[p],profiles:[{id:'sam',name:'Sam',avatarAssetId:'portrait'}],assets:[{id:'studio',type:'image/png',size:100}],jobs:[take],settings:{videoModels:[{id:'video',supported_durations:[5],supported_frame_images:['first_frame']} ]}};
  const b={projectId:'p',sectionId:'s',scene:true,engine:'video',sourceJobId:'voice',video:{duration:5}};
  const job=prepareVideo(s,b);assert.equal(job.inputs.avatar,'studio');assert.equal(job.speakerId,'guest');assert.equal(job.profileId,'sam');
  assert.match(job.prompt,/Guest is speaking\. Host listens/);assert.match(job.prompt,/Medium shot/);
  Object.assign(job,{status:'completed',outputId:'video'});
  assert.equal(linkedVideo({sec:projectSection(p,p.sections[0]),take},[job]),job);
  p.podcast.scenePrompt='A different studio.';
  assert.equal(linkedVideo({sec:projectSection(p,p.sections[0]),take},[job]),undefined);
  p.sections[0].speakerId='host';assert.throws(()=>prepareVideo(s,b),/voiceover/);
});
test('preset voice selection is per character and saved with its voice job',async t=>{
  const f=await fixture(t),p=(await f.call('/projects','POST',{projectType:'podcast'})).data;
  await f.store.update(s=>{s.profiles=[{id:'a',name:'Alex'},{id:'b',name:'Sam'}];});
  p.podcast.speakers.forEach((s,i)=>{s.profileId=i?'b':'a';s.voice=i?'nova':'alloy';});
  p.sections.forEach(s=>s.text='Hello.');await f.call('/projects/'+p.id,'PUT',p);
  for(const [i,sec] of p.sections.entries()){
    const j=(await f.call('/jobs','POST',{projectId:p.id,sectionId:sec.id,kind:'voice',provider:'openrouter',engine:'test/speech',voiceMode:'preset',voice:'wrong-global-voice'})).data;
    assert.equal(j.voice,i?'nova':'alloy');assert.equal(matchesSpeaker(p,sec,j),true);
  }
});
