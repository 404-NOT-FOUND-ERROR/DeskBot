import {readRoleWishesReview} from './roleWishesReview.ts';
import type {RoleWishesReviewSample} from './roleWishesReview.ts';
import type {DeskBotPracticalRoleTrial} from './deskbot/types.ts';

export interface RolePracticalTrialsReviewFixture {
  schema:'deskbot.practical-role-trials-review.v1';simulated:true;live_world_untouched:true;samples:RoleWishesReviewSample[];
}
export function isPracticalRoleTrial(value:unknown):value is DeskBotPracticalRoleTrial {
  if(!value||typeof value!=='object')return false;
  const trial=value as DeskBotPracticalRoleTrial;
  if(trial.schema!=='deskbot.practical-role-trial.v1'||!['running','paused','blocked','review','exited'].includes(trial.status)||!['form','vocation'].includes(trial.axis))return false;
  if(['trial_id','proposal_id','actor_id','direction_id','variant_id','variant_label','next_step'].some(key=>typeof trial[key as keyof DeskBotPracticalRoleTrial]!=='string'))return false;
  if(!Array.isArray(trial.variant_choices)||trial.variant_choices.some(value=>!value||typeof value.id!=='string'||typeof value.label!=='string')||!trial.variant_choices.some(value=>value.id===trial.variant_id))return false;
  if(!Array.isArray(trial.allowed_actions)||trial.allowed_actions.some(value=>!['pause','resume','adjust','exit'].includes(value)))return false;
  if(!Array.isArray(trial.blockers)||trial.blockers.some(value=>!value||typeof value.code!=='string'||typeof value.label!=='string'))return false;
  if(!Array.isArray(trial.outcomes)||trial.outcomes.length>32||trial.outcomes.some(value=>!value||typeof value.root_outcome_id!=='string'||!Number.isFinite(Date.parse(value.at))||!['primary','support'].includes(value.step_role)))return false;
  if(!trial.progress||['successful_primary','condition_failures','performance_failures','unknown_failures','cancelled','started_attempts'].some(key=>typeof trial.progress[key as keyof typeof trial.progress]!=='number'||Number(trial.progress[key as keyof typeof trial.progress])<0))return false;
  if(['primary_days','root_outcome_ids','support_roots','frozen_wish_root_ids'].some(key=>!Array.isArray(key==='frozen_wish_root_ids'?trial[key]:trial.progress[key as 'primary_days'|'root_outcome_ids'|'support_roots'])))return false;
  if(!trial.review||typeof trial.review.ready!=='boolean'||typeof trial.review.summary!=='string'||trial.review.basis!=='canonical_unique_task_results'||[trial.review.quality_proven,trial.review.qualification_proven,trial.review.preference_proven,trial.review.changes_appearance].some(value=>value!==false))return false;
  if(trial.active_task!==null&&(!trial.active_task||typeof trial.active_task.task_id!=='string'||typeof trial.active_task.title!=='string'||(trial.active_task.remaining_ms!==null&&typeof trial.active_task.remaining_ms!=='number')||!['primary','support'].includes(trial.active_task.step_role)))return false;
  return Number.isFinite(Date.parse(trial.started_at))&&Number.isFinite(Date.parse(trial.updated_at));
}
export function readRolePracticalTrialsReview(value:unknown):RolePracticalTrialsReviewFixture|null {
  if(!value||typeof value!=='object')return null;
  const fixture=value as RolePracticalTrialsReviewFixture;
  if(fixture.schema!=='deskbot.practical-role-trials-review.v1'||!readRoleWishesReview({...fixture,schema:'deskbot.role-wishes-review.v1'}))return null;
  for(const sample of fixture.samples)for(const proposal of sample.proposals)if(proposal.practical_trial) {
    const trial=proposal.practical_trial;
    if(!isPracticalRoleTrial(trial)||trial.proposal_id!==proposal.proposal_id||trial.actor_id!==sample.memory.owner_id||trial.direction_id!==proposal.direction_id||trial.axis!==proposal.axis)return null;
    if(proposal.status!==(trial.status==='exited'?'withdrawn':'prepared'))return null;
  }
  return fixture;
}
