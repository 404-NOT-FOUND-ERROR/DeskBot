import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { installResidentLife } from '../src/resident-life.mjs';
import { installResidentProjects } from '../src/resident-projects.mjs';
import { advanceAutonomousLife } from '../src/autonomous-life.mjs';
import { activitySteps, depositSteps } from '../src/life-planning.mjs';
import { advanceLivingResources } from '../src/living-resources.mjs';
import { advanceWorldTask, applyRealTimeClock } from '../src/realtime-world.mjs';

const START=Date.parse('2026-10-05T04:00:00Z'),MINUTE=60000,HOUR=60*MINUTE,DAY=24*HOUR,OWN='shaping-001';
const iso=time=>new Date(time).toISOString();
const bag=(w,id,resource)=>w.living.inventories[id]?.stock?.[resource]??0;
let steadyReport=null;
function fixture({social=true,projects=false}={}) {
  let time=START,sequence=0;
  let world=createPersistentWorld({timeMode:'realtime',now:()=>new Date(time)}).get();
  installResidentLife(world,iso(time));
  if(projects)installResidentProjects(world,iso(time));
  if(!social)world.social=null;
  const completed=new Map(),samples=[];
  function capture(task) {if(task.status==='completed')completed.set(task.task_id,structuredClone(task));}
  function ecology(at) {advanceLivingResources(world,iso(at),{force:true});applyRealTimeClock(world,iso(at));world.updated_at=iso(at);}
  function recover(at) {
    let task;
    while((task=world.tasks.filter(t=>t.status==='running'&&Date.parse(t.due_at)<=at).sort((a,b)=>a.due_at.localeCompare(b.due_at))[0])) {
      const due=Date.parse(task.due_at);ecology(due);
      capture(advanceWorldTask(world,{task_id:task.task_id,expected_task_revision:task.revision},iso(due)).task);
    }
    ecology(at);
  }
  return {get world(){return world;},get time(){return time;},completed,samples,
    tick(){return advanceAutonomousLife(world,iso(time),{eventId:`supply-cycle:${++sequence}`});},
    advance(minutes=5,{tick=true}={}){time+=minutes*MINUTE;recover(time);if(tick)this.tick();},
    restart(){
      // Reconstruct through the actual persisted-world loader from serialized
      // local state. SQLite reservation checkpoints are tested separately.
      const records=new Map([['canonical-world.states',new Map([[world.world_id,JSON.stringify(world)]])]]);
      const persistence={list:ns=>Array.from(records.get(ns)?.values()??[],value=>JSON.parse(value)),get:(ns,key)=>records.get(ns)?.has(key)?JSON.parse(records.get(ns).get(key)):null,
        put(ns,key,value){if(!records.has(ns))records.set(ns,new Map());records.get(ns).set(key,JSON.stringify(value));}};
      world=createPersistentWorld({persistence,timeMode:'realtime',now:()=>new Date(time)}).get();
    },
    pauseExcept(ids){for(const state of Object.values(world.autonomy.actors))state.paused=!ids.includes(state.actor_id);},
    move(id,location){(id===OWN?world.protagonist:world.npcs.find(n=>n.npc_id===id)).location_id=location;},
  };
}

test('hungry plan selects finite grove ingredients after rolling back a partial unavailable moss alternative',()=>{
  const h=fixture({social:false}),w=h.world;
  h.move(OWN,'warm-pot-courtyard');
  w.living.objects['shared-table'].stock.rations=0;
  w.living.objects['seedling-rack'].stock.moss=1;
  w.living.objects['light-fruit-bough'].stock.light_fruit=2;
  const before=structuredClone(w),steps=activitySteps(w,OWN,'share-meal');
  assert.deepEqual(w,before,'a planning projection changes no actual stock, outcomes or positions');
  assert.deepEqual(steps.filter(s=>s.kind==='activity').map(s=>s.activity_id),['gather-light-fruit','cook-grove-stew','share-meal']);
  assert.equal(steps.some(s=>s.kind==='transfer'&&s.resource==='moss'),false,'failed moss preparation leaves no partial deduction in the alternative');
  assert.equal(steps.find(s=>s.kind==='transfer'&&s.resource==='rations').count,3,'every cooked portion is placed on the shared table');
});

test('actual batch cooking shares leftovers and hunger changes only after the eater completes',()=>{
  const h=fixture({social:false}),w=h.world;h.pauseExcept([OWN]);h.move(OWN,'warm-pot-courtyard');
  w.autonomy.actors[OWN].appetite=.95;
  w.living.objects['shared-table'].stock.rations=0;
  w.living.inventories[OWN]={stock:{light_fruit:2},capacity:24};
  h.tick();assert.equal(w.autonomy.actors[OWN].plan.goal,'meal');
  assert.equal(w.tasks.find(t=>t.status==='running').activity_id,'cook-grove-stew');
  assert.equal(w.autonomy.actors[OWN].appetite,.95);
  for(let i=0;i<50&&!h.completed.size;i++)h.advance(1);
  assert.equal(h.completed.values().next().value.activity_id,'cook-grove-stew');
  assert.equal(h.world.living.objects['shared-table'].stock.rations,3);assert.equal(bag(h.world,OWN,'rations'),0);
  assert.ok(h.world.autonomy.actors[OWN].appetite>.95);
  for(let i=0;i<30&&!Array.from(h.completed.values()).some(t=>t.activity_id==='share-meal');i++)h.advance(1);
  assert.equal(h.world.living.objects['shared-table'].stock.rations,2);
  assert.equal(bag(h.world,OWN,'rations'),0);
  assert.ok(h.world.autonomy.actors[OWN].appetite<.4);
});

test('a hungry carrier first exposes actual carried food, with partial capacity preserving the remainder',()=>{
  const h=fixture({social:false});h.pauseExcept([OWN]);h.move(OWN,'warm-pot-courtyard');
  const w=h.world;w.autonomy.actors[OWN].appetite=.99;
  w.living.objects['shared-table'].stock.rations=23;
  w.living.inventories[OWN]={stock:{rations:3},capacity:24};
  h.tick();assert.equal(w.autonomy.actors[OWN].plan.goal,'store-meals');
  assert.equal(w.living.objects['shared-table'].stock.rations,24);assert.equal(bag(w,OWN,'rations'),2);
  assert.equal(w.autonomy.actors[OWN].appetite,.99);
  const heldWorld=structuredClone(w);
  heldWorld.living.objects['shared-table'].stock.rations=22;
  heldWorld.tasks=[{reservation:{status:'held',inputs:[{container:'shared-table',resource:'rations',count:1}]}}];
  assert.equal(depositSteps(heldWorld,OWN,'shared-table','rations')[0].count,1,'a held portion keeps its return capacity');
});

test('present hungry people queue by need instead of an earlier dispatch taking the only portion',()=>{
  const h=fixture({social:false}),w=h.world,id='pot-cook-001';h.pauseExcept([OWN,id]);
  for(const person of [OWN,id])h.move(person,'warm-pot-courtyard');
  w.autonomy.actors[OWN].appetite=.75;w.autonomy.actors[id].appetite=.99;
  w.living.objects['shared-table'].stock.rations=1;
  h.tick();
  assert.equal(w.tasks.find(t=>t.activity_id==='share-meal'&&t.status==='running').actor_id,id);
  assert.equal(w.autonomy.actors[OWN].plan.goal,'wait-meal');
  assert.equal(w.living.objects['shared-table'].stock.rations,0,'only the actual meal reserves the finite portion');
  assert.equal(w.autonomy.actors[OWN].appetite,.75);
});

test('an active peer preparation is a soft claim; paused and stale idle plans release the claim',()=>{
  const h=fixture({social:false}),w=h.world,id='pot-cook-001';h.pauseExcept([OWN,id]);
  h.move(OWN,'warm-pot-courtyard');h.move(id,'backlit-grove');
  w.autonomy.actors[OWN].appetite=.99;
  w.living.objects['shared-table'].stock.rations=0;
  w.living.objects['light-fruit-bough'].stock.light_fruit=2;
  w.autonomy.actors[id].plan={status:'planned',created_at:iso(START),index:0,plan_id:'peer-prepare',steps:[{kind:'activity',activity_id:'gather-light-fruit'},{kind:'activity',activity_id:'cook-grove-stew'}]};
  w.autonomy.actors[id].next_decision_at=iso(START+60*MINUTE);
  h.tick();assert.equal(w.autonomy.actors[OWN].plan.goal,'wait-meal');
  assert.equal(w.living.objects['light-fruit-bough'].stock.light_fruit,2,'a promise does not reserve the ecological source');
  const state=w.autonomy.actors[OWN];state.plan=null;state.next_decision_at=iso(START);w.tasks=[];
  w.autonomy.actors[id].paused=true;h.tick();assert.equal(w.autonomy.actors[OWN].plan.goal,'meal');
  assert.equal(w.living.objects['light-fruit-bough'].stock.light_fruit,2);
  w.autonomy.actors[OWN].plan=null;w.autonomy.actors[OWN].next_decision_at=iso(START);w.tasks=[];w.autonomy.actors[id].paused=false;
  w.autonomy.actors[id].plan.created_at=iso(START-121*MINUTE);h.tick();
  assert.equal(w.autonomy.actors[OWN].plan.goal,'meal');
});

test('thirteen unpaused residents sustain fourteen simulated days from finite authored stocks and renewable sources',t=>{
  // This is an accelerated rules experiment, not fourteen days of production
  // observation. Ecological time and task deadlines retain their real durations;
  // the scheduler checks every five simulated minutes and uses no provider.
  const h=fixture({social:true,projects:true});
  assert.equal(Object.keys(h.world.autonomy.actors).length,13);
  assert.equal(h.world.living.objects['light-fruit-bough'].stock.light_fruit,0);
  const initialParts=structuredClone(h.world.living.objects['parts-drawers'].stock),hourly=[];
  h.tick();
  for(let step=1;step<=14*24*12;step++) {
    h.advance(5);
    if(step===7*24*12)h.restart();
    if(step%12===0) {
      const actors=Object.values(h.world.autonomy.actors);
      hourly.push({hour:step/12,very_hungry:actors.filter(s=>s.appetite>.9).length,table:h.world.living.objects['shared-table'].stock.rations});
      assert.ok(actors.every(s=>s.paused===false&&s.appetite>=0&&s.appetite<=1));
      for(const object of Object.values(h.world.living.objects))for(const value of Object.values(object.stock??{}))assert.ok(Number.isFinite(value)&&value>=-.000001&&value<=(object.capacity??24)+.000001);
      for(const inventory of Object.values(h.world.living.inventories))for(const value of Object.values(inventory.stock))assert.ok(value>=0&&value<=inventory.capacity);
    }
  }
  const meals=Array.from(h.completed.values()).filter(task=>task.activity_id==='share-meal');
  const counts=Object.fromEntries(Object.keys(h.world.autonomy.actors).map(id=>[id,meals.filter(task=>task.actor_id===id).length]));
  const postWarmup=hourly.filter(s=>s.hour>48);
  const summary={simulated_days:14,scheduler_minutes:5,residents:13,meals:meals.length,meals_by_actor:counts,
    max_very_hungry_after_48h:Math.max(...postWarmup.map(s=>s.very_hungry)),mean_very_hungry_after_48h:postWarmup.reduce((sum,s)=>sum+s.very_hungry,0)/postWarmup.length,
    final_rations:h.world.living.objects['shared-table'].stock.rations,food_help:h.world.social.commitments.filter(c=>c.kind==='food-help'&&c.status==='completed').length,
    completed_projects:Object.values(h.world.resident_projects.projects).filter(p=>p.status==='completed').map(p=>p.project_id),
    final_parts:h.world.living.objects['parts-drawers'].stock};
  t.diagnostic(JSON.stringify(summary));
  steadyReport=summary;
  assert.ok(Object.values(counts).every(count=>count>=8),'every resident must actually complete repeated meals across the experiment');
  assert.ok(summary.mean_very_hungry_after_48h<2,'a persistently hungry majority cannot count as a stable supply system');
  assert.ok(postWarmup.every((sample,index)=>sample.very_hungry<5||postWarmup.slice(index,index+6).some(next=>next.very_hungry<5)),'five or more residents cannot remain very hungry for six consecutive hours');
  for(const [resource,count]of Object.entries(initialParts))assert.ok((h.world.living.objects['parts-drawers'].stock[resource]??0)<=count,'finite workshop materials are not resupplied');
  const before=structuredClone(h.world);h.restart();assert.deepEqual(h.world,before,'restart preserves stock, plans and actual outcomes');
  const previousTasks=new Set(before.tasks.map(task=>task.task_id)),beforeMeals=meals.length;
  h.advance(24*60,{tick:false});
  assert.ok(h.world.tasks.every(task=>previousTasks.has(task.task_id)),'offline elapsed time can finish existing tasks but invents no new labor');
  assert.equal(Array.from(h.completed.values()).filter(task=>task.activity_id==='share-meal').length-beforeMeals,
    before.tasks.filter(task=>task.activity_id==='share-meal'&&task.status==='running').length,'offline meals only finish portions reserved before departure');
});

test('an exhausted thirteen-person save recovers through actual harvest, cooking and distribution within forty-eight hours',t=>{
  const h=fixture({social:true,projects:true}),w=h.world,frames=[];
  for(const state of Object.values(w.autonomy.actors))Object.assign(state,{appetite:.97,energy:.5});
  Object.assign(w.living.objects['shared-table'].stock,{rations:0});
  Object.assign(w.living.objects['seedling-rack'].stock,{moss:0,light_fruit:0});
  Object.assign(w.living.objects['garden-bed'],{growth:.59});
  assert.equal(w.living.objects['light-fruit-bough'].stock.light_fruit,0);
  const captured=new Set(),capture=(key,label)=>{if(captured.has(key))return;captured.add(key);frames.push({key,label,at:iso(h.time),elapsed_hours:(h.time-START)/HOUR,world:structuredClone(h.world)});};
  capture('shortage','食材耗尽，十三人都很饿');
  h.tick();const hourly=[];
  for(let step=1;step<=72*12;step++) {
    h.advance(5);
    const current=h.world,active=current.tasks.filter(task=>task.status==='running');
    if(active.some(task=>task.activity_id==='gather-light-fruit'))capture('gathering','等光果真实成熟，再去林缘采集');
    if(active.some(task=>['cook-moss','cook-grove-stew','cook-leaf-soup'].includes(task.activity_id)))capture('cooking','厨房消耗真实食材，正在煮一锅饭');
    if(current.living.objects['shared-table'].stock.rations>=2&&Array.from(h.completed.values()).some(task=>task.activity_id==='cook-grove-stew'))capture('distributed','整锅余餐已放到公共长桌');
    if(step===36*12)h.restart();
    if(step%12===0) {
      const hungry=Object.values(current.autonomy.actors).filter(state=>state.appetite>.9).length;
      hourly.push({hour:step/12,very_hungry:hungry,table:current.living.objects['shared-table'].stock.rations});
      if(step/12>=24&&hungry<3)capture('recovered','采集、做饭和用餐持续衔接，饥饿多数已解除');
      assert.ok(Object.values(current.autonomy.actors).every(state=>!state.paused));
      for(const object of Object.values(current.living.objects))for(const count of Object.values(object.stock??{}))assert.ok(count>=-.000001&&count<=(object.capacity??24)+.000001);
    }
  }
  const meals=Array.from(h.completed.values()).filter(task=>task.activity_id==='share-meal');
  const counts=Object.fromEntries(Object.keys(h.world.autonomy.actors).map(id=>[id,meals.filter(task=>task.actor_id===id).length]));
  const summary={simulated_hours:72,scheduler_minutes:5,initial:{residents:13,appetite:.97,energy:.5,rations:0,moss:0,light_fruit:0,bed_growth:.59},
    meals:meals.length,meals_by_actor:counts,at_36h:hourly.find(s=>s.hour===36),at_48h:hourly.find(s=>s.hour===48),at_72h:hourly.find(s=>s.hour===72),
    mean_very_hungry_after_48h:hourly.filter(s=>s.hour>48).reduce((sum,s)=>sum+s.very_hungry,0)/24};
  t.diagnostic(JSON.stringify(summary));
  if(process.env.DESKBOT_SUPPLY_REPORT)writeFileSync(process.env.DESKBOT_SUPPLY_REPORT,JSON.stringify({schema:'deskbot.population-supply-experiment.v1',kind:'accelerated_rules_experiment',steady:steadyReport,shortage:summary,frames},null,2));
  assert.ok(Object.values(counts).every(count=>count>=2),'all thirteen residents must receive actual repeated meals after the deficit');
  assert.ok(summary.at_48h.very_hungry<4,'recovery must remove the hungry majority within forty-eight simulated hours');
  assert.ok(summary.mean_very_hungry_after_48h<2,'a transient recovery followed by persistent starvation is insufficient');
  assert.ok(captured.has('gathering')&&captured.has('cooking')&&captured.has('distributed')&&captured.has('recovered'));
});
