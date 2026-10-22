import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cases,hash,source,tick,plus,opportunity,settle} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {interestFixture,interestCases} from '../../../services/deskbot-cognition/evaluations/r3-interest-fixtures.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,cognitiveActualResult,settleCognitiveTask} from '../src/cognitive-life-state.mjs';
import {refractInput} from '../src/input-refraction.mjs';
import {startActivityTask,advanceWorldTask} from '../src/realtime-world.mjs';
import {syncLivedMemory} from '../src/lived-memory.mjs';
import {waylightTradeoffs} from '../src/waylight-life.mjs';
const owner='shaping-001';
function plan(w,compiled){
  const at=w.clock.synced_at,job='r3-regression';
  applyCognitiveMutation(w,{actor_id:owner,operation:'claim',phase:'plan',job_id:job},at,job+':claim');
  applyCognitiveMutation(w,{actor_id:owner,operation:'plan',phase:'plan',job_id:job,relevant_key:cognitiveRelevantKey(w,owner),proposal:{
    schema:'deskbot.cognitive-life.proposal.v3',actor_id:owner,phase:'plan',state:{agent_id:owner},
    memories:[],action:{agent_id:owner,action_description:compiled.title},compiled,
  }},at,job+':plan');
  return w.tasks.find(t=>t.task_id===w.cognition.actors[owner].pending.task_id);
}
test('R3 has 18 matched pairs, deterministic finite prior and only declared interventions',()=>{
  assert.equal(cases.length,36);
  for(let n=0;n<cases.length;n+=2){
    const a=fixture(cases[n]),b=fixture(cases[n+1]);
    assert.equal(hash(a),hash(fixture(cases[n])));
    assert.equal(a.living.objects['floating-frame'].waylight.setup_root,'task:fixture-built-lamp');
    assert.equal(a.tasks.find(t=>t.task_id==='fixture-built-lamp').status,'completed');
    const ctx=cognitiveContext(b,owner,b.clock.synced_at);
    assert.ok(ctx.waylight.law);
    assert.equal(ctx.inputs.length,cases[n].group==='resources'?0:1);
    assert.equal(b.protagonist.character_id,a.protagonist.character_id);
    assert.equal(opportunity(a,owner).raw.free,true);
    assert.equal(opportunity(a,owner).strict_two,true);
    if(cases[n].group!=='resources')assert.deepEqual(b.living.inventories,a.living.inventories);
    if(cases[n].group!=='weather')assert.deepEqual(b.living.objects,a.living.objects);
  }
});
test('input duplicates, expired and future reports cannot mint practice or keep entering current cognition',()=>{
  const w=fixture(cases.find(c=>c.group==='advice'&&c.on));
  const before=hash(w.memory.development);
  // Test actual origin replay, not only matching text.
  const initial=source(w,'external.report',{text:'样本资料'},'provider','测试资料','repeat-origin').event;
  const count=w.refraction.records.length;
  const duplicate=refractInput(w,{...initial,event_id:'repeat-copy',correlation_id:'repeat-origin'},w.clock.synced_at,{attestedKind:'provider',sourceLabel:'测试资料'});
  assert.equal(duplicate.reason,'origin_already_considered');
  assert.equal(w.refraction.records.length,count);
  source(w,'external.report',{text:'过期资料'},'provider','旧资料','expired',{observed_at:plus(w.clock.synced_at,-1500)});
  source(w,'sensor.touch',{region:'head'},'device','设备','future',{observed_at:plus(w.clock.synced_at,3)});
  const inputs=cognitiveContext(w,owner,w.clock.synced_at).inputs;
  assert.ok(inputs.every(i=>!['expired','future'].includes(i.event_id)));
  assert.equal(hash(w.memory.development),before);
  tick(w,plus(w.clock.synced_at,1500));
  assert.equal(cognitiveContext(w,owner,w.clock.synced_at).inputs.length,0);
});
test('missing shade cannot complete installation; restart and repeat settlement do not grow evidence twice',()=>{
  let w=fixture(cases.find(c=>c.group==='resources'&&c.on));
  assert.throws(()=>startActivityTask(w,{actor_id:owner,task_id:'no-shade',activity_id:'waylight-fit-shade'},{eventId:'no-shade',at:w.clock.synced_at}),{code:'activity_unavailable'});
  assert.equal(w.living.objects['floating-frame'].waylight.has_hood,false);
  w=JSON.parse(JSON.stringify(w));
  const t=w.tasks.find(t=>t.task_id==='fixture-built-lamp');
  const before=hash(w);
  assert.throws(()=>advanceWorldTask(w,{task_id:t.task_id,expected_task_revision:t.revision},w.clock.synced_at),{code:'task_state_changed'});
  syncLivedMemory(w,w.clock.synced_at);
  assert.equal(hash(w),before);
});

test('a misleading share title never certifies a material transfer, including legacy task titles',()=>{
  let w=fixture(cases[0]);w.living.inventories[owner].stock.water=4;
  const task=plan(w,{operation:'share',receiver_indices:[1],title:'把四份清水交给苔团',reason:'想送水',
    message_parts:[{kind:'intention',text:'我想把这四份清水送给你。'}]});
  assert.match(task.title,/留言/);
  assert.doesNotMatch(task.title,/清水/);
  settle(w,task);task.title='把四份清水交给苔团'; // An older saved task may retain this title.
  const result=cognitiveActualResult(w,owner,w.clock.synced_at);
  assert.match(result.fact,/没有交付物品/);
  assert.doesNotMatch(result.fact,/「把四份清水交给苔团」已实际完成/);
  assert.equal(result.effects.message_delivery.material_transfer,false);
  assert.equal(result.effects.inventory.after.stock.water,4);
  w.cognition.actors[owner].last_result=result;
  const evidence=cognitiveContext(w,owner,w.clock.synced_at).speech_evidence.find(e=>e.id===result.root_outcome_id);
  assert.match(evidence.text,/只核验话语送达/);
  assert.doesNotMatch(evidence.text,/交给苔团/);
  w=JSON.parse(JSON.stringify(w));
  w.living.inventories[owner].stock.water=9;
  settleCognitiveTask(w,w.tasks.find(t=>t.task_id===task.task_id),w.clock.synced_at);
  assert.deepEqual(cognitiveActualResult(w,owner,w.clock.synced_at),result);
});

test('activity feedback freezes actual stock and distinguishes start reservation from completion output',()=>{
  const w=fixture(cases[0]);
  const task=plan(w,{operation:'activity',activity_id:'waylight-use',title:'用掉一份清水',reason:'核对输入输出'});
  assert.equal(task.title,'借归途灯净滤一桶晚归的水');
  settle(w,task);
  const result=cognitiveActualResult(w,owner,w.clock.synced_at);
  assert.deepEqual(result.effects.reservation,{status:'consumed',inputs:[{container:'floating-frame',resource:'raw_water',count:4}]});
  assert.equal(result.effects.inventory.before.stock.water,undefined);
  assert.equal(result.effects.inventory.after.stock.water,4);
  assert.equal(task.completion.result.before.stock.raw_water,task.completion.result.after.stock.raw_water);
  assert.match(result.fact,/禁止再次扣料/);
  w.living.objects['floating-frame'].stock.raw_water=0;
  w.living.inventories[owner].stock.water=0;
  settleCognitiveTask(w,task,w.clock.synced_at);
  assert.deepEqual(cognitiveActualResult(w,owner,w.clock.synced_at),result);
});

test('interest fixtures finish recovery before authoring a consistent present',()=>{
  for(const c of interestCases){
    const w=interestFixture(c),bed=w.living.objects['garden-bed'];
    assert.equal(w.living.simulated_until,w.clock.synced_at);
    assert.equal(w.living.recovery.pending,false);
    assert.equal(bed.dead_quantity,0);
    assert.equal(bed.glow_moss.moisture,bed.moisture);
    const now=w.clock.synced_at;
    tick(w,plus(now,1));
    assert.equal(w.living.recovery.pending,false);
    assert.ok(w.living.objects['garden-bed'].health>.8);
  }
});

test('lighting tradeoffs come from the same finite law, expose real tension and create no experience',()=>{
 const lamp={charge:.25,condition:1,moisture:0};
 const before=structuredClone(lamp),view=waylightTradeoffs(lamp);
 assert.equal(view.choices[0].night_brightness,.25);
 assert.equal(view.choices[1].night_brightness,.155);
 assert.equal(view.choices[0].filtration_light_enough,true);
 assert.equal(view.choices[1].filtration_light_enough,false);
 assert.ok(view.choices[0].night_charge_cost_per_hour>view.choices[1].night_charge_cost_per_hour);
 assert.deepEqual(lamp,before);
 const w=fixture(cases[0]),contexts=['shaping-001','wetland-grower-001','lamp-keeper-001'].map(id=>cognitiveContext(w,id,w.clock.synced_at));
 assert.deepEqual(contexts[0].waylight.tradeoffs,contexts[1].waylight.tradeoffs);
 assert.notEqual(contexts[0].waylight.authored_preference,contexts[1].waylight.authored_preference);
 assert.ok(contexts.every(c=>!('selected_action' in c.waylight.tradeoffs)));
});
