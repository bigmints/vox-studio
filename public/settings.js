let activeConnectionTab = 'chat';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  connections:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  chat:'M4 4h16v12H9l-5 4z',
  audio:'M4 10v4 M8 6v12 M12 3v18 M16 7v10 M20 10v4',
  video:'M3 5h13v14H3z M16 10l6-4v12l-6-4',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]}"/></svg>`;
const services = {
  openrouter:{name:'OpenRouter',key:'openrouterKey',configured:'openrouterConfigured',help:'Paste your OpenRouter API key. The same key connects Chat, Audio, and Video.',note:'Cloud generation uses your OpenRouter credits.'},
  voicestudio:{name:'VoiceStudio',key:'voicestudioKey',configured:'voicestudioConfigured',url:'voicestudioUrl',urlLabel:'Server address',placeholder:'http://localhost:9444',help:'Enter your VoiceStudio server address and API key.',note:'OmniVoice · For non-commercial testing.'},
  worker:{name:'GX10 worker',key:'workerToken',configured:'workerTokenConfigured',url:'workerUrl',urlLabel:'Worker address',placeholder:'http://gx10.local:8000',help:'Enter the address and connection key for your MyTwin worker.',note:'Connect to a worker you have already set up on your GX10.'},
};
const localModels = {
  kokoro:['Kokoro','54 preset voices for multilingual speech.'],
  'qwen3':['Qwen3 · Fast clone','Clone your voice with a short reference recording.'],
  'qwen3-hq':['Qwen3 · Quality clone','Higher-quality voice cloning with a larger model.'],
  'qwen3-custom':['Qwen3 · CustomVoice','Preset voices with control over delivery and expression.'],
  'qwen3-design':['Qwen3 · VoiceDesign','Create a voice by describing how it should sound.'],
};
const row = (title, description, control, attributes = '') => `<div class="setting-row" ${attributes}><div class="setting-copy"><div class="setting-label">${title}</div><p>${description}</p></div><div class="setting-control">${control}</div></div>`;
const section = (id, title, description, body) => `<section class="settings-group" id="connections-${id}" data-connection-group="${id}" role="tabpanel" tabindex="0" aria-labelledby="connection-tab-${id}"><div class="connection-group-heading">${icon(id)}<div><h2 id="${id}-heading" tabindex="-1">${title}</h2><p>${description}</p></div></div><div class="settings-card">${body}</div></section>`;

export function mountSettings(host, {settings, getSettings = () => settings, modelPicker, initModelPickers, closeModelPicker, renderLocalSettings, api, refresh, loadModels, navigate, connection}) {
  const q = selector => host.querySelector(selector);
  const checks = {};
  const configured = service => service === 'worker' ? !!getSettings().workerUrl : !!getSettings()[services[service].configured] && (!services[service].url || !!getSettings()[services[service].url]);
  const providerRow = (service, group, description) => row(`<span class="connection-logo" aria-hidden="true">${{openrouter:'OR',voicestudio:'VS',worker:'GX'}[service]}</span>${services[service].name}<span class="connection-kind">API</span>`,description,
    `<span class="settings-status" data-service-summary="${service}" role="status"></span><button type="button" data-connect="${service}" aria-label="Connect ${services[service].name} for ${group}"></button>`,
    `data-connection-row data-search="${escape(`${group} ${services[service].name} api cloud provider connect ${description}`.toLowerCase())}"`);

  host.innerHTML = `<div class="settings-layout connections-layout">
    <aside class="settings-sidebar" aria-label="Settings navigation">
      <h2 class="settings-sidebar-title">Settings</h2>
      <div class="settings-search-wrap"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><input id="settings-search" type="search" aria-label="Search connections" placeholder="Search" autocomplete="off"></div>
      <nav class="settings-nav" aria-label="Settings"><button type="button" class="active" aria-current="page" data-jump="top">${icon('connections')}<span>Connections</span></button></nav>
    </aside>
    <div class="settings-workspace">
    <div class="settings-main"><div class="settings-page-heading"><h2 id="settings-heading" tabindex="-1">Connections</h2><p>Connect an API provider or download a model to use on this Mac.</p><p class="connections-shared-note">One OpenRouter key works across Chat, Audio, and Video.</p></div>
    <div class="connection-tabs" role="tablist" aria-label="Connection type">${['chat','audio','video'].map(id=>`<button type="button" role="tab" id="connection-tab-${id}" data-connection-tab="${id}" aria-controls="connections-${id}" aria-selected="${activeConnectionTab===id}" tabindex="${activeConnectionTab===id?'0':'-1'}">${icon(id)}${id[0].toUpperCase()+id.slice(1)}</button>`).join('')}</div>
    <div class="settings-sections">
      ${section('chat','Chat','Write, edit, and refine your scripts.',providerRow('openrouter','Chat','Access cloud chat models with your OpenRouter key.'))}
      ${section('audio','Audio','Generate speech, clone voices, and transcribe recordings.',
        providerRow('openrouter','Audio','Cloud speech generation and audio transcription.')+
        providerRow('voicestudio','Audio','Speech and voice cloning through your VoiceStudio server.')+
        providerRow('worker','Audio','Connect an existing GX10 speech worker.')+
        '<div class="connection-subheading" data-local-intro><span>On this Mac</span><span>Download once. Generate without API credits.</span></div><div id="local-tts-settings"><p class="settings-local-note" role="status">Checking local models…</p></div>')}
      ${section('video','Video','Create video clips and talking avatars.',providerRow('openrouter','Video','Video generation and HeyGen avatars through OpenRouter.'))}
      <div class="settings-no-results" hidden><h2>No connections found</h2><p>Try a provider name, “voice”, or “local”.</p><button type="button" id="clear-settings-search">Clear search</button></div>
      <div id="connection-editor-home" hidden></div>
    </div></div></div></div>`;

  // One editor per provider is moved inline to the row the user opens.
  // OpenRouter's key and status are shared across all three groups.
  q('#connection-editor-home').innerHTML = Object.entries(services).map(([service, spec]) => `<form class="connection-editor" data-service="${service}" id="connect-${service}" hidden>
    <div class="connection-editor-intro"><p>${spec.help}</p><button type="button" data-close-editor aria-label="Close ${spec.name} setup">×</button></div>
    ${spec.url?`<label for="settings-${spec.url}">${spec.urlLabel}<input id="settings-${spec.url}" name="${spec.url}" type="url" required value="${escape(settings[spec.url])}" placeholder="${spec.placeholder}" spellcheck="false" maxlength="2000"></label>`:''}
    <label for="settings-${spec.key}">${service==='worker'?'Connection key':'API key'}<input id="settings-${spec.key}" name="${spec.key}" type="password" autocomplete="new-password" placeholder="${configured(service)?'Key saved · enter a new key to replace':'Paste your API key'}"></label>
    <div class="connection-editor-actions"><span class="settings-status" data-editor-status role="status"></span><div class="settings-buttons"><button type="button" class="settings-text-button" data-remove-key ${configured(service)?'':'hidden'}>${spec.url?'Disconnect':'Remove key'}</button><button type="submit" class="primary"></button></div></div>
    <p class="settings-footnote">${spec.note}</p>
    ${service==='openrouter'?`<details class="connection-models"><summary>Model choices</summary><div class="connection-model-choices">${[['model','writing','Chat model'],['speechModel','speech','Speech model'],['listeningModel','listening','Transcription model']].map(([key,use,label])=>modelPicker(use,settings[key],key+'-picker',key,label)).join('')}<div class="connection-catalog"><span id="catalog-status" class="settings-status">${settings.catalog?.models?.length||0} models available</span><button type="button" id="refresh-models">Refresh models</button></div><p id="models-save-status" class="settings-status" role="status" hidden></p></div></details>`:''}
  </form>`).join('');

  const forms = Object.fromEntries(Object.keys(services).map(service=>[service,q(`[data-service="${service}"]`)]));
  const updateSummaries = () => {
    for (const service of Object.keys(services)) {
      const saved = configured(service);
      const connected = checks[service] === true || (service==='worker'&&getSettings().workerStatus==='connected'&&checks[service]!==false);
      const label = checks[service] === false ? 'Check connection' : connected ? 'Connected' : saved ? (service==='worker'?'Configured':'Key saved') : 'Not connected';
      host.querySelectorAll(`[data-service-summary="${service}"]`).forEach(el=>{el.textContent=label;el.dataset.state=checks[service]===false?'error':connected?'success':'';});
      host.querySelectorAll(`[data-connect="${service}"]`).forEach(button=>{
        button.textContent=saved?'Manage':'Connect';
        const group=button.closest('[data-connection-group]').dataset.connectionGroup;
        button.setAttribute('aria-label',`${saved?'Manage':'Connect'} ${services[service].name} for ${group}`);
        button.setAttribute('aria-expanded',String(!forms[service].hidden&&forms[service].previousElementSibling===button.closest('[data-connection-row]')));
        button.setAttribute('aria-controls',`connect-${service}`);
      });
      forms[service].querySelector('[data-remove-key]').hidden=!saved;
      const input=forms[service].elements[services[service].key];
      input.required=service!=='worker'&&!getSettings()[services[service].configured];
      const address=services[service].url;
      const changed=!!input.value.trim()||(address&&forms[service].elements[address].value.trim()!==(getSettings()[address]||''));
      forms[service].querySelector('[type="submit"]').textContent=!saved?'Connect':changed?'Save & test':'Test connection';
    }
  };
  const closeEditor = form => {closeModelPicker();form.hidden=true;q('#connection-editor-home').append(form);updateSummaries();};
  const filterRows = () => {
    const words=q('#settings-search').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let count=0;
    host.querySelectorAll('[data-connection-group]').forEach(group=>{
      let matches=0;
      group.querySelectorAll('[data-connection-row]').forEach(el=>{
        el.hidden=!words.every(word=>el.dataset.search.includes(word));
        if(!el.hidden)matches++;
        const form=el.nextElementSibling;
        if(el.hidden&&form?.matches('.connection-editor'))closeEditor(form);
      });
      const local=q('#local-tts-settings');
      const localVisible=group.contains(local)&&(!local.querySelector('[data-connection-row]')||[...local.querySelectorAll('[data-connection-row]')].some(el=>!el.hidden));
      if(group.contains(local)){q('[data-local-intro]').hidden=!localVisible;local.hidden=!localVisible;}
      group.hidden=group.dataset.connectionGroup!==activeConnectionTab||(words.length>0&&!matches&&!localVisible);
      if(!group.hidden)count++;
    });
    q('.settings-no-results').hidden=count>0;
  };
  q('#settings-search').oninput=filterRows;
  const clearSearch=()=>{q('#settings-search').value='';filterRows();};
  q('#settings-search').onkeydown=e=>{if(e.key==='Escape')clearSearch();};
  q('#clear-settings-search').onclick=()=>{clearSearch();q('#settings-search').focus();};
  q('#local-tts-settings').addEventListener('local-models-updated',filterRows);
  const tabs=[...host.querySelectorAll('[data-connection-tab]')];
  const selectTab = tab => {
    Object.values(forms).forEach(closeEditor);
    activeConnectionTab=tab.dataset.connectionTab;
    for(const button of tabs){const selected=button===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
    filterRows();q('.settings-main').scrollTop=0;
  };
  for(const [index,tab] of tabs.entries()){
    tab.onclick=()=>selectTab(tab);
    tab.onkeydown=event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
      if(next===null)return;event.preventDefault();selectTab(tabs[next]);tabs[next].focus();
    };
  }
  q('[data-jump="top"]').onclick=()=>{clearSearch();q('.settings-main').scrollTop=0;q('#settings-heading').focus({preventScroll:true});};
  host.querySelectorAll('[data-connect]').forEach(button=>button.onclick=()=>{
    const form=forms[button.dataset.connect],same=!form.hidden&&form.previousElementSibling===button.closest('[data-connection-row]');
    Object.values(forms).forEach(closeEditor);
    if(same){button.focus();return;}
    button.closest('[data-connection-row]').after(form);form.hidden=false;updateSummaries();
    form.querySelector('input:not([type="hidden"])').focus({preventScroll:true});
  });
  for(const [service,form] of Object.entries(forms)){
    const spec=services[service],keyInput=form.elements[spec.key],output=form.querySelector('[data-editor-status]');
    form.oninput=updateSummaries;
    form.querySelector('[data-close-editor]').onclick=()=>{const button=form.previousElementSibling?.querySelector('[data-connect]');closeEditor(form);button?.focus();};
    const run=async operation=>{
      if(form.dataset.busy)return;
      form.dataset.busy='true';
      const controls=[...form.querySelectorAll('input,button,summary')],disabled=controls.map(el=>el.disabled);
      closeModelPicker();controls.forEach(el=>el.disabled=true);
      output.dataset.state='busy';
      try{await operation();output.dataset.state='success';}
      catch(error){output.dataset.state='error';output.textContent=error.message||String(error);}
      finally{delete form.dataset.busy;controls.forEach((el,i)=>el.disabled=disabled[i]);updateSummaries();}
    };
    form.onsubmit=event=>{
      event.preventDefault();
      run(async()=>{
        output.textContent='Connecting…';
        const changes={};
        if(keyInput.value.trim())changes[spec.key]=keyInput.value.trim();
        if(spec.url)changes[spec.url]=form.elements[spec.url].value.trim();
        if(Object.keys(changes).length){
          await api('/settings','PUT',changes);
          keyInput.value='';keyInput.placeholder='Key saved · enter a new key to replace';
          await refresh();
          if(spec.url)form.elements[spec.url].value=getSettings()[spec.url]||'';
          updateSummaries();
        }
        try{await api(`/${service}/check`,'POST');checks[service]=true;await refresh();connection();}
        catch(error){checks[service]=false;throw new Error(`${configured(service)?'Saved, but could not connect. ':''}${error.message||String(error)}`);}
        output.textContent=service==='openrouter'?'Connected for Chat, Audio, and Video.':'Connected.';
      });
    };
    form.querySelector('[data-remove-key]').onclick=()=>run(async()=>{
      output.textContent='Disconnecting…';
      await api('/settings','PUT',{[spec.key]:'',...(spec.url?{[spec.url]:''}:{})});
      await refresh();delete checks[service];keyInput.value='';
      if(spec.url)form.elements[spec.url].value='';
      keyInput.placeholder='Paste your API key';connection();
      output.textContent=configured(service)?'A key is still supplied by your app environment.':'Disconnected.';
    });
  }
  // Model choices stay with their provider, rather than becoming another setup page.
  let saveChain=Promise.resolve();
  host.querySelectorAll('.model-picker input[type="hidden"]').forEach(input=>{
    let saved=input.value;
    input.onchange=()=>{
      const value=input.value,button=input.closest('.model-picker').querySelector('.model-trigger'),feedback=q('#models-save-status');
      button.disabled=true;feedback.hidden=false;feedback.textContent='Saving…';
      saveChain=saveChain.then(async()=>{
        try{await api('/settings','PUT',{[input.name]:value,...(input.name==='speechModel'&&value!==saved?{voice:''}:{})});saved=value;await refresh();feedback.textContent='Saved';}
        catch(error){input.value=saved;initModelPickers();feedback.textContent=error.message;}
        finally{button.disabled=false;}
      });
    };
  });
  q('#refresh-models').onclick=async()=>{
    const button=q('#refresh-models');button.disabled=true;button.textContent='Refreshing…';
    try{await loadModels();}catch(error){q('#catalog-status').textContent=error.message;}
    finally{button.disabled=false;button.textContent='Refresh models';}
  };
  updateSummaries();initModelPickers();filterRows();renderLocalSettings();
}

export function renderLocalModelSettings(host, status, {download,refresh}) {
  const rows=Object.entries(status.models||{}).sort(([a],[b])=>Object.keys(localModels).indexOf(a)-Object.keys(localModels).indexOf(b));
  host.innerHTML=rows.map(([key,model])=>{
    const [name,description]=localModels[key]||[model.name,'Local voice generation.'];
    const busy=status.busy&&status.engine===key;
    const label=busy?'Downloading…':!status.supported?'Apple Silicon required':model.ready?'Downloaded':'Not downloaded';
    return row(`${escape(name)}<span class="connection-kind">Local</span>`,escape(description),`<span class="settings-status ${model.ready?'is-ready':''}">${label}</span><button type="button" data-local-download="${escape(key)}" ${status.busy||!status.supported?'disabled':''} aria-label="${model.ready?'Verify':'Download'} ${escape(name)}">${busy?'Downloading…':model.ready?'Verify':'Download'}</button>`,`data-connection-row data-search="${escape(`audio local this mac download ${name} ${description} ${key} ${model.ready?'downloaded ready installed':''}`.toLowerCase())}"`);
  }).join('')+`<div class="local-download-footer"><p role="status" class="settings-status" data-local-status>${status.busy?'Setup is in progress. Keep MyTwin open.':status.error?escape(status.error):!status.supported?'Local models require a Mac with an Apple Silicon chip.':'The first download also installs the speech runtime. Allow several minutes and several GB of storage.'}</p><button type="button" class="settings-inline-action" data-local-refresh>Refresh status</button></div>`;
  const output=host.querySelector('[data-local-status]');
  if(status.error)output.dataset.state='error';
  host.querySelectorAll('[data-local-download]').forEach(button=>button.onclick=async()=>{
    const controls=[...host.querySelectorAll('[data-local-download]')];controls.forEach(el=>el.disabled=true);
    output.textContent='Starting download…';output.dataset.state='busy';
    try{await download(button.dataset.localDownload);await refresh();}
    catch(error){output.textContent=error.message||String(error);output.dataset.state='error';controls.forEach(el=>el.disabled=!!status.busy||!status.supported);}
  });
  host.querySelector('[data-local-refresh]').onclick=async()=>{try{await refresh();}catch(error){output.textContent=error.message;output.dataset.state='error';}};
  host.dispatchEvent(new Event('local-models-updated'));
}
