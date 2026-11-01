import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {fixture,cases,OWNER,settle,tick,plus} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveRelevantKey,cognitiveActualResult,settleCognitiveTask} from '../src/cognitive-life-state.mjs';
import {freezeCognitiveReferences} from '../src/cognitive-continuity.mjs';
import {GOAL_LIFECYCLE,prepareGoalLifecycle,migrateGoalBindings} from '../src/cognitive-goal-lifecycle.mjs';
import {prepareGoalBindings} from '../src/cognitive-goal-opportunities.mjs';
import {startActivityTask} from '../src/realtime-world.mjs';
import {createCognitionBridge,findCognitionPython} from '../src/cognition-bridge.mjs';
import {createSqlitePersistence} from '../src/persistence.mjs';
const seed=()=>fixture(cases.find(c=>c.id==='resources-1-off'));
const context=(w,phase='plan')=>cognitiveContext(w,OWNER,w.clock.synced_at,phase);
const ref=e=>({kind:'opportunity',id:e.id});
const method=(c,id)=>c.opportunities.entries.find(e=>e.binding.activity_id===id&&(!e.binding.production_use||e.binding.production_use.kind==='reserve'));
function declaration(c,activity='collect-water',id='goal:water'){
 const m=method(c,activity),criterion=c.goal_lifecycle.criteria.find(k=>k.opportunity_ids.includes(m.id));
 return {goal_id:id,operation:'new',text:activity==='collect-water'?'备好一批自用清水':'留下当前罩片的实际测记',criterion_id:criterion.id,next_step:ref(m),reason:'这是我现在想做的具体一步',review_in_hours:8};
}
function proposal(w,updates){
 const goals=structuredClone(w.cognition.actors[OWNER].state.short_term_goal_entities??[]);
 for(const u of updates){
  let g=goals.find(g=>g.id===u.goal_id);
  if(u.operation==='new'){g={id:u.goal_id,text:u.text,status:'active',goal_type:'short_term',created_step:0,due_step:null};goals.push(g);}
  if(g)g.status={postpone:'interrupted',resume:'active',complete:'completed',abandon:'failed'}[u.operation]??g.status;
 }
 return {goal_contract:GOAL_LIFECYCLE.schema,goal_updates:updates,state:{short_term_goal_entities:goals}};
}
function adopt(w,updates){
 const c=context(w),p=proposal(w,updates),life=w.cognition.actors[OWNER];
 const bindings=prepareGoalBindings(life,p,c,freezeCognitiveReferences(c),w.clock.synced_at);
 life.goal_bindings=bindings;life.state=p.state;return bindings;
}
function execute(w,activity,taskId='goal-water-result'){
 const c=context(w),e=method(c,activity);
 startActivityTask(w,{actor_id:OWNER,activity_id:activity,task_id:taskId},{eventId:taskId,at:w.clock.synced_at});
 const task=w.tasks.find(t=>t.task_id===taskId);task.origin='cognitive_life';task.cognitive_operation='activity';task.root_outcome_id=`task:${taskId}`;
 task.opportunity_binding={id:e.id,identity:e.identity,production_use:e.binding.production_use};
 settle(w,task);return task;
}

test('one stable goal changes water method, records only actual output and survives SQLite restart without reexecution',t=>{
 let w=seed();const first=declaration(context(w));adopt(w,[first]);
 const original=structuredClone(w.cognition.actors[OWNER].goal_bindings[first.goal_id]);
 adopt(w,[{goal_id:first.goal_id,operation:'replan',next_step:ref(method(context(w),'waylight-use')),reason:'想实际借灯净滤同一批自用水'}]);
 const changed=w.cognition.actors[OWNER].goal_bindings[first.goal_id];
 assert.deepEqual(changed.completion_criteria,original.completion_criteria);assert.equal(changed.attempts.length,2);
 assert.equal(context(w).goal_lifecycle.goals[0].completion_status,'pending');
 const task=execute(w,'waylight-use');assert.equal(task.status,'completed');
 assert.deepEqual(context(w).goal_lifecycle.goals[0].evidence_ids,[task.root_outcome_id]);
 const stock=structuredClone(w.living.inventories[OWNER]);
 const dir=mkdtempSync(join(tmpdir(),'deskbot-goal-lifecycle-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const filename=join(dir,'world.sqlite');let db=createSqlitePersistence({filename});db.put('canonical-world.states',w.world_id,w);db.close();
 db=createSqlitePersistence({filename});w=db.get('canonical-world.states',w.world_id);db.close();
 settleCognitiveTask(w,w.tasks.find(t=>t.task_id===task.task_id),w.clock.synced_at);
 adopt(w,[{goal_id:first.goal_id,operation:'complete',reason:'对应方法实际产出了这一批水'}]);
 assert.deepEqual(w.living.inventories[OWNER],stock);assert.equal(w.tasks.filter(t=>t.task_id===task.task_id).length,1);
 const complete=structuredClone(w.cognition.actors[OWNER].goal_bindings[first.goal_id]);w.tasks=[];
 assert.deepEqual(context(w).goal_lifecycle.goals[0].evidence_ids,complete.evidence_ids);
 assert.equal(complete.lifecycle_status,'completed');
});

test('overnight review does not fail, slide a clock, change an agreed deadline or lose the goal',()=>{
 const w=seed(),d=declaration(context(w));adopt(w,[d]);
 adopt(w,[{goal_id:d.goal_id,operation:'postpone',review_in_hours:12,reason:'先休息，明天复查'}]);
 const initial=structuredClone(w.cognition.actors[OWNER].goal_bindings[d.goal_id]),at=w.clock.synced_at;
 tick(w,plus(at,13*60));const before=JSON.stringify(w),c=context(w);
 assert.equal(c.goal_lifecycle.goals[0].review_due,true);assert.equal(c.goal_lifecycle.goals[0].lifecycle_status,'postponed');
 assert.equal(c.goal_lifecycle.goals[0].next_review_at,initial.next_review_at);assert.equal(JSON.stringify(w),before);
 adopt(w,[{goal_id:d.goal_id,operation:'resume',reason:'休息后重新看同一件事'}]);
 assert.equal(w.cognition.actors[OWNER].goal_bindings[d.goal_id].lifecycle_status,'active');
 const forged=proposal(w,[]);forged.state.short_term_goal_entities[0].due_step=99;
 assert.throws(()=>prepareGoalBindings(w.cognition.actors[OWNER],forged,context(w),freezeCognitiveReferences(context(w)),w.clock.synced_at),{code:'goal_deadline_immutable'});
});

test('same method under changed experiment conditions is not interchangeable; open inquiry stays open',()=>{
 const w=seed(),c=context(w),d=declaration(c,'measure-bank-light','goal:measure');adopt(w,[d]);
 const before=structuredClone(w.cognition.actors[OWNER]);w.living.objects['floating-frame'].waylight.mode='hooded';
 const changed=context(w),u={goal_id:d.goal_id,operation:'replan',next_step:ref(method(changed,'measure-bank-light')),reason:'尝试改成另一种罩片'};
 assert.throws(()=>adopt(w,[u]),{code:'goal_method_not_compatible'});assert.deepEqual(w.cognition.actors[OWNER],before);
 adopt(w,[{operation:'new',goal_id:'goal:open',text:'了解水岸的长期规律',criterion_id:null,next_step:null,reason:'这是一个开放问题'}]);
 execute(w,'measure-bank-light','different-condition');
 assert.equal(context(w).goal_lifecycle.goals.find(g=>g.goal_id===d.goal_id).evidence_ids.length,0);
 assert.throws(()=>adopt(w,[{operation:'complete',goal_id:'goal:open',reason:'一次测记已经成功'}]),{code:'goal_completion_without_result'});
 adopt(w,[{operation:'abandon',goal_id:'goal:open',reason:'暂时不再研究这个大问题'}]);
 assert.equal(w.cognition.actors[OWNER].goal_bindings['goal:open'].lifecycle_status,'abandoned');
});

test('near-identical text does not merge distinct criteria; same criterion must reuse its goal ID',()=>{
 const w=seed(),c=context(w),d=declaration(c);adopt(w,[d]);
 const duplicate={...d,goal_id:'goal:duplicate',text:'为自己备一点清水'};
 assert.throws(()=>adopt(w,[duplicate]),{code:'goal_duplicate_use_existing_id'});
 const other=declaration(context(w),'measure-bank-light','goal:second');other.text=d.text+'并测记灯光';adopt(w,[other]);
 assert.equal(Object.keys(w.cognition.actors[OWNER].goal_bindings).length,2);
 const missing=proposal(w,[]);missing.state.short_term_goal_entities.shift();
 assert.throws(()=>prepareGoalBindings(w.cognition.actors[OWNER],missing,context(w),freezeCognitiveReferences(context(w)),w.clock.synced_at),{code:'goal_identity_missing'});
 assert.throws(()=>prepareGoalBindings(w.cognition.actors[OWNER],{state:missing.state},context(w),{},w.clock.synced_at),{code:'goal_lifecycle_contract_required'});
});

test('historical goals keep IDs and exact bindings without retroactive evidence or fake failures',()=>{
 const w=seed(),life=w.cognition.actors[OWNER],c=context(w),e=method(c,'measure-bank-light');
 life.state.short_term_goal_entities=[{id:'old',text:'看看灯',status:'active',due_step:2},{id:'closed',text:'旧判断',status:'completed',due_step:null}];
 life.goal_bindings={old:{goal_id:'old',text:'看看灯',binding:{id:e.id,identity:e.identity},bound_at:c.at,evidence_ids:[]}};
 const before=JSON.stringify(life),m=migrateGoalBindings(life,c.at);
 assert.equal(m.old.completion_criteria.identity,e.identity);assert.equal(m.closed.lifecycle_status,'legacy_closed');
 assert.deepEqual(m.closed.evidence_ids,[]);assert.equal(JSON.stringify(life),before);
 adopt(w,[{goal_id:'old',operation:'postpone',reason:'到期先复查，没有证据说明它失败了'}]);
 assert.equal(life.state.short_term_goal_entities[0].due_step,2);
});

test('Node and Python reject the same lifecycle transitions before any state is written',()=>{
 const w=seed(),d=declaration(context(w));adopt(w,[d]);const c=context(w),rows=[
  [{goal_id:d.goal_id,operation:'postpone',review_in_hours:12,reason:'休息后再来'},true],
  [{goal_id:d.goal_id,operation:'replan',next_step:ref(method(c,'waylight-use')),reason:'改用另一个真实方法'},true],
  [{goal_id:d.goal_id,operation:'complete',reason:'我感觉完成了'},false],
  [{goal_id:d.goal_id,operation:'resume',reason:'没有暂缓却恢复'},false],
  [{goal_id:d.goal_id,operation:'continue',review_in_hours:true,reason:'不合法时钟'},false],
  [{goal_id:d.goal_id,operation:'continue',text:'偷偷换目标',reason:'改写'},false],
  [{goal_id:d.goal_id,operation:'replan',next_step:ref(method(c,'measure-bank-light')),reason:'把取水换成测记'},false],
  [{goal_id:d.goal_id,operation:'abandon',reason:'明确放下'},true],
 ];
 for(const [u,ok] of rows){const before=JSON.stringify(w);if(ok)prepareGoalLifecycle(w.cognition.actors[OWNER],proposal(w,[u]),c,freezeCognitiveReferences(c),c.at);else assert.throws(()=>prepareGoalLifecycle(w.cognition.actors[OWNER],proposal(w,[u]),c,freezeCognitiveReferences(c),c.at));assert.equal(JSON.stringify(w),before);}
 const py=spawnSync(findCognitionPython(),['-c',`import json,sys; import life_worker\nfrom goal_lifecycle import parse_updates\nfrom agent.goals import GoalEntity,GoalStatus\ndata=json.load(sys.stdin); output=[]\nfor u in data['updates']:\n try:\n  entities=[GoalEntity(**{**g,'status':GoalStatus(g['status'])}) for g in data['entities']]\n  parse_updates({'goal_updates':[u]},data['context'],entities,0); output.append(True)\n except ValueError: output.append(False)\nprint(json.dumps(output))`],
  {cwd:fileURLToPath(new URL('../../../services/deskbot-cognition/',import.meta.url)),input:JSON.stringify({updates:rows.map(r=>r[0]),context:c,entities:w.cognition.actors[OWNER].state.short_term_goal_entities}),encoding:'utf8',windowsHide:true});
 assert.equal(py.status,0,py.stderr);assert.deepEqual(JSON.parse(py.stdout),rows.map(r=>r[1]));
});

test('actual Python worker uses explicit ID lifecycle in existing plan and feedback calls',async t=>{
 const w=seed(),bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:30});t.after(()=>bridge.close());
 let chosen,goalId;const calls=[];
 const respond=async req=>{
  calls.push(req.stage);let value;
  if(req.stage==='perception')value={reason:'先看看',emotion:'anticipation',intensity:.3,valence:.3,need_activation:{self_actualization:.4}};
  else if(req.stage==='motivation'){
   const view=JSON.parse(req.messages.at(-1).content),criterion=view.goals.criteria.find(k=>k.kind==='water_reserve');
   chosen=view.next_options.find(o=>criterion.opportunity_ids.includes(o.id)&&o.title.includes('泉眼'));
   value={goal_updates:[{operation:'new',goal_id:null,text:'备好一批自用水',criterion_id:criterion.id,next_step:ref(chosen),reason:'现在有余力且背包缺水'}]};
  }else if(req.stage==='decision')value={act:true,choice_id:chosen.id,inner_monologue:'我想先备一批水',expected_outcome:'得到实际清水',issue:{decision:'continue',id:'current'},motivation:'self_exploration',source_ids:[]};
  else if(req.stage==='feedback')value=req.scene==='need_goal_generation'?{goal_updates:[{operation:'complete',goal_id:goalId,reason:'执行器记录了这批实际产出'}]}:{reason:'做成这一步',emotion:'joy',intensity:.3,valence:.3};
  else if(req.stage==='memory')value=req.scene==='memory_importance'?{score:.8,reason:'实际结果'}:{focus_id:JSON.parse(req.messages.at(-1).content).facts[0].id,feeling:'curious',wish:'understand'};
  else if(req.stage==='followup')value={status:'continue',question:'以后再看新的机会',reason:'这批取水已完成，大问题仍开放',delay_hours:1,next_step:null};
  else throw Error(req.stage);return JSON.stringify(value);
 };
 for(const phase of ['plan','feedback']){
  const at=w.clock.synced_at,job=`goal-lifecycle:${phase}`;
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase,job_id:job},at,job);
  const c=context(w,phase);c.mode='mock';
  if(phase==='feedback'){c.action=w.cognition.actors[OWNER].pending.action;c.result=cognitiveActualResult(w,OWNER,at);}
  const p=await bridge.session(c,respond);assert.equal(p.goal_contract,GOAL_LIFECYCLE.schema);
  if(phase==='plan')goalId=p.goal_updates[0].goal_id;
  applyCognitiveMutation(w,{actor_id:OWNER,operation:phase,job_id:job,proposal:p,relevant_key:cognitiveRelevantKey(w,OWNER),...(c.result?{result:c.result}:{})},at,job);
  if(phase==='plan')settle(w,w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id));
 }
 assert.equal(w.cognition.actors[OWNER].goal_bindings[goalId].lifecycle_status,'completed');
 assert.equal(calls.filter(c=>c==='motivation').length,1);assert.equal(calls.filter(c=>c.includes('repair')||c.startsWith('compile')).length,0);
});
