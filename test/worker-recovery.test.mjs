import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../lib/store.mjs';
import { createOrchestrator } from '../lib/worker.mjs';
test('an interrupted remote avatar job resumes polling without resubmitting',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mytwin-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await createStore(dir);await store.update(s=>{s.settings.workerUrl='http://gx10:8420';s.jobs=[{id:'local',remoteId:'remote',workerUrl:'http://gx10:8420',status:'running',kind:'avatar',engine:'avatar-test'}];});
 let polls=0,submissions=0;
 const request=async(url,options={})=>{
  if(options.method==='POST')submissions++;
  if(url.endsWith('/v1/capabilities'))return Response.json({apiVersion:1,engines:[{id:'avatar-test',kind:'avatar',ready:true}]});
  if(url.endsWith('/v1/jobs/remote')){if(++polls===1)throw new Error('Network interrupted');return Response.json({status:'running',stage:'Generating video'});}
  throw new Error('Unexpected URL');
 };
 const worker=createOrchestrator(store,dir,async()=>'',request);
 await worker.run('local');assert.equal(store.read().jobs[0].status,'waiting');
 await worker.run('local');assert.equal(store.read().jobs[0].status,'running');
 assert.equal(store.read().jobs[0].remoteId,'remote');assert.equal(submissions,0);assert.equal(polls,2);
});
