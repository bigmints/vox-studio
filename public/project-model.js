import {podcastPacing} from './audio-pacing.js';
export const projectType = project => project?.projectType || 'storytelling';
export const isPodcast = project => projectType(project) === 'podcast';
export const defaultPodcast = () => ({
  speakers: [{id:'host',name:'Host',profileId:'',voice:''},{id:'guest',name:'Guest',profileId:'',voice:''}],
  sceneImageId:'',
  scenePrompt:'A two-person podcast in a recording studio. Both characters sit across a table with microphones. Keep their appearance, seating, lighting and studio consistent between shots.'
});
export const speakerFor = (project, section) => isPodcast(project) ? project.podcast?.speakers?.find(s=>s.id===section?.speakerId) : undefined;
export function voiceTrackFor(project,section) {
  if(section?.trackId)return project?.tracks?.find(t=>t.id===section.trackId);
  return isPodcast(project)?project?.tracks?.find(t=>t.speakerId===section?.speakerId||t.id==='speaker-'+section?.speakerId):project?.tracks?.[0];
}
export const profileIdFor = (project, section) => voiceTrackFor(project,section)?.profileId || (isPodcast(project) ? speakerFor(project,section)?.profileId || '' : project?.profileId || '');
export const presetVoiceFor = (project,section) => voiceTrackFor(project,section)?.profileId ? '' : speakerFor(project,section)?.voice || '';
export function matchesSpeaker(project, section, take) {
  if(!section?.audioAssetId&&voiceTrackFor(project,section)?.profileId)return take.profileId===profileIdFor(project,section)&&(!isPodcast(project)||take.speakerId===section.speakerId);
  if (!isPodcast(project)) return true;
  const speaker=speakerFor(project,section);
  return !!speaker?.profileId && take.profileId===speaker.profileId && take.speakerId===speaker.id && (!speaker.voice || take.voiceMode!=='preset' || take.voice===speaker.voice);
}
export function projectSection(project, section) {
  if (!section || !isPodcast(project)) return section;
  const speaker=speakerFor(project,section), other=project.podcast?.speakers?.find(s=>s.id!==section.speakerId);
  const direction=speaker ? `${speaker.name} is speaking. ${other?.name || 'The other character'} listens naturally. Keep both characters in the same podcast set.` : '';
  const pacing=project.podcast?.pacing||'natural',first=project.sections?.find(s=>s.speakerId&&(!s.audioAssetId||s.sourceTakeId));
  return {...section,...(!section.audioAssetId||section.sourceTakeId?{sequenceId:'podcast-dialogue',autoPace:pacing!=='off',gapBefore:first?.id===section.id?0:podcastPacing[pacing]?.gap??.18}:{}),sceneImageId:section.sceneImageId || project.podcast?.sceneImageId || '',scenePrompt:[project.podcast?.scenePrompt,direction,section.scenePrompt].filter(Boolean).join('\n')};
}
export function validateProjectType(value) {
  if (value!==undefined && !['storytelling','podcast','dubbing'].includes(value)) throw new Error('Choose Story Telling, Podcast or Video Dubbing.');
  return value || 'storytelling';
}
export function normalizePodcast(value=defaultPodcast(), state) {
  if (!value || !Array.isArray(value.speakers) || (value.speakers.length<2||value.speakers.length>8)) throw new Error('A podcast supports a host and up to seven guests.');
  const speakers=value.speakers.map(s=>{
    if (!s || typeof s.id!=='string' || !s.id.trim() || s.id.length>100 || typeof s.name!=='string' || !s.name.trim() || s.name.trim().length>100) throw new Error('Give each character a name.');
    const profileId=typeof s.profileId==='string'?s.profileId:'';
    if (profileId && state && !state.profiles.some(p=>p.id===profileId)) throw new Error('Choose an existing twin for each character.');
    return {id:s.id,name:s.name.trim(),profileId,voice:typeof s.voice==='string'?s.voice.slice(0,200):''};
  });
  if (new Set(speakers.map(s=>s.id)).size!==speakers.length || new Set(speakers.map(s=>s.name.toLowerCase())).size!==speakers.length) throw new Error('Use a different name and ID for every speaker.');
  const sceneImageId=typeof value.sceneImageId==='string'?value.sceneImageId.slice(0,100):'';
  if (sceneImageId && state && !state.assets.some(a=>a.id===sceneImageId && ['image/png','image/jpeg','image/webp'].includes(a.type) && a.size<=20*1024*1024)) throw new Error('Choose a JPG, PNG or WebP studio image smaller than 20 MB.');
  const pacing=value.pacing||'natural';if(!podcastPacing[pacing])throw new Error('Choose a supported conversation timing.');
  return {speakers,pacing,sceneImageId,scenePrompt:typeof value.scenePrompt==='string'?value.scenePrompt.slice(0,8000):''};
}
export function validateSpeakers(sections, podcast) {
  if (sections.some(s=>!s.audioAssetId && !podcast.speakers.some(p=>p.id===s.speakerId))) throw new Error('Choose a character for every podcast turn.');
}
// A label starts a turn; following unlabeled lines belong to the same speaker.
export function parsePodcastScript(text, speakers) {
  if (!text.trim()) throw new Error('Paste your podcast script first.');
  const aliases=new Map();
  for (const [i,speaker] of speakers.entries()) for (const name of [speaker.name,speaker.id,...(i===0?['Host']:i===1?['Guest']:[`Guest ${i}`]),`Speaker ${i+1}`]) {
    const key=name.toLowerCase();
    if (aliases.has(key) && aliases.get(key)!==speaker.id) throw new Error('Character names conflict with Host, Guest or Speaker labels. Rename the characters.');
    aliases.set(key,speaker.id);
  }
  const turns=[];
  for (const line of text.replace(/\r\n?/g,'\n').split('\n')) {
    if (!line.trim()) continue;
    const label=line.match(/^\s*([^:：\n]{1,100})[:：]\s*(.*)$/), speakerId=label && aliases.get(label[1].trim().toLowerCase());
    if (label && !speakerId && !/^\s*https?:\/\//i.test(line)) throw new Error(`Unknown speaker “${label[1].trim()}”. Use ${speakers.map(s=>s.name).join(' or ')}.`);
    if (speakerId) turns.push({speakerId,text:label[2].trim()});
    else if (turns.length) turns.at(-1).text+='\n'+line.trim();
    else throw new Error(`Start each turn with a speaker name, for example “${speakers[0].name}: Hello.”`);
  }
  if (!turns.length || turns.some(t=>!t.text.trim())) throw new Error('Every speaker turn needs dialogue.');
  if (turns.length>100) throw new Error('Use up to 100 podcast turns.');
  if (turns.some(t=>t.text.length>50000)) throw new Error('Keep each turn under 50,000 characters.');
  return turns;
}
