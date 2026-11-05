// AudioBuffers can be played by a new AudioContext after an editor remount.
// Keep recent takes warm without retaining every take in a long editing session.
export class AudioBufferCache {
  constructor(limit=64*1024*1024){this.limit=limit;this.bytes=0;this.entries=new Map();}
  get(key){const entry=this.entries.get(key);if(!entry)return;this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
  set(key,value){
    const previous=this.entries.get(key);if(previous){this.bytes-=previous.bytes;this.entries.delete(key);}
    const bytes=value.buffer.length*value.buffer.numberOfChannels*4;
    if(bytes>this.limit)return;
    while(this.bytes+bytes>this.limit&&this.entries.size){const oldest=this.entries.keys().next().value;this.bytes-=this.entries.get(oldest).bytes;this.entries.delete(oldest);}
    this.entries.set(key,{value,bytes});this.bytes+=bytes;
  }
}
