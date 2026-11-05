import {localEngineChoices,isLocalPreset,isLocalClone,defaultLocalVoice,localVoiceChoices,previewTexts,previewSignature} from './local-voices.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(entries,value)=>entries.map(([id,label])=>`<option value="${escape(id)}" ${id===value?'selected':''}>${escape(label)}</option>`).join('');
export function mountVoicePicker(host,{existing,modelHost,api,getState,refresh,assetUrl,loadStatus,onModeChange,onChange=()=>{},getReference=async()=>({}),referenceSnapshot=()=>({})}) {
 let disposed=false,status=null,pending=false,selected=null,language=existing?.localVoiceLanguage||'en';const history=[];
 const initial=existing?.voiceDesign?'qwen3-design':existing?.localEngine||'kokoro';let remembered=existing?.localVoice||defaultLocalVoice(initial);
 host.innerHTML=`<div class="voice-browser twin-voice-workspace"><div class="voice-choice-pane">
 <div class="twin-section-heading"><h2 id="twin-voice-step-title">3. Choose a preset</h2><p id="twin-voice-step-note">Listen to a few voices, then choose your favourite.</p></div>
 <label>Language<select id="twin-voice-language"></select></label>
 <div id="twin-preset-browser"><label>Find a voice<input type="search" id="twin-voice-search" placeholder="Search name, accent or style…"></label><select id="twin-local-voice" aria-label="Selected preset voice" hidden></select><div id="twin-voice-list" class="twin-voice-list" aria-label="Available voices"></div></div>
 <label id="twin-voice-instruction-label"><span id="twin-voice-instruction-title">Describe the voice</span><textarea id="twin-voice-instruction" maxlength="2000" rows="4" placeholder="For example: a warm, friendly voice with a British accent and a relaxed pace.">${escape(existing?.voiceDesign?.instruct||existing?.localVoiceInstruction||'')}</textarea></label>
 <p class="note" id="twin-local-note"></p><div id="twin-clone-reference"></div>
 <button type="button" class="small twin-refresh-voices" id="twin-refresh-voices">Refresh availability</button></div>
 <section id="twin-voice-audition" class="voice-audition-pane" aria-label="Voice preview studio"><div class="twin-section-heading"><h2>Try it out</h2><p>Hear your twin say something before saving.</p></div><label>Words to preview<textarea id="twin-preview-text" maxlength="300" rows="4"></textarea></label>
 <div class="voice-preview-actions"><button type="button" class="primary" id="twin-generate-preview">Preview voice</button><button type="button" id="twin-download-voice" hidden>Download voice pack</button></div><p class="note" id="twin-preview-status" role="status" aria-live="polite">Checking available voices…</p><p class="error" id="twin-preview-error" role="alert"></p>
 <div class="twin-compare-heading"><h3>Listen & compare</h3><span id="twin-preview-count">0 previews</span></div><div id="twin-preview-results" class="voice-preview-results"></div></section></div>`;
 modelHost.innerHTML=`<label>2. Model<select id="twin-local-engine">${options(localEngineChoices,initial)}</select></label>`;
 const $=id=>id==='twin-local-engine'?modelHost.querySelector('#'+id):host.querySelector('#'+id),engine=()=>$('twin-local-engine').value;
 const error=e=>{if(!disposed)$('twin-preview-error').textContent=e?.message||String(e||'');};
 const request=()=>({engine:engine(),voice:isLocalPreset(engine())?$('twin-local-voice').value:'',language:$('twin-voice-language').value,text:$('twin-preview-text').value.trim(),instruct:['qwen3-custom','qwen3-design'].includes(engine())?$('twin-voice-instruction').value.trim():'',...(isLocalClone(engine())?referenceSnapshot():{})});
 const labelFor=j=>status?.models[j.engine]?.voices?.[j.voice]||(isLocalClone(j.engine)?'Your recorded voice':'Your created voice');
 function notify(){onChange({voice:labelFor(request()).split(' · ')[0],mode:engine()==='qwen3-design'?'Created voice':isLocalClone(engine())?'From your recording':'Ready-made voice',previewId:selected?.id||''});}
 function remember(j){if(!history.some(x=>x.id===j.id))history.unshift(j);if(history.length>6)history.pop();}
 function choose(j){if(isLocalClone(j.engine)&&previewSignature({...j,...referenceSnapshot()})!==previewSignature(j)){error('This preview uses an earlier recording. Preview your current recording to use it.');return;}selected=j;remembered=j.voice;$('twin-local-engine').value=j.engine;$('twin-voice-instruction').value=j.instruct||'';update(true,j.language);$('twin-local-voice').value=j.voice;$('twin-preview-text').value=j.text;showResults();showVoices();notify();}
 function showResults(){
  $('twin-preview-count').textContent=`${history.length} preview${history.length===1?'':'s'}`;
  $('twin-preview-results').innerHTML=history.length?history.map(j=>`<article class="voice-preview-card ${selected?.id===j.id?'is-selected':''}"><div><strong>${escape(labelFor(j).split(' · ')[0])}</strong><span>${Number(j.duration||0).toFixed(1)} sec</span></div><p>${escape(j.text)}</p><audio aria-label="Preview ${escape(labelFor(j).split(' · ')[0])}" controls preload="metadata" data-preview-audio="${escape(j.id)}" src="${escape(assetUrl(j.outputId))}"></audio><button type="button" data-select-preview="${escape(j.id)}" aria-pressed="${selected?.id===j.id}">${selected?.id===j.id?'✓ Selected for this twin':'Use this voice'}</button></article>`).join(''):'<div class="twin-preview-empty"><strong>Your previews will appear here</strong><p>Try a voice on the left. Replay and compare up to six previews here.</p></div>';
  for(const b of host.querySelectorAll('[data-select-preview]'))b.onclick=()=>choose(history.find(j=>j.id===b.dataset.selectPreview));
 }
 function showVoices(){
  const q=$('twin-voice-search').value.trim().toLocaleLowerCase(),voices=localVoiceChoices(status?.models,engine(),language).filter(([id,label])=>(label+' '+id).toLocaleLowerCase().includes(q));
  $('twin-voice-list').innerHTML=voices.length?voices.map(([id,label])=>{const [name,...details]=label.split(' · '),current=$('twin-local-voice').value===id;return `<div class="twin-voice-row ${current?'is-selected':''}"><button type="button" class="twin-voice-select" data-choose-voice="${escape(id)}" aria-pressed="${current}" aria-label="Choose ${escape(label)}"><span class="voice-choice-mark">${current?'●':'○'}</span><span><strong>${escape(name)}</strong><small>${escape(details.join(' · '))}</small></span></button><button type="button" class="small" data-audition-voice="${escape(id)}" aria-label="Preview ${escape(name)}" ${pending||!status?.models[engine()]?.ready?'disabled':''}>▶ Preview</button></div>`;}).join(''):`<p class="note">${status?'No voices match. Try another search or language.':'Loading voices…'}</p>`;
  for(const b of host.querySelectorAll('[data-choose-voice]'))b.onclick=()=>{remembered=b.dataset.chooseVoice;$('twin-local-voice').value=remembered;invalidate();showVoices();notify();};
  for(const b of host.querySelectorAll('[data-audition-voice]'))b.onclick=()=>generate(b.dataset.auditionVoice);
 }
 function availability(){
  const ready=!!(status?.supported&&status.models[engine()]?.ready);
  $('twin-generate-preview').disabled=pending||!ready;$('twin-generate-preview').textContent=pending?'Making your preview…':'Preview voice';
  $('twin-download-voice').hidden=!status?.supported||!!status.models[engine()]?.ready;$('twin-download-voice').disabled=pending||!!status?.busy;
  $('twin-preview-status').textContent=pending?'Making your preview on this Mac. This may take a moment.':!status?'Checking available voices…':!status.supported?'Voice previews need an Apple Silicon Mac.':status.busy?'Downloading a voice pack. Keep MyTwin open.':status.error||(!ready?'Download this voice pack once to get started.':'Ready to preview · Stays on this Mac · No credits needed');showVoices();
 }
 function update(resetText=false,wanted){
  const e=engine(),preset=isLocalPreset(e),design=e==='qwen3-design',langs=Object.entries(status?.models[e]?.languages||{[language]:language==='en'?'English':language}),previous=wanted||language;
  language=langs.some(([id])=>id===previous)?previous:langs[0]?.[0]||'en';$('twin-voice-language').innerHTML=options(langs,language);
  const voices=localVoiceChoices(status?.models,e,language);$('twin-local-voice').innerHTML=options(voices,remembered);if(voices.length&&!voices.some(([id])=>id===remembered))remembered=voices[0][0];
  $('twin-preset-browser').hidden=!preset;$('twin-voice-instruction-label').hidden=e!=='qwen3-custom'&&!design;$('twin-voice-instruction-title').textContent=design?'Describe the voice':'How should they speak? (optional)';
  $('twin-voice-step-title').textContent=design?'3. Describe your voice':preset?'3. Choose a preset':'3. Add a recording';
  $('twin-voice-step-note').textContent=design?'This model creates a new voice from your description.':preset?'This model comes with ready-made voices. Preview one before choosing.':'This model uses a recording to recreate your voice.';
  $('twin-local-note').textContent=design?'Describe the personality, accent and tone. Preview a few versions, then choose one to keep.':preset?'Choose a voice, or press Preview to hear it first.':'Add a clear recording of 3–30 seconds and its exact words. Then try your voice with a new sentence.';
  if(resetText||!$('twin-preview-text').value)$('twin-preview-text').value=previewTexts[language]||previewTexts.en;
  onModeChange(preset||design);availability();notify();
 }
 function invalidate(){selected=null;showResults();error('');notify();}
 $('twin-local-engine').onchange=()=>{remembered=defaultLocalVoice(engine());invalidate();update();};
 $('twin-voice-language').onchange=()=>{language=$('twin-voice-language').value;invalidate();update(true);};$('twin-voice-search').oninput=showVoices;
 $('twin-voice-instruction').oninput=invalidate;$('twin-preview-text').oninput=invalidate;
 async function syncStatus(){const next=await loadStatus();if(disposed)return;status=next;update();}
 $('twin-refresh-voices').onclick=()=>syncStatus().catch(error);
 $('twin-download-voice').onclick=async()=>{try{$('twin-download-voice').disabled=true;await api('/local-tts/download','POST',{engine:engine()});if(!disposed)await syncStatus();}catch(e){error(e);if(!disposed)availability();}};
 async function generate(voice){
  if(pending||disposed)return;let input=request();if(voice)input.voice=voice;pending=true;error('');availability();
  try{
   if(isLocalClone(input.engine))input={...input,...await getReference()};if(disposed)return;
   let job=getState().jobs.find(j=>j.purpose==='voice-preview'&&j.status==='completed'&&previewSignature(j)===previewSignature(input)&&getState().assets.some(a=>a.id===j.outputId));
   if(!job)job=await api('/local-tts/preview','POST',input);
   while(!disposed&&!['completed','failed','cancelled'].includes(job.status)){await new Promise(r=>setTimeout(r,1500));if(disposed)return;await refresh();job=getState().jobs.find(j=>j.id===job.id)||job;}
   if(disposed)return;if(job.status!=='completed')throw Error(job.error||'Preview cancelled.');remember(job);if(previewSignature(input)===previewSignature(request()))selected=job;
   showResults();notify();host.querySelector(`[data-preview-audio="${job.id}"]`)?.play().catch(()=>{});
  }catch(e){error(e);}finally{pending=false;if(!disposed)availability();}
 }
 $('twin-generate-preview').onclick=()=>generate();update();showResults();
 syncStatus().then(()=>{if(disposed)return;const j=getState().jobs.find(j=>j.id===existing?.voicePreviewJobId&&j.purpose==='voice-preview'&&j.status==='completed'),r=request();if(j&&previewSignature({...r,text:j.text})===previewSignature(j)&&getState().assets.some(a=>a.id===j.outputId)){remember(j);selected=j;$('twin-preview-text').value=j.text;showResults();notify();}}).catch(error);
 const timer=setInterval(()=>{if(status?.busy)syncStatus().catch(error);},3000);
 return {updateVisibility(){onModeChange(isLocalPreset(engine())||engine()==='qwen3-design');},referenceChanged(){if(isLocalClone(engine()))invalidate();},value(){if(pending)throw Error('Wait for your voice preview to finish before saving.');const r=request(),matches=selected&&previewSignature(selected)===previewSignature(r);if(r.engine==='qwen3-design'&&!matches)throw Error('Preview this voice and choose a version before saving.');return {localEngine:r.engine,localVoice:r.voice,localVoiceInstruction:r.instruct,localVoiceLanguage:r.language||'en',voicePreviewJobId:matches?selected.id:''};},dispose(){disposed=true;clearInterval(timer);host.querySelectorAll('audio').forEach(a=>a.pause());}};
}
