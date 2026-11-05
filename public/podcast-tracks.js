export const speakerTrackId = speakerId => 'speaker-'+speakerId;
export const isDialogueSection = section => !!section.speakerId && (!section.audioAssetId || !!section.sourceTakeId);

// Keep original offsets, source trims, takes and music when introducing lanes.
export function ensurePodcastTracks(project) {
  if(project?.projectType!=='podcast')return false;
  const speakers=project.podcast?.speakers||[],existing=project.tracks||[],tracks=structuredClone(existing);
  const assignments=new Map();let changed=false;
  for(const speaker of speakers){
    let track=tracks.find(t=>t.speakerId===speaker.id)||tracks.find(t=>t.id===speakerTrackId(speaker.id));
    if(!track){
      const first=project.sections.find(s=>isDialogueSection(s)&&s.speakerId===speaker.id),source=existing.find(t=>t.id===first?.trackId);
      track={id:speakerTrackId(speaker.id),name:speaker.name,kind:'speaker',speakerId:speaker.id,volume:source?.volume??1,muted:source?.muted??false};tracks.push(track);changed=true;
    }else if(track.kind!=='speaker'||track.speakerId!==speaker.id){track.kind='speaker';track.speakerId=speaker.id;changed=true;}
    for(const section of project.sections){
      if(!isDialogueSection(section)||section.speakerId!==speaker.id)continue;
      // Preserve explicit user placement on other custom lanes.
      if(!section.trackId||section.trackId==='voice'||!existing.some(t=>t.id===section.trackId))assignments.set(section.id,track.id);
    }
  }
  const used=new Set(project.sections.map(s=>assignments.get(s.id)||s.trackId));
  const retained=tracks.filter(t=>!(t.id==='voice'&&!used.has(t.id))&&!(t.kind==='speaker'&&!speakers.some(s=>s.id===t.speakerId)&&!used.has(t.id))).sort((a,b)=>Number(a.kind==='music'||a.id==='music')-Number(b.kind==='music'||b.id==='music'));
  if(retained.length>16)throw Error('Remove an unused audio track before adding another speaker.');
  if(retained.length!==tracks.length||retained.some((t,i)=>t.id!==existing[i]?.id))changed=true;
  if(assignments.size)changed=true;
  if(changed){project.tracks=retained;for(const section of project.sections)if(assignments.has(section.id))section.trackId=assignments.get(section.id);}
  return changed;
}
