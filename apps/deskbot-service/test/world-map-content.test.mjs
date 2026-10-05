import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorldMapContent, validateWorldMapContent, worldHopAccess, findWorldPath } from '../src/world-map-content.mjs';
import { createPersistentWorld, getWorldMap, getWorldRoute } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createDeskBotServer } from '../src/app.mjs';
import { createNpcAgentLoop } from '../src/npc-agent-loop.mjs';

const HOME='shaping-field-desk', ROAD='tidal-old-road', MARKET='whisper-market';
const edge=(a,b)=>[a,b].sort().join('--');
function harness(t) {
  const directory=mkdtempSync(join(tmpdir(),'deskbot-map-'));
  const filename=join(directory,'world.sqlite');
  let persistence=createSqlitePersistence({filename}), at=Date.parse('2026-10-04T08:00:00Z');
  const now=()=>new Date(at);
  let world=createPersistentWorld({persistence,now,timeMode:'realtime'});
  t.after(()=>{ persistence.close(); rmSync(directory,{recursive:true,force:true}); });
  return {get world(){return world;}, get persistence(){return persistence;}, now,
    after(ms){at+=ms;}, restart(){persistence.close();persistence=createSqlitePersistence({filename});world=createPersistentWorld({persistence,now});},
    mutate(id,payload){return world.ingest({event_id:id,type:'world.mutation',source:'world-engine',character_id:'shaping-001',occurred_at:now().toISOString(),payload});},
    access(a,b,status='closed',id=`access-${a}-${b}-${status}`){const passage_id=edge(a,b);return this.mutate(id,{action:'set_passage_access',passage_id,status,reason:status==='closed'?'木板松动，等修好再走':'木板已检查，可以通行',expected_passage_revision:this.world.get().passage_states[passage_id].revision});},
  };
}

test('catalog connects ten stable locations, internal areas and inspectable objects without inventing residents',()=>{
  const content=loadWorldMapContent();
  assert.equal(content.locations.length,10);assert.equal(content.areas.length,20);assert.equal(content.objects.length,20);
  const world=createPersistentWorld().get(), map=getWorldMap(world);
  assert.equal(map.regions.length,5);assert.equal(map.npcs.length,0);
  assert.deepEqual(map.locations.flatMap(place=>place.areas.map(area=>area.area_id)).sort(),map.areas.map(area=>area.area_id).sort());
  assert.equal(map.locations.flatMap(place=>place.areas.flatMap(area=>area.objects)).length,20);
  for(const place of map.locations){assert.ok(getWorldRoute(world,{destinationLocationId:place.location_id}).found);assert.deepEqual(place.presentation,content.locations.find(item=>item.location_id===place.location_id).presentation);}
  assert.equal(map.content.objects_have_simulated_state,true);
  assert.equal(map.objects.filter(object=>object.state_scope==='persistent_living').length,8);
  assert.equal(content.objects.every(object=>object.state_scope==='catalog_only'),true,'the authored directory cannot forge live state');
});

for(const [name,corrupt] of [
  ['dangling region',c=>c.locations[0].region_id='unknown'],
  ['one-way geography',c=>c.locations[0].neighbors=[]],
  ['duplicate place',c=>c.locations.push(structuredClone(c.locations[0]))],
  ['orphan object',c=>c.objects[0].area_id='unknown'],
  ['cross-location interior connection',c=>c.areas[0].neighbor_area_ids=[c.areas[2].area_id]],
  ['non-positive duration',c=>c.locations[0].travel_cost=0],
  ['fabricated simulated object',c=>c.objects[0].state_scope='simulated'],
  ['missing passage',c=>c.passages.pop()],
  ['misaligned scene route',c=>c.passages[0].presentation_points[0]={x:20,y:20}],
  ['disconnected geography',c=>c.locations.forEach((place,index)=>place.neighbors=[c.locations[index % 2 ? index-1 : index+1].location_id])],
]) test(`candidate validation rejects ${name}`,()=>{const content=loadWorldMapContent();corrupt(content);assert.throws(()=>validateWorldMapContent(content),{code:'invalid_map_content'});});

test('closed passage changes read model, planner and movement; reopening persists and retries are idempotent',t=>{
  const h=harness(t), before=h.world.get();
  const closure=h.access(HOME,ROAD);
  assert.equal(h.world.get().protagonist.location_id,HOME);
  assert.equal(h.world.get().logical_time.minute_of_day,before.logical_time.minute_of_day);
  const map=getWorldMap(h.world.get());
  assert.equal(map.paths.find(path=>path.passage_id===edge(HOME,ROAD)).open,false);
  assert.equal(map.locations.find(place=>place.location_id===ROAD).reachable,false);
  const route=getWorldRoute(h.world.get(),{destinationLocationId:ROAD});
  assert.equal(route.found,true);assert.ok(route.steps.length>1);assert.equal(route.steps[0].to_location_id,'lamp-street-homes');
  assert.throws(()=>h.mutate('closed-trip',{action:'move_protagonist',location_id:ROAD}),{code:'passage_closed'});
  assert.equal(h.mutate(closure.mutation.event_id,{action:'set_passage_access',passage_id:edge(HOME,ROAD),status:'closed',reason:'木板松动，等修好再走',expected_passage_revision:0}).duplicate,true);
  assert.throws(()=>h.mutate('stale-access',{action:'set_passage_access',passage_id:edge(HOME,ROAD),status:'open',reason:'测试',expected_passage_revision:0}),{code:'passage_revision_conflict'});
  h.restart();assert.equal(h.world.get().passage_states[edge(HOME,ROAD)].status,'closed');
  h.access(HOME,ROAD,'open');h.restart();assert.deepEqual(findWorldPath(h.world.get(),HOME,ROAD),[HOME,ROAD]);
});

test('closing a pending segment fails arrival and preserves the last confirmed position across restart',t=>{
  const h=harness(t);h.mutate('trip',{action:'move_protagonist',location_id:ROAD});h.after(1000);h.access(HOME,ROAD);h.restart();h.after(8*60000);h.world.syncTasks();
  const world=h.world.get();assert.equal(world.protagonist.location_id,HOME);assert.equal(world.tasks[0].status,'failed');assert.equal(world.tasks[0].failure_reason,'passage_closed');
  assert.equal(world.tasks[0].completion.effect,'no_effect');h.world.syncTasks();assert.equal(h.world.listMutations({eventId:`task-due:${world.tasks[0].task_id}:0:${world.tasks[0].due_at}`}).length,1);
});

test('multi-hop task replans remaining segments through the same open-passages planner',t=>{
  const h=harness(t);h.mutate('trip',{action:'move_protagonist',location_id:ROAD,destination_location_id:MARKET});h.access(ROAD,MARKET);h.after(8*60000);h.world.syncTasks();
  const world=h.world.get(),route=getWorldRoute(world,{destinationLocationId:MARKET});
  assert.equal(world.protagonist.location_id,ROAD);assert.equal(world.tasks[0].status,'running');assert.equal(world.tasks[0].to_location_id,route.steps[0].to_location_id);assert.equal(route.steps[0].to_location_id,'fog-lamp-square');
});

test('hidden locations and complete isolation are excluded from routing and movement',t=>{
  const h=harness(t);h.access(HOME,ROAD);h.access(HOME,'lamp-street-homes');
  assert.equal(getWorldRoute(h.world.get(),{destinationLocationId:ROAD}).found,false);
  const world=h.world.get();world.locations.find(place=>place.location_id===MARKET).visibility='hidden';
  assert.equal(findWorldPath(world,ROAD,MARKET),null);assert.equal(worldHopAccess(world,ROAD,MARKET).allowed,false);
});

test('legacy migration adds catalog once while retaining home references, object records and task deadlines',t=>{
  const h=harness(t);h.mutate('trip',{action:'move_protagonist',location_id:ROAD});
  const legacy=h.world.get();delete legacy.map_catalog;delete legacy.passage_states;
  legacy.locations=legacy.locations.slice(0,5);legacy.locations.forEach(place=>place.neighbors=place.neighbors.filter(id=>legacy.locations.some(p=>p.location_id===id)));
  legacy.locations[0].visibility='hidden';legacy.locations[0].custom_decoration={cloth:'blue'};
  legacy.npcs=[{npc_id:'pathfinder-001',display_name:'阿砾',location_id:ROAD,home_location_id:HOME}];legacy.object_states={'keepsake-shelf':{keepsakes:['old-stone']}};
  h.persistence.put('canonical-world.states',legacy.world_id,legacy);h.restart();
  const world=h.world.get();assert.equal(world.locations.length,10);assert.deepEqual(world.tasks,legacy.tasks);assert.deepEqual(world.clock,legacy.clock);assert.deepEqual(world.object_states,legacy.object_states);assert.deepEqual(world.npcs,legacy.npcs);
  assert.equal(world.locations[0].visibility,'hidden');assert.deepEqual(world.locations[0].custom_decoration,legacy.locations[0].custom_decoration);
  assert.equal(world.schema_migrations.filter(m=>m.id==='companion-living-map-v1').length,1);assert.equal(world.world_revision,legacy.world_revision+1);
  h.restart();assert.deepEqual(h.world.get(),world);
});

function expanded(content){
  const candidate=structuredClone(content);candidate.version='extension-test-v2';
  const location={...structuredClone(candidate.locations[0]),location_id:'quiet-step',name:'静阶',neighbors:[HOME],x:35,y:92,presentation:{space:'jev-town-map-v1',point:{x:30,y:90}}};
  candidate.locations[0].neighbors.push('quiet-step');candidate.locations.push(location);
  candidate.areas.push({area_id:'quiet-seat',location_id:'quiet-step',name:'静阶座位',description:'可以安静坐一会儿。',access:'public',neighbor_area_ids:[],x:50,y:50});
  candidate.objects.push({object_id:'quiet-bench',area_id:'quiet-seat',name:'静阶凳',description:'树下的一张凳子。',object_kind:'seat',capabilities:['inspect'],state_scope:'catalog_only'});
  candidate.passages.push({passage_id:'quiet-step--shaping-field-desk',from_location_id:'quiet-step',to_location_id:HOME,name:'静阶小路',default_status:'open',presentation_space:'jev-town-map-v1',presentation_points:[location.presentation.point,candidate.locations[0].presentation.point]});
  return candidate;
}
test('validated expansion commits atomically, preserves ownership and survives reload without reverting to ten places',t=>{
  const h=harness(t),candidate=expanded(loadWorldMapContent()),before=h.world.get();
  assert.throws(()=>h.mutate('stale-expand',{action:'admit_map_content',content:candidate,expected_world_revision:before.world_revision-1}),{code:'map_revision_conflict'});
  assert.deepEqual(h.world.get(),before);
  h.mutate('expand',{action:'admit_map_content',content:candidate,expected_world_revision:before.world_revision});
  assert.equal(h.world.get().locations.length,11);assert.ok(getWorldRoute(h.world.get(),{destinationLocationId:'quiet-step'}).found);
  const after=h.world.get();h.restart();assert.deepEqual(h.world.get(),after);
  const invalid=structuredClone(candidate);invalid.version='v3';invalid.objects[0].area_id='quiet-seat';
  assert.throws(()=>h.mutate('rewrite',{action:'admit_map_content',content:invalid,expected_world_revision:after.world_revision}),{code:'map_identity_conflict'});assert.deepEqual(h.world.get(),after);
});

test('NPC movement candidates avoid closed passages',t=>{
  const h=harness(t);h.mutate('npc',{action:'upsert_npc',npc:{npc_id:'pathfinder-001',display_name:'阿砾',location_id:HOME}});h.access(HOME,ROAD);
  const agent=createNpcAgentLoop({now:h.now,worldSnapshot:()=>h.world.get()});
  const world=h.world.get(),profile={npc_id:'pathfinder-001',legal_actions:['move_to_adjacent_location','observe_current_location']};
  const candidates=agent.legalCandidates({world,npc:world.npcs[0],profile,routine:{route:[ROAD]}});
  assert.ok(candidates.some(candidate=>candidate.location_id==='lamp-street-homes'));
  assert.ok(candidates.every(candidate=>!candidate.location_id || worldHopAccess(world,HOME,candidate.location_id).allowed));
  // Movement legality applies even to a stale or manually authored NPC action.
  assert.throws(()=>h.mutate('npc-trip',{action:'npc_action',npc_id:'pathfinder-001',action_name:'move_to_adjacent_location',location_id:ROAD}),{code:'passage_closed'});
});

test('HTTP map and route are read-only and public observations cannot close paths or install content',async t=>{
  const server=createDeskBotServer({now:()=>new Date('2026-10-04T08:00:00Z'),timeMode:'realtime'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,read=async path=>(await(await fetch(base+path)).json());
  const before=(await read('/api/world')).world;
  const map=await read('/api/world/map');assert.equal(map.locations.length,10);assert.equal(map.areas.length,20);
  const route=await read('/api/world/route?destination_location_id=moss-sprout-garden');assert.equal(route.route.found,true);assert.ok(route.route.steps.every(step=>step.presentation_points));
  for(const action of ['set_passage_access','admit_map_content']){
    const response=await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:action,type:'world.mutation',source:'world-engine',character_id:'shaping-001',occurred_at:'2026-10-04T08:00:00Z',payload:{action}})});
    assert.equal(response.status,403);
  }
  assert.deepEqual((await read('/api/world')).world,before);
});
