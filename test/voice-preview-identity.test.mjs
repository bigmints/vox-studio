import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSignature} from '../public/local-voices.js';
test('clone preview identity follows the exact recording and transcript',()=>{
 const request={engine:'qwen3-hq',language:'en',text:'New words.',voiceAssetId:'recording-a',voiceTranscript:'Original words.'};
 const job={engine:request.engine,language:request.language,text:request.text,inputs:{voice:'recording-a'},referenceText:'Original words.'};
 assert.equal(previewSignature(request),previewSignature(job));
 assert.notEqual(previewSignature(request),previewSignature({...request,voiceAssetId:'recording-b'}));
 assert.notEqual(previewSignature(request),previewSignature({...request,voiceTranscript:'Different words.'}));
 assert.notEqual(previewSignature(request),previewSignature({...request,text:'Changed audition.'}));
});
