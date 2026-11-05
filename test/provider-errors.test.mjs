import test from 'node:test';
import assert from 'node:assert/strict';
import {providerError,rejectsPersonImage,rejectsFaceImage} from '../public/provider-errors.js';
import {validateAvatar} from '../lib/video.mjs';
test('face rejections explain the correct workflow and block the same rejected image before submission',()=>{
 const message='OpenRouter returned 400: HTTP 400: {"error":{"code":"invalid_parameter","message":"No face detected in the image."}}';
 assert.ok(rejectsFaceImage(message));assert.match(providerError(message),/non-human/);assert.match(providerError(message),/does not guarantee lip-sync/);
 const state={assets:[{id:'portrait',type:'image/png'},{id:'voice',type:'audio/wav'},{id:'new',type:'image/png'}],jobs:[{engine:'heygen/avatar-iv',status:'failed',inputs:{avatar:'portrait'},error:message}]};
 assert.throws(()=>validateAvatar(state,{avatar:'portrait',audio:'voice'},'heygen/avatar-iv'),/already rejected/);
 assert.doesNotThrow(()=>validateAvatar(state,{avatar:'new',audio:'voice'},'heygen/avatar-iv'));
});
test('nested real-person rejection is explained without hiding unrelated provider errors',()=>{
 const message='OpenRouter returned 400: HTTP 400: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"image may contain real person"}}';
 assert.ok(rejectsPersonImage(message));assert.match(providerError(message),/provider’s policy/);assert.doesNotMatch(providerError(message),/credits may have been used/);assert.equal(providerError('HTTP 402: no credits'),'HTTP 402: no credits');
});
