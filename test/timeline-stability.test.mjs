import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioBufferCache} from '../public/audio-cache.js';
import {timelineScale,fitScale} from '../public/timeline-tools.js';
import {editableAudioClips,arrangeAudio} from '../public/timeline-model.js';

test('loading actual take durations and selecting clips retain the established zoom',()=>{
 const session={fit:true};session.zoom=timelineScale(session,1200,200);
 const initial=session.zoom;
 for(const duration of [80,210,310,200])assert.equal(timelineScale(session,1200,duration),initial);
 assert.equal(timelineScale(session,1200,310,true),fitScale(1200,310));
 session.fit=false;session.zoom=80;assert.equal(timelineScale(session,800,310,true),80);
});

test('a newly loading take keeps its known duration instead of reshuffling following clips',()=>{
 const clips=[{sec:{id:'first',text:'Short text.'},take:{outputId:'new-take'}},{sec:{id:'next',text:'Next.'}}];
 const durations=new Map([['first',{duration:24,text:'Short text.'}]]);
 const pending=editableAudioClips(clips,[],durations),layout=arrangeAudio(pending);
 assert.equal(pending[0].pending,true);assert.equal(layout.clips[1].start,24);
 const ready={...clips[0],duration:24,peaks:[],buffer:{}};
 assert.equal(arrangeAudio(editableAudioClips(clips,[ready],durations)).clips[1].start,24);
 assert.equal(editableAudioClips([{sec:{id:'draft',text:''}}],[],durations)[0].duration,3);
 assert.equal(editableAudioClips([{...clips[0],sec:{...clips[0].sec,text:'A different script.'}}],[],durations)[0].duration,3);
});

const audio=(length,channels=1)=>({buffer:{length,numberOfChannels:channels},duration:length/24000,peaks:[.1,.4]});
test('recent waveforms are reusable across editor remounts while cache memory is bounded',()=>{
 const cache=new AudioBufferCache(16),first=audio(2),second=audio(2),third=audio(2);
 cache.set('first',first);cache.set('second',second);assert.equal(cache.get('first'),first);
 cache.set('third',third);assert.equal(cache.get('second'),undefined);assert.equal(cache.get('first'),first);assert.equal(cache.get('third'),third);assert.equal(cache.bytes,16);
 cache.set('large',audio(100));assert.equal(cache.get('large'),undefined);assert.equal(cache.bytes,16);
});
test('replacing a cached take accounts for all channels without retaining the previous buffer',()=>{
 const cache=new AudioBufferCache(32);cache.set('take',audio(4));const stereo=audio(4,2);cache.set('take',stereo);
 assert.equal(cache.get('take'),stereo);assert.equal(cache.bytes,32);cache.set('next',audio(2));assert.equal(cache.get('take'),undefined);assert.equal(cache.bytes,8);
});
