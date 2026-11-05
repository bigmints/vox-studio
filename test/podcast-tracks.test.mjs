import test from 'node:test';
import assert from 'node:assert/strict';
import {ensurePodcastTracks,speakerTrackId} from '../public/podcast-tracks.js';
import {defaultPodcast,normalizePodcast,parsePodcastScript,projectSection} from '../public/project-model.js';
import {arrangeAudio,playbackPlan} from '../public/timeline-model.js';
import {timelineWav} from '../public/timeline-export.js';

function project(){return {projectType:'podcast',podcast:defaultPodcast(),tracks:[{id:'voice',name:'Voice',volume:.8,muted:false},{id:'music',name:'Music',kind:'music',volume:.07,muted:false}],sections:[{id:'a',speakerId:'host',text:'Welcome',trackId:'voice',trims:{take:{start:1,end:3}}},{id:'b',speakerId:'guest',text:'Hello',trackId:'voice'},{id:'c',speakerId:'host',text:'Next question',trackId:'voice'},{id:'music',audioAssetId:'music',text:'',trackId:'music',offset:0}]};}
test('legacy podcasts gain speaker lanes without changing sources, trims, music, offsets or mix',()=>{
 const p=project(),before=structuredClone(p.sections),music=structuredClone(p.tracks[1]);
 assert.equal(ensurePodcastTracks(p),true);assert.equal(p.sections[0].trackId,speakerTrackId('host'));assert.equal(p.sections[1].trackId,speakerTrackId('guest'));
 assert.deepEqual(p.sections.map(({trackId,...s})=>s),before.map(({trackId,...s})=>s));assert.deepEqual(p.tracks.find(t=>t.id==='music'),music);
 assert.deepEqual(p.tracks.filter(t=>t.kind==='speaker').map(t=>[t.name,t.speakerId,t.volume,t.muted]),[['Host','host',.8,false],['Guest','guest',.8,false]]);
 assert.equal(p.tracks.some(t=>t.id==='voice'),false);assert.equal(ensurePodcastTracks(p),false);
});
test('speaker lanes share a dialogue clock instead of overlapping; explicit positions still win',()=>{
 const p=project();ensurePodcastTracks(p);const clips=p.sections.slice(0,3).map((s,i)=>({sec:projectSection(p,s),take:{outputId:'generated'},duration:[2,3,1][i]}));
 const layout=arrangeAudio(clips,p.tracks);assert.deepEqual(layout.clips.map(c=>Number(c.start.toFixed(6))),[0,2.18,5.36]);assert.ok(Math.abs(layout.duration-6.36)<1e-9);
 assert.deepEqual(playbackPlan(layout.clips,2.18).map(c=>c.trackId),['speaker-guest','speaker-host']);
 clips[1].sec.offset=1;assert.deepEqual(arrangeAudio(clips,p.tracks).clips.map(c=>c.start),[0,1,4.18]);
});
test('split-lane export is identical to the single lane; each speaker mutes and mixes independently',()=>{
 const samples=[.2,.4,.6],original=samples.map(v=>({channels:[new Float32Array([v,v])],trackId:'voice'}));original.push({channels:[new Float32Array(8).fill(.1)],trackId:'music',offset:0});
 const oldTracks=[{id:'voice',volume:1},{id:'music',volume:.07}];const originalWav=timelineWav(original,4,oldTracks);
 const split=original.map((p,i)=>i<3?{...p,sequenceId:'podcast-dialogue',trackId:i===1?'speaker-guest':'speaker-host'}:p);
 const tracks=[{id:'speaker-host',volume:1},{id:'speaker-guest',volume:1},{id:'music',volume:.07}];
 assert.deepEqual(timelineWav(split,4,tracks),originalWav);
 tracks[1].muted=true;let mixed=new DataView(timelineWav(split,4,tracks).buffer),baseline=new DataView(originalWav.buffer);
 assert.equal(mixed.getInt16(44,true),baseline.getInt16(44,true));assert.equal(mixed.getInt16(48,true),Math.round(.007*32767));assert.equal(mixed.getInt16(52,true),baseline.getInt16(52,true));assert.equal(mixed.byteLength,baseline.byteLength);
 tracks[1].muted=false;tracks[1].volume=.5;mixed=new DataView(timelineWav(split,4,tracks).buffer);assert.equal(mixed.getInt16(48,true),Math.round(.207*32767));
});
test('additional guests receive independent lanes and unambiguous import labels',()=>{
 const p=project();p.podcast.speakers.push({id:'guest-2',name:'Guest 2',profileId:'',voice:''});p.podcast=normalizePodcast(p.podcast);
 const turns=parsePodcastScript('Host: Welcome.\nGuest: Hello.\nGuest 2: Glad to be here.\nSpeaker 1: Let’s begin.',p.podcast.speakers);assert.deepEqual(turns.map(t=>t.speakerId),['host','guest','guest-2','host']);
 p.sections.push({id:'extra',speakerId:'guest-2',text:'Glad to be here.'});ensurePodcastTracks(p);assert.equal(p.sections.at(-1).trackId,'speaker-guest-2');assert.equal(p.tracks.filter(t=>t.kind==='speaker').length,3);
 const tooMany={...p.podcast,speakers:Array.from({length:9},(_,i)=>({id:String(i),name:'Speaker '+i}))};assert.throws(()=>normalizePodcast(tooMany),/seven guests/);
});
test('split dialogue retains sequencing and manual custom track placements are respected',()=>{
 const p=project();p.tracks.push({id:'custom',name:'Custom',volume:.5,muted:false});p.sections[1].trackId='custom';ensurePodcastTracks(p);assert.equal(p.sections[1].trackId,'custom');
 const split={id:'split',speakerId:'host',audioAssetId:'audio',sourceTakeId:'take',offset:4,trims:{audio:{start:2,end:3}}};p.sections.push(split);ensurePodcastTracks(p);assert.equal(split.trackId,'speaker-host');assert.equal(projectSection(p,split).sequenceId,'podcast-dialogue');assert.equal(split.offset,4);
});
