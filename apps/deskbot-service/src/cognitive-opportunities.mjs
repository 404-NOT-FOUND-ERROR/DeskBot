import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const OPPORTUNITY_CONTRACT=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-opportunities.v1.json',import.meta.url),'utf8'));
const copy=structuredClone;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};
const match=(rows,ref)=>rows.find(o=>o.kind===ref?.kind&&o.id===ref?.id);

/** Projection only: the catalogue has already evaluated method, purpose and contact.
 * Blocked execution and absent purpose stay distinct; no new planner lives here. */
export function projectCognitiveOpportunities(c){
 const cont=c.continuation,oldWait=cont.wait_options;
 const entries=(c.choice_catalogue.opportunities??c.choice_catalogue.choices).map(row=>{
  const b=row.binding,method=row.method,clock=oldWait.find(o=>o.kind==='activity'&&o.id===b.activity_id);
  const target=row.step_target_id??(b.activity_id?`activity:${b.activity_id}`:null);
  const identity=hash([b,row.requires_issue??null,target,method?.id??null,method?.version??null,method?.definition_hash??null,method?.experiment?.condition_key??null]);
  return {kind:'opportunity',id:row.id,title:row.title,identity,status:row.available===false?'blocked':'ready',available:row.available!==false,
   binding:copy(b),requires_issue:row.requires_issue??null,completion_target_id:target,
   blocker:row.blocker??null,blockers:copy(row.blockers??[]),
   ...(clock?Object.fromEntries(['ready_at','ready_time','minutes_until_clock_ready','asset_id'].filter(k=>clock[k]!==undefined).map(k=>[k,copy(clock[k])])):{})};
 });
 c.opportunities={schema:OPPORTUNITY_CONTRACT.view_schema,actor_id:c.actor.actor_id,assessed_at:c.at,entries,rule:OPPORTUNITY_CONTRACT.rule};
 const option=e=>({...Object.fromEntries(Object.entries(copy(e)).filter(([k])=>k!=='binding')),
  operation:e.binding.operation,opportunity_id:e.id});
 const options=entries.map(option);
 // Compatibility is explicit and unique. A bare recipe cannot choose a use,
 // batch, recipient or experiment issue on the actor's behalf.
 for(const [kind,ids] of [['activity',[...new Set(entries.map(e=>e.binding.activity_id).filter(Boolean))]],
  ['social',[...new Set(entries.map(e=>e.binding.contact?.kind==='invite'?e.binding.contact.option_id:null).filter(Boolean))]]]){
  for(const id of ids){
   const found=entries.filter(e=>kind==='activity'?e.binding.activity_id===id:e.binding.contact?.kind==='invite'&&e.binding.contact.option_id===id);
   if(found.length===1)options.push({...option(found[0]),kind,id,legacy_alias:true});
  }
 }
 const conditions=oldWait.filter(o=>['reply','commitment'].includes(o.kind));
 cont.opportunity_contract=OPPORTUNITY_CONTRACT.view_schema;
 cont.wait_options=[...options,...conditions];
 cont.next_options=[...options,...conditions];
 const refresh=f=>{
  if(!f)return;
  const next=match(cont.next_options,f.next_step),wait=match(cont.wait_options,f.wait_for);
  const changed=Boolean(f.next_binding&&(!next||f.next_binding.identity!==next.identity));
  f.current_conditions={...f.current_conditions,next_step:copy(next??null),wait_for:copy(wait??null),
   next_status:changed||f.next_step&&!next?'review_required':next?.status??'unbound'};
  // Parking an issue does not start a new clock when it is later restored.
  const since=f.wait_started_at??f.created_at??f.from_at??f.waiting_since??null;
  const started=Date.parse(since);
  f.waiting_since=since;
  f.wait_deadline_at=f.wait_for?.kind==='reply'&&Number.isFinite(started)?new Date(started+6*3600000).toISOString():null;
  const timedOut=wait?.kind==='reply'&&f.wait_deadline_at&&c.at>=f.wait_deadline_at;
  const waitChanged=f.wait_binding&&(!wait||f.wait_binding.identity!==wait.identity);
  f.condition=f.wait_for?(!wait||waitChanged?'review_required':wait.available?'ready':timedOut?'review_required':'waiting'):'unbound';
  if(f.current_conditions.next_status==='review_required')f.condition='review_required';
  f.note=f.condition==='review_required'?'原机会已改变、用途已满足或等待到期；保留原问题，复查、换办法或放下。':f.condition==='ready'?'条件已就绪，但尚未执行。':f.condition==='waiting'?'真实条件尚未满足；可以做其他事情。':'复查后自行选择下一步。';
 };
 for(const f of [cont.current,...cont.deferred])refresh(f);
 const current=cont.current;
 if(current){
  const wait=match(cont.wait_options,current.wait_for);
  cont.urgent_review=['ready','review_required'].includes(current.condition);
  cont.review_key=current.wait_for||current.next_step?JSON.stringify([current.followup_id,current.condition,
   wait?.identity??wait?.id??null,wait?.blockers??[],wait?.reply_ids??[],wait?.status??null,current.current_conditions.next_status]):null;
 }
 // The construction rows are consumed once. Do not persist or send a third
 // copy of the same commands alongside the choice and opportunity views.
 delete c.choice_catalogue.opportunities;
 return c;
}

export function opportunityBinding(ref,cont){
 const row=match(cont.next_options??[],ref);
 return row?.opportunity_id?{schema:OPPORTUNITY_CONTRACT.view_schema,id:row.opportunity_id,identity:row.identity,
  completion_target_id:row.completion_target_id,requires_issue:row.requires_issue}:null;
}

/** Both proposal stages use this check. Old frozen contexts keep their contract. */
export function validateOpportunityTransition(value,current,frozen=current){
 if(current?.opportunity_contract!==OPPORTUNITY_CONTRACT.view_schema)return;
 const active=['continue','postpone'].includes(value.status??value.followup_decision);
 const selected=value.followup_id==null?current.current:[current.current,...(current.deferred??[])].find(f=>f?.followup_id===value.followup_id);
 if(value.followup_id!=null&&!selected)fail('followup_issue_unknown');
 for(const field of ['next_step','wait_for']){
  const ref=value[field];if(ref==null)continue;
  if(typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).length!==2||!Object.hasOwn(ref,'kind')||!Object.hasOwn(ref,'id'))fail(field==='wait_for'?'followup_condition_unknown':'followup_opportunity_unavailable');
  const row=match(current.next_options,ref),prior=match(frozen.next_options??[],ref);
  if(!row)fail(field==='wait_for'?'followup_condition_unknown':'followup_opportunity_unavailable');
  if(frozen.opportunity_contract===OPPORTUNITY_CONTRACT.view_schema&&(!prior||prior.identity!==row.identity))fail('cognitive_opportunity_changed');
  if(row.requires_issue&&(!active||selected?.followup_id!==row.requires_issue))fail('followup_opportunity_issue_mismatch');
  if(field==='wait_for'&&row.available)fail('followup_condition_already_ready');
  if(field==='wait_for'&&selected?.condition==='review_required'
    &&JSON.stringify(ref)===JSON.stringify(selected.wait_for))fail('followup_wait_needs_reconsideration');
 }
 const wait=match(current.next_options,value.wait_for),next=match(current.next_options,value.next_step);
 if(wait?.opportunity_id&&next&&wait.opportunity_id!==next.opportunity_id)fail('followup_wait_step_mismatch');
 if(value.wait_for&&['reply','commitment'].includes(value.wait_for.kind)&&next?.opportunity_id)fail('followup_wait_step_mismatch');
 if(wait?.kind==='commitment'&&next&&(next.kind!=='commitment'||next.id!==wait.id))fail('followup_wait_step_mismatch');
 if(wait?.kind==='reply'&&next&&!(next.kind==='reply'&&next.id===wait.id||next.kind==='commitment'&&next.id===wait.commitment_id))fail('followup_wait_step_mismatch');
}
