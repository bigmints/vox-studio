export function wavBytes(chunks,sampleRate){
 const length=chunks.reduce((n,c)=>n+c.length,0),buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
 const text=(at,s)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+length*2,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*2,true);
 let at=44;for(const c of chunks)for(const value of c){const sample=Math.max(-1,Math.min(1,value));view.setInt16(at,sample<0?sample*32768:sample*32767,true);at+=2;}
 return new Uint8Array(buffer);
}
export async function startVoiceRecording({onTime,onLimit,isCancelled}){
 if(!navigator.mediaDevices?.getUserMedia)throw Error('Microphone recording is unavailable here. Import an audio file instead.');
 let stream,context,source,processor,timer,chunks=[],count=0,closed=false;
 const cleanup=()=>{clearInterval(timer);if(processor){processor.onaudioprocess=null;processor.disconnect();}source?.disconnect();stream?.getTracks().forEach(t=>t.stop());if(context&&context.state!=='closed')void context.close();};
 try{
  stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
  if(isCancelled()){cleanup();return null;}
  context=new AudioContext({sampleRate:24000});await context.resume();
  if(isCancelled()){cleanup();return null;}
  source=context.createMediaStreamSource(stream);
  // ScriptProcessor is retained for the macOS system webview's custom app origin.
  // Output is intentionally silent; only the microphone input is collected.
  processor=context.createScriptProcessor(4096,1,1);
  const limit=context.sampleRate*90;
  processor.onaudioprocess=e=>{if(closed)return;const c=e.inputBuffer.getChannelData(0),take=Math.min(c.length,limit-count);if(take>0){chunks.push(c.slice(0,take));count+=take;}if(count>=limit){closed=true;cleanup();onLimit(new File([wavBytes(chunks,context.sampleRate)],'voice-recording.wav',{type:'audio/wav'}));}};
  source.connect(processor);processor.connect(context.destination);
  timer=setInterval(()=>onTime(Math.floor(count/context.sampleRate)),250);
  return {stop(){if(closed)return null;closed=true;cleanup();if(count<context.sampleRate)throw Error('Record at least one second of speech.');return new File([wavBytes(chunks,context.sampleRate)],'voice-recording.wav',{type:'audio/wav'});},cancel(){closed=true;cleanup();chunks=[];}};
 }catch(e){cleanup();if(e.name==='NotAllowedError'||e.name==='SecurityError')throw Error('Microphone access was denied. Allow MyTwin in System Settings → Privacy & Security → Microphone, then try again.');if(e.name==='NotFoundError')throw Error('No microphone found. Connect a microphone and try again.');throw e;}
}
