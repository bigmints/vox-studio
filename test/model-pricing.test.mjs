import test from 'node:test';
import assert from 'node:assert/strict';
import {modelPrice} from '../public/model-pricing.js';
test('prices preserve billing units for text, characters and seconds',()=>{
 assert.equal(modelPrice({id:'text',pricing:{prompt:'0.0000005',completion:'0.000002'}},'writing'),'$0.5 in · $2 out / 1M tokens');
 assert.equal(modelPrice({id:'fish-audio/s2.1-pro',pricing:{prompt:'0.000015',completion:'0'}},'speech'),'$0.015 / 1,000 characters');
 assert.equal(modelPrice({id:'bytedance-seed/seed-audio-1-0',pricing:{prompt:'0',completion:'0.0025'}},'speech'),'$0.15 / minute of audio');
 assert.equal(modelPrice({id:'google/gemini-3.8-flash-tts',pricing:{prompt:'0.0000005',completion:'0.000009'}},'speech'),'$0.5 in · $9 out / 1M tokens (audio output)');
});
test('missing or dynamic prices are never labelled free',()=>{
 assert.equal(modelPrice({id:'x',pricing:{}},'writing'),'Price unavailable');
 assert.equal(modelPrice({id:'x',pricing:{prompt:'-1',completion:'-1'}},'writing'),'Price unavailable');
 assert.equal(modelPrice({id:'x',pricing:{prompt:'0',completion:'0'}},'writing'),'Free');
 assert.match(modelPrice({id:'x',pricing:{prompt:'0',completion:'0',request:'0.1'}},'writing'),/\$0.1\/request/);
 assert.equal(modelPrice({id:'unknown/speech',pricing:{prompt:'0',completion:'0.1'}},'speech'),'See model pricing');
});
