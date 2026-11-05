// Costs are provider-reported USD amounts, never estimates from model prices.
export function reportedCost(usage){
 const value=usage?.cost;
 return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
}
export function spendingRows(jobs){
 const seen=new Set();
 return [...jobs].filter(j=>j.provider==='openrouter'&&!j.sequence)
  .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))
  .filter(j=>{const key=j.videoRemoteId||j.id;if(seen.has(key))return false;seen.add(key);return true;})
  .map(j=>({...j,cost:reportedCost(j.usage),billing:reportedCost(j.usage)!==null?'Reported':j.status==='prepared'||j.submissionAttempted===false||/No generation was submitted/i.test(j.error||'')?'Not submitted':'Unknown'}));
}
export function spendingSummary(rows){
 return {total:rows.reduce((sum,r)=>sum+(r.cost??0),0),reported:rows.filter(r=>r.cost!==null).length,unknown:rows.filter(r=>r.billing==='Unknown').length};
}
export const usd=value=>value===null?'Unknown':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:6}).format(value);
export function spendingCsv(rows){
 const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const header=['Created at (UTC)','Project','Section','Type','Model','Status','Cost (USD)','Billing','Job ID','Parent job ID','OpenRouter video ID','Error'];
 return [header,...rows.map(r=>[r.createdAt,r.projectTitle,r.sectionTitle,r.kind,r.engine,r.status,r.cost??'',r.billing,r.id,r.parentVideoId,r.videoRemoteId,r.error])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
