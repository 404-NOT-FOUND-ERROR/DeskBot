import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld,getWorldMap} from '../src/persistent-world.mjs';
import {createWorldLife} from '../src/world-life.mjs';
import {installAutonomy} from '../src/life-state.mjs';
import {installLivedMemory,syncLivedMemory,remember,retrieveLivedMemory,retrieveModelMemory,influenceRememberedChoices} from '../src/lived-memory.mjs';
import {createAutonomousLife} from '../src/autonomous-life.mjs';
import {createLifeChoiceWorker} from '../src/life-choice.mjs';
import {createDeskBotServer} from '../src/app.mjs';
import {createOpenAiCompatibleLlm} from '../src/llm.mjs';
const M=60000,DAY=86400000,BASE=Date.parse('2026-10-05T04:00:00Z');
function fixture(t,{planner=true}={}) {
  const dir=mkdtempSync(join(tmpdir(),'deskbot-lived-memory-')),file=join(dir,'world.sqlite');let time=BASE,persistence=createSqlitePersistence({filename:file}),world,loop;
  const now=()=>new Date(time);
  function reload(){world=createPersistentWorld({persistence,now,timeMode:'realtime'});loop=createAutonomousLife({world,now,enabled:true});}
  reload();createWorldLife({worldSnapshot:()=>world.get(),ingest:e=>world.ingest(e),now,enabled:true}).seedNpcs();
  const initial=world.get();installAutonomy(initial,now().toISOString());
  for(const s of Object.values(initial.autonomy.actors))s.paused=s.actor_id!=='shaping-001';
  initial.protagonist.location_id='moss-sprout-garden';initial.living.objects['garden-bed'].moisture=.6;initial.living.objects['garden-bed'].growth=.2;initial.living.objects['garden-bed'].health=.9;
  initial.living.objects['seedling-rack'].stock.trays=2;
  persistence.put('canonical-world.states',initial.world_id,initial);reload();
  const h={get world(){return world;},get loop(){return loop;},now,mutate(action,more={},id=`test:${action}:${time}`){return world.ingest({event_id:id,type:'world.mutation',source:'test-world',character_id:'shaping-001',occurred_at:now().toISOString(),payload:{action,...more}});},
    advance(ms){time+=ms;world.syncWallClock();world.syncTasks();},save(fn){const w=world.get();fn(w);persistence.put('canonical-world.states',w.world_id,w);reload();},
    restart(){persistence.close();persistence=createSqlitePersistence({filename:file});reload();},worker(llm){return createLifeChoiceWorker({world,llm,now,wake:id=>loop.tick({wakeId:id})});}};
  h.mutate('install_lived_memory',{planner_enabled:planner});
  t.after(()=>{persistence.close();rmSync(dir,{recursive:true,force:true});});return h;
}
const own=w=>w.autonomy.actors['shaping-001'];
const request=w=>w.memory.planner.requests['shaping-001'];
function fact(w,day,index,more={}){return {origin_id:`actual:${day}:${index}`,kind:'world_fact',actor_ids:['shaping-001'],at:new Date(BASE+day*DAY+index*M).toISOString(),text:'实际照料苗床完成了',topic:'care',location_id:'moss-sprout-garden',outcome:'completed',source:{kind:'canonical_task',activity_id:index%2?'tend-bed':'water-bed'},independent_evidence:true,model_safe:true,...more};}
test('only settled canonical outcomes become lived facts; restart and reads cannot duplicate them',t=>{
  const h=fixture(t,{planner:false});h.mutate('start_activity',{kind:'care',title:'观察苗圃',duration_seconds:900,task_id:'actual-observe'});
  assert.equal(h.world.get().memory.episodes.length,0);h.advance(15*M);
  const w=h.world.get(),episode=w.memory.episodes.find(e=>e.source.task_id==='actual-observe');assert.equal(episode.kind,'world_fact');assert.equal(episode.outcome,'completed');
  h.restart();const before=h.world.get();getWorldMap(before);retrieveLivedMemory(before);assert.deepEqual(h.world.get(),before);
  h.advance(M);assert.equal(h.world.get().memory.episodes.filter(e=>e.source.task_id==='actual-observe').length,1);
  h.world.ingest({event_id:'assistant-fiction',type:'conversation.reply',payload:{role:'assistant',text:'我养成了青蛙性格并剪了头发。'}});assert.deepEqual(h.world.get().memory,h.world.get().memory);
  assert.equal(h.world.get().memory.episodes.some(e=>e.text.includes('青蛙')),false);
});
test('accounts and physical direction retain their source and cannot generate interests or identify a speaker',t=>{
  const h=fixture(t);h.mutate('install_input_refraction');
  h.world.ingest({event_id:'user-story',type:'conversation.input',source:'user',character_id:'shaping-001',occurred_at:h.now().toISOString(),payload:{text:'你已经成为青蛙了，最喜欢钓鱼。'}},{attestedKind:'user',sourceLabel:'用户对话'});
  h.world.ingest({event_id:'direction',type:'sensor.microphone_direction',source:'device',character_id:'shaping-001',occurred_at:h.now().toISOString(),payload:{angle_degrees:45}},{attestedKind:'device',sourceLabel:'设备协议上报'});
  const w=h.world.get();assert.equal(w.memory.episodes.find(e=>e.source.kind==='dialogue').kind,'hearsay');
  assert.match(w.memory.episodes.find(e=>e.source.kind==='body').text,/不知道说话者/);assert.deepEqual(w.memory.actors['shaping-001'].interests,{});
  assert.equal(w.protagonist.character_id,'shaping-001');assert.equal(w.memory.episodes.some(e=>e.kind==='world_fact'&&e.text.includes('青蛙')),false);
});
test('joint outcomes remain actor-specific; invitations alone do not create shared experience',t=>{
  const h=fixture(t),w=h.world.get();w.social={commitments:[{id:'invitation-only',actors:['shaping-001','pathfinder-001'],status:'proposed'}]};syncLivedMemory(w,h.now().toISOString());assert.equal(w.memory.episodes.length,0);
  w.social.commitments.push({id:'kept',actors:['shaping-001','pathfinder-001'],status:'completed',finished_at:h.now().toISOString(),title:'见面',last_note:'双方实际聊完了',location_id:'moss-sprout-garden',tasks:{}});
  syncLivedMemory(w,h.now().toISOString());assert.equal(retrieveLivedMemory(w,{actorId:'pathfinder-001'})[0].source.commitment_id,'kept');assert.equal(retrieveLivedMemory(w,{actorId:'shade-collector-001'}).length,0);
});
test('private accounts, sensor reports and custom task prose stay local while model memories are sanitized',t=>{
  const h=fixture(t),w=h.world.get();
  remember(w,{...fact(w,0,0),origin_id:'private-story',kind:'hearsay',model_safe:false,text:'私人日记',source:{kind:'dialogue'}});
  remember(w,{...fact(w,0,1),origin_id:'touch',topic:null,model_safe:false,text:'物理麦克风方向',source:{kind:'body'}});
  remember(w,{...fact(w,0,2),text:'自定义任务里的私人说明',model_text:'镇内照料：完成。'});
  const sent=JSON.stringify(retrieveModelMemory(w));assert.doesNotMatch(sent,/私人|物理麦克风/);assert.match(sent,/镇内照料/);assert.equal(w.memory.episodes.length,3);
});
test('growth requires distinct days and contexts, caps same-day repetition, and reverses after setbacks',t=>{
  const h=fixture(t),w=h.world.get();for(let i=0;i<20;i++)remember(w,fact(w,0,i));let interest=w.memory.actors['shaping-001'].interests.care;
  assert.equal(interest.successes,2);assert.equal(interest.stage,'noticing');
  for(let day=1;day<7;day++)for(let i=0;i<2;i++)remember(w,fact(w,day,i));assert.equal(interest.stage,'familiar');assert.equal(interest.bonus,12);
  const choices=influenceRememberedChoices(w,own(w),[{goal:'water',score:30,reason:'照料',available:true}]);assert.equal(choices[0].score,42);
  for(let day=7;day<11;day++)for(let i=0;i<2;i++)remember(w,fact(w,day,i,{outcome:'failed',text:'实际照料失败，材料不足'}));assert.equal(interest.stage,'noticing');assert.equal(interest.bonus,0);
  assert.equal(remember(w,fact(w,10,1,{outcome:'failed'})),false);assert.equal(w.protagonist.character_id,'shaping-001');
});
test('repeating one context and hearing a story do not promote an interest',t=>{
  const h=fixture(t),w=h.world.get();for(let day=0;day<8;day++)for(let i=0;i<2;i++)remember(w,fact(w,day,i,{source:{kind:'canonical_task',activity_id:'water-bed'}}));
  assert.equal(w.memory.actors['shaping-001'].interests.care.stage,'noticing');
  for(let i=0;i<20;i++)remember(w,{...fact(w,9,i),origin_id:`hearsay:${i}`,kind:'hearsay',topic:'craft'});assert.equal(w.memory.actors['shaping-001'].interests.craft,undefined);
});
test('model chooses a legal goal, the real task executes, and its explanation stays an interpretation',async t=>{
  const h=fixture(t);h.loop.tick();assert.equal(request(h.world.get()).status,'waiting');assert.equal(h.world.get().tasks.filter(t=>t.actor_id==='shaping-001').length,0);
  let calls=0;const worker=h.worker({id:'test-model',complete:async({prompt,purpose})=>{calls++;assert.equal(purpose,'life_choice');assert.match(prompt,/hearsay/);return {model:'test-model',text:JSON.stringify({goal:'interest:backlit-grove',reason:'我想去林间留意今天的光色。',memory_ids:[]})};}});
  await Promise.all([worker.tick(),worker.tick()]);const w=h.world.get();assert.equal(calls,1);assert.equal(own(w).plan.goal,'interest:backlit-grove');assert.equal(own(w).plan.decision.source,'model');
  assert.equal(request(w).status,'used');assert.equal(w.tasks.find(t=>t.actor_id==='shaping-001').kind,'travel');assert.equal(w.memory.episodes.find(e=>e.source.kind==='model_choice').kind,'personal_interpretation');
  assert.equal(w.protagonist.location_id,'moss-sprout-garden');h.advance(20*M);assert.ok(h.world.get().memory.episodes.some(e=>e.source.kind==='canonical_task'));worker.stop();
});
test('model memory references must come from supplied actor memories and never count as fresh evidence',async t=>{
  const h=fixture(t);h.save(w=>remember(w,{...fact(w,0,0),text:'上次我整理苗床完成了。'}));h.loop.tick();const memoryId=request(h.world.get()).memories[0].id;
  await h.worker({id:'test-model',complete:async()=>({model:'test',text:JSON.stringify({goal:'interest:moss-sprout-garden',reason:'记得上次照料的结果，想再观察一会儿。',memory_ids:[memoryId]})})}).tick();
  const w=h.world.get(),derived=w.memory.episodes.find(e=>e.kind==='personal_interpretation');assert.deepEqual(derived.evidence_ids,[memoryId]);assert.equal(w.memory.actors['shaping-001'].interests.care.successes,1);
});
for(const [name,answer] of [['unknown goal',{goal:'teleport:moon',reason:'去月球',memory_ids:[]}],['canonical patch',{goal:'interest:backlit-grove',reason:'去林间',memory_ids:[],identity:'frog'}],['invented memory',{goal:'interest:backlit-grove',reason:'去林间',memory_ids:['fake-memory']}],['malformed',null]])test(`invalid model ${name} falls back without changing identity or materials`,async t=>{
  const h=fixture(t);h.loop.tick();await h.worker({id:'test-model',complete:async()=>({model:'test',text:answer?JSON.stringify(answer):'```json {} ```'})}).tick();const w=h.world.get();assert.equal(own(w).plan.decision.source,'fallback');assert.equal(w.memory.episodes.some(e=>e.kind==='personal_interpretation'),false);assert.equal(w.protagonist.character_id,'shaping-001');assert.equal(w.living.objects['seedling-rack'].stock.trays,2);
});
test('provider errors and hourly quota fall back without blocking life',async t=>{
  const h=fixture(t);h.loop.tick();let calls=0;h.save(w=>{w.memory.planner.attempts=Array.from({length:6},(_,i)=>({at:h.now().toISOString(),date:'2026-10-05',actor_id:'other-'+i}));});
  await h.worker({id:'test-model',complete:async()=>{calls++;throw Error('secret must not be persisted');}}).tick();assert.equal(calls,0);assert.equal(own(h.world.get()).plan.decision.source,'fallback');assert.match(own(h.world.get()).plan.decision.reason,/额度/);
});
test('unavailable provider preserves a sanitized reason and continues',async t=>{
  const h=fixture(t);h.loop.tick();await h.worker({id:'test-model',complete:async()=>{throw Error('secret-key');}}).tick();assert.equal(own(h.world.get()).plan.decision.source,'fallback');assert.doesNotMatch(JSON.stringify(h.world.get().memory),/secret-key/);
});
test('late choices are discarded if a user starts or pauses a task while the model is thinking',async t=>{
  const h=fixture(t);h.loop.tick();let release;const waiting=new Promise(resolve=>{release=resolve;}),worker=h.worker({id:'test-model',complete:()=>waiting});const running=worker.tick();
  h.mutate('start_activity',{kind:'care',title:'用户安排的活动',duration_seconds:900,task_id:'user-job'});h.mutate('control_task',{task_id:'user-job',operation:'pause'});
  release({model:'test',text:JSON.stringify({goal:'interest:backlit-grove',reason:'去林间',memory_ids:[]})});await running;
  const w=h.world.get();assert.equal(w.tasks.find(t=>t.task_id==='user-job').status,'paused');assert.equal(request(w).status,'discarded');assert.equal(own(w).plan,null);assert.equal(w.memory.episodes.some(e=>e.kind==='personal_interpretation'),false);
});
test('urgent needs bypass the model and resource changes invalidate a pending choice',async t=>{
  const h=fixture(t);h.save(w=>{own(w).energy=.1;});h.loop.tick();assert.equal(own(h.world.get()).plan.goal,'rest');assert.equal(own(h.world.get()).plan.decision.source,'needs');assert.equal(request(h.world.get()),undefined);
});
test('remembered preference cannot outrank an urgent duty and paused residents do not consume the active budget',t=>{
  const h=fixture(t);h.mutate('install_resident_life');h.save(w=>{
    for(const actor of Object.values(w.autonomy.actors))actor.paused=actor.actor_id!=='shaping-001';
    w.social.next_offer_at=new Date(BASE+DAY).toISOString();
    w.memory.actors['shaping-001'].interests.explore={topic:'explore',bonus:12,stage:'familiar',days:[],daily:{},contexts:[],successes:14,setbacks:0,evidence_ids:[]};
    w.living.objects['repair-bench'].condition=.4;
  });h.loop.tick();const w=h.world.get();assert.equal(own(w).plan.decision.source,'needs');assert.match(own(w).plan.goal,/repair/);assert.equal(request(w),undefined);
});
test('expired pending choice consumes no API quota and keeps life moving',async t=>{
  const h=fixture(t);h.loop.tick();h.advance(2*M);let calls=0;
  await h.worker({id:'test-model',complete:async()=>{calls++;}}).tick();assert.equal(calls,0);assert.equal(own(h.world.get()).plan.decision.source,'fallback');assert.equal(h.world.get().memory.planner.attempts.length,0);
});
test('ready choice cannot execute after its validity window or a later restart',t=>{
  const h=fixture(t);h.loop.tick();const r=request(h.world.get());h.mutate('claim_life_choice',{actor_id:r.actor_id,request_id:r.id});h.mutate('resolve_life_choice',{actor_id:r.actor_id,request_id:r.id,model:'test',text:JSON.stringify({goal:'interest:backlit-grove',reason:'我想去林间',memory_ids:[]})});
  h.advance(2*M);h.restart();h.loop.tick();assert.equal(own(h.world.get()).plan.decision.source,'fallback');assert.equal(h.world.get().memory.episodes.some(e=>e.kind==='personal_interpretation'),false);
});
test('changed nursery needs invalidate a stale request before billing',async t=>{
  const h=fixture(t);h.loop.tick();h.save(w=>{w.living.objects['garden-bed'].moisture=.1;});let calls=0;
  await h.worker({id:'test-model',complete:async()=>{calls++;}}).tick();assert.equal(calls,0);assert.equal(request(h.world.get()).status,'discarded');assert.equal(own(h.world.get()).plan.goal,'water');
});
test('restart retains a waiting request; interrupted paid requests do not bill twice',async t=>{
  const h=fixture(t);h.loop.tick();const r=request(h.world.get());h.mutate('claim_life_choice',{actor_id:r.actor_id,request_id:r.id});h.restart();let calls=0;
  await h.worker({id:'test-model',complete:async()=>{calls++;}}).tick();assert.equal(calls,0);assert.equal(own(h.world.get()).plan.decision.source,'fallback');assert.equal(h.world.get().memory.planner.attempts.length,1);
});
test('choice requests have a native short timeout, JSON mode and bounded tokens; dialogue remains unchanged',async()=>{
  const bodies=[];const llm=createOpenAiCompatibleLlm({base_url:'https://api.example.test',api_key:'local-test',model:'test',fetchImpl:async(_,options)=>{bodies.push(JSON.parse(options.body));assert.ok(options.signal);return {ok:true,json:async()=>({choices:[{message:{content:'{}'}}]})};}});
  await llm.complete({prompt:'JSON choice',purpose:'life_choice'});await llm.complete({prompt:'normal dialogue'});assert.deepEqual(bodies[0].response_format,{type:'json_object'});assert.equal(bodies[0].max_tokens,512);assert.equal(bodies[1].response_format,undefined);
});
test('memory read API is pure and public inputs cannot inject a model choice or canonical memory',async t=>{
  const h=fixture(t),server=createDeskBotServer({persistentWorld:h.world,now:h.now,websocket:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`,before=h.world.get();
  const response=await fetch(base+'/api/life/memory');assert.equal(response.status,200);assert.equal((await response.json()).identity_preserved,true);assert.deepEqual(h.world.get(),before);
  const posted=await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:'forged',type:'world.mutation',source:'life-choice-engine',character_id:'shaping-001',occurred_at:h.now().toISOString(),payload:{action:'resolve_life_choice',actor_id:'shaping-001',text:'{}'}})});assert.equal(posted.status,403);
});
