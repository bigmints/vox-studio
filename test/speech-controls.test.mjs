import test from 'node:test';
import assert from 'node:assert/strict';
import {speechOptions} from '../lib/local-tts.mjs';
test('speech defaults preserve existing takes and partial controls are completed',()=>{
 assert.deepEqual(speechOptions(),{speed:1,sentencePause:0,volume:1});
 assert.deepEqual(speechOptions({speed:1.25}),{speed:1.25,sentencePause:0,volume:1});
});
test('speech controls reject invalid values before saving a take',()=>{
 for(const value of [null,[],{speed:0},{speed:2},{volume:-1},{volume:Infinity},{sentencePause:3},{speed:'1'},{volume:true}])assert.throws(()=>speechOptions(value));
});
