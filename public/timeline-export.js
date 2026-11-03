import {arrangeAudio} from './timeline-model.js';
import {trimRange} from './timeline-editor.js';
// PCM is interleaved in timeline order; input samples share the decoder's rate.
export function timelineWav(parts,sampleRate=48000,tracks){
 if(!parts.length)throw Error('No audio clips to export.');
 const channels=Math.min(2,Math.max(...parts.map(p=>p.channels.length)));
 const layout=arrangeAudio(parts.map((p,i)=>({...p,sec:{id:String(i),trackId:p.trackId,offset:p.offset,trims:{source:p.trim}},take:{outputId:'source'},duration:p.channels[0].length/sampleRate})),tracks);
 const spans=layout.clips.map(p=>({...p,sourceStart:Math.round(p.range.start*sampleRate),sourceEnd:Math.min(p.channels[0].length,Math.round(p.range.end*sampleRate)),targetStart:Math.round(p.start*sampleRate)}));
 const frames=Math.max(...spans.map(p=>p.targetStart+p.sourceEnd-p.sourceStart)),size=frames*channels*2;
 if(size>256*1024*1024)throw Error('This export exceeds 256 MB. Export a shorter production.');
 const bytes=new Uint8Array(44+size),v=new DataView(bytes.buffer),str=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,36+size,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,size,true);
 const mix=new Float32Array(frames*channels);
 for(const p of spans)for(let i=p.sourceStart;i<p.sourceEnd;i++)for(let c=0;c<channels;c++)mix[(p.targetStart+i-p.sourceStart)*channels+c]+=(p.channels[Math.min(c,p.channels.length-1)][i]||0)*p.gain;
 for(let i=0;i<mix.length;i++){const x=Math.max(-1,Math.min(1,mix[i]));v.setInt16(44+i*2,Math.round(x*(x<0?32768:32767)),true);}

 return bytes;
}
export async function renderTimelineAudio(clips,url,onProgress=()=>{},tracks){
 const missing=clips.filter(c=>!c.take);if(missing.length)throw Error('Add a finished audio take for: '+missing.map(c=>c.sec.title).join(', '));
 const ctx=new AudioContext({sampleRate:48000}),parts=[];let total=0;
 try{for(let i=0;i<clips.length;i++){const c=clips[i];onProgress(i+1,clips.length);const res=await fetch(url(c.take.outputId));if(!res.ok)throw Error('Could not load '+c.sec.title);const decoded=await ctx.decodeAudioData(await res.arrayBuffer());total+=decoded.length*decoded.numberOfChannels*4;if(total>512*1024*1024)throw Error('This production is too large to export in memory.');parts.push({channels:Array.from({length:Math.min(decoded.numberOfChannels,2)},(_,i)=>decoded.getChannelData(i)),trim:c.sec.trims?.[c.take.outputId],trackId:c.sec.trackId,offset:c.sec.offset});}return timelineWav(parts,ctx.sampleRate,tracks);}finally{await ctx.close();}
}
