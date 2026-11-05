export const podcastPacing={tight:{name:'Quick exchange',gap:.08},natural:{name:'Natural conversation',gap:.18},relaxed:{name:'Relaxed conversation',gap:.35},off:{name:'Original timing',gap:0}};

// Trim quiet edges only. Preserve internal pauses and leave room around speech.
// This is a non-destructive playback range; original takes are never changed.
export function speechBounds(channels,sampleRate){
 const length=channels[0]?.length||0,duration=length/sampleRate;
 if(!length||!sampleRate||duration<.5)return {start:0,end:duration};
 const window=Math.max(1,Math.round(sampleRate*.01)),levels=[];
 for(let at=0;at<length;at+=window){let level=0;for(const samples of channels){let sum=0;const end=Math.min(at+window,samples.length);for(let i=at;i<end;i++)sum+=samples[i]*samples[i];level=Math.max(level,Math.sqrt(sum/Math.max(1,end-at)));}levels.push(level);}
 const threshold=Math.max(.003,levels.reduce((peak,level)=>Math.max(peak,level),0)*.02);
 const first=levels.findIndex(level=>level>threshold);let last=levels.length-1;while(last>=0&&levels[last]<=threshold)last--;
 if(first<0)return {start:0,end:duration};
 const start=Math.max(0,first*window/sampleRate-.06),end=Math.min(duration,(last+1)*window/sampleRate+.1);
 return end-start<.15?{start:0,end:duration}:{start,end};
}
export function pacingTrim(section,outputId,buffer){
 const manual=section.trims?.[outputId];
 if(manual)return manual;
 if(!section.autoPace)return undefined;
 return speechBounds(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)),buffer.sampleRate);
}
