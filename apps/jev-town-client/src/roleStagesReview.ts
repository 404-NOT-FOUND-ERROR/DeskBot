import {readRoleWishesReview,type RoleWishesReviewSample} from './roleWishesReview.ts';
import type {DeskBotRoleStage,DeskBotRoleStagePreview,DeskBotRoleStages,DeskBotWorldMap} from './deskbot/types.ts';
import {SHAPING_ANCHORS,type ShapingAppearance} from './three/shapingAppearance.ts';
const strings=(value:unknown):value is string[]=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&item.length>0);
const uniqueStrings=(value:unknown):value is string[]=>strings(value)&&new Set(value).size===value.length;
const axisDirection=(axis:string,direction:string)=>axis==='form'?direction==='wetland_frog':axis==='vocation'&&['chef','workshop_maker'].includes(direction);
const at=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function isShapingAppearance(value:unknown):value is ShapingAppearance {
  if(!value||typeof value!=='object')return false;
  const view=value as ShapingAppearance;
  if(view.schema!=='deskbot.role-stage-appearance.v1'||view.physical_shell_changed!==false||!uniqueStrings(view.anchors)||SHAPING_ANCHORS.some(anchor=>!view.anchors!.includes(anchor)))return false;
  const form=view.form,vocation=view.vocation;
  if(form!==null&&(!form||form.direction_id!=='wetland_frog'||form.figure_form!=='leaf-frog'||typeof form.label!=='string'||!strings(form.accessories)||(form.stage_id!==null&&typeof form.stage_id!=='string')))return false;
  return vocation===null||Boolean(vocation&&typeof vocation.label==='string'&&strings(vocation.accessories)&&(vocation.stage_id===null||typeof vocation.stage_id==='string')&&((vocation.direction_id==='chef'&&vocation.figure_vocation==='chef')||(vocation.direction_id==='workshop_maker'&&vocation.figure_vocation==='workshop-maker')));
}
export function isRoleStage(value:unknown):value is DeskBotRoleStage {
  if(!value||typeof value!=='object')return false;
  const stage=value as DeskBotRoleStage;
  if(stage.schema!=='deskbot.role-stage.v1'||!['accepted','rolled_back'].includes(stage.status)||!axisDirection(stage.axis,stage.direction_id)||typeof stage.current!=='boolean')return false;
  if(['stage_id','proposal_id','trial_id','actor_id','label'].some(key=>typeof stage[key as keyof DeskBotRoleStage]!=='string'))return false;
  if(!at(stage.accepted_at)||(stage.rolled_back_at!==null&&!at(stage.rolled_back_at))||!uniqueStrings(stage.primary_root_ids)||!uniqueStrings(stage.primary_days)||!uniqueStrings(stage.frozen_wish_root_ids))return false;
  if(stage.primary_root_ids.length<2||stage.primary_days.length<2||!Array.isArray(stage.allowed_actions)||stage.allowed_actions.some(action=>action!=='rollback'))return false;
  if(stage.current&&stage.status!=='accepted'||(!stage.current&&stage.allowed_actions.length))return false;
  return stage.qualification_proven===false&&stage.preference_proven===false&&stage.physical_shell_changed===false&&stage.life_changes?.basis==='rule_based_choice'&&typeof stage.life_changes.summary==='string'&&stage.life_changes.resource_grants===false&&stage.life_changes.task_preemption===false;
}
export function isRoleStages(value:unknown):value is DeskBotRoleStages {
  if(!value||typeof value!=='object')return false;
  const view=value as DeskBotRoleStages;
  if(view.schema!=='deskbot.role-stages.v1'||typeof view.actor_id!=='string'||!Number.isInteger(view.revision)||view.revision<0||!isShapingAppearance(view.appearance)||!Array.isArray(view.history)||view.history.some(stage=>!isRoleStage(stage)||stage.actor_id!==view.actor_id)||view.identity_changed!==false||view.physical_shell_changed!==false||!view.current)return false;
  for(const axis of ['form','vocation'] as const){const stage=view.current[axis],part=view.appearance[axis];if(stage===null?part!==null:!isRoleStage(stage)||stage.axis!==axis||!stage.current||stage.actor_id!==view.actor_id||part?.stage_id!==stage.stage_id||part.direction_id!==stage.direction_id||!view.history.some(item=>item.stage_id===stage.stage_id))return false;}
  return true;
}
export function isRoleStagePreview(value:unknown):value is DeskBotRoleStagePreview {
  if(!value||typeof value!=='object')return false;
  const view=value as DeskBotRoleStagePreview;
  if(view.schema!=='deskbot.role-stage-preview.v1'||typeof view.proposal_id!=='string'||typeof view.actor_id!=='string'||!axisDirection(view.axis,view.direction_id)||typeof view.eligible!=='boolean'||typeof view.preview_fingerprint!=='string'||!view.preview_fingerprint||!isShapingAppearance(view.appearance_before)||!isShapingAppearance(view.appearance_preview))return false;
  if(!Array.isArray(view.barriers)||view.barriers.some(item=>!item||typeof item.id!=='string'||typeof item.label!=='string')||!Array.isArray(view.options)||view.options.some(item=>!item||item.direction_id!==view.direction_id||item.axis!==view.axis||typeof item.label!=='string'||typeof item.summary!=='string'||!isShapingAppearance(item.appearance)))return false;
  if(view.basis?.kind!=='canonical_unique_task_results'||!uniqueStrings(view.basis.primary_root_ids)||!uniqueStrings(view.basis.primary_days)||!uniqueStrings(view.basis.frozen_wish_root_ids)||view.eligible&&(view.barriers.length>0||view.basis.primary_root_ids.length<2||view.basis.primary_days.length<2))return false;
  if(view.stage!==null&&!isRoleStage(view.stage))return false;
  return view.reversible===true&&view.changes_identity===false&&view.physical_shell_changed===false&&view.qualification_proven===false&&view.preference_proven===false;
}
export interface RoleStagesReviewSample extends RoleWishesReviewSample {
  appearance:{schema:string;role_stage?:ShapingAppearance};preview:DeskBotRoleStagePreview;map?:DeskBotWorldMap;
}
export interface RoleStagesReviewFixture {schema:'deskbot.role-stages-review.v1';simulated:true;live_world_untouched:true;samples:RoleStagesReviewSample[];}
export function readRoleStagesReview(value:unknown):RoleStagesReviewFixture|null {
  if(!value||typeof value!=='object')return null;
  const fixture=value as RoleStagesReviewFixture;
  if(fixture.schema!=='deskbot.role-stages-review.v1'||!readRoleWishesReview({...fixture,schema:'deskbot.role-wishes-review.v1'}))return null;
  for(const sample of fixture.samples){
    const stages=sample.evolution.role_stages;
    if(!isRoleStages(stages)||stages.actor_id!==sample.memory.owner_id||!isRoleStagePreview(sample.preview)||sample.preview.actor_id!==sample.memory.owner_id||!sample.appearance||typeof sample.appearance.schema!=='string')return null;
    const active=Boolean(stages.current.form||stages.current.vocation);
    if(active&&!sample.appearance.role_stage||sample.appearance.role_stage&&JSON.stringify(sample.appearance.role_stage)!==JSON.stringify(stages.appearance))return null;
    for(const proposal of sample.proposals)if(proposal.role_stage){const stage=proposal.role_stage;if(!isRoleStage(stage)||stage.proposal_id!==proposal.proposal_id||stage.actor_id!==sample.memory.owner_id||stage.axis!==proposal.axis||stage.direction_id!==proposal.direction_id||proposal.status!==(stage.status==='accepted'?'accepted':'withdrawn')||proposal.practical_trial?.allowed_actions.length)return null;}
    if(sample.map&&(active&&!sample.map.protagonist.appearance?.role_stage||sample.map.protagonist.appearance?.role_stage&&JSON.stringify(sample.map.protagonist.appearance.role_stage)!==JSON.stringify(stages.appearance)))return null;
  }
  return fixture;
}
