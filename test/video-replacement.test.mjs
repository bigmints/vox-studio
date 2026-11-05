import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {linkedVideo,arrangeAudio,videoAtTime} from '../public/timeline-model.js';
import {videoTakeBelongsToClip} from '../public/video-takes.js';
import {restoreTimelineSections} from '../public/timeline-tools.js';
import {createApp} from '../server.mjs';

function fixture(){
 const sec={id:'s',title:'Opening',text:'Hello.',voiceTakeId:'voice-now',offset:4,trims:{audio:{start:1,end:5}},sceneImageId:'new-photo',scenePrompt:'New direction',videoTakeId:'older'};
 const p={id:'p',title:'Video takes',profileId:'t',mode:'voice',language:'en',sections:[sec]};
 const older={id:'older',kind:'avatar',projectId:'p',sectionId:'s',sourceJobId:'voice-before',status:'completed',outputId:'old-video',sceneImageId:'old-photo',scenePrompt:'Old direction',createdAt:'2020-01-01'};
 const newer={...older,id:'newer',kind:'video',sourceJobId:'voice-now',outputId:'new-video',sceneImageId:sec.sceneImageId,scenePrompt:sec.scenePrompt,createdAt:'2025-01-01'};
 return {p,sec,clip:{sec,take:{id:'voice-now',outputId:'audio'},duration:6},jobs:[older,newer]};
}
test('an explicit earlier visual survives different scene and voice settings without altering audio or timing',()=>{
 const {p,sec,clip,jobs}=fixture(),before=structuredClone(sec);
 assert.ok(videoTakeBelongsToClip(jobs[0],p,sec));assert.equal(linkedVideo(clip,jobs).id,'older');
 const placed=arrangeAudio([clip]).clips;assert.equal(videoAtTime(placed,jobs,4).job.outputId,'old-video');
 assert.equal(placed[0].take.id,'voice-now');assert.equal(placed[0].start,4);assert.equal(placed[0].range.start,1);assert.deepEqual(sec,before);
 jobs.push({...jobs[1],id:'latest',createdAt:'2026-01-01'});assert.equal(linkedVideo(clip,jobs).id,'older');
});
test('video regeneration keeps the selected output until success and manual swaps override pending work',()=>{
 const {clip,jobs}=fixture();clip.sec.pendingVideoTakeId='replacement';const replacement={...jobs[1],id:'replacement',status:'running',outputId:null};jobs.push(replacement);
 assert.equal(linkedVideo(clip,jobs).id,'older');replacement.status='failed';assert.equal(linkedVideo(clip,jobs).id,'older');
 Object.assign(replacement,{status:'completed',outputId:'replacement-video'});assert.equal(linkedVideo(clip,jobs).id,'replacement');
 delete clip.sec.pendingVideoTakeId;assert.equal(linkedVideo(clip,jobs).id,'older');
});
test('failed, foreign, missing and child renders cannot become selected video takes',()=>{
 const {p,clip,jobs}=fixture();
 for(const bad of [{...jobs[0],status:'failed'},{...jobs[0],outputId:''},{...jobs[0],sectionId:'other'},{...jobs[0],parentVideoId:'parent'},{...jobs[0],kind:'voice'}]){
  assert.equal(videoTakeBelongsToClip(bad,p,clip.sec),false);assert.notEqual(linkedVideo(clip,[bad,jobs[1]])?.id,'older');
 }
 assert.equal(videoTakeBelongsToClip({...jobs[0],projectId:'other'},p,clip.sec),false);
});
test('split clips inherit a visual selection and timeline undo preserves later take choices',()=>{
 const {p,clip,jobs}=fixture(),split={...clip.sec,id:'split',sourceSectionId:'s',sourceTakeId:'voice-now',audioAssetId:'audio'};
 assert.ok(videoTakeBelongsToClip(jobs[0],p,split));assert.equal(linkedVideo({...clip,sec:split},jobs).id,'older');
 const saved=[structuredClone(clip.sec)];clip.sec.videoTakeId='newer';clip.sec.offset=9;
 const restored=restoreTimelineSections(saved,[clip.sec]);assert.equal(restored[0].videoTakeId,'newer');assert.equal(restored[0].offset,4);
});
test('a swapped video persists after reopening without changing narration or take records',async t=>{
 const f=fixture(),dir=await mkdtemp(join(tmpdir(),'mytwin-video-swap-')),app=await createApp({dataDir:dir});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await rm(dir,{recursive:true,force:true});});
 await app.store.update(s=>{s.projects=[f.p];s.profiles=[{id:'t',name:'Twin'}];s.jobs=f.jobs;});
 const before=structuredClone(app.store.read().jobs);f.sec.videoTakeId='newer';
 const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api/projects/p`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(f.p)});assert.ok(response.ok,await response.text());
 const reopened=await createApp({dataDir:dir});t.after(()=>reopened.server.emit('close'));const state=reopened.store.read(),sec=state.projects[0].sections[0];
 assert.equal(sec.videoTakeId,'newer');assert.equal(sec.voiceTakeId,'voice-now');assert.equal(sec.offset,4);assert.deepEqual(sec.trims,f.sec.trims);assert.deepEqual(state.jobs,before);
 assert.equal(linkedVideo({...f.clip,sec},state.jobs).id,'newer');
});
