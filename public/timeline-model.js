import {trimRange} from './timeline-editor.js';
export function audioTracks(tracks){return tracks?.length?tracks:[{id:'voice',name:'Voice',volume:1,muted:false}];}
export function arrangeAudio(clips,tracks){
 const list=audioTracks(tracks),ends=new Map(list.map(t=>[t.id,0]));
 const placed=clips.map(c=>{const track=list.find(t=>t.id===c.sec.trackId)||list[0],range=trimRange(c.sec.trims?.[c.take?.outputId],c.duration),length=range.end-range.start;
 const start=Number.isFinite(c.sec.offset)?Math.max(0,c.sec.offset):ends.get(track.id);const end=start+length;ends.set(track.id,Math.max(ends.get(track.id),end));return {...c,trackId:track.id,start,end,range,gain:track.muted?0:track.volume??1};});
 return {clips:placed,duration:Math.max(0,...placed.map(c=>c.end)),tracks:list};
}
export function playbackPlan(clips,position){return clips.filter(c=>!c.pending&&c.end>position).map(c=>({id:c.sec.id,delay:Math.max(0,c.start-position),offset:c.range.start+Math.max(0,position-c.start),duration:c.end-Math.max(position,c.start),trackId:c.trackId}));}

// Keep drafts editable before a generated take exists. Width is an estimate, never a waveform.
export function editableAudioClips(clips,decoded=[]) {
 const ready=new Map(decoded.map(c=>[c.sec.id,c]));
 return clips.map(c=>ready.get(c.sec.id)||{...c,pending:true,duration:Math.max(3,(c.sec.text||'').trim().split(/\s+/).filter(Boolean).length*.4)});
}

export function linkedVideo(clip,jobs){return jobs.filter(j=>j.sectionId===clip.sec.id&&j.sourceJobId===clip.take?.id&&j.status==='completed'&&j.outputId&&(j.sceneImageId?(j.sceneImageId===clip.sec.sceneImageId&&j.scenePrompt===clip.sec.scenePrompt):!clip.sec.sceneImageId&&!clip.sec.scenePrompt)).sort((a,b)=>Number(!!b.approved)-Number(!!a.approved)||new Date(b.createdAt)-new Date(a.createdAt))[0];}
export function videoAtTime(clips,jobs,time){const clip=clips.find(c=>!c.pending&&time>=c.start&&time<c.end&&linkedVideo(c,jobs));return clip?{clip,job:linkedVideo(clip,jobs),time:clip.range.start+time-clip.start}:null;}
