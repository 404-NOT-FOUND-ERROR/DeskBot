import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cases,settle,OWNER} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext} from '../src/cognitive-life-state.mjs';
import {prepareCognitiveFollowup,cognitiveResultFollowup,cognitiveWaitFollowup,validateNextStep} from '../src/cognitive-continuation.mjs';
import {validateProductionUse,validateDecisionMethod,validateDecisionIssue} from '../src/cognitive-grounding.mjs';
import {cognitiveMemoryFrame} from '../src/cognitive-memory-frame.mjs';
import {startActivityTask} from '../src/realtime-world.mjs';
const world=()=>fixture(cases.find(c=>c.id==='invitation-3-on'));
function completedShade(){
 const w=world(),life=w.cognition.actors[OWNER],at=w.clock.synced_at;
 prepareCognitiveFollowup(life,{followup_decision:'continue',completion_target_id:'activity:waylight-fit-shade'},cognitiveContext(w,OWNER,at).continuation,at);
 const started=startActivityTask(w,{actor_id:OWNER,task_id:'shade',activity_id:'waylight-fit-shade'},{eventId:'shade',at});
 settle(w,w.tasks.find(t=>t.task_id===started.task_id));
 return {w,life,at:w.clock.synced_at,context:cognitiveContext(w,OWNER,w.clock.synced_at).continuation};
}
test('after installation, use is ready and cannot inherit the six-hour adjustment wait even in feedback',()=>{
 const {life,at,context}=completedShade();
 assert.equal(context.wait_options.find(o=>o.id==='waylight-use').available,true);
 const value={status:'continue',question:'继续用灯',reason:'改罩要等六小时',delay_hours:6,next_step:{kind:'activity',id:'waylight-use'},wait_for:{kind:'activity',id:'waylight-use'}};
 assert.throws(()=>cognitiveResultFollowup(life,value,context,at,'task:shade','continue'),{code:'followup_condition_already_ready'});
 const next=cognitiveResultFollowup(life,{...value,wait_for:null,reason:'我想先休息，稍后再试',delay_hours:1},context,at,'task:shade','continue');
 assert.equal(next.wait_for,null);assert.equal(next.next_step.id,'waylight-use');
});
test('a completed step can be acknowledged and followed by a different criterion in the same inquiry',()=>{
 const {life,at,context}=completedShade(),id=context.current.followup_id;
 const choice={followup_id:id,followup_decision:'continue',completion_target_id:'activity:waylight-use',step_review:{target_id:'activity:waylight-fit-shade',evidence_ids:['task:shade'],reason:'装罩已做完，还想实际试用'}};
 prepareCognitiveFollowup(life,choice,context,at);
 assert.equal(life.followup.from_root_outcome_id,'task:fixture-built-lamp');assert.equal(life.followup.status,'continue');
 assert.equal(life.followup.completion_target.id,'activity:waylight-use');
 assert.deepEqual(life.followup.completed_steps[0].evidence_ids,['task:shade']);
 const waiting=cognitiveWaitFollowup(life,{followup_decision:'postpone',next_step:null,wait_for:null,reason:'先休息'},context,at);
 assert.equal(waiting.completed_steps.length,1);
});
test('step acknowledgement cannot cite a wrong result, change an unfinished target or be invented by compiler',()=>{
 const {life,at,context}=completedShade();const before=JSON.stringify(life);
 const choice={followup_decision:'continue',completion_target_id:null,step_review:{target_id:'activity:waylight-fit-shade',evidence_ids:['task:unrelated'],reason:'看起来完成'}};
 assert.throws(()=>prepareCognitiveFollowup(life,choice,context,at),{code:'followup_step_review_invalid'});assert.equal(JSON.stringify(life),before);
 assert.throws(()=>validateDecisionIssue({decision_issue:{...choice,step_review:null},compiled:choice}),{code:'decision_issue_changed_by_compiler'});
 assert.throws(()=>prepareCognitiveFollowup(life,{...choice,step_review:{...choice.step_review,evidence_ids:['task:shade']},completion_target_id:'activity:waylight-fit-shade'},context,at),{code:'followup_step_rebind_completed'});
});
test('already-held output satisfies a finite reserve, but an actually accepted larger delivery may justify production',()=>{
 const context={use_context:{contract:'finite-use-v1',capacity:24,production:[{activity_id:'collect-water',already_held:4,reserve_limit:4,uses:[],accepted_outgoing:[{commitment_id:'accepted',count:8}]}]}};
 const value={operation:'activity',activity_id:'collect-water',production_use:{activity_id:'collect-water',kind:'reserve',target_stock:4,reference_id:null,reason:'留一份备用'}};
 assert.throws(()=>validateProductionUse(value,context),{code:'production_use_invalid'});
 assert.throws(()=>validateProductionUse({...value,production_use:{...value.production_use,target_stock:8}},context),{code:'production_use_invalid'});
 validateProductionUse({...value,production_use:{...value.production_use,kind:'accepted_delivery',target_stock:8,reference_id:'accepted'}},context);
 assert.throws(()=>validateProductionUse({...value,production_use:{...value.production_use,kind:'accepted_delivery',target_stock:8,reference_id:'unanswered'}},context),{code:'production_use_invalid'});
});
test('compiler cannot disguise another activity or silently increase a declared reserve',()=>{
 const context={use_context:{contract:'finite-use-v1',capacity:24,production:[{activity_id:'collect-water',already_held:0}]}};
 const use={activity_id:'collect-water',kind:'reserve',target_stock:4,reference_id:null,reason:'以后照料时备用'};
 const proposal={decision_method:'collect-water',decision_production:use,compiled:{operation:'activity',activity_id:'collect-water',production_use:use}};
 validateDecisionMethod(proposal,context);
 assert.throws(()=>validateDecisionMethod({...proposal,compiled:{...proposal.compiled,activity_id:'waylight-use'}},context),{code:'decision_method_changed_by_compiler'});
 assert.throws(()=>validateDecisionMethod({...proposal,compiled:{...proposal.compiled,production_use:{...use,target_stock:8}}},context),{code:'decision_production_changed_by_compiler'});
});
test('memory frame keeps every delivered paragraph and distinguishes a failed delivery from an intention',()=>{
 const message={receiver_names:['灯穗'],text:'你好\n装罩步骤已经完成。\n我想晚点再看一次。'};
 const result={success:true,root_outcome_id:'task:m',occurred_at:'2026-10-23T11:00:00Z',effects:{verified_title:'递送留言',message_delivery:{delivered:true}}};
 const frame=cognitiveMemoryFrame(result,{cognitive_message:message});
 assert.ok(frame.facts[1].text.includes(message.text));assert.ok(frame.facts[1].text.includes('不代表对方同意'));
 const failed=cognitiveMemoryFrame({...result,success:false,effects:{...result.effects,message_delivery:{delivered:false}}},{cognitive_message:message});
 assert.equal(failed.facts[1].text,'消息没有送达；原打算不能记作已传达。');
});

test('an experiment cannot repeatedly produce using an already-proven criterion before acknowledging it',()=>{
 const use={activity_id:'waylight-use',already_held:4,accepted_outgoing:[],uses:[]};
 const c={use_context:{contract:'finite-use-v1',capacity:24,production:[use]},continuation:{current:{followup_id:'q',completion_target:{id:'activity:waylight-use'},resolution_evidence_ids:['task:used']},deferred:[]}};
 const v={operation:'activity',activity_id:'waylight-use',followup_decision:'continue',followup_id:'q',completion_target_id:'activity:waylight-use',production_use:{activity_id:'waylight-use',kind:'experiment',target_stock:8,reference_id:'q',reason:'再做一遍'}};
 assert.throws(()=>validateProductionUse(v,c),{code:'production_use_invalid'});
 c.continuation.current.resolution_evidence_ids=[];validateProductionUse(v,c);
});
