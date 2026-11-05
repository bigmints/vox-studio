import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {availableGx10Presets} from '../public/gx10-presets.js';
import {createStore} from '../lib/store.mjs';
import {createOrchestrator} from '../lib/worker.mjs';

test('old workers offer baseline; installed accelerated preset becomes the first choice',()=>{
 assert.deepEqual(availableGx10Presets({}).map(p=>p.id),['baseline']);
 assert.deepEqual(availableGx10Presets({presets:[{id:'lightx2v-4',ready:true},{id:'baseline',ready:true}]}).map(p=>p.id),['lightx2v-4','baseline']);
 assert.deepEqual(availableGx10Presets({presets:[{id:'lightx2v-4',ready:false},{id:'baseline',ready:true}]}).map(p=>p.id),['baseline']);
});

test('removed InfiniteTalk jobs never contact a worker and completed outputs stay available',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'mytwin-removed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await createStore(dir);await store.update(s=>{s.settings.workerUrl='http://gx10:8420';s.jobs=[{id:'fast',remoteId:'remote',kind:'avatar',engine:'infinitetalk',preset:'lightx2v-4',status:'running',inputs:{}},{id:'legacy',kind:'avatar',engine:'infinitetalk',status:'prepared',inputs:{}},{id:'finished',kind:'avatar',engine:'infinitetalk',status:'completed',outputId:'saved-video'}];});
 let requests=0;const worker=createOrchestrator(store,dir,async()=>'',async()=>{requests++;throw new Error('Removed model must not contact a worker');});
 await worker.run('fast');await worker.run('legacy');await worker.run('finished');
 assert.equal(requests,0);
 for(const id of ['fast','legacy']){const j=store.read().jobs.find(j=>j.id===id);assert.equal(j.status,'failed');assert.match(j.error,/removed from GX10/);}
 assert.equal(store.read().jobs.find(j=>j.id==='finished').outputId,'saved-video');
 assert.equal(store.read().jobs.find(j=>j.id==='finished').status,'completed');
});
