import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {installResidentLife} from '../src/resident-life.mjs';
import {installMealCoordination} from '../src/meal-coordination.mjs';
import {syncMealNeeds,compareMealNeeds,mealSupplyReadModel,hasProviderMeal} from '../src/meal-policy.mjs';
import {advanceAutonomousLife} from '../src/autonomous-life.mjs';
import {finishLifeTask} from '../src/life-state.mjs';
import {fruitSupplySteps,activitySteps} from '../src/life-planning.mjs';

const AT='2026-10-19T16:00:00.000Z';
function fixture(){const w=createPersistentWorld({timeMode:'realtime',now:()=>new Date(AT)}).get();installResidentLife(w,AT);installMealCoordination(w,AT);w.social=null;
 for(const p of [w.protagonist,...w.npcs])p.location_id='warm-pot-courtyard';
 for(const s of Object.values(w.autonomy.actors)){s.appetite=.2;s.energy=.8;s.paused=true;}return w;}

test('need deadlines persist at saturation, through replanning and serialized restart; only a real meal settles the episode',()=>{
 const w=fixture(),[a,b]=Object.values(w.autonomy.actors);a.appetite=.95;b.appetite=.8;syncMealNeeds(w,AT);
 const ticket=structuredClone(a.meal_need);a.appetite=1;b.appetite=1;a.plan={status:'cancelled'};
 const restored=JSON.parse(JSON.stringify(w));syncMealNeeds(restored,'2026-10-20T04:00:00Z');
 assert.deepEqual(restored.autonomy.actors[a.actor_id].meal_need,ticket);assert.ok(compareMealNeeds(a,b)<0);
 finishLifeTask(w,{actor_id:a.actor_id,activity_id:'share-meal',status:'cancelled'},AT);assert.deepEqual(a.meal_need,ticket);
 finishLifeTask(w,{actor_id:a.actor_id,activity_id:'share-meal',status:'completed'},AT);assert.equal(a.meal_need,null);assert.ok(a.appetite<.6);
});
test('older saturated needs receive finite portions before a newer ready resident, independent of lexical actor order',()=>{
 const w=fixture(),a=w.autonomy.actors['shaping-001'],b=w.autonomy.actors['wetland-grower-001'];
 b.appetite=.98;b.paused=false;syncMealNeeds(w,AT);a.appetite=1;a.paused=false;syncMealNeeds(w,'2026-10-19T16:01:00Z');
 w.living.objects['shared-table'].stock.rations=1;advanceAutonomousLife(w,'2026-10-19T16:01:00Z',{eventId:'fair'});
 assert.equal(w.tasks.find(t=>t.activity_id==='share-meal').actor_id,b.actor_id);assert.equal(w.living.objects['shared-table'].stock.rations,0);
});
test('cancelled, paused and stale supply plans are not deliverable commitments; a cooking deadline is not an arrival',()=>{
 const w=fixture(),s=w.autonomy.actors['shaping-001'];s.paused=false;s.appetite=.99;
 s.plan={plan_id:'cook',status:'executing',created_at:AT,index:0,task_id:'cook-task',steps:[{kind:'activity',activity_id:'cook-grove-stew'},{kind:'transfer',operation:'store',resource:'rations',count:3}]};
 w.tasks=[{task_id:'cook-task',actor_id:s.actor_id,status:'running',activity_id:'cook-grove-stew',due_at:'2026-10-19T16:20:00Z'}];
 const pending=mealSupplyReadModel(w,AT);assert.equal(pending.potential_portions,3);assert.equal(pending.commitments[0].arrival_at,null);
 w.tasks[0].status='paused';assert.equal(mealSupplyReadModel(w,AT).potential_portions,0);
 w.tasks[0].status='cancelled';assert.equal(mealSupplyReadModel(w,AT).potential_portions,0);
 w.tasks=[];assert.equal(mealSupplyReadModel(w,'2026-10-19T18:00:00Z').potential_portions,0);
});
test('kitchen handoff is empty on migration and consumes only ingredients actually delivered',()=>{
 const w=fixture(),id=w.protagonist.character_id;assert.equal(w.living.objects['trial-stove'].stock.light_fruit,0);
 w.living.objects['shared-table'].stock.rations=0;w.living.objects['light-fruit-bough'].stock.light_fruit=2;
 const plan=fruitSupplySteps(w,id,2,'trial-stove');assert.equal(plan.at(-1).object_id,'trial-stove');assert.equal(w.living.objects['trial-stove'].stock.light_fruit,0);
 w.living.objects['trial-stove'].stock.light_fruit=2;const meal=activitySteps(w,id,'share-meal');
 assert.equal(meal.some(s=>s.activity_id==='gather-light-fruit'),false);assert.equal(meal[0].object_id,'trial-stove');
});
test('a hungry provider has one bounded opportunity from real delivery, never from a promise or after expiry',()=>{
 const w=fixture(),s=w.autonomy.actors['shaping-001'];s.paused=false;s.appetite=.95;
 assert.equal(hasProviderMeal(w,s.actor_id,AT),false);s.meal_delivery={at:AT,portions:3,used:false};
 assert.equal(hasProviderMeal(w,s.actor_id,AT),true);assert.equal(hasProviderMeal(w,s.actor_id,'2026-10-19T16:11:00Z'),false);
 s.meal_delivery.used=true;assert.equal(hasProviderMeal(w,s.actor_id,AT),false);
});
test('shortage at midnight permits a short local recovery instead of losing the entire night to a six-hour plan',()=>{
 const w=fixture(),s=w.autonomy.actors['shaping-001'];s.paused=false;s.appetite=.99;
 w.living.objects['shared-table'].stock.rations=0;w.living.objects['light-fruit-bough'].stock.light_fruit=0;
 w.living.objects['seedling-rack'].stock.moss=0;w.living.objects['garden-bed'].growth=.1;
 advanceAutonomousLife(w,AT,{eventId:'night-shortage'});
 const task=w.tasks.find(t=>t.actor_id===s.actor_id);assert.equal(task.life_action,'rest');assert.equal(task.due_at,'2026-10-19T16:15:00.000Z');
 assert.equal(w.living.objects['shared-table'].stock.rations,0);assert.equal(s.appetite,.99);
});
