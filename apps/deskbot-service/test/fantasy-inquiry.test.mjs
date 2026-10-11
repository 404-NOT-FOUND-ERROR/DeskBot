import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {advanceLivingResources,livingReadModel} from '../src/living-resources.mjs';
import {startActivityTask,advanceWorldTask,controlWorldTask} from '../src/realtime-world.mjs';
import {installFantasyInquiry,evolveGlow,glowBrightness,fantasyPersonalContext} from '../src/fantasy-inquiry.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,cognitiveActualResult} from '../src/cognitive-life-state.mjs';
const at='2026-10-11T02:00:00.000Z',id='shaping-001';
function fixture(){
 const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(at)});
 api.ingest({event_id:'residents',type:'world.mutation',source:'fixture',character_id:id,payload:{action:'install_resident_life'}});const w=api.get();
 w.protagonist.location_id='moss-sprout-garden';w.living.inventories[id]={stock:{moss:4,trays:4,shade_hood:1},capacity:24};
 return w;
}
function perform(w,activity,when=w.clock.synced_at,actor=id){
 advanceLivingResources(w,when,{force:true});w.clock.synced_at=when;
 const taskId=`fixture:${activity}:${w.tasks.length}`;
 startActivityTask(w,{actor_id:actor,task_id:taskId,activity_id:activity},{eventId:taskId,at:when});
 const task=w.tasks.find(t=>t.task_id===taskId);advanceLivingResources(w,task.due_at,{force:true});w.clock.synced_at=task.due_at;
 advanceWorldTask(w,{task_id:taskId,expected_task_revision:task.revision},task.due_at);
 return task;
}
const plus=(date,hours)=>new Date(Date.parse(date)+hours*3600000).toISOString();

test('fictional law separates light, wet quenching, wind and finite night afterglow',()=>{
 const base={charge:0,moisture:.5,cohesion:.8,brightness:0},light=structuredClone(base),shade=structuredClone(base);
 evolveGlow(light,2,{daylight:true,rain:0,evaporation:0});evolveGlow(shade,2,{daylight:true,rain:0,evaporation:0},{light:.2});
 assert.ok(light.brightness>shade.brightness*4);assert.ok(glowBrightness({...light,moisture:.95})<light.brightness);
 const blown=structuredClone(light),covered=structuredClone(light);evolveGlow(blown,2,{daylight:true,rain:.1,evaporation:0,wind:12});evolveGlow(covered,2,{daylight:true,rain:.1,evaporation:0,wind:12},{sheltered:true});
 assert.ok(blown.cohesion<covered.cohesion);assert.ok(blown.moisture>covered.moisture);
 evolveGlow(light,30,{daylight:false,rain:0,evaporation:0});assert.equal(light.brightness,0);
});
test('migration adds no materials or historic observations and never resets existing state',()=>{
 const w=fixture(),before=structuredClone(w.living);assert.equal(installFantasyInquiry(w,plus(at,5)),false);assert.deepEqual(w.living,before);
 assert.deepEqual(w.fantasy_inquiry.notes,{});assert.equal(w.living.objects['garden-bed'].glow_moss.charge,0);
});
test('real samples, waited comparison and a finite decaying study preserve provenance and materials',()=>{
 const w=fixture(),bag=w.living.inventories[id].stock;
 const samples=perform(w,'glow-take-cuttings');assert.equal(samples.status,'completed');assert.equal(w.living.objects['garden-bed'].quantity,8);assert.equal(bag.moss,6);
 const setup=perform(w,'glow-set-pair');assert.equal(bag.trays,2);assert.equal(bag.moss,4);assert.equal(setup.fantasy_rule,'shaping-glow-moss-v1');
 const unavailable=livingReadModel(w,id,{at:w.clock.synced_at}).activities.find(a=>a.activity_id==='glow-read-pair');assert.equal(unavailable.available,false);
 assert.throws(()=>perform(w,'glow-read-pair'),{code:'activity_unavailable'});
 const observed=perform(w,'glow-read-pair',plus(w.clock.synced_at,2));assert.equal(observed.status,'completed');
 const readings=observed.completion.result.fantasy_result.observation.readings;assert.ok(readings[0].brightness>readings[1].brightness);
 const finish=perform(w,'glow-press-study');assert.equal(finish.status,'completed');assert.equal(bag.trays,3);
 const study=w.living.objects['seedling-rack'].glow_studies[0];assert.equal(study.observation_root,`task:${observed.task_id}`);assert.equal(study.setup_root,`task:${setup.task_id}`);
 assert.equal(w.living.objects['seedling-rack'].glow_trials.length,0);const charge=study.charge;
 advanceLivingResources(w,plus(w.clock.synced_at,3),{force:true});assert.ok(study.charge<charge);
 assert.throws(()=>perform(w,'glow-press-study'),{code:'activity_unavailable'});
});
test('cancellation refunds held materials without creating a trial or study',()=>{
 const w=fixture(),stock=structuredClone(w.living.inventories[id].stock);
 startActivityTask(w,{actor_id:id,task_id:'cancel-me',activity_id:'glow-set-pair'},{eventId:'start',at});
 controlWorldTask(w,{task_id:'cancel-me',operation:'cancel',expected_task_revision:0},at);
 assert.deepEqual(w.living.inventories[id].stock,stock);assert.equal(w.living.objects['seedling-rack'].glow_trials.length,0);
});
test('a wrong watering hypothesis can be tested then changed; changing conditions resets comparison window',()=>{
 const w=fixture();perform(w,'glow-set-pair');perform(w,'glow-water-pair');perform(w,'glow-water-pair');
 const trial=w.living.objects['seedling-rack'].glow_trials[0];assert.ok(trial.samples.every(s=>s.moisture>.9));
 assert.throws(()=>perform(w,'glow-water-pair'),{code:'activity_unavailable'});
 perform(w,'glow-drain-pair');assert.ok(trial.samples.every(s=>s.moisture<=.65));
 perform(w,'glow-swap-pair');assert.equal(trial.samples[0].id,'B');assert.equal(trial.samples[0].light,1);
 assert.throws(()=>perform(w,'glow-read-pair',plus(w.clock.synced_at,1)),{code:'activity_unavailable'});
 perform(w,'glow-read-pair',plus(w.clock.synced_at,2));assert.equal(trial.read_count,1);
});
test('only owners act on their trial; own private measurement notes are not remote live sensors',()=>{
 const w=fixture();perform(w,'glow-set-pair');perform(w,'glow-read-pair',plus(w.clock.synced_at,2));
 const npc=w.npcs[0];npc.location_id='moss-sprout-garden';
 assert.throws(()=>perform(w,'glow-clear-pair',w.clock.synced_at,npc.npc_id),{code:'activity_unavailable'});
 assert.equal(fantasyPersonalContext(w,npc.npc_id).notes.length,0);assert.equal(fantasyPersonalContext(w,id).notes.length,1);
 w.protagonist.location_id='tinker-workshop';assert.equal(fantasyPersonalContext(w,id).own_trial,null);
 assert.equal(fantasyPersonalContext(w,id).notes.length,1);
});

function travel(w,index){
 applyCognitiveMutation(w,{actor_id:id,operation:'claim',phase:'plan',job_id:'journey'},at,'claim');
 const req={actor_id:id,operation:'plan',job_id:'journey',relevant_key:cognitiveRelevantKey(w,id),proposal:{schema:'deskbot.cognitive-life.proposal.v3',actor_id:id,phase:'plan',state:{agent_id:id},memories:[],action:{action_type:'move',inner_monologue:'去工坊准备托盘'},compiled:{operation:'travel',destination_index:index,reason:'先到工坊准备材料'}}};
 return req;
}
test('cognitive travel uses frozen destination indices and actual multi-hop arrival after reload',()=>{
 let w=fixture();const ctx=cognitiveContext(w,id,at),dest=ctx.capabilities.travel.destinations.at(-1),index=ctx.capabilities.travel.destinations.indexOf(dest)+1;
 const req=travel(w,index);w.locations.reverse();const result=applyCognitiveMutation(w,req,at,'journey-start');
 assert.equal(w.protagonist.location_id,'moss-sprout-garden');assert.equal(cognitiveActualResult(w,id,at),null);
 w=JSON.parse(JSON.stringify(w));let task=w.tasks.find(t=>t.task_id===result.task_id),hops=0;
 while(task.status==='running'&&hops++<20){w.clock.synced_at=task.due_at;advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},task.due_at);}
 assert.equal(task.status,'completed');assert.equal(w.protagonist.location_id,dest.id);assert.ok(hops>1);
 const actual=cognitiveActualResult(w,id,w.clock.synced_at);assert.equal(actual.root_outcome_id,`task:${task.task_id}`);assert.match(actual.fact,/移动没有完成当地其他活动/);
});
test('a route closed during thinking blocks travel without teleporting or spending materials',()=>{
 const w=fixture(),req=travel(w,1),stock=structuredClone(w.living.inventories[id]);w.locations.find(p=>p.location_id==='moss-sprout-garden').neighbors=[];
 const result=applyCognitiveMutation(w,req,at,'blocked-journey');assert.equal(result.task_id,null);assert.equal(result.blocked.code,'destination_route_unavailable');
 assert.equal(w.protagonist.location_id,'moss-sprout-garden');assert.deepEqual(w.living.inventories[id],stock);
});
test('exact activity identity wins over list counting, and conflicting ID/index is rejected before execution',()=>{
 const w=fixture();w.living.objects['garden-bed'].moisture=.3;const req=travel(w,1);
 req.proposal.compiled={operation:'activity',activity_id:'water-bed',reason:'按实际偏干苗况浇水'};
 const result=applyCognitiveMutation(w,req,at,'exact-activity');assert.equal(result.blocked,null);
 assert.equal(w.tasks.find(t=>t.task_id===result.task_id).activity_id,'water-bed');
 const other=fixture(),bad=travel(other,1);bad.proposal.compiled={operation:'activity',activity_id:'glow-read-pair',activity_index:1,reason:'测记'};
 const stocks=structuredClone(other.living.inventories);
 assert.throws(()=>applyCognitiveMutation(other,bad,at,'wrong-binding'),{code:'activity_reference_invalid'});
 assert.deepEqual(other.living.inventories,stocks);assert.equal(other.tasks.length,0);
});
