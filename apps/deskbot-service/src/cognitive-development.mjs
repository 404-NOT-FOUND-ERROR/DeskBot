import {activityTopic,developmentFacetsReadModel} from './development-facets.mjs';
import {livingReadModel} from './living-resources.mjs';
import {roleWishReadModel} from './role-wishes.mjs';
import {practicalTrialsReadModel,practicalTrialCandidates,recordPracticalTrialTask} from './role-practical-trials.mjs';
import {roleStagesReadModel} from './role-stages.mjs';
import {cognitiveSleepWindow} from './cognitive-schedule.mjs';
const copy=structuredClone;
const idOf=p=>p.character_id??p.npc_id;
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};

// Opportunities are observed only at an actual personal decision window. An
// offline day, hunger, occupied facility or missing materials is not a refusal.
export function cognitiveOpportunityWindow(w,id,at){
 const person=[w.protagonist,...w.npcs].find(p=>idOf(p)===id),need=w.autonomy?.actors[id];
 const available=(livingReadModel(w,id,{at})?.activities??[]).filter(a=>a.location_id===person?.location_id&&a.available);
 const obligations=(w.social?.commitments??[]).filter(c=>c.actors.includes(id)&&['accepted','meeting','working'].includes(c.status)&&(!c.not_before_at||Date.parse(c.not_before_at)-Date.parse(at)<=15*60000));
 const free=Boolean(need&&!need.paused&&need.energy>=.55&&need.appetite<=.6&&!cognitiveSleepWindow(w,id,at)
  &&!w.living?.recovery?.pending&&!w.tasks.some(t=>t.actor_id===id&&['running','paused'].includes(t.status))&&!obligations.length);
 const methods=available.map(a=>({activity_id:a.activity_id,topic:activityTopic(a.activity_id)}));
 const alternatives=[...new Set(methods.map(m=>m.activity_id))];
 // An observation is a real alternative when there is a local inspectable
 // object; rest is not counted as a second rich life choice in this metric.
 if(w.map_catalog?.objects?.some(o=>w.map_catalog.areas.find(a=>a.area_id===o.area_id)?.location_id===person?.location_id))alternatives.push('observe-local');
 return {at,location_id:person?.location_id,free,methods,topics:[...new Set([...methods.map(m=>m.topic).filter(Boolean),...(alternatives.includes('observe-local')?['explore']:[])])],alternatives,
  reason:free?'有余力且有未占用的当地方法':obligations.length?'先照应已接受的约定':cognitiveSleepWindow(w,id,at)?'睡眠窗口':'需要、当前任务或恢复条件优先'};
}
export function cognitiveDevelopmentContext(w,id,at){
 const facets=developmentFacetsReadModel(w,{actorId:id,at}).actors[0],rhythm=w.memory?.development?.rhythm?.actors[id];
 const wishes=roleWishReadModel(w,{actorId:id,at});
 const trials=practicalTrialsReadModel(w,{actorId:id,at});
 const stages=roleStagesReadModel(w,{actorId:id});
 return {schema:'deskbot.cognitive-development.v1',
  topics:(facets?.topics??[]).map(t=>({topic:t.topic,label:t.label,interest:t.interest.status,capability:t.capability.status,
   active_roots:t.interest.active_roots.slice(-6),invited_count:t.interest.invited_roots.length,obligation_count:t.interest.obligation_roots.length,
   recent_success_roots:t.capability.success_roots.slice(-3),rhythm:copy(rhythm?.topics?.[t.topic]??null)})),
  opportunity:cognitiveOpportunityWindow(w,id,at),
  diagnostics:cognitiveDevelopmentDiagnostics(w,id,at),
  wish_options:wishes.directions.map(d=>({direction_id:d.direction_id,label:d.label,axis:d.axis,eligible:d.readiness.eligible,
   barriers:d.readiness.barriers.map(b=>b.label),basis_roots:d.basis.root_outcome_ids.slice(-8),reason:d.authored_reason})),
  own_wish:copy(w.cognition?.actors[id]?.role_wish_choice??null),
  practical_trials:trials.trials.slice(-4).map(t=>({trial_id:t.trial_id,direction_id:t.direction_id,status:t.status,variant:t.variant_label,
    active_task:t.active_task,progress:t.progress,blockers:t.blockers,outcomes:t.outcomes.slice(-3),next_step:t.next_step})),
  current_stages:Object.fromEntries(Object.entries(stages.current).map(([axis,s])=>[axis,s?{stage_id:s.stage_id,direction_id:s.direction_id,label:s.label}:null])),
  rule:'接触、做成与喜欢是不同的；受邀或履约不自动成为爱好。可以继续、暂缓、放下或重新看看。条件不足不说明厌恶。角色只有满足前提后才能提出愿望，试做与采用仍走已有流程，不凭一句话改变外观。'};
}
export function cognitiveDevelopmentDiagnostics(w,id,at){
 const windows=(w.memory?.development?.cognitive_windows?.[id]??[]).filter(o=>o.at<=at&&Date.parse(at)-Date.parse(o.at)<=8*3600000);
 const streak=[];
 for(const o of windows){
  if(!o.free||!o.alternatives?.length||!o.blocked&&o.selected?.operation!=='wait')streak.length=0;
  else {if(streak.length&&Date.parse(o.at)-Date.parse(streak.at(-1).at)>2*3600000)streak.length=0;streak.push(o);}
 }
 const hours=streak.length?(Date.parse(streak.at(-1).at)-Date.parse(streak[0].at))/3600000:0;
 return {scope:'observed_personal_windows_only',six_hour_wait:hours>=6?{from:streak[0].at,to:streak.at(-1).at,windows:streak.length,
  code:'repeated_wait_with_feasible_alternatives',note:'连续已观测窗口有可行安排但六小时没有推进，需检查等待原因；不凭此强迫换兴趣。'}:null};
}
export function adoptCognitiveDevelopment(w,id,compiled,refs,at,{task=null,blocked=null}={}){
 if(Object.hasOwn(compiled,'development'))fail('development_choice_requires_top_level');
 const life=w.cognition.actors[id],d=w.memory?.development;if(!d)return;
 const source=refs.development;if(!source)return;
 const row={...copy(source.opportunity),id:life.job.id,selected:{operation:compiled.operation,activity_id:task?.activity_id??null,motivation:task?.life_motivation?.kind??compiled.motivation??'unknown'},
  task_id:task?.task_id??null,blocked:blocked?.code??null,prior_root_id:compiled.prior_root_id??null,followup_decision:compiled.followup_decision??'none'};
 (d.cognitive_windows??={})[id]=[...(d.cognitive_windows[id]??[]).filter(r=>r.id!==row.id),row].slice(-192);
 const decision=compiled.interest_choice;
 if(decision){
  const topic=source.topics.find(t=>t.topic===decision.topic);
  const roots=[...(topic?.active_roots??[]),...(topic?.recent_success_roots??[])];
  if(!topic||!['continue','pause','drop','revisit'].includes(decision.decision)||typeof decision.reason!=='string'||!decision.reason.trim()
    ||!Array.isArray(decision.root_ids)||!decision.root_ids.length||decision.root_ids.some(r=>!roots.includes(r)))fail('interest_choice_without_basis');
  (life.interest_choices??={})[decision.topic]={...copy(decision),reason:decision.reason.slice(0,300),at,job_id:life.job.id};
 }
 const wish=compiled.wish_choice;
 if(wish){
  const direction=source.wish_options.find(d=>d.direction_id===wish.direction_id);
  if(!direction||!['propose','defer','consider'].includes(wish.decision)||typeof wish.reason!=='string'||!wish.reason.trim())fail('role_wish_choice_invalid');
  if(wish.decision==='propose'&&!direction.eligible)fail('role_wish_not_ready');
  // Recheck at commit time. A proposal carries no appearance or task authority.
  const current=roleWishReadModel(w,{actorId:id,at}).directions.find(d=>d.direction_id===wish.direction_id);
  if(wish.decision==='propose'&&!current?.readiness.checks.filter(c=>c.scope==='evidence').every(c=>c.passed))fail('role_wish_basis_changed');
  life.role_wish_choice={...copy(wish),reason:wish.reason.slice(0,300),at,job_id:life.job.id,basis_root_ids:direction.basis_roots};
 }
}
export function cognitiveTrialLink(w,id,activity,at){
 const state=w.autonomy?.actors[id];if(!state)return null;
 const candidate=practicalTrialCandidates(w,state,at).find(c=>c.role_trial.primary_activity_id===activity);
 return candidate?{...copy(candidate.role_trial),step_role:'primary'}:null;
}
export function attachCognitiveTrial(w,task,link,at){
 if(!link)return;task.role_trial=link;recordPracticalTrialTask(w,task,at);
}
