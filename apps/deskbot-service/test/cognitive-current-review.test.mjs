import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cases,settle,tick,plus,OWNER} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext} from '../src/cognitive-life-state.mjs';
import {cognitiveUseContext,validateDecisionIssue} from '../src/cognitive-grounding.mjs';
import {prepareCognitiveFollowup,cognitiveResultFollowup,cognitiveWaitFollowup,validateNextStep} from '../src/cognitive-continuation.mjs';
import {startActivityTask} from '../src/realtime-world.mjs';
const world=()=>fixture(cases.find(c=>c.id==='invitation-3-on'));

test('expired cooldown stays historical while the current reading exposes the real remaining blocker',()=>{
 const w=world(),life=w.cognition.actors[OWNER],at=w.clock.synced_at;
 const task=startActivityTask(w,{actor_id:OWNER,task_id:'use',activity_id:'waylight-use'},{eventId:'use',at}).task;
 settle(w,w.tasks.find(t=>t.task_id===task.task_id));
 Object.assign(life.followup,{next_step:{kind:'activity',id:'waylight-use'},reason:'灯刚用过，等两小时',last_reviewed_at:w.clock.synced_at});
 tick(w,plus(w.clock.synced_at,14*60));
 const before=JSON.stringify(w),view=cognitiveContext(w,OWNER,w.clock.synced_at).continuation.current;
 assert.equal(view.reason,'灯刚用过，等两小时');
 assert.equal(view.current_conditions.assessed_at,w.clock.synced_at);
 assert.equal(view.current_conditions.next_step.minutes_until_clock_ready,0);
 assert.equal(view.current_conditions.next_step.available,false); // Daylight is a different blocker.
 assert.equal(JSON.stringify(w),before);
});

test('actual execution marks the bound step achieved without automatically closing the larger inquiry',()=>{
 const w=world(),life=w.cognition.actors[OWNER],at=w.clock.synced_at;
 prepareCognitiveFollowup(life,{followup_decision:'continue',completion_target_id:'activity:waylight-fit-shade'},cognitiveContext(w,OWNER,at).continuation,at);
 const task=startActivityTask(w,{actor_id:OWNER,task_id:'fit',activity_id:'waylight-fit-shade'},{eventId:'fit',at}).task;
 settle(w,w.tasks.find(t=>t.task_id===task.task_id));
 const context=cognitiveContext(w,OWNER,w.clock.synced_at).continuation;
 const id=context.current.followup_id;
 assert.equal(context.current.current_conditions.target_status,'achieved');
 assert.deepEqual(context.current.resolution_evidence_ids,['task:fit']);
 assert.equal(life.followup.status,'continue');
 const closure={followup_id:id,kind:'resolved',reason:'指定装罩步骤已完成，后续研究另作考虑',evidence_ids:['task:fit']};
 const next=cognitiveResultFollowup(life,{status:'drop',question:'',reason:closure.reason,delay_hours:1,next_step:null,followup_closure:closure},context,w.clock.synced_at,'task:fit','continue');
 assert.equal(next.status,'drop');assert.equal(next.followup_closure.kind,'resolved');
 assert.equal(next.last_reviewed_at,w.clock.synced_at);
});

test('a sent invitation waits for its contract; an unrelated gathering activity or fresh invitation is not that wait',()=>{
 const context={next_options:[{kind:'social',id:'give-water'},{kind:'commitment',id:'c'},{kind:'activity',id:'collect-water'},{kind:'reply',id:'m'}],
  wait_options:[{kind:'commitment',id:'c',available:false},{kind:'reply',id:'m',commitment_id:'c',available:false}]};
 for(const kind of ['commitment','reply']){
  const wait_for={kind,id:kind==='reply'?'m':'c'};
  for(const next_step of [context.next_options[0],context.next_options[2]])assert.throws(()=>validateNextStep({next_step,wait_for},context),{code:'followup_wait_step_mismatch'});
  validateNextStep({next_step:{kind:'commitment',id:'c'},wait_for},context);
  validateNextStep({next_step:null,wait_for},context);
 }
});

test('use context reports own stock and accepted obligation, never infers demand from a proposal or a peer inventory',()=>{
 const w=world();w.living.inventories[OWNER].stock.water=4;
 w.social.commitments=[{id:'pending',actors:[OWNER,'peer'],status:'proposed',offers:[{from:OWNER,to:'peer',resource:'water',count:4}]},
  {id:'accepted',actors:[OWNER,'peer'],status:'accepted',offers:[{from:OWNER,to:'peer',resource:'water',count:2}]}];
 const before=JSON.stringify(w);
 const view=cognitiveUseContext(w,OWNER,[{activity_id:'collect-water',output:{resource:'water',count:4}}],w.clock.synced_at);
 assert.equal(view.production[0].already_held,4);
 assert.deepEqual(view.production[0].accepted_outgoing,[{commitment_id:'accepted',count:2}]);
 assert.equal(JSON.stringify(w),before);
});

test('compiler cannot select an easier criterion or close an issue the actor chose to continue',()=>{
 const choice={followup_id:'i',followup_decision:'continue',completion_target_id:'activity:install',followup_closure:null};
 validateDecisionIssue({decision_issue:choice,compiled:{...choice}});
 for(const change of [{completion_target_id:'activity:water'},{followup_decision:'drop'},{followup_id:'j'},{followup_closure:{kind:'satisfied'}}])
  assert.throws(()=>validateDecisionIssue({decision_issue:choice,compiled:{...choice,...change}}),{code:'decision_issue_changed_by_compiler'});
});

test('explicitly releasing a stale wait does not inherit its old next step',()=>{
 const w=world(),life=w.cognition.actors[OWNER];
 Object.assign(life.followup,{next_step:{kind:'activity',id:'waylight-use'},wait_for:{kind:'activity',id:'waylight-use'}});
 const context=cognitiveContext(w,OWNER,w.clock.synced_at).continuation;
 const next=cognitiveWaitFollowup(life,{followup_decision:'postpone',reason:'暂时不行动，稍后再想',next_step:null,wait_for:null,review_after_minutes:60},context,w.clock.synced_at);
 assert.equal(next.wait_for,null);assert.equal(next.next_step,null);assert.equal(next.original_question,life.followup.question);
});
