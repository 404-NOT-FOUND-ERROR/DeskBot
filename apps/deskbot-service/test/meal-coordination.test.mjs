import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {installResidentLife} from '../src/resident-life.mjs';
import {installMealCoordination} from '../src/meal-coordination.mjs';
import {advanceAutonomousLife} from '../src/autonomous-life.mjs';
import {advanceLivingResources} from '../src/living-resources.mjs';
import {startActivityTask,controlWorldTask,advanceWorldTask,applyRealTimeClock} from '../src/realtime-world.mjs';

const AT='2026-10-19T04:00:00.000Z',M=60000,iso=m=>new Date(Date.parse(AT)+m*M).toISOString();
function fixture(){
  const w=createPersistentWorld({timeMode:'realtime',now:()=>new Date(AT)}).get();installResidentLife(w,AT);installMealCoordination(w,AT);w.social=null;
  for(const p of [w.protagonist,...w.npcs])p.location_id='warm-pot-courtyard';
  for(const s of Object.values(w.autonomy.actors)){s.paused=true;s.appetite=.97;s.energy=.7;}
  return w;
}
function due(w,minutes){
  let t;while((t=w.tasks.filter(t=>t.status==='running'&&t.due_at<=iso(minutes)).sort((a,b)=>a.due_at.localeCompare(b.due_at))[0])) {
    advanceLivingResources(w,t.due_at,{force:true});applyRealTimeClock(w,t.due_at);
    advanceWorldTask(w,{task_id:t.task_id,expected_task_revision:t.revision},t.due_at);
  }
  advanceLivingResources(w,iso(minutes),{force:true});applyRealTimeClock(w,iso(minutes));
}

test('six finite seats permit simultaneous meals; paused reservations retain their seat and cancellation returns one portion',()=>{
  const w=fixture(),ids=Object.keys(w.autonomy.actors);w.living.objects['shared-table'].stock.rations=7;
  const start=(id,i,at=AT)=>startActivityTask(w,{actor_id:id,activity_id:'share-meal',task_id:`meal${i}`},{eventId:`e${i}`,at});
  for(let i=0;i<6;i++)start(ids[i],i);
  assert.deepEqual(w.tasks.map(t=>t.reservation.facility_slot),[0,1,2,3,4,5]);
  assert.equal(w.living.objects['shared-table'].stock.rations,1);assert.equal(w.autonomy.actors[ids[0]].appetite,.97);
  controlWorldTask(w,{task_id:'meal0',operation:'pause'},AT);
  assert.throws(()=>start(ids[6],6),/座位已满/);
  controlWorldTask(w,{task_id:'meal1',operation:'cancel'},AT);
  assert.equal(w.living.objects['shared-table'].stock.rations,2);
  start(ids[6],6);due(w,10);
  assert.equal(w.tasks.find(t=>t.task_id==='meal6').reservation.facility_slot,1);
  assert.equal(w.tasks.find(t=>t.task_id==='meal0').reservation.facility_slot,0);
  assert.equal(w.tasks.filter(t=>t.status==='completed'&&t.activity_id==='share-meal').length,5);
  assert.equal(w.tasks.find(t=>t.task_id==='meal0').status,'paused');assert.equal(w.living.objects['shared-table'].stock.rations,1);
  assert.ok(w.autonomy.actors[ids[6]].appetite<.4);
  assert.equal(w.autonomy.actors[ids[6]].last_meal_at,iso(10));
});

test('actual food wakes only interruptible queue waits, never user-paused tasks or other work',()=>{
  const w=fixture(),ids=Object.keys(w.autonomy.actors).slice(0,4);
  for(const [i,id] of ids.entries()) {
    const s=w.autonomy.actors[id];s.paused=false;
    const t=startActivityTask(w,{actor_id:id,task_id:`wait${i}`,kind:'care',title:'等这一餐',duration_seconds:900},{eventId:`wait${i}`,at:AT}).task;
    const stored=w.tasks.find(x=>x.task_id===t.task_id);Object.assign(stored,{origin:'autonomous_life',life_goal:'wait-meal',life_action:'observe'});
    s.plan={plan_id:`p${i}`,goal:'wait-meal',status:'executing',task_id:t.task_id,index:0,steps:[{kind:'observe'}],created_at:AT};
  }
  controlWorldTask(w,{task_id:'wait3',operation:'pause'},AT);
  w.living.objects['shared-table'].stock.rations=3;
  advanceAutonomousLife(w,AT,{eventId:'meal-ready'});
  assert.equal(w.tasks.filter(t=>t.wait_wakeup).length,3);
  assert.equal(w.tasks.find(t=>t.task_id==='wait3').status,'paused');
  assert.equal(w.tasks.filter(t=>t.activity_id==='share-meal'&&t.status==='running').length,3);
  assert.equal(w.living.objects['shared-table'].stock.rations,0);
  assert.ok(ids.slice(0,3).every(id=>w.autonomy.actors[id].appetite===.97),'waking does not count as eating');
  due(w,10);assert.ok(ids.slice(0,3).every(id=>w.autonomy.actors[id].appetite<.4));
});

test('food arrival does not wake reserved social actors or registered continuous cognition',()=>{
  const w=fixture(),[id,peer]=Object.keys(w.autonomy.actors);w.cognition={actors:{[peer]:{enabled:true,actor_id:peer}}};
  for(const [i,actorId] of [id,peer].entries()) {
    w.autonomy.actors[actorId].paused=false;
    startActivityTask(w,{actor_id:actorId,task_id:`wait${i}`,kind:'care',title:'等饭',duration_seconds:900},{eventId:`w${i}`,at:AT});
    Object.assign(w.tasks.find(t=>t.task_id===`wait${i}`),{origin:'autonomous_life',life_goal:'wait-meal',life_action:'observe'});
    w.autonomy.actors[actorId].plan={plan_id:`p${i}`,goal:'wait-meal',status:'executing',task_id:`wait${i}`,index:0,steps:[{kind:'observe'}],created_at:AT};
  }
  advanceAutonomousLife(w,AT,{eventId:'reserved',reservedActors:[id]});
  assert.ok(w.tasks.every(t=>t.status==='running'));assert.equal(w.tasks.some(t=>t.wait_wakeup),false);
});

test('cooked food is stored and the next timed task starts in one bounded dispatch; durations and inputs remain real',()=>{
  const w=fixture(),id=w.protagonist.character_id;w.autonomy.actors[id].paused=false;
  w.living.objects['shared-table'].stock.rations=0;w.living.inventories[id]={stock:{light_fruit:2},capacity:24};
  advanceAutonomousLife(w,AT,{eventId:'cook'});
  assert.equal(w.tasks.find(t=>t.status==='running').activity_id,'cook-grove-stew');assert.equal(w.living.inventories[id].stock.light_fruit,0);
  due(w,20);advanceAutonomousLife(w,iso(20),{eventId:'serve'});
  const meal=w.tasks.find(t=>t.status==='running'&&t.activity_id==='share-meal');assert.ok(meal);
  assert.equal(meal.started_at,iso(20));assert.equal(meal.due_at,iso(30));assert.equal(w.living.objects['shared-table'].stock.rations,2);
  assert.equal(w.living.inventories[id].stock.rations,0);assert.ok(w.autonomy.actors[id].appetite>.9);
});

test('installing coordination preserves stocks, plans, reservations and previous physical durations',()=>{
  const w=fixture();delete w.living.coordination;
  const before=structuredClone(w);assert.equal(installMealCoordination(w,AT),true);
  const upgraded=structuredClone(w);delete upgraded.living.coordination;assert.deepEqual(upgraded,before);
  assert.equal(installMealCoordination(w,AT),false);
});

test('legacy paused meals receive a stable seat without re-admission or resource changes',()=>{
  const w=fixture(),id=w.protagonist.character_id;
  startActivityTask(w,{actor_id:id,activity_id:'share-meal',task_id:'legacy-meal'},{eventId:'legacy',at:AT});
  controlWorldTask(w,{task_id:'legacy-meal',operation:'pause'},AT);
  delete w.living.coordination;delete w.tasks[0].reservation.facility_slot;
  const before=structuredClone(w);installMealCoordination(w,iso(2));
  assert.equal(w.tasks[0].reservation.facility_slot,0);
  const after=structuredClone(w);delete after.living.coordination;delete after.tasks[0].reservation.facility_slot;
  assert.deepEqual(after,before);
});
