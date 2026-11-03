export function activeVideoJob(jobs,sectionId,sourceJobId){
 return jobs.filter(j=>['avatar','video'].includes(j.kind)&&j.sectionId===sectionId&&j.sourceJobId===sourceJobId&&['prepared','waiting','submitting','queued','running','cancel_requested'].includes(j.status)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
}
export function videoJobLabel(job){return ({prepared:'Saved · not started',waiting:'Waiting for GX10',submitting:'Sending…',queued:'Queued…',running:'Rendering…',cancel_requested:'Cancelling…'})[job?.status]||'';}
export function videoJobBusy(job){return ['submitting','queued','running','cancel_requested'].includes(job?.status);}
