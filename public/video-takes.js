export const isVideoTake=job=>['avatar','video'].includes(job?.kind)&&!job.parentVideoId;
export function videoTakeBelongsToClip(job,project,section){
 return !!section&&isVideoTake(job)&&job.projectId===project?.id&&job.sectionId===(section.sourceSectionId||section.id)&&job.status==='completed'&&!!job.outputId;
}
export function explicitVideoTake(clip,jobs){
 // Choosing an older visual is intentional, even when its photo or audio differs.
 const usable=job=>job&&['avatar','video'].includes(job.kind)&&!job.parentVideoId&&job.sectionId===(clip.sec.sourceSectionId||clip.sec.id)&&job.status==='completed'&&!!job.outputId;
 const pending=jobs.find(j=>j.id===clip.sec.pendingVideoTakeId);
 if(usable(pending))return pending;
 const selected=jobs.find(j=>j.id===clip.sec.videoTakeId);
 return usable(selected)?selected:null;
}
