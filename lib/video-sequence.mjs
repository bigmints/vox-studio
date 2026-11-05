import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {id,now} from './store.mjs';
import {planVoiceVideo} from '../public/video-plan.js';
const exec=promisify(execFile);
export function sequenceOptions(b,m,source){
 const v=b.sequence;if(!v)return undefined;
 if(!source?.outputId||!Number.isFinite(v.audioStart)||v.audioStart<0||!Number.isFinite(v.duration)||v.duration<=0)throw Error('Invalid voice clip timing');
 return {duration:v.duration,audioStart:v.audioStart,segments:planVoiceVideo(v.duration,m.supported_durations),audio:source.outputId};
}
export async function advanceSequence(store,dir,j,client){
 const children=store.read().jobs.filter(x=>x.parentVideoId===j.id);
 const last=children.at(-1);
 if(last&&!['completed','failed'].includes(last.status)){
  if(last.status==='submitting')throw Error('Shot submission was interrupted. Check OpenRouter activity before starting a new video.');
  await client.run(last.id);return;
 }
 if(last?.status==='failed')throw Error(last.error||'A shot failed.');
 if(children.length<j.sequence.segments.length){
  const index=children.length,child={...j,id:id(),kind:'video',sequence:undefined,parentVideoId:j.id,videoRemoteId:undefined,submissionAttempted:false,status:'submitting',video:{...j.video,duration:j.sequence.segments[index]},prompt:`${j.prompt}\nNarration context: ${j.text}\nShot ${index+1} of ${j.sequence.segments.length}. Create a coherent continuation of this scene. Keep the subject upright and preserve the reference identity.`};
  await store.update(s=>{s.jobs.push(child);Object.assign(s.jobs.find(x=>x.id===j.id),{stage:`Generating shot ${index+1} of ${j.sequence.segments.length}`,status:'running'});});await client.run(child.id,true);return;
 }
 const state=store.read(),files=children.map(c=>state.assets.find(a=>a.id===c.outputId));
 const aid=id(),fileName=aid+'.mp4',audio=state.assets.find(a=>a.id===j.sequence.audio);if(!audio)throw Error('Voice audio is missing');
 const manifest=join(dir,'media',j.id+'.json');await writeFile(manifest,JSON.stringify({files:files.map(a=>join(dir,'media',a.fileName||a.id)),audio:join(dir,'media',audio.fileName||audio.id),duration:j.sequence.duration,audioStart:j.sequence.audioStart}));
 await exec('/usr/bin/swift',[new URL('./compose-video.swift',import.meta.url).pathname,manifest,join(dir,'media',fileName)],{timeout:180000,maxBuffer:1024*1024});
 const size=(await stat(join(dir,'media',fileName))).size;if(size>512*1024*1024)throw Error('Assembled video exceeds 512 MB');
 await store.update(s=>{s.assets.push({id:aid,fileName,name:j.sectionTitle+'.mp4',type:'video/mp4',size,createdAt:now()});Object.assign(s.jobs.find(x=>x.id===j.id),{status:'completed',outputId:aid,stage:'Full voice clip video ready',error:''});});
}
