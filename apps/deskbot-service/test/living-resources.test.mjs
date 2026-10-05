import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createPersistentWorld, getWorldMap } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createDeskBotServer } from '../src/app.mjs';
import { advanceLivingResources, setLivingWeatherWindow, livingReadModel, completeLivingActivity } from '../src/living-resources.mjs';
const T0 = Date.parse('2026-10-04T04:00:00.000Z');
const GARDEN = 'moss-sprout-garden', PARTS = 'spare-parts-house';
function harness(t, location = GARDEN) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-living-')), filename = join(directory, 'world.sqlite');
  let time = T0, persistence = createSqlitePersistence({ filename });
  let world = createPersistentWorld({ now: () => new Date(time), persistence, timeMode: 'realtime' });
  // This isolated fixture locates the protagonist before any task is created.
  const initial = world.get(); initial.protagonist.location_id = location;
  persistence.put('canonical-world.states', initial.world_id, initial);
  world = createPersistentWorld({ now: () => new Date(time), persistence, timeMode: 'realtime' });
  t.after(() => { persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get world() { return world; }, get persistence() { return persistence; }, now: () => new Date(time),
    after(ms) { time += ms; }, restart() { persistence.close(); persistence = createSqlitePersistence({ filename }); world = createPersistentWorld({ now: () => new Date(time), persistence, timeMode: 'realtime' }); },
    save(change) { const state = world.get(); change(state); persistence.put('canonical-world.states', state.world_id, state); this.restart(); },
    mutate(id, payload, more = {}) { return world.ingest({ event_id: id, type: 'world.mutation', source: 'test', character_id: 'shaping-001', occurred_at: new Date(time).toISOString(), ...more, payload }); },
    start(id, activity) { return this.mutate(id, { action: 'start_activity', task_id: id, activity_id: activity, duration_seconds: 1, completion: { wood: 9999 } }); },
  };
}
function rain(world, milliseconds, { injected = false, future = false } = {}) {
  const at = new Date(milliseconds).toISOString();
  world.weather.snapshot = { condition: '大雨', wind_mps: 15, humidity: .8, temperature_c: 20, provider: 'fixture', observed_at: new Date(milliseconds + (future ? 120000 : 0)).toISOString() };
  setLivingWeatherWindow(world, { event_id: 'fixture-rain', source_kind: 'external_provider', provenance: { connector: 'weather', manually_injected: injected, fetched_at: at, expires_at: new Date(milliseconds + 1800000).toISOString() } }, at);
}
test('installation is additive and does not backfill pre-installation growth', t => {
  const h = harness(t), first = h.world.get(); h.after(60000); h.restart();
  assert.equal(h.world.get().living.installed_at, first.living.installed_at);
  assert.deepEqual(h.world.get().living.objects, first.living.objects);
  assert.deepEqual(h.world.get().protagonist, first.protagonist);
  assert.equal(first.living.objects['garden-bed'].growth, .25);
});
test('rain changes water/soil/collected stock only inside its trusted window', t => {
  const world = harness(t).world.get(), dry = structuredClone(world); rain(world, T0);
  advanceLivingResources(world, new Date(T0 + 6 * 3600000).toISOString());
  advanceLivingResources(dry, new Date(T0 + 6 * 3600000).toISOString());
  assert.ok(world.living.objects['floating-frame'].water_level > dry.living.objects['floating-frame'].water_level);
  assert.ok(world.living.objects['garden-bed'].moisture > dry.living.objects['garden-bed'].moisture);
  assert.ok(Math.abs(world.living.objects['seedling-rack'].stock.water - 12.8) < .001, 'only thirty minutes of collection, not six hours');
  assert.ok(world.living.objects['market-canopy'].condition < dry.living.objects['market-canopy'].condition);
  const replay = structuredClone(world); assert.equal(advanceLivingResources(world, world.living.simulated_until).accepted, false); assert.deepEqual(world, replay);
});
test('injected/future weather cannot cause rain, long downtime is bounded without losing the cursor', t => {
  const world = harness(t).world.get(); rain(world, T0, { injected: true }); assert.equal(world.living.weather_window, null);
  rain(world, T0, { future: true }); assert.equal(world.living.weather_window, null);
  const target = new Date(T0 + 20 * 86400000).toISOString();
  assert.equal(advanceLivingResources(world, target).pending, true);
  assert.equal(world.living.simulated_until, new Date(T0 + 7 * 86400000).toISOString());
  advanceLivingResources(world, target); advanceLivingResources(world, target);
  assert.equal(world.living.simulated_until, target); assert.equal(world.living.recovery.pending, false);
  assert.equal(world.living.objects['garden-bed'].quantity, 0, 'neglected seedlings leave an empty bed');
});
test('one offline segment and minute-by-minute advancement produce the same resources', t => {
  const a = harness(t).world.get(), b = structuredClone(a); rain(a, T0); rain(b, T0);
  advanceLivingResources(a, new Date(T0 + 180 * 60000).toISOString());
  for (let i = 1; i <= 180; i++) advanceLivingResources(b, new Date(T0 + i * 60000).toISOString());
  assert.deepEqual(a.living.objects, b.living.objects);
});
test('authored watering fixes the duration, reserves stock, completes once and survives SQLite restart', t => {
  const h = harness(t); const result = h.start('watering', 'water-bed'), task = result.mutation.details.task;
  assert.equal(task.duration_ms, 300000); assert.equal(task.completion_effect, 'morrowmere-living-resources-v1');
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 9);
  h.after(299999); h.world.syncTasks(); assert.equal(h.world.get().tasks[0].status, 'running');
  h.after(1); h.restart(); h.world.syncTasks();
  const state = h.world.get(); assert.equal(state.tasks[0].status, 'completed'); assert.equal(state.tasks[0].reservation.status, 'consumed');
  assert.ok(state.living.objects['garden-bed'].moisture > .80);
  h.restart(); h.world.syncTasks(); assert.deepEqual(h.world.get().living, state.living);
});
test('cancel refunds held material once; a changed completion predicate causes a real failure', t => {
  const h = harness(t); h.start('cancel-watering', 'water-bed');
  h.mutate('cancel', { action: 'control_task', task_id: 'cancel-watering', operation: 'cancel' });
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 12);
  assert.throws(() => h.mutate('cancel-again', { action: 'control_task', task_id: 'cancel-watering', operation: 'cancel' }), { code: 'task_terminal' });
  h.start('wet-failure', 'water-bed'); h.save(s => { s.living.objects['garden-bed'].moisture = .95; });
  h.after(300000); h.world.syncTasks();
  const task = h.world.get().tasks.find(t => t.task_id === 'wet-failure'); assert.equal(task.status, 'failed');
  assert.equal(task.completion.effect, 'no_effect'); assert.equal(task.reservation.status, 'returned');
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 12);
});
test('deadline effects precede downtime growth, and two actors cannot harvest the same bed', t => {
  const h = harness(t); h.save(s => { s.living.objects['garden-bed'].quantity = 0; s.living.objects['garden-bed'].growth = 0; });
  h.start('sow', 'sow-bed'); h.after(86400000); h.restart(); h.world.syncTasks();
  assert.ok(h.world.get().living.objects['garden-bed'].growth > .1, 'the new plants grow after the sowing deadline, including downtime');
  h.save(s => { s.living.objects['garden-bed'].growth = 1; s.living.objects['garden-bed'].health = .9; s.living.objects['garden-bed'].moisture = .6; s.npcs.push({ npc_id: 'fixture-helper', location_id: GARDEN, display_name: '帮手' }); });
  h.start('harvest', 'harvest-bed');
  assert.throws(() => h.mutate('second-harvest', { action: 'start_activity', task_id: 'second-harvest', activity_id: 'harvest-bed', actor_id: 'fixture-helper' }), { code: 'activity_unavailable' });
  h.after(900000); h.world.syncTasks();
  assert.equal(h.world.get().living.objects['garden-bed'].quantity, 0);
  assert.ok(h.world.get().living.inventories['shaping-001'].stock.moss >= 8);
});
test('stock must be carried from its real location; crafting consumes finite supplies', t => {
  const h = harness(t, PARTS);
  h.mutate('take-cloth', { action: 'transfer_resource', object_id: 'parts-drawers', resource: 'cloth', count: 2, operation: 'take' });
  assert.equal(h.world.get().living.objects['parts-drawers'].stock.cloth, 4);
  assert.equal(h.world.get().living.inventories['shaping-001'].stock.cloth, 2);
  assert.throws(() => h.mutate('remote-water', { action: 'transfer_resource', object_id: 'seedling-rack', resource: 'water', count: 1, operation: 'take' }), { code: 'resource_actor_unavailable' });
  assert.throws(() => h.mutate('mint', { action: 'transfer_resource', object_id: 'parts-drawers', resource: 'wood', count: -2, operation: 'take' }), { code: 'invalid_resource_transfer' });
  h.start('frame-kit', 'craft-frame-kit'); h.after(1500000); h.world.syncTasks();
  assert.equal(h.world.get().living.inventories['shaping-001'].stock.frame_kit, 1);
  assert.equal(h.world.get().living.objects['parts-drawers'].stock.wood, 6);
  const model = getWorldMap(h.world.get()); assert.equal(model.objects.find(o => o.object_id === 'parts-drawers').state_scope, 'persistent_living');
  assert.equal(model.content.objects_have_simulated_state, true);
});
test('reservation counts against capacity while rain fills a tank, refund never overflows', t => {
  const h = harness(t); h.save(s => { s.living.objects['seedling-rack'].stock.water = 24; }); h.start('tank', 'water-bed');
  const state = h.world.get(); rain(state, T0); advanceLivingResources(state, new Date(T0 + 240000).toISOString());
  assert.equal(state.living.objects['seedling-rack'].stock.water, 21);
  h.save(s => { s.living = state.living; });
  h.after(240000); h.mutate('cancel-tank', { action: 'control_task', task_id: 'tank', operation: 'cancel' });
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 24);
});
test('repair and cooking require usable conditions and produce committed outcomes', t => {
  const h = harness(t, 'echo-waterside'); h.save(s => { s.living.inventories['shaping-001'] = { stock: { frame_kit: 1 }, capacity: 24 }; });
  h.start('repair', 'repair-frame'); h.after(1200000); h.world.syncTasks();
  assert.ok(h.world.get().living.objects['floating-frame'].condition > .99);
  assert.equal(h.world.get().living.inventories['shaping-001'].stock.frame_kit, 0);
  h.save(s => { s.protagonist.location_id = 'warm-pot-courtyard'; s.living.inventories['shaping-001'].stock.moss = 2; });
  h.start('cook', 'cook-moss'); h.after(1200000); h.world.syncTasks();
  assert.equal(h.world.get().living.inventories['shaping-001'].stock.rations, 2);
  assert.equal(h.world.get().living.objects['trial-stove'].stock.water, 7);
  const snapshot = h.world.get(); const task = snapshot.tasks.find(t => t.task_id === 'cook');
  assert.throws(() => completeLivingActivity(snapshot, task, h.now().toISOString()), { code: 'activity_rules_changed' });
});
test('HTTP fields cannot forge duration/effects/actor and generic public observations cannot mutate stocks', async t => {
  const h = harness(t), server = createDeskBotServer({ now: h.now, persistence: h.persistence, persistentWorld: h.world, timeMode: 'realtime' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { event_id: 'http-water', activity_id: 'water-bed', duration_seconds: 1, actor_id: 'fixture-admin', title: '资源变成无限', completion: { inventory: 99999 } };
  const first = await post('/api/world/tasks', body); assert.equal(first.status, 202); await first.json();
  h.after(1000); const retry = await post('/api/world/tasks', body); assert.equal(retry.status, 200); assert.equal((await retry.json()).duplicate, true);
  const task = h.world.get().tasks.find(t => t.activity_id === 'water-bed'); assert.equal(task.actor_id, 'shaping-001'); assert.equal(task.duration_ms, 300000);
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 9);
  const denied = await post('/api/event', { event_id: 'fake-state', type: 'world.mutation', source: 'user', payload: { action: 'advance_living_world', until: '2050-01-01T00:00:00Z' } });
  assert.equal(denied.status, 403);
  const before = h.world.get(); const read = await fetch(url + '/api/world/map'); assert.equal(read.status, 200); const map = await read.json();
  assert.ok(map.living.activities.some(a => a.activity_id === 'harvest-bed')); assert.deepEqual(h.world.get(), before, 'map is still a read-only projection');
});
