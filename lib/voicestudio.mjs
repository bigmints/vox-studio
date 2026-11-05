import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {id,now} from './store.mjs';
export const LEGACY_VOICESTUDIO_URL='https://gx10-54fa.tail5903e7.ts.net:9444';
export function voiceStudioUrl(value){
 if(typeof value!=='string'||value.length>2000)throw Object.assign(Error('Enter a valid VoiceStudio server address.'),{status:400});
 if(!value.trim())return '';
 let url;try{url=new URL(value.trim());}catch{throw Object.assign(Error('Enter a valid VoiceStudio server address.'),{status:400});}
 if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.username||url.password||url.search||url.hash)throw Object.assign(Error('Use an http(s) VoiceStudio address without credentials, query parameters, or fragments.'),{status:400});
 return url.href.replace(/\/+$/,'');
}
export function createVoiceStudio(store,dataDir,key,fetcher=fetch){
 const fail=m=>Object.assign(Error(m),{status:400});
 const connection=()=>{const token=key();if(!token)throw fail('Add the VoiceStudio API key in Settings.');const url=voiceStudioUrl(store.read().settings?.voicestudioUrl||'');if(!url)throw fail('Add the VoiceStudio server address in Settings.');return {url,token};};
 async function request(config,path,options={}){const r=await fetcher(config.url+path,{...options,headers:{Authorization:`Bearer ${config.token}`},redirect:'error',signal:AbortSignal.timeout(600000)});if(!r.ok)throw fail(`VoiceStudio returned ${r.status}. Check the server address and API key.`);return r;}
 return {
 async check(){await request(connection(),'/health');return {ok:true};},
 async claim(jobId){const config=connection();await store.update(s=>{const j=s.jobs.find(x=>x.id===jobId);if(j?.status!=='prepared'||j.kind!=='voice')throw fail('Save a new speech take first.');Object.assign(j,{status:'submitting',voicestudioUrl:config.url,error:''});});return config;},
 async run(jobId,config){try{const j=store.read().jobs.find(x=>x.id===jobId);const form=new FormData();for(const [k,v] of Object.entries({text:j.text,language:j.language,num_step:'32',wav_bits:'16',engine:'omnivoice',ref_text:j.referenceText||''}))form.set(k,v);const a=store.read().assets.find(a=>a.id===j.inputs.voice&&a.type.startsWith('audio/'));if(!a)throw fail('Add a voice recording to your twin.');const bytes=await readFile(join(dataDir,'media',a.id));if(bytes.length>20*1024*1024)throw fail('Use a voice recording smaller than 20 MB.');form.set('ref_audio',new Blob([bytes],{type:a.type}),'reference.wav');await store.update(s=>Object.assign(s.jobs.find(x=>x.id===jobId),{status:'running',stage:'Generating speech with VoiceStudio'}));const r=await request(config,'/generate',{method:'POST',body:form});let size=0,chunks=[];for await(const c of r.body){size+=c.length;if(size>128*1024*1024)throw fail('Audio exceeds 128 MB.');chunks.push(c);}const audio=Buffer.concat(chunks);if(audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw fail('VoiceStudio returned invalid WAV audio.');const asset={id:id(),name:j.sectionTitle+'.wav',type:'audio/wav',size,createdAt:now()};await writeFile(join(dataDir,'media',asset.id),audio,{mode:0o600});await store.update(s=>{s.assets.push(asset);Object.assign(s.jobs.find(x=>x.id===jobId),{status:'completed',stage:'Ready',outputId:asset.id,updatedAt:now()});});}catch(e){await store.update(s=>Object.assign(s.jobs.find(x=>x.id===jobId),{status:'failed',error:e.status?e.message:'Could not complete VoiceStudio speech. Check the VoiceStudio connection and try a new take.',updatedAt:now()}));}}
 };
}
