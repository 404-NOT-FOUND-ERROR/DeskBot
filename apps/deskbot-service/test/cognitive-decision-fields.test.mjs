import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fixture,cases,settle,OWNER} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {createCognitionBridge} from '../src/cognition-bridge.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation} from '../src/cognitive-life-state.mjs';
import {cognitiveCause} from '../src/cognitive-continuity.mjs';
import {cognitiveFailure} from '../src/cognitive-failure.mjs';

const fields=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-decision-fields.v1.json',import.meta.url),'utf8'));
const recorded=JSON.parse(readFileSync(new URL('../../../services/deskbot-cognition/evaluations/fixtures/r3a-motivation-boundary-20261028.json',import.meta.url),'utf8'));

test('Node adoption enforces the same motivation boundary before changing the world',()=>{
 const w=fixture(cases.find(c=>c.id===recorded.case_id)),before=structuredClone(w);
 const refs={sources:[],social:{},development:{opportunity:{free:true}}};
 for(const motivation of ['self_actualization','social','',[],{}])assert.throws(
  ()=>cognitiveCause(w,OWNER,{motivation,source_ids:[]},refs,{}),error=>{
   assert.equal(error.code,fields.motivation.invalid_code);
   assert.equal(cognitiveFailure(error.code).layer,'contract');return true;
  });
 // All supported categories survive parsing; causal evidence checks can still
 // downgrade unsupported claims. A valid label never grants interest by itself.
 for(const motivation of fields.motivation.allowed)assert.doesNotThrow(
  ()=>cognitiveCause(w,OWNER,{motivation,source_ids:[]},refs,{job:{id:'boundary-test'}}));
 assert.deepEqual(w,before);
});

for(const corrected of [false,true])test(corrected?
 'synthetic correction after recorded failure binds the same choice without a compiler or hidden rewrite':
 'recorded invalid motivation and repeated repair stop before action or memory with an exact contract error',async t=>{
 const w=fixture(cases.find(c=>c.id===recorded.case_id)),at=w.clock.synced_at,job='motivation-boundary';
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:job},at,job+':claim');
 const before=structuredClone(w),context=cognitiveContext(w,OWNER,at,'plan');context.mode='mock';
 const raw=JSON.parse(recorded.calls.find(c=>c.stage==='decision').content);
 const selected=context.choice_catalogue.choices.find(c=>c.id===raw.choice_id);
 assert.equal(selected.binding.activity_id,'waylight-fit-shade');
 const bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:10});t.after(()=>bridge.close());
 const requests=[];
 const session=bridge.session(context,async request=>{
  requests.push(request.stage);
  const original=recorded.calls.find(c=>c.stage===request.stage);
  assert.ok(original,'no extra stage or unbounded retry');
  assert.equal(createHash('sha256').update(original.content).digest('hex'),original.sha256);
  if(request.stage==='decision_repair'){
   const prompt=request.messages.at(-1).content;
   assert.ok(prompt.includes('motivation 收到非法值 "self_actualization"'));
   assert.ok(prompt.includes(fields.motivation.allowed.join('|')));
   assert.ok(prompt.includes(fields.motivation.boundary));
   if(corrected)return JSON.stringify({...JSON.parse(original.content),motivation:'self_continuation'});
  }
  return original.content;
 });
 if(!corrected){
  await assert.rejects(session,error=>{
   assert.equal(error.code,'python_session_failed');
   assert.equal(error.failure.cause_code,fields.motivation.invalid_code);
   assert.equal(error.failure.layer,'contract');
   assert.equal(error.failure.stage,'decision_repair');
   assert.equal(error.failure.record_as_experience,false);return true;
  });
  assert.deepEqual(w,before,'rejected model output creates no action, personal memory or world effects');
 }else{
  const proposal=await session;
  assert.deepEqual(w,before,'a successful proposal alone has no world effects');
  assert.equal(proposal.compiled.activity_id,selected.binding.activity_id);
  assert.equal(proposal.compiled.motivation,'self_continuation');
  assert.equal(proposal.compiled.reason,raw.inner_monologue);
  assert.equal(proposal.choice_binding.actor_payload.choice_id,raw.choice_id);
  assert.equal(proposal.choice_binding.model_compile_calls,0);
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'plan',phase:'plan',job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,OWNER)},at,job+':adopt');
  const task=w.tasks.find(task=>task.task_id===w.cognition.actors[OWNER].pending.task_id);
  assert.equal(task.activity_id,selected.binding.activity_id);settle(w,task);assert.equal(task.status,'completed');
 }
 assert.deepEqual(requests,['perception','motivation','decision','decision_repair']);
 assert.equal(JSON.parse(recorded.calls.find(c=>c.stage==='decision_repair').content).motivation,'self_actualization');
});
