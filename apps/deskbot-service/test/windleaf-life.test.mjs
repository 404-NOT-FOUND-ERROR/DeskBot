import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld,getWorldMap,getWorldRoute} from '../src/persistent-world.mjs';
import {loadWorldMapContent,upgradeWindleafMap,validateWorldMapContent,findWorldPath} from '../src/world-map-content.mjs';
import {installWindleafLife,advanceWindleafLife,windleafPersonalContext,windleafSceneTemplates} from '../src/windleaf-life.mjs';
import {startActivityTask,advanceWorldTask,controlWorldTask} from '../src/realtime-world.mjs';
import {livingReadModel,advanceLivingResources,transferLivingResource} from '../src/living-resources.mjs';
import {cognitiveContext} from '../src/cognitive-life-state.mjs';
import {activityTopic} from '../src/development-facets.mjs';
const at='2026-10-13T02:00:00.000Z',id='shaping-001';
const plus=(at,minutes)=>new Date(Date.parse(at)+minutes*60000).toISOString();
function fixture(){const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(at)});api.ingest({event_id:'leaf-fixture-residents',type:'world.mutation',source:'fixture',character_id:id,payload:{action:'install_resident_life'}});const w=api.get();w.protagonist.location_id='windleaf-shelter';w.living.inventories[id]={stock:{light_leaf:4,leaf_frame_kit:2,cloth:2,fasteners:2},capacity:24};return w;}
function perform(w,activity,when=w.clock.synced_at){advanceLivingResources(w,when,{force:true});w.clock.synced_at=when;const tid=`leaf:${activity}:${w.tasks.length}`;
  startActivityTask(w,{actor_id:id,task_id:tid,activity_id:activity},{eventId:tid,at:when});const t=w.tasks.find(t=>t.task_id===tid);
  advanceLivingResources(w,t.due_at,{force:true});w.clock.synced_at=t.due_at;advanceWorldTask(w,{task_id:tid,expected_task_revision:t.revision},t.due_at);return t;}
test('expansion preserves town, old roads, tasks and stocks; two entrances admit actual travel',()=>{
  const w=fixture(),old=loadWorldMapContent();w.map_catalog=structuredClone(old);w.locations=structuredClone(old.locations);w.schema_migrations=[];
  const inventory=structuredClone(w.living),tasks=structuredClone(w.tasks);assert.equal(upgradeWindleafMap(w,at),true);
  assert.deepEqual(w.living,inventory);assert.deepEqual(w.tasks,tasks);for(const p of old.locations){const n=w.map_catalog.locations.find(l=>l.location_id===p.location_id);assert.deepEqual(n.presentation,p.presentation);assert.equal(n.x,p.x);assert.equal(n.y,p.y);}
  for(const p of old.passages)assert.deepEqual(w.map_catalog.passages.find(n=>n.passage_id===p.passage_id),p);
  assert.equal(upgradeWindleafMap(w,at),false);assert.ok(findWorldPath(w,'backlit-grove','windleaf-shelter'));assert.ok(findWorldPath(w,'tidal-old-road','windleaf-return-platform'));
  w.protagonist.location_id='backlit-grove';const route=getWorldRoute(w,{destinationLocationId:'windleaf-shelter'});assert.equal(route.found,true);assert.ok(route.steps.some(s=>s.presentation_space==='jev-town-map-v2'));assert.equal(getWorldMap(w).locations.length,14);
});
test('versioned geography rejects undeclared or out-of-range expansion and orphan routes',()=>{
  const w=fixture();const c=structuredClone(w.map_catalog);delete c.geography;assert.throws(()=>validateWorldMapContent(c));
  const wrong=structuredClone(w.map_catalog);wrong.locations.find(l=>l.location_id==='windleaf-shelter').presentation.point.x=221;assert.throws(()=>validateWorldMapContent(wrong));
  const disconnected=structuredClone(w.map_catalog);disconnected.passages.pop();assert.throws(()=>validateWorldMapContent(disconnected));
});
test('no retroactive leaves or fixtures; reservations cancel without free frames and no bypass picking',()=>{
  const w=fixture();assert.equal(w.living.objects['windleaf-canopy'].stock.light_leaf,0);assert.equal(installWindleafLife(w,plus(at,400)),false);
  const prior=structuredClone(w.living.inventories[id]);startActivityTask(w,{actor_id:id,task_id:'cancel-leaf',activity_id:'leaf-install'},{eventId:'cancel-leaf',at});
  controlWorldTask(w,{task_id:'cancel-leaf',operation:'cancel',expected_task_revision:0},at);assert.deepEqual(w.living.inventories[id],prior);assert.equal(w.living.objects['windleaf-rack'].leaf_frames.length,0);
  w.protagonist.location_id='windleaf-lowland';assert.throws(()=>transferLivingResource(w,{object_id:'windleaf-canopy',resource:'light_leaf',count:1,operation:'take'},at),{code:'resource_source_requires_gathering'});
});
test('ownership, waited actual measurement, condition reset, serialization and packing preserve one origin',()=>{
  let w=fixture();const setup=perform(w,'leaf-install');assert.equal(setup.status,'completed');assert.equal(setup.windleaf_rule,'windleaf-life-v1');
  assert.throws(()=>perform(w,'leaf-read'),{code:'activity_unavailable'});perform(w,'leaf-open');assert.throws(()=>perform(w,'leaf-read',plus(w.clock.synced_at,25)),{code:'activity_unavailable'});
  w=JSON.parse(JSON.stringify(w));const observed=perform(w,'leaf-read',plus(w.clock.synced_at,31));assert.equal(observed.status,'completed');const observation=observed.completion.result.fantasy_result.observation;assert.equal(observation.setup_root,`task:${setup.task_id}`);
  const frame=w.living.objects['windleaf-rack'].leaf_frames[0];assert.equal(frame.read_count,1);assert.equal(activityTopic('leaf-read'),'explore');
  const npc=w.npcs[0];npc.location_id='windleaf-shelter';assert.equal(livingReadModel(w,npc.npc_id,{at:w.clock.synced_at}).activities.find(a=>a.activity_id==='leaf-read').available,false);
  assert.deepEqual(windleafPersonalContext(w,npc.npc_id).notes,[]);w.protagonist.location_id='shaping-field-desk';assert.equal(windleafPersonalContext(w,id).own_frame,null);assert.equal(windleafPersonalContext(w,id).notes.length,1);
  w.protagonist.location_id='windleaf-shelter';const stock=w.living.inventories[id].stock.light_leaf;perform(w,'leaf-pack');assert.equal(w.living.objects['windleaf-rack'].leaf_frames.length,0);assert.equal(w.living.inventories[id].stock.light_leaf,stock);assert.equal(w.windleaf_life.completed[0].setup_root,`task:${setup.task_id}`);
});
test('weather folds into differentiated shelter, damage and finite basin; held leaves count toward capacity',()=>{
  const w=fixture();perform(w,'leaf-install');const f=w.living.objects['windleaf-rack'].leaf_frames[0];f.shutter='open';f.charge=.6;const lee=structuredClone(w);lee.living.objects['windleaf-rack'].leaf_frames[0].exposure='leeward';
  const start=Date.parse(w.clock.synced_at),env={daylight:true,rain:.12,evaporation:.02,wind:12};advanceWindleafLife(w,start,start+3600000,env);advanceWindleafLife(lee,start,start+3600000,env);
  assert.ok(f.pattern>lee.living.objects['windleaf-rack'].leaf_frames[0].pattern);assert.ok(f.condition<lee.living.objects['windleaf-rack'].leaf_frames[0].condition);assert.ok(w.living.objects['windleaf-rain-basin'].water_level>0);
  assert.equal(w.living.objects['windleaf-rain-basin'].stock,undefined);advanceWindleafLife(w,start,start+1000*3600000,env);assert.ok(w.living.objects['windleaf-canopy'].stock.light_leaf<=8);
});
test('cognition has real destinations, local choices, personal notes and exact cooldown, not role grants',()=>{
  const w=fixture();perform(w,'leaf-install');const ctx=cognitiveContext(w,id,w.clock.synced_at);
  assert.equal(ctx.windleaf_inquiry.own_frame.owner_id,id);assert.ok(ctx.capabilities.activities.some(a=>a.activity_id==='leaf-open'&&a.available));
  const option=ctx.continuation.wait_options.find(o=>o.id==='leaf-read');assert.equal(option.minutes_until_clock_ready,30);assert.ok(option.asset_id);assert.equal(w.protagonist.display_name,'喵呜');
});
test('forest scene opportunities describe actual local objects and never settle a task or invent a home scene',()=>{
 const w=fixture(),before=JSON.stringify(w);const empty=windleafSceneTemplates(w,'windleaf-shelter');assert.match(empty[0].narration,/0\/3/);assert.equal(JSON.stringify(w),before);
 perform(w,'leaf-install');const scene=windleafSceneTemplates(w,'windleaf-shelter')[0];assert.match(scene.narration,/同一套架子/);assert.match(scene.narration,/0 次测记/);assert.equal(w.living.objects['windleaf-rack'].leaf_frames[0].read_count,0);
});
test('packing and reinstalling retains identity, wear and patches instead of creating a free repaired frame',()=>{
 const w=fixture();perform(w,'leaf-install');const old=w.living.objects['windleaf-rack'].leaf_frames[0];old.condition=.55;old.patches=2;const initialRoot=old.setup_root;
 perform(w,'leaf-pack');w.protagonist.location_id='windleaf-return-platform';assert.throws(()=>transferLivingResource(w,{object_id:'windleaf-return-table',resource:'leaf_frame_kit',count:1,operation:'store'},w.clock.synced_at),{code:'bound_asset_not_transferable'});
 w.protagonist.location_id='windleaf-shelter';const next=perform(w,'leaf-install');const frame=w.living.objects['windleaf-rack'].leaf_frames[0];assert.equal(frame.frame_id,old.frame_id);assert.equal(frame.setup_root,initialRoot);assert.equal(frame.patches,2);assert.ok(frame.condition<=.55);assert.equal(frame.sample_set_root,`task:${next.task_id}`);
});
