import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizedImage} from '../lib/normalize-image.mjs';
test('reference orientation is baked into PNG pixels before provider upload',{skip:process.platform!=='darwin'},async()=>{
 const bytes=await normalizedImage(new URL('./fixtures/orientation-6.jpg',import.meta.url).pathname);
 assert.equal(bytes.subarray(1,4).toString(),'PNG');
 assert.equal(bytes.readUInt32BE(16),40);
 assert.equal(bytes.readUInt32BE(20),20);
});
