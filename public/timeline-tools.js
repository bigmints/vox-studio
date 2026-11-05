// Shared geometry for ruler labels, editing, and keyboard controls.
export function rulerStep(pixelsPerSecond) {
  return [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800].find(n => n * pixelsPerSecond >= 72) || 3600;
}
export function fitScale(width, duration, labelWidth = 156) {
  return Math.max(0.02, Math.min(240, (width - labelWidth - 48) / Math.max(10, duration)));
}
// Content loading must not change the user's zoom. Fit is recalculated only
// when requested, when the editor is first opened, or when its width changes.
export function timelineScale(session,width,duration,refit=false,labelWidth=156){
  if(session.fit!==false&&(refit||!(session.zoom>0)))return fitScale(width,duration,labelWidth);
  return Math.max(.02,Math.min(240,session.zoom||36));
}
export function snapTime(value, clips, selectedId, playhead, pixelsPerSecond, enabled = true) {
  const time = Math.max(0, Math.min(7200, value));
  if (!enabled) return Math.round(time * 100) / 100;
  const points = [0, playhead, ...clips.filter(c => c.sec.id !== selectedId).flatMap(c => [c.start, c.end])];
  const nearest = points.reduce((a, b) => Math.abs(b - time) < Math.abs(a - time) ? b : a, 0);
  return Math.abs(nearest - time) * pixelsPerSecond <= 8 ? nearest : Math.round(time * 100) / 100;
}
// Snap either edge of a moving clip, keeping its grabbed position stable.
export function snapClipMove(value, duration, clips, selectedId, playhead, pixelsPerSecond, enabled = true) {
  const start = Math.max(0, Math.min(7200, Number.isFinite(value) ? value : 0));
  const rounded = Math.round(start * 100) / 100;
  if (!enabled || !(pixelsPerSecond > 0)) return {start: rounded, guide: null};
  const points = [0, playhead, ...clips.filter(c => c.sec.id !== selectedId).flatMap(c => [c.start, c.end])].filter(Number.isFinite);
  let best = null, distance = 8 / pixelsPerSecond;
  for (const point of points) {
    for (const candidate of [point, point - duration]) {
      if (candidate < 0 || candidate > 7200) continue;
      const delta = Math.abs(candidate - start);
      if (delta <= distance && (!best || delta < distance)) {
        distance = delta;best = {start: candidate, guide: point};
      }
    }
  }
  return best || {start: rounded, guide: null};
}

// Resolve sequential clips before a free move, so their positions do not ripple.
export function moveClipPlacement(sections, positions, id, trackId, offset) {
  const before = positions.find(p => p.id === id);
  if (!before || !trackId || !Number.isFinite(offset) || offset < 0 || offset > 7200 || !sections.some(s => s.id === id)) return null;
  if (before.trackId === trackId && Math.abs(before.start - offset) < .001) return null;
  const next = structuredClone(sections), byId = new Map(positions.map(p => [p.id, p]));
  for (const section of next) {
    const position = byId.get(section.id);
    if (position && Number.isFinite(position.start)) {
      section.offset = position.start;section.trackId = position.trackId;
    }
  }
  const moved = next.find(s => s.id === id);moved.offset = offset;moved.trackId = trackId;
  return next;
}

export function splitClip(clip, time, id) {
  if (clip.pending || time - clip.start < 0.05 || clip.end - time < 0.05) return null;
  const cut = clip.range.start + time - clip.start;
  const left = structuredClone(clip.sec), right = structuredClone(clip.sec);
  left.offset = clip.start;
  left.trims = {...left.trims, [clip.take.outputId]: {start: clip.range.start, end: cut}};
  right.id = id;
  right.title += ' · split';
  right.audioAssetId = clip.take.outputId;
  right.offset = time;
  right.trims = {...right.trims, [clip.take.outputId]: {start: cut, end: clip.range.end}};
  // Retain the source voice identity so linked video also follows both halves.
  if (!clip.sec.audioAssetId || clip.sec.sourceTakeId) {
    right.sourceSectionId = clip.sec.sourceSectionId || clip.sec.id;
    right.sourceTakeId = clip.sec.sourceTakeId || clip.take.id;
  }
  return [left, right];
}

// Content edits made after a timeline edit must survive timeline undo/redo.
export function restoreTimelineSections(saved, current) {
  const live = new Map(current.map(section => [section.id, section]));
  return saved.map(section => {
    const restored = structuredClone(live.get(section.id) || section);
    for (const key of ['trackId', 'offset', 'trims', 'audioAssetId', 'sourceSectionId', 'sourceTakeId']) {
      if (key in section) restored[key] = structuredClone(section[key]);
      else delete restored[key];
    }
    return restored;
  });
}
