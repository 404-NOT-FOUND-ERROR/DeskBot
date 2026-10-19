import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeskBotServer } from '../src/app.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createWorldObserver, worldRuntimeReadModel } from '../src/world-observer.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { installResidentLife } from '../src/resident-life.mjs';
const now = () => new Date('2026-10-19T02:00:00Z');

test('all projections use the captured world, even when the source has advanced; no model or mutation on read', () => {
  let modelCalls = 0, reads = 0;
  const server = createDeskBotServer({ now, llm: {complete() {modelCalls++; throw Error('unexpected model');}} });
  const captured = server.persistentWorld.readSnapshot();
  server.persistentWorld.ingest({event_id:'later',type:'world.mutation',source:'fixture',payload:{action:'advance_time',minutes:20}});
  const newer = server.persistentWorld.get();
  const observer = createWorldObserver({ now, worldLife: server.worldLife, roleEvolution: server.roleEvolution,
    persistentWorld: {readSnapshot() {reads++; return structuredClone(captured);}},
  });
  const originalGet = server.persistentWorld.get;
  server.persistentWorld.get = () => {throw Error('unexpected second canonical read');};
  const s = observer.snapshot();
  server.persistentWorld.get = originalGet;
  assert.equal(reads, 1);
  assert.equal(s.map.world_revision, captured.world.world_revision);
  assert.equal(s.life.world_revision, s.world_revision);
  assert.equal(s.role_wishes.world_revision, s.world_revision);
  assert.equal(s.runtime.world_revision, s.world_revision);
  assert.equal(s.map.environment.projected_at, s.captured_at);
  assert.equal(s.map.logical_time.minute_of_day, captured.world.logical_time.minute_of_day);
  assert.deepEqual(server.persistentWorld.get(), newer);
  assert.equal(modelCalls, 0);
  const again = observer.snapshot();
  assert.equal(again.sequence, s.sequence);
  assert.equal(again.capture, s.capture + 1);
  assert.notEqual(again.snapshot_id, s.snapshot_id);
  assert.throws(()=>observer.snapshot({characterId:'nonexistent'}), /protagonist/);
});

test('role projections use captured canonical trials and stages instead of a fresh hidden world read', () => {
  const server = createDeskBotServer({now});
  const world = server.persistentWorld.get();
  const original = server.roleEvolution.snapshot({world, at:now()});
  // Call every observer role path with a captured state. A missing world must
  // not fall back to the newer canonical state implicitly.
  const get=server.persistentWorld.get;
  server.persistentWorld.get=()=>{throw Error('hidden world read');};
  assert.deepEqual(server.roleEvolution.snapshot({world, at:now()}),original);
  assert.deepEqual(server.roleEvolution.currentStages({world, at:now()}),[]);
  assert.deepEqual(server.roleEvolution.wishProposals({world, at:now()}),[]);
  server.persistentWorld.get=get;
});

test('ownership reports disabled workers, paused scheduling, model fallback and task conflicts honestly', () => {
  const world = createPersistentWorld({now,timeMode:'realtime'}).get();
  installResidentLife(world,now().toISOString());
  const own=world.protagonist.character_id, peer=world.npcs[0].npc_id;
  world.memory={planner:{enabled:true}};
  world.cognition={actors:{[own]:{actor_id:own,enabled:true}}};
  world.autonomy.actors[peer].paused=true;
  world.tasks=[{task_id:'a',actor_id:own,status:'running',target_object_id:'shared-table'}, {task_id:'b',actor_id:own,status:'paused',target_object_id:'shared-table'}];
  const view=worldRuntimeReadModel(world,{autonomousLifeEnabled:true,worldLifeEnabled:true,modelConfigured:true,at:now().toISOString()});
  assert.equal(view.continuous_cognition_count,1);
  assert.equal(view.actors[0].scheduler,'continuous_cognition');
  assert.equal(view.actors[0].status,'worker_unavailable');
  assert.deepEqual(view.actors[0].conflicts,['multiple_active_tasks']);
  assert.equal(view.actors.find(a=>a.actor_id===peer).status,'paused');
  assert.equal(view.facilities[0].tasks.length,2);
  world.cognition.actors[own].enabled=false;
  const fallback=worldRuntimeReadModel(world,{autonomousLifeEnabled:true,at:now().toISOString()});
  assert.equal(fallback.actors[0].decision_mode,'rules');
  assert.equal(fallback.continuous_cognition_count,0);
});

test('ledger sequence survives restart and duplicate ingest; snapshot cannot mutate persisted state', () => {
  const directory=mkdtempSync(join(tmpdir(),'deskbot-observer-'));
  try {
    const filename=join(directory,'world.sqlite');
    let store=createSqlitePersistence({filename});
    let world=createPersistentWorld({persistence:store,now});
    const event={event_id:'single',type:'world.mutation',source:'fixture',payload:{action:'advance_time',minutes:2}};
    world.ingest(event);const before=world.readSnapshot();
    before.world.logical_time.day=999;
    assert.notEqual(world.get().logical_time.day,999);
    const expected=world.readSnapshot();store.close();
    store=createSqlitePersistence({filename});world=createPersistentWorld({persistence:store,now});
    assert.deepEqual(world.readSnapshot(),expected);
    assert.equal(world.ingest(event).duplicate,true);
    assert.deepEqual(world.readSnapshot(),expected);store.close();
  } finally {rmSync(directory,{recursive:true,force:true});}
});

test('HTTP snapshot stays read-only and rejects an unknown world; chat history remains reachable', async () => {
  const server=createDeskBotServer({now});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  try {
    const before=server.persistentWorld.get();
    const response=await fetch(`${url}/api/world/snapshot`), s=await response.json();
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(s.map.world_revision,s.life.world_revision);
    assert.deepEqual(server.persistentWorld.get(),before);
    assert.equal((await fetch(`${url}/api/world/snapshot?world_id=missing`)).status,404);
    assert.equal((await fetch(`${url}/api/chat/history`)).status,200);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
