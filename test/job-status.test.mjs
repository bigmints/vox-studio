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
