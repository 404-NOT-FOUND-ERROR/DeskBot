import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { ACTIVITIES, LIVING_RULE_VERSION, RESOURCE_RENEWAL_VERSION, SPRING_UNITS_PER_HOUR,
  installLivingResources, installResourceRenewal, advanceLivingResources, setLivingWeatherWindow,
  prepareLivingActivity, completeLivingActivity, releaseLivingReservation, livingReadModel,
} from '../src/living-resources.mjs';

const T0 = Date.parse('2026-10-04T04:00:00.000Z');
const iso = milliseconds => new Date(milliseconds).toISOString();
const ACTOR = 'fixture-resident';
const HOUR = 3_600_000;
const LOCATION = 'fixture-garden';
function fixture() {
  const objectIds = ['floating-frame', 'garden-bed', 'seedling-rack', 'repair-bench', 'parts-drawers', 'market-canopy', 'trial-stove', 'shared-table'];
  const world = { clock: { mode: 'real_time', time_zone: 'Asia/Shanghai' },
    protagonist: { character_id: ACTOR, display_name: '留种者', location_id: LOCATION }, npcs: [], tasks: [], weather: {},
    map_catalog: { objects: objectIds.map(object_id => ({ object_id, area_id: 'public-yard', name: object_id })),
      areas: [{ area_id: 'public-yard', location_id: LOCATION, access: 'public' }] } };
  installLivingResources(world, iso(T0));
  return world;
}
function start(world, activityId, taskId = activityId) {
  const prepared = prepareLivingActivity(world, activityId, ACTOR, iso(T0));
  const task = { ...prepared, task_id: taskId, actor_id: ACTOR, status: 'running' };
  world.tasks.push(task);
  return task;
}
function legacy(world) {
  delete world.living.resource_renewal;
  delete world.living.objects['floating-frame'].stock;
  delete world.living.objects['floating-frame'].capacity;
  return world;
}
function wetObservation(world) {
  world.weather.snapshot = { condition: '大雨', wind_mps: 15, humidity: .8, temperature_c: 20, provider: 'fixture', observed_at: iso(T0) };
  setLivingWeatherWindow(world, { event_id: 'fixture-rain', source_kind: 'external_provider',
    provenance: { connector: 'weather', manually_injected: false, fetched_at: iso(T0), expires_at: iso(T0 + 30 * 60_000) } }, iso(T0));
}

test('new source and recipes declare finite material conversion and authored physics', () => {
  const world = fixture(), frame = world.living.objects['floating-frame'];
  assert.deepEqual(frame.stock, { raw_water: 12 }); assert.equal(frame.capacity, 24);
  assert.equal(world.living.rule_version, LIVING_RULE_VERSION);
  assert.equal(world.living.resource_renewal.id, RESOURCE_RENEWAL_VERSION);
  assert.equal(world.living.resource_renewal.source_kind, 'authored_world_physics');
  assert.equal(world.living.resource_renewal.units_per_hour, SPRING_UNITS_PER_HOUR);
  assert.match(world.living.resource_renewal.description, /与现实天气观测无关/);
  const collect = ACTIVITIES.find(a => a.activity_id === 'collect-water'), seeds = ACTIVITIES.find(a => a.activity_id === 'save-seeds');
  assert.equal(collect.seconds, 600); assert.equal(collect.target, 'floating-frame');
  assert.deepEqual(collect.inputs, [{ container: 'floating-frame', resource: 'raw_water', count: 4 }]);
  assert.deepEqual(collect.output, { container: 'bag', resource: 'water', count: 4 });
  assert.equal(seeds.seconds, 1200); assert.equal(seeds.target, 'seedling-rack');
  assert.deepEqual(seeds.inputs, [{ container: 'bag', resource: 'moss', count: 2 }]);
  assert.deepEqual(seeds.output, { container: 'bag', resource: 'seeds', count: 2 });
  const projection = livingReadModel(world);
  assert.deepEqual(projection.activities.find(a => a.activity_id === 'collect-water').output, { resource: 'water', name: '清水', count: 4, to: '随身袋' });
  assert.deepEqual(projection.resource_renewal, world.living.resource_renewal);
});

test('legacy migration adds only the source once, preserving stock, task reservations and clock cursor', () => {
  const world = legacy(fixture()), rack = world.living.objects['seedling-rack'];
  rack.stock.water = 5.25; rack.stock.seeds = .5;
  world.tasks.push({ task_id: 'old-watering', actor_id: ACTOR, status: 'paused', activity_id: 'water-bed',
    completion_effect: LIVING_RULE_VERSION, reservation: { status: 'held', inputs: [{ container: 'seedling-rack', resource: 'water', count: 3 }] } });
  const tasks = structuredClone(world.tasks), stocks = structuredClone(rack.stock), clock = structuredClone(world.clock), oldMigration = structuredClone(world.living.migration);
  const cursor = world.living.simulated_until, installed = world.living.installed_at, originalFrame = structuredClone(world.living.objects['floating-frame']);
  assert.equal(installResourceRenewal(world, iso(T0 + HOUR)), true);
  assert.deepEqual(world.tasks, tasks); assert.deepEqual(rack.stock, stocks); assert.deepEqual(world.clock, clock);
  assert.equal(world.living.simulated_until, cursor); assert.equal(world.living.installed_at, installed);
  assert.deepEqual(world.living.migration, oldMigration); assert.equal(world.living.rule_version, LIVING_RULE_VERSION);
  assert.deepEqual(world.living.objects['floating-frame'], { ...originalFrame, stock: { raw_water: 12 }, capacity: 24 });
  assert.equal(world.living.recent_changes.at(-1).migration_id, RESOURCE_RENEWAL_VERSION);
  const once = structuredClone(world);
  assert.equal(installResourceRenewal(world, iso(T0 + 2 * HOUR)), false);
  assert.deepEqual(world, once);
});

test('migration preserves an already populated spring and never backfills pre-installation supplies', () => {
  const world = legacy(fixture());
  world.living.objects['floating-frame'].stock = { raw_water: 7.5 };
  world.living.objects['floating-frame'].capacity = 32;
  installResourceRenewal(world, iso(T0 + HOUR));
  assert.equal(world.living.objects['floating-frame'].stock.raw_water, 7.5);
  assert.equal(world.living.objects['floating-frame'].capacity, 32);
  advanceLivingResources(world, iso(T0 + HOUR));
  assert.equal(world.living.objects['floating-frame'].stock.raw_water, 7.5);
  advanceLivingResources(world, iso(T0 + 2 * HOUR));
  assert.ok(Math.abs(world.living.objects['floating-frame'].stock.raw_water - 8.25) < 1e-8);
});

test('spring rate is time based, caps at capacity and does not borrow fresh or expired rain', () => {
  const dry = fixture(), rainy = structuredClone(dry); wetObservation(rainy);
  advanceLivingResources(dry, iso(T0 + HOUR)); advanceLivingResources(rainy, iso(T0 + HOUR));
  const source = w => w.living.objects['floating-frame'].stock.raw_water;
  assert.ok(Math.abs(source(dry) - 12.75) < 1e-8);
  assert.equal(source(dry), source(rainy), 'fresh rain and its expiry have no effect on the authored spring');
  assert.ok(rainy.living.objects['seedling-rack'].stock.water > dry.living.objects['seedling-rack'].stock.water, 'trusted rain still affects the existing collection mechanism');
  const expiredRackWater = rainy.living.objects['seedling-rack'].stock.water;
  advanceLivingResources(rainy, iso(T0 + 2 * HOUR));
  assert.equal(rainy.living.objects['seedling-rack'].stock.water, expiredRackWater, 'expired rain does not continue adding clean water');
  assert.ok(Math.abs(source(rainy) - 13.5) < 1e-8);
  advanceLivingResources(dry, iso(T0 + 48 * HOUR)); assert.equal(source(dry), 24);
  const checkpoint = structuredClone(dry);
  assert.equal(advanceLivingResources(dry, iso(T0 + 48 * HOUR)).accepted, false); assert.deepEqual(dry, checkpoint);
});

test('held raw water occupies spring capacity and cancellation refunds exactly once', () => {
  const world = fixture(), frame = world.living.objects['floating-frame']; frame.stock.raw_water = 24;
  const task = start(world, 'collect-water'); assert.equal(frame.stock.raw_water, 20);
  advanceLivingResources(world, iso(T0 + HOUR)); assert.equal(frame.stock.raw_water, 20);
  releaseLivingReservation(world, task, iso(T0 + HOUR)); assert.equal(frame.stock.raw_water, 24);
  const after = structuredClone(world); releaseLivingReservation(world, task, iso(T0 + HOUR)); assert.deepEqual(world, after);
  assert.equal(world.living.inventories[ACTOR]?.stock.water ?? 0, 0);
});

test('water collection checks safe level and usable frame at start and completion', () => {
  for (const unsafe of [{ water_level: .149 }, { water_level: .881 }, { condition: .399 }]) {
    const world = fixture(), frame = world.living.objects['floating-frame']; Object.assign(frame, unsafe);
    const before = structuredClone(world);
    assert.throws(() => start(world, 'collect-water'), { code: 'activity_unavailable' }); assert.deepEqual(world, before);
  }
  for (const safe of [{ water_level: .15, condition: .4 }, { water_level: .88, condition: .4 }]) {
    const world = fixture(); Object.assign(world.living.objects['floating-frame'], safe);
    const task = start(world, 'collect-water'); assert.equal(task.duration_seconds, 600);
    assert.equal(completeLivingActivity(world, task, iso(T0 + 600_000)).success, true);
    assert.equal(world.living.inventories[ACTOR].stock.water, 4);
  }
  const changed = fixture(), task = start(changed, 'collect-water'); changed.living.objects['floating-frame'].water_level = .9;
  assert.equal(completeLivingActivity(changed, task, iso(T0 + 600_000)).success, false);
  releaseLivingReservation(changed, task, iso(T0 + 600_000));
  assert.equal(changed.living.objects['floating-frame'].stock.raw_water, 12);
  assert.equal(changed.living.inventories[ACTOR]?.stock.water ?? 0, 0);
});

test('collect and seed conversion consume only held inputs and cannot run twice', () => {
  const water = fixture(), waterTask = start(water, 'collect-water');
  assert.equal(water.living.objects['floating-frame'].stock.raw_water, 8);
  assert.equal(water.living.inventories[ACTOR]?.stock.water ?? 0, 0);
  assert.equal(completeLivingActivity(water, waterTask, iso(T0 + 600_000)).success, true);
  assert.equal(waterTask.reservation.status, 'consumed'); assert.equal(water.living.inventories[ACTOR].stock.water, 4);
  assert.throws(() => completeLivingActivity(water, waterTask, iso(T0 + 600_000)), { code: 'activity_rules_changed' });
  assert.equal(water.living.inventories[ACTOR].stock.water, 4);
  const seeds = fixture(); seeds.living.inventories[ACTOR] = { stock: { moss: 2, seeds: 0 }, capacity: 24 };
  const seedTask = start(seeds, 'save-seeds'); assert.equal(seeds.living.inventories[ACTOR].stock.moss, 0);
  assert.equal(completeLivingActivity(seeds, seedTask, iso(T0 + 1_200_000)).success, true);
  assert.equal(seeds.living.inventories[ACTOR].stock.seeds, 2); assert.equal(seeds.living.objects['seedling-rack'].stock.seeds, 8);
  assert.throws(() => completeLivingActivity(seeds, seedTask, iso(T0 + 1_200_000)), { code: 'activity_rules_changed' });
  const noMoss = fixture(), before = structuredClone(noMoss);
  assert.throws(() => start(noMoss, 'save-seeds'), { code: 'activity_unavailable' }); assert.deepEqual(noMoss, before);
});

test('a full output bag rejects or fails without losing conversion input', () => {
  for (const [activity, resource, count] of [['collect-water', 'water', 21], ['save-seeds', 'seeds', 23]]) {
    const world = fixture(); world.living.inventories[ACTOR] = { stock: { moss: 2, [resource]: count }, capacity: 24 };
    const before = structuredClone(world);
    assert.throws(() => start(world, activity), { code: 'activity_unavailable' }); assert.deepEqual(world, before);
    world.living.inventories[ACTOR].stock[resource] = 0;
    const task = start(world, activity); world.living.inventories[ACTOR].stock[resource] = 24;
    assert.equal(completeLivingActivity(world, task, iso(T0 + task.duration_seconds * 1000)).success, false);
    releaseLivingReservation(world, task, iso(T0 + task.duration_seconds * 1000));
    assert.equal(world.living.inventories[ACTOR].stock[resource], 24);
    assert.equal(activity === 'collect-water' ? world.living.objects['floating-frame'].stock.raw_water : world.living.inventories[ACTOR].stock.moss, activity === 'collect-water' ? 12 : 2);
  }
});

test('canonical task enforces collection duration, preserves old activities and commits conversion through SQLite restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-renewal-')), filename = join(directory, 'world.sqlite');
  let time = T0, persistence = createSqlitePersistence({ filename });
  let world = createPersistentWorld({ now: () => new Date(time), persistence, timeMode: 'realtime' });
  const initial = world.get();
  initial.protagonist.location_id = initial.map_catalog.areas.find(area => area.area_id === initial.map_catalog.objects.find(object => object.object_id === 'floating-frame').area_id).location_id;
  persistence.put('canonical-world.states', initial.world_id, initial);
  world = createPersistentWorld({ now: () => new Date(time), persistence, timeMode: 'realtime' });
  t.after(() => { persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  const result = world.ingest({ event_id: 'spring-task', type: 'world.mutation', source: 'test', character_id: 'shaping-001', occurred_at: iso(time),
    payload: { action: 'start_activity', task_id: 'spring-task', activity_id: 'collect-water', duration_seconds: 1, completion: { water: 9999 } } });
  assert.equal(result.mutation.details.task.duration_ms, 600_000); assert.equal(result.mutation.details.task.completion_effect, LIVING_RULE_VERSION);
  time += 599_999; world.syncTasks(); assert.equal(world.get().tasks.find(task => task.task_id === 'spring-task').status, 'running');
  time += 1; persistence.close(); persistence = createSqlitePersistence({ filename });
  world = createPersistentWorld({ now: () => new Date(time), persistence, timeMode: 'realtime' }); world.syncTasks();
  const state = world.get(), task = state.tasks.find(item => item.task_id === 'spring-task');
  assert.equal(task.status, 'completed'); assert.equal(task.reservation.status, 'consumed');
  assert.equal(state.living.inventories['shaping-001'].stock.water, 4);
  assert.ok(Math.abs(state.living.objects['floating-frame'].stock.raw_water - 8.125) < 1e-8);
  const replay = structuredClone(state.living); world.syncTasks(); assert.deepEqual(world.get().living, replay);
});
