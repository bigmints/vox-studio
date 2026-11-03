import test from 'node:test';
import assert from 'node:assert/strict';
import {wavBytes} from '../public/voice-recorder.js';
test('recordings are mono PCM WAV at the actual capture sample rate',()=>{const samples=new Float32Array([-2,-1,0,1,2]);const bytes=wavBytes([samples,new Float32Array([0.5])],48000);const v=new DataView(bytes.buffer);assert.equal(Buffer.from(bytes.subarray(0,4)).toString(),'RIFF');assert.equal(v.getUint32(4,true),48);assert.equal(v.getUint32(24,true),48000);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint16(34,true),16);assert.equal(v.getUint32(40,true),12);assert.deepEqual(Array.from({length:6},(_,i)=>v.getInt16(44+i*2,true)),[-32768,-32768,0,32767,32767,16383]);assert.equal(samples[0],-2);});
