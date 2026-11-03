import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {id,now} from './store.mjs';
export const VOICESTUDIO_URL='https://gx10-54fa.tail5903e7.ts.net:9444';
export function createVoiceStudio(store,dataDir,key,fetcher=fetch){
 const fail=m=>Object.assign(Error(m),{status:400});
 const headers=()=>{if(!key())throw fail('Add the VoiceStudio API key in Settings.');return {Authorization:`Bearer ${key()}`};};
 async function request(path,options={}){const r=await fetcher(VOICESTUDIO_URL+path,{...options,headers:headers(),redirect:'error',signal:AbortSignal.timeout(600000)});if(!r.ok)throw fail(`VoiceStudio returned ${r.status}. Check the service and API key.`);return r;}
 return {
 async check(){await request('/health');return {ok:true};},
 async claim(jobId){headers();await store.update(s=>{const j=s.jobs.find(x=>x.id===jobId);if(j?.status!=='prepared'||j.kind!=='voice')throw fail('Save a new speech take first.');Object.assign(j,{status:'submitting',error:''});});},
 async run(jobId){try{const j=store.read().jobs.find(x=>x.id===jobId);const form=new FormData();for(const [k,v] of Object.entries({text:j.text,language:j.language,num_step:'32',wav_bits:'16',engine:'omnivoice',ref_text:j.referenceText||''}))form.set(k,v);const a=store.read().assets.find(a=>a.id===j.inputs.voice&&a.type.startsWith('audio/'));if(!a)throw fail('Add a voice recording to your twin.');const bytes=await readFile(join(dataDir,'media',a.id));if(bytes.length>20*1024*1024)throw fail('Use a voice recording smaller than 20 MB.');form.set('ref_audio',new Blob([bytes],{type:a.type}),'reference.wav');await store.update(s=>Object.assign(s.jobs.find(x=>x.id===jobId),{status:'running',stage:'Generating speech on GX10'}));const r=await request('/generate',{method:'POST',body:form});let size=0,chunks=[];for await(const c of r.body){size+=c.length;if(size>128*1024*1024)throw fail('Audio exceeds 128 MB.');chunks.push(c);}const audio=Buffer.concat(chunks);if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw fail('VoiceStudio returned invalid WAV audio.');const asset={id:id(),name:j.sectionTitle+'.wav',type:'audio/wav',size,createdAt:now()};await writeFile(join(dataDir,'media',asset.id),audio,{mode:0o600});await store.update(s=>{s.assets.push(asset);Object.assign(s.jobs.find(x=>x.id===jobId),{status:'completed',stage:'Ready',outputId:asset.id,updatedAt:now()});});}catch(e){await store.update(s=>Object.assign(s.jobs.find(x=>x.id===jobId),{status:'failed',error:e.status?e.message:'Could not complete VoiceStudio speech. Check GX10 and try a new take.',updatedAt:now()}));}}
 };
}
