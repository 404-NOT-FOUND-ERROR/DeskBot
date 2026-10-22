// Bounded, executor-owned criteria. A completed message is never a material result.
import {createHash} from 'node:crypto';
import {interpretationWindow} from './cognitive-refraction.mjs';
export const followupIdentity=f=>f?.followup_id??f?.origin_root_outcome_id??f?.from_root_outcome_id??null;
const root=t=>t.root_outcome_id??`task:${t.task_id}`;
const success=t=>t.status==='completed'&&t.completion?.result?.success!==false;
export function completionTargets(w,id,activities=[],socialOptions=[]){
 const lamp=w.living?.objects?.['floating-frame']?.waylight;
 const targets=activities.filter(a=>a.target_object_id).map(a=>({
  id:`activity:${a.activity_id}`,kind:'activity',title:`实际完成「${a.title}」这一步`,actor_id:id,
  activity_id:a.activity_id,object_id:a.target_object_id,
  ...(a.activity_id==='waylight-fit-shade'&&lamp?{asset_id:lamp.asset_id,requires_hood:true}:{}),
 }));
 // Public offers are not proof. The criterion is an actual handoff to this named peer.
 const own=[w.protagonist,...w.npcs].find(p=>(p.character_id??p.npc_id)===id);
 const peers=[w.protagonist,...w.npcs].filter(p=>(p.character_id??p.npc_id)!==id&&p.location_id===own?.location_id);
 for(const option of socialOptions.filter(o=>o.kind==='exchange'))for(const offer of option.offers??[]){
  if(offer.from!=='initiator'||offer.to!=='receiver')continue;
  for(const peer of peers){const peerId=peer.character_id??peer.npc_id;
   targets.push({id:`handoff:${option.option_id}:${peerId}`,kind:'handoff',title:`实际交给${peer.display_name}${offer.count}份${offer.resource}`,
    actor_id:id,recipient_id:peerId,resource:offer.resource,count:offer.count});
  }
 }
 return targets;
}
export function issueResolutionEvidence(w,id,issue){
 const target=issue?.completion_target,bound=Date.parse(issue?.target_bound_at);
 if(!target||target.actor_id!==id||!Number.isFinite(bound))return [];
 if(target.kind==='activity')return w.tasks.filter(t=>t.actor_id===id&&success(t)
  &&Date.parse(t.started_at)>=bound&&t.activity_id===target.activity_id&&t.target_object_id===target.object_id
  &&(!target.asset_id||t.completion?.result?.after?.waylight?.asset_id===target.asset_id
   &&(!target.requires_hood||t.completion.result.after.waylight.has_hood===true)))
  .map(root);
 if(target.kind==='handoff')return (w.social?.commitments??[]).filter(c=>c.actors?.includes(id)
  &&c.actors.includes(target.recipient_id)&&c.status==='completed'
  &&(c.changes??[]).some(change=>Date.parse(change.at)>=bound&&(change.offers??[]).some(o=>
   o.from===id&&o.to===target.recipient_id&&o.resource===target.resource&&o.count>=target.count)))
  .map(c=>`commitment:${c.id}`);
 return [];
}
function issueObjects(w,issue,activities){
 const ids=new Set([issue?.completion_target?.object_id].filter(Boolean));
 for(const r of [issue?.origin_root_outcome_id,issue?.from_root_outcome_id]){
  const task=w.tasks.find(t=>root(t)===r);
  if(task?.target_object_id&&task.cognitive_operation!=='share')ids.add(task.target_object_id);
 }
 for(const step of [issue?.next_step,issue?.wait_for])if(step?.kind==='activity'){
  const a=activities.find(a=>a.activity_id===step.id);if(a?.target_object_id)ids.add(a.target_object_id);
 }
 return ids;
}
// Incidental timestamps do not turn the same observation into fresh evidence.
function observationKey(task){
 const stable=JSON.stringify(task.cognitive_observation?.objects?.find(o=>o.id===task.target_object_id)?.state, (key,value)=>
  /(?:_at|^at$|^time$|^timestamp$)/.test(key)?undefined:value);
 return stable?`observation:${task.target_object_id}:${createHash('sha256').update(stable).digest('hex').slice(0,20)}`:null;
}
export function issueContactBasis(w,id,issue,inputs=[],activities=[]){
 const life=w.cognition?.actors[id]??{},objects=issueObjects(w,issue,activities),target=issue?.completion_target;
 const lastContact=Math.max(0,...(life.outbox??[]).filter(m=>m.contact_basis?.followup_id===followupIdentity(issue)).map(m=>Date.parse(m.at)||0));
 const relevant=[];
 for(const task of w.tasks.filter(t=>t.actor_id===id&&success(t)&&Date.parse(t.finished_at??t.completion?.due_at)>lastContact)){
  if(!objects.has(task.target_object_id)||['travel','rest','share'].includes(task.cognitive_operation))continue;
  const key=task.cognitive_operation==='observe'?observationKey(task):task.activity_id?root(task):null;
  if(key)relevant.push(key);
 }
 for(const c of w.social?.commitments??[])if(c.actors?.includes(id)
  &&(c.id===issue?.wait_for?.id||c.id===issue?.next_step?.id
   ||target?.kind==='handoff'&&c.actors.includes(target.recipient_id)&&(c.offers??[]).some(o=>o.resource===target.resource)))
  relevant.push(`commitment:${c.id}:${c.terms_revision??0}:${c.status}`);
 // An input alone is insufficient. An earlier grounded personal interpretation must
 // point at the same object; this permits a new question, not a factual completion.
 const location=(id===w.protagonist.character_id?w.protagonist:w.npcs.find(p=>p.npc_id===id))?.location_id;
 const interpretations=interpretationWindow(inputs,life,location).active;
 const sources=inputs.filter(input=>interpretations.some(v=>v.source_id===input.id
  &&v.effect!=='none'&&v.evidence_quote&&input.content?.includes(v.evidence_quote)
  &&v.target_object_ids?.some(o=>objects.has(o)))).map(i=>i.id);
 return {schema:'deskbot.issue-contact.v1',followup_id:followupIdentity(issue),object_ids:[...objects],
  evidence_ids:[...new Set(relevant)].sort(),related_source_ids:sources,input_ids:inputs.map(i=>i.id)};
}
export function issueContactBases(w,id,inputs=[],activities=[]){
 const life=w.cognition?.actors[id]??{};
 return [life.followup,...(life.deferred_followups??[])].filter(f=>f&&['continue','postpone'].includes(f.status))
  .map(f=>issueContactBasis(w,id,f,inputs,activities));
}
export function hasNewIssueEvidence(basis,old){
 return (basis.evidence_ids??[]).some(e=>!(old.evidence_ids??[]).includes(e))
  ||(basis.source_ids??[]).some(s=>(basis.related_source_ids??[]).includes(s)&&!(old.input_ids??[]).includes(s));
}
