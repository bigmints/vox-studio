import test from 'node:test';
import assert from 'node:assert/strict';
import {snapClipMove,moveClipPlacement,restoreTimelineSections} from '../public/timeline-tools.js';
import {arrangeAudio,playbackPlan} from '../public/timeline-model.js';

test('moving clips snaps either edge and supports temporary unsnapped placement',()=>{
 const clips=[{sec:{id:'a'},start:2,end:5},{sec:{id:'b'},start:10,end:14}];
 assert.deepEqual(snapClipMove(6.95,3,clips,'a',40,100),{start:7,guide:10});
 assert.deepEqual(snapClipMove(9.97,3,clips,'a',40,100),{start:10,guide:10});
 assert.deepEqual(snapClipMove(4.05,3,clips,'a',40,100),{start:4.05,guide:null});
 assert.deepEqual(snapClipMove(6.95,3,clips,'a',40,100,false),{start:6.95,guide:null});
 assert.equal(snapClipMove(-4,3,clips,'a',40,100).start,0);
 assert.equal(snapClipMove(9000,3,clips,'a',40,100,false).start,7200);
});
const sections=[
 {id:'a',title:'First',text:'One',trims:{a:{start:1,end:5}}},
 {id:'b',title:'Second',text:'Two',gapBefore:.2},
 {id:'c',title:'Third',text:'Three'},
 {id:'music',title:'Music',audioAssetId:'wav',trackId:'music',offset:1,trims:{wav:{start:2,end:6}}},
];
const tracks=[{id:'voice',name:'Voice'},{id:'music',name:'Music',volume:.1}];
const durations={a:10,b:3,c:2,music:8};
const entries=items=>items.map(sec=>({sec,take:{id:'take-'+sec.id,outputId:sec.audioAssetId||sec.id},duration:durations[sec.id]}));
const geometry=layout=>layout.clips.map(c=>({id:c.sec.id,trackId:c.trackId,start:c.start}));
test('cross-track movement keeps all other clips in place and preserves source trims',()=>{
 const before=arrangeAudio(entries(sections),tracks),saved=structuredClone(sections);
 const moved=moveClipPlacement(sections,geometry(before),'a','music',12.5),after=arrangeAudio(entries(moved),tracks);
 assert.deepEqual(sections,saved);
 for(const id of ['b','c','music'])assert.equal(after.clips.find(c=>c.sec.id===id).start,before.clips.find(c=>c.sec.id===id).start);
 const clip=after.clips.find(c=>c.sec.id==='a');assert.equal(clip.trackId,'music');assert.equal(clip.start,12.5);assert.equal(clip.end,16.5);assert.deepEqual(clip.range,{start:1,end:5});
 assert.equal(playbackPlan(after.clips,12.5).find(c=>c.id==='a').trackId,'music');
 assert.deepEqual(restoreTimelineSections(sections,moved),sections);
});
test('same-track moves allow overlap without rippling adjacent clips',()=>{
 const before=arrangeAudio(entries(sections),tracks),moved=moveClipPlacement(sections,geometry(before),'b','voice',8);
 const after=arrangeAudio(entries(moved),tracks);
 assert.equal(after.clips.find(c=>c.sec.id==='c').start,before.clips.find(c=>c.sec.id==='c').start);
 assert.equal(after.clips.find(c=>c.sec.id==='b').start,8);
});
test('moving imported audio between tracks preserves the original source',()=>{
 const before=arrangeAudio(entries(sections),tracks),moved=moveClipPlacement(sections,geometry(before),'music','voice',20);
 const source=moved.find(s=>s.id==='music');assert.equal(source.audioAssetId,'wav');assert.deepEqual(source.trims,{wav:{start:2,end:6}});assert.equal(source.sourceTakeId,undefined);
 assert.equal(moveClipPlacement(sections,geometry(before),'music','music',1),null);
 assert.equal(moveClipPlacement(sections,geometry(before),'music','voice',NaN),null);
});
