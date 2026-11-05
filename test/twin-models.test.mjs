import test from 'node:test';
import assert from 'node:assert/strict';
import {twinVoiceModels,twinCloudVoiceSettings} from '../public/twin-models.js';
import {savedLocalVoice} from '../lib/local-tts.mjs';
test('provider model choices contain only usable speech engines',()=>{
 const state={settings:{catalog:{models:[{id:'speech',name:'Speech',outputs:['speech'],endpoints:['/api/v1/audio/speech']},{id:'chat',outputs:['text'],endpoints:['/api/v1/chat/completions']},{id:'audio',outputs:['speech'],endpoints:[]}]},capabilities:{engines:[{id:'ready',kind:'voice',ready:true},{id:'offline',kind:'voice',ready:false},{id:'avatar',kind:'avatar',ready:true}]}}};
 assert.deepEqual(twinVoiceModels('openrouter',state).map(m=>m.id),['speech']);
 assert.deepEqual(twinVoiceModels('gx10',state).map(m=>m.id),['ready']);
 assert.equal(twinVoiceModels('voicestudio',state)[0].id,'omnivoice');
});
test('per-twin provider model and preset preferences survive profile validation',()=>{
 const settings={voiceProvider:'openrouter',speechModel:'provider/model',voiceMode:'preset',voice:'warm'};
 const fields=savedLocalVoice(settings,{assets:[],jobs:[]});
 assert.equal(fields.speechModel,settings.speechModel);assert.equal(fields.voiceMode,'preset');assert.equal(fields.voice,'warm');
 assert.throws(()=>twinCloudVoiceSettings({...settings,voiceMode:'unavailable'}),/preset/);
 assert.throws(()=>savedLocalVoice({...settings,speechModel:'x'.repeat(201)},{}),e=>e.status===400);
});
