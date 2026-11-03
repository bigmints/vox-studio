import test from 'node:test';
import assert from 'node:assert/strict';
import {timelineWav,renderTimelineAudio} from '../public/timeline-export.js';
test('full export applies trim windows and clip order with no extra silence',()=>{const bytes=timelineWav([{channels:[Float32Array.from([.1,.2,.3,.4])],trim:{start:.25,end:.75}},{channels:[Float32Array.from([-.5,-.25])]}],4);const v=new DataView(bytes.buffer);assert.equal(v.getUint32(40,true),8);assert.deepEqual(Array.from({length:4},(_,i)=>v.getInt16(44+2*i,true)),[6553,9830,-16384,-8192]);assert.equal(v.getUint32(24,true),4);});
test('mono clips duplicate into stereo while stereo channels remain distinct',()=>{const bytes=timelineWav([{channels:[Float32Array.of(.5),Float32Array.of(-.5)]},{channels:[Float32Array.of(.25)]}],4);const v=new DataView(bytes.buffer);assert.equal(v.getUint16(22,true),2);assert.deepEqual([0,1,2,3].map(i=>v.getInt16(44+i*2,true)),[16384,-16384,8192,8192]);});
test('missing takes stop the full export instead of silently dropping sections',async()=>{await assert.rejects(renderTimelineAudio([{sec:{title:'Closing'}}],()=>''),/Closing/);assert.throws(()=>timelineWav([]),/No audio/);});
