import {mkdtemp,writeFile,stat,rm,copyFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {id,now} from './store.mjs';
import {prepareDub} from '../public/dubbing-model.js';
const exec=promisify(execFile);
const fail=message=>Object.assign(new Error(message),{status:400});
export function createDubbing(store,dir) {
  function assetPath(a){const name=a.fileName||a.id;if(!name||basename(name)!==name||name.includes('\\'))throw fail('Invalid media path.');return join(dir,'media',name);}
  function asset(aid,kind){const a=store.read().assets.find(a=>a.id===aid&&a.type.startsWith(kind+'/'));if(!a)throw fail(`Choose a valid ${kind} file.`);return a;}
  async function perform(mode,videoId,extra={}) {
    if(process.platform!=='darwin')throw fail('Video dubbing currently requires macOS.');
    const video=asset(videoId,'video'),work=await mkdtemp(join(dir,'dub-'));
    try {
      // Preserve extensions for AVFoundation even for prototype uploads stored by ID.
      const local=join(work,'source'+(video.type==='video/quicktime'?'.mov':video.type==='video/webm'?'.webm':'.mp4'));
      await copyFile(assetPath(video),local);
      const output=join(work,mode==='extract'?'speech.wav':'dub.mp4'),manifest=join(work,'request.json');
      let audio;
      if(extra.audioId){const a=asset(extra.audioId,'audio');audio=join(work,'voice'+(['audio/wav','audio/x-wav'].includes(a.type)?'.wav':a.type==='audio/mpeg'?'.mp3':'.m4a'));await copyFile(assetPath(a),audio);}
      await writeFile(manifest,JSON.stringify({mode,video:local,output,...extra,audio}),{mode:0o600});
      let result;
      try {result=await exec('/usr/bin/swift',[new URL('./dub-video.swift',import.meta.url).pathname,manifest],{timeout:180000,maxBuffer:1024*1024});}
      catch(e){throw fail(e.killed?'Video processing timed out. Try a shorter video.':e.stderr?.trim().split('\n').at(-1)||'Could not process this video. Try an H.264 MP4 or MOV.');}
      const info=JSON.parse(result.stdout);
      if(mode==='inspect')return info;
      const size=(await stat(output)).size;if(!size||size>512*1024*1024)throw fail('Output exceeds 512 MB. Use a shorter video.');
      const aid=id(),a={id:aid,name:mode==='extract'?'Video transcript audio.wav':(extra.title||'Dubbed video')+'.mp4',type:mode==='extract'?'audio/wav':'video/mp4',size,createdAt:now(),duration:info.duration};
      await copyFile(output,join(dir,'media',aid));
      return {asset:a,...info};
    } finally {await rm(work,{recursive:true,force:true});}
  }
  return {
    inspect:aid=>perform('inspect',aid),
    async extract(aid){const {asset:a}=await perform('extract',aid);await store.update(s=>s.assets.push(a));return a;},
    async start(body){
      let job;
      await store.update(s=>{try{job={...prepareDub(s,body),id:id(),createdAt:now(),updatedAt:now()};}catch(e){throw fail(e.message);}if(s.jobs.some(j=>j.projectId===job.projectId&&j.kind==='dub'&&j.status==='running'))throw fail('This project is already rendering a dub.');s.jobs.unshift(job);});
      void (async()=>{try {
        const result=await perform('render',job.inputs.video,{audioId:job.inputs.audio,...job.dubbing,title:job.projectTitle+' — dubbed'});
        await store.update(s=>{s.assets.push(result.asset);Object.assign(s.jobs.find(j=>j.id===job.id),{status:'completed',stage:'Dubbed video ready',outputId:result.asset.id,duration:result.duration,updatedAt:now()});});
      }catch(e){await store.update(s=>Object.assign(s.jobs.find(j=>j.id===job.id),{status:'failed',error:e.message,updatedAt:now()}));}})();
      return job;
    }
  };
}
