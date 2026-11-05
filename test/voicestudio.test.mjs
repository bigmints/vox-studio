import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVoiceStudio,voiceStudioUrl} from '../lib/voicestudio.mjs';

test('VoiceStudio uses the submitted connection even if settings change before generation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vs-provider-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'media'));await writeFile(join(dir,'media','ref'),'sample');
 const state={settings:{voicestudioUrl:'http://127.0.0.1:9444/api/'},jobs:[{id:'job',kind:'voice',status:'prepared',inputs:{voice:'ref'},text:'Hello',language:'en',referenceText:'Reference',sectionTitle:'Clip'}],assets:[{id:'ref',type:'audio/wav'}]};const store={read:()=>structuredClone(state),update:async fn=>fn(state)};
 const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);let key='original-secret';
 const client=createVoiceStudio(store,dir,()=>key,async(url,options)=>{assert.equal(url,'http://127.0.0.1:9444/api/generate');assert.equal(options.headers.Authorization,'Bearer original-secret');assert.equal(options.redirect,'error');assert.equal(options.body.get('num_step'),'32');assert.equal(options.body.get('wav_bits'),'16');assert.equal(options.body.get('ref_text'),'Reference');assert.ok(options.body.get('ref_audio') instanceof Blob);return new Response(wav);});
 const config=await client.claim('job');await assert.rejects(()=>client.claim('job'));
 state.settings.voicestudioUrl='https://different.example';key='replacement-secret';
 await client.run('job',config);assert.equal(state.jobs[0].status,'completed');assert.equal(state.jobs[0].voicestudioUrl,'http://127.0.0.1:9444/api');assert.ok(!JSON.stringify(state).includes('secret'));assert.deepEqual(await readFile(join(dir,'media',state.jobs[0].outputId)),wav);
});
test('VoiceStudio health check uses the saved server address',async()=>{
 const client=createVoiceStudio({read:()=>({settings:{voicestudioUrl:' https://voice.example/service/// '}})},'',()=> 'key',async(url,options)=>{assert.equal(url,'https://voice.example/service/health');assert.equal(options.headers.Authorization,'Bearer key');return Response.json({ok:true});});
 await client.check();
});
test('VoiceStudio requires a key and address before contacting a server',async()=>{
 const fetcher=()=>{throw Error('Must not fetch');};
 await assert.rejects(()=>createVoiceStudio({},'',()=>'',fetcher).check(),/API key/);
 await assert.rejects(()=>createVoiceStudio({read:()=>({settings:{}})},'',()=> 'key',fetcher).check(),/server address/);
});
test('VoiceStudio addresses support local servers and base paths but reject embedded credentials',()=>{
 assert.equal(voiceStudioUrl('http://localhost:9444/'),'http://localhost:9444');
 assert.equal(voiceStudioUrl(' https://voice.example/v1/// '),'https://voice.example/v1');
 assert.equal(voiceStudioUrl(''),'');
 for(const url of ['not a url','file:///tmp/server','ftp://voice.example','https://user:secret@voice.example','https://voice.example?key=secret','https://voice.example#fragment',null])assert.throws(()=>voiceStudioUrl(url),/VoiceStudio/);
});
