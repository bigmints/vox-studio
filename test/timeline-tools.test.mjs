import test from 'node:test';
import assert from 'node:assert/strict';
import {rulerStep,fitScale,snapTime,splitClip} from '../public/timeline-tools.js';
import {arrangeAudio,videoAtTime} from '../public/timeline-model.js';
import {timelineWav} from '../public/timeline-export.js';

test('fit leaves a stable header and end gutter, including long projects',()=>{
 assert.equal(fitScale(1204,20),50);
 assert.ok(fitScale(1000,7200)*7200+156+48<=1000.001);
 for(const px of [.1,1,5,36,240]){const step=rulerStep(px);assert.ok(step*px>=72);assert.ok(step>0);}
});
test('snapping follows visible pixel distance, excludes self, and clamps placement',()=>{
 const clips=[{sec:{id:'a'},start:1,end:4},{sec:{id:'b'},start:5,end:8}];
 assert.equal(snapTime(5.15,clips,'a',3,36),5);
 assert.equal(snapTime(5.15,clips,'a',3,100),5.15);
 assert.equal(snapTime(4.05,clips,'a',3,36),4.05);
 assert.equal(snapTime(3.1,clips,'a',3,36),3);
 assert.equal(snapTime(5.15,clips,'a',3,36,false),5.15);
 assert.equal(snapTime(-3,clips,'a',3,36),0);
 assert.equal(snapTime(9000,clips,'a',3,36),7200);
});
test('splitting a trimmed placed clip preserves exact audio and linked video',()=>{
 const sec={id:'intro',title:'Intro',text:'Hello',offset:2,trims:{audio:{start:1,end:3}}};
 const clip=arrangeAudio([{sec,take:{id:'voice',outputId:'audio'},duration:4}]).clips[0];
 const parts=splitClip(clip,3,'right');assert.equal(sec.trims.audio.end,3);
 assert.deepEqual(parts.map(p=>p.trims.audio),[{start:1,end:2},{start:2,end:3}]);
 assert.equal(parts[1].audioAssetId,'audio');assert.equal(parts[1].offset,3);
 const samples=Float32Array.from([.1,.2,.3,.4,.5,.6,.7,.8]);
 const before=timelineWav([{channels:[samples],offset:2,trim:sec.trims.audio}],2);
 const after=timelineWav(parts.map(p=>({channels:[samples],offset:p.offset,trim:p.trims.audio})),2);
 assert.deepEqual(after,before);
 const linked=arrangeAudio(parts.map(p=>({sec:p,take:{id:p.sourceTakeId||'voice',outputId:'audio'},duration:4}))).clips;
 const jobs=[{sectionId:'intro',sourceJobId:'voice',status:'completed',outputId:'video'}];
 assert.equal(videoAtTime(linked,jobs,3.5).time,2.5);
 assert.equal(splitClip(clip,2,'bad'),null);assert.equal(splitClip({...clip,pending:true},3,'bad'),null);
});
test('split music stays an audio source without creating a linked video identity',()=>{
 const c=arrangeAudio([{sec:{id:'music',title:'Music',audioAssetId:'wav'},take:{id:'import:wav',outputId:'wav'},duration:10}]).clips[0];
 const [,right]=splitClip(c,5,'right');assert.equal(right.sourceTakeId,undefined);assert.equal(right.audioAssetId,'wav');
});

test('undo restores timeline geometry without discarding subsequent script or scene edits',async()=>{
 const {restoreTimelineSections}=await import('../public/timeline-tools.js');
 const saved=[{id:'a',text:'Old script',title:'Old title',trims:{voice:{start:0,end:5}}},{id:'removed',text:'Restore me',offset:2}];
 const current=[{id:'a',text:'Revised script',title:'New title',offset:3,scenePrompt:'New scene',trims:{voice:{start:1,end:4}}},{id:'added',text:'New'}];
 const restored=restoreTimelineSections(saved,current);
 assert.deepEqual(restored.map(s=>s.id),['a','removed']);assert.equal(restored[0].text,'Revised script');assert.equal(restored[0].title,'New title');assert.equal(restored[0].scenePrompt,'New scene');assert.equal(restored[0].offset,undefined);assert.deepEqual(restored[0].trims,saved[0].trims);assert.equal(restored[1].text,'Restore me');assert.equal(current[0].offset,3);
});
