import test from 'node:test';
import assert from 'node:assert/strict';
import {projectArtwork,artwork} from '../public/page-gallery.js';
const state={assets:[{id:'portrait',type:'image/png'},{id:'scene',type:'image/jpeg'},{id:'film',type:'video/mp4'},{id:'audio',type:'audio/wav'}],profiles:[{id:'speaker',avatarAssetId:'portrait'}],jobs:[]};
test('podcast artwork uses its shared scene before a speaker portrait',()=>{
 assert.equal(projectArtwork({id:'p',podcast:{sceneImageId:'scene',speakers:[{profileId:'speaker'}]}},state).id,'scene');
});
test('missing artwork falls back to a valid speaker portrait and then a completed video',()=>{
 assert.equal(projectArtwork({id:'p',profileId:'speaker',podcast:{sceneImageId:'missing'}},state).id,'portrait');
 assert.equal(projectArtwork({id:'p'},{...state,jobs:[{projectId:'p',status:'completed',outputId:'film'}]}).id,'film');
 assert.equal(projectArtwork({id:'p'},{...state,jobs:[{projectId:'p',status:'completed',outputId:'audio'}]}),undefined);
});
test('queue artwork prefers the reference used by that take',()=>{
 assert.equal(projectArtwork({id:'p',profileId:'speaker'},state,{inputs:{avatar:'scene'}}).id,'scene');
});
test('thumbnail attributes escape asset URLs and fallback names',()=>{
 const html=artwork(state.assets[0],{assetUrl:()=>'/x?name="quoted"',title:'<script>alert(1)</script>'});
 assert.match(html,/name=&quot;quoted&quot;/);assert.doesNotMatch(html,/<script>/);
});
