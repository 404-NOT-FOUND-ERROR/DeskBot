import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld,getWorldMap} from '../src/persistent-world.mjs';
import {advanceLivingResources,transferLivingResource} from '../src/living-resources.mjs';
import {startActivityTask,advanceWorldTask,controlWorldTask,applyRealTimeClock} from '../src/realtime-world.mjs';
import {installResonantLife,bellMeasurement,resonantPersonalContext} from '../src/resonant-life.mjs';
const id='shaping-001',at='2026-10-11T02:00:00.000Z';
const later=(at,h)=>new Date(Date.parse(at)+h*3600000).toISOString();
function fixture(){const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(at)});api.ingest({event_id:'residents',type:'world.mutation',source:'fixture',character_id:id,payload:{action:'install_resident_life'}});
 const w=api.get();w.living.inventories[id]={stock:{moss:2,trays:2},capacity:24};return w;}
function perform(w,activity,when=w.clock.synced_at){
 advanceLivingResources(w,when,{force:true});applyRealTimeClock(w,when);
 const taskId=`proof:${activity}:${w.tasks.length}`;startActivityTask(w,{actor_id:id,task_id:taskId,activity_id:activity},{eventId:taskId,at:when});
 const t=w.tasks.find(t=>t.task_id===taskId);advanceLivingResources(w,t.due_at,{force:true});applyRealTimeClock(w,t.due_at);
 advanceWorldTask(w,{task_id:t.task_id,expected_task_revision:t.revision},t.due_at);assert.equal(t.status,'completed',t.failure_reason);return t;
}
test('echo law separates immersion, wind and damping without granting recordings',()=>{
 const frame={water_level:.46,condition:.9},bell={height:.5,dampened:false};
 const calm=bellMeasurement(bell,frame,{wind:0}),wind=bellMeasurement(bell,frame,{wind:12}),damped=bellMeasurement({...bell,dampened:true},frame,{wind:12});
 assert.ok(calm.resonance>wind.resonance);assert.ok(damped.resonance>wind.resonance);
 assert.notEqual(bellMeasurement(bell,{...frame,water_level:.8}).tone,calm.tone);
 const w=fixture();assert.deepEqual(w.resonant_life.notes,{});assert.equal(installResonantLife(w,later(at,2)),false);
});
test('water chain consumes workshop materials, records actual timed measurements and returns the same finite bell resource',()=>{
 const w=fixture(),parts=w.living.objects['parts-drawers'].stock;w.protagonist.location_id='spare-parts-house';const before=parts.wood;
 perform(w,'echo-craft-bell');assert.equal(parts.wood,before-1);w.protagonist.location_id='echo-waterside';
 perform(w,'echo-set-bell');assert.equal(w.living.inventories[id].stock.echo_bell,0);assert.throws(()=>perform(w,'echo-read-bell'),{code:'activity_unavailable'});
 const read=perform(w,'echo-read-bell',later(w.clock.synced_at,.5));assert.equal(read.completion.result.fantasy_result.observation.reading.water_level,w.living.objects['floating-frame'].water_level);
 perform(w,'echo-raise-bell');assert.throws(()=>perform(w,'echo-read-bell'),{code:'activity_unavailable'});perform(w,'echo-dampen-bell');
 assert.equal(resonantPersonalContext(w,'lamp-keeper-001').notes.length,0);perform(w,'echo-pack-bell');assert.equal(w.living.inventories[id].stock.echo_bell,1);assert.equal(w.living.objects['floating-frame'].echo_bells.length,0);
});
test('night chain carries an actually made study, keeps its source and uses darkness and shutters as measurable conditions',()=>{
 const w=fixture();w.protagonist.location_id='moss-sprout-garden';perform(w,'glow-set-pair');const read=perform(w,'glow-read-pair',later(w.clock.synced_at,2));perform(w,'glow-press-study');
 const study=w.living.objects['seedling-rack'].glow_studies[0];perform(w,'glow-take-study');assert.equal(w.living.objects['seedling-rack'].glow_studies.length,0);
 assert.throws(()=>transferLivingResource(w,{resource:'glow_lens'},w.clock.synced_at),{code:'bound_asset_not_transferable'});
 w.protagonist.location_id='fog-lamp-square';perform(w,'night-mount-lantern','2026-10-11T11:00:00.000Z');const lamp=w.living.objects['square-noticeboard'].night_lanterns[0];
 assert.equal(lamp.study_id,study.study_id);assert.equal(lamp.observation_root,`task:${read.task_id}`);assert.equal(w.living.inventories[id].stock.glow_lens,0);
 const brightness=lamp.brightness;perform(w,'night-read-lantern',later(w.clock.synced_at,.5));assert.ok(lamp.brightness<brightness);
 perform(w,'night-close-shutter');assert.equal(lamp.brightness,0);const charge=lamp.charge;advanceLivingResources(w,later(w.clock.synced_at,2),{force:true});assert.ok(lamp.charge<charge&&lamp.charge>charge-.02);
 perform(w,'night-open-shutter',w.living.simulated_until);assert.ok(lamp.brightness>0);
 const map=getWorldMap(w);const projected=map.locations.flatMap(l=>l.areas??[]).flatMap(a=>a.objects??[]).find(o=>o.object_id==='square-noticeboard');assert.equal(projected.state.night_lanterns[0].brightness,lamp.brightness);
 perform(w,'night-pack-lantern');assert.equal(w.living.objects['square-noticeboard'].night_lanterns.length,0);assert.equal(w.living.inventories[id].stock.trays,2);
});
test('cancelling a mounting task refunds the carried study and does not create a lamp',()=>{
 const w=fixture();w.protagonist.location_id='moss-sprout-garden';perform(w,'glow-set-pair');perform(w,'glow-read-pair',later(w.clock.synced_at,2));perform(w,'glow-press-study');perform(w,'glow-take-study');w.protagonist.location_id='fog-lamp-square';
 startActivityTask(w,{actor_id:id,task_id:'cancel-lamp',activity_id:'night-mount-lantern'},{eventId:'mount',at:w.clock.synced_at});
 controlWorldTask(w,{task_id:'cancel-lamp',operation:'cancel',expected_task_revision:0},w.clock.synced_at);
 assert.equal(w.living.inventories[id].stock.glow_lens,1);assert.ok(w.resonant_life.carried_studies[id]);assert.equal(w.living.objects['square-noticeboard'].night_lanterns.length,0);
});
