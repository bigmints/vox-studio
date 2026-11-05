import {pacingTrim} from './audio-pacing.js';
import {AudioBufferCache} from './audio-cache.js';
import {activeVideoJob, videoJobLabel, videoJobBusy} from './job-status.js';
import {peaksFor} from './timeline-editor.js';
import {arrangeAudio, playbackPlan, audioTracks, editableAudioClips, linkedVideo, videoAtTime} from './timeline-model.js';
import {rulerStep, timelineScale, snapClipMove} from './timeline-tools.js';

let suppressClipClickUntil = 0;
const audioCache=new AudioBufferCache();
const fmt = n => `${Math.floor(n / 60)}:${(n % 60).toFixed(1).padStart(4, '0')}`;
export function mountAudioTimeline({host, transport, clips, videoJobs = [], tracks, selected, url,
  select, selectTrack, trackStatus, change, reorder, place, updateTrack, addTrack, addSection, importMusic, editScript, editVideo,
  exportAudio, showShortcuts, session, report, split, duplicate, remove, undo, redo, canUndo, canRedo,
  audioOnly = false, previewRatio = '16:9', previewFit = 'contain', updatePreview}) {
  let disposed = false, layout, ctx, sources = [], raf = 0, anchor = 0, base = 0;
  session.waveforms??=new Map();session.clipDurations??=new Map();
  const outputIds=new Set(clips.map(c=>c.take?.outputId));
  for(const id of session.waveforms.keys())if(!outputIds.has(id))session.waveforms.delete(id);
  let pendingViewport={left:session.scrollLeft||0,top:session.scrollTop||0},initialFit=!(session.zoom>0);
  const readyClip=(c,data)=>{const trim=c.sec.trims?.[c.take.outputId]||(c.sec.autoPace?data.autoTrim:undefined);return {...c,...data,sec:trim?{...c.sec,trims:{...c.sec.trims,[c.take.outputId]:trim}}:c.sec};};
  const warm=clips.flatMap(c=>{const data=c.take&&(audioCache.get(url(c.take.outputId))||session.waveforms.get(c.take.outputId));return data?[readyClip(c,data)]:[];});
  let playing = false, busy = false, drag = null, dragFrame = 0, loaded = editableAudioClips(clips,warm,session.clipDurations);
  let px = session.zoom || 36, fit = session.fit !== false, drawing, activeVideo, videoFailed = false;
  const labelWidth = 156, gains = new Map(), els = new Map(), lifetime = new AbortController();
  const listen = (el, event, fn, permanent = false) => el.addEventListener(event, fn, {signal: permanent ? lifetime.signal : drawing?.signal || lifetime.signal});
  const node = (tag, cls, text) => {const el = document.createElement(tag);if (cls) el.className = cls;if (text !== undefined) el.textContent = text;return el;};
  const button = (text, label, fn, permanent = false) => {const el = node('button', '', text);el.type = 'button';el.title = label;el.setAttribute('aria-label', label);listen(el, 'click', fn, permanent);return el;};
  const position = () => playing ? Math.min(layout?.duration || 0, Math.max(0, base + ctx.currentTime - anchor)) : session.time || 0;
  function rememberViewport(){const view=pendingViewport||{left:host.scrollLeft,top:host.scrollTop};session.scrollLeft=view.left;session.scrollTop=view.top;}
  function useViewport(){pendingViewport=null;initialFit=false;rememberViewport();}
  function stop() {
    if (playing) session.time = position();
    playing = false;
    sources.forEach(s => {try {s.stop();} catch {}});
    sources = [];cancelAnimationFrame(raf);video.pause();
  }
  session.isPlaying = () => playing;
  host.className = 'wave-timeline multitrack';host.replaceChildren();transport.replaceChildren();
  listen(host,'scroll',()=>{if(!pendingViewport)rememberViewport();},true);
  listen(host,'wheel',useViewport,true);
  host.addEventListener('pointerdown',useViewport,{capture:true,signal:lifetime.signal});

  const restart = button('↤', 'Back to start (Home)', () => seek(0), true);
  const play = button('▶', 'Play full timeline (Space)', toggle, true);play.className = 'transport-play';play.disabled = true;
  const clock = node('span', 'transport-time');
  const history = node('div', 'timeline-control-group');
  const undoButton = button('↶', 'Undo timeline edit (⌘Z)', () => {stop();undo?.();}, true);
  const redoButton = button('↷', 'Redo timeline edit (⇧⌘Z)', () => {stop();redo?.();}, true);
  undoButton.disabled = !canUndo;redoButton.disabled = !canRedo;history.append(undoButton, redoButton);
  const edits = node('div', 'timeline-control-group');
  const splitButton = button('Split', 'Split selected clip at playhead (B)', () => {stop();split?.(layout?.clips.find(c => c.sec.id === selected), position());}, true);
  const duplicateButton = button('Duplicate', 'Duplicate selected clip (⌘D)', () => {stop();duplicate?.(layout?.clips.find(c => c.sec.id === selected));}, true);
  const deleteButton = button('Delete', 'Remove selected clip', () => {stop();remove?.(selected);}, true);
  edits.append(splitButton, duplicateButton, deleteButton);
  const snap = button('Snap', 'Snap clips to edges and playhead (S)', () => {session.snap = session.snap === false;syncSnap();}, true);
  function syncSnap() {snap.setAttribute('aria-pressed', String(session.snap !== false));}syncSnap();
  const zoomGroup = node('div', 'timeline-zoom');
  const zoom = node('input');zoom.type = 'range';zoom.min = 1;zoom.max = 240;zoom.step = 1;zoom.setAttribute('aria-label', 'Timeline zoom');
  const zoomLabel = node('span', 'zoom-label');
  function setZoom(value) {
    useViewport();
    const center = (host.scrollLeft + (host.clientWidth - labelWidth) / 2) / px;
    px = Math.max(1, Math.min(240, value));fit = false;session.fit = false;session.zoom = px;
    draw();host.scrollLeft = Math.max(0, center * px - (host.clientWidth - labelWidth) / 2);rememberViewport();
  }
  listen(zoom, 'input', () => setZoom(Number(zoom.value)), true);
  const fitButton = button('Fit', 'Fit timeline to window (F)', () => {useViewport();fit = true;session.fit = true;session.scrollLeft=0;draw(true);}, true);
  zoomGroup.append(button('−', 'Zoom out', () => setZoom(px / 1.4), true), zoom, button('+', 'Zoom in', () => setZoom(px * 1.4), true), fitButton, zoomLabel);
  const exp = button('Export audio', 'Export mixed audio as WAV', exportAudio, true);exp.id = 'export-timeline';
  const more = node('details', 'timeline-more'), summary = node('summary', '', '•••');summary.setAttribute('aria-label', 'Timeline options');
  const mute = button('Mute output', 'Mute preview output (M)', () => {session.muted = !session.muted;applyGains();tick();}, true);
  const timelineMenu=node('div','timeline-menu');timelineMenu.append(mute, button('Keyboard shortcuts', 'Keyboard shortcuts (?)', showShortcuts, true), button('Add voice track', 'Add voice track', () => {stop();addTrack();}, true));more.append(summary,timelineMenu);
  listen(document,'pointerdown',e=>{if(!more.contains(e.target))more.open=false;},true);
  transport.append(restart, play, clock, history, edits, snap, zoomGroup, exp, more);

  const workspace = document.querySelector('.clip-workspace');
  const divider = node('div', 'timeline-divider');divider.tabIndex=0;divider.setAttribute('role','separator');divider.setAttribute('aria-label','Resize preview and timeline');divider.setAttribute('aria-orientation','horizontal');
  transport.closest('.timeline-heading').before(divider);
  function resizePanels(height) {const total=workspace.clientHeight;const value=Math.round(Math.max(240,Math.min(total-180,height)));session.timelineHeight=value;workspace.style.gridTemplateRows='minmax(180px,1fr) '+value+'px';divider.setAttribute('aria-valuemin','240');divider.setAttribute('aria-valuemax',String(Math.max(240,total-180)));divider.setAttribute('aria-valuenow',String(value));}
  resizePanels(session.timelineHeight||host.closest('.timeline').getBoundingClientRect().height);
  listen(divider,'pointerdown',e=>{e.preventDefault();const top=e.clientY,initial=host.closest('.timeline').getBoundingClientRect().height;divider.setPointerCapture(e.pointerId);divider.onpointermove=ev=>{if(divider.hasPointerCapture(ev.pointerId))resizePanels(initial+top-ev.clientY);};divider.onpointerup=ev=>divider.releasePointerCapture(ev.pointerId);},true);
  listen(divider,'keydown',e=>{if(!['ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();resizePanels(host.closest('.timeline').getBoundingClientRect().height+(e.key==='ArrowUp'?24:-24));},true);
  listen(host,'wheel',e=>{if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();setZoom(px*(e.deltaY<0?1.15:1/1.15));},true);
  const board = node('div', 'audio-board');host.append(board);
  const rulerRow = node('div', 'ruler-row'), rulerLabel = node('div', 'ruler-label', 'TRACKS');
  const ruler = node('div', 'audio-ruler');ruler.setAttribute('aria-label', 'Timeline ruler');rulerLabel.append(button('+', 'Add audio track', () => {stop();addTrack();}, true));rulerRow.append(rulerLabel, ruler);board.append(rulerRow);
  const head = node('div', 'audio-playhead');board.append(head);
  const trackList = structuredClone(audioTracks(tracks)).sort((a,b) => Number(a.kind==='music'||a.id==='music') - Number(b.kind==='music'||b.id==='music'));
  // A dedicated lane is always present, including on older projects.
  if (!trackList.some(t => t.kind === 'music' || t.id === 'music')) trackList.push({id: 'music', name: 'Music', kind: 'music', volume: 0.35, muted: false});

  const monitor = document.querySelector('#program-monitor') || host.parentElement;
  const videoPanel = node('section', 'program-monitor');videoPanel.setAttribute('aria-label', 'Video preview');
  const monitorHeader = node('div', 'monitor-header');monitorHeader.append(node('span', '', 'Preview'));
  const ratio = node('select');ratio.setAttribute('aria-label', 'Preview aspect ratio');
  for (const value of ['16:9', '9:16', '1:1', '4:3']) {const option = node('option', '', value);option.value = value;ratio.append(option);}
  ratio.value = ['16:9', '9:16', '1:1', '4:3'].includes(previewRatio) ? previewRatio : '16:9';
  const sizing = node('select');sizing.setAttribute('aria-label', 'Preview scaling');
  for (const [value, text] of [['contain', 'Fit'], ['cover', 'Fill']]) {const option = node('option', '', text);option.value = value;sizing.append(option);}sizing.value = previewFit === 'cover' ? 'cover' : 'contain';
  const full = button('⛶', 'Fullscreen preview', async () => {
    if (videoPanel.classList.contains('preview-expanded')) {
      videoPanel.classList.remove('preview-expanded');full.setAttribute('aria-pressed','false');
      if(document.fullscreenElement===videoPanel)await document.exitFullscreen();
      return;
    }
    videoPanel.classList.add('preview-expanded');full.setAttribute('aria-pressed','true');
    try {await videoPanel.requestFullscreen?.();} catch {}
  }, true);
  monitorHeader.append(ratio, sizing, full);
  const stage = node('div', 'monitor-stage'), frame = node('div', 'monitor-frame');
  const video = node('video');video.muted = true;video.playsInline = true;video.preload = 'auto';video.setAttribute('aria-label', 'Synchronized video preview');video.hidden = true;
  const still = node('img');still.alt = 'Scene reference at playhead';still.hidden = true;
  const empty = node('div', 'monitor-empty');empty.append(node('span', 'monitor-empty-symbol', '▻'), node('strong', '', 'Your video preview'), node('span', '', 'Add a scene in the Video tab to get started.'));
  frame.append(video, still, empty);stage.append(frame);
  const monitorFooter = node('div', 'monitor-footer');
  const previewPlay = button('▶', 'Play preview (Space)', toggle, true), previewClock = node('span', 'monitor-time');
  previewPlay.disabled = true;
  const videoNote = node('span', 'monitor-note');videoNote.setAttribute('role', 'status');
  monitorFooter.append(previewPlay, previewClock, videoNote);videoPanel.append(monitorHeader, stage, monitorFooter);if(!audioOnly)monitor.append(videoPanel);
  function setPreview() {frame.style.aspectRatio = ratio.value.replace(':', '/');frame.style.setProperty('--preview-aspect', ratio.value.split(':').reduce((a,b) => Number(a)/Number(b)));video.style.objectFit = still.style.objectFit = sizing.value;updatePreview?.(ratio.value, sizing.value);}
  frame.style.aspectRatio = ratio.value.replace(':', '/');frame.style.setProperty('--preview-aspect', ratio.value.split(':').reduce((a,b) => Number(a)/Number(b)));video.style.objectFit = still.style.objectFit = sizing.value;
  listen(ratio, 'change', setPreview, true);listen(sizing, 'change', setPreview, true);
  listen(document, 'fullscreenchange', () => full.setAttribute('aria-pressed', String(document.fullscreenElement === videoPanel || videoPanel.classList.contains('preview-expanded'))), true);
  listen(video, 'loadedmetadata', () => syncVideo(position(), true), true);
  listen(video, 'error', () => {videoFailed = true;video.hidden = true;empty.hidden = false;videoNote.textContent = 'Video unavailable';}, true);

  function syncVideo(t, force = false) {
    if(audioOnly)return;
    const match = videoAtTime(layout?.clips || [], videoJobs, t), job = match?.job;
    const scene = layout?.clips.find(c => t >= c.start && t < c.end && (!c.sec.audioAssetId || c.sec.sourceTakeId));
    const imageId = !job && scene?.sec.sceneImageId;
    still.hidden = !imageId;
    if (imageId && still.dataset.asset !== imageId) {still.dataset.asset = imageId;still.src = url(imageId);}
    empty.hidden = !!job || !!imageId;
    if (!job) {video.pause();video.hidden = true;activeVideo = null;videoNote.textContent = imageId ? 'Scene reference · video not generated' : 'No video at playhead';return;}
    if (activeVideo !== job.outputId) {video.pause();activeVideo = job.outputId;videoFailed = false;video.src = url(job.outputId);force = true;}
    if (videoFailed) {video.hidden = true;empty.hidden = false;videoNote.textContent = 'Video unavailable';return;}
    video.hidden = false;videoNote.textContent = match.clip.sec.title;
    if (video.readyState < 1) return;
    if (match.time >= video.duration) {video.pause();video.hidden = true;empty.hidden = false;videoNote.textContent = 'Scene video ended';return;}
    if (force || Math.abs(video.currentTime - match.time) > .12) video.currentTime = Math.max(0, match.time);
    if (playing && video.paused) video.play().catch(() => {});else if (!playing) video.pause();
  }
  function applyGains() {
    for (const t of trackList) {const gain = gains.get(t.id);if (gain) gain.gain.value = session.muted || t.muted ? 0 : t.volume ?? 1;}
  }
  function tick() {
    if (disposed) return;
    const t = position();syncVideo(t);head.style.left = (labelWidth + t * px) + 'px';
    clock.textContent = fmt(t) + ' / ' + (loaded.some(c => c.pending) ? '~' : '') + fmt(layout?.duration || 0);
    previewClock.textContent = fmt(t);play.textContent = previewPlay.textContent = playing ? 'Ⅱ' : '▶';
    play.setAttribute('aria-label', playing ? 'Pause (Space)' : 'Play full timeline (Space)');
    previewPlay.setAttribute('aria-label', playing ? 'Pause preview (Space)' : 'Play preview (Space)');
    mute.textContent = session.muted ? 'Unmute output' : 'Mute output';mute.setAttribute('aria-pressed', String(!!session.muted));
    const current = !session.selectedTrackId && layout?.clips.find(c => c.sec.id === selected);
    splitButton.disabled = !current || current.pending || t - current.start < .05 || current.end - t < .05;
    duplicateButton.disabled = !current || current.pending;deleteButton.disabled = !!session.selectedTrackId || clips.length <= 1;
    for (const c of layout?.clips || []) els.get(c.sec.id)?.classList.toggle('playing', playing && t >= c.start && t < c.end);
    if (playing && t >= (layout?.duration || 0)) {stop();session.time = layout.duration;play.textContent = previewPlay.textContent = '▶';play.setAttribute('aria-label', 'Play full timeline (Space)');}
    cancelAnimationFrame(raf);if (playing) raf = requestAnimationFrame(tick);
  }
  async function start() {
    if (!layout || !ctx || busy || disposed || !layout.duration) return;
    busy = true;
    try {
      await ctx.resume();if (disposed) return;
      if ((session.time || 0) >= layout.duration) session.time = 0;
      stop();base = session.time || 0;anchor = ctx.currentTime + .03;
      for (const entry of playbackPlan(layout.clips, base)) {
        const c = layout.clips.find(c => c.sec.id === entry.id);if (!c.buffer) continue;
        const source = ctx.createBufferSource();source.buffer = c.buffer;source.connect(gains.get(entry.trackId));
        source.start(anchor + entry.delay, entry.offset, entry.duration);sources.push(source);
      }
      playing = true;tick();
    } catch (e) {stop();report(e.message);} finally {busy = false;}
  }
  function toggle() {if (playing) {stop();tick();} else start();}
  function seek(t) {const resume = playing;stop();session.time = Math.max(0, Math.min(layout?.duration || 0, t));tick();if (resume) start();}
  function commit(c, range) {stop();change(c.sec.id, c.take.outputId, range);}
  function refreshLayout(refit=false) {
    layout = arrangeAudio(loaded, trackList);
    px=timelineScale(session,host.clientWidth,layout.duration,refit,labelWidth);session.zoom=px;
    const width = Math.max(host.clientWidth - labelWidth, layout.duration * px + 48,(session.scrollLeft||0)+host.clientWidth-labelWidth);
    board.style.width = (labelWidth + width) + 'px';board.style.setProperty('--grid-step', (rulerStep(px) * px) + 'px');
    ruler.replaceChildren();
    const step = rulerStep(px);
    for (let i = 0; i * step * px <= width - 42; i++) {const mark = node('span', '', fmt(i * step));mark.style.left = (i * step * px) + 'px';ruler.append(mark);}
    session.time = Math.max(0,session.time || 0);zoom.value = px;zoomLabel.textContent = Math.round(px) + ' px/s';fitButton.setAttribute('aria-pressed', String(fit));
  }
  function rowFor(name, cls = '') {
    const row = node('div', 'audio-row ' + cls), label = node('div', 'audio-track-label'), lane = node('div', 'audio-lane');
    row.append(label, lane);board.append(row);label.append(node('span', 'track-type', name));
    listen(lane, 'pointerdown', e => {if (e.target === lane) seek((e.clientX - lane.getBoundingClientRect().left) / px);});
    return {row, label, lane};
  }
  function drawVideo() {
    const {row, label, lane} = rowFor('V1 · VIDEO', 'video-row');
    label.append(node('strong', '', 'Video'), node('span', 'track-subtitle', 'Linked to voice'));
    const levels = [];
    for (const c of layout.clips.filter(c => !c.sec.audioAssetId || c.sec.sourceTakeId)) {
      const job = linkedVideo(c, videoJobs), pending = activeVideoJob(videoJobs, c.sec.id, c.take?.id);
      const el = node('div', 'wave-clip audio-clip video-clip' + (c.sec.id === selected && !session.selectedTrackId ? ' selected' : '') + (!job ? ' video-placeholder' : ''));
      let level = levels.findIndex(end => end <= c.start);if (level < 0) level = levels.length;levels[level] = c.end;
      el.style.top = (8 + level * 68) + 'px';el.style.left = c.start * px + 'px';el.style.width = Math.max(8, (c.end - c.start) * px) + 'px';
      const control = button(c.sec.title, 'Edit video for ' + c.sec.title, () => {stop();editVideo?.(c.sec.id);});control.className = 'wave-title';
      const status = node('span', 'video-clip-status', pending ? videoJobLabel(pending) : job ? 'Video ready' : c.pending ? 'Generate voice first' : 'Set up video');
      if (videoJobBusy(pending)) {status.classList.add('is-rendering');el.setAttribute('aria-busy', 'true');}
      el.append(control, status);lane.append(el);
    }
    if (!levels.length) lane.append(node('span', 'lane-empty', 'Scene videos appear here, aligned with your voice clips.'));
    row.style.minHeight = lane.style.minHeight = Math.max(84, levels.length * 68 + 16) + 'px';
    board.insertBefore(row, board.querySelector('.audio-row'));
  }
  function paintWave(canvas, c) {
    const width = Math.max(8, Math.round((c.end - c.start) * px));
    // Canvas pixels are bounded; long clips still span their full duration in CSS.
    const resolution = Math.min(8192, width * 2);canvas.width = resolution;canvas.height = 64;
    const paint = canvas.getContext('2d');paint.fillStyle = getComputedStyle(host).getPropertyValue(trackList.some(t=>t.id===c.trackId&&(t.kind==='music'||t.id==='music')) ? '--green' : '--gold').trim();
    for (let x = 0; x < resolution; x += 4) {
      let peak = 0;
      const a = Math.floor((c.range.start + x / resolution * (c.end - c.start)) / c.duration * c.peaks.length);
      const b = Math.ceil((c.range.start + (x + 4) / resolution * (c.end - c.start)) / c.duration * c.peaks.length);
      for (let i = a; i < Math.min(b, c.peaks.length); i++) peak = Math.max(peak, c.peaks[i]);
      const height = Math.max(1, peak * 58);paint.fillRect(x, (64 - height) / 2, 2, height);
    }
  }
  const commitPlacement = (id, trackId, offset) => place(id, trackId, offset,
    layout.clips.map(c => ({id:c.sec.id, trackId:c.trackId, start:c.start})), trackList);
  host.addEventListener('click', e => {if(performance.now()<suppressClipClickUntil){e.preventDefault();e.stopImmediatePropagation();}}, {capture:true,signal:lifetime.signal});
  function clearMove(keepWidth = false) {
    const d=drag;if(!d)return;drag=null;cancelAnimationFrame(dragFrame);dragFrame=0;
    d.el.classList.remove('drag-source');host.classList.remove('is-dragging-clip');
    board.querySelectorAll('.drop-lane').forEach(lane=>lane.classList.remove('drop-lane'));
    d.ghost?.remove();d.guide?.remove();d.readout?.remove();if(d.boardWidth&&!keepWidth)board.style.width=d.boardWidth;
    try{if(d.el.hasPointerCapture(d.pointerId))d.el.releasePointerCapture(d.pointerId);}catch{}
  }
  function movePreview() {
    const d=drag;if(!d?.active)return;
    const hit=document.elementFromPoint(d.x,d.y),lane=hit?.closest('.audio-lane[data-track-id]');
    const track=lane&&host.contains(lane)&&trackList.find(t=>t.id===lane.dataset.trackId);
    board.querySelectorAll('.drop-lane').forEach(el=>{if(el!==lane||!track)el.classList.remove('drop-lane');});if(track)lane.classList.add('drop-lane');
    d.readout.style.left=Math.min(window.innerWidth-240,Math.max(8,d.x+14))+'px';
    d.readout.style.top=Math.max(8,d.y-54)+'px';
    d.valid=!!track;
    if(!track){d.ghost.hidden=true;d.guide.hidden=true;d.readout.textContent='Drop onto an audio track';return;}
    const candidate=(d.x-lane.getBoundingClientRect().left)/px-d.grab;
    const snapped=snapClipMove(candidate,d.c.end-d.c.start,layout.clips,d.c.sec.id,position(),px,session.snap!==false&&!d.shift);
    d.start=snapped.start;d.trackId=track.id;d.ghost.hidden=false;
    if(d.ghost.parentElement!==lane)lane.append(d.ghost);
    d.ghost.style.left=d.start*px+'px';d.ghost.style.top='8px';
    d.guide.hidden=snapped.guide===null;if(snapped.guide!==null)d.guide.style.left=labelWidth+snapped.guide*px+'px';
    d.readout.textContent=track.name+' · '+fmt(d.start)+' – '+fmt(d.start+d.c.end-d.c.start)+(d.shift?' · Snap off':'');
    const needed=labelWidth+(d.start+d.c.end-d.c.start)*px+64;
    if(needed>board.getBoundingClientRect().width)board.style.width=needed+'px';
  }
  function scrollMove() {
    if(!drag?.active||disposed)return;
    const r=host.getBoundingClientRect(),d=drag;
    if(d.y>=r.top&&d.y<=r.bottom){
      if(d.x>r.right-32)host.scrollLeft+=Math.min(18,(d.x-r.right+32)/2);
      else if(d.x<r.left+labelWidth+28&&d.x>r.left)host.scrollLeft-=Math.min(18,(r.left+labelWidth+28-d.x)/2);
    }
    if(d.x>=r.left&&d.x<=r.right){
      if(d.y>r.bottom-24)host.scrollTop+=12;
      else if(d.y<r.top+46)host.scrollTop-=12;
    }
    movePreview();dragFrame=requestAnimationFrame(scrollMove);
  }
  function beginMove(c,el,e) {
    if(e.button!==0||e.target.closest('.trim-handle'))return;
    e.preventDefault();e.stopPropagation();
    drag={c,el,pointerId:e.pointerId,originX:e.clientX,originY:e.clientY,x:e.clientX,y:e.clientY,shift:e.shiftKey,target:e.target,
      grab:Math.min(c.end-c.start,Math.max(0,(e.clientX-el.getBoundingClientRect().left)/px)),active:false,valid:false};
    el.setPointerCapture(e.pointerId);
  }
  function continueMove(e) {
    const d=drag;if(!d||d.pointerId!==e.pointerId)return;
    d.x=e.clientX;d.y=e.clientY;d.shift=e.shiftKey;
    if(!d.active&&Math.hypot(d.x-d.originX,d.y-d.originY)>=4){
      d.active=true;stop();tick();d.boardWidth=board.style.width;
      d.ghost=d.el.cloneNode(true);delete d.ghost.dataset.section;d.ghost.classList.add('clip-drag-ghost');d.ghost.classList.remove('selected','playing');d.ghost.setAttribute('aria-hidden','true');
      const canvas=d.ghost.querySelector('canvas');if(canvas&&!d.c.pending)paintWave(canvas,d.c);
      d.guide=node('div','timeline-snap-guide');d.guide.hidden=true;board.append(d.guide);
      d.readout=node('div','timeline-drag-readout');d.readout.setAttribute('aria-hidden','true');document.body.append(d.readout);
      d.el.classList.add('drag-source');host.classList.add('is-dragging-clip');scrollMove();
    }
    if(d.active)movePreview();
  }
  function endMove(e) {
    const d=drag;if(!d||d.pointerId!==e.pointerId)return;
    e.preventDefault();e.stopPropagation();suppressClipClickUntil=performance.now()+250;
    if(d.active){d.x=e.clientX;d.y=e.clientY;d.shift=e.shiftKey;movePreview();const valid=d.valid,id=d.c.sec.id,trackId=d.trackId,start=d.start,title=d.c.sec.title,moved=valid&&(trackId!==d.c.trackId||Math.abs(start-d.c.start)>.001);clearMove(moved);
      if(moved){commitPlacement(id,trackId,start);report('Moved '+title+' to '+trackList.find(t=>t.id===trackId).name+' at '+fmt(start));}
      return;
    }
    const target=d.target,c=d.c;clearMove();stop();
    if(target.closest('.draft-message')){editScript(c.sec.id);return;}
    if(target.closest('canvas')){const r=d.el.getBoundingClientRect();seek(c.start+Math.max(0,Math.min(c.end-c.start,(e.clientX-r.left)/px)));}
    select(c.sec.id);
  }
  function drawClip(c, lane, level) {
    const el = node('div', 'wave-clip audio-clip' + (c.sec.id === selected && !session.selectedTrackId ? ' selected' : '') + (session.selectedTrackId===c.trackId?' track-selected':'') + (c.pending ? ' draft-clip' : ''));
    el.style.top = (8 + level * 84) + 'px';el.style.left = c.start * px + 'px';el.style.width = Math.max(8, (c.end - c.start) * px) + 'px';el.dataset.section = c.sec.id;els.set(c.sec.id, el);lane.append(el);
    const title = button(c.sec.title, c.sec.title, () => {stop();select(c.sec.id);});title.className = 'wave-title';title.draggable=false;title.title='Drag clip to move · drag edges to trim';el.append(title);
    el.setAttribute('aria-label',c.sec.title+' · drag to move between audio tracks');
    listen(el,'pointerdown',e=>beginMove(c,el,e));listen(el,'pointermove',continueMove);listen(el,'pointerup',endMove);listen(el,'pointercancel',()=>{suppressClipClickUntil=performance.now()+250;clearMove();});listen(el,'dragstart',e=>e.preventDefault());
    if (c.pending) {
      const draft = button(c.loadError ? 'Audio unavailable' : c.take ? 'Loading audio…' : 'Write text', 'Edit script for ' + c.sec.title, () => {stop();editScript(c.sec.id);});draft.className = 'draft-message';el.append(draft);return;
    }
    const canvas = node('canvas', 'clip-waveform');canvas.setAttribute('aria-label', c.sec.title + ' waveform');el.append(canvas);paintWave(canvas, c);
    const duration = node('span', 'wave-duration', fmt(c.end - c.start));el.append(duration);
    for (const side of ['start', 'end']) {
      const handle = node('button', 'trim-handle trim-' + side);handle.type = 'button';handle.setAttribute('role', 'slider');handle.setAttribute('aria-label', 'Trim ' + side + ' of ' + c.sec.title);
      handle.setAttribute('aria-valuenow', String(c.range[side]));handle.setAttribute('aria-valuemin', String(side === 'start' ? 0 : c.range.start + .05));handle.setAttribute('aria-valuemax', String(side === 'start' ? c.range.end - .05 : c.duration));el.append(handle);
      const clamp = v => side === 'start' ? Math.max(0, Math.min(v, c.range.end - .05)) : Math.min(c.duration, Math.max(v, c.range.start + .05));
      listen(handle, 'pointerdown', e => {
        e.preventDefault();stop();const initial = e.clientX, range = {...c.range};handle.setPointerCapture(e.pointerId);
        handle.onpointermove = ev => {if (!handle.hasPointerCapture(ev.pointerId)) return;range[side] = clamp(c.range[side] + (ev.clientX - initial) / px);el.style.width = Math.max(8, (range.end - range.start) * px) + 'px';duration.textContent = fmt(range.end - range.start);handle.setAttribute('aria-valuenow', range[side].toFixed(2));};
        handle.onpointerup = ev => {handle.releasePointerCapture(ev.pointerId);if (range[side] !== c.range[side]) commit(c, range);};
        handle.onpointercancel = () => {el.style.width = Math.max(8, (c.end - c.start) * px) + 'px';duration.textContent = fmt(c.end - c.start);handle.setAttribute('aria-valuenow', String(c.range[side]));};
      });
      listen(handle, 'keydown', e => {if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;e.preventDefault();e.stopPropagation();const v = e.key === 'Home' ? 0 : e.key === 'End' ? c.duration : c.range[side] + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : .1);commit(c, {...c.range, [side]: clamp(v)});});
    }
  }
  function draw(refit=false) {
    const viewport=pendingViewport||{left:host.scrollLeft,top:host.scrollTop};if(refit)viewport.left=0;
    session.scrollLeft=viewport.left;session.scrollTop=viewport.top;
    clearMove();drawing?.abort();drawing = new AbortController();
    board.querySelectorAll('.audio-row').forEach(r => r.remove());els.clear();refreshLayout(refit);
    session.pause = () => {stop();tick();};session.startClip = id => {const c = layout.clips.find(x => x.sec.id === id);if (!c || c.pending) {report('This clip has no finished audio take.');return;}stop();session.time = c.start;start();};
    for (const [index, t] of trackList.entries()) {
      const music = t.kind === 'music' || t.id === 'music', {row, label, lane} = rowFor(music ? 'M1 · MUSIC' : `A${trackList.slice(0,index+1).filter(t=>t.kind!=='music'&&t.id!=='music').length} · AUDIO`, music ? 'music-row' : 'voice-row');
      row.dataset.trackId=t.id;row.classList.toggle('selected-track',session.selectedTrackId===t.id);
      const name=button(t.name,'Select '+t.name+' track',()=>{stop();session.selectedTrackId=t.id;board.querySelectorAll('.audio-row').forEach(r=>{const active=r.dataset.trackId===t.id;r.classList.toggle('selected-track',active);r.querySelector('.track-select')?.setAttribute('aria-pressed',String(active));r.querySelectorAll('.audio-clip').forEach(c=>{c.classList.toggle('track-selected',active);c.classList.remove('selected');});});tick();selectTrack?.(t.id);});name.className='track-select';name.setAttribute('aria-haspopup','dialog');name.setAttribute('aria-pressed',String(session.selectedTrackId===t.id));name.title='Select track · change twin and generate audio';
      const status=node('span','track-batch-status',trackStatus?.(t.id)||'');status.dataset.trackId=t.id;status.setAttribute('role','status');
      const controls = node('div', 'track-mix');
      const mb = button('M', 'Mute ' + t.name, () => {t.muted = !t.muted;mb.setAttribute('aria-pressed', String(t.muted));applyGains();updateTrack(t);});mb.setAttribute('aria-pressed', String(!!t.muted));
      const volume = node('input');volume.type = 'range';volume.min = 0;volume.max = 1;volume.step = .01;volume.value = t.volume ?? 1;volume.setAttribute('aria-label', t.name + ' volume');
      const volumeValue = node('span', 'track-volume', Math.round((t.volume ?? 1) * 100) + '%');
      listen(volume, 'input', () => {t.volume = Number(volume.value);volumeValue.textContent = Math.round(t.volume * 100) + '%';applyGains();});listen(volume, 'change', () => updateTrack(t));
      controls.append(mb, volume, volumeValue);
      label.append(name, status, controls, button(music ? '+ Import music' : '+ Voice clip', music ? 'Import music to ' + t.name : 'Add clip to ' + t.name, () => {stop();if (music) importMusic?.(t.id);else addSection(t.id);}));
      lane.dataset.trackId=t.id;lane.setAttribute('role','group');lane.setAttribute('aria-label',t.name+' track');
      const levels = [];
      for (const c of layout.clips.filter(c => c.trackId === t.id)) {let level = levels.findIndex(end => end <= c.start + .001);if (level < 0) level = levels.length;levels[level] = c.end;drawClip(c, lane, level);}
      if (!levels.length) {const empty = button(music ? '+ Import an audio file' : '+ Add a voice clip', music ? 'Import music' : 'Add voice clip', () => {stop();if (music) importMusic?.(t.id);else addSection(t.id);});empty.className = 'lane-empty lane-empty-button';lane.append(empty);}
      row.style.minHeight = lane.style.minHeight = Math.max(100, levels.length * 84 + 16) + 'px';
    }
    if(!audioOnly)drawVideo();
    const c = layout.clips.find(c => c.sec.id === selected);
    if (c) session.trackId = c.sec.audioAssetId ? trackList[0].id : c.trackId;
    host.scrollLeft=viewport.left;host.scrollTop=viewport.top;
    tick();
  }
  listen(ruler, 'pointerdown', e => {
    const at = ev => seek((ev.clientX - ruler.getBoundingClientRect().left) / px);at(e);ruler.setPointerCapture(e.pointerId);
    ruler.onpointermove = ev => {if (ruler.hasPointerCapture(ev.pointerId)) at(ev);};ruler.onpointerup = ev => ruler.releasePointerCapture(ev.pointerId);
  }, true);
  listen(document, 'keydown', e => {
    if(drag){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();suppressClipClickUntil=performance.now()+250;clearMove();}return;}
    if(e.key==='Escape'&&more.open){more.open=false;return;}
    if (e.key === 'Escape' && videoPanel.classList.contains('preview-expanded')) {videoPanel.classList.remove('preview-expanded');full.setAttribute('aria-pressed', 'false');return;}
    if (e.defaultPrevented || document.querySelector('dialog[open],#global-queue') || e.target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"],[role="slider"]')) return;
    const key = e.key.toLowerCase(), c = !session.selectedTrackId && layout?.clips.find(c => c.sec.id === selected);
    if (e.metaKey || e.ctrlKey) {if (key === 'z') {e.preventDefault();stop();if (e.shiftKey) redo?.();else undo?.();}else if (key === 'd') {e.preventDefault();duplicateButton.click();}return;}
    if(e.altKey&&c&&['arrowleft','arrowright','arrowup','arrowdown'].includes(key)){
      e.preventDefault();stop();
      if(key==='arrowleft'||key==='arrowright')commitPlacement(c.sec.id,c.trackId,Math.max(0,Math.min(7200,Math.round((c.start+(key==='arrowleft'?-1:1)*(e.shiftKey?1:.1))*100)/100)));
      else{const index=trackList.findIndex(t=>t.id===c.trackId),track=trackList[index+(key==='arrowup'?-1:1)];if(track)commitPlacement(c.sec.id,track.id,c.start);}return;
    }
    if (e.altKey) return;
    if (key === '?') {e.preventDefault();showShortcuts();}
    else if (key === ' ') {e.preventDefault();if (!e.repeat) toggle();}
    else if (['arrowleft', 'arrowright', 'home', 'end'].includes(key)) {e.preventDefault();seek(key === 'home' ? 0 : key === 'end' ? layout.duration : position() + (key === 'arrowleft' ? -1 : 1) * (e.shiftKey ? .1 : 1));}
    else if (['arrowup', 'arrowdown'].includes(key)) {e.preventDefault();const i = clips.findIndex(x => x.sec.id === selected), next = clips[i + (key === 'arrowdown' ? 1 : -1)];if (next) {stop();select(next.sec.id);}}
    else if (key === 'm') mute.click();else if (key === 's') snap.click();else if (key === 'f') fitButton.click();else if (key === 'b') splitButton.click();
    else if (['delete', 'backspace'].includes(key) && !e.repeat) {e.preventDefault();deleteButton.click();}
    else if (c && !c.pending && ['i', 'o', 'r'].includes(key)) {e.preventDefault();const sourceTime = c.range.start + position() - c.start, range = {...c.range};if (key === 'i') range.start = Math.max(0, Math.min(sourceTime, range.end - .05));if (key === 'o') range.end = Math.min(c.duration, Math.max(sourceTime, range.start + .05));if (key === 'r') {range.start = 0;range.end = c.duration;}commit(c, range);}
  }, true);
  draw();
  let lastWidth = host.clientWidth;
  const resize = new ResizeObserver(() => {if(disposed)return;if(session.timelineHeight>workspace.clientHeight-180)resizePanels(session.timelineHeight);if (Math.abs(lastWidth - host.clientWidth) < 1)return;lastWidth = host.clientWidth;if (fit) draw(true);});resize.observe(host);resize.observe(workspace);
  const dialogue=document.querySelector('#podcast-dialogue');if(dialogue)dialogue.scrollTop=session.dialogueScrollTop||0;
  (async () => {
    ctx = new AudioContext({sampleRate: 48000});let size = 0;const buffers = new Map(), decoded = [];
    for (const c of clips) {
      if (disposed) return;if (!c.take) continue;
      try {
        const source=url(c.take.outputId);let data=buffers.get(c.take.outputId)||audioCache.get(source);
        if(!data){const response=await fetch(source);if(!response.ok)throw Error('Could not load '+c.sec.title);const buffer=await ctx.decodeAudioData(await response.arrayBuffer());data={buffer,duration:buffer.duration,peaks:peaksFor(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)))};}
        if(!buffers.has(c.take.outputId)){size+=data.buffer.length*data.buffer.numberOfChannels*4;if(size>512*1024*1024)throw Error('Timeline exceeds the 512 MB playback limit.');buffers.set(c.take.outputId,data);}
        if(c.sec.autoPace&&!data.autoTrim)data.autoTrim=pacingTrim({autoPace:true},c.take.outputId,data.buffer);
        audioCache.set(source,data);session.waveforms.set(c.take.outputId,{duration:data.duration,peaks:data.peaks,autoTrim:data.autoTrim});session.clipDurations.set(c.sec.id,{duration:data.duration,text:c.sec.text});
        decoded.push(readyClip(c,data));
      } catch (e) {c.loadError = true;if (!disposed) report(e.message);}
    }
    if (disposed) return;
    loaded = editableAudioClips(clips, decoded,session.clipDurations);
    for (const t of trackList) {const gain = ctx.createGain();gain.connect(ctx.destination);gains.set(t.id, gain);}
    applyGains();draw(initialFit&&fit);pendingViewport=null;rememberViewport();play.disabled = previewPlay.disabled = !decoded.length;
  })().catch(e => {if (!disposed) {play.disabled = previewPlay.disabled = true;report(e.message);}});
  const dispose = () => {
    rememberViewport();if(dialogue)session.dialogueScrollTop=dialogue.scrollTop;
    clearMove();stop();disposed = true;delete session.isPlaying;delete session.startClip;delete session.pause;
    lifetime.abort();drawing?.abort();resize.disconnect();divider.remove();video.removeAttribute('src');video.load();videoPanel.remove();ctx?.close().catch(() => {});
  };
  const videoKey = jobs => JSON.stringify(jobs.map(j => [j.id, j.sectionId, j.sourceJobId, j.status, j.outputId, j.stage, j.sceneImageId, j.scenePrompt, j.approved]));
  let signature = videoKey(videoJobs);
  dispose.updateVideoJobs = jobs => {const next = videoKey(jobs);if (next === signature || disposed) return;signature = next;videoJobs = jobs;draw();syncVideo(position());};
  return dispose;
}
