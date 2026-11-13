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
  deadlines:Object.fromEntries((w.social?.commitments??[]).filter(row=>row.actors?.includes(actor)).map(row=>[row.id,row.deadline_at??null])),
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
function formationCoverage(turns) {
  let formed = false, retained = false;
  for (const turn of turns) {
    for (const update of turn.plan_proposal?.goal_updates ?? []) {
      if (update.operation !== 'new') continue;
      const created = turn.goals_after.goals.find(goal => goal.goal_id === update.goal_id);
      if (!created) continue;
      formed = true;
      const next = turns.find(other => other.turn === turn.turn + 1);
      const readBack = next?.goals_before.goals.find(goal => goal.goal_id === created.goal_id);
      if (readBack && hash(readBack.completion_criteria) === hash(created.completion_criteria)) retained = true;
    }
  }
  return {naturally_formed:formed, read_back_next_window:retained, covered:retained};
}

function updatesFor(turn, id) {
  return [...(turn.plan_proposal?.goal_updates ?? []), ...(turn.feedback_proposal?.goal_updates ?? [])]
    .filter(update => update.goal_id === id);
}

function overnightCoverage(turns, id) {
  const boundary = turns.findIndex(t => t.restart?.closed_and_reopened);
  if (boundary < 1) return {sqlite_reopened:false, preserved_overnight:false, postponed_then_resumed:false};
  const previous = turns[boundary-1].goals_after, next = turns[boundary].goals_before;
  const before = previous.goals.find(g => g.goal_id === id), after = next.goals.find(g => g.goal_id === id);
  const preserved = before?.lifecycle_status === 'postponed' && after?.lifecycle_status === 'postponed'
    && hash(before.completion_criteria) === hash(after.completion_criteria) && before.next_review_at === after.next_review_at
    && hash(previous.deadlines) === hash(next.deadlines)
    && Date.parse(turns[boundary].at) - Date.parse(turns[boundary].restart.at) >= 6 * 3600000;
  const postponed = turns.slice(0,boundary).some(t => updatesFor(t,id).some(u => u.operation === 'postpone'));
  const resumed = turns.slice(boundary).some(t => updatesFor(t,id).some(u => u.operation === 'resume'));
  return {sqlite_reopened:true, preserved_overnight:preserved, postponed_then_resumed:preserved && postponed && resumed};
}

export function goalCoverage(c, episode) {
  const turns = episode.turns.filter(t => t.goals_after && t.review?.valid !== false);
  if (c.id === 'G1-formation') return formationCoverage(turns);
  const initial = episode.initial_goals.goals[0];
  const goal = turns.at(-1)?.goals_after.goals.find(g => g.goal_id === initial.goal_id);
  const stable = Boolean(goal) && hash(initial.completion_criteria) === hash(goal.completion_criteria);
  const updates = turns.flatMap(t => updatesFor(t, initial.goal_id));
  if (c.id === 'G2-change-method') {
    const replan = turns.find(t => updatesFor(t,initial.goal_id).some(u => u.operation === 'replan' && u.next_step?.id
      && u.next_step.id !== initial.binding?.id));
    const alternateResult = replan && turns.some(t => t.turn >= replan.turn && t.task?.activity_id === 'collect-water'
      && t.task.status === 'completed' && goal?.evidence_ids.includes(t.task.root_outcome_id));
    const completed = Boolean(alternateResult && goal?.lifecycle_status === 'completed');
    return {stable_identity_and_criterion:stable, replanned:Boolean(replan), completed_with_evidence:completed, covered:stable && completed};
  }
  if (c.id === 'G3-overnight') {
    const overnight = overnightCoverage(turns,initial.goal_id);
    return {stable_identity_and_criterion:stable, ...overnight, covered:stable && overnight.postponed_then_resumed};
  }
  const bounded = goal?.completion_criteria.kind === 'open_inquiry' && goal.lifecycle_status !== 'completed';
  const abandoned = updates.some(u => u.operation === 'abandon');
  return {open_question_not_objectively_completed:Boolean(bounded), explicitly_abandoned:abandoned,
    maintenance_observed:updates.length > 0, covered:stable && Boolean(bounded) && abandoned};
}
