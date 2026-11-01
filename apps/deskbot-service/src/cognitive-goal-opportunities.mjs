import {OPPORTUNITY_CONTRACT,opportunityBinding,validateOpportunityTransition} from './cognitive-opportunities.mjs';
import {GOAL_LIFECYCLE,prepareGoalLifecycle,lifecycleEvidence} from './cognitive-goal-lifecycle.mjs';
const copy=structuredClone;
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};

function evidence(w,id,goal){
 if(goal.schema===GOAL_LIFECYCLE.schema)return lifecycleEvidence(w,id,goal);
 return [...new Set([...(goal.evidence_ids??[]),...(w.tasks??[]).filter(t=>t.actor_id===id&&t.status==='completed'
  &&t.completion&&t.cognitive_observation&&t.completion.effect!=='no_effect'
  &&t.completion.result?.success!==false&&t.started_at>=goal.bound_at
  &&t.opportunity_binding?.identity===goal.binding.identity).map(t=>t.root_outcome_id??`task:${t.task_id}`)])];
}

/** A binding certifies only the chosen concrete step, never an open aspiration. */
export function cognitiveGoalOpportunities(w,id,c){
 const life=w.cognition?.actors[id]??{};
 const goals=Object.values(life.goal_bindings??{}).map(goal=>{
  const roots=evidence(w,id,goal),current=c.opportunities.entries.find(e=>e.id===goal.binding?.id);
  return {...copy(goal),evidence_ids:roots,status:roots.length?'achieved':!current||current.identity!==goal.binding?.identity?'review_required':current.status,
   reason:roots.length?'实际完成了绑定的具体步骤；不证明更大愿望已经实现。':current?.blocker??null};
 });
 return {schema:OPPORTUNITY_CONTRACT.goal_schema,goals,rule:'绑定属于一个具体机会步骤。未绑定的目标仍是个人设想，没有执行权限或客观完成证据。目标过期、放下、失败与实际完成分开。'};
}

export function prepareGoalBindings(life,proposal,c,refs,at){
 if(proposal.goal_contract===GOAL_LIFECYCLE.schema)return prepareGoalLifecycle(life,proposal,c,refs,at);
 if(refs.goal_lifecycle?.schema===GOAL_LIFECYCLE.schema||proposal.goal_contract!=null||proposal.goal_updates!=null
  ||Object.values(life.goal_bindings??{}).some(g=>g.schema===GOAL_LIFECYCLE.schema))fail('goal_lifecycle_contract_required');
 const bindings=copy(life.goal_bindings??{}),declarations=proposal.goal_bindings??[];
 if(!Array.isArray(declarations)||declarations.length>2)fail('goal_opportunity_invalid');
 if(c.phase!=='plan'&&declarations.length)fail('goal_opportunity_requires_plan');
 const entities=proposal.state?.short_term_goal_entities??[],seen=new Set();
 for(const d of declarations){
  if(!d||typeof d.goal_id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(d.goal_id)
   ||['constructor','prototype'].includes(d.goal_id)||Object.keys(d).some(k=>!['goal_id','text','next_step','followup_id'].includes(k))||seen.has(d.goal_id))fail('goal_opportunity_invalid');
  seen.add(d.goal_id);
  const goal=entities.find(g=>g.id===d.goal_id&&g.text===d.text);
  if(!goal||goal.status!=='active'||d.next_step?.kind!=='opportunity')fail('goal_opportunity_invalid');
  validateOpportunityTransition({status:'continue',followup_id:d.followup_id,next_step:d.next_step},c.continuation,refs.continuation);
  const binding=opportunityBinding(d.next_step,c.continuation);
  if(!binding)fail('goal_opportunity_invalid');
  const old=bindings[d.goal_id];
  if(old&&(old.text!==d.text||old.binding.identity!==binding.identity))fail('goal_opportunity_rebind');
  bindings[d.goal_id]??={goal_id:d.goal_id,text:d.text,binding,bound_at:at,evidence_ids:[]};
 }
 // The model may appraise an unbound aspiration. A bound material step, however,
 // cannot be labelled completed without executor-owned evidence.
 for(const g of entities){
  const link=bindings[g.id];if(!link)continue;
  if(g.text!==link.text)fail('goal_opportunity_rebind');
  const observed=c.goal_opportunities?.goals.find(x=>x.goal_id===g.id);
  if(g.status==='completed'&&!observed?.evidence_ids.length)fail('goal_completion_without_result');
 }
 return bindings;
}

export function captureGoalOpportunityEvidence(w,id){
 const life=w.cognition?.actors[id];if(!life)return;
 for(const goal of Object.values(life.goal_bindings??{}))goal.evidence_ids=evidence(w,id,goal).slice(0,4);
}
