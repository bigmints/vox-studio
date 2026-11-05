import test from 'node:test';
import assert from 'node:assert/strict';
import {speechBounds,pacingTrim} from '../public/audio-pacing.js';
import {arrangeAudio} from '../public/timeline-model.js';
import {timelineWav} from '../public/timeline-export.js';
import {projectSection,defaultPodcast,normalizePodcast} from '../public/project-model.js';

test('conversation timing trims quiet edges while preserving internal silence and speech padding',()=>{
 const rate=1000,x=new Float32Array(3000);x.fill(.1,300,900);x.fill(.1,1500,2400);
 const bounds=speechBounds([x],rate);assert.ok(Math.abs(bounds.start-.24)<.001);assert.ok(Math.abs(bounds.end-2.5)<.001);
 const buffer={sampleRate:rate,numberOfChannels:1,getChannelData:()=>x};
 assert.deepEqual(pacingTrim({autoPace:true},'take',buffer),bounds);
 const manual={start:0,end:3};assert.equal(pacingTrim({autoPace:true,trims:{take:manual}},'take',buffer),manual);
 assert.equal(pacingTrim({},'take',buffer),undefined);
 assert.deepEqual(speechBounds([new Float32Array(1000)],rate),{start:0,end:1});
});
test('speaker gap is shared by playback and WAV export; explicit timeline positions win',()=>{
 const sec={id:'a'},second={id:'b',gapBefore:.2};
 const layout=arrangeAudio([{sec,duration:1},{sec:second,duration:1}]);assert.equal(layout.clips[1].start,1.2);assert.equal(layout.duration,2.2);
 const part={channels:[new Float32Array(10).fill(.5)]};const bytes=timelineWav([part,{...part,gapBefore:.2}],10);const wav=new DataView(bytes.buffer);assert.equal(wav.getUint32(40,true),44);
 assert.equal(wav.getInt16(44+10*2,true),0);assert.equal(wav.getInt16(44+11*2,true),0);assert.equal(wav.getInt16(44+12*2,true),16384);
 assert.equal(arrangeAudio([{sec,duration:1},{sec:{...second,offset:.5},duration:1}]).clips[1].start,.5);
});
test('podcast timing defaults to natural and can preserve the original takes unchanged',()=>{
 const p={projectType:'podcast',podcast:defaultPodcast(),sections:[{id:'a',speakerId:'host'},{id:'b',speakerId:'guest'}]};
 assert.equal(projectSection(p,p.sections[0]).gapBefore,0);assert.equal(projectSection(p,p.sections[1]).gapBefore,.18);assert.equal(projectSection(p,p.sections[1]).autoPace,true);
 p.podcast.pacing='off';assert.equal(projectSection(p,p.sections[1]).autoPace,false);assert.equal(projectSection(p,p.sections[1]).gapBefore,0);
 assert.equal(normalizePodcast(p.podcast).pacing,'off');assert.throws(()=>normalizePodcast({...p.podcast,pacing:'invalid'}));
});
