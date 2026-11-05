import {trimRange} from './timeline-editor.js';
import {explicitVideoTake} from './video-takes.js';
export function audioTracks(tracks){return tracks?.length?tracks:[{id:'voice',name:'Voice',volume:1,muted:false}];}
export function arrangeAudio(clips,tracks){
 const list=audioTracks(tracks),ends=new Map(list.map(t=>[t.id,0])),sequences=new Map();
 const placed=clips.map(c=>{const track=list.find(t=>t.id===c.sec.trackId)||list[0],range=trimRange(c.sec.trims?.[c.take?.outputId],c.duration),length=range.end-range.start;
 const start=Number.isFinite(c.sec.offset)?Math.max(0,c.sec.offset):(c.sec.sequenceId?sequences.get(c.sec.sequenceId)||0:ends.get(track.id))+(c.sec.gapBefore||0);const end=start+length;if(c.sec.sequenceId)sequences.set(c.sec.sequenceId,Math.max(sequences.get(c.sec.sequenceId)||0,end));ends.set(track.id,Math.max(ends.get(track.id),end));return {...c,trackId:track.id,start,end,range,gain:track.muted?0:track.volume??1};});
 return {clips:placed,duration:Math.max(0,...placed.map(c=>c.end)),tracks:list};
}
export function playbackPlan(clips,position){return clips.filter(c=>!c.pending&&c.end>position).map(c=>({id:c.sec.id,delay:Math.max(0,c.start-position),offset:c.range.start+Math.max(0,position-c.start),duration:c.end-Math.max(position,c.start),trackId:c.trackId}));}

// Keep drafts editable before a generated take exists. Width is an estimate, never a waveform.
export function editableAudioClips(clips,decoded=[],durations=new Map()) {
 const ready=new Map(decoded.map(c=>[c.sec.id,c]));
 return clips.map(c=>{const previous=durations.get(c.sec.id);return ready.get(c.sec.id)||{...c,pending:true,duration:(previous?.text===c.sec.text?previous.duration:0)||Math.max(3,(c.sec.text||'').trim().split(/\s+/).filter(Boolean).length*.4)};});
}

export function linkedVideo(clip,jobs){return explicitVideoTake(clip,jobs)||jobs.filter(j=>j.sectionId===(clip.sec.sourceSectionId||clip.sec.id)&&j.sourceJobId===(clip.sec.sourceTakeId||clip.take?.id)&&j.status==='completed'&&j.outputId&&(j.sceneImageId?(j.sceneImageId===clip.sec.sceneImageId&&j.scenePrompt===clip.sec.scenePrompt&&(!clip.sec.sceneAspectRatio||(j.provider==='gx10'&&j.engine==='infinitetalk')||j.video?.aspect_ratio===clip.sec.sceneAspectRatio)):!clip.sec.sceneImageId&&!clip.sec.scenePrompt)).sort((a,b)=>Number(!!b.approved)-Number(!!a.approved)||new Date(b.createdAt)-new Date(a.createdAt))[0];}
export function videoAtTime(clips,jobs,time){const clip=clips.find(c=>!c.pending&&time>=c.start&&time<c.end&&linkedVideo(c,jobs));return clip?{clip,job:linkedVideo(clip,jobs),time:(linkedVideo(clip,jobs).sequence?0:clip.range.start)+time-clip.start}:null;}
