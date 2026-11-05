import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import {defaultPodcast,profileIdFor,matchesSpeaker,presetVoiceFor} from '../public/project-model.js';
import {ensurePodcastTracks} from '../public/podcast-tracks.js';
import {planTrackAudio,voiceSnapshot,planPodcastAudio} from '../public/podcast-audio.js';

function fixture(){
 const p={id:'p',projectType:'podcast',language:'en',podcast:defaultPodcast(),sections:[{id:'a',title:'Opening',speakerId:'host',text:'Hello.'},{id:'b',title:'Reply',speakerId:'guest',text:'Welcome.'},{id:'c',title:'Question',speakerId:'host',text:'How are you?'}]};
 p.podcast.speakers[0].profileId='alex';p.podcast.speakers[1].profileId='sam';ensurePodcastTracks(p);
 return {projects:[p],profiles:[{id:'alex',name:'Alex',voiceProvider:'local',localEngine:'kokoro',localVoice:'am_adam'},{id:'sam',name:'Sam',voiceProvider:'local',localEngine:'kokoro',localVoice:'af_heart'},{id:'new',name:'New voice',voiceProvider:'local',localEngine:'kokoro',localVoice:'bm_george'}],settings:{},jobs:[]};
}
test('track twin changes only clips on that track, including clips moved from another speaker',()=>{
 const state=fixture(),p=state.projects[0];p.tracks[0].profileId='new';p.podcast.speakers[0].voice='af_bella';
 const before=structuredClone(p.sections),plan=planTrackAudio(state,p,'speaker-host');
 assert.deepEqual(plan.map(e=>e.sectionId),['a','c']);assert.deepEqual(plan.map(e=>[e.snapshot.profileId,e.request.voice]),[['new','bm_george'],['new','bm_george']]);
 assert.equal(profileIdFor(p,p.sections[1]),'sam');assert.equal(presetVoiceFor(p,p.sections[0]),'');assert.deepEqual(p.sections,before);
 p.sections[1].trackId='speaker-host';assert.equal(profileIdFor(p,p.sections[1]),'new');assert.equal(voiceSnapshot(state,p,p.sections[1]).speakerId,'guest');
 assert.equal(planTrackAudio(state,p,'speaker-host').length,3);
});
test('track plans preserve matching takes and invalidate changed twins without affecting the other track',()=>{
 const state=fixture(),p=state.projects[0];state.jobs=p.sections.map(s=>({...voiceSnapshot(state,p,s),id:s.id,status:'completed',outputId:'audio-'+s.id}));
 assert.equal(planTrackAudio(state,p,'speaker-host').filter(e=>e.job).length,2);
 p.tracks[0].profileId='new';assert.ok(planTrackAudio(state,p,'speaker-host').every(e=>!e.job));
 assert.equal(planTrackAudio(state,p,'speaker-guest')[0].job.id,'b');assert.equal(matchesSpeaker(p,p.sections[0],state.jobs[0]),false);
 assert.equal(planPodcastAudio(state,p)[0].snapshot.profileId,'new');delete p.tracks[0].profileId;assert.equal(planTrackAudio(state,p,'speaker-host')[0].job.id,'a');
});
test('track generation skips empty and imported clips and validates only its own scripted clips',()=>{
 const state=fixture(),p=state.projects[0];p.sections[1].text='';p.podcast.speakers[1].profileId='';
 p.sections.push({id:'empty',title:'Empty',text:'',speakerId:'host',trackId:'speaker-host'},{id:'music',title:'Music',text:'',audioAssetId:'music',trackId:'speaker-host'});
 assert.equal(planTrackAudio(state,p,'speaker-host').length,2);assert.throws(()=>planTrackAudio(state,p,'speaker-guest'),/scripted clip/);
 assert.throws(()=>planTrackAudio(state,p,'missing'),/Choose an audio track/);
});
test('changing a track twin keeps split and duplicated source audio playable',()=>{
 const state=fixture(),p=state.projects[0],source={...voiceSnapshot(state,p,p.sections[0]),id:'source',status:'completed',outputId:'wav'};
 const split={...p.sections[0],id:'split',audioAssetId:'wav',sourceTakeId:'source',sourceSectionId:'a',trims:{wav:{start:1,end:3}},offset:7};p.sections.push(split);p.tracks[0].profileId='new';
 assert.equal(matchesSpeaker(p,split,source),true);assert.equal(planTrackAudio(state,p,'speaker-host').length,2);assert.deepEqual(split.trims,{wav:{start:1,end:3}});
});
test('storytelling tracks use independent twins and retain implicit first-track placement',()=>{
 const state=fixture(),p={id:'story',language:'en',profileId:'alex',tracks:[{id:'voice',name:'Voice',profileId:'new'},{id:'other',name:'Other',profileId:'sam'}],sections:[{id:'a',title:'First',text:'Hello.'},{id:'b',title:'Second',text:'Reply.',trackId:'other'}]};
 assert.equal(planTrackAudio(state,p,'voice')[0].snapshot.profileId,'new');assert.equal(planTrackAudio(state,p,'other')[0].snapshot.profileId,'sam');
 assert.equal(matchesSpeaker(p,p.sections[0],{profileId:'alex'}),false);assert.equal(matchesSpeaker(p,p.sections[0],{profileId:'new'}),true);
});
test('saved track twins survive backend restart and prepare the correct voice snapshots',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mytwin-track-audio-')),app=await createApp({dataDir:dir});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});});
 const state=fixture();await app.store.update(s=>{s.projects=state.projects;s.profiles=state.profiles;});const p=state.projects[0];p.tracks[0].profileId='new';p.podcast.speakers[0].voice='af_bella';
 const call=async(path,body)=>{const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`,{method:path.startsWith('/projects/')?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
 assert.equal((await call('/projects/p',p)).status,200);
 const request=planTrackAudio({...state,projects:[p]},p,'speaker-host')[0].request,prepared=await call('/jobs',request);
 assert.equal(prepared.status,201);assert.equal(prepared.data.profileId,'new');assert.equal(prepared.data.voice,'bm_george');assert.equal(prepared.data.speakerId,'host');
 const bad=structuredClone(p);bad.tracks[0].profileId='missing';assert.equal((await call('/projects/p',bad)).status,400);
 const restarted=await createApp({dataDir:dir});t.after(()=>restarted.server.emit('close'));assert.equal(restarted.store.read().projects[0].tracks[0].profileId,'new');
});
