import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentWorld, getWorldMap } from '../src/persistent-world.mjs';
import { installAutonomy, finishLifeTask } from '../src/life-state.mjs';
import { installLivedMemory, syncLivedMemory, memoryReadModel, influenceRememberedChoices } from '../src/lived-memory.mjs';
import { syncLifeRhythm, lifeRhythmReadModel, lifeFollowupCandidates } from '../src/life-rhythm.mjs';
import { advanceAutonomousLife } from '../src/autonomous-life.mjs';
import { applyRealTimeClock, advanceWorldTask } from '../src/realtime-world.mjs';
import { advanceLivingResources, LIVING_RULE_VERSION } from '../src/living-resources.mjs';
const OWN='shaping-001',START='2026-10-05T04:00:00.000Z',DAY=86400000;
const at=n=>new Date(Date.parse(START)+n*DAY).toISOString();
function fixture(){
 const w=createPersistentWorld({timeMode:'realtime',now:()=>new Date(START)}).get();
 installAutonomy(w,START);installLivedMemory(w,START,{plannerEnabled:false});
 for(const s of Object.values(w.autonomy.actors))s.paused=s.actor_id!==OWN;
 return w;
}
// Constructed canonical history tests policy; these are not production claims.
function result(w,id,n,{motivation='self_continuation',activity='water-bed',outcome='completed',failure=null}={}){
 w.tasks.push({task_id:id,actor_id:OWN,status:outcome,kind:'care',life_action:'activity',activity_id:activity,life_goal:'water',origin:'autonomous_life',
  life_source_ids:[],life_motivation:{kind:motivation},location_id:'moss-sprout-garden',finished_at:at(n),completion_effect:LIVING_RULE_VERSION,
  completion:{due_at:at(n),effect:LIVING_RULE_VERSION},failure_classification:failure,failure_code:failure?'resource_insufficient':null});
 w.clock.synced_at=at(n);syncLivedMemory(w,at(n));
}
const topic=w=>lifeRhythmReadModel(w,{actorId:OWN}).actors[0]?.topics.care;
test('a brief contact fades without creating interest, capability, a wish or a result',()=>{
 const w=fixture(),count=w.memory.development.records.length;
 w.memory.development.contacts.push({actor_id:OWN,topic:'care',at:START,source_record_id:'contact:one'});
 syncLifeRhythm(w,START);assert.equal(topic(w).status,'attention');
 syncLifeRhythm(w,at(4));assert.equal(topic(w).status,'parked');assert.equal(topic(w).formed_at,null);
 assert.equal(w.memory.development.records.length,count);
});
test('cross-day autonomous evidence forms an investment; needs and condition failure preserve it',()=>{
 const w=fixture();result(w,'a',0);result(w,'b',1,{activity:'tend-bed'});result(w,'c',2);
 assert.ok(topic(w).formed_at);const formed=topic(w).formed_at;
 w.autonomy.actors[OWN].appetite=.95;syncLifeRhythm(w,at(9));assert.equal(topic(w).status,'held');assert.equal(topic(w).formed_at,formed);
 w.autonomy.actors[OWN].appetite=.2;result(w,'blocked',10,{outcome:'failed',failure:'resource'});
 assert.equal(topic(w).status,'held');assert.equal(topic(w).last_active_at,at(2));assert.equal(topic(w).formed_at,formed);
});
test('maintained investment can be set aside and reawakened by a fresh source without new practice',()=>{
 const w=fixture();result(w,'a',0);result(w,'b',1,{activity:'tend-bed'});result(w,'c',2);
 syncLifeRhythm(w,at(10));assert.equal(topic(w).status,'parked');const before=w.memory.development.records.length;
 assert.equal(influenceRememberedChoices(w,w.autonomy.actors[OWN],[{goal:'interest:garden',development_topic:'care',available:true,score:30}])[0].memory_bonus,0,'retained formation evidence does not keep scheduling a parked topic');
 w.memory.development.contacts.push({actor_id:OWN,topic:'care',at:at(10),expires_at:at(11),source_record_id:'contact:new'});
 syncLifeRhythm(w,at(10));assert.equal(topic(w).status,'reawakened');assert.equal(topic(w).reawakening_source_id,'contact:new');
 assert.equal(w.memory.development.records.length,before);
 syncLifeRhythm(w,at(12));assert.equal(topic(w).status,'parked','expired input cannot hold attention forever');
});
test('an invitation creates a next-day option; travel and repeated reads never complete it',()=>{
 const w=fixture();result(w,'invited',0,{motivation:'invited'});
 const o=lifeRhythmReadModel(w).opportunities[0];assert.equal(o.status,'waiting_day');assert.equal(topic(w).formed_at,null);
 const before=structuredClone(w);memoryReadModel(w);getWorldMap(w);assert.deepEqual(w,before);
 syncLifeRhythm(w,at(1));assert.equal(lifeRhythmReadModel(w).opportunities[0].status,'available');
 const choices=lifeFollowupCandidates(w,w.autonomy.actors[OWN],at(1),{travel:()=>[],practice:()=>[]});assert.equal(choices.length,1);
 w.tasks.push({task_id:'road',actor_id:OWN,kind:'travel',status:'completed',life_action:'travel',life_followup:choices[0].life_followup,
  origin:'autonomous_life',life_source_ids:[],finished_at:at(1),completion:{due_at:at(1)},life_motivation:{kind:'self_continuation'}});
 syncLivedMemory(w,at(1));assert.equal(lifeRhythmReadModel(w).opportunities[0].status,'available');
 assert.equal(w.memory.development.records.find(r=>r.root_outcome_id==='task:invited').causes.motivation.kind,'invited');
});
test('a chosen follow-up completes through the existing task executor and shares its actual result root',()=>{
 const w=fixture();result(w,'invited',0,{motivation:'invited'});
 w.protagonist.location_id='moss-sprout-garden';w.autonomy.actors[OWN].appetite=.2;w.autonomy.actors[OWN].energy=.85;
 Object.assign(w.living.objects['garden-bed'],{growth:.2,moisture:.6,health:.98,quantity:10});
 Object.assign(w.living.objects['seedling-rack'].stock,{water:8,seeds:8,trays:2});
 w.living.objects['trial-stove'].stock.water=8;w.living.objects['shared-table'].stock.rations=10;
 applyRealTimeClock(w,at(1));advanceLivingResources(w,at(1),{force:true});
 Object.assign(w.autonomy.actors[OWN],{updated_at:at(1),energy:.85,appetite:.2});
 Object.assign(w.living.objects['garden-bed'],{growth:.2,moisture:.6,health:.98,quantity:10});
 syncLivedMemory(w,at(1));advanceAutonomousLife(w,at(1),{eventId:'followup:choose'});
 const task=w.tasks.find(t=>t.status==='running'&&t.actor_id===OWN);
 assert.ok(task.life_followup);assert.equal(task.life_action,'observe');assert.equal(task.life_motivation.kind,'self_continuation');
 const due=task.due_at;advanceLivingResources(w,due,{force:true});applyRealTimeClock(w,due);
 advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},due);syncLivedMemory(w,due);
 const o=lifeRhythmReadModel(w).opportunities[0];assert.equal(o.status,'completed');assert.equal(o.result_root_id,`task:${task.task_id}`);
 assert.equal(o.inspection.finished.object_id,'garden-bed');assert.equal(o.inspection.finished.at,due);
 assert.equal(o.inspection.finished.values.moisture,w.living.objects['garden-bed'].moisture);
 assert.equal(w.memory.development.records.filter(r=>r.root_outcome_id===o.result_root_id).length,1);
 const count=w.memory.development.records.length;syncLivedMemory(w,due);assert.equal(w.memory.development.records.length,count);
 assert.equal(lifeFollowupCandidates(w,w.autonomy.actors[OWN],due,{travel:()=>[],practice:()=>[]}).length,0);
 const restored=JSON.parse(JSON.stringify(w));assert.deepEqual(lifeRhythmReadModel(restored),lifeRhythmReadModel(w));
});
test('waiting does not use recipe effort and exhausted residents recover in place with real elapsed time',()=>{
 const w=fixture(),s=w.autonomy.actors[OWN];s.energy=.7;
 finishLifeTask(w,{actor_id:OWN,status:'completed',kind:'care',life_action:'observe',life_goal:'wait-meal'},START);assert.equal(s.energy,.7);
 s.energy=.02;s.appetite=.95;w.protagonist.location_id='warm-pot-courtyard';
 advanceAutonomousLife(w,START,{eventId:'rest:choose'});
 const task=w.tasks.find(t=>t.status==='running'&&t.actor_id===OWN);assert.equal(task.life_action,'rest');assert.equal(task.location_id,'warm-pot-courtyard');
 assert.ok(task.duration_ms>2*3600000);assert.equal(w.autonomy.actors[OWN].energy,.02,'planning grants no instant recovery');
 advanceLivingResources(w,task.due_at,{force:true});applyRealTimeClock(w,task.due_at);
 advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},task.due_at);
 assert.ok(w.autonomy.actors[OWN].energy>=.64);assert.equal(w.autonomy.actors[OWN].appetite,1,'rest grants no free food');
});
