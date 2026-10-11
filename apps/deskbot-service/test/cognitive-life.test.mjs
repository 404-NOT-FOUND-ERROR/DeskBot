import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {createCognitiveBudget} from '../src/cognitive-budget.mjs';
import {createCognitiveLife} from '../src/cognitive-life.mjs';
import {cognitiveContext,cognitiveActualResult,cognitiveRelevantKey,cognitiveDialogueContext} from '../src/cognitive-life-state.mjs';
import {advanceAutonomousLife} from '../src/autonomous-life.mjs';
import {createCognitiveRuntime} from '../src/cognitive-runtime.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'deskbot-cognitive-v2-')),closers=[];
 let at=new Date('2026-10-10T02:00:00Z');
 const p=createSqlitePersistence({filename:join(dir,'world.sqlite'),now:()=>at});closers.push(()=>p.close());
 let world=createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at});
 world.ingest({event_id:'fixture-residents',type:'world.mutation',source:'fixture',character_id:'shaping-001',payload:{action:'install_resident_life'}});
 const s=world.get();s.protagonist.location_id='moss-sprout-garden';for(const npc of s.npcs)npc.location_id='moss-sprout-garden';s.living.objects['garden-bed'].moisture=.3;
 p.put('canonical-world.states',s.world_id,s);world=createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at});world.syncWallClock();
 t.after(async()=>{for(const close of closers.reverse())await close();rmSync(dir,{recursive:true,force:true});});
 return {p,dir,world,now:()=>at,setTime:value=>{at=new Date(value)},close:fn=>closers.push(fn),reload:()=>createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at})};
}
function fakeBridge(selector,inspect=()=>{}){return {close(){},async session(c){inspect(c);
 const state={agent_id:c.actor.actor_id,step:Math.floor((Date.parse(c.at)-Date.parse(c.epoch))/3600000),emotion:{primary:'anticipation',intensity:.3,valence:.1},short_term_goal_entities:[]};
 if(c.phase==='plan')return {schema:'deskbot.cognitive-life.proposal.v2',phase:'plan',actor_id:c.actor.actor_id,state,memories:[],compiled:selector(c),
  action:{action_type:'work',action_description:'按现场条件行动',inner_monologue:'我想亲自弄清苗况。',expected_outcome:'取得真实记录',agent_id:c.actor.actor_id,step:state.step,target:{acts_on:[],claims:[],reaches:[]}}};
 return {schema:'deskbot.cognitive-life.proposal.v2',phase:'feedback',actor_id:c.actor.actor_id,state,memory_sequence:1,
  memories:[{id:`${c.actor.actor_id}:${c.result.root_outcome_id}`,payload:{agent_id:c.actor.actor_id,stream:'factual',kind:'event',raw_content:c.result.personal_fact,stored_content:c.result.personal_fact}}],
  followup:{status:c.result.success?'continue':'postpone',question:c.result.success?'下次比较苗床':'改为先观察或等待设施空闲',reason:c.result.fact,delay_hours:24}};
}};}
function makeLife(f,selector,inspect){const life=createCognitiveLife({world:f.world,budget:{complete(){throw Error('fake bridge should not call model')},status(){return {}}},now:f.now,mode:'mock',clockScope:'isolated_test_clock',bridge:fakeBridge(selector,inspect)});f.close(()=>life.close());return life;}

test('continuous ownership and completed outcomes survive restart during feedback without repeating practice',async t=>{
 const f=fixture(t),first=makeLife(f,()=>({operation:'observe',object_index:1,reason:'看清今天的苗况'}));first.configure('shaping-001');
 await first.run('shaping-001');const task=f.world.get().tasks.find(t=>t.origin==='cognitive_life');f.setTime(task.due_at);f.world.syncTasks();
 f.world.ingest({event_id:'crash-claim',type:'world.mutation',source:'cognitive-life-engine',character_id:'shaping-001',payload:{action:'cognitive_life',actor_id:'shaping-001',operation:'claim',phase:'feedback',job_id:'crashed-feedback'}},{cognitiveInternal:true});
 await first.close();f.world=f.reload();const second=makeLife(f,()=>({operation:'observe',object_index:1,reason:'复查'}));
 const interrupted=f.world.get().cognition.actors['shaping-001'];assert.equal(interrupted.continuous,true);assert.equal(interrupted.retry.phase,'feedback');assert.equal(interrupted.pending.task_id,task.task_id);
 f.setTime(interrupted.retry.at);await second.tick();const saved=f.world.get();assert.equal(saved.cognition.actors['shaping-001'].pending,null);assert.equal(saved.cognition.actors['shaping-001'].last_result.task_id,task.task_id);
 assert.equal(saved.tasks.filter(t=>t.task_id===task.task_id).length,1);
 const archive=saved.cognition.actors['shaping-001'].memories;assert.equal(archive.filter(m=>m.root_outcome_id===`task:${task.task_id}`).length,1);
 await assert.rejects(second.run('shaping-001','feedback'),{code:'feedback_without_result'});
});

test('a provider outage defers continuous feedback and preserves the paid job boundary and actual result',async t=>{
 const f=fixture(t),bridge=fakeBridge(()=>({operation:'observe',object_index:1,reason:'观察'})),normal=bridge.session;let outage=true;
 bridge.session=async c=>{if(c.phase==='feedback'&&outage){outage=false;throw Object.assign(Error('temporary provider outage'),{code:'network_unavailable',retryable:true});}return normal(c);};
 const life=createCognitiveLife({world:f.world,budget:{status:()=>({})},now:f.now,bridge});f.close(()=>life.close());life.configure('shaping-001');await life.run('shaping-001');
 const task=f.world.get().tasks.find(t=>t.origin==='cognitive_life');f.setTime(task.due_at);f.world.syncTasks();await life.tick();
 const retry=f.world.get().cognition.actors['shaping-001'];assert.equal(retry.enabled,true);assert.equal(retry.pending.task_id,task.task_id);assert.equal(retry.retry.retryable,true);
 f.setTime(retry.retry.at);await life.tick();assert.equal(f.world.get().cognition.actors['shaping-001'].last_result.success,true);assert.equal(f.world.get().cognition.actors['shaping-001'].retry,null);
});

test('a chosen activity reserves real finite water, then only its actual completion changes moisture',async t=>{
 const f=fixture(t),initial=f.world.get(),life=makeLife(f,c=>({operation:'activity',activity_index:c.capabilities.activities.findIndex(a=>a.activity_id==='water-bed')+1,title:'浇水',reason:'苗床偏干'}));
 await life.run('shaping-001');const started=f.world.get(),task=started.tasks.find(t=>t.origin==='cognitive_life');
 assert.equal(task.reservation.inputs.find(i=>i.resource==='water').count,3);
 assert.equal(started.living.objects['seedling-rack'].stock.water,initial.living.objects['seedling-rack'].stock.water-3);
 assert.equal(cognitiveActualResult(started,'shaping-001',f.now().toISOString()),null);
 f.setTime(task.due_at);f.world.syncTasks();await life.tick();const ended=f.world.get();
 assert.ok(ended.living.objects['garden-bed'].moisture>started.living.objects['garden-bed'].moisture+.2);
 assert.equal(ended.cognition.actors['shaping-001'].last_result.success,true);assert.equal(ended.cognition.actors['shaping-001'].pending,null);
});
test('facility contention is remembered as not executed, with no duplicate resource reservation',async t=>{
 const f=fixture(t),life=makeLife(f,c=>({operation:'activity',activity_index:c.capabilities.activities.findIndex(a=>a.activity_id==='water-bed')+1,title:'浇水',reason:'苗床偏干'}));
 await life.run('shaping-001');const before=f.world.get().living.objects['seedling-rack'].stock.water;
 const blocked=await life.run('wetland-grower-001');assert.equal(blocked.adoption.blocked.code,'activity_unavailable');
 assert.equal(f.world.get().living.objects['seedling-rack'].stock.water,before);await life.tick();
 const s=f.world.get().cognition.actors['wetland-grower-001'];assert.equal(s.last_result.not_executed,true);assert.equal(s.last_result.success,false);assert.match(s.followup.question,/观察/);
});
test('task outcome freezes observed state before subsequent changes and survives a next-day restart',async t=>{
 const f=fixture(t),life=makeLife(f,()=>({operation:'observe',object_index:1,title:'观察',reason:'比较苗况'}));
 await life.run('shaping-001');const task=f.world.get().tasks.find(t=>t.origin==='cognitive_life');f.setTime(task.due_at);f.world.syncTasks();await life.tick();
 const saved=f.world.get().cognition.actors['shaping-001'],facts=JSON.stringify(saved.memories);
 f.setTime('2026-10-11T02:05:00Z');const reloaded=f.reload();reloaded.syncTasks();const context=cognitiveContext(reloaded.get(),'shaping-001',f.now().toISOString());
 assert.equal(JSON.stringify(context.saved.memories),facts);assert.equal(context.saved.followup.from_root_outcome_id,saved.last_result.root_outcome_id);
 assert.equal(cognitiveDialogueContext(reloaded.get(),'shaping-001').actual_result.root_outcome_id,saved.last_result.root_outcome_id);
 assert.notEqual(context.at,saved.last_result.occurred_at);
});
test('observation and interpretation grant no new practice and repeating feedback does not duplicate facts',async t=>{
 const f=fixture(t),life=makeLife(f,()=>({operation:'observe',object_index:1,title:'观察',reason:'比较苗况'}));await life.run('shaping-001');
 const task=f.world.get().tasks.find(t=>t.origin==='cognitive_life');f.setTime(task.due_at);f.world.syncTasks();
 const development=JSON.stringify(f.world.get().memory?.development);await life.tick();assert.equal(JSON.stringify(f.world.get().memory?.development),development);
 const count=f.world.get().cognition.actors['shaping-001'].memories.length;await assert.rejects(life.run('shaping-001','feedback'),{code:'feedback_without_result'});
 assert.equal(f.world.get().cognition.actors['shaping-001'].memories.length,count);
});

test('feedback cannot rewrite the authoritative personal event even if actor and root match',async t=>{
 const f=fixture(t),bridge=fakeBridge(()=>({operation:'observe',object_index:1,reason:'核对苗况'})),original=bridge.session;
 bridge.session=async c=>{const proposal=await original(c);if(c.phase==='feedback')proposal.memories[0].payload.raw_content='我已收获十份光果';return proposal;};
 const life=createCognitiveLife({world:f.world,budget:{status:()=>({})},now:f.now,bridge});f.close(()=>life.close());
 await life.run('shaping-001');const task=f.world.get().tasks.find(t=>t.status==='running');f.setTime(task.due_at);f.world.syncTasks();
 await assert.rejects(life.run('shaping-001','feedback'),{code:'cognitive_factual_record_changed'});
 const state=f.world.get();assert.equal(state.cognition.actors['shaping-001'].memories.length,0);assert.ok(state.cognition.actors['shaping-001'].pending);assert.equal(state.tasks[0].status,'completed');
});
test('browser-shaped world mutations cannot forge cognitive state or start its tasks',t=>{
 const f=fixture(t);assert.throws(()=>f.world.ingest({event_id:'forged',type:'world.mutation',source:'cognitive-life-engine',character_id:'shaping-001',payload:{action:'cognitive_life',actor_id:'shaping-001',operation:'claim',job_id:'forged'}}),{code:'cognitive_requires_server_adapter'});
 assert.equal(f.world.get().cognition,undefined);
});
test('invalid object references fail without starting a task or replacing formal goals',async t=>{
 const f=fixture(t),life=makeLife(f,()=>({operation:'observe',object_index:true,reason:'bad reference'}));
 await assert.rejects(life.run('shaping-001'),{code:'object_reference_invalid'});assert.equal(f.world.get().tasks.length,0);assert.equal(f.world.get().cognition.actors['shaping-001'].state.agent_id,undefined);
});
test('two recipients receive one actual message each, only after task completion',async t=>{
 const f=fixture(t),life=makeLife(f,()=>({operation:'share',receiver_indices:[1,2],message:'这里苗床有点干，你们怎么看？',title:'问苗况',reason:'听听不同理解'}));
 await life.run('shaping-001');assert.equal(f.world.get().cognition.actors['wetland-grower-001'],undefined);
 const task=f.world.get().tasks.find(t=>t.origin==='cognitive_life');f.setTime(task.due_at);f.world.syncTasks();
 for(const id of ['wetland-grower-001','lamp-keeper-001'])assert.equal(f.world.get().cognition.actors[id].inbox.length,1);
 f.world.syncTasks();assert.equal(f.world.get().cognition.actors['lamp-keeper-001'].inbox.length,1);
});

test('a subsequent physical task does not inherit a past outgoing message',async t=>{
 const f=fixture(t);let operation='share';
 const life=makeLife(f,()=>operation==='share'?{operation:'share',receiver_indices:[1],message:'你好',reason:'问好'}:{operation:'observe',object_index:1,reason:'查看苗床'});
 await life.run('shaping-001');let task=f.world.get().tasks.find(t=>t.status==='running');f.setTime(task.due_at);f.world.syncTasks();await life.tick();
 operation='observe';await life.run('shaping-001');task=f.world.get().tasks.find(t=>t.status==='running');assert.equal(task.cognitive_message,null);
});

test('choosing to wait preserves a timed review without fake execution and releases ownership at the pilot limit',async t=>{
 const f=fixture(t),life=makeLife(f,()=>({operation:'wait',reason:'等风小一点再看'}));
 await life.run('shaping-001');let state=f.world.get().cognition.actors['shaping-001'];
 assert.equal(state.enabled,true);assert.equal(state.pending,null);assert.equal(state.last_result,undefined);assert.equal(state.memories.length,0);assert.equal(f.world.get().tasks.length,0);
 assert.equal(state.next_decision_at,state.followup.next_review_at);await life.tick();assert.equal(f.world.get().cognition.actors['shaping-001'].plan_count,1);
 for(let i=1;i<4;i++){f.setTime(state.next_decision_at);await life.tick();state=f.world.get().cognition.actors['shaping-001'];}
 assert.equal(state.plan_count,4);assert.equal(state.enabled,false);assert.equal(state.memories.length,0);
 f.setTime(state.next_decision_at);await life.tick();assert.equal(f.world.get().cognition.actors['shaping-001'].plan_count,4);
});

test('a receiver leaving before completion produces no delivery or false delivered result',async t=>{
 const f=fixture(t),life=makeLife(f,()=>({operation:'share',receiver_indices:[1],message:'来看看苗床吧',reason:'邀请'}));await life.run('shaping-001');
 const state=f.world.get(),task=state.tasks.find(t=>t.status==='running');state.npcs.find(n=>n.npc_id==='wetland-grower-001').location_id='morrowmere-bank';
 f.p.put('canonical-world.states',state.world_id,state);const restored=f.reload();f.setTime(task.due_at);restored.syncTasks();
 const result=cognitiveActualResult(restored.get(),'shaping-001',f.now().toISOString());assert.equal(result.success,false);assert.match(result.fact,/留言未送达/);assert.doesNotMatch(result.fact,/实际留言/);
 assert.equal(restored.get().cognition.actors['wetland-grower-001'],undefined);
});

test('isolated test time survives restart and never rewinds to an older world clock',async t=>{
 const f=fixture(t),filename=join(f.dir,'experiment.sqlite'),budgetFilename=join(f.dir,'budget.sqlite');
 const lab=createSqlitePersistence({filename});const seed=f.world.get();
 seed.cognition={schema:'deskbot.cognitive-life.v2',actors:Object.fromEntries(['shaping-001','wetland-grower-001','lamp-keeper-001'].map(id=>[id,{actor_id:id,plan_count:4,history:[],enabled:false}]))};
 seed.clock.synced_at='2026-10-10T02:00:00Z';seed.tasks=[{status:'completed',finished_at:'2026-10-11T02:12:30Z'}];
 lab.put('canonical-world.states',seed.world_id,seed);lab.close();
 let runtime=createCognitiveRuntime({world:f.world,budgetFilename,experimentFilename:filename});
 assert.equal(runtime.status().experiment.at,'2026-10-11T02:12:30.000Z');
 await runtime.advance({operation:'next_day'});assert.equal(runtime.status().experiment.budget.calls.length,0);
 const at=runtime.status().experiment.at;assert.equal(at,'2026-10-12T02:12:30.000Z');await runtime.close();
 runtime=createCognitiveRuntime({world:f.world,budgetFilename,experimentFilename:filename});
 assert.equal(runtime.status().experiment.at,at);await runtime.close();
});
test('only participating actor private cognitive records enter a context; unrelated world revisions do not invalidate it',async t=>{
 const f=fixture(t),life=makeLife(f,()=>({operation:'rest',reason:'先缓一缓'}));await life.run('shaping-001');
 const before=cognitiveRelevantKey(f.world.get(),'wetland-grower-001');
 f.world.ingest({event_id:'news',type:'world.mutation',source:'fixture',character_id:'shaping-001',payload:{action:'record_external_context',item:{item_id:'unrelated',title:'别处消息'}}});
 assert.equal(cognitiveRelevantKey(f.world.get(),'wetland-grower-001'),before);const context=cognitiveContext(f.world.get(),'wetland-grower-001',f.now().toISOString());
 assert.equal(context.saved.intent,undefined);assert.equal(JSON.stringify(context).includes('我想亲自弄清苗况'),false);
});

const config={base_url:'https://api.deepseek.com',api_key:'local-test-fixture',model:'deepseek-flash'};
const request={scene:'agent_decision_main',messages:[{role:'user',content:'仅输出 JSON'}],max_tokens:256,json_mode:true};
function provider(payload){return async()=>({ok:true,json:async()=>payload});}
function payload(content='{}',usage={prompt_tokens:100,completion_tokens:20,prompt_cache_hit_tokens:30}){return {model:'deepseek-flash',usage,choices:[{finish_reason:'stop',message:{content}}]};}

test('local model or endpoint configuration rejection makes no outbound call or cost reservation',async t=>{
 const f=fixture(t);let network=0;
 const broker=createCognitiveBudget({persistence:f.p,configuration:{...config,base_url:'https://api.deepseek.com.untrusted.example'},fetchImpl:async()=>{network++;return payload();}});f.close(()=>broker.close());
 await assert.rejects(broker.complete('invalid-config',request),{code:'unsupported_paid_configuration'});
 assert.equal(network,0);assert.equal(broker.status().used_upper_cny,0);assert.equal(broker.status().calls.length,0);
});

test('separate broker connections share one atomic allowance before outbound requests',async t=>{
 const f=fixture(t),other=createSqlitePersistence({filename:f.p.filename});f.close(()=>other.close());
 let release,network=0;const gate=new Promise(resolve=>release=resolve);
 const fetchImpl=async()=>{network++;await gate;return {ok:true,json:async()=>payload()}};
 const one=createCognitiveBudget({persistence:f.p,configuration:config,limitCny:.007,fetchImpl});
 const two=createCognitiveBudget({persistence:other,configuration:config,limitCny:.007,fetchImpl});
 f.close(()=>one.close());f.close(()=>two.close());
 const first=one.complete('shared-one',request);await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(two.complete('shared-two',request),{code:'budget_exhausted'});assert.equal(network,1);
 assert.ok(two.status().used_upper_cny<=.007);release();await first;
});
test('provider-reported tokens and cache hits account for CNY upper estimate; call replay is free',async t=>{
 const f=fixture(t);let network=0;const broker=createCognitiveBudget({persistence:f.p,configuration:config,fetchImpl:async()=>{network++;return {ok:true,json:async()=>payload()}}});f.close(()=>broker.close());
 await broker.complete('once',request);await broker.complete('once',request);assert.equal(network,1);
 assert.ok(Math.abs(broker.status().used_upper_cny-(70*2+30*.04+20*8)/1e6)<1e-9);assert.equal(broker.status().billed_cost_cny,null);
});
test('budget reservation rejects before network call; maximum and approval persist',async t=>{
 const f=fixture(t);let network=0;const broker=createCognitiveBudget({persistence:f.p,limitCny:.001,configuration:config,fetchImpl:async()=>{network++;return {}}});f.close(()=>broker.close());
 await assert.rejects(broker.complete('too-large',request),{code:'budget_exhausted'});assert.equal(network,0);
 assert.throws(()=>createCognitiveBudget({persistence:f.p,limitCny:2}),{code:'budget_configuration_changed'});
});
test('failed parse still costs tokens; uncertain transport keeps reservation and never retries automatically',async t=>{
 const f=fixture(t),broker=createCognitiveBudget({persistence:f.p,configuration:config,fetchImpl:provider(payload('{bad'))});f.close(()=>broker.close());
 await assert.rejects(broker.complete('invalid',request));assert.ok(broker.status().used_upper_cny>0);assert.equal(broker.status().calls[0].uncertain,false);
 const other=createSqlitePersistence({filename:join(f.dir,'other.sqlite')});f.close(()=>other.close());let network=0;
 const broken=createCognitiveBudget({persistence:other,configuration:config,fetchImpl:async()=>{network++;throw Error('transport failed')}});f.close(()=>broken.close());
 await assert.rejects(broken.complete('unknown',request));await assert.rejects(broken.complete('unknown',request),{code:'call_not_replayable'});
 assert.equal(network,1);assert.equal(broken.status().calls[0].held_cny,broken.status().calls[0].reserved_cny);assert.equal(broken.status().calls[0].uncertain,true);
});
