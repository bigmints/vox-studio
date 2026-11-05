import {defaultDubbing,dubbingVoiceRequest,currentDubVoice,dubMatches} from './dubbing-model.js';

// One workspace and renderer for uploaded footage and generated footage.
export function mountDubbing(host,ctx) {
  const {project:p,getState,api,assetUrl,escape:e,options,edit,save,refresh,action,chooseVideo,editTwin,stableContent}=ctx;
  p.dubbing ||= defaultDubbing();
  const d=p.dubbing,sec=p.sections[0];
  let alive=true,busy=false,sourceVersion=0,metadata=null,inspected='',videoModel='',transcript=null,existingOptions='',transcribing=false;
  const $=s=>host.querySelector(s);
  host.innerHTML=`<div class="dubbing-studio">
    <header class="dub-header"><div><span class="eyebrow">MYTWIN STUDIO</span><h2>${e(p.title)}</h2><p>Video Dubbing · Your video, your voice</p></div><div class="dub-header-actions"><span id="save-state">Saved</span><button data-rename>Rename</button><button data-open-project>Open</button><button data-new>New project</button></div></header>
    <div class="dub-layout"><div class="dub-canvas">
      <section class="dub-preview-card"><div class="dub-card-heading"><h3>Source video</h3><span id="dub-source-meta" role="status">Choose a video to begin</span></div><div id="dub-source-preview" class="dub-monitor"></div></section>
      <section class="dub-preview-card"><div class="dub-card-heading"><h3>Dubbed preview</h3><span id="dub-result-status" role="status" aria-live="polite"></span></div><div id="dub-output" class="dub-monitor"></div><div id="dub-export"></div></section>
      <details class="dub-history"><summary>Previous renders</summary><div id="dub-history"></div></details>
    </div><aside class="dub-controls" aria-label="Dubbing steps">
      <section class="dub-step"><h3><span>1</span> Choose your video</h3>
        <div class="dub-source-tabs" role="group" aria-label="Video source"><button id="dub-upload-tab">Upload video</button><button id="dub-generate-tab">Generate video</button></div>
        <div id="dub-upload-panel"><button class="dub-upload" id="dub-upload">↑ <strong>Choose a video</strong><small>MP4, MOV or WebM · Up to 512 MB</small></button><p class="note">H.264 MP4 and MOV work best. Processing support depends on the video codec.</p></div>
        <div id="dub-generate-panel" hidden><label>Describe the visuals<textarea id="dub-prompt" maxlength="10000" placeholder="A slow camera move through a sunlit forest…">${e(d.prompt)}</textarea></label><div id="dub-video-controls"></div><p class="note">Generate sends this prompt to OpenRouter and uses credits. The clip becomes the source for your dub.</p><button id="dub-generate-video" class="primary">Generate video</button><div id="dub-video-jobs" role="status"></div></div>
        <label class="dub-existing-label">Or use a saved video<select id="dub-existing"><option value="">Choose a saved video…</option></select></label>
      </section>
      <section class="dub-step"><h3><span>2</span> Give your twin the words</h3>
        <label>Voice twin<select id="dub-twin">${options([['','Choose your twin'],...getState().profiles.map(t=>[t.id,t.name])],p.profileId)}</select></label><button id="dub-edit-twin" class="small subtle">Edit twin & voice settings</button><p id="dub-voice-settings" class="note"></p>
        <label>Language<select id="dub-language">${options([['en','English'],['ar','Arabic'],['hi','Hindi'],['ml','Malayalam'],['es','Spanish'],['fr','French'],['de','German'],['pt','Portuguese'],['it','Italian'],['zh','Chinese'],['ja','Japanese'],['ko','Korean'],['ru','Russian']],p.language)}</select></label>
        <label>Script<textarea id="dub-script" maxlength="50000" placeholder="Write or paste the words your twin should say…">${e(sec.text)}</textarea></label>
        <button id="dub-transcribe" class="small">Transcribe source video</button><p class="note" id="dub-transcribe-note">Optional: transcription sends extracted audio to your selected OpenRouter transcription model. Review the text before applying it.</p>
        <div id="dub-transcript-review" hidden><label>Review transcript<textarea id="dub-transcript"></textarea></label><button id="dub-apply-transcript">Use transcript</button><button id="dub-discard-transcript" class="subtle">Discard</button></div>
        <button id="dub-generate-voice" class="primary">Generate twin voice</button><p id="dub-voice-status" role="status" aria-live="polite"></p><div id="dub-voice-preview"></div>
      </section>
      <section class="dub-step"><h3><span>3</span> Time, preview & export</h3>
        <div class="fields"><label>Voice starts at (seconds)<input id="dub-start" type="number" min="0" max="7200" step="0.1" value="${d.start}"></label><label>Voice timing<select id="dub-timing">${options([['natural','Keep natural pace'],['fit','Fit to remaining video']],d.timing)}</select></label></div>
        <p class="note">The original audio is replaced. Natural pace keeps your voice unchanged; Fit adjusts its speed (0.5×–2×). The video keeps its full length. Lip sync is not included.</p>
        <button id="dub-render" class="primary">Render dubbed preview</button><p id="dub-render-note" class="note" role="status" aria-live="polite"></p>
      </section>
    </aside></div></div>`;

  const run=fn=>action(async()=>{if(busy)return;busy=true;update();try{await fn();}finally{busy=false;if(alive)update();}});
  function setSourceMode(mode){if(d.source!==mode){d.source=mode;edit();}$('#dub-upload-panel').hidden=mode!=='upload';$('#dub-generate-panel').hidden=mode!=='generate';for(const key of ['upload','generate']){$('#dub-'+key+'-tab').classList.toggle('active',mode===key);$('#dub-'+key+'-tab').setAttribute('aria-pressed',String(mode===key));}}
  function inspectSource(){
    if(inspected===d.videoAssetId)return;
    inspected=d.videoAssetId;metadata=null;const version=++sourceVersion;
    if(!inspected)return;
    $('#dub-source-meta').textContent='Checking video…';
    void api('/dubbing/inspect','POST',{assetId:inspected}).then(info=>{if(!alive||version!==sourceVersion)return;metadata=info;update();}).catch(error=>{if(alive&&version===sourceVersion){metadata={error:error.message};update();}});
  }
  async function useVideo(aid){d.videoAssetId=aid;edit();await save();if(alive){update();inspectSource();}}
  $('#dub-upload-tab').onclick=()=>setSourceMode('upload');$('#dub-generate-tab').onclick=()=>setSourceMode('generate');
  $('#dub-upload').onclick=()=>run(async()=>{const a=await chooseVideo();if(!a||!alive)return;await refresh();if(!alive)return;await useVideo(a.id);});
  $('#dub-existing').onchange=event=>run(()=>useVideo(event.target.value));
  $('#dub-prompt').oninput=event=>{d.prompt=event.target.value;edit();update();};
  $('#dub-script').oninput=event=>{sec.text=event.target.value;edit();update();};
  $('#dub-twin').onchange=event=>{p.profileId=event.target.value;edit();update();};
  $('#dub-language').onchange=event=>{p.language=event.target.value;edit();update();};
  $('#dub-edit-twin').onclick=()=>editTwin(getState().profiles.find(t=>t.id===p.profileId));
  $('#dub-start').oninput=event=>{d.start=event.target.valueAsNumber;edit();update();};
  $('#dub-timing').onchange=event=>{d.timing=event.target.value;edit();update();};
  $('#dub-transcribe').onclick=()=>run(async()=>{
    const original=sec.text,source=d.videoAssetId;transcribing=true;update();
    try {const a=await api('/dubbing/extract','POST',{assetId:source});
    const result=await api('/listen','POST',{assetId:a.id});
    if(!alive)return;
    transcript={text:result.text,original,source};$('#dub-transcript').value=result.text;$('#dub-transcript-review').hidden=false;}finally{transcribing=false;}
  });
  $('#dub-apply-transcript').onclick=()=>action(async()=>{if(!transcript)return;if(transcript.original!==sec.text||transcript.source!==d.videoAssetId)throw Error('The source or script changed. Copy the transcript to keep your edits.');sec.text=$('#dub-transcript').value;$('#dub-script').value=sec.text;transcript=null;$('#dub-transcript-review').hidden=true;edit();update();});
  $('#dub-discard-transcript').onclick=()=>{transcript=null;$('#dub-transcript-review').hidden=true;};
  $('#dub-generate-voice').onclick=()=>run(async()=>{
    await save();const request=dubbingVoiceRequest(getState(),p);
    const job=await api('/jobs','POST',request);
    if(['prepared','waiting'].includes(job.status))await api('/jobs/'+job.id+'/submit','POST');
    await refresh();
  });
  $('#dub-generate-video').onclick=()=>run(async()=>{
    await save();const video={};for(const key of ['duration','resolution','aspect_ratio']){const v=$('#dub-video-'+key).value;if(v)video[key]=key==='duration'?Number(v):v;}
    const job=await api('/jobs','POST',{projectId:p.id,sectionId:sec.id,kind:'video',provider:'openrouter',engine:videoModel,video});
    await api('/jobs/'+job.id+'/submit','POST');await refresh();
  });
  $('#dub-render').onclick=()=>run(async()=>{await save();const voice=currentDubVoice(getState(),p);if(!voice)throw Error('Generate a current twin voice first.');await api('/dubbing/render','POST',{projectId:p.id,voiceJobId:voice.id});await refresh();});
  function videoControls(){
    const models=getState().settings.videoModels||[],model=models.find(m=>m.id===videoModel);
    $('#dub-video-controls').innerHTML=`<label>Video model<select id="dub-video-model">${options([['','Choose a model'],...models.filter(m=>m.supported_durations?.length).map(m=>[m.id,m.name||m.id])],videoModel)}</select></label><button id="dub-refresh-models" class="small">Refresh video models</button><div class="fields">${[['duration','supported_durations','Seconds'],['resolution','supported_resolutions','Resolution'],['aspect_ratio','supported_aspect_ratios','Aspect ratio']].map(([key,field,label])=>`<label>${label}<select id="dub-video-${key}">${options([['','Model default'],...(model?.[field]||[]).map(v=>[String(v),String(v)])],'')}</select></label>`).join('')}</div>`;
    $('#dub-video-model').onchange=event=>{videoModel=event.target.value;videoControls();update();};
    $('#dub-refresh-models').onclick=()=>run(async()=>{getState().settings.videoModels=await api('/openrouter/video-models');if(alive)videoControls();});
  }
  function update(){
    if(!alive)return;
    const state=getState(),jobs=state.jobs.filter(j=>j.projectId===p.id),voice=currentDubVoice(state,p),source=state.assets.find(a=>a.id===d.videoAssetId);
    let setup='',request;
    try {request=dubbingVoiceRequest(state,p);setup=`${request.provider==='local'?'On this Mac':request.provider==='openrouter'?'OpenRouter · Uses credits':request.provider==='voicestudio'?'VoiceStudio':'GX10'} · ${request.engine} · Twin voice clone`;}
    catch(error){setup=error.message;}
    $('#dub-voice-settings').textContent=setup;
    const voiceBusy=jobs.some(j=>j.kind==='voice'&&['submitting','queued','running','waiting'].includes(j.status));
    const videoBusy=jobs.some(j=>j.kind==='video'&&['submitting','queued','running'].includes(j.status));
    const renderBusy=jobs.some(j=>j.kind==='dub'&&j.status==='running');
    $('#dub-generate-voice').disabled=busy||voiceBusy||!request;
    $('#dub-generate-voice').textContent=voiceBusy?'Generating twin voice…':voice?'Twin voice ready':'Generate twin voice';
    $('#dub-generate-video').disabled=busy||videoBusy||!videoModel||!d.prompt.trim();
    $('#dub-generate-video').textContent=videoBusy?'Generating video…':'Generate video';
    $('#dub-transcribe').disabled=busy||!source||!metadata?.hasAudio||!state.settings.listeningModel||!state.settings.openrouterConfigured;
    $('#dub-transcribe').textContent=transcribing?'Transcribing source audio…':'Transcribe source video';
    $('#dub-transcribe-note').textContent=transcribing?'Extracting the source audio and transcribing it. You can review the text before applying it.':!source?'Choose a video to transcribe, or write your script above.':metadata&&!metadata.hasAudio?'This source has no readable audio. Write or paste your script above.':!state.settings.listeningModel||!state.settings.openrouterConfigured?'Choose an Audio text model and connect OpenRouter in Settings to transcribe this video. You can also write or paste your script.':'Optional: transcription sends extracted audio to your selected OpenRouter model and uses credits. Review the text before applying it.';
    $('#dub-upload').disabled=busy;$('#dub-existing').disabled=busy;
    const available=metadata?.duration-d.start,tooLong=voice?.duration>available+0.02;
    $('#dub-render').disabled=busy||renderBusy||!voice||!metadata?.duration||!Number.isFinite(d.start)||d.start<0||available<=0||(d.timing==='natural'&&tooLong);
    $('#dub-render').textContent=renderBusy?'Rendering preview…':'Render dubbed preview';
    $('#dub-render-note').textContent=renderBusy?'Rendering on this Mac. You can leave this project open while it finishes.':tooLong&&d.timing==='natural'?'Your voice is longer than the remaining video. Choose Fit to remaining video or shorten your script.':!voice?'Generate your twin voice to enable the preview.':!source?'Choose a source video.':'Preview renders locally. Download the MP4 when it is ready.';
    const latestVoice=jobs.find(j=>j.kind==='voice');
    $('#dub-voice-status').textContent=voiceBusy?'Your twin is recording this script…':voice?'Ready to preview':latestVoice?.status==='failed'?latestVoice.error||'Voice generation failed.':'Review your script, then generate your twin voice.';
    stableContent($('#dub-voice-preview'),voice?`<audio controls preload="metadata" src="${assetUrl(voice.outputId)}"></audio>`:'');
    stableContent($('#dub-source-preview'),source?`<video controls preload="metadata" src="${assetUrl(source.id)}"></video>`:'<div class="dub-placeholder"><span>01</span><strong>Start with your video</strong><p>Upload footage or generate a scene.<br>Your twin will provide the voice.</p></div>');
    if(metadata)$('#dub-source-meta').textContent=metadata.error||`${metadata.duration.toFixed(1)} seconds · ${metadata.hasAudio?'Has original audio':'Silent video'}`;
    else if(!source)$('#dub-source-meta').textContent='Choose a video to begin';
    const render=jobs.find(j=>dubMatches(j,p,voice)),output=render?.status==='completed'&&state.assets.find(a=>a.id===render.outputId);
    $('#dub-result-status').textContent=render?.status==='failed'?render.error:render?.status==='running'?'Rendering…':output?'Ready to export':'Not rendered yet';
    stableContent($('#dub-output'),output?`<video controls preload="metadata" src="${assetUrl(output.id)}"></video>`:'<div class="dub-placeholder"><span>02</span><strong>Hear yourself in the video</strong><p>Your finished dub will appear here.</p></div>');
    stableContent($('#dub-export'),output?`<a class="dub-download" data-export="${output.id}" href="${ctx.native?'#':'/api/assets/'+output.id+'?download'}">Download dubbed MP4 ↓</a>`:'');
    stableContent($('#dub-history'),jobs.filter(j=>j.kind==='dub'&&j.status==='completed'&&j.outputId).map(j=>`<div class="dub-saved"><span>${e(j.profileName)} · ${new Date(j.createdAt).toLocaleString()}${dubMatches(j,p,voice)?'':' · Previous settings'}</span><a data-export="${j.outputId}" href="${ctx.native?'#':'/api/assets/'+j.outputId+'?download'}">Download</a></div>`).join('')||'<p class="note">Finished renders are kept here.</p>');
    const choices=[['','Choose a saved video…'],...state.assets.filter(a=>a.type.startsWith('video/')).map(a=>[a.id,a.name])];
    const html=options(choices,d.videoAssetId);if(existingOptions!==html){existingOptions=html;$('#dub-existing').innerHTML=html;}
    stableContent($('#dub-video-jobs'),jobs.filter(j=>j.kind==='video').slice(0,5).map(j=>`<div class="dub-generated"><p>${e(j.prompt||j.text)}</p><small>${e(j.status==='failed'?j.error:j.stage||j.status)}</small>${j.status==='completed'&&j.outputId?`<button data-dub-use="${j.outputId}" ${j.outputId===d.videoAssetId?'disabled':''}>${j.outputId===d.videoAssetId?'Selected for dubbing':'Use this video'}</button>`:''}${['prepared','queued','running'].includes(j.status)?`<button data-dub-check="${j.id}" data-submit="${j.status==='prepared'}">${j.status==='prepared'?'Generate with OpenRouter':'Check status'}</button>`:''}</div>`).join(''));
    host.querySelectorAll('[data-dub-use]').forEach(b=>b.onclick=()=>run(()=>useVideo(b.dataset.dubUse)));
    host.querySelectorAll('[data-dub-check]').forEach(b=>b.onclick=()=>run(async()=>{await api('/jobs/'+b.dataset.dubCheck+'/'+(b.dataset.submit==='true'?'submit':'refresh'),'POST');await refresh();}));
    inspectSource();
  }
  videoControls();setSourceMode(d.source);update();
  return {update,dispose(){alive=false;sourceVersion++;host.querySelectorAll('video,audio').forEach(m=>m.pause());}};
}
