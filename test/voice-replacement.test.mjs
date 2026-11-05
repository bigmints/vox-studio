import test from 'node:test';
import assert from 'node:assert/strict';
import {selectedVoiceTake,timelineVoiceTake,voiceSnapshot,planTrackAudio,runPodcastAudio} from '../public/podcast-audio.js';
import {defaultPodcast} from '../public/project-model.js';
import {ensurePodcastTracks} from '../public/podcast-tracks.js';
import {restoreTimelineSections} from '../public/timeline-tools.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';

function fixture(){
 const p={id:'p',projectType:'podcast',language:'en',podcast:defaultPodcast(),sections:[{id:'a',title:'Opening',text:'Welcome.',speakerId:'host',offset:0},{id:'b',title:'Reply',text:'Thank you.',speakerId:'guest',offset:5},{id:'c',title:'Question',text:'How are you?',speakerId:'host',offset:10}]};
 p.podcast.speakers[0].profileId='old';p.podcast.speakers[1].profileId='guest';ensurePodcastTracks(p);
 const state={projects:[p],profiles:[{id:'old',voiceProvider:'local',localEngine:'kokoro',localVoice:'am_adam'},{id:'guest',voiceProvider:'local',localEngine:'kokoro',localVoice:'af_heart'},{id:'new',voiceProvider:'local',localEngine:'kokoro',localVoice:'bm_george'}],settings:{},jobs:[]};
 state.jobs=p.sections.map((s,i)=>({...voiceSnapshot(state,p,s),id:'old-'+s.id,status:'completed',outputId:'audio-'+s.id,approved:true,createdAt:new Date(1000+i).toISOString()}));return {p,state};
}
test('changing a shared twin or delivery settings does not clear any saved clip audio',()=>{
 const {p,state}=fixture(),before=p.sections.map(s=>selectedVoiceTake(state,p,s).id);
 p.podcast.speakers[0].profileId='new';state.settings.localSpeech={speed:1.2,volume:.8,sentencePause:.2};
 assert.deepEqual(p.sections.map(s=>selectedVoiceTake(state,p,s).id),before);
 assert.ok(planTrackAudio(state,p,'speaker-host').every(e=>!e.job));
});
test('regeneration replaces only its selected clip after successful completion',()=>{
 const {p,state}=fixture();p.podcast.speakers[0].profileId='new';
 const replacement={...voiceSnapshot(state,p,p.sections[0]),id:'replacement',status:'running',createdAt:new Date(2000).toISOString()};state.jobs.push(replacement);p.sections[0].voiceTakeId='old-a';p.sections[0].pendingVoiceTakeId=replacement.id;
 assert.deepEqual(p.sections.map(s=>selectedVoiceTake(state,p,s).id),['old-a','old-b','old-c']);
 replacement.status='failed';assert.equal(selectedVoiceTake(state,p,p.sections[0]).id,'old-a');
 replacement.status='completed';replacement.outputId='new-audio';assert.deepEqual(p.sections.map(s=>selectedVoiceTake(state,p,s).id),['replacement','old-b','old-c']);
 assert.deepEqual(p.sections.map(s=>s.offset),[0,5,10]);
});
test('explicit take selection survives unrelated settings, approvals and timeline undo',()=>{
 const {p,state}=fixture();p.sections[0].voiceTakeId='old-a';const snapshot=structuredClone(p.sections);
 state.jobs.push({...state.jobs[0],id:'other',createdAt:new Date(3000).toISOString()});
 assert.equal(selectedVoiceTake(state,p,p.sections[0]).id,'old-a');p.sections[0].voiceTakeId='other';p.sections[0].offset=8;
 p.sections=restoreTimelineSections(snapshot,p.sections);assert.equal(p.sections[0].voiceTakeId,'other');assert.equal(p.sections[0].offset,0);
 assert.equal(selectedVoiceTake(state,p,p.sections[0]).id,'other');
});
test('a failed regeneration retains the exact previously selected take, even with an older approved take',()=>{
 const {p,state}=fixture(),chosen={...state.jobs[0],id:'chosen',approved:false,outputId:'chosen-audio',createdAt:new Date(3000).toISOString()};state.jobs.push(chosen);
 p.sections[0].voiceTakeId=chosen.id;p.sections[0].pendingVoiceTakeId='failed';state.jobs.push({...chosen,id:'failed',status:'failed',outputId:undefined});
 assert.equal(selectedVoiceTake(state,p,p.sections[0]).id,'chosen');
});
test('old dialogue, reassigned speakers and failed outputs cannot become the selected take',()=>{
 const {p,state}=fixture();p.sections[0].text='Different words.';assert.equal(selectedVoiceTake(state,p,p.sections[0]),undefined);
 p.sections[0].text='Welcome.';p.sections[0].speakerId='guest';assert.equal(selectedVoiceTake(state,p,p.sections[0]),undefined);
});
test('imported and split source audio stay playable after twin changes',()=>{
 const {p,state}=fixture();p.podcast.speakers[0].profileId='new';
 const split={...p.sections[0],id:'split',audioAssetId:'source-audio',sourceTakeId:'old-a',trims:{'source-audio':{start:1,end:3}}};
 assert.deepEqual(timelineVoiceTake(state,p,split),{id:'old-a',outputId:'source-audio'});
 assert.deepEqual(timelineVoiceTake(state,p,{id:'music',audioAssetId:'music'}),{id:'import:music',outputId:'music'});
});
test('track generation waits for saved selection and updates only planned clips',async()=>{
 const {p,state}=fixture();p.tracks[0].profileId='new';const plan=planTrackAudio(state,p,'speaker-host');
 await runPodcastAudio({plan,prepare:async request=>{const sec=p.sections.find(s=>s.id===request.sectionId),job={...voiceSnapshot(state,p,sec,request),id:'new-'+sec.id,status:'prepared'};state.jobs.push(job);return job;},
 onProgress:async({entry,job})=>{await Promise.resolve();p.sections.find(s=>s.id===entry.sectionId).voiceTakeId=job.id;},
 submit:async id=>{const job=state.jobs.find(j=>j.id===id);assert.equal(p.sections.find(s=>s.id===job.sectionId).voiceTakeId,id);job.status='running';},
 poll:async id=>{const job=state.jobs.find(j=>j.id===id);Object.assign(job,{status:'completed',outputId:'output-'+id});return job;}});
 assert.deepEqual(p.sections.map(s=>selectedVoiceTake(state,p,s).id),['new-a','old-b','new-c']);
});
test('replacement selection and manual take choices persist without altering other clips',async t=>{
 const {p,state}=fixture(),dir=await mkdtemp(join(tmpdir(),'mytwin-voice-selection-')),app=await createApp({dataDir:dir});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});});
 await app.store.update(s=>{s.projects=[p];s.profiles=state.profiles;s.jobs=state.jobs;});
 const call=async(path,body,method='POST')=>{const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.ok(response.ok,await response.clone().text());return response.json();};
 p.tracks[0].profileId='new';await call('/projects/p',p,'PUT');const job=await call('/jobs',planTrackAudio(state,p,'speaker-host')[0].request);
 p.sections[0].voiceTakeId='old-a';p.sections[0].pendingVoiceTakeId=job.id;await call('/projects/p',p,'PUT');
 assert.deepEqual(app.store.read().projects[0].sections.map(s=>selectedVoiceTake(app.store.read(),app.store.read().projects[0],s)?.id),['old-a','old-b','old-c']);
 await app.store.update(s=>Object.assign(s.jobs.find(j=>j.id===job.id),{status:'completed',outputId:'replacement-audio'}));
 assert.deepEqual(app.store.read().projects[0].sections.map(s=>selectedVoiceTake(app.store.read(),app.store.read().projects[0],s)?.id),[job.id,'old-b','old-c']);
 await call('/jobs/old-a/approve',{});assert.equal(app.store.read().projects[0].sections[0].voiceTakeId,'old-a');
 const restarted=await createApp({dataDir:dir});t.after(()=>restarted.server.emit('close'));const saved=restarted.store.read();
 assert.deepEqual(saved.projects[0].sections.map(s=>selectedVoiceTake(saved,saved.projects[0],s)?.id),['old-a','old-b','old-c']);
 assert.deepEqual(saved.projects[0].sections.map(s=>s.offset),[0,5,10]);
});
