const rate=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
const usd=n=>'$'+new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(n);
export function modelPrice(model,use){
 if(!model)return 'Price unavailable';
 if(use==='video'||use==='scene')return 'See model pricing';
 const p=model.pricing||{},input=rate(p.prompt),output=rate(p.completion),request=rate(p.request);
 const suffix=request>0?` · ${usd(request)}/request`:'';
 if(input===null||output===null)return 'Price unavailable';
 if(input===0&&output===0&&!Object.entries(p).some(([k,v])=>!['discount','overrides'].includes(k)&&rate(v)>0))return 'Free';
 let result;
 if(use==='speech'&&model.id==='bytedance-seed/seed-audio-1-0')result=`${usd(output*60)} / minute of audio`;
 else if(use==='speech'&&!model.id.startsWith('google/'))result=output===0?`${usd(input*1000)} / 1,000 characters`:'See model pricing';
 else {
  result=`${usd(input*1e6)} in · ${usd(output*1e6)} out / 1M tokens`;
  if(use==='speech')result+=' (audio output)';
  if(use==='listening')result+=rate(p.audio)!==null?` · ${usd(Number(p.audio)*1e6)} audio in / 1M tokens`:' · Audio rate not listed';
 }
 return result+suffix+(Array.isArray(p.overrides)&&p.overrides.length?' · Variable rates':'');
}
