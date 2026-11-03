import test from 'node:test';
import assert from 'node:assert/strict';
import {arrangeAudio,videoAtTime} from '../public/timeline-model.js';
test('video follows voice trim, offset and boundary, and rejects an older voice take',()=>{
 const clips=arrangeAudio([{sec:{id:'a',offset:2,trims:{audio:{start:3,end:7}}},take:{id:'voice',outputId:'audio'},duration:8},{sec:{id:'b'},take:{id:'voice2',outputId:'audio2'},duration:2}]).clips;
 const jobs=[{sectionId:'a',sourceJobId:'old',status:'completed',outputId:'stale'},{sectionId:'a',sourceJobId:'voice',status:'completed',outputId:'video'},{sectionId:'b',sourceJobId:'voice2',status:'completed',outputId:'video2'}];
 assert.equal(videoAtTime(clips,jobs,1),null);
 assert.equal(videoAtTime(clips,jobs,2).time,3);
 assert.equal(videoAtTime(clips,jobs,5).time,6);
 assert.equal(videoAtTime(clips,jobs,6).job.outputId,'video2');
 assert.equal(videoAtTime(clips,jobs,6).time,0);
 assert.equal(videoAtTime(clips,jobs,8),null);
 assert.equal(videoAtTime(clips,[jobs[0]],3),null);
});
