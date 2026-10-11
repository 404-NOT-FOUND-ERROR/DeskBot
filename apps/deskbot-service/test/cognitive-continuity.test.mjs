import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {createCognitiveLife} from '../src/cognitive-life.mjs';
import {createCognitionBridge} from '../src/cognition-bridge.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation} from '../src/cognitive-life-state.mjs';
import {cognitiveWorkingState,perceptionFact} from '../src/cognitive-continuity.mjs';
import {syncDevelopmentEvidence} from '../src/development-evidence.mjs';
import {cognitiveDialogueContext} from '../src/cognitive-life-state.mjs';
import {installRefraction} from '../src/input-refraction.mjs';

function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'cognitive-continuity-')),closers=[];let at=new Date('2026-10-10T02:00:00Z');
 const p=createSqlitePersistence({filename:join(dir,'fixture.sqlite'),now:()=>at});
 let world=createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at});
 world.ingest({event_id:'residents',type:'world.mutation',source:'fixture',character_id:'shaping-001',payload:{action:'install_resident_life'}});
 const seed=world.get();seed.protagonist.location_id='moss-sprout-garden';for(const npc of seed.npcs)npc.location_id='moss-sprout-garden';
 seed.living.objects['garden-bed'].moisture=.3;p.put('canonical-world.states',seed.world_id,seed);
 world=createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at});
 t.after(async()=>{for(const close of closers.reverse())await close();p.close();rmSync(dir,{recursive:true,force:true});});
 return {p,world,now:()=>at,setTime:v=>at=new Date(v),close:fn=>closers.push(fn),
  reload:()=>createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at}),save:s=>p.put('canonical-world.states',s.world_id,s)};
}
const id='shaping-001';
test('an actual user conversation enters the source adapter and its interpreted question returns to dialogue after restart',async t=>{
 const f=fixture(t),seed=f.world.get(),at=f.now().toISOString();installRefraction(seed,at);f.save(seed);const world=f.reload();
 world.ingest({event_id:'fictional-chat',type:'conversation.input',source:'fixture-user',character_id:id,occurred_at:at,payload:{text:'你觉得苗床今天的颜色有变化吗？'}},{attestedKind:'user',sourceLabel:'实验用户'});
 const context=cognitiveContext(world.get(),id,at,'interpret');assert.equal(context.inputs.length,1);assert.equal(context.inputs[0].category,'user');
 const source=context.inputs[0];const bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:20000,maxFrames:10});f.close(()=>bridge.close());
 let calls=0;const life=createCognitiveLife({world,now:f.now,mode:'mock',bridge,budget:{status:()=>({}),complete:async()=>{calls++;return {content:JSON.stringify({interpretations:[{
  source_id:source.id,kind:'question',stance:'affirmed',effect:'inquiry',topic:'苔色',question:'先观察再比较苔色',reason:'用户提出可验证问题',evidence_quote:'苗床今天的颜色',target_object_ids:['garden-bed'],confidence:.9}] }),model:'test',input_tokens:0,output_tokens:0}}}});f.close(()=>life.close());
 await life.run(id,'interpret');assert.equal(calls,1);const state=f.reload().get();assert.equal(state.tasks.length,0);
 assert.equal(cognitiveContext(state,id,at).refraction.pending.length,0);
 assert.equal(cognitiveDialogueContext(state,id).understood_inputs[0].source_id,source.id);
 assert.equal(cognitiveDialogueContext(state,id).understood_inputs[0].epistemic,'personal_interpretation');
 assert.equal(state.cognition.actors[id].memories.length,0);
});
function proposal(compiled,phase='plan'){return {schema:'deskbot.cognitive-life.proposal.v3',actor_id:id,phase,state:{agent_id:id},memories:[],compiled,action:{agent_id:id,step:0,action_type:'work',action_description:'按实际条件执行',inner_monologue:'延续自己的问题',expected_outcome:'留下可核验结果',target:{acts_on:[],claims:[],reaches:[]}}};}
function begin(w,at,job='job'){
 applyCognitiveMutation(w,{actor_id:id,operation:'claim',phase:'plan',job_id:job},at,job+'-claim');return {actor_id:id,operation:'plan',job_id:job,relevant_key:cognitiveRelevantKey(w,id)};
}
function fakeLife(f,select){
 const bridge={close(){},async session(c){
  if(c.phase==='plan')return {...proposal(select(c)),actor_id:c.actor.actor_id,state:{agent_id:c.actor.actor_id}};
  if(c.phase==='perceive')return {...proposal(null,'perceive'),actor_id:c.actor.actor_id,state:{agent_id:c.actor.actor_id},
   memories:c.perceptions.map(s=>({id:'receipt-'+s.id,payload:{agent_id:c.actor.actor_id,stream:'factual',kind:'event',raw_content:perceptionFact(s),stored_content:perceptionFact(s),metadata_json:JSON.stringify({message_id:s.id})}}))};
  return {...proposal(null,'feedback'),actor_id:c.actor.actor_id,state:{agent_id:c.actor.actor_id},followup:{status:'continue',question:'以后再比较',reason:'基于已发生的结果',delay_hours:24}};
 }};
 const life=createCognitiveLife({world:f.world,now:f.now,mode:'mock',bridge,budget:{status:()=>({})}});f.close(()=>life.close());return life;
}
test('frozen object indices retain identity after source ordering changes',t=>{
 const f=fixture(t),w=f.world.get(),at=f.now().toISOString(),context=cognitiveContext(w,id,at),request=begin(w,at);
 w.living.objects=Object.fromEntries(Object.entries(w.living.objects).reverse());
 applyCognitiveMutation(w,{...request,proposal:proposal({operation:'observe',object_index:1,reason:'观察'})},at,'adopt');
 const task=w.tasks.at(-1);assert.equal(task.target_object_id,context.objects[0].id);assert.equal(task.life_action,'observe');
 assert.equal(task.root_outcome_id,w.cognition.actors[id].pending.root_outcome_id);
});
test('a disappeared frozen target rejects instead of choosing another object',t=>{
 const f=fixture(t),w=f.world.get(),at=f.now().toISOString(),request=begin(w,at),target=w.cognition.actors[id].job.references.objects[0];
 delete w.living.objects[target];
 assert.throws(()=>applyCognitiveMutation(w,{...request,proposal:proposal({operation:'observe',object_index:1,reason:'观察'})},at,'adopt'),{code:'object_reference_unavailable'});
});
test('frozen recipients survive resident order changes and project as social',t=>{
 const f=fixture(t),w=f.world.get(),at=f.now().toISOString(),request=begin(w,at),receiver=w.cognition.actors[id].job.references.receivers[0];w.npcs.reverse();
 applyCognitiveMutation(w,{...request,proposal:proposal({operation:'share',receiver_indices:[1],message:'我想比较两处苔床',reason:'请教'})},at,'adopt');
 assert.deepEqual(w.tasks.at(-1).target_actor_ids,[receiver]);assert.equal(w.tasks.at(-1).life_action,'social');
});
test('actual self-directed activity shares its outcome root and motivation with the existing development ledger',async t=>{
 const f=fixture(t),life=fakeLife(f,c=>({operation:'activity',activity_index:c.capabilities.activities.findIndex(a=>a.activity_id==='water-bed')+1,reason:'先照料苗床',motivation:'need',source_ids:[]}));
 await life.run(id);let s=f.world.get(),task=s.tasks.find(t=>t.origin==='cognitive_life'),root=s.cognition.actors[id].pending.root_outcome_id;
 f.setTime(task.due_at);f.world.syncTasks();await life.run(id,'feedback');s=f.world.get();s.memory??={episodes:[]};syncDevelopmentEvidence(s,f.now().toISOString());
 const record=s.memory.development.records.find(r=>r.source.task_id===task.task_id);
 assert.equal(record.root_outcome_id,root);assert.equal(record.causes.trigger,'own');assert.equal(record.causes.motivation.kind,'need');assert.equal(record.effect.practice,true);
});
test('source inputs remain owned, attributed and fresh; a received suggestion is not a completed fact',t=>{
 const f=fixture(t),w=f.world.get(),at=f.now().toISOString();w.refraction={records:[{id:'user-1',category:'dialogue',source_label:'用户',text:'可以看看雨后的苔吗？',attested:true,freshness:'fresh',status:'observed',received_at:at,observed_at:at,expires_at:'2026-10-11T02:00:00Z'},
  {id:'old',category:'external',text:'过期报道',attested:true,freshness:'fresh',status:'observed',received_at:at,expires_at:'2026-10-09T00:00:00Z'}]};
 const mine=cognitiveContext(w,id,at),other=cognitiveContext(w,'wetland-grower-001',at);
 assert.deepEqual(mine.inputs.map(s=>s.id),['user-1']);assert.equal(mine.inputs[0].epistemic,'reported');assert.equal(other.inputs.length,0);
 assert.equal(mine.saved.memories.length,0);
});
test('real Python perception persists a heard message and directional contact exactly once across restart without an API call',async t=>{
 const f=fixture(t),s=f.world.get();s.cognition={actors:{[id]:{actor_id:id,version:0,state:{},memories:[],history:[],enabled:true,plan_count:0,
  inbox:[{task_id:'delivery',sender_id:'wetland-grower-001',sender_name:'苔团',text:'昨天我看见苔芽暗了一些。',at:f.now().toISOString()}]}}};f.save(s);
 let w=f.reload(),calls=0;let life=createCognitiveLife({world:w,now:f.now,mode:'mock',budget:{status:()=>({}),complete(){calls++;throw Error('perception must not call API');}}});
 await life.run(id,'perceive');await life.close();w=f.reload();const saved=w.get().cognition.actors[id];
 assert.equal(calls,0);assert.equal(saved.memories.length,1);assert.equal(saved.memories[0].epistemic,'heard');assert.equal(saved.relations[0].interaction_count,1);
 assert.equal(saved.relations[0].to_name,'苔团');assert.equal(saved.perception_receipts.length,1);
 life=createCognitiveLife({world:w,now:f.now,mode:'mock',budget:{status:()=>({}),complete(){throw Error('no API');}}});f.close(()=>life.close());
 await life.run(id,'perceive');const after=w.get().cognition.actors[id];assert.equal(after.memories.length,1);assert.equal(after.relations[0].interaction_count,1);
});
test('busy perception cannot become practice or replace the running task',async t=>{
 const f=fixture(t),life=fakeLife(f,()=>({operation:'observe',object_index:1,reason:'记录'}));await life.run(id);let s=f.world.get(),task=s.tasks.find(t=>t.origin==='cognitive_life');
 s.cognition.actors[id].inbox=[{task_id:'letter',sender_id:'lamp-keeper-001',sender_name:'灯穗',text:'等你有空再来',at:f.now().toISOString()}];f.save(s);
 const world=f.reload(),busy=createCognitiveLife({world,now:f.now,mode:'mock',budget:{status:()=>({}),complete(){throw Error('no API');}}});f.close(()=>busy.close());
 await busy.run(id,'perceive');const after=world.get();assert.equal(after.tasks.find(t=>t.task_id===task.task_id).status,'running');
 assert.equal(after.cognition.actors[id].pending.task_id,task.task_id);assert.equal(after.cognition.actors[id].plan_count,1);assert.equal(after.cognition.actors[id].memories.length,1);
});
test('a worker cannot invent a perception source or rewrite a received message',t=>{
 const f=fixture(t),w=f.world.get(),at=f.now().toISOString();applyCognitiveMutation(w,{actor_id:id,operation:'claim',job_id:'heard',phase:'perceive'},at,'claim');
 const p=proposal(null,'perceive');p.memories=[{id:'invented',payload:{agent_id:id,stream:'factual',kind:'event',raw_content:'我学会了烹饪',stored_content:'我学会了烹饪',metadata_json:'{"message_id":"unknown"}'}}];
 assert.throws(()=>applyCognitiveMutation(w,{actor_id:id,operation:'perceive',job_id:'heard',proposal:p},at,'adopt'),{code:'perception_source_invalid'});
});
test('working memory remains bounded while old raw records and insight sources are retained',()=>{
 const memories=Array.from({length:1000},(_,i)=>({id:`m${i}`,payload:{agent_id:id,stream:'factual',raw_content:'苗床记录'+i,stored_content:'苗床记录'+i,source_ids:[],importance:.3}}));
 memories.push({id:'insight',payload:{stream:'experiential',kind:'insight',raw_content:'理解',stored_content:'理解',source_ids:['m2','m3'],importance:.8}});
 const life={memories},before=JSON.stringify(life),selected=cognitiveWorkingState(life,'苗床');
 assert.ok(selected.memories.length<=80);assert.equal(selected.memory_window.total,1001);assert.equal(JSON.stringify(life),before);
 assert.ok(selected.memories.some(m=>m.id==='m2'));assert.ok(selected.memories.some(m=>m.id==='m3'));
});
test('unknown motivation stays unknown and invented self-continuation is rejected',t=>{
 const f=fixture(t),w=f.world.get(),at=f.now().toISOString(),request=begin(w,at);
 assert.throws(()=>applyCognitiveMutation(w,{...request,proposal:proposal({operation:'rest',reason:'x',motivation:'self_continuation',prior_root_id:'task:invented'})},at,'adopt'),{code:'cognitive_prior_root_unknown'});
});
test('retrieval metadata can advance without rewriting original memory text',t=>{
 const f=fixture(t),w=f.world.get(),at=f.now().toISOString(),request=begin(w,at);w.cognition.actors[id].memories=[{id:'old',payload:{agent_id:id,stream:'factual',raw_content:'原文',stored_content:'原文',retrieval_count:1}}];
 const p=proposal({operation:'wait',reason:'稍后',motivation:'unknown'});p.memory_updates=[{id:'old',raw_content:'伪造',retrieval_count:3,last_accessed_step:1}];
 applyCognitiveMutation(w,{...request,proposal:p},at,'adopt');assert.equal(w.cognition.actors[id].memories[0].payload.raw_content,'原文');assert.equal(w.cognition.actors[id].memories[0].payload.retrieval_count,3);
});
test('retryable feedback failure keeps task ownership and resumes the actual result',async t=>{
 const f=fixture(t);let failures=0;
 const bridge={close(){},async session(c){if(c.phase==='plan')return proposal({operation:'observe',object_index:1,reason:'记录'});
  if(!failures++)throw Object.assign(new Error('temporary'),{code:'python_timeout'});
  return {...proposal(null,'feedback'),followup:{status:'continue',question:'再看',reason:'已观察',delay_hours:1}};
 }};
 const life=createCognitiveLife({world:f.world,now:f.now,mode:'mock',bridge,budget:{status:()=>({})}});f.close(()=>life.close());
 await life.run(id);const task=f.world.get().tasks.find(t=>t.origin==='cognitive_life');f.setTime(task.due_at);f.world.syncTasks();
 await assert.rejects(life.run(id,'feedback'),{code:'python_timeout'});let actor=f.world.get().cognition.actors[id];
 assert.equal(actor.enabled,true);assert.equal(actor.pending.task_id,task.task_id);assert.equal(actor.retry.phase,'feedback');
 f.setTime(actor.retry.at);await life.tick();actor=f.world.get().cognition.actors[id];assert.equal(actor.pending,null);assert.equal(actor.last_result.task_id,task.task_id);assert.equal(actor.plan_count,1);
});
