import test from 'node:test';
import assert from 'node:assert/strict';
import {activeVideoJob,videoJobLabel,videoJobBusy} from '../public/job-status.js';
test('rendering is visible over an earlier completed take, regardless of selected provider',()=>{
 const ready={kind:'avatar',sectionId:'s',sourceJobId:'voice',status:'completed'};
 const running={...ready,status:'running',provider:'gx10',createdAt:'2026-11-03'};
 assert.equal(activeVideoJob([ready,running],'s','voice'),running);
 assert.equal(videoJobLabel(running),'Rendering…');assert.equal(videoJobBusy(running),true);
 assert.equal(activeVideoJob([running],'s','other'),undefined);
 assert.equal(videoJobBusy({...running,status:'prepared'}),false);
 assert.equal(videoJobLabel({...running,status:'prepared'}),'Saved · not started');
 assert.equal(activeVideoJob([{...running,status:'failed'}],'s','voice'),undefined);
});

test('voice status surfaces a newer failure while retaining an earlier playable take',async()=>{
 const {voiceClipState}=await import('../public/job-status.js');
 const take={id:'ready',kind:'voice',status:'completed',createdAt:'2026-11-04T10:00:00Z'};
 const failed={id:'failed',kind:'voice',status:'failed',createdAt:'2026-11-04T11:00:00Z'};
 assert.equal(voiceClipState([take,failed],take).state,'failed');
 assert.equal(voiceClipState([failed,{...take,createdAt:'2026-11-04T12:00:00Z'}],{...take,createdAt:'2026-11-04T12:00:00Z'}).state,'ready');
 assert.equal(voiceClipState([failed,{...take,status:'running'}],take).state,'working');
 assert.equal(voiceClipState([{...failed,kind:'video'}],take).state,'ready');
 assert.equal(voiceClipState([],undefined).state,'empty');
});
