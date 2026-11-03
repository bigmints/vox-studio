import {startMediaShare} from './media-share.mjs';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {id,now} from './store.mjs';
const fail=m=>Object.assign(new Error(m),{status:400});
export function avatarOptions(value={}){
 const v=value??{},out={};
 for(const [key,allowed,fallback] of [['resolution',['720p','1080p'],'720p'],['aspect_ratio',['16:9','9:16','1:1'],'16:9']]){
  const selected=v[key]??fallback;if(!allowed.includes(selected))throw fail(`Choose a supported avatar ${key}.`);out[key]=selected;
 }
 return out;
}
export function validateAvatar(s,inputs,engine){
 if(engine!=='heygen/avatar-iv')throw fail('Choose HeyGen Avatar IV for OpenRouter avatars.');
 for(const [key,types,limit] of [['avatar',['image/jpeg','image/png','image/webp'],20],['audio',['audio/wav','audio/mpeg','audio/mp3','audio/mp4','audio/x-wav'],50]]){
  const a=s.assets.find(a=>a.id===inputs[key]);if(!a||!types.includes(a.type))throw fail(`Use a supported ${key} reference for Avatar IV.`);
  if(a.size>limit*1024*1024)throw fail(`${key} exceeds ${limit} MB.`);
 }
}
export function prepareVideo(s,b){
 const p=s.projects.find(p=>p.id===b.projectId),sec=p?.sections.find(x=>x.id===b.sectionId);
 if(!sec?.text.trim())throw fail('Describe the video first.');
 if(b.scene){if(!sec.sceneImageId||!sec.scenePrompt?.trim())throw fail('Choose a scene image and describe the scene.');if(!s.jobs.some(j=>j.id===b.sourceJobId&&j.projectId===p.id&&j.sectionId===sec.id&&j.kind==='voice'&&j.status==='completed'&&j.text===sec.text))throw fail('Generate the current voiceover first.');}
const m=s.settings.videoModels?.find(m=>m.id===b.engine&&m.supported_durations?.length);if(!m)throw fail('Refresh video models and choose a model.');
 const video={generate_audio:false};
 for(const [key,field] of [['duration','supported_durations'],['resolution','supported_resolutions'],['aspect_ratio','supported_aspect_ratios']]){
  const v=b.video?.[key];if(v!==undefined&&v!==''){if(!m[field]?.includes(v))throw fail(`Choose a supported ${key}.`);video[key]=v;}
 }
 const profile=s.profiles.find(x=>x.id===p.profileId),inputs={};
 if(b.useImage||b.scene){if(!m.supported_frame_images?.includes('first_frame'))throw fail('This model does not support a first-frame photo.');const a=s.assets.find(a=>a.id===(b.scene?sec.sceneImageId:profile?.avatarAssetId));if(!a||!['image/jpeg','image/png','image/webp'].includes(a.type))throw fail('Select a twin with a JPG, PNG or WebP photo.');if(a.size>20*1024*1024)throw fail('Use a photo smaller than 20 MB.');inputs.avatar=a.id;}
 return {id:id(),projectId:p.id,sectionId:sec.id,projectTitle:p.title,sectionTitle:sec.title,profileName:profile?.name||'Text prompt',kind:'video',provider:'openrouter',engine:m.id,text:sec.text,...(b.scene?{prompt:sec.scenePrompt,scenePrompt:sec.scenePrompt,sceneImageId:sec.sceneImageId,sourceJobId:b.sourceJobId}:{}),video,inputs,status:'prepared',stage:'Saved',createdAt:now(),updatedAt:now(),approved:false};
}
export function createVideo(store,dir,key,fetcher=fetch,shareAudio=startMediaShare){
 const base='https://openrouter.ai/api/v1',active=new Set(),shares=new Map();
 const auth=()=>{if(!key())throw fail('Add your OpenRouter key in Settings.');return {Authorization:`Bearer ${key()}`,'Content-Type':'application/json'};};
 const job=id=>store.read().jobs.find(j=>j.id===id);
 const patch=(id,fields)=>store.update(s=>Object.assign(s.jobs.find(j=>j.id===id),fields,{updatedAt:now()}));
 async function request(path,options={}){const r=await fetcher(base+path,{signal:AbortSignal.timeout(180000),redirect:'error',...options});if(!r.ok){let detail='Check your key, credits and video settings.';try{const v=await r.json();if(typeof v.error?.message==='string'&&!/base64,|sk-or-/.test(v.error.message))detail=v.error.message.slice(0,600);}catch{}throw fail(`OpenRouter returned ${r.status}: ${detail}`);}return r;}
 async function poll(id){const j=job(id);if(!j.videoRemoteId||!['queued','running'].includes(j.status))return;
  const path='/videos/'+encodeURIComponent(j.videoRemoteId),r=await (await request(path,{headers:auth()})).json();
  if(['failed','cancelled','expired'].includes(r.status)){await patch(id,{status:r.status==='cancelled'?'cancelled':'failed',error:typeof r.error==='string'?r.error:'Video generation failed.'});return;}
  if(r.status!=='completed'){if(!['pending','in_progress'].includes(r.status))throw fail('Unrecognized video status. Refresh to check again.');await patch(id,{status:r.status==='pending'?'queued':'running',stage:r.status==='pending'?'Queued at OpenRouter':'Generating video',error:''});return;}
  const output=await request(path+'/content?index=0',{headers:auth()}),type=(output.headers.get('content-type')||'').split(';')[0];
  if(!['video/mp4','video/webm','application/octet-stream'].includes(type))throw fail('OpenRouter returned an unsupported video format.');
  let size=0;const chunks=[];for await(const c of output.body){size+=c.length;if(size>512*1024*1024)throw fail('Video exceeds 512 MB.');chunks.push(c);}const bytes=Buffer.concat(chunks);
  const mp4=bytes.length>=12&&bytes.subarray(4,8).toString()==='ftyp',webm=bytes.length>=4&&bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));if(!mp4&&!webm)throw fail('The download is not a supported video.');
  const a={id:idFactory(),name:j.sectionTitle+(mp4?'.mp4':'.webm'),type:mp4?'video/mp4':'video/webm',size,createdAt:now()};await writeFile(join(dir,'media',a.id),bytes,{mode:0o600});
  await store.update(s=>{s.assets.push(a);Object.assign(s.jobs.find(j=>j.id===id),{status:'completed',outputId:a.id,error:'',usage:r.usage,updatedAt:now()});});
 }
 return {
  async models(){const v=await (await request('/videos/models')).json();if(!Array.isArray(v.data))throw fail('Invalid video model catalog.');const models=v.data.filter(m=>typeof m.id==='string');await store.update(s=>s.settings.videoModels=models);return models;},
  async claim(id){auth();await store.update(s=>{const j=s.jobs.find(j=>j.id===id);if(!['video','avatar'].includes(j?.kind)||j.status!=='prepared')throw fail('This take has already been submitted. Save a new take to try again.');Object.assign(j,{status:'submitting',error:''});});},
  async run(id,submit=false){if(active.has(id))return;active.add(id);try{
   if(submit){const j=job(id);if(j?.status!=='submitting'||j.videoRemoteId)return;let body={model:j.engine,prompt:j.prompt||j.text,...j.video};
if(j.kind==='avatar'){validateAvatar(store.read(),j.inputs,j.engine);if(!j.audioShare)throw fail('Allow a temporary audio link before generating with OpenRouter.');body={model:j.engine,...avatarOptions(j.video),input_references:[]};for(const [key,type,limit] of [['avatar','image_url',20],['audio','audio_url',50]]){const a=store.read().assets.find(a=>a.id===j.inputs[key]),path=join(dir,'media',a.fileName||a.id);if((await stat(path)).size>limit*1024*1024)throw fail('Reference exceeds upload limit.');const bytes=await readFile(path);let url;if(key==='audio'){const share=await shareAudio(bytes,a.type);shares.set(id,share);url=share.url;}else url=`data:${a.type};base64,${bytes.toString('base64')}`;body.input_references.push({type,[type]:{url}});}}
    if(j.kind!=='avatar'&&j.inputs.avatar){const a=store.read().assets.find(a=>a.id===j.inputs.avatar),path=join(dir,'media',a.id);if((await stat(path)).size>20*1024*1024)throw fail('Use a photo smaller than 20 MB.');body.frame_images=[{type:'image_url',frame_type:'first_frame',image_url:{url:`data:${a.type};base64,${(await readFile(path)).toString('base64')}`}}];}
    await patch(id,{submissionAttempted:true,stage:'Submitting to OpenRouter'});const r=await (await request('/videos',{method:'POST',headers:auth(),body:JSON.stringify(body)})).json();if(typeof r.id!=='string'||!r.id)throw fail('No video job ID returned. Check OpenRouter activity before making another take.');await patch(id,{videoRemoteId:r.id,status:'queued',stage:'Queued at OpenRouter'});
   }else await poll(id);
  }catch(e){const known=!!job(id)?.videoRemoteId;await patch(id,{...(known?{}:{status:'failed'}),error:known?`${e.message} Refresh to retry checking this job.`:job(id)?.submissionAttempted?`${e.message} Check OpenRouter activity before starting another take; credits may have been used.`:e.message});}finally{if(['completed','failed','cancelled'].includes(job(id)?.status)){shares.get(id)?.close();shares.delete(id);}active.delete(id);}}
 };
}
const idFactory=id;
