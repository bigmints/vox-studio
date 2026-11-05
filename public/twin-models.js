export function twinVoiceModels(provider,state){
 if(provider==='openrouter')return (state.settings.catalog?.models||[]).filter(m=>m.outputs?.includes('speech')&&m.endpoints?.includes('/api/v1/audio/speech'));
 if(provider==='voicestudio')return [{id:'omnivoice',name:'OmniVoice',cloning:true}];
 if(provider==='gx10')return (state.settings.capabilities?.engines||[]).filter(m=>m.kind==='voice'&&m.ready).map(m=>({...m,name:m.name||m.id,cloning:true}));
 return [];
}
export function twinCloudVoiceSettings(value){
 const out={};for(const key of ['speechModel','voiceEngine','voiceMode','voice']){if(value[key]!==undefined&&(typeof value[key]!=='string'||value[key].length>200))throw Error('Use a valid voice '+key+'.');out[key]=value[key]||'';}
 if(out.voiceMode&&!['preset','clone'].includes(out.voiceMode))throw Error('Choose a preset voice or a recording.');
 return out;
}
