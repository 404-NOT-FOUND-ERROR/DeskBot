import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createWorldLife } from '../src/world-life.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';
import { installLivedMemory, syncLivedMemory, influenceRememberedChoices, modelDevelopmentContext } from '../src/lived-memory.mjs';
import { developmentFacetsReadModel } from '../src/development-facets.mjs';
import { roleDevelopmentReadModel } from '../src/role-development.mjs';
import { prepareLifeChoice, lifeChoicePrompt } from '../src/life-choice.mjs';
import { composePrompt } from '../src/prompt-composer.mjs';
import { LIVING_RULE_VERSION } from '../src/living-resources.mjs';

const OWN='shaping-001',BASE=Date.parse('2026-10-06T04:00:00.000Z'),MINUTE=60000,DAY=86400000;
const own=w=>w.autonomy.actors[OWN];
const topic=(w,name)=>developmentFacetsReadModel(w,{actorId:OWN}).actors[0].topics.find(t=>t.topic===name);
function fixture(t,{planner=false}={}) {
  const dir=mkdtempSync(join(tmpdir(),'deskbot-facets-integration-')),file=join(dir,'test.sqlite');
  let at=BASE,persistence=createSqlitePersistence({filename:file}),world,loop;
  const now=()=>new Date(at);
  const reload=()=>{world=createPersistentWorld({persistence,now,timeMode:'realtime'});loop=createAutonomousLife({world,now,enabled:true});};
  reload();createWorldLife({worldSnapshot:()=>world.get(),ingest:e=>world.ingest(e),now,enabled:true}).seedNpcs();
  const w=world.get();installAutonomy(w,now().toISOString());
  for(const state of Object.values(w.autonomy.actors))state.paused=state.actor_id!==OWN;
  w.protagonist.location_id='moss-sprout-garden';
  Object.assign(w.living.objects['garden-bed'],{moisture:.6,growth:.2,health:.9});
  w.living.objects['seedling-rack'].stock.trays=2;
  installLivedMemory(w,now().toISOString(),{plannerEnabled:planner});
  persistence.put('canonical-world.states',w.world_id,w);reload();
  t.after(()=>{persistence.close();rmSync(dir,{recursive:true,force:true});});
  return {get world(){return world;},get loop(){return loop;},now,
    mutate(action,payload={},id=`fixture:${action}:${at}`){return world.ingest({event_id:id,type:'world.mutation',source:'fixture-world',character_id:OWN,occurred_at:now().toISOString(),payload:{action,...payload}});},
    save(fn){const current=world.get();fn(current);persistence.put('canonical-world.states',current.world_id,current);reload();},
    advance(ms){at+=ms;world.syncWallClock();world.syncTasks();},
    restart(){persistence.close();persistence=createSqlitePersistence({filename:file});reload();}};
}
function actual(id,day,activity='water-bed',extra={}) {
  const at=new Date(BASE+day*DAY).toISOString();
  return {task_id:id,actor_id:OWN,status:'completed',kind:'care',life_action:'activity',activity_id:activity,
    life_goal:'water',origin:'autonomous_life',life_source_ids:[],location_id:'moss-sprout-garden',finished_at:at,
    completion_effect:LIVING_RULE_VERSION,completion:{due_at:at,effect:LIVING_RULE_VERSION,result:{success:true}},
    life_motivation:{kind:'self_continuation',basis_score:31,facet_root_ids:[]},...extra};
}

test('an enacted authored observation is active attention without granting recipe ability, and survives restart',t=>{
  const h=fixture(t);h.loop.tick();let w=h.world.get(),task=w.tasks.find(t=>t.actor_id===OWN&&t.status==='running');
  assert.equal(own(w).plan.goal,'interest:moss-sprout-garden');
  assert.equal(task.life_action,'observe');assert.equal(task.life_topic,'care');assert.equal(task.life_motivation.kind,'self_continuation');
  assert.equal(topic(w,'care').interest.active_roots.length,0);
  h.advance(15*MINUTE);w=h.world.get();const read=topic(w,'care');
  assert.deepEqual(read.interest.active_roots,[`task:${task.task_id}`]);
  assert.deepEqual(read.capability.root_outcome_ids,[]);assert.equal(read.wish.status,'not_established');
  const before=developmentFacetsReadModel(w);h.restart();assert.deepEqual(developmentFacetsReadModel(h.world.get()),before);
});

test('an owner invitation improves actual ability while preference awaits a later voluntary continuation',t=>{
  const h=fixture(t);h.mutate('install_input_refraction');
  h.world.ingest({event_id:'owner-care',type:'conversation.input',source:'user',character_id:OWN,occurred_at:h.now().toISOString(),
    payload:{text:'喵呜，你有空整理一下苗床吗？'}},{attestedKind:'user',sourceLabel:'用户对话'});
  h.loop.tick();let w=h.world.get(),task=w.tasks.find(t=>t.actor_id===OWN&&t.status==='running');
  assert.equal(task.activity_id,'tend-bed');assert.equal(task.life_motivation.kind,'invited');
  h.advance(12*MINUTE);w=h.world.get();let read=topic(w,'care');
  assert.deepEqual(read.interest.invited_roots,[`task:${task.task_id}`]);assert.deepEqual(read.interest.active_roots,[]);
  assert.deepEqual(read.capability.success_roots,[`task:${task.task_id}`]);
  h.save(current=>{own(current).plan=null;own(current).cooldowns={};own(current).next_decision_at=h.now().toISOString();
    current.living.objects['garden-bed'].health=.8;
    for(const record of current.refraction.records)record.status='completed';});
  h.loop.tick();w=h.world.get();task=w.tasks.find(t=>t.actor_id===OWN&&t.status==='running');
  assert.equal(own(w).plan.goal,'continue:care');assert.equal(task.life_motivation.kind,'self_continuation');
  assert.ok(task.reservation.status==='held','a continuation must use the ordinary finite-resource reservation');
  h.advance(12*MINUTE);read=topic(h.world.get(),'care');
  assert.equal(read.interest.active_roots.length,1);assert.equal(read.capability.success_roots.length,2);
  assert.equal(read.interest.bonus,0,'one continuation day does not establish stable attention');
});

test('new facets replace a legacy bonus, cap preference at six, and keep urgent choices above optional attention',t=>{
  const h=fixture(t,{planner:true});const w=h.world.get();
  w.memory.actors[OWN].interests.care={topic:'care',stage:'familiar',bonus:12,successes:20,setbacks:0,days:[],evidence_ids:['legacy-private']};
  w.tasks.push(actual('active-one',-3),actual('active-two',-2,'tend-bed'),actual('active-three',-1));
  syncLivedMemory(w,h.now().toISOString());
  const choices=influenceRememberedChoices(w,own(w),[
    {goal:'water',score:30,available:true,reason:'再照看一会'},
    {goal:'repair:repair-bench',score:52,available:true,reason:'先修坏的工作台'},
  ]);
  assert.equal(topic(w,'care').interest.bonus,6);assert.equal(choices.find(c=>c.goal==='water').score,36);
  assert.equal(choices.find(c=>c.goal==='water').memory_bonus,6);
  const selection=prepareLifeChoice(w,own(w),choices,h.now().toISOString());
  assert.equal(selection.choice.goal,'repair:repair-bench');assert.equal(selection.decision.source,'needs');
  assert.equal(w.memory.actors[OWN].interests.care.bonus,12,'the old record is preserved but is no longer consumed');
});

test('a discretionary attempt cannot be repeated the same day or admitted when tired or supplies are limited',t=>{
  for(const condition of ['already-practiced','tired','low-water']) {
    const h=fixture(t);h.save(w=>{
      w.refraction={records:[{id:'contact-care',origin_id:'contact-care',category:'dialogue',attested:true,freshness:'fresh',suggestion:'tend',
        received_at:h.now().toISOString(),status:'completed'}],recent:[],revision:0};
      w.living.objects['garden-bed'].health=.8;
      if(condition==='already-practiced')w.tasks.push(actual('daily-practice',0));
      if(condition==='tired')own(w).energy=.5;
      if(condition==='low-water')w.living.objects['seedling-rack'].stock.water=5;
      syncLivedMemory(w,h.now().toISOString());
    });h.loop.tick();
    assert.ok(!own(h.world.get()).last_candidates.some(c=>c.goal==='continue:care'&&c.available),condition);
  }
});

test('conditions and duties remain separate from liking, and role directions receive the same finite roots without unlocking',t=>{
  const h=fixture(t),w=h.world.get();
  w.tasks.push(actual('duty',-1,'cook-grove-stew',{life_goal:'meal',location_id:'warm-pot-courtyard',life_motivation:{kind:'need',basis_score:90,facet_root_ids:[]}}),
    actual('shortage',0,'cook-grove-stew',{life_goal:'meal',location_id:'warm-pot-courtyard',status:'failed',failure_reason:'私人失败说明',
      failure_code:'resource_insufficient',failure_classification:'resource',completion:{due_at:h.now().toISOString(),effect:'no_effect',result:{success:false}}}));
  syncLivedMemory(w,h.now().toISOString());const read=topic(w,'cook');
  assert.equal(read.interest.bonus,0);assert.deepEqual(read.interest.obligation_roots,['task:duty']);
  assert.deepEqual(read.capability.success_roots,['task:duty']);assert.deepEqual(read.capability.condition_failure_roots,['task:shortage']);
  assert.deepEqual(read.capability.performance_failure_roots,[]);
  const chef=roleDevelopmentReadModel(w).directions.find(d=>d.direction_id==='chef');
  assert.deepEqual(chef.capability.success_roots,read.capability.success_roots);
  assert.deepEqual(chef.capability.condition_failure_roots,read.capability.condition_failure_roots);
  assert.equal(chef.unlocked,false);assert.equal(chef.wish_stability.status,'not_established');
});

test('choice and ordinary dialogue prompts use safe separate facets instead of old private interest or failure prose',t=>{
  const h=fixture(t,{planner:true}),w=h.world.get();
  w.memory.actors[OWN].interests.care={topic:'private-legacy-label',stage:'familiar',bonus:12,successes:88,days:[],evidence_ids:['private-legacy-root']};
  w.tasks.push(actual('private-task-id',-1,'tend-bed',{status:'failed',failure_reason:'private-failure-prose',failure_code:'resource_insufficient',failure_classification:'resource',
    completion:{due_at:new Date(BASE-DAY).toISOString(),effect:'no_effect',result:{success:false}}}));
  syncLivedMemory(w,h.now().toISOString());
  const context=modelDevelopmentContext(w);assert.doesNotMatch(JSON.stringify(context),/private-/);
  const choices=[{goal:'interest:moss-sprout-garden',score:30,available:true,title:'观察苗圃',reason:'观察',facet_root_ids:['private-task-id']},
    {goal:'interest:backlit-grove',score:30,available:true,title:'观察林间',reason:'观察'}];
  prepareLifeChoice(w,own(w),choices,h.now().toISOString());
  const request=w.memory.planner.requests[OWN];request.memories=[];
  const choicePrompt=lifeChoicePrompt(w,request);assert.doesNotMatch(choicePrompt,/private-/);assert.match(choicePrompt,/做成不等于喜欢/);
  const prompt=composePrompt({worldSnapshot:w,stateContext:'当前状态稳定。',userText:'你最近有兴趣继续做些什么？'}).prompt;
  assert.doesNotMatch(prompt,/private-/);assert.match(prompt,/条件困难不等于能力差/);
});

test('an added unmapped location cannot manufacture explore attention from a generic interest goal',t=>{
  const h=fixture(t);h.save(w=>{
    const id='unmapped-resident',location='unmapped-observation-place';
    w.npcs.push({npc_id:id,display_name:'新访客',location_id:location});
    w.locations.push({location_id:location,name:'尚未设计的地方'});
    installAutonomy(w,h.now().toISOString());
    for(const state of Object.values(w.autonomy.actors))state.paused=state.actor_id!==id;
  });h.loop.tick();let w=h.world.get();
  const task=w.tasks.find(t=>t.actor_id==='unmapped-resident'&&t.status==='running');
  assert.ok(task);assert.equal(task.life_action,'observe');assert.equal(task.life_topic,undefined);
  assert.equal(w.autonomy.actors['unmapped-resident'].plan.development_topic,null);
  h.advance(15*MINUTE);w=h.world.get();
  const episode=w.memory.episodes.find(e=>e.source.task_id===task.task_id);
  assert.equal(episode.topic,null);
  const view=developmentFacetsReadModel(w,{actorId:'unmapped-resident'});
  assert.ok(view.actors[0].topics.every(t=>!t.interest.active_roots.length&&!t.capability.root_outcome_ids.length));
});

test('classified failure metadata survives task pruning and a ledger reconstructed from canonical episodes',t=>{
  const h=fixture(t),w=h.world.get();
  w.tasks.push(actual('durable-shortage',0,'cook-grove-stew',{status:'failed',failure_reason:'private failure wording',
    failure_code:'resource_insufficient',failure_classification:'resource',
    completion:{due_at:h.now().toISOString(),effect:'no_effect',result:{success:false}}}));
  syncLivedMemory(w,h.now().toISOString());
  const source=w.memory.episodes.find(e=>e.source.task_id==='durable-shortage').source;
  assert.equal(source.failure_code,'resource_insufficient');assert.equal(source.failure_classification,'resource');
  assert.doesNotMatch(JSON.stringify(source),/private failure wording/);
  delete w.memory.development;w.tasks=[];syncLivedMemory(w,h.now().toISOString());
  assert.deepEqual(topic(w,'cook').capability.condition_failure_roots,['task:durable-shortage']);
  assert.deepEqual(topic(w,'cook').capability.unknown_failure_roots,[]);
});

test('a broad topic ability summary cannot serve as mapped direction prerequisite evidence',t=>{
  const h=fixture(t),w=h.world.get();
  w.tasks.push(...[-3,-2,-1].map(day=>actual(`forest-fruit:${day}`,day,'gather-light-fruit',{location_id:'backlit-grove'})));
  syncLivedMemory(w,h.now().toISOString());
  assert.equal(topic(w,'care').capability.status,'repeated_in_context');
  const frog=roleDevelopmentReadModel(w).directions.find(d=>d.direction_id==='wetland_frog');
  assert.deepEqual(frog.capability.success_roots,[]);
  assert.equal(frog.capability.prerequisite_evidence_basis,'direction_mapped_activity_roots_only');
  assert.equal(frog.capability.topics.find(t=>t.topic==='care').scope,'related_topic_summary');
  assert.equal(frog.unlocked,false);
});

test('a long common ledger gives the same bonus while only sixteen threshold basis roots travel with a choice',t=>{
  const h=fixture(t),w=h.world.get();
  for(let day=-20;day<0;day++)for(let index=0;index<6;index++)
    w.tasks.push(actual(`many:${day}:${index}`,day,index%2?'tend-bed':'water-bed'));
  syncLivedMemory(w,h.now().toISOString());const before=structuredClone(w.memory.development.records);
  const care=topic(w,'care');assert.equal(care.interest.active_roots.length,120);
  assert.equal(care.interest.threshold_root_ids.length,40);
  const candidate=influenceRememberedChoices(w,own(w),[{goal:'water',score:30,available:true,reason:'再照看一会'}])[0];
  assert.equal(candidate.score,36);assert.equal(candidate.memory_bonus,6);
  assert.equal(candidate.facet_root_ids.length,16);
  assert.ok(candidate.facet_root_ids.every(id=>care.interest.threshold_root_ids.includes(id)));
  assert.deepEqual(w.memory.development.records,before,'limiting a causal reference does not prune the common ledger');
});

test('provider context includes at most four registered outcomes with authored failure reasons and no private details',t=>{
  const h=fixture(t),w=h.world.get();
  w.tasks.push(actual('private-root:old',-4,'water-bed'),actual('private-root:completed',-3,'cook-grove-stew'),
    actual('private-root:unknown-failure',-2,'tend-bed',{title:'private task title',status:'failed',failure_reason:'private soil and hand story',
      failure_code:'private_failure_code',failure_classification:'condition',completion:{due_at:new Date(BASE-2*DAY).toISOString(),effect:'no_effect',result:{success:false}}}),
    actual('private-root:crop-failure',-1,'tend-bed',{title:'private task title',status:'failed',failure_reason:'private soil and hand story',
      failure_code:'crop_absent',failure_classification:'condition',completion:{due_at:new Date(BASE-DAY).toISOString(),effect:'no_effect',result:{success:false}}}),
    actual('private-root:latest',0,'water-bed'),actual('private-root:future',1,'water-bed'));
  syncLivedMemory(w,h.now().toISOString());const context=modelDevelopmentContext(w);
  assert.equal(context.recent_actual_outcomes.length,4);
  assert.deepEqual(context.recent_actual_outcomes.map(r=>r.activity_id),['water-bed','tend-bed','tend-bed','cook-grove-stew']);
  const emptyCrop=context.recent_actual_outcomes[1];
  assert.equal(emptyCrop.failure.classification,'condition');assert.match(emptyCrop.failure.known_reason,/苗床已经空|苗木不在/);
  const unknown=context.recent_actual_outcomes[2];
  assert.deepEqual(unknown.failure,{classification:'condition'});
  assert.equal(unknown.title,'整理和照料苗木');
  assert.doesNotMatch(JSON.stringify(context),/private|"root_outcome_id"|"source_record_id"|soil|hand/);
  const prompt=composePrompt({worldSnapshot:w,stateContext:'当前状态稳定。',userText:'这次照料没做成，是什么原因？'}).prompt;
  assert.match(prompt,/尚无做成依据/);assert.match(prompt,/不补写亲历过程/);assert.match(prompt,/不从当前湿度/);
});

test('contact-only provider context has no actual outcome and explicitly retains zero successful practice',t=>{
  const h=fixture(t),w=h.world.get();
  w.refraction={records:[{id:'private-contact-id',origin_id:'private-owner-id',category:'dialogue',attested:true,freshness:'fresh',suggestion:'tend',
    text:'private owner text',received_at:h.now().toISOString(),status:'completed'}],recent:[],revision:0};
  syncLivedMemory(w,h.now().toISOString());const context=modelDevelopmentContext(w),care=context.topics.find(t=>t.topic==='care');
  assert.equal(care.contact_count,1);assert.equal(care.capability.successful_practice,0);
  assert.deepEqual(context.recent_actual_outcomes,[]);assert.doesNotMatch(JSON.stringify(context),/private/);
});
