export function activeVideoJob(jobs,sectionId,sourceJobId){
 return jobs.filter(j=>['avatar','video'].includes(j.kind)&&j.sectionId===sectionId&&j.sourceJobId===sourceJobId&&['prepared','waiting','submitting','queued','running','cancel_requested'].includes(j.status)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
}
export function videoJobLabel(job){return ({prepared:'Saved · not started',waiting:'Waiting for GX10',submitting:'Sending…',queued:'Queued…',running:'Rendering…',cancel_requested:'Cancelling…'})[job?.status]||'';}
export function videoJobBusy(job){return ['submitting','queued','running','cancel_requested'].includes(job?.status);}

export function voiceClipState(jobs,take){
 const voice=jobs.filter(j=>j.kind==='voice').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
 const active=voice.find(j=>['submitting','queued','running'].includes(j.status));
 if(active)return {state:'working',title:'Creating your voice…',job:active};
 const latest=voice[0];
 if(latest?.status==='failed'&&(!take||new Date(latest.createdAt)>=new Date(take.createdAt)))return {state:'failed',title:'The last attempt failed',job:latest};
 if(take)return {state:'ready',title:'Your voice is ready',job:take};
 return {state:'empty',title:'Ready to create a voice'};
}
