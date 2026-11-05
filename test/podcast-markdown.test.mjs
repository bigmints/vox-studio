import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePodcastMarkdown,spokenMarkdown} from '../public/podcast-markdown.js';

const speakers=[{id:'host',name:'Alex'},{id:'guest',name:'Sam'},{id:'guest-2',name:'Jo'}];

test('Markdown imports create spoken turns using the existing cast',()=>{
  const script=`\uFEFF---
title: My episode
---
# My episode

## Introduction
**Host:** Welcome to **MyTwin**, a *local* studio.
We keep [your words](https://example.com) together.

### Guest
Thanks for having me.

## The conversation
> **Alex**: Let's begin.

- **Guest 2:** Happy to join.
`;
  const saved=structuredClone(speakers);
  assert.deepEqual(parsePodcastMarkdown(script,speakers),[
    {speakerId:'host',text:'Welcome to MyTwin, a local studio.\nWe keep your words together.'},
    {speakerId:'guest',text:'Thanks for having me.'},
    {speakerId:'host',text:"Let's begin."},
    {speakerId:'guest-2',text:'Happy to join.'},
  ]);
  assert.deepEqual(speakers,saved);
});

test('plain text, custom names, Unicode colons and multiline turns still import',()=>{
  assert.deepEqual(parsePodcastMarkdown('Alex： First.\r\nSecond line.\r\n\r\nSam: Reply.',speakers),[
    {speakerId:'host',text:'First.\nSecond line.'},{speakerId:'guest',text:'Reply.'},
  ]);
  assert.deepEqual(parsePodcastMarkdown('```markdown\nHost: Hello.\nGuest: Hi.\n```',speakers),[
    {speakerId:'host',text:'Hello.'},{speakerId:'guest',text:'Hi.'},
  ]);
});

test('Markdown formatting stays out of dialogue without losing escaped words or punctuation',()=>{
  assert.equal(spokenMarkdown('**Keep** _these_ `words`, ~~even these~~ and snake_case.'),'Keep these words, even these and snake_case.');
  assert.equal(spokenMarkdown('Say \\*literal\\* and [MyTwin][studio].'),'Say *literal* and MyTwin.');
  assert.deepEqual(parsePodcastMarkdown('<!-- Note: not dialogue -->\nHost: A **clear** line.\n[studio]: https://example.com\n---\nGuest: A reply.',speakers),[
    {speakerId:'host',text:'A clear line.'},{speakerId:'guest',text:'A reply.'},
  ]);
});

test('invalid Markdown scripts cannot import empty or incorrectly assigned turns',()=>{
  for(const script of ['', '# Episode only', '**Narrator:** Hello.', 'Host:\nGuest: Hi.', 'Hello without a label'])assert.throws(()=>parsePodcastMarkdown(script,speakers));
  assert.throws(()=>parsePodcastMarkdown('Host: '+ 'a'.repeat(50001),speakers),/50,000/);
  assert.throws(()=>parsePodcastMarkdown('a'.repeat(1024*1024+1),speakers),/1 MB/);
  assert.throws(()=>parsePodcastMarkdown(Array.from({length:101},()=> '**Host:** Hello.').join('\n'),speakers),/100/);
});
