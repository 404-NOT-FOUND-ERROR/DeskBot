import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture,cases,OWNER,settle,tick,plus} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveActualResult,cognitiveRelevantKey} from '../src/cognitive-life-state.mjs';
import {validateOpportunityTransition,opportunityBinding} from '../src/cognitive-opportunities.mjs';
import {prepareGoalBindings} from '../src/cognitive-goal-opportunities.mjs';
import {cognitiveResultFollowup,cognitiveWaitFollowup,prepareCognitiveFollowup} from '../src/cognitive-continuation.mjs';
import {pendingContactPurpose,rememberContactPurpose,captureContactResponses} from '../src/cognitive-contact-purpose.mjs';
import {startActivityTask} from '../src/realtime-world.mjs';
import {createCognitionBridge,findCognitionPython} from '../src/cognition-bridge.mjs';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
const seed=()=>fixture(cases.find(c=>c.id==='resources-1-off'));
const context=w=>cognitiveContext(w,OWNER,w.clock.synced_at);
const ref=e=>({kind:'opportunity',id:e.id});
const next=step=>({status:'postpone',question:'以后再看看',reason:'保留真实条件',delay_hours:1,next_step:step,wait_for:null});
const byActivity=(c,id)=>c.opportunities.entries.filter(e=>e.binding.activity_id===id);

test('choice and future step share finite uses; enough stock cannot return via activity aliases or goal prose',()=>{
 const w=seed(),initial=context(w),water=byActivity(initial,'collect-water')[0];
 assert.ok(water);assert.ok(initial.choice_catalogue.choices.some(c=>c.id===water.id));
 w.living.inventories[OWNER].stock.water=4;
 const c=context(w),before=JSON.stringify(w);
 assert.equal(byActivity(c,'collect-water').length,0);
 for(const step of [ref(water),{kind:'activity',id:'collect-water'}]){
  assert.throws(()=>validateOpportunityTransition(next(step),c.continuation),{code:'followup_opportunity_unavailable'});
  assert.throws(()=>cognitiveResultFollowup(w.cognition.actors[OWNER],next(step),c.continuation,w.clock.synced_at,'task:own','continue'));
 }
 const open={state:{short_term_goal_entities:[{id:'dream',text:'以后让水岸更明亮',status:'active'}]}};
 assert.deepEqual(prepareGoalBindings(w.cognition.actors[OWNER],open,c,{continuation:c.continuation},w.clock.synced_at),{});
 assert.equal(JSON.stringify(w),before);
});

test('a blocked opportunity can be awaited, but ready and already-observed conditions cannot renew the wait',()=>{
 const w=seed();w.living.objects['floating-frame'].stock.raw_water=0;
 let c=context(w),e=byActivity(c,'collect-water')[0];assert.equal(e.status,'blocked');
 const v={...next(ref(e)),wait_for:ref(e)};validateOpportunityTransition(v,c.continuation);
 w.living.objects['floating-frame'].stock.raw_water=4;c=context(w);
 assert.equal(byActivity(c,'collect-water')[0].id,e.id);
 assert.throws(()=>validateOpportunityTransition(v,c.continuation),{code:'followup_condition_already_ready'});
 validateOpportunityTransition(next(ref(e)),c.continuation);
 const sample=byActivity(c,'measure-bank-light')[0];
 startActivityTask(w,{actor_id:OWNER,activity_id:'measure-bank-light',task_id:'measured'},{eventId:'measure',at:w.clock.synced_at});
 settle(w,w.tasks.find(t=>t.task_id==='measured'));c=context(w);
 assert.equal(byActivity(c,'measure-bank-light').length,0);
 assert.throws(()=>validateOpportunityTransition(next(ref(sample)),c.continuation),{code:'followup_opportunity_unavailable'});
 assert.ok(c.choice_catalogue.choices.some(e=>e.binding.operation==='observe'));
});

test('a changed method preserves the issue and wakes review without silently rebinding its future step',()=>{
 const w=seed(),c=context(w),e=byActivity(c,'measure-bank-light')[0],life=w.cognition.actors[OWNER];
 life.followup={...life.followup,followup_id:c.continuation.current.followup_id,next_step:ref(e),
  next_binding:opportunityBinding(ref(e),c.continuation)};
 w.living.objects['floating-frame'].waylight.mode='hooded';
 const before=JSON.stringify(w),changed=context(w);
 assert.equal(changed.continuation.current.current_conditions.next_status,'review_required');
 assert.ok(changed.continuation.urgent_review);
 assert.equal(changed.continuation.current.followup_id,c.continuation.current.followup_id);
 assert.throws(()=>validateOpportunityTransition(next(ref(e)),changed.continuation,c.continuation));
 assert.equal(JSON.stringify(w),before);
});

test('reply deadlines apply in feedback and do not slide by rephrasing or deferring a question',()=>{
 const w=seed(),life=w.cognition.actors[OWNER],at=w.clock.synced_at;
 rememberContactPurpose(life,{message_id:'sent:question',at,receiver_ids:['lamp-keeper-001'],text:'请教',contact_purpose:{key:'advice',signature:'same'}});
 life.followup={...life.followup,followup_id:'kept',wait_for:{kind:'reply',id:'sent:question'},next_step:{kind:'reply',id:'sent:question'},wait_started_at:at};
 tick(w,plus(at,361));const c=context(w);
 assert.equal(c.continuation.current.condition,'review_required');
 assert.throws(()=>cognitiveResultFollowup(life,{...next(life.followup.next_step),wait_for:life.followup.wait_for},c.continuation,w.clock.synced_at,'task:other','continue'),{code:'followup_wait_needs_reconsideration'});
 const revised=cognitiveResultFollowup(life,next(null),c.continuation,w.clock.synced_at,'task:other','continue');
 assert.equal(revised.followup_id,'kept');assert.equal(revised.wait_for,null);
 const old=structuredClone(life.followup);life.deferred_followups=[old];life.followup=null;
 const parked=context(w),deferred=parked.continuation.deferred[0];
 assert.equal(deferred.condition,'review_required');assert.equal(deferred.waiting_since,at);
 const resume={...next(old.next_step),followup_id:'kept',wait_for:old.wait_for};
 assert.throws(()=>validateOpportunityTransition(resume,parked.continuation),{code:'followup_wait_needs_reconsideration'});
 // A real late answer is ready; expiry alone is never an answer.
 life.inbox=[{message_id:'late:answer',sender_id:'lamp-keeper-001',reply_to:'message:question:lamp-keeper-001'}];captureContactResponses(w);
 assert.equal(context(w).continuation.deferred[0].condition,'ready');
});

test('purpose dedup also removes future contacts; real responses survive display history rotation',()=>{
 const w=seed();w.living.inventories[OWNER].stock.water=4;
 const c=context(w),row=c.opportunities.entries.find(e=>e.binding.contact_purpose?.key==='offer:water'&&e.binding.contact.kind==='message');
 const peer=c.capabilities.share.receivers[row.binding.receiver_indices[0]-1].actor_id;
 const life=w.cognition.actors[OWNER],sent={message_id:'sent:offered',at:w.clock.synced_at,receiver_ids:[peer],text:'实际提议',contact_purpose:row.binding.contact_purpose};
 rememberContactPurpose(life,sent);
 const pending=context(w);
 assert.ok(!pending.opportunities.entries.some(e=>e.binding.contact_purpose?.key==='offer:water'&&e.binding.receiver_indices[0]===row.binding.receiver_indices[0]));
 assert.throws(()=>validateOpportunityTransition(next(ref(row)),pending.continuation));
 life.deferred_followups=[{status:'postpone',followup_id:'deferred',question:'等回应',wait_for:{kind:'reply',id:sent.message_id}}];
 life.outbox=[];
 assert.ok(context(w).continuation.wait_options.some(o=>o.kind==='reply'&&o.id===sent.message_id));
 life.inbox=[{message_id:'received:answer',sender_id:peer,reply_to:`message:offered:${peer}`}];captureContactResponses(w);
 life.inbox=[];
 assert.equal(pendingContactPurpose(w,OWNER,peer,row.binding.contact_purpose),null);
 const answered=context(w).continuation.wait_options.find(o=>o.kind==='reply'&&o.id===sent.message_id);
 assert.equal(answered.available,true);assert.deepEqual(answered.reply_ids,['received:answer']);
});

test('Node and actual Python agree on current and future opportunities across blocked, satisfied, changed and expired cases',()=>{
 const w=seed(),c=context(w),sample=byActivity(c,'measure-bank-light')[0],rows=[];
 rows.push([next(ref(sample)),c,true]);rows.push([{...next(ref(sample)),wait_for:ref(sample)},c,false]);
 rows.push([next({kind:'opportunity',id:'invented'}),c,false]);
 w.living.objects['floating-frame'].stock.raw_water=0;
 const blocked=context(w),water=byActivity(blocked,'collect-water')[0];
 rows.push([{...next(ref(water)),wait_for:ref(water)},blocked,true]);
 rows.push([{...next(ref(sample)),wait_for:ref(water)},blocked,false]);
 w.living.inventories[OWNER].stock.water=4;const full=context(w);
 rows.push([next(ref(water)),full,false]);
 rows.push([{...next(ref(sample)),followup_id:'not-my-issue'},c,false]);
 const expired=structuredClone(c),waiting={kind:'reply',id:'sent:old'};
 expired.continuation.current=null;expired.continuation.deferred=[{followup_id:'parked',condition:'review_required',wait_for:waiting}];
 expired.continuation.next_options.push({...waiting,available:false});
 rows.push([{...next(waiting),followup_id:'parked',wait_for:waiting},expired,false]);
 const observed=rows.map(([v,c])=>{try{validateOpportunityTransition(v,c.continuation);return true;}catch{return false;}});
 assert.deepEqual(observed,rows.map(r=>r[2]));
 const py=spawnSync(findCognitionPython(),['-c','import json,sys; from opportunity_contract import opportunity_errors; print(json.dumps([not opportunity_errors(v,c) for v,c in json.load(sys.stdin)]))'],
  {cwd:fileURLToPath(new URL('../../../services/deskbot-cognition/',import.meta.url)),input:JSON.stringify(rows.map(r=>r.slice(0,2))),encoding:'utf8',windowsHide:true});
 assert.equal(py.status,0,py.stderr);assert.deepEqual(JSON.parse(py.stdout),observed);
});

test('switching attention preserves an unresolved condition and restores it by identity',()=>{
 const w=seed(),life=w.cognition.actors[OWNER],c=context(w),e=byActivity(c,'measure-bank-light')[0];
 life.followup={...life.followup,followup_id:c.continuation.current.followup_id,next_step:ref(e),next_binding:opportunityBinding(ref(e),c.continuation)};
 const original=structuredClone(life.followup);
 prepareCognitiveFollowup(life,{operation:'rest',followup_decision:'new',followup_id:null},context(w).continuation,w.clock.synced_at);
 assert.equal(life.followup,null);assert.equal(life.deferred_followups[0].followup_id,original.followup_id);
 prepareCognitiveFollowup(life,{followup_decision:'continue',followup_id:original.followup_id},context(w).continuation,w.clock.synced_at);
 assert.deepEqual(life.followup.next_binding,original.next_binding);assert.equal(life.deferred_followups.length,0);
});

test('a goal cannot be rebound or completed by unexecuted feedback, another method or a cancelled attempt',()=>{
 const w=seed(),c=context(w),row=byActivity(c,'measure-bank-light')[0],life=w.cognition.actors[OWNER];
 const goal={id:'goal:one',text:'留下这次实际测记',status:'active'};
 const proposal={state:{short_term_goal_entities:[goal]},goal_bindings:[{goal_id:goal.id,text:goal.text,next_step:ref(row),followup_id:null}]};
 const unknown=structuredClone(proposal);unknown.goal_bindings[0].followup_id='invented-issue';
 assert.throws(()=>prepareGoalBindings(life,unknown,c,{continuation:c.continuation},w.clock.synced_at),{code:'followup_issue_unknown'});
 life.goal_bindings=prepareGoalBindings(life,proposal,c,{continuation:c.continuation},w.clock.synced_at);
 const completed={state:{short_term_goal_entities:[{...goal,status:'completed'}]}};
 assert.throws(()=>prepareGoalBindings(life,completed,context(w),{continuation:c.continuation},w.clock.synced_at),{code:'goal_completion_without_result'});
 assert.throws(()=>prepareGoalBindings(life,proposal,{...c,phase:'feedback'},{continuation:c.continuation},w.clock.synced_at),{code:'goal_opportunity_requires_plan'});
 const changed=structuredClone(proposal);changed.goal_bindings[0].next_step=ref(c.opportunities.entries.find(e=>e.binding.operation==='rest'));
 assert.throws(()=>prepareGoalBindings(life,changed,c,{continuation:c.continuation},w.clock.synced_at),{code:'goal_opportunity_rebind'});
 w.tasks.push({task_id:'other',actor_id:OWNER,status:'completed',started_at:w.clock.synced_at,opportunity_binding:{identity:'another'},completion:{result:{success:true}}},
  {task_id:'status-only',actor_id:OWNER,status:'completed',started_at:w.clock.synced_at,opportunity_binding:{identity:row.identity}},
  {task_id:'failed-result',actor_id:OWNER,status:'completed',started_at:w.clock.synced_at,opportunity_binding:{identity:row.identity},cognitive_observation:{at:w.clock.synced_at},completion:{effect:'no_effect',result:{success:false}}},
  {task_id:'cancelled',actor_id:OWNER,status:'cancelled',started_at:w.clock.synced_at,opportunity_binding:{identity:row.identity}});
 assert.equal(context(w).goal_opportunities.goals[0].evidence_ids.length,0);
 assert.throws(()=>prepareGoalBindings(life,completed,context(w),{continuation:c.continuation},w.clock.synced_at),{code:'goal_completion_without_result'});
});

test('full Python need generation, choice, Node execution, feedback and SQLite restart keep one actual goal step',async t=>{
 const w=seed(),bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:30});t.after(()=>bridge.close());
 let chosen;const stages=[];
 const respond=async req=>{
  if(req.json_mode)assert.ok(req.messages.some(m=>/json/i.test(m.content)),'JSON mode requires an explicit JSON instruction before provider admission');
  stages.push(req.stage);let v;
  if(req.stage==='perception')v={reason:'看实际灯况',emotion:'anticipation',intensity:.3,valence:.3,need_activation:{self_actualization:.4}};
  else if(req.stage==='motivation'){
   const view=JSON.parse(req.messages.at(-1).content);chosen=view.options.find(o=>o.title==='在水岸测记归途灯的明暗');assert.ok(chosen);
   v={goals:[{text:'实际完成这次水岸测记',due_in_hours:null,next_step:ref(chosen),followup_id:null}]};
  }else if(req.stage==='decision')v={act:true,choice_id:chosen.id,inner_monologue:'我想留下真实明暗记录，再决定后面往哪里走',expected_outcome:'一次实际测记',issue:{decision:'continue',id:'current'},motivation:'self_exploration',source_ids:[]};
  else if(req.stage==='feedback')v=req.scene==='need_goal_generation'?{goals:[],residue:[]}:{reason:'这次实际记录了',emotion:'joy',intensity:.4,valence:.4};
  else if(req.stage==='memory'&&req.scene==='memory_importance')v={score:.8,reason:'实际记录'};
  else if(req.stage==='memory'&&req.scene==='memory_summarization'){
   const view=JSON.parse(req.messages.at(-1).content);v={focus_id:view.facts[0].id,feeling:'curious',wish:'understand'};
  }else if(req.stage==='followup')v=next(null);
  else throw Error(req.stage+'/'+req.scene);
  return JSON.stringify(v);
 };
 let goalId;
 for(const phase of ['plan','feedback']){
  const at=w.clock.synced_at,job='opportunity-'+phase;
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase,job_id:job},at,job);
  const c=cognitiveContext(w,OWNER,at,phase);c.mode='mock';
  if(phase==='feedback'){c.result=cognitiveActualResult(w,OWNER,at);c.action=w.cognition.actors[OWNER].pending.action;}
  const p=await bridge.session(c,respond);
  if(phase==='plan'){
   assert.equal(p.goal_bindings.length,1);goalId=p.goal_bindings[0].goal_id;
   const fake=structuredClone(p);fake.state.short_term_goal_entities.find(g=>g.id===goalId).status='completed';
   assert.throws(()=>prepareGoalBindings(w.cognition.actors[OWNER],fake,c,w.cognition.actors[OWNER].job.references,at));
  }
  applyCognitiveMutation(w,{actor_id:OWNER,operation:phase,job_id:job,proposal:p,relevant_key:cognitiveRelevantKey(w,OWNER),...(phase==='feedback'?{result:c.result}:{})},at,job+':adopt');
  if(phase==='plan'){
   const task=w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id);settle(w,task);
   assert.equal(task.status,'completed');assert.ok(task.opportunity_binding);
  }
 }
 assert.equal(stages.filter(s=>s==='motivation').length,1);assert.equal(stages.filter(s=>s.includes('repair')||s.startsWith('compile')).length,0);
 const proof=context(w).goal_opportunities.goals.find(g=>g.goal_id===goalId);assert.equal(proof.status,'achieved');assert.equal(proof.evidence_ids.length,1);
 w.tasks=[];assert.equal(context(w).goal_opportunities.goals[0].status,'achieved');
 const dir=mkdtempSync(join(tmpdir(),'deskbot-opportunities-')),filename=join(dir,'world.sqlite');
 let persistence=createSqlitePersistence({filename});t.after(()=>{persistence.close();rmSync(dir,{recursive:true,force:true});});
 w.world_id='deskbot-small-world';persistence.put('canonical-world.states',w.world_id,w);persistence.close();
 persistence=createSqlitePersistence({filename});const api=createPersistentWorld({persistence,timeMode:'realtime',now:()=>new Date(w.clock.synced_at)});
 assert.deepEqual(context(api.get()).goal_opportunities.goals[0].evidence_ids,proof.evidence_ids);
});
