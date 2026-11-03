import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareVideo} from '../lib/video.mjs';
import {linkedVideo} from '../public/timeline-model.js';
test('scene video snapshots its own image and direction independently of the voice and global twin',()=>{
 const sec={id:'scene',text:'Narration stays unchanged',sceneImageId:'scene-photo',scenePrompt:'Side view, slow pan'};
 const s={projects:[{id:'p',profileId:'twin',sections:[sec]}],profiles:[{id:'twin',avatarAssetId:'global-photo'}],assets:[{id:'scene-photo',type:'image/png',size:100}],jobs:[{id:'voice',projectId:'p',sectionId:'scene',kind:'voice',status:'completed',text:sec.text}],settings:{videoModels:[{id:'model',supported_durations:[5],supported_frame_images:['first_frame']}]}};
 const job=prepareVideo(s,{projectId:'p',sectionId:'scene',kind:'video',engine:'model',scene:true,sourceJobId:'voice',video:{duration:5}});
 assert.equal(job.inputs.avatar,'scene-photo');assert.equal(job.prompt,'Side view, slow pan');assert.equal(job.text,sec.text);assert.equal(job.sourceJobId,'voice');
 job.status='completed';job.outputId='result';assert.equal(linkedVideo({sec,take:{id:'voice'}},[job]),job);
 sec.scenePrompt='Front view';assert.equal(linkedVideo({sec,take:{id:'voice'}},[job]),undefined);
 assert.throws(()=>prepareVideo(s,{projectId:'p',sectionId:'scene',engine:'model',scene:true,sourceJobId:'wrong'}),/voiceover/);
});
