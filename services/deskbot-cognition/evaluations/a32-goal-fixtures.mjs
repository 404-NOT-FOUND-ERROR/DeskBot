// Authored fictional starting conditions, using existing goals, clock and executor.
// These labels never enter prompts as desired answers. No model response is supplied.
import {fixture,OWNER,tick,settle,hash} from './r3-fixtures.mjs';
import {cognitiveContext} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {freezeCognitiveReferences} from '../../../apps/deskbot-service/src/cognitive-continuity.mjs';
import {prepareGoalBindings} from '../../../apps/deskbot-service/src/cognitive-goal-opportunities.mjs';
import {GOAL_LIFECYCLE} from '../../../apps/deskbot-service/src/cognitive-goal-lifecycle.mjs';
import {startActivityTask} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';

export const goalCases=[
 {id:'G1-formation',group:'goal',actor:OWNER,seeded:false,intervention:'No seeded goal; finite stock and current water/lighting opportunities.'},
 {id:'G2-change-method',group:'goal',actor:OWNER,seeded:true,intervention:'Seed a night water-reserve intention, then advance normally to 08:00 before sampling. Daylight blocks the lamp method; ordinary filtering remains possible.'},
 {id:'G3-overnight',group:'goal',actor:OWNER,seeded:true,intervention:'Seed an unfinished reserve goal at 22:45 with authored energy 0.20. Before window 2, close/reopen SQLite and advance to at least next 09:00 without resetting needs.'},
 {id:'G4-open-inquiry',group:'goal',actor:OWNER,seeded:true,intervention:'Seed an open inquiry, then execute one real light measurement before sampling. No authored conclusion or completion.'},
];
const ctx=w=>cognitiveContext(w,OWNER,w.clock.synced_at);
const method=(c,id)=>c.opportunities.entries.find(e=>e.binding.activity_id===id&&(!e.binding.production_use||e.binding.production_use.kind==='reserve'));
export function seedGoal(w,{id,open=false,activity='collect-water'}){
 const c=ctx(w),chosen=open?null:method(c,activity);
 if(!open&&!chosen)throw Error('fixture_goal_method_missing');
 const criterion=open?null:c.goal_lifecycle.criteria.find(k=>k.opportunity_ids.includes(chosen.id));
 const text=open?'了解不同日子里水岸的明暗变化':'备好一批自用清水';
 const life=w.cognition.actors[OWNER],state=structuredClone(life.state);
 state.short_term_goal_entities=[...(state.short_term_goal_entities??[]),{id,text,status:'active',goal_type:'short_term',created_step:0,due_step:null}];
 const p={goal_contract:GOAL_LIFECYCLE.schema,state,goal_updates:[{goal_id:id,operation:'new',text,
  criterion_id:criterion?.id??null,next_step:chosen?{kind:'opportunity',id:chosen.id}:null,
  reason:open?'这是一个尚未得出结论的长期问题':'想在有余力时为自己留一批清水',review_in_hours:1}]};
 life.goal_bindings=prepareGoalBindings(life,p,c,freezeCognitiveReferences(c),c.at);life.state=state;
}
export function goalFixture(c){
 if(!goalCases.some(g=>g.id===c.id))throw Error('unknown_goal_fixture');
 const w=fixture({actor:OWNER,group:'resources',on:false});
 w.world_id='a32-isolated-'+c.id;
 if(c.id==='G2-change-method'){
  seedGoal(w,{id:'goal:seeded-water',activity:'waylight-use'});
  tick(w,'2026-10-21T00:00:00.000Z');
 }else if(c.id==='G3-overnight'){
  tick(w,'2026-10-20T14:45:00.000Z');
  w.autonomy.actors[OWNER].energy=.20;
  seedGoal(w,{id:'goal:seeded-overnight'});
 }else if(c.id==='G4-open-inquiry'){
  seedGoal(w,{id:'goal:seeded-inquiry',open:true});
  const e=method(ctx(w),'measure-bank-light'),taskId='fixture-inquiry-measure';
  startActivityTask(w,{actor_id:OWNER,activity_id:'measure-bank-light',task_id:taskId},{eventId:taskId,at:w.clock.synced_at});
  const task=w.tasks.find(t=>t.task_id===taskId);
  Object.assign(task,{origin:'cognitive_life',cognitive_operation:'activity',root_outcome_id:`task:${taskId}`,
   opportunity_binding:{id:e.id,identity:e.identity,production_use:e.binding.production_use}});
  settle(w,task);
  if(task.status!=='completed')throw Error('fixture_measurement_failed');
 }
 return w;
}
export function goalSnapshot(w,actor=OWNER){
 const c=cognitiveContext(w,actor,w.clock.synced_at);
 return {entities:structuredClone(w.cognition.actors[actor].state.short_term_goal_entities??[]),
  goals:structuredClone(c.goal_lifecycle.goals)};
}
export function restartGoalWorld(w,filename){
 const before=hash(w);let db=createSqlitePersistence({filename});
 try{db.put('canonical-world.states',w.world_id,w);}finally{db.close();}
 db=createSqlitePersistence({filename});let restored;
 try{restored=db.get('canonical-world.states',w.world_id);}finally{db.close();}
 if(hash(restored)!==before)throw Error('goal_restart_state_mismatch');
 return {world:restored,proof:{storage:'SQLite',closed_and_reopened:true,before_hash:before,after_hash:hash(restored),at:w.clock.synced_at}};
}
export function goalCoverage(c,episode){
 const turns=episode.turns,after=turns.at(-1)?.goals_after?.goals??[];
 const initial=episode.initial_goals?.goals??[],find=id=>after.find(g=>g.goal_id===id);
 if(c.id==='G1-formation'){
  const newGoal=turns.find(t=>t.plan_proposal?.goal_updates?.some(u=>u.operation==='new'));
  const ids=newGoal?.plan_proposal.goal_updates.filter(u=>u.operation==='new').map(u=>u.goal_id)??[];
  const stable=ids.some(id=>turns.some(t=>t.turn>newGoal.turn&&t.goals_before.goals.some(g=>g.goal_id===id)));
  return {naturally_formed:ids.length>0,read_back_next_window:stable,covered:stable};
 }
 const id=initial[0]?.goal_id,g=find(id),updates=turns.flatMap(t=>[...(t.plan_proposal?.goal_updates??[]),...(t.feedback_proposal?.goal_updates??[])]).filter(u=>u.goal_id===id);
 const stable=Boolean(g)&&hash(g.completion_criteria)===hash(initial[0].completion_criteria);
 if(c.id==='G2-change-method'){
  const changed=updates.some(u=>u.operation==='replan')&&g?.attempts?.some(a=>a.binding?.identity!==initial[0].binding?.identity);
  const completed=g?.lifecycle_status==='completed'&&g.evidence_ids.length>0;
  return {stable_identity_and_criterion:stable,replanned:!!changed,completed_with_evidence:!!completed,covered:stable&&!!changed&&!!completed};
 }
 if(c.id==='G3-overnight'){
  const ops=updates.map(u=>u.operation),p=ops.indexOf('postpone');
  const resumed=p>=0&&ops.indexOf('resume',p+1)>=0;
  const restarted=turns.some(t=>t.restart?.closed_and_reopened);
  return {stable_identity_and_criterion:stable,postponed_then_resumed:resumed,sqlite_reopened:restarted,covered:stable&&resumed&&restarted};
 }
 const bounded=g?.completion_criteria.kind==='open_inquiry'&&g.lifecycle_status!=='completed';
 const abandoned=updates.some(u=>u.operation==='abandon');
 return {open_question_not_objectively_completed:!!bounded,explicitly_abandoned:abandoned,maintenance_observed:updates.length>0,covered:!!bounded&&abandoned};
}
