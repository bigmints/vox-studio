import {mountVoicePicker} from './voice-picker.js';
import {startVoiceRecording} from './voice-recorder.js';
import {twinVoiceModels} from './twin-models.js';
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(entries,value)=>entries.map(([id,label])=>`<option value="${escape(id)}" ${id===value?'selected':''}>${escape(label)}</option>`).join('');
export function mountTwinEditor(host,{existing,getState,api,refresh,assetUrl,loadStatus,importMedia,upload,storeRecording,onSave,onClose}) {
 let refs={voice:getState().assets.find(a=>a.id===existing?.voiceAssetId),avatar:getState().assets.find(a=>a.id===existing?.avatarAssetId)},voiceFile=null,avatarFile=null,recorder=null,disposed=false,recording=false,saving=false,picker=null,tab='voice';
 const urls=new Map();
 host.innerHTML=`<form id="twin-form" class="twin-editor">
 <header class="twin-editor-header"><div><h1>${existing?'Edit your model':'Create your model'}</h1><p id="twin-save-status" role="status" aria-live="polite"></p></div><div class="twin-editor-header-actions"><button type="button" data-twin-close>Cancel</button><button type="submit" class="primary" id="save-twin">${existing?'Save changes':'Create model'}</button></div></header>
 <div class="twin-editor-body"><aside class="twin-identity"><div id="twin-identity-preview" class="twin-portrait"></div><button type="button" id="twin-edit-appearance">Change appearance</button><label>Model name<input name="name" required maxlength="200" placeholder="Give your model a name" value="${escape(existing?.name||'')}"></label><dl class="twin-summary"><dt>Voice</dt><dd id="twin-summary-voice">Choose a voice</dd><dt>Voice type</dt><dd id="twin-summary-mode">Ready-made voice</dd></dl><p class="note">Changes apply when you save. Your existing clips and takes stay available.</p></aside>
 <div class="twin-editor-main"><div class="twin-editor-tabs" role="tablist" aria-label="Twin settings"><button type="button" id="twin-tab-voice" data-twin-tab="voice" role="tab" aria-controls="twin-pane-voice" aria-selected="true">Voice</button><button type="button" id="twin-tab-appearance" data-twin-tab="appearance" role="tab" aria-controls="twin-pane-appearance" aria-selected="false" tabindex="-1">Appearance</button><button type="button" id="twin-tab-about" data-twin-tab="about" role="tab" aria-controls="twin-pane-about" aria-selected="false" tabindex="-1">About</button></div>
 <section id="twin-pane-voice" class="twin-editor-pane" role="tabpanel" aria-labelledby="twin-tab-voice">
 <div class="twin-section-heading twin-voice-heading"><h2>Set up your twin’s voice</h2><p>Choose a provider and model, then add the voice it needs.</p></div>
 <div class="twin-provider-models"><label>1. Provider<select name="voiceProvider" id="twin-provider">${options([['','Use my studio choice'],['local','On this Mac'],['openrouter','OpenRouter'],['gx10','GX10'],['voicestudio','VoiceStudio']],existing?.voiceProvider??'local')}</select></label><div id="twin-local-model-slot"></div><label id="twin-cloud-model-field" hidden>2. Model<select id="twin-cloud-model"></select></label></div><p class="note twin-provider-note" id="twin-provider-note"></p><button type="button" class="small" id="twin-refresh-cloud-models" hidden>Refresh models</button>
 <div id="twin-local-options"></div><div id="twin-cloud-guide" class="twin-cloud-setup" hidden><div class="twin-section-heading"><h2 id="twin-cloud-step-title">3. Choose your voice</h2><p id="twin-cloud-step-note"></p></div><div id="twin-cloud-options"></div><div id="twin-cloud-reference"></div></div></section>
 <section id="twin-pane-appearance" class="twin-editor-pane" role="tabpanel" aria-labelledby="twin-tab-appearance" hidden><div class="twin-section-heading"><h2>Put a face to the voice</h2><p>Choose a character image, portrait or video for your twin.</p></div><div id="twin-appearance-preview" class="twin-appearance-preview"></div><div class="take-actions"><button type="button" class="primary" id="choose-avatar">Choose photo or video</button><button type="button" id="remove-avatar">Remove appearance</button></div><p class="note" id="twin-avatar-name"></p></section>
 <section id="twin-pane-about" class="twin-editor-pane" role="tabpanel" aria-labelledby="twin-tab-about" hidden><div class="twin-section-heading"><h2>A little about your twin</h2><p>Keep notes about their personality and the roles they play.</p></div><label>Notes<textarea name="notes" rows="8" placeholder="For example: a curious podcast host who asks short, thoughtful questions.">${escape(existing?.notes||'')}</textarea></label></section></div></div>
 <input type="file" id="voice-file" accept="audio/*" hidden><input type="file" id="avatar-file" accept="image/png,image/jpeg,image/webp,video/mp4,video/quicktime,video/webm" hidden></form>`;
 const $=s=>host.querySelector(s),provider=()=>$('#twin-provider').value||getState().settings.voiceProvider||'openrouter';
 const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){if(!disposed){$('#twin-save-status').textContent=e.message||String(e);$('#twin-save-status').classList.add('error');}}};
 function switchTab(next){tab=next;for(const b of host.querySelectorAll('[data-twin-tab]')){const active=b.dataset.twinTab===next;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}for(const pane of host.querySelectorAll('.twin-editor-pane'))pane.hidden=pane.id!=='twin-pane-'+next;}
 for(const b of host.querySelectorAll('[data-twin-tab]'))b.onclick=()=>switchTab(b.dataset.twinTab);
 $('.twin-editor-tabs').onkeydown=e=>{const tabs=['voice','appearance','about'];if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();switchTab(e.key==='Home'?'voice':e.key==='End'?'about':tabs[(tabs.indexOf(tab)+(e.key==='ArrowRight'?1:2))%3]);$('#twin-tab-'+tab).focus();};
 for(const b of host.querySelectorAll('[data-twin-close]'))b.onclick=()=>{if(!saving)onClose();};
 $('#twin-edit-appearance').onclick=()=>switchTab('appearance');
 const blobUrl=(key,file)=>{if(urls.has(key)){URL.revokeObjectURL(urls.get(key));urls.delete(key);}if(!file)return null;const url=URL.createObjectURL(file);urls.set(key,url);return url;};
 function appearance(){
  const a=avatarFile||refs.avatar,url=avatarFile?blobUrl('avatar',avatarFile):a?assetUrl(a.id):'',media=a?`${a.type.startsWith('video/')?`<video controls preload="metadata" src="${escape(url)}" aria-label="Twin appearance preview"></video>`:`<img src="${escape(url)}" alt="Twin appearance preview">`}`:'<div class="twin-portrait-empty"><span>✧</span><strong>Your character goes here</strong></div>';
  $('#twin-identity-preview').innerHTML=media;$('#twin-appearance-preview').innerHTML=media;$('#twin-avatar-name').textContent=a?.name||'PNG, JPG, WebP or a short video';$('#choose-avatar').textContent=a?'Change photo or video':'Choose photo or video';$('#remove-avatar').hidden=!a;
 }
 const reference=document.createElement('section');reference.id='twin-reference';reference.className='twin-reference';
 reference.innerHTML=`<h3>Your voice recording</h3><div class="take-actions"><button type="button" id="choose-voice">Import recording</button><button type="button" id="record-voice">Record my voice</button><button type="button" id="stop-voice" hidden>Stop recording</button><span id="record-time" role="status"></span></div><p class="note">Speak naturally for 3–30 seconds in a quiet room.</p><div id="voice-preview"></div><label>Exact words in the recording<textarea name="voiceTranscript" maxlength="3000" rows="3" placeholder="Type exactly what you said in your recording.">${escape(existing?.voiceTranscript||'')}</textarea></label><p class="error" id="record-error" role="alert"></p>`;
 $('#twin-cloud-reference').append(reference);
 function referencePreview(){const a=voiceFile||refs.voice,url=voiceFile?blobUrl('voice',voiceFile):a?assetUrl(a.id):'';$('#voice-preview').innerHTML=a?`<p class="note">${escape(a.name)}</p><audio controls preload="metadata" aria-label="Your voice recording" src="${escape(url)}"></audio>`:'';picker?.referenceChanged();}
 async function persistRecording(){if(voiceFile){const file=voiceFile;const asset=await storeRecording(file);if(disposed)return asset;refs.voice=asset;if(voiceFile===file)voiceFile=null;await refresh();}return refs.voice;}
 const referenceSnapshot=()=>({voiceAssetId:refs.voice?.id||'',voiceTranscript:$('[name="voiceTranscript"]').value.trim()});
 picker=mountVoicePicker($('#twin-local-options'),{existing,modelHost:$('#twin-local-model-slot'),api,getState,refresh,assetUrl,loadStatus,referenceSnapshot,getReference:async()=>{const asset=await persistRecording();return {voiceAssetId:asset?.id||'',voiceTranscript:$('[name="voiceTranscript"]').value.trim()};},onModeChange:noReference=>{const local=provider()==='local';if(local)reference.hidden=noReference;const target=local?$('#twin-clone-reference'):$('#twin-cloud-reference');if(target&&reference.parentElement!==target)target.append(reference);},onChange:info=>{if(provider()!=='local')return;$('#twin-summary-voice').textContent=info.voice;$('#twin-summary-mode').textContent=info.mode;}});
 let cloudVersion=0;
 const cloudDrafts={openrouter:{model:existing?.speechModel||getState().settings.speechModel||'',mode:existing?.voiceMode||getState().settings.voiceMode||'',voice:existing?.voice||getState().settings.voice||''},gx10:{model:existing?.voiceEngine||'',mode:'clone',voice:''},voicestudio:{model:'omnivoice',mode:'clone',voice:''}};
 function cloudDraft(){return cloudDrafts[provider()]||cloudDrafts.openrouter;}
 function renderCloudInputs(model,cloning){
  const draft=cloudDraft(),voices=(model?.voices||[]).filter(v=>typeof v==='string'),modes=[...(voices.length?[['preset','Choose a preset']]:[]),...(cloning?[['clone','Use a recording']]:[])];
  if(!modes.some(([id])=>id===draft.mode))draft.mode=modes[0]?.[0]||'';
  $('#twin-cloud-options').innerHTML=modes.length?`${modes.length>1?`<label>Voice source<select id="twin-cloud-mode">${options(modes,draft.mode)}</select></label>`:''}${draft.mode==='preset'?`<label>Preset voice<select id="twin-cloud-voice">${options([['','Choose a preset'],...voices.map(v=>[v,v])],draft.voice)}</select></label>`:''}`:'';
  reference.hidden=draft.mode!=='clone';
  $('#twin-cloud-step-title').textContent=draft.mode==='clone'?'3. Add a recording':draft.mode==='preset'?'3. Choose a preset':'3. Choose your voice';
  $('#twin-cloud-step-note').textContent=!draft.model?'Choose a model above to continue.':draft.mode==='clone'?'This model uses your recording. You can listen to the recording below.':draft.mode==='preset'?'This model provides ready-made voices. Choose one for your twin.':'This model has no supported voice options. Choose another model.';
  if($('#twin-cloud-mode'))$('#twin-cloud-mode').onchange=e=>{draft.mode=e.target.value;renderCloudInputs(model,cloning);};
  if($('#twin-cloud-voice'))$('#twin-cloud-voice').onchange=e=>{draft.voice=e.target.value;$('#twin-summary-voice').textContent=draft.voice||'Choose a preset';};
  $('#twin-summary-voice').textContent=draft.mode==='preset'?draft.voice||'Choose a preset':'Your voice recording';$('#twin-summary-mode').textContent=draft.mode==='preset'?'Ready-made voice':'From your recording';
 }
 async function loadCloudSetup(){
  const version=++cloudVersion,chosenProvider=provider(),draft=cloudDraft(),model=twinVoiceModels(chosenProvider,getState()).find(m=>m.id===draft.model);
  if(chosenProvider!=='openrouter'||!draft.model){renderCloudInputs(model,chosenProvider!=='openrouter'&&!!draft.model);return;}
  reference.hidden=true;$('#twin-cloud-options').replaceChildren();$('#twin-cloud-step-note').textContent='Checking this model’s voice options…';
  try{const details=await api('/openrouter/details','POST',{model:draft.model});if(disposed||version!==cloudVersion||provider()!==chosenProvider)return;renderCloudInputs(model,details.cloning===true);}
  catch(e){if(disposed||version!==cloudVersion)return;renderCloudInputs(model,false);$('#twin-cloud-step-note').textContent+=(model?.voices?.length?' ':'')+e.message;}
 }
 function updateCloudModels(){
  const models=twinVoiceModels(provider(),getState()),draft=cloudDraft();if(!draft.model&&models.length===1)draft.model=models[0].id;
  const entries=models.map(m=>[m.id,m.name||m.id]);if(draft.model&&!models.some(m=>m.id===draft.model))entries.unshift([draft.model,draft.model]);
  $('#twin-cloud-model').innerHTML=options([['',models.length?'Choose a model':'No models available'],...entries],draft.model);
  void loadCloudSetup();
 }
 const updateProvider=()=>{const local=provider()==='local';cloudVersion++;$('#twin-local-options').hidden=!local;$('#twin-local-model-slot').hidden=!local;$('#twin-cloud-model-field').hidden=local;$('#twin-refresh-cloud-models').hidden=provider()!=='openrouter';$('#twin-cloud-guide').hidden=local;$('#twin-provider-note').textContent=local?'Voices are made on this Mac. No API credits needed.':'Voice generation uses your selected provider. Your recording is shared only when generating a clip.';picker.updateVisibility();if(!local)updateCloudModels();};
 $('#twin-refresh-cloud-models').onclick=safe(async()=>{const button=$('#twin-refresh-cloud-models');button.disabled=true;try{const catalog=await api('/openrouter/models');if(!disposed){getState().settings.catalog=catalog;if(provider()==='openrouter')updateCloudModels();}}finally{if(!disposed)button.disabled=false;}});
 $('#twin-provider').onchange=updateProvider;$('#twin-cloud-model').onchange=()=>{const draft=cloudDraft();draft.model=$('#twin-cloud-model').value;draft.voice='';draft.mode='';void loadCloudSetup();};updateProvider();appearance();referencePreview();
 $('[name="voiceTranscript"]').oninput=()=>picker.referenceChanged();
 function recordingUI(on){recording=on;$('#choose-voice').disabled=on;$('#record-voice').hidden=on;$('#stop-voice').hidden=!on;$('#save-twin').disabled=on;}
 function finished(file){if(disposed)return;recorder=null;recordingUI(false);if(file){voiceFile=file;referencePreview();$('#record-time').textContent='Ready to listen';}}
 $('#record-voice').onclick=safe(async()=>{if(recording)return;recordingUI(true);$('#stop-voice').disabled=true;$('#record-error').textContent='';$('#record-time').textContent='Opening microphone…';try{const next=await startVoiceRecording({isCancelled:()=>disposed,onTime:seconds=>{if(!disposed)$('#record-time').textContent=`Recording · ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;},onLimit:finished});if(disposed){next?.cancel();return;}recorder=next;$('#stop-voice').disabled=false;}catch(e){if(!disposed){recordingUI(false);$('#record-time').textContent='';$('#record-error').textContent=e.message;}}});
 $('#stop-voice').onclick=()=>{try{finished(recorder?.stop());}catch(e){finished(null);$('#record-error').textContent=e.message;}};
 $('#choose-voice').onclick=safe(async()=>{if(importMedia){const a=await importMedia('audio');if(a&&!disposed){refs.voice=a;voiceFile=null;await refresh();referencePreview();}}else $('#voice-file').click();});
 $('#voice-file').onchange=e=>{if(e.target.files[0]){voiceFile=e.target.files[0];referencePreview();}};
 $('#choose-avatar').onclick=safe(async()=>{if(importMedia){const a=await importMedia('avatar');if(a&&!disposed){refs.avatar=a;avatarFile=null;await refresh();appearance();}}else $('#avatar-file').click();});
 $('#avatar-file').onchange=e=>{if(e.target.files[0]){avatarFile=e.target.files[0];appearance();}};
 $('#remove-avatar').onclick=()=>{refs.avatar=null;avatarFile=null;appearance();};
 host.addEventListener('play',e=>{for(const a of host.querySelectorAll('audio,video'))if(a!==e.target)a.pause();},true);
 $('#twin-form').onsubmit=e=>{e.preventDefault();if(recording||saving)return;safe(async()=>{
  $('#twin-save-status').classList.remove('error');const f=new FormData(e.target);let voiceSettings;try{voiceSettings=provider()==='local'?picker.value():{localEngine:existing?.localEngine||'kokoro',localVoice:existing?.localVoice||'af_heart',localVoiceLanguage:existing?.localVoiceLanguage||'en',localVoiceInstruction:existing?.localVoiceInstruction||'',voiceDesign:existing?.voiceDesign||null,...(provider()==='openrouter'?{speechModel:cloudDraft().model,voiceMode:cloudDraft().mode,voice:cloudDraft().voice}:{voiceEngine:cloudDraft().model,voiceMode:'clone'})};if(provider()!=='local'&&!cloudDraft().model)throw Error('Choose a model before saving.');if(provider()==='openrouter'&&(!cloudDraft().mode||cloudDraft().mode==='preset'&&!cloudDraft().voice))throw Error('Choose a model and its voice before saving.');}catch(err){switchTab('voice');throw err;}
  saving=true;$('#save-twin').disabled=true;$('#twin-save-status').textContent='Saving your model…';
  try{const va=await persistRecording();let aa=refs.avatar;if(avatarFile)aa=await upload(avatarFile);if(disposed)return;
   const twin=await api(existing?'/profiles/'+existing.id:'/profiles',existing?'PUT':'POST',{name:f.get('name'),notes:f.get('notes'),voiceProvider:f.get('voiceProvider'),speechModel:existing?.speechModel||'',voiceMode:existing?.voiceMode||'',voice:existing?.voice||'',voiceEngine:existing?.voiceEngine||'',...voiceSettings,voiceTranscript:f.get('voiceTranscript')||'',voiceAssetId:va?.id||'',avatarAssetId:aa?.id||''});await onSave(twin);
  }finally{saving=false;if(!disposed)$('#save-twin').disabled=false;}
 })();};
 return ()=>{disposed=true;picker.dispose();recorder?.cancel();host.querySelectorAll('audio,video').forEach(a=>a.pause());for(const url of urls.values())URL.revokeObjectURL(url);};
}
