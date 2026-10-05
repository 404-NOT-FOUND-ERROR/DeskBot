import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';

const BASE=Date.parse('2026-10-05T04:00:00Z'),M=60000,donor='pot-cook-001',recipient='pathfinder-001';
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'deskbot-food-help-'));
  const filename=join(directory,'world.sqlite');let time=BASE,persistence,world,loop;
  const now=()=>new Date(time);
  function open(){persistence=createSqlitePersistence({filename,now});world=createPersistentWorld({persistence,now,timeMode:'realtime'});loop=createAutonomousLife({world,now,enabled:true});}
  open();
  world.ingest({event_id:'install-test-residents',type:'world.mutation',source:'food-help-fixture',character_id:'shaping-001',occurred_at:now().toISOString(),payload:{action:'install_resident_life'}});
  const state=world.get();
  for(const s of Object.values(state.autonomy.actors)) {s.paused=![donor,recipient].includes(s.actor_id);s.energy=.95;s.plan=null;s.next_decision_at='2099-01-01T00:00:00Z';}
  state.autonomy.actors[donor].appetite=.3;state.autonomy.actors[recipient].appetite=.97;
  for(const n of state.npcs.filter(n=>[donor,recipient].includes(n.npc_id)))n.location_id='warm-pot-courtyard';
  state.living.objects['shared-table'].stock.rations=0;
  state.living.inventories[donor]={stock:{rations:1},capacity:24};
  persistence.put('canonical-world.states',state.world_id,state);persistence.close();open();
  t.after(()=>{persistence.close();rmSync(directory,{recursive:true,force:true});});
  return {get world(){return world;},tick(){loop.tick();},run(minutes){for(let i=0;i<minutes;i++){time+=M;world.syncWallClock();world.syncTasks();loop.tick();}},
    restart(){const before=world.get();persistence.close();open();assert.deepEqual(world.get(),before);},
    save(fn){const s=world.get();fn(s);persistence.put('canonical-world.states',s.world_id,s);persistence.close();open();}};
}
test('hungry resident accepts an actual spare meal; only finishing the shared task satisfies hunger and keeps the promise',t=>{
  const h=fixture(t);h.tick();let w=h.world.get();
  const invitation=w.social.commitments.find(c=>c.kind==='food-help');assert.ok(invitation);
  assert.equal(invitation.status,'proposed');assert.equal(w.living.inventories[donor].stock.rations,1);
  assert.equal(w.autonomy.actors[recipient].appetite,.97);
  h.run(2);w=h.world.get();const meal=w.tasks.find(t=>t.activity_id==='share-meal'&&t.actor_id===recipient);
  assert.ok(meal);assert.equal(meal.status,'running');assert.equal(meal.origin,'social_life');
  assert.equal(meal.social_commitment_id,invitation.id);
  assert.equal(w.living.inventories[donor].stock.rations,0);assert.equal(w.living.objects['shared-table'].stock.rations,0);
  assert.equal(meal.reservation.status,'held');assert.ok(w.autonomy.actors[recipient].appetite>=.97);
  assert.equal(w.social.relationships[[donor,recipient].sort().join('|')].kept,0);
  h.restart();h.run(10);w=h.world.get();
  assert.equal(w.tasks.find(t=>t.task_id===meal.task_id).status,'completed');
  assert.equal(w.social.commitments.find(c=>c.id===invitation.id).status,'completed');
  assert.ok(w.autonomy.actors[recipient].appetite<.4);
  assert.equal(w.social.relationships[[donor,recipient].sort().join('|')].kept,1);
  h.restart();const stable=h.world.get();h.tick();assert.deepEqual(h.world.get(),stable);
});
test('a vanished promised meal fails atomically without satisfying hunger or minting stock',t=>{
  const h=fixture(t);h.tick();const invitation=h.world.get().social.commitments.find(c=>c.kind==='food-help');
  h.save(w=>{w.living.inventories[donor].stock.rations=0;});h.run(3);const w=h.world.get();
  assert.equal(w.social.commitments.find(c=>c.id===invitation.id).status,'failed');
  assert.ok(w.autonomy.actors[recipient].appetite>=.97);
  assert.equal(w.living.objects['shared-table'].stock.rations,0);
  assert.equal(w.living.inventories[recipient]?.stock.rations??0,0);
  assert.ok(!w.tasks.some(t=>t.activity_id==='share-meal'));
  assert.equal(w.social.relationships[[donor,recipient].sort().join('|')].kept,0);
});
