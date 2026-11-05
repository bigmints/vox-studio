(() => {
  const root = document.getElementById('studio-preview');
  if (!root) return;
  const initial = () => [
    { id: 1, speaker: 'host', text: 'Welcome to Fikr Vox. Today, we’re turning a simple conversation into a podcast.' },
    { id: 2, speaker: 'guest', text: 'And each speaker gets a voice, a track, and a little personality. What will you create?' }
  ];
  let turns = initial(), selected = 1, nextId = 3, position = 0, playing = false, token = 0, timer = null;
  const speakers = {host:{name:'Host', volume:1, muted:false, voice:''},guest:{name:'Guest',volume:1,muted:false,voice:''}};
  const recordings = {"host": {"url": "assets/audio/host.wav", "duration": 7.2}, "guest": {"url": "assets/audio/guest.wav", "duration": 6.0}, "host-heart": {"url": "assets/audio/host-heart.wav", "duration": 6.0}, "guest-george": {"url": "assets/audio/guest-george.wav", "duration": 7.025}};
  let activeAudio = null;
  let speed = 1, gap = .35, pane = 'script';
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  root.innerHTML = `
    <div class="dp-top"><span class="dp-project">My first podcast <span aria-hidden="true">⌄</span></span><button data-reset>New</button><div class="dp-workspace-switch"><span>${icon('M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4')} Audio</span></div><span class="dp-top-note">Interactive preview</span><button data-about aria-label="About this demo">${icon('M4 4h16v16H4zm11 0v16')}</button></div>
    <div class="dp-body"><aside class="dp-rail" aria-label="Demo tools"><div class="dp-rail-mark" aria-hidden="true">${icon('M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4')}</div><button aria-label="Edit episode dialogue" data-focus-editor>${icon('M4 4h16v16H4zm5 0v16m4-11 4 3-4 3z')}</button><button aria-label="Speaker voice settings" data-voices>${icon('M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0M4 21v-3a8 8 0 0 1 16 0v3')}</button><button aria-label="About this interactive demo" data-about>${icon('M12 8v1m0 3v5M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20')}</button></aside>
    <div class="dp-main"><div class="dp-tools"><div class="dp-characters"><span><b>1</b>Host <small>My voice</small></span><span><b>2</b>Guest <small>Guest voice</small></span></div><div class="dp-tools-right"><button data-voices>Speakers &amp; voices</button><label><span>Timing</span><select data-pacing aria-label="Demo conversation timing"><option value=".15">Quick exchange</option><option value=".35" selected>Natural conversation</option><option value=".8">Relaxed conversation</option></select></label></div></div>
    <div class="dp-modal" data-about-panel hidden><h3>Try the Fikr Vox workflow</h3><p>Edit dialogue, assign speakers, reorder turns, and explore the timeline. Playback uses prepared Kokoro neural voice recordings from Fikr Vox. Edited scripts need a new voice take in the desktop app. This demo stays on this page; it does not create projects in the desktop app.</p><button data-about-close>Back to the studio</button></div>
    <div class="dp-status" data-status role="status" aria-live="polite">Try it: select a turn, edit the script, then press play.</div>
    <div class="dp-workspace"><section class="dp-dialogue" aria-label="Demo episode dialogue"><div class="dp-heading"><h3>Episode dialogue</h3><span class="dp-count" data-count></span></div><p class="dp-hint">Edit the dialogue, listen to the conversation, then adjust the timing below.</p><div class="dp-turns" data-turns></div></section>
    <section class="dp-editor" aria-label="Demo turn editor"><h3 data-editor-title>Host · Turn 1</h3><label for="demo-speaker">Speaking</label><select class="dp-speaker" id="demo-speaker"><option value="host">Host</option><option value="guest">Guest</option></select><div class="dp-tabs" role="tablist" aria-label="Turn settings"><button id="demo-script-tab" role="tab" aria-selected="true" aria-controls="demo-script-panel" data-pane="script">Script</button><button id="demo-voice-tab" role="tab" aria-selected="false" aria-controls="demo-voice-panel" data-pane="voice">Voice</button></div><div id="demo-script-panel" role="tabpanel" aria-labelledby="demo-script-tab"><label for="demo-script">Script</label><textarea id="demo-script" maxlength="800" spellcheck="true"></textarea><span class="dp-word-count" data-words></span></div><div class="dp-voice-pane" id="demo-voice-panel" role="tabpanel" aria-labelledby="demo-voice-tab" hidden><label for="demo-voice">Neural preview voice</label><select id="demo-voice"></select><p>The website uses Kokoro neural voice recordings for this preview. Download Fikr Vox to use local models, voice cloning, and connected providers.</p><button data-audition>Listen to this turn</button></div></section></div>
    <div class="dp-transport"><button class="dp-play" data-play aria-label="Play conversation">▶</button><button data-stop aria-label="Stop and return to beginning">■</button><span class="dp-time" data-time>0:00 / 0:00</span><label class="dp-speed">Speed <select data-speed aria-label="Demo playback speed"><option value=".75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label><div class="dp-edit-actions"><button data-duplicate>Duplicate</button><button data-delete>Delete</button><button class="dp-primary" data-add>+ Turn</button></div></div>
    <div class="dp-timeline" aria-label="Demo conversation timeline"><div class="dp-seek-row"><label for="demo-seek">TRACKS</label><input type="range" id="demo-seek" min="0" max="20" value="0" step=".1" aria-label="Seek conversation in seconds"></div><div data-tracks></div></div>
    <div class="dp-foot"><span>Interactive preview · Kokoro neural voice samples</span><a href="docs/#podcasts">Explore the full app ↗</a></div></div></div>`;
  const $ = selector => root.querySelector(selector);
  const safe = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wordCount = text => text.trim() ? text.trim().split(/\s+/).length : 0;
  const sampleFor = turn => {
    const line = initial().find(t => t.text === turn.text);
    if (!line) return null;
    const voice = speakers[turn.speaker].voice || (turn.speaker === 'host' ? 'george' : 'heart');
    return recordings[line.speaker === 'host' ? (voice === 'heart' ? 'host-heart' : 'host') : (voice === 'george' ? 'guest-george' : 'guest')];
  };
  const duration = turn => sampleFor(turn) ? sampleFor(turn).duration / speed : Math.max(1.5, wordCount(turn.text) / (2.5 * speed));
  const layout = () => { let cursor = 0; return turns.map(turn => { const clip = {...turn,start:cursor,duration:duration(turn)}; cursor += clip.duration + gap; return clip; }); };
  const total = () => {const clips=layout();return clips.length?clips.at(-1).start+clips.at(-1).duration:0;};
  const current = () => turns.find(turn=>turn.id===selected);
  const time = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
  const status = message => {$('[data-status]').textContent=message;};
  function updatePosition() {
    const length = total(); position = Math.min(Math.max(position,0),length);
    $('[data-time]').textContent=`${time(position)} / ${time(length)}`;
    $('#demo-seek').max=length; $('#demo-seek').value=position;
    $('#demo-seek').setAttribute('aria-valuetext',`${time(position)} of ${time(length)}`);
    root.querySelectorAll('.dp-playhead').forEach(el=>el.style.left=`${length?position/length*100:0}%`);
  }
  function stop(reset=false) {
    token++; playing=false; clearTimeout(timer); if(activeAudio){activeAudio.pause(); activeAudio.src=''; activeAudio=null;}
    if(reset) position=0;
    $('[data-play]').textContent='▶'; $('[data-play]').setAttribute('aria-label','Play conversation'); updatePosition();
  }
  function renderTurns() {
    $('[data-count]').textContent=`${turns.length} dialogue turns`;
    $('[data-turns]').innerHTML=turns.map((turn,index)=>`<article class="dp-turn ${turn.id===selected?'selected':''}"><div class="dp-turn-head"><span>${String(index+1).padStart(2,'0')}</span><strong>${speakers[turn.speaker].name}</strong><span>${turn.text.trim()?(sampleFor(turn)?'Voice ready':'Needs new voice'):'Add script'}</span></div><button class="dp-turn-text" data-select="${turn.id}" aria-label="Edit turn ${index+1}">${safe(turn.text)||'Write something for this speaker…'}</button><div class="dp-turn-actions"><button data-turn-voice="${turn.id}">Voice settings</button><button data-from="${turn.id}">Play from here</button><button data-move="${turn.id}" data-dir="-1" aria-label="Move turn ${index+1} earlier" ${index===0?'disabled':''}>↑</button><button data-move="${turn.id}" data-dir="1" aria-label="Move turn ${index+1} later" ${index===turns.length-1?'disabled':''}>↓</button></div></article>`).join('');
  }
  function renderTracks() {
    const clips=layout(), length=total();
    $('[data-tracks]').innerHTML=Object.entries(speakers).map(([key,speaker])=>`<div class="dp-track"><div class="dp-track-head"><span class="dp-track-type">A${key==='host'?1:2} · AUDIO</span><strong>${speaker.name}</strong><div class="dp-track-mix"><button data-mute="${key}" aria-label="Mute ${speaker.name}" aria-pressed="${speaker.muted}">M</button><input type="range" min="0" max="1" step=".05" value="${speaker.volume}" data-volume="${key}" aria-label="${speaker.name} volume"></div></div><div class="dp-lane">${clips.filter(c=>c.speaker===key).map(c=>`<button class="dp-clip" data-clip="${c.id}" aria-label="Select ${speaker.name} turn ${turns.findIndex(t=>t.id===c.id)+1}" aria-pressed="${c.id===selected}" style="left:${c.start/length*100}%;width:${c.duration/length*100}%"><strong>${speaker.name} · ${safe(c.text.slice(0,32))||'New turn'}</strong><span class="dp-wave" aria-hidden="true">${Array.from({length:90},(_,i)=>`<i style="height:${4+Math.round(Math.abs(Math.sin(i*2.3)*Math.cos(i*.19))*23)}px"></i>`).join('')}</span><small>~${c.duration.toFixed(1)}s</small></button>`).join('')}<span class="dp-playhead"></span></div></div>`).join('');
    updatePosition();
  }
  function renderVoice() {
    const speaker=speakers[current().speaker];
    $('#demo-voice').innerHTML='<option value="george">George · Kokoro · British English</option><option value="heart">Heart · Kokoro · American English</option>';
    $('#demo-voice').value=speaker.voice || (current().speaker==='host'?'george':'heart');
  }
  function setPane(next) {
    pane=next;
    root.querySelectorAll('[data-pane]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.pane===pane));b.setAttribute('aria-pressed',String(b.dataset.pane===pane));b.tabIndex=b.dataset.pane===pane?0:-1;});
    $('#demo-script-panel').hidden=pane!=='script'; $('#demo-voice-panel').hidden=pane!=='voice';
  }
  function renderEditor() {
    const turn=current(); $('#demo-script').value=turn.text; $('#demo-speaker').value=turn.speaker;
    $('[data-editor-title]').textContent=`${speakers[turn.speaker].name} · ${turns.indexOf(turn)===0?'Opening':'Reply'}`;
    $('[data-words]').textContent=`${wordCount(turn.text)} words · ~${duration(turn).toFixed(1)} sec`;
    $('[data-delete]').disabled=turns.length===1; $('[data-add]').disabled=turns.length>=8; $('[data-duplicate]').disabled=turns.length>=8;
    renderVoice(); setPane(pane);
  }
  function render() { renderTurns(); renderTracks(); renderEditor(); }
  function select(id, nextPane='script') { stop(); selected=id; pane=nextPane; render(); }
  function play(onlyTurn = false) {
    stop(); const run=token; const clips=layout();
    if(position>=total()-.05) position=0;
    let index=clips.findIndex(c=>c.start+c.duration>position);
    if(index<0) index=0;
    const stopAt = onlyTurn ? index + 1 : clips.length;
    playing=true; $('[data-play]').textContent='Ⅱ'; $('[data-play]').setAttribute('aria-label','Pause conversation');
    status('Playing Kokoro neural voice samples from Fikr Vox.');
    function next() {
      if(run!==token) return;
      if(index>=stopAt) {const last=clips[stopAt-1];position=last.start+last.duration;stop();status('Preview finished. Try another voice or explore the dialogue controls.');return;}
      const clip=clips[index++], speaker=speakers[clip.speaker];
      const offset=Math.max(0,position-clip.start), fraction=Math.min(offset/clip.duration,.99);
      let startChar=Math.floor(clip.text.length*fraction);
      if(startChar>0) {const space=clip.text.indexOf(' ',startChar);startChar=space<0?0:space+1;}
      position=Math.max(position,clip.start); selected=clip.id;render();
      if(!clip.text.trim()||speaker.muted||speaker.volume===0) {
        timer=setTimeout(()=>{if(run!==token)return;position=clip.start+clip.duration;updatePosition();timer=setTimeout(next,gap*1000);}, Math.max(0,clip.duration-offset)*1000);return;
      }
      const recording=sampleFor(clip);
      if(!recording){stop();status('This edited script needs a new voice take. Generate it in Fikr Vox, or choose New to hear the prepared samples.');return;}
      const audio=new Audio(recording.url);activeAudio=audio;
      audio.playbackRate=speed;audio.volume=speaker.volume;
      audio.onloadedmetadata=()=>{if(run===token)audio.currentTime=Math.min(offset*speed,Math.max(0,audio.duration-.01));};
      audio.ontimeupdate=()=>{if(run!==token)return;position=clip.start+audio.currentTime/speed;updatePosition();};
      audio.onended=()=>{if(run!==token)return;activeAudio=null;position=clip.start+clip.duration;updatePosition();timer=setTimeout(next,gap*1000);};
      audio.onerror=()=>{if(run!==token)return;stop();status('The sample could not load. Check your connection and try again.');};
      audio.play().catch(()=>{if(run!==token)return;stop();status('Press play again to start the neural voice sample.');});
    }
    next();
  }
  root.addEventListener('click', event => {
    const b=event.target.closest('button');if(!b||!root.contains(b))return;
    if(b.hasAttribute('data-play')) {if(playing){stop();status('Paused. Press play to continue.');}else play();}
    else if(b.hasAttribute('data-stop')) {stop(true);status('Returned to the beginning.');}
    else if(b.hasAttribute('data-reset')) {stop(true);turns=initial();selected=1;nextId=3;speed=1;gap=.35;pane='script';Object.values(speakers).forEach(s=>{s.volume=1;s.muted=false;s.voice='';});$('[data-speed]').value='1';$('[data-pacing]').value='.35';render();status('Demo reset. Select a turn to start editing.');}
    else if(b.dataset.select) select(Number(b.dataset.select));
    else if(b.dataset.clip) {select(Number(b.dataset.clip));position=layout().find(c=>c.id===selected).start;updatePosition();}
    else if(b.dataset.turnVoice) select(Number(b.dataset.turnVoice),'voice');
    else if(b.hasAttribute('data-voices')) {stop();setPane('voice');$('#demo-voice').focus();}
    else if(b.hasAttribute('data-focus-editor')) {setPane('script');$('#demo-script').focus();}
    else if(b.hasAttribute('data-about')) $('[data-about-panel]').hidden=!$('[data-about-panel]').hidden;
    else if(b.hasAttribute('data-about-close')) $('[data-about-panel]').hidden=true;
    else if(b.dataset.pane) {setPane(b.dataset.pane);}
    else if(b.dataset.from||b.hasAttribute('data-audition')) {stop();const id=Number(b.dataset.from)||selected;position=layout().find(c=>c.id===id).start;play(b.hasAttribute('data-audition'));}
    else if(b.dataset.move) {stop(true);const i=turns.findIndex(t=>t.id===Number(b.dataset.move)),j=i+Number(b.dataset.dir);if(j<0||j>=turns.length)return;[turns[i],turns[j]]=[turns[j],turns[i]];render();status('Turn reordered. The timeline follows the new conversation order.');}
    else if(b.hasAttribute('data-add')) {if(turns.length>=8)return;stop();const turn={id:nextId++,speaker:current().speaker==='host'?'guest':'host',text:''};turns.push(turn);selected=turn.id;pane='script';render();$('#demo-script').focus();status('New turn added. Write its script in the editor.');}
    else if(b.hasAttribute('data-duplicate')) {if(turns.length>=8)return;stop();const copy={...current(),id:nextId++};turns.splice(turns.indexOf(current())+1,0,copy);selected=copy.id;render();status('Turn duplicated.');}
    else if(b.hasAttribute('data-delete')) {if(turns.length===1)return;stop(true);const i=turns.indexOf(current());turns.splice(i,1);selected=turns[Math.min(i,turns.length-1)].id;render();status('Turn deleted.');}
    else if(b.dataset.mute) {stop();const s=speakers[b.dataset.mute];s.muted=!s.muted;renderTracks();status(`${s.name} ${s.muted?'muted':'unmuted'}.`);}
  });
  $('#demo-script').addEventListener('input',()=>{stop();current().text=$('#demo-script').value;status(sampleFor(current())?'Prepared neural voice sample ready.':'Edited script: generate a new voice take in Fikr Vox. Choose New to restore the audio samples.');renderTurns();renderTracks();$('[data-words]').textContent=`${wordCount(current().text)} words · ~${duration(current()).toFixed(1)} sec`;});
  $('#demo-speaker').addEventListener('change',()=>{stop();current().speaker=$('#demo-speaker').value;render();status('Speaker and timeline track updated.');});
  $('#demo-voice').addEventListener('change',()=>{stop();speakers[current().speaker].voice=$('#demo-voice').value;renderTracks();renderEditor();status('Neural preview voice selected.');});
  $('[data-pacing]').addEventListener('change',()=>{stop(true);gap=Number($('[data-pacing]').value);renderTracks();status('Conversation gaps updated.');});
  $('[data-speed]').addEventListener('change',()=>{stop(true);speed=Number($('[data-speed]').value);renderTracks();renderEditor();status('Playback speed updated.');});
  $('#demo-seek').addEventListener('input',()=>{const value=Number($('#demo-seek').value);stop();position=value;updatePosition();});
  root.addEventListener('input',event=>{if(event.target.dataset.volume){stop();speakers[event.target.dataset.volume].volume=Number(event.target.value);}});
  root.querySelector('[role=tablist]').addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();setPane(event.key==='Home'?'script':event.key==='End'?'voice':pane==='script'?'voice':'script');$(`[data-pane="${pane}"]`).focus();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stop();status('Playback paused while this tab is hidden.');}});
  window.addEventListener('pagehide',()=>stop());
  render();
})();
