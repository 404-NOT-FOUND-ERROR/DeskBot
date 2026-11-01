import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {opportunityBinding,validateOpportunityTransition} from './cognitive-opportunities.mjs';
export const GOAL_LIFECYCLE=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-goal-lifecycle.v1.json',import.meta.url),'utf8'));
const copy=structuredClone,hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};
const live=g=>['active','postponed'].includes(g.lifecycle_status);
const cleanId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(id)&&!['constructor','prototype'].includes(id);

// Criteria are authored projections of executable choices, not model predicates.
// Only reserve-water has an explicitly declared cross-method equivalence. Research
// conditions and legacy bindings remain exact, even when their titles look alike.
export function goalCriteria(c){
 const byId=new Map();
 for(const e of c.opportunities.entries){
  const b=e.binding;let criterion;
  if(GOAL_LIFECYCLE.water_reserve_methods.includes(b.activity_id)&&b.production_use?.kind==='reserve')
   criterion={kind:'water_reserve',actor_id:c.actor.actor_id,resource:'water',count:b.production_use.target_stock,
    purpose:'reserve',methods:GOAL_LIFECYCLE.water_reserve_methods,title:`实际净滤${b.production_use.target_stock}份自用清水（不是交付或灯具实验）`};
  else if(b.operation==='share'&&b.disclosures?.some(d=>d.kind==='result_extract')){
   const d=b.disclosures.find(d=>d.kind==='result_extract');
   criterion={kind:'disclosure',receiver_ids:b.receiver_indices.map(i=>c.capabilities.share.receivers[i-1].actor_id).sort(),
    result_root:d.root_outcome_id,disclosure_id:d.id,fields:d.fields.map(f=>f.path).sort(),title:e.title};
  }else criterion={kind:'exact_opportunity',identity:e.identity,title:e.title};
  const id=`criterion:${hash(criterion)}`;
  const old=byId.get(id)??{id,...criterion,opportunity_ids:[]};old.opportunity_ids.push(e.id);byId.set(id,old);
 }
 return [...byId.values()];
}

export function migrateGoalBindings(life,at){
 const bindings=copy(life.goal_bindings??{});
 for(const g of life.state?.short_term_goal_entities??[]){
  if(!cleanId(g.id))continue;
  const old=bindings[g.id];if(old?.schema===GOAL_LIFECYCLE.schema)continue;
  const terminal=['completed','failed'].includes(g.status);
  bindings[g.id]={...old,schema:GOAL_LIFECYCLE.schema,goal_id:g.id,text:g.text,
   completion_criteria:old?.binding?{kind:'exact_opportunity',identity:old.binding.identity,title:old.text}:{kind:'open_inquiry',title:g.text},
   lifecycle_status:terminal?'legacy_closed':g.status==='interrupted'?'postponed':'active',
   legacy_status:terminal?g.status:null,migration:'legacy_exact_or_unbound_no_inferred_completion',
   bound_at:old?.bound_at??at,binding:old?.binding??null,evidence_ids:copy(old?.evidence_ids??[]),
   next_review_at:null,last_reviewed_at:null,attempts:old?.binding?[{at:old.bound_at,binding:copy(old.binding)}]:[],transitions:[]};
 }
 return bindings;
}

export function lifecycleEvidence(w,id,goal){
 const criteria=goal.completion_criteria,roots=new Set(goal.evidence_ids??[]);
 if(!criteria||criteria.kind==='open_inquiry')return [];
 for(const task of w.tasks??[]){
  if(task.actor_id!==id||task.status!=='completed'||!task.completion||!task.cognitive_observation
   ||task.completion.effect==='no_effect'||task.completion.result?.success===false||task.started_at<goal.bound_at)continue;
  // Only actually selected attempts qualify; changing a predicate cannot launder
  // an unrelated task, cancelled attempt or a pre-goal result into completion.
  if(!(goal.attempts??[]).some(a=>a.at<=task.started_at&&a.binding?.identity===task.opportunity_binding?.identity))continue;
  let matches=false;
  if(criteria.kind==='exact_opportunity')matches=task.opportunity_binding?.identity===criteria.identity;
  if(criteria.kind==='water_reserve'){
   const method=task.completion.result?.method_result;
   matches=criteria.methods.includes(task.activity_id)&&task.opportunity_binding?.production_use?.kind==='reserve'
    &&(method?.stock_changes??[]).some(s=>s.container===`bag:${id}`&&s.resource===criteria.resource&&(s.delta??s.count)>=criteria.count);
  }
  if(criteria.kind==='disclosure'){
   const m=task.cognitive_message;
   matches=Boolean(task.cognitive_message_delivered_at)&&criteria.receiver_ids.every(p=>m?.receiver_ids?.includes(p))
    &&m?.disclosures?.some(d=>d.kind==='result_extract'&&d.root_outcome_id===criteria.result_root&&d.id===criteria.disclosure_id
      &&criteria.fields.every(f=>d.fields.some(x=>x.path===f)));
  }
  if(matches)roots.add(task.root_outcome_id??`task:${task.task_id}`);
 }
 return [...roots].slice(0,4);
}

export function goalLifecycleContext(w,id,c){
 const records=migrateGoalBindings(w.cognition?.actors[id]??{},c.at);
 const goals=Object.values(records).filter(g=>g.schema===GOAL_LIFECYCLE.schema).map(g=>{
  const evidence=lifecycleEvidence(w,id,g),current=c.opportunities.entries.find(e=>e.id===g.binding?.id);
  return {...copy(g),evidence_ids:evidence,review_due:live(g)&&(!g.next_review_at||g.next_review_at<=c.at),
   method_status:!g.binding?'unbound':!current||current.identity!==g.binding.identity?'review_required':current.status,
   completion_status:evidence.length?'evidence_satisfied':g.completion_criteria.kind==='open_inquiry'?'open':'pending'};
 });
 return {schema:GOAL_LIFECYCLE.schema,goals,criteria:goalCriteria(c),max_live:GOAL_LIFECYCLE.max_live,rule:GOAL_LIFECYCLE.rule};
}

export function prepareGoalLifecycle(life,proposal,c,refs,at){
 const frozen=refs.goal_lifecycle;
 if(c.goal_lifecycle?.schema!==GOAL_LIFECYCLE.schema||frozen?.schema!==GOAL_LIFECYCLE.schema)fail('goal_lifecycle_contract_missing');
 const updates=proposal.goal_updates??[],entities=proposal.state?.short_term_goal_entities??[];
 if(!Array.isArray(updates)||updates.length>GOAL_LIFECYCLE.max_updates||!Array.isArray(entities))fail('goal_lifecycle_invalid');
 if(updates.filter(u=>u?.operation==='new').length>GOAL_LIFECYCLE.max_new)fail('goal_capacity_review_required');
 if(proposal.goal_bindings?.length)fail('goal_lifecycle_mixed_contract');
 const bindings=migrateGoalBindings(life,at),seen=new Set();
 for(const u of updates){
  if(!u||!cleanId(u.goal_id)||seen.has(u.goal_id)||!GOAL_LIFECYCLE.operations.includes(u.operation)
   ||Object.keys(u).some(k=>!['goal_id','operation','text','criterion_id','next_step','followup_id','review_in_hours','reason'].includes(k)))fail('goal_lifecycle_invalid');
  seen.add(u.goal_id);
  if(typeof u.reason!=='string'||!u.reason.trim()||u.reason.length>200)fail('goal_review_reason_required');
  let g=bindings[u.goal_id];
  if(u.operation==='new'){
   if(c.phase!=='plan'||g||typeof u.text!=='string'||!u.text.trim()||u.text.length>50)fail('goal_lifecycle_invalid');
   const criterion=u.criterion_id==null?{kind:'open_inquiry',title:u.text}:c.goal_lifecycle.criteria.find(x=>x.id===u.criterion_id);
   const prior=frozen.criteria.find(x=>x.id===u.criterion_id);
   if(!criterion||u.criterion_id!=null&&!isDeepStrictEqual(criterion,prior))fail('goal_criterion_changed');
   g=bindings[u.goal_id]={schema:GOAL_LIFECYCLE.schema,goal_id:u.goal_id,text:u.text,
    completion_criteria:copy(criterion),lifecycle_status:'active',bound_at:at,binding:null,evidence_ids:[],attempts:[],transitions:[]};
   if(Object.values(bindings).some(other=>other!==g&&live(other)
    &&(other.text===g.text||criterion.id&&other.completion_criteria?.id===criterion.id)))fail('goal_duplicate_use_existing_id');
  }else{
   const prior=frozen.goals.find(x=>x.goal_id===u.goal_id);
   if(!g||!prior||!GOAL_LIFECYCLE.transitions[g.lifecycle_status]?.includes(u.operation))fail('goal_transition_invalid');
   if(!isDeepStrictEqual(g.completion_criteria,prior.completion_criteria)||g.lifecycle_status!==prior.lifecycle_status)fail('goal_lifecycle_changed');
   if(u.text!==undefined&&u.text!==g.text||u.criterion_id!==undefined&&u.criterion_id!==g.completion_criteria.id)fail('goal_criterion_immutable');
  }
  if(['new','replan'].includes(u.operation)){
   if(c.phase!=='plan')fail('goal_replan_requires_plan');
   if(g.completion_criteria.kind!=='open_inquiry'&&!u.next_step)fail('goal_method_required');
   if(u.next_step){
    validateOpportunityTransition({status:'continue',next_step:u.next_step,followup_id:u.followup_id},c.continuation,refs.continuation);
    const binding=opportunityBinding(u.next_step,c.continuation);
    const criterion=c.goal_lifecycle.criteria.find(k=>k.opportunity_ids.includes(binding?.id));
    const fixed=g.completion_criteria;
    const compatible=fixed.kind==='open_inquiry'||fixed.kind==='exact_opportunity'&&fixed.identity===binding?.identity
      ||fixed.id&&criterion?.id===fixed.id;
    if(!binding||!compatible)fail('goal_method_not_compatible');
    g.binding=binding;g.attempts=[...g.attempts,{at,binding:copy(binding),reason:u.reason}].slice(-GOAL_LIFECYCLE.history_limit);
   }else g.binding=null;
  }else if(u.next_step!=null||u.followup_id!=null)fail('goal_replan_required');
  const before=g.lifecycle_status;
  if(u.operation==='postpone')g.lifecycle_status='postponed';
  if(u.operation==='resume')g.lifecycle_status='active';
  if(u.operation==='abandon')g.lifecycle_status='abandoned';
  if(u.operation==='complete'){
   const proof=c.goal_lifecycle.goals.find(x=>x.goal_id===g.goal_id);
   if(!proof?.evidence_ids.length||g.completion_criteria.kind==='open_inquiry')fail('goal_completion_without_result');
   g.evidence_ids=copy(proof.evidence_ids);g.lifecycle_status='completed';
  }
  if(live(g)){
   const hours=u.review_in_hours??GOAL_LIFECYCLE.review_hours.default;
   if(!Number.isInteger(hours)||hours<GOAL_LIFECYCLE.review_hours.min||hours>GOAL_LIFECYCLE.review_hours.max)fail('goal_review_time_invalid');
   g.next_review_at=new Date(Date.parse(at)+hours*3600000).toISOString();
  }else g.next_review_at=null;
  g.last_reviewed_at=at;
  g.transitions=[...g.transitions,{at,operation:u.operation,from:before,to:g.lifecycle_status,reason:u.reason}].slice(-GOAL_LIFECYCLE.history_limit);
 }
 if(Object.values(bindings).filter(live).length>GOAL_LIFECYCLE.max_live)fail('goal_capacity_review_required');
 const entityIds=new Set();
 for(const e of entities){
  const g=bindings[e.id];
  if(!g||entityIds.has(e.id)||e.text!==g.text)fail('goal_identity_changed');entityIds.add(e.id);
  const expected=g.lifecycle_status==='legacy_closed'?g.legacy_status:GOAL_LIFECYCLE.entity_status[g.lifecycle_status];
  if(e.status!==expected)fail('goal_transition_required');
  const old=life.state?.short_term_goal_entities?.find(x=>x.id===e.id);
  if(old&&e.due_step!==old.due_step||!old&&e.due_step!=null)fail('goal_deadline_immutable');
 }
 for(const g of Object.values(bindings))if((live(g)||seen.has(g.goal_id))&&!entityIds.has(g.goal_id))fail('goal_identity_missing');
 // Keep all open matters and a bounded closed history. No FIFO eviction of life.
 const closed=Object.values(bindings).filter(g=>!live(g)).sort((a,b)=>String(b.last_reviewed_at??b.bound_at).localeCompare(String(a.last_reviewed_at??a.bound_at)));
 for(const g of closed.slice(GOAL_LIFECYCLE.history_limit))if(!entityIds.has(g.goal_id))delete bindings[g.goal_id];
 return bindings;
}
