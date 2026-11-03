import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { id, now } from './store.mjs';

export function workerClient(base, token='', fetcher=fetch) {
  const url=new URL(base);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error('Use an http(s) worker URL without credentials or query parameters.');
  const root=base.replace(/\/$/,'');
  return async (path,options={})=>{
    const response=await fetcher(root+path,{...options,redirect:'error',signal:AbortSignal.timeout(60000),headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}});
    if(!response.ok) { let detail; try { detail=(await response.json()).error; } catch {} throw new Error(typeof detail==='string'?detail.slice(0,1000):`GX10 returned HTTP ${response.status}. Check the worker and its access token.`); }
    return response;
  };
}

export function createOrchestrator(store, dir, getToken, fetcher=fetch) {
  const locks=new Set();
  const change=(jobId,fields)=>store.update(s=>{const j=s.jobs.find(x=>x.id===jobId);if(j)Object.assign(j,fields,{updatedAt:now()});});
  async function run(jobId) {
    if(locks.has(jobId))return;
    locks.add(jobId);
    try {
      let s=store.read(); let job=s.jobs.find(j=>j.id===jobId);
      if(!job||['completed','cancelled'].includes(job.status))return;
      if(!s.settings.workerUrl) {await change(jobId,{status:'waiting',error:'Configure your GX10 worker in Settings, then submit this job.'});return;}
      if(job.workerUrl&&job.workerUrl!==s.settings.workerUrl)throw new Error('This job belongs to a different worker. Restore its original URL before refreshing.');
      const request=workerClient(s.settings.workerUrl,await getToken(),fetcher);
      const cap=await (await request('/v1/capabilities')).json();
      if(cap.apiVersion!==1)throw new Error('Worker must implement MyTwin API version 1.');
      await store.update(s=>{s.settings.workerStatus='connected';s.settings.capabilities=cap;});
      if(!job.remoteId) {
        if(!cap.engines?.some(e=>e.id===job.engine&&e.kind===job.kind&&e.ready===true))throw new Error('The selected engine is not ready on this worker.');
        await change(jobId,{status:'submitting',stage:'Transferring references',workerUrl:s.settings.workerUrl,error:null});
        const refs={};
        for(const [name,assetId] of Object.entries(job.inputs)) {
          if(!assetId)continue;
          const asset=s.assets.find(a=>a.id===assetId);if(!asset)throw new Error('A required reference asset is missing.');
          const body=await readFile(join(dir,'media',asset.id));
          const result=await (await request('/v1/assets',{method:'POST',headers:{'Content-Type':asset.type,'X-Filename':encodeURIComponent(asset.name),'Idempotency-Key':asset.id},body})).json();
          if(typeof result.id!=='string')throw new Error('Worker returned an invalid asset ID.');refs[name]=result.id;
        }
        const remote=await (await request('/v1/jobs',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify({clientJobId:job.id,kind:job.kind,engine:job.engine,text:job.text,language:job.language,inputs:refs})})).json();
        if(typeof remote.id!=='string'||!remote.id)throw new Error('Worker returned an invalid job ID.');
        await change(jobId,{remoteId:remote.id,status:'queued',stage:'Queued on GX10'});
        job=store.read().jobs.find(j=>j.id===jobId);
      }
      const remote=await (await request('/v1/jobs/'+encodeURIComponent(job.remoteId))).json();
      if(!['queued','running','completed','failed','cancelled','cancel_requested'].includes(remote.status))throw new Error('Worker returned an invalid job status.');
      if(remote.status==='completed') {
        if(!remote.output?.id||!['audio/wav','audio/mpeg','audio/mp4','video/mp4','video/webm'].includes(remote.output.type))throw new Error('Worker output is missing or has an unsupported media type.');
        const response=await request('/v1/artifacts/'+encodeURIComponent(remote.output.id));
        const chunks=[];let size=0;
        for await(const chunk of response.body){size+=chunk.length;if(size>512*1024*1024)throw new Error('Output exceeds the 512 MB limit. Use shorter sections.');chunks.push(chunk);}
        const data=Buffer.concat(chunks);
        if(!data.length)throw new Error('The worker returned an empty output.');
        const asset={id:id(),name:remote.output.name||`${job.kind}-take`,type:remote.output.type,size:data.length,createdAt:now()};
        await writeFile(join(dir,'media',asset.id+'.tmp'),data);await rename(join(dir,'media',asset.id+'.tmp'),join(dir,'media',asset.id));
        await store.update(s=>{s.assets.push(asset);Object.assign(s.jobs.find(j=>j.id===jobId),{status:'completed',stage:'Ready to download',outputId:asset.id,error:null,updatedAt:now()});});
      } else await change(jobId,{status:remote.status,stage:remote.stage||remote.status,error:remote.status==='failed'?String(remote.error||'Worker render failed.').slice(0,1000):null});
    } catch(e) {await change(jobId,{status:'waiting',error:e.message});}
    finally {locks.delete(jobId);}
  }
  async function cancel(jobId) {
    if(locks.has(jobId))throw new Error('Job is being synchronized. Try cancellation again in a moment.');
    const s=store.read(),job=s.jobs.find(j=>j.id===jobId);if(!job)throw new Error('Job not found.');
    if(['completed','cancelled'].includes(job.status))return;
    if(job.remoteId){
      const request=workerClient(job.workerUrl,await getToken(),fetcher);
      await request('/v1/jobs/'+encodeURIComponent(job.remoteId)+'/cancel',{method:'POST'});
      await change(jobId,{status:'cancel_requested',stage:'Waiting for worker confirmation'});
    } else await change(jobId,{status:'cancelled',stage:'Cancelled before submission'});
  }
  return {run,cancel};
}
