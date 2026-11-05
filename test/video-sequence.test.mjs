import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {planVoiceVideo} from '../public/video-plan.js';
import {videoEstimate,modelPrice} from '../public/model-pricing.js';
import {createStore} from '../lib/store.mjs';
import {createVideo} from '../lib/video.mjs';
const exec=promisify(execFile);
test('plans full voice duration without gaps and converts cents pricing',()=>{
 assert.deepEqual(planVoiceVideo(17.2,[5,10]),[10,10]);assert.deepEqual(planVoiceVideo(34,[5,10]),[10,10,10,5]);assert.throws(()=>planVoiceVideo(NaN,[5]));
 const m={pricing_skus:{cents_per_video_output_second_720p:'3'}};assert.match(modelPrice(m,'scene'),/\$0.03\/sec/);assert.match(videoEstimate(m,[10,10],'720p'),/\$0.6/);
});
test('multiple remote shots assemble to full length with original voice audio',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mytwin-sequence-'));t.after(()=>rm(dir,{recursive:true,force:true}));await mkdir(join(dir,'media'));
 await exec('/usr/bin/swift',[new URL('./fixtures/make-video.swift',import.meta.url).pathname,join(dir,'shot.mp4')]);
 const wav=Buffer.alloc(44+32000*3.2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);await (await import('node:fs/promises')).writeFile(join(dir,'media','voice.wav'),wav);
 const shot=await readFile(join(dir,'shot.mp4'));let posts=0;
 const store=await createStore(dir);await store.update(s=>{s.assets=[{id:'voice',fileName:'voice.wav',type:'audio/wav'}];s.jobs=[{id:'parent',kind:'video',status:'prepared',sectionTitle:'Scene',text:'A red scene',prompt:'Red',inputs:{},video:{aspect_ratio:'1:1'},sequence:{duration:3.2,audioStart:0,audio:'voice',segments:[2,2]}}];});
 const client=createVideo(store,dir,()=> 'test-key',async(url,o)=>o.method==='POST'?(posts++,Response.json({id:'remote'+posts})):url.includes('/content')?new Response(shot,{headers:{'content-type':'video/mp4'}}):Response.json({status:'completed'}));
 await client.run('parent');assert.equal(posts,0);await client.claim('parent');await client.run('parent',true);
 for(let i=0;i<7;i++)await client.run('parent');
 const s=store.read(),j=s.jobs.find(j=>j.id==='parent');assert.equal(j.status,'completed',j.error);assert.equal(posts,2);
 const a=s.assets.find(a=>a.id===j.outputId);const {stdout}=await exec('/usr/bin/swift',[new URL('./fixtures/probe-video.swift',import.meta.url).pathname,join(dir,'media',a.fileName)]);const [duration,audioTracks]=stdout.trim().split(',').map(Number);assert.ok(Math.abs(duration-3.2)<0.1);assert.equal(audioTracks,1);await client.run('parent');assert.equal(posts,2);
});
