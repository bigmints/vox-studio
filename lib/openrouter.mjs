import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {id,now} from './store.mjs';
export const has=(m,k,v)=>Array.isArray(m[k])&&m[k].includes(v);
export const supports=(m,use)=>use==='speech'?has(m,'outputs','speech')&&has(m,'endpoints','/api/v1/audio/speech'):['writing','listening'].includes(use)&&has(m,'inputs',use==='writing'?'text':'audio')&&has(m,'outputs','text')&&(use!=='writing'||m.outputs.every(x=>x==='text'))&&has(m,'endpoints','/api/v1/chat/completions');
export const entry=m=>({id:m.id,name:m.name,inputs:m.architecture?.input_modalities||[],outputs:m.architecture?.output_modalities||[],voices:m.supported_voices||[],endpoints:m.endpoints||[],pricing:m.pricing});
export function decodeAudio(bytes,type){
 if(type.startsWith('audio/pcm')){const params=Object.fromEntries(type.split(';').slice(1).map(p=>p.trim().split('=')));const rate=Number(params.rate),channels=Number(params.channels);if(!Number.isInteger(rate)||rate<8000||rate>192000||![1,2].includes(channels)||!bytes.length||bytes.length%(channels*2))throw Error('Audio parameters are missing or unsupported');const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(bytes.length+36,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(channels,22);h.writeUInt32LE(rate,24);h.writeUInt32LE(rate*channels*2,28);h.writeUInt16LE(channels*2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(bytes.length,40);return {bytes:Buffer.concat([h,bytes]),ext:'wav',type:'audio/wav'};}
 if(bytes.length<3||!(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0))throw Error('The model returned an unsupported audio format');return {bytes,ext:'mp3',type:'audio/mpeg'};
}
export function createOpenRouter(store,dataDir,key,fetcher=fetch){
 const base='https://openrouter.ai/api/v1';
 const fail=m=>Object.assign(new Error(m),{status:400});
 const auth=()=>{const k=key();if(!k)throw fail('Add your OpenRouter key in Settings');return {Authorization:`Bearer ${k}`,'Content-Type':'application/json','X-OpenRouter-Title':'MyTwin'};};
 async function request(path,options={}){const r=await fetcher(base+path,{signal:AbortSignal.timeout(180000),redirect:'error',...options});if(!r.ok)throw fail(`OpenRouter returned ${r.status}. Check your key, credits and model settings.`);return r;}
 const get=async path=>(await request(path)).json();
 const model=(id,use)=>{const m=store.read().settings.catalog?.models.find(m=>m.id===id&&supports(m,use));if(!m)throw fail('Refresh models and choose a compatible model');return m;};
 async function details(id){const v=await get('/models/'+id.split('/').map(encodeURIComponent).join('/')+'/endpoints');return {model:id,cloning:v.data?.endpoints?.some(e=>e.supports_voice_cloning===true)||false};}
 async function reference(id){const a=store.read().assets.find(a=>a.id===id&&a.type.startsWith('audio/'));if(!a)throw fail('Add a voice sample first');const path=join(dataDir,'media',a.id);if((await stat(path)).size>20*1024*1024)throw fail('Use an audio sample smaller than 20 MB for OpenRouter');return {asset:a,data:(await readFile(path)).toString('base64')};}
 async function speech(jobId){const j=store.read().jobs.find(j=>j.id===jobId),m=model(j.engine,'speech');
  const body={model:j.engine,input:j.text,response_format:/^(google|heygen)\//.test(m.id)?'pcm':'mp3'};
  if(j.voiceMode==='clone'){if(!(await details(j.engine)).cloning)throw fail('This model cannot clone your voice');const r=await reference(j.inputs.voice);body.input_references=[{type:'input_audio',input_audio:{data:`data:${r.asset.type};base64,${r.data}`}}];}
  else {if(!j.voice||!has(m,'voices',j.voice))throw fail('Choose a listed voice');body.voice=j.voice;}
  await store.update(s=>{const j=s.jobs.find(j=>j.id===jobId);j.status='running';j.stage='Creating voice';});
  const response=await request('/audio/speech',{method:'POST',headers:auth(),body:JSON.stringify(body)});
  const type=response.headers.get('content-type')||'';if(!type.startsWith('audio/')&&!type.startsWith('application/octet-stream'))throw fail('OpenRouter did not return audio');
  let size=0,chunks=[];for await(const c of response.body){size+=c.length;if(size>128*1024*1024)throw fail('Audio exceeds 128 MB');chunks.push(c);}const bytes=Buffer.concat(chunks);
  const audio=decodeAudio(bytes,type);
  const a={id:id(),name:j.sectionTitle+'.'+audio.ext,type:audio.type,size:audio.bytes.length,createdAt:now()};await writeFile(join(dataDir,'media',a.id),audio.bytes,{mode:0o600});
  await store.update(s=>{s.assets.push(a);Object.assign(s.jobs.find(x=>x.id===jobId),{status:'completed',outputId:a.id,updatedAt:now()});});
 }
 return {
  async models(){const responses=await Promise.all([get('/models'),get('/models?output_modalities=speech')]);const map=new Map();for(const v of responses){if(!Array.isArray(v.data))throw fail('Invalid model catalog');for(const m of v.data)map.set(m.id,entry(m));}const catalog={models:[...map.values()].sort((a,b)=>a.name.localeCompare(b.name)),updatedAt:now()};await store.update(s=>s.settings.catalog=catalog);return catalog;},
  async check(){await request('/key',{headers:auth()});return {ok:true};},details,
  async claim(id){auth();await store.update(s=>{const j=s.jobs.find(j=>j.id===id);if(j?.status!=='prepared')throw fail('This take has already been submitted. Save a new take to try again.');j.status='submitting';j.error='';});},
  async run(id){try{await speech(id);}catch(e){await store.update(s=>Object.assign(s.jobs.find(j=>j.id===id),{status:'failed',error:e.status?e.message:'Speech request interrupted. Check OpenRouter activity before starting another take; credits may have been used.',updatedAt:now()}));}},
  async listen(assetId){const m=model(store.read().settings.listeningModel,'listening'),r=await reference(assetId);const format=r.asset.type==='audio/mpeg'?'mp3':['audio/wav','audio/x-wav'].includes(r.asset.type)?'wav':null;if(!format)throw fail('Use WAV or MP3 for transcription');const result=await (await request('/chat/completions',{method:'POST',headers:auth(),body:JSON.stringify({model:m.id,messages:[{role:'user',content:[{type:'text',text:'Transcribe this recording in its original language. Return only the transcript.'},{type:'input_audio',input_audio:{data:r.data,format}}]}],max_tokens:8000})})).json();const text=result.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw fail('The model returned no transcript');return {text,model:m.id};}
 };
}
