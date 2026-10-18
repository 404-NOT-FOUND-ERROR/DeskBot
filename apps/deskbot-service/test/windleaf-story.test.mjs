import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld,getWorldMap} from '../src/persistent-world.mjs';
import {installWindleafStory,advanceWindTrace,WIND_TRACE_LAW,localWindleafLore} from '../src/windleaf-story.mjs';
import {advanceWindleafLife} from '../src/windleaf-life.mjs';
import {advanceLivingResources,setLivingWeatherWindow,livingReadModel} from '../src/living-resources.mjs';
import {advanceResonantLife,leafInlayStrength} from '../src/resonant-life.mjs';
import {startActivityTask,advanceWorldTask,controlWorldTask,applyRealTimeClock} from '../src/realtime-world.mjs';
import {cognitiveContext} from '../src/cognitive-life-state.mjs';
import {activityTopic} from '../src/development-facets.mjs';

const at='2026-10-13T02:00:00.000Z',id='shaping-001';
const plus=(value,minutes)=>new Date(Date.parse(value)+minutes*60000).toISOString();
function fixture(){
 const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(at)});
 api.ingest({event_id:'story-fixture-residents',type:'world.mutation',source:'fixture',character_id:id,payload:{action:'install_resident_life'}});
 const w=api.get();w.living.inventories[id]={stock:{moss:2,trays:2,cloth:2},capacity:24};return w;
}
function weather(from=at,minutes=60){return {trusted:true,event_id:'isolated-synthetic-weather-001',from,until:plus(from,minutes)};}
function sourceReady(w){Object.assign(w.living.objects['windleaf-canopy'],{charge:.6});w.living.objects['windleaf-canopy'].stock.light_leaf=2;}
function advance(w,start,minutes,source=weather(start,minutes),wind=4){advanceWindTrace(w,Date.parse(start),Date.parse(plus(start,minutes)),{wind,weather_source:source});}
function perform(w,activity,when=w.clock.synced_at){
 advanceLivingResources(w,when,{force:true});applyRealTimeClock(w,when);
 const task_id=`story:${activity}:${w.tasks.length}`;startActivityTask(w,{actor_id:id,task_id,activity_id:activity},{eventId:task_id,at:when});
 const t=w.tasks.find(t=>t.task_id===task_id);advanceLivingResources(w,t.due_at,{force:true});applyRealTimeClock(w,t.due_at);
 advanceWorldTask(w,{task_id,expected_task_revision:t.revision},t.due_at);assert.equal(t.status,'completed',t.failure_reason);return t;
}
function actualLamp(w){
 w.protagonist.location_id='moss-sprout-garden';perform(w,'glow-set-pair');perform(w,'glow-read-pair',plus(w.clock.synced_at,120));
 perform(w,'glow-press-study');perform(w,'glow-take-study');w.protagonist.location_id='fog-lamp-square';perform(w,'night-mount-lantern');
 return w.living.objects['square-noticeboard'].night_lanterns[0];
}

test('additive story migration preserves supplies, tasks and notes without inventing old light or history',()=>{
 const w=fixture();delete w.windleaf_life.story_version;delete w.windleaf_life.story_installed_at;
 delete w.living.objects['windleaf-canopy'].wind_trace;for(const o of Object.values(w.living.objects))delete o.place_story;
 const prior={inventories:structuredClone(w.living.inventories),notes:structuredClone(w.windleaf_life.notes),tasks:structuredClone(w.tasks),source:structuredClone(w.living.objects['windleaf-canopy'].stock)};
 const installed=plus(at,1440);assert.equal(installWindleafStory(w,installed),true);assert.equal(installWindleafStory(w,plus(installed,20)),false);
 assert.deepEqual(w.living.inventories,prior.inventories);assert.deepEqual(w.tasks,prior.tasks);assert.deepEqual(w.windleaf_life.notes,prior.notes);assert.deepEqual(w.living.objects['windleaf-canopy'].stock,prior.source);
 assert.equal(w.living.objects['square-noticeboard'].night_lanterns.length,0);
 sourceReady(w);advance(w,at,1445,weather(at,1450));const trace=w.living.objects['windleaf-canopy'].wind_trace;
 assert.equal(trace.active,false);assert.equal(trace.eligible_seconds,300);assert.equal(trace.generation,0);
});

test('untrusted or missing weather cannot form wind traces, and material/light thresholds matter',()=>{
 const w=fixture();sourceReady(w);advance(w,at,30,null);assert.equal(w.living.objects['windleaf-canopy'].wind_trace.generation,0);
 advance(w,plus(at,30),30,{...weather(plus(at,30)),trusted:false});assert.equal(w.living.objects['windleaf-canopy'].wind_trace.generation,0);
 w.living.objects['windleaf-canopy'].stock.light_leaf=0;advance(w,plus(at,60),15);assert.equal(w.living.objects['windleaf-canopy'].wind_trace.generation,0);
 sourceReady(w);w.living.objects['windleaf-canopy'].charge=.1;advance(w,plus(at,75),15);assert.equal(w.living.objects['windleaf-canopy'].wind_trace.generation,0);
 sourceReady(w);advanceWindleafLife(w,Date.parse(plus(at,90)),Date.parse(plus(at,110)),{wind:12,daylight:true,rain:0,evaporation:.01});
 assert.equal(w.living.objects['windleaf-canopy'].wind_trace.generation,0,'legacy synthetic wind without a trusted source cannot trigger');
});

test('ten continuous trusted minutes form one bounded trace, with restart-safe expiry and cooldown',()=>{
 let w=fixture();sourceReady(w);const source=weather(at,60),initialStock=w.living.objects['windleaf-canopy'].stock.light_leaf;
 advance(w,at,9,source);assert.equal(w.living.objects['windleaf-canopy'].wind_trace.active,false);
 advance(w,plus(at,9),1,source);let trace=w.living.objects['windleaf-canopy'].wind_trace;
 assert.equal(trace.active,true);assert.equal(trace.intensity,1);assert.equal(trace.formed_at,plus(at,10));assert.equal(trace.expires_at,plus(at,40));
 assert.equal(trace.weather_event_id,source.event_id);assert.equal(w.living.objects['windleaf-canopy'].stock.light_leaf,initialStock);
 w=JSON.parse(JSON.stringify(w));advance(w,plus(at,10),15,null);trace=w.living.objects['windleaf-canopy'].wind_trace;
 assert.equal(trace.intensity,.5);advance(w,plus(at,25),15,null);assert.equal(trace.active,false);assert.equal(trace.intensity,0);
 advance(w,plus(at,40),20,weather(plus(at,40)));assert.equal(trace.generation,1);
 advance(w,plus(at,60),70,null);advance(w,plus(at,130),10,weather(plus(at,130)));assert.equal(trace.generation,2);
 const prior=structuredClone(trace);advance(w,plus(at,130),10,weather(plus(at,130)));assert.deepEqual(trace,prior,'replaying elapsed interval is idempotent');
 assert.equal(WIND_TRACE_LAW.lifetime_seconds,1800);
});

test('interrupted wind starts a new formation wait and production stepping respects trusted expiry',()=>{
 const w=fixture();sourceReady(w);advance(w,at,9,weather(at,9));advance(w,plus(at,9),1,null);advance(w,plus(at,10),9);
 assert.equal(w.living.objects['windleaf-canopy'].wind_trace.active,false);advance(w,plus(at,19),1);assert.equal(w.living.objects['windleaf-canopy'].wind_trace.active,true);
 const actual=fixture();sourceReady(actual);actual.weather={snapshot:{observed_at:at,provider:'explicit-isolated-fixture',condition:'晴',wind_mps:4,humidity:.5,temperature_c:22}};
 setLivingWeatherWindow(actual,{event_id:'fixture-window',source_kind:'external_provider',provenance:{connector:'weather',manually_injected:false,expires_at:plus(at,15),fetched_at:at}},at);
 advanceLivingResources(actual,plus(at,10),{force:true});assert.equal(actual.living.objects['windleaf-canopy'].wind_trace.active,true);
 advanceLivingResources(actual,plus(at,41),{force:true});assert.equal(actual.living.objects['windleaf-canopy'].wind_trace.active,false);
 assert.equal(actual.living.objects['windleaf-canopy'].wind_trace.generation,1);
});

test('a skipped weather interval resets partial formation and replaying an old interval cannot change the trace',()=>{
 const w=fixture();sourceReady(w);advance(w,at,9,weather(at,9));const trace=w.living.objects['windleaf-canopy'].wind_trace;
 assert.equal(trace.eligible_seconds,540);assert.equal(trace.active,false);assert.equal(trace.generation,0);
 // No samples attest to minute 9 through minute 20. A later valid sample cannot
 // silently join the two windows into ten continuous minutes of observed wind.
 advance(w,plus(at,20),1,weather(plus(at,20),10));
 assert.equal(trace.eligible_seconds,60);assert.equal(trace.active,false);assert.equal(trace.generation,0);
 advance(w,plus(at,21),9,weather(plus(at,20),10));
 assert.equal(trace.active,true);assert.equal(trace.formed_at,plus(at,30));assert.equal(trace.generation,1);
 const before=structuredClone(trace);advance(w,at,9,weather(at,9));advance(w,plus(at,20),1,weather(plus(at,20),10));
 assert.deepEqual(trace,before);
});

test('local stories label author background, differing initial values and hypotheses without remote knowledge',()=>{
 const w=fixture();w.protagonist.location_id='windleaf-shelter';const ctx=cognitiveContext(w,id,at);
 const entries=ctx.local_lore.places.flatMap(p=>p.entries);assert.ok(entries.some(e=>e.actor_id==='lamp-keeper-001'&&e.epistemic==='authored_viewpoint'));
 assert.ok(entries.some(e=>e.actor_id==='shade-collector-001'&&e.epistemic==='authored_viewpoint'));
 const residents=new Set(w.npcs.map(n=>n.npc_id));
 const allLore=Object.values(w.living.objects).flatMap(o=>o.place_story?.entries??[]);
 for(const entry of allLore.filter(e=>e.actor_id)){
  assert.ok(residents.has(entry.actor_id),`authored viewpoint refers to existing resident: ${entry.actor_id}`);
  assert.equal(w.npcs.find(n=>n.npc_id===entry.actor_id).display_name,entry.actor_name);
 }
 assert.ok(entries.every(e=>e.source.kind==='author_content'));assert.ok(ctx.local_lore.places.every(p=>p.location_id==='windleaf-shelter'));
 const privateBefore=structuredClone(w.cognition??null),noteBefore=structuredClone(w.windleaf_life.notes);
 assert.ok(localWindleafLore(w,'windleaf-lowland').flatMap(p=>p.entries).some(e=>e.epistemic==='hypothesis'));
 assert.deepEqual(w.cognition??null,privateBefore);assert.deepEqual(w.windleaf_life.notes,noteBefore);
 const source=getWorldMap(w).locations.flatMap(l=>l.areas??[]).flatMap(a=>a.objects??[]).find(o=>o.object_id==='windleaf-canopy');
 assert.equal(source.state.place_story.content_id,'windleaf-old-light-v1');assert.equal(source.state.wind_trace.active,false);
});

test('a gathered leaf lines an actual existing lamp; cancelling refunds materials and does not modify the lamp',()=>{
 const w=fixture(),lamp=actualLamp(w),lampId=lamp.lantern_id,study=lamp.study_id;
 // The source is an explicitly initialized isolated stock fixture, not a story gift.
 w.living.objects['windleaf-canopy'].stock.light_leaf=2;w.protagonist.location_id='windleaf-lowland';perform(w,'leaf-gather');
 const gatheredRoot=`task:${w.tasks.at(-1).task_id}`;assert.ok(gatheredRoot);assert.equal(w.living.inventories[id].stock.light_leaf,2);
 w.protagonist.location_id='fog-lamp-square';const before=structuredClone(w.living.inventories[id].stock),charge=lamp.charge;
 startActivityTask(w,{actor_id:id,task_id:'cancel-inlay',activity_id:'night-line-with-leaf'},{eventId:'cancel-inlay',at:w.clock.synced_at});
 assert.equal(w.living.inventories[id].stock.light_leaf,1);controlWorldTask(w,{task_id:'cancel-inlay',operation:'cancel',expected_task_revision:0},w.clock.synced_at);
 assert.deepEqual(w.living.inventories[id].stock,before);assert.equal(lamp.leaf_inlay,undefined);assert.equal(lamp.charge,charge);
 const done=perform(w,'night-line-with-leaf');assert.equal(lamp.lantern_id,lampId);assert.equal(lamp.study_id,study);assert.equal(lamp.leaf_inlay.root_outcome_id,`task:${done.task_id}`);
 assert.equal(lamp.leaf_inlay.strength,1);assert.equal(lamp.leaf_inlay.expires_at,plus(done.due_at,360));
 assert.equal(w.living.inventories[id].stock.light_leaf,1);assert.equal(w.living.inventories[id].stock.cloth,before.cloth-1);
 assert.throws(()=>perform(w,'night-line-with-leaf'),{code:'activity_unavailable'});assert.equal(activityTopic('night-line-with-leaf'),'craft');
 const other=livingReadModel(w,'lamp-keeper-001',{at:w.clock.synced_at}).activities.find(a=>a.activity_id==='night-line-with-leaf');assert.equal(other.available,false);
});

test('leaf lining trades brightness for finite night retention, expires across restart, and packs without free materials',()=>{
 let w=fixture();actualLamp(w);w.living.inventories[id].stock.light_leaf=1;perform(w,'night-line-with-leaf');
 let lamp=w.living.objects['square-noticeboard'].night_lanterns[0];lamp.charge=.8;lamp.cohesion=.9;
 const start=Date.parse(w.clock.synced_at),bare=structuredClone(w);delete bare.living.objects['square-noticeboard'].night_lanterns[0].leaf_inlay;
 advanceResonantLife(w,start,start+3600000,{daylight:false});advanceResonantLife(bare,start,start+3600000,{daylight:false});
 const baseline=bare.living.objects['square-noticeboard'].night_lanterns[0];assert.ok(lamp.charge>baseline.charge);assert.ok(lamp.brightness<baseline.brightness);assert.equal(lamp.leaf_inlay.strength,5/6);
 w=JSON.parse(JSON.stringify(w));lamp=w.living.objects['square-noticeboard'].night_lanterns[0];advanceResonantLife(w,start+3600000,start+7*3600000,{daylight:false});
 assert.equal(lamp.leaf_inlay.active,false);assert.equal(lamp.leaf_inlay.strength,0);assert.equal(leafInlayStrength(lamp.leaf_inlay,start+7*3600000),0);
 assert.equal(lamp.brightness,lamp.charge*lamp.cohesion);w.living.simulated_until=new Date(start+7*3600000).toISOString();applyRealTimeClock(w,w.living.simulated_until);
 const stock=structuredClone(w.living.inventories[id].stock);perform(w,'night-pack-lantern');assert.equal(w.living.inventories[id].stock.light_leaf,stock.light_leaf);assert.equal(w.living.inventories[id].stock.cloth,stock.cloth);
 assert.equal(w.living.inventories[id].stock.trays,stock.trays+1);assert.equal(w.living.objects['square-noticeboard'].night_lanterns.length,0);
});
