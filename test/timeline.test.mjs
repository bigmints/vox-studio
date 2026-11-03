import test from 'node:test';
import assert from 'node:assert/strict';
import {trimRange,peaksFor,moveClip} from '../public/timeline-editor.js';
test('waveforms retain peaks across channels including short samples',()=>{assert.deepEqual(peaksFor([new Float32Array([0,.5,-1,0]),new Float32Array([.75,0,0,0])],2),[.75,1]);assert.deepEqual(peaksFor([new Float32Array([.5])]),[.5]);});
test('trims clamp to the source and retain a nonempty range',()=>{assert.deepEqual(trimRange({start:2,end:7},10),{start:2,end:7});assert.deepEqual(trimRange({start:-1,end:99},10),{start:0,end:10});const r=trimRange({start:20,end:1},10);assert.ok(r.start<r.end);assert.ok(r.end<=10);});
test('reordering retains section IDs and edits without mutating the original',()=>{const sections=[{id:'a',trims:{take:{start:1,end:2}}},{id:'b'},{id:'c'}];assert.deepEqual(moveClip(sections,'a','c').map(s=>s.id),['b','c','a']);assert.deepEqual(moveClip(sections,'c','a').map(s=>s.id),['c','a','b']);assert.equal(sections[0].id,'a');assert.equal(moveClip(sections,'a','c')[2].trims.take.start,1);});
