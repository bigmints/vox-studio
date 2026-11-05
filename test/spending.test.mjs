import test from 'node:test';
import assert from 'node:assert/strict';
import {spendingRows,spendingSummary,spendingCsv,reportedCost} from '../public/spending-model.js';
test('spending counts individual shots once and keeps unknown costs distinct from zero',()=>{
 const base={provider:'openrouter',createdAt:'2026-11-05T09:00:00Z',status:'completed'};
 const rows=spendingRows([
  {...base,id:'parent',sequence:{},usage:{cost:9}},
  {...base,id:'shot1',parentVideoId:'parent',videoRemoteId:'remote1',usage:{cost:0.25}},
  {...base,id:'shot2',parentVideoId:'parent',videoRemoteId:'remote2',usage:{cost:0.1}},
  {...base,id:'duplicate',videoRemoteId:'remote1',usage:{cost:0.25}},
  {...base,id:'free',usage:{cost:0}},
  {...base,id:'failed',status:'failed',error:'No face detected in the image'},
  {...base,id:'prepared',status:'prepared'},
  {...base,id:'blocked',status:'failed',submissionAttempted:false},
  {...base,id:'local',provider:'local',usage:{cost:100}},
 ]);
 assert.equal(rows.length,6);assert.equal(rows.find(r=>r.id==='failed').billing,'Unknown');
 assert.equal(rows.find(r=>r.id==='free').cost,0);assert.equal(rows.find(r=>r.id==='blocked').billing,'Not submitted');
 assert.deepEqual(spendingSummary(rows),{total:0.35,reported:3,unknown:1});
 for(const value of [null,'0.1',-1,NaN,Infinity,undefined])assert.equal(reportedCost({cost:value}),null);
});
test('CSV preserves exact amounts, unknown amounts, quoting, and neutralizes formula cells',()=>{
 const csv=spendingCsv([{projectTitle:'=SUM(A1)',sectionTitle:'A, "take"',cost:0.2289375,billing:'Reported'},{cost:null,billing:'Unknown'}]);
 assert.ok(csv.includes('"\'=SUM(A1)"'));assert.ok(csv.includes('"A, ""take"""'));assert.ok(csv.includes('"0.2289375"'));assert.ok(csv.includes('"","Unknown"'));
});
