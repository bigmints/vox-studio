export const queueLiveStatuses=['submitting','queued','running','cancel_requested'];
export const queueWaitingStatuses=['prepared','waiting'];
export function queueGroups(jobs,filter='all'){
 const list=jobs.filter(j=>filter==='all'||(filter==='audio'?j.kind==='voice':j.kind==='avatar'||j.kind==='video')).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
 return {active:list.filter(j=>queueLiveStatuses.includes(j.status)),waiting:list.filter(j=>queueWaitingStatuses.includes(j.status)),history:list.filter(j=>!queueLiveStatuses.includes(j.status)&&!queueWaitingStatuses.includes(j.status))};
}
