import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../lib/store.mjs';
import {prepareVideo,createVideo,avatarOptions} from '../lib/video.mjs';
test('billing is saved even when a completed video cannot be downloaded',async t=>{
 const f=await fixture(t,async url=>url.includes('/content')?new Response('unavailable',{status:503}):Response.json({status:'completed',usage:{cost:0.125}}));
 await f.store.update(s=>Object.assign(s.jobs[0],{status:'queued',videoRemoteId:'charged-video'}));
 await f.client.run(f.id);
 assert.equal(f.store.read().jobs[0].usage.cost,0.125);assert.equal(f.store.read().assets.length,0);
});
const model={id:'test/video',name:'Video',supported_durations:[5],supported_resolutions:['720p'],supported_aspect_ratios:['16:9']};
const input={projectId:'p',sectionId:'s',engine:model.id,video:{duration:5,resolution:'720p',aspect_ratio:'16:9'}};
async function fixture(t,fetcher,shareAudio){const dir=await mkdtemp(join(tmpdir(),'mytwin-video-'));await mkdir(join(dir,'media'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=await createStore(dir);await store.update(s=>{s.projects=[{id:'p',sections:[{id:'s',text:'A sunny lake',title:'Scene'}]}];s.settings.videoModels=[model];s.jobs=[prepareVideo(s,input)];});return {dir,store,client:createVideo(store,dir,()=> 'test-key',fetcher,shareAudio,async path=>readFile(path)),id:store.read().jobs[0].id};}
test('video settings validated, text-only needs no twin, images opt in',async t=>{const f=await fixture(t);const s=f.store.read();assert.deepEqual(s.jobs[0].inputs,{});assert.equal(s.jobs[0].video.generate_audio,false);assert.throws(()=>prepareVideo(s,{...input,video:{duration:99}}));assert.throws(()=>prepareVideo(s,{...input,useImage:true}));assert.throws(()=>prepareVideo(s,{...input,engine:'video-understanding'}));});
test('submit once, resume polling after restart, authenticated local download',async t=>{let posts=0,gets=0;const mp4=Buffer.from('0000ftypisomtest-video');const fetcher=async(url,o)=>{assert.equal(o.headers.Authorization,'Bearer test-key');if(o.method==='POST'){posts++;assert.deepEqual(JSON.parse(o.body),{model:model.id,prompt:'A sunny lake',duration:5,resolution:'720p',aspect_ratio:'16:9',generate_audio:false});return Response.json({id:'remote/1',status:'pending',polling_url:'https://untrusted.example/steal-key'});}gets++;if(url.endsWith('/content?index=0'))return new Response(mp4,{headers:{'Content-Type':'binary/octet-stream'}});assert.ok(url.endsWith('/videos/remote%2F1'));return Response.json({status:'completed',unsigned_urls:['https://untrusted.example/steal-key'],usage:{cost:0.1}});};const f=await fixture(t,fetcher);await f.client.claim(f.id);await assert.rejects(f.client.claim(f.id));await Promise.all([f.client.run(f.id,true),f.client.run(f.id,true)]);assert.equal(f.store.read().jobs[0].status,'queued');const resumed=createVideo(f.store,f.dir,()=> 'test-key',fetcher);await Promise.all([resumed.run(f.id),resumed.run(f.id)]);const s=f.store.read();assert.equal(s.jobs[0].status,'completed');assert.deepEqual(await readFile(join(f.dir,'media',s.assets[0].id)),mp4);assert.equal(posts,1);assert.equal(gets,2);assert.equal(s.assets.length,1);await assert.rejects(resumed.claim(f.id));});
test('ambiguous submission cannot charge again; polling failures preserve remote ID',async t=>{let calls=0;const f=await fixture(t,async()=>{calls++;throw Error('offline');});await f.client.claim(f.id);await f.client.run(f.id,true);assert.equal(f.store.read().jobs[0].status,'failed');await assert.rejects(f.client.claim(f.id));await f.client.run(f.id,true);assert.equal(calls,1);await f.store.update(s=>Object.assign(s.jobs[0],{status:'queued',videoRemoteId:'remote'}));await f.client.run(f.id);assert.equal(f.store.read().jobs[0].status,'queued');assert.equal(f.store.read().jobs[0].videoRemoteId,'remote');});
test('failed remote jobs stop polling; bad content never saved as a take',async t=>{let response={status:'completed'};const f=await fixture(t,async url=>url.includes('/content')?new Response('not video',{headers:{'Content-Type':'video/mp4'}}):Response.json(response));await f.store.update(s=>Object.assign(s.jobs[0],{status:'queued',videoRemoteId:'remote'}));await f.client.run(f.id);assert.equal(f.store.read().assets.length,0);assert.equal(f.store.read().jobs[0].status,'queued');response={status:'failed',error:'Unsupported reference image'};await f.client.run(f.id);assert.equal(f.store.read().jobs[0].status,'failed');assert.match(f.store.read().jobs[0].error,/Unsupported reference/);});

test('avatar submits exact supplied portrait and approved audio without TTS text',async t=>{
 let posts=0;const f=await fixture(t,async(url,o)=>{posts++;const body=JSON.parse(o.body);assert.equal(body.model,'heygen/avatar-iv');assert.equal(body.resolution,'1080p');assert.equal(body.aspect_ratio,'9:16');assert.equal(body.prompt,undefined);assert.deepEqual(body.input_references,[{type:'image_url',image_url:{url:'data:image/png;base64,cG9ydHJhaXQ='}},{type:'audio_url',audio_url:{url:'https://test.trycloudflare.com/secret/approved-audio'}}]);return Response.json({id:'avatar-job'});},async(bytes,mime)=>{assert.equal(bytes.toString(),'approved-voice');assert.equal(mime,'audio/wav');return {url:'https://test.trycloudflare.com/secret/approved-audio',close(){}};});
 await writeFile(join(f.dir,'media','portrait'),'portrait');await writeFile(join(f.dir,'media','voice'),'approved-voice');
 await f.store.update(s=>{s.assets=[{id:'portrait',type:'image/png'},{id:'voice',type:'audio/wav'}];Object.assign(s.jobs[0],{kind:'avatar',video:{resolution:'1080p',aspect_ratio:'9:16'},audioShare:true,engine:'heygen/avatar-iv',inputs:{avatar:'portrait',audio:'voice'}});});
 await f.client.claim(f.id);await f.client.run(f.id,true);await f.client.run(f.id,true);assert.equal(posts,1);assert.equal(f.store.read().jobs[0].videoRemoteId,'avatar-job');
});

test('temporary audio server exposes only the exact secret URL',async t=>{const {audioServer}=await import('../lib/media-share.mjs');const server=await audioServer(Buffer.from('approved audio'),'audio/wav');t.after(()=>server.close());assert.equal((await fetch(server.url+'/')).status,404);assert.equal((await fetch(server.url+'/secrets.json')).status,404);assert.equal((await fetch(server.url+server.path,{method:'POST'})).status,404);assert.equal(await (await fetch(server.url+server.path)).text(),'approved audio');});
test('provider rejection closes the temporary audio link and retains the reason',async t=>{
 let closed=0,posts=0;
 const f=await fixture(t,async()=>{posts++;return Response.json({error:{message:'Audio reference is invalid'}},{status:400});},async()=>({url:'https://test.trycloudflare.com/audio',close(){closed++;}}));
 await writeFile(join(f.dir,'media','portrait'),'portrait');await writeFile(join(f.dir,'media','voice'),'approved-voice');
 await f.store.update(s=>{s.assets=[{id:'portrait',type:'image/png'},{id:'voice',type:'audio/wav'}];Object.assign(s.jobs[0],{kind:'avatar',video:{resolution:'1080p',aspect_ratio:'9:16'},audioShare:true,engine:'heygen/avatar-iv',inputs:{avatar:'portrait',audio:'voice'}});});
 await f.client.claim(f.id);await f.client.run(f.id,true);await f.client.run(f.id,true);assert.equal(posts,1);assert.equal(closed,1);assert.match(f.store.read().jobs[0].error,/Audio reference is invalid/);
});

test('avatar framing defaults remain compatible and unsupported settings are rejected',()=>{
 assert.deepEqual(avatarOptions(),{resolution:'720p',aspect_ratio:'16:9'});
 assert.deepEqual(avatarOptions({resolution:'1080p',aspect_ratio:'9:16',prompt:'ignored'}),{resolution:'1080p',aspect_ratio:'9:16'});
 for(const v of [{resolution:'4k'},{aspect_ratio:'4:3'},{resolution:1080}])assert.throws(()=>avatarOptions(v));
});
