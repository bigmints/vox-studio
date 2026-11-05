import {isLocalPreset,defaultLocalVoice} from './local-voices.js';
import {isPodcast,profileIdFor,speakerFor,presetVoiceFor,voiceTrackFor} from './project-model.js';

// Generation eligibility follows today's settings. Playback follows the saved
// take for each clip, so editing a shared twin never removes existing audio.
export function voiceTakeBelongsToClip(job,project,section){
  return !!section&&job.projectId===project?.id&&job.sectionId===section.id&&job.kind==='voice'&&job.status==='completed'&&!!job.outputId&&job.text===section.text&&(!isPodcast(project)||job.speakerId===section.speakerId);
}
export function selectedVoiceTake(state,project,section){
  const takes=state.jobs.filter(job=>voiceTakeBelongsToClip(job,project,section));
  return takes.find(job=>job.id===section?.pendingVoiceTakeId)||takes.find(job=>job.id===section?.voiceTakeId)||takes.sort((a,b)=>Number(!!b.approved)-Number(!!a.approved)||new Date(b.createdAt)-new Date(a.createdAt))[0];
}
export function timelineVoiceTake(state,project,section){
  if(section.audioAssetId)return {id:section.sourceTakeId||'import:'+section.audioAssetId,outputId:section.audioAssetId};
  return selectedVoiceTake(state,project,section);
}

export function podcastVoiceRequest(state,project,section) {
  const profile=state.profiles.find(p=>p.id===profileIdFor(project,section));
  if(!profile)throw Error(`Choose a twin for ${speakerFor(project,section)?.name||section.title}.`);
  if(!section.text.trim())throw Error(`Write dialogue for ${section.title}, or remove the empty turn.`);
  const s=state.settings,provider=profile.voiceProvider||s.voiceProvider||'openrouter';
  const engine=provider==='local'?(profile.localEngine||s.localEngine||'qwen3'):provider==='voicestudio'?'omnivoice':provider==='openrouter'?(profile.speechModel||s.speechModel):(profile.voiceEngine||(s.capabilities?.engines||[]).find(e=>e.kind==='voice'&&e.ready)?.id);
  const voiceMode=provider==='local'?(isLocalPreset(engine)?'preset':'clone'):provider==='openrouter'?(profile.voiceMode||s.voiceMode||'clone'):'clone';
const voice=presetVoiceFor(project,section)||(provider==='local'?(profile.localVoice||s.localVoice||defaultLocalVoice(engine)):profile.speechModel?(profile.voice||''):s.voice||'');
  if(!engine)throw Error(`Choose a speech model for ${profile.name}.`);
  if(voiceMode==='preset'&&!voice)throw Error(`Choose a preset voice for ${profile.name}.`);
  if(voiceMode==='clone'&&!profile.voiceAssetId)throw Error(`Add a voice recording to ${profile.name}.`);
  if(provider==='local'&&voiceMode==='clone'&&!profile.voiceTranscript?.trim())throw Error(`Add the exact reference transcript to ${profile.name}.`);
  if(provider==='gx10'&&s.workerStatus!=='connected')throw Error('Connect GX10 before generating the episode.');
  if(provider==='openrouter'&&!s.openrouterConfigured)throw Error('Add an OpenRouter key in Settings.');
  if(provider==='voicestudio'&&!s.voicestudioConfigured)throw Error('Add a VoiceStudio key in Settings.');
  return {projectId:project.id,sectionId:section.id,kind:'voice',provider,engine,voiceMode,voice,...(provider==='local'?{instruct:engine==='qwen3-custom'?(profile.localVoiceInstruction||''):'',speech:{speed:1,sentencePause:0,volume:1,...s.localSpeech}}:{})};
}

// Jobs are immutable snapshots. Reuse only identical inputs, including delivery.
export function voiceIdentity(job) {
  return JSON.stringify([job.projectId,job.sectionId,job.profileId,job.speakerId||'',job.text,job.language,job.provider,job.engine,job.voiceMode||'clone',job.voiceMode==='preset'?job.voice:'',job.inputs?.voice||'',job.referenceText||'',job.instruct||'',job.provider==='local'?[job.speech?.speed??1,job.speech?.sentencePause??0,job.speech?.volume??1]:null]);
}
export function voiceSnapshot(state,project,section,request=podcastVoiceRequest(state,project,section)) {
  const profile=state.profiles.find(p=>p.id===profileIdFor(project,section));
  return {...request,profileId:profile.id,speakerId:section.speakerId||'',text:section.text,language:project.language,inputs:{voice:profile.voiceAssetId||''},referenceText:profile.voiceTranscript||''};
}
export function planTrackAudio(state,project,trackId) {
  const track=project.tracks?.find(t=>t.id===trackId);
  if(!track)throw Error('Choose an audio track.');
  const turns=project.sections.filter(s=>!s.audioAssetId&&s.text.trim()&&voiceTrackFor(project,s)?.id===trackId);
  if(!turns.length)throw Error('Add a scripted clip to this track first.');
  return planVoiceSections(state,project,turns);
}
export function planPodcastAudio(state,project) {
  if(!isPodcast(project))throw Error('Choose a Podcast project.');
  const turns=project.sections.filter(s=>!s.audioAssetId);
  if(!turns.length)throw Error('Add podcast dialogue first.');
return planVoiceSections(state,project,turns);
}
function planVoiceSections(state,project,turns) {
  return turns.map(section=>{
    const request=podcastVoiceRequest(state,project,section),snapshot=voiceSnapshot(state,project,section,request);
    const job=state.jobs.filter(j=>j.kind==='voice'&&['prepared','waiting','submitting','queued','running','completed'].includes(j.status)&&(j.status!=='completed'||j.outputId)&&voiceIdentity(j)===voiceIdentity(snapshot)).sort((a,b)=>Number(!!b.approved)-Number(!!a.approved)||new Date(b.createdAt)-new Date(a.createdAt))[0];
    return {sectionId:section.id,title:section.title,speaker:speakerFor(project,section)?.name,request,snapshot,job};
  });
}
export async function runPodcastAudio({plan,prepare,submit,poll,changed=()=>false,stopped=()=>false,onProgress=()=>{},pause=()=>new Promise(r=>setTimeout(r,1000))}) {
  let completed=0;
  for(const entry of plan) {
    if(stopped())return {completed,stopped:true};
    if(changed(entry))throw Error('The episode or voice settings changed. Generate again to use your latest edits.');
    let job=entry.job||await prepare({...entry.request,reuseCurrent:true});
    await onProgress({completed,total:plan.length,entry,job});
    if(['prepared','waiting'].includes(job.status)){if(stopped())return {completed,stopped:true};await submit(job.id);job=await poll(job.id);}
    while(['submitting','queued','running','waiting'].includes(job.status)) {
      if(stopped())return {completed,stopped:true};
      await pause();job=await poll(job.id);await onProgress({completed,total:plan.length,entry,job});
    }
    if(job.status!=='completed'||!job.outputId)throw Error(`${entry.title}: ${job.error||'This voice take did not complete. Check its take history.'}`);
    completed++;await onProgress({completed,total:plan.length,entry,job});
  }
  return {completed,stopped:false};
}
