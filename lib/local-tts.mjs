import {spawn} from 'node:child_process';
import {readFile,mkdir,stat,unlink} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {id,now} from './store.mjs';

const resources=join(dirname(fileURLToPath(import.meta.url)),'../local-tts');
export const localCatalog=JSON.parse(readFileSync(join(resources,'catalog.json'),'utf8'));
const fail=message=>Object.assign(new Error(message),{status:400});
export function speechOptions(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail('Invalid speech controls.');
 const result={};for(const [key,min,max,fallback] of [['speed',0.75,1.5,1],['sentencePause',0,2,0],['volume',0,2,1]]){
  const n=value[key]===undefined?fallback:value[key];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)throw fail(`Invalid speech ${key}. Use ${min}–${max}.`);result[key]=n;
 }return result;
}
export function validateLocal(b,language,referenceText){
 speechOptions(b.speech);
 const model=localCatalog[b.engine];
 if(b.kind!=='voice'||!model)throw fail('Choose Qwen3 or Kokoro for local speech.');
 if(!model.languages[language])throw fail('This local model does not support the selected language.');
 if(b.engine==='kokoro'&&!model.voices[b.voice])throw fail('Choose a Kokoro preset voice.');
 if(['qwen3','qwen3-hq'].includes(b.engine)&&!referenceText?.trim())throw fail('Add the exact voice recording transcript to your twin.');
}
export function runLocalProcess(root,operation,request){
 return new Promise((resolve,reject)=>{
  const uv=[join(resources,'uv'),'/opt/homebrew/bin/uv','/usr/local/bin/uv'].find(existsSync)||'uv';
  const script=[join(resources,'engine.py'),root,operation];
  const args=operation==='generate'?script:['run','--project',resources,'--frozen','--python','3.11','--managed-python','python',...script];
  const p=spawn(operation==='generate'?join(root,'venv/bin/python'):uv,args,{env:{...process.env,MYTWIN_PARENT_PID:String(process.pid),UV_PROJECT_ENVIRONMENT:join(root,'venv'),UV_PYTHON_INSTALL_DIR:join(root,'python'),UV_CACHE_DIR:join(root,'cache'),HF_HOME:join(root,'models'),HF_HUB_DISABLE_TELEMETRY:'1'},stdio:['pipe','pipe','pipe']});
  let out='',err='';const timer=setTimeout(()=>p.kill('SIGKILL'),operation==='download'?3600000:1800000);
  p.stdout.on('data',c=>out=(out+c).slice(-64000));p.stderr.on('data',c=>err=(err+c).slice(-4000));
  p.on('error',e=>{clearTimeout(timer);reject(fail('Could not start local TTS: '+e.message));});
  p.on('close',code=>{clearTimeout(timer);let result;try{result=JSON.parse(out.trim());}catch{}if(code!==0||result?.error||!result)reject(fail(result?.error||'Local TTS stopped. '+err));else resolve(result);});
  p.stdin.on('error',()=>{});p.stdin.end(JSON.stringify(request));
 });
}
export function createLocalTts(store,dataDir,runner=runLocalProcess){
 const root=join(dataDir,'local-tts');let setup={busy:false,error:''},chain=Promise.resolve();
 const serial=fn=>{const task=chain.then(fn);chain=task.catch(()=>{});return task;};
 async function status(){const models={};for(const [key,spec] of Object.entries(localCatalog)){let ready=false;try{ready=JSON.parse(await readFile(join(root,key+'.ready.json'),'utf8')).revision===spec.revision&&existsSync(join(root,'venv/bin/python'));}catch{}models[key]={...spec,ready};}return {supported:process.platform==='darwin'&&process.arch==='arm64',...setup,models};}
 return {
  status,
  async download(engine){if(!localCatalog[engine])throw fail('Unknown local model.');if(setup.busy)throw fail('A local model download is already in progress.');if(!(await status()).supported)throw fail('Built-in speech requires an Apple Silicon Mac.');setup={busy:true,engine,error:''};void serial(async()=>{await mkdir(root,{recursive:true});await runner(root,'download',{engine});}).catch(e=>{setup.error=e.message;}).finally(()=>{setup.busy=false;});return {ok:true};},
  async claim(jobId){await store.update(s=>{const j=s.jobs.find(j=>j.id===jobId);if(!j||j.provider!=='local'||j.status!=='prepared')throw fail('This take has already been submitted. Start a new take.');j.status='queued';j.stage='Waiting for local engine';});},
  async run(jobId){return serial(async()=>{let output;try{
   const j=store.read().jobs.find(j=>j.id===jobId);if(!j||j.status!=='queued')return;
   if(!(await status()).models[j.engine]?.ready)throw fail('Download this model in Settings → Local speech first.');
   validateLocal(j,j.language,j.referenceText);if(j.text.length>12000)throw fail('Split local scripts into takes of at most 12,000 characters.');
   const aid=id();output=join(dataDir,'media',aid);let reference;
   if(['qwen3','qwen3-hq'].includes(j.engine)){const a=store.read().assets.find(a=>a.id===j.inputs.voice&&a.type.startsWith('audio/'));if(!a)throw fail('Add a voice recording to your twin.');reference=join(dataDir,'media',a.id);}
   const started=await store.update(s=>{const job=s.jobs.find(x=>x.id===jobId);if(job.status!=='queued')return false;Object.assign(job,{status:'running',stage:'Generating speech on this Mac'});return true;});if(!started)return;
   const result=await runner(root,'generate',{...j,reference,output});
   const size=(await stat(output)).size;if(size<=44||size>128*1024*1024)throw fail('Local engine returned invalid audio.');
   const header=await readFile(output);if(header.toString('ascii',0,4)!=='RIFF'||header.toString('ascii',8,12)!=='WAVE')throw fail('Local engine did not return WAV audio.');
   await store.update(s=>{s.assets.push({id:aid,name:j.sectionTitle+'.wav',type:'audio/wav',size,createdAt:now()});Object.assign(s.jobs.find(x=>x.id===jobId),{status:'completed',stage:'Ready',outputId:aid,duration:result.duration,updatedAt:now()});});output=null;
  }catch(e){await store.update(s=>Object.assign(s.jobs.find(j=>j.id===jobId),{status:'failed',error:e.message,updatedAt:now()}));}finally{if(output){await unlink(output).catch(()=>{});await unlink(output.replace(/\.[^.\/]+$/,'')+'.partial.wav').catch(()=>{});}}});},
  async cancel(jobId){await store.update(s=>{const j=s.jobs.find(j=>j.id===jobId);if(!['prepared','queued'].includes(j?.status))throw fail('Local inference is already running. Wait for this take to finish.');j.status='cancelled';});}
 };
}
