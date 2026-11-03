import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVoiceStudio,VOICESTUDIO_URL} from '../lib/voicestudio.mjs';
test('VoiceStudio clones with safe rendering parameters and saves returned WAV',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vs-provider-'));await mkdir(join(dir,'media'));await writeFile(join(dir,'media','ref'),'sample');
 const state={jobs:[{id:'job',kind:'voice',status:'prepared',inputs:{voice:'ref'},text:'Hello',language:'en',referenceText:'Reference',sectionTitle:'Clip'}],assets:[{id:'ref',type:'audio/wav'}]};const store={read:()=>structuredClone(state),update:async fn=>fn(state)};
 const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);
 const client=createVoiceStudio(store,dir,()=> 'secret',async(url,options)=>{assert.equal(url,VOICESTUDIO_URL+'/generate');assert.equal(options.headers.Authorization,'Bearer secret');assert.equal(options.body.get('num_step'),'32');assert.equal(options.body.get('wav_bits'),'16');assert.equal(options.body.get('ref_text'),'Reference');assert.ok(options.body.get('ref_audio') instanceof Blob);return new Response(wav);});
 await client.claim('job');await assert.rejects(()=>client.claim('job'));await client.run('job');assert.equal(state.jobs[0].status,'completed');assert.deepEqual(await readFile(join(dir,'media',state.jobs[0].outputId)),wav);
});
test('VoiceStudio requires a key before contacting GX10',async()=>{const client=createVoiceStudio({},'',()=>'',()=>{throw Error('Must not fetch');});await assert.rejects(()=>client.check(),/API key/);});
