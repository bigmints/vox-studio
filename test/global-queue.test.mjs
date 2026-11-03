import test from 'node:test';
import assert from 'node:assert/strict';
import {queueGroups} from '../public/global-queue.js';
test('queue spans projects and separates audio, avatar and generated video',()=>{
 const jobs=[{id:'a',projectId:'one',kind:'voice',status:'running'},{id:'b',projectId:'two',kind:'avatar',status:'queued'},{id:'c',projectId:'three',kind:'video',status:'prepared'},{id:'d',kind:'voice',status:'failed'},{id:'e',kind:'avatar',status:'completed'}];
 const all=queueGroups(jobs);assert.equal(all.active.length,2);assert.equal(all.waiting.length,1);assert.equal(all.history.length,2);
 assert.deepEqual(queueGroups(jobs,'audio').active.map(j=>j.id),['a']);
 const video=queueGroups(jobs,'video');assert.equal(video.active[0].id,'b');assert.equal(video.waiting[0].id,'c');assert.equal(video.history[0].id,'e');
 assert.equal(queueGroups([]).active.length,0);
});
