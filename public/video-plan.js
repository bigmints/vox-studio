export function planVoiceVideo(duration,durations){
 if(!Number.isFinite(duration)||duration<=0)throw Error('Could not read the voice clip duration.');
 const allowed=[...new Set(durations)].filter(n=>Number.isInteger(n)&&n>0).sort((a,b)=>a-b);
 if(!allowed.length)throw Error('This model has no supported clip durations.');
 const segments=[];let remaining=duration;
 while(remaining>0.001){const seconds=allowed.find(n=>n>=remaining)||allowed.at(-1);segments.push(seconds);remaining-=seconds;if(segments.length>60)throw Error('Choose a model with longer clips for this voice take.');}
 return segments;
}
