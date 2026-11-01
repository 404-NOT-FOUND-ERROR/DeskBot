import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixture,cases,settle,tick,OWNER} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {createCognitionBridge} from '../src/cognition-bridge.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,cognitiveActualResult} from '../src/cognitive-life-state.mjs';
import {cognitiveResultFollowup} from '../src/cognitive-continuation.mjs';
import {cognitiveFailure} from '../src/cognitive-failure.mjs';

const fields=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-followup-phases.v1.json',import.meta.url),'utf8'));
const recorded=JSON.parse(readFileSync(new URL('../../../services/deskbot-cognition/evaluations/fixtures/r3a-followup-phase-20261031.json',import.meta.url),'utf8'));

test('Node feedback rejects plan-only and unknown fields instead of silently preserving them',()=>{
 const w=fixture(cases.find(c=>c.id===recorded.case_id)),life=w.cognition.actors[OWNER],before=structuredClone(w);
 const context=cognitiveContext(w,OWNER,w.clock.synced_at,'feedback').continuation;
 const reply={status:'continue',question:'继续研究',reason:'一步完成',delay_hours:1,next_step:null};
 for(const key of [...fields.plan_only_fields,'unexpected'])for(const value of [null,{},'continue']){
  assert.throws(()=>cognitiveResultFollowup(life,{...reply,[key]:value},context,w.clock.synced_at,'task:done','continue'),error=>{
   assert.equal(error.code,fields.feedback.invalid_code);assert.equal(cognitiveFailure(error.code).layer,'contract');return true;
  });
 }
 assert.deepEqual(w,before);
});

test('recorded feedback failure preserves an executed task; an offline corrected feedback resumes without duplicate work',async t=>{
 const w=fixture(cases.find(c=>c.id===recorded.case_id)),bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:20});
 t.after(()=>bridge.close());
 const allUsed=[];
 async function phase(turn,phase,{corrected=false,resume=false}={}){
  const at=w.clock.synced_at,job=`r3:${recorded.version}:${recorded.case_id}:${turn}:${phase}`+(resume?':offline-resume':'');
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase,job_id:job},at,job+':claim');
  const context=cognitiveContext(w,OWNER,at,phase);context.mode='mock';
  // Replay this older contract's persisted references. It predates message
  // receipts; the new protocol and its original failure have a separate suite.
  delete context.event_evidence;delete w.cognition.actors[OWNER].job.references.event_evidence;
  delete context.goal_lifecycle;delete w.cognition.actors[OWNER].job.references.goal_lifecycle;
  for(const key of ['followup_intent','evidence_refs']){delete context[key];delete w.cognition.actors[OWNER].job.references[key];}
  if(phase==='feedback'){context.result=cognitiveActualResult(w,OWNER,at);context.action=w.cognition.actors[OWNER].pending.action;}
  const before=structuredClone(w),originals=recorded.calls.filter(c=>c.turn===turn&&c.phase===phase);let n=0;
  try{
   const proposal=await bridge.session(context,async request=>{
    const raw=originals[n++];assert.ok(raw,'no new model stage');assert.equal(request.stage,raw.stage);
    assert.equal(createHash('sha256').update(raw.content).digest('hex'),raw.sha256);allUsed.push(raw.id);
    if(request.stage==='followup'){
     const prompt=JSON.parse(request.messages.at(-1).content);
     assert.ok(prompt.issue_contract.includes('当前是结果反馈阶段'));
     assert.equal(prompt.continuation.completion_targets,undefined);
     assert.equal(prompt.continuation.step_contract,undefined);
    }
    if(request.stage==='followup_repair'){
     assert.ok(request.messages.at(-1).content.includes('请删除'));
     assert.ok(request.messages.at(-1).content.includes('不要补全'));
     if(corrected){
      // Explicit test-authored model correction, NOT a production sanitizer or
      // a claim that the provider successfully repaired the original response.
      const v=JSON.parse(raw.content);
      return JSON.stringify({status:v.status,question:v.question,reason:v.reason,delay_hours:v.delay_hours,
       next_step:v.next_step,followup_id:v.followup_id});
     }
    }
    return raw.content;
   });
   assert.equal(n,originals.length);
   assert.deepEqual(w,before,'Python proposal alone has no world mutation');
   const payload={actor_id:OWNER,operation:phase,phase,job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,OWNER),...(phase==='feedback'?{result:context.result}:{})};
   if(resume){
    // Prove the Node adopter enforces the phase even if a worker bypasses Python.
    const invalid=structuredClone(payload);invalid.proposal.followup.step_review=JSON.parse(originals.at(-1).content).step_review;
    assert.throws(()=>applyCognitiveMutation(w,invalid,at,job+':invalid'),{code:fields.feedback.invalid_code});
    assert.deepEqual(w,before,'rejected feedback cannot partially commit memory or goals');
   }
   applyCognitiveMutation(w,payload,at,job+':adopt');return {proposal,context};
  }catch(error){
   assert.deepEqual(w,before,'failed worker cannot change the completed task or adopt partial feedback');
   applyCognitiveMutation(w,{actor_id:OWNER,operation:'error',phase,job_id:job,error:error.code,failure:error.failure},at,job+':error');
   throw error;
  }
 }
 await phase(1,'perceive');
 for(let turn=1;turn<=3;turn++){
  await phase(turn,'plan');
  const task=w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id);settle(w,task);
  assert.equal(task.status,'completed');
  if(turn<3){await phase(turn,'feedback');tick(w,w.cognition.actors[OWNER].followup.next_review_at);}
 }
 const physical=structuredClone({tasks:w.tasks,stock:w.living.inventories[OWNER].stock,lamp:w.living.objects['floating-frame'].waylight});
 assert.equal(physical.lamp.has_hood,true);assert.equal(physical.stock.waylight_shade,0);
 const root=w.cognition.actors[OWNER].pending.root_outcome_id;
 await assert.rejects(phase(3,'feedback'),error=>{
  assert.equal(error.failure.cause_code,fields.feedback.invalid_code);assert.equal(error.failure.stage,'followup_repair');
  assert.equal(error.failure.record_as_experience,false);return true;
 });
 let life=w.cognition.actors[OWNER];
 assert.equal(life.pending.root_outcome_id,root);assert.equal(life.retry.retryable,false);
 assert.equal(life.memories.filter(m=>m.root_outcome_id===root).length,0);
 assert.throws(()=>applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:'cannot-rerun'},w.clock.synced_at,'cannot-rerun'),{code:'pending_result_requires_feedback'});
 const beforeSteps=structuredClone(life.followup.completed_steps??[]);
 const resumed=await phase(3,'feedback',{corrected:true,resume:true});life=w.cognition.actors[OWNER];
 assert.equal(life.pending,null);assert.equal(life.job.status,'completed');
 assert.equal(life.followup.followup_id,'task:fixture-built-lamp');
 assert.deepEqual(life.followup.completed_steps,beforeSteps,'feedback records an intention; next plan owns step archival');
 assert.equal(life.followup.completion_target.id,'activity:waylight-fit-shade');
 assert.equal(cognitiveContext(w,OWNER,w.clock.synced_at,'plan').continuation.current.current_conditions.target_status,'achieved');
 assert.deepEqual({tasks:w.tasks,stock:w.living.inventories[OWNER].stock,lamp:w.living.objects['floating-frame'].waylight},physical);
 assert.equal(life.memories.filter(m=>m.root_outcome_id===root&&m.payload.stream==='factual').length,1);
 assert.equal(life.memories.filter(m=>m.root_outcome_id===root&&m.payload.stream==='experiential'&&m.payload.kind==='event').length,1);
 assert.equal(resumed.proposal.followup.step_review,undefined);
 assert.equal(allUsed.length,recorded.calls.length+6,'one failed feedback plus one explicit offline resume; no action replay');
 assert.equal(JSON.parse(recorded.calls.at(-1).content).step_review.target_id,'activity:waylight-fit-shade','original response stays intact');
});
