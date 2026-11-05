export const gx10AvatarPresets = [
  {id:'lightx2v-4',name:'Accelerated · 4 steps'},
  {id:'baseline',name:'Baseline · 8 steps'},
];

export function gx10Preset(value='lightx2v-4') {
  if (!gx10AvatarPresets.some(p=>p.id===value)) throw Object.assign(new Error('Choose a supported GX10 avatar preset.'),{status:400});
  return value;
}

export function availableGx10Presets(engine) {
  if (!Array.isArray(engine?.presets)) return gx10AvatarPresets.filter(p=>p.id==='baseline');
  return gx10AvatarPresets.filter(p=>engine.presets.some(e=>e.id===p.id&&e.ready===true));
}
