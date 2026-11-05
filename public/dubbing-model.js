import {podcastVoiceRequest,voiceSnapshot,voiceIdentity} from './podcast-audio.js';

export const defaultDubbing = () => ({source:'upload',videoAssetId:'',prompt:'',start:0,timing:'natural'});
export function normalizeDubbing(value={},state) {
  const d={...defaultDubbing(),...value};
  if(!['upload','generate'].includes(d.source)||!['natural','fit'].includes(d.timing))throw Error('Choose a supported dubbing option.');
  if(!Number.isFinite(d.start)||d.start<0||d.start>7200)throw Error('Voice start must be between 0 and 7,200 seconds.');
  if(typeof d.prompt!=='string'||d.prompt.length>10000)throw Error('Keep the video prompt under 10,000 characters.');
  if(typeof d.videoAssetId!=='string'||d.videoAssetId.length>100)throw Error('Choose a video.');
  if(d.videoAssetId&&state&&!state.assets.some(a=>a.id===d.videoAssetId&&a.type.startsWith('video/')))throw Error('Choose an uploaded or generated video.');
  return {source:d.source,videoAssetId:d.videoAssetId,prompt:d.prompt,start:d.start,timing:d.timing};
}
export function dubbingVoiceRequest(state,project) {
  const request=podcastVoiceRequest(state,project,project.sections[0]);
  if(request.voiceMode!=='clone')throw Error('This twin uses a preset voice. Edit the twin to choose a voice cloning model and add your voice recording.');
  return {...request,reuseCurrent:true};
}
export function currentDubVoice(state,project) {
  try {
    const expected=voiceIdentity(voiceSnapshot(state,project,project.sections[0],dubbingVoiceRequest(state,project)));
    return state.jobs.find(j=>j.kind==='voice'&&j.status==='completed'&&j.outputId&&voiceIdentity(j)===expected);
  } catch {return undefined;}
}
export function dubMatches(job,project,voice) {
  const d=project.dubbing||defaultDubbing();
  return job.kind==='dub'&&job.projectId===project.id&&job.sourceJobId===voice?.id&&job.inputs?.video===d.videoAssetId&&job.dubbing?.start===d.start&&job.dubbing?.timing===d.timing;
}
export function prepareDub(state,body) {
  const p=state.projects.find(p=>p.id===body.projectId&&p.projectType==='dubbing');
  if(!p)throw Error('Choose a Video Dubbing project.');
  const d=normalizeDubbing(p.dubbing,state),sec=p.sections[0],profile=state.profiles.find(t=>t.id===p.profileId);
  if(!d.videoAssetId)throw Error('Upload or generate a video first.');
  const voice=state.jobs.find(j=>j.id===body.voiceJobId&&j.projectId===p.id&&j.sectionId===sec.id&&j.kind==='voice'&&j.status==='completed'&&j.outputId&&j.text===sec.text&&j.profileId===p.profileId&&j.language===p.language&&j.voiceMode!=='preset'&&j.inputs?.voice===profile?.voiceAssetId&&j.referenceText===(profile?.voiceTranscript||''));
  if(!voice||!profile||!state.assets.some(a=>a.id===voice.outputId&&a.type.startsWith('audio/')))throw Error('Generate a current take with your twin voice first.');
  return {projectId:p.id,sectionId:sec.id,projectTitle:p.title,sectionTitle:'Dubbed video',profileId:profile.id,profileName:profile.name,kind:'dub',provider:'native',engine:'Video dubbing',text:sec.text,sourceJobId:voice.id,inputs:{video:d.videoAssetId,audio:voice.outputId},dubbing:{start:d.start,timing:d.timing},status:'running',stage:'Rendering dubbed video',approved:false};
}
