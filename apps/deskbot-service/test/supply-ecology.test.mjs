import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import {
  installCommunitySupply, advanceLivingResources, prepareLivingActivity,
  completeLivingActivity, releaseLivingReservation, transferLivingResource, livingReadModel, livingObjectReadModel,
  COMMUNITY_SUPPLY_VERSION, LIGHT_FRUIT_CAPACITY,
} from '../src/living-resources.mjs';

const START = Date.parse('2026-10-05T04:00:00.000Z');
const HOUR = 3_600_000;
const at = hours => new Date(START + hours * HOUR).toISOString();
const OWNER = 'shaping-001';
const FRUIT = 'light-fruit-bough';
function fixture() {
  const w = createPersistentWorld({ now: () => new Date(START), timeMode: 'realtime' }).get();
  // This isolated fixture also works before the authored catalog migration runs.
  if (!w.map_catalog.objects.some(o => o.object_id === FRUIT)) w.map_catalog.objects.push({ object_id: FRUIT, name: '林缘光果枝', area_id: 'grove-edge' });
  if (!w.map_catalog.areas.some(a => a.area_id === 'grove-edge')) w.map_catalog.areas.push({ area_id: 'grove-edge', location_id: 'backlit-grove', access: 'public' });
  delete w.living.community_supply;
  delete w.living.objects[FRUIT];
  delete w.living.objects['seedling-rack'].stock.light_fruit;
  w.living.weather_window = null;
  w.protagonist.location_id = 'backlit-grove';
  return w;
}
function total(w, resource) {
  return Object.values(w.living.objects).reduce((n, o) => n + (o.stock?.[resource] ?? 0), 0)
    + Object.values(w.living.inventories).reduce((n, b) => n + (b.stock?.[resource] ?? 0), 0)
    + w.tasks.filter(t => t.reservation?.status === 'held').flatMap(t => t.reservation.inputs).filter(i => i.resource === resource).reduce((n, i) => n + i.count, 0);
}
function start(w, id, activity, hours) {
  const task = { task_id: id, actor_id: OWNER, status: 'running', ...prepareLivingActivity(w, activity, OWNER, at(hours)) };
  w.tasks.push(task);
  return task;
}

test('community supply installs an empty source and shared slot, preserving existing material, tasks and identities', () => {
  const w = fixture();
  w.tasks.push({ task_id: 'existing-held-crop', actor_id: 'old-helper', status: 'paused', reservation: { status: 'held', inputs: [{ container: 'seedling-rack', resource: 'water', count: 3 }] } });
  w.living.inventories[OWNER] = { stock: { moss: 2 }, capacity: 24 };
  const before = structuredClone(w), beforeMeals = total(w, 'rations');
  assert.equal(installCommunitySupply(w, at(0)), true);
  assert.equal(w.living.community_supply.id, COMMUNITY_SUPPLY_VERSION);
  assert.equal(w.living.objects[FRUIT].stock.light_fruit, 0);
  assert.equal(w.living.objects[FRUIT].capacity, LIGHT_FRUIT_CAPACITY);
  assert.equal(w.living.objects['seedling-rack'].stock.light_fruit, 0);
  assert.equal(total(w, 'rations'), beforeMeals);
  for (const [id, object] of Object.entries(before.living.objects)) {
    const expected = structuredClone(object);
    if (id === 'seedling-rack') expected.stock.light_fruit = 0;
    assert.deepEqual(w.living.objects[id], expected);
  }
  assert.deepEqual(w.tasks, before.tasks);
  assert.deepEqual(w.living.inventories, before.living.inventories);
  assert.deepEqual(w.protagonist, before.protagonist);
  const installed = structuredClone(w);
  assert.equal(installCommunitySupply(w, at(12)), false);
  assert.deepEqual(w, installed, 'restarting cannot give stock or repeat the migration');
  const unadmitted = fixture(); unadmitted.map_catalog.objects = unadmitted.map_catalog.objects.filter(o => o.object_id !== FRUIT);
  assert.equal(installCommunitySupply(unadmitted, at(0)), false, 'ecology requires an actual authored map object');
  assert.equal(unadmitted.living.objects[FRUIT], undefined);
});

test('fruit regeneration is bounded by elapsed post-install time, never backfilled or delivered as a meal', () => {
  const w = fixture(); w.living.simulated_until = at(-48);
  installCommunitySupply(w, at(0)); const meals = total(w, 'rations');
  advanceLivingResources(w, at(0));
  assert.equal(w.living.objects[FRUIT].stock.light_fruit, 0);
  advanceLivingResources(w, at(2));
  assert.ok(Math.abs(w.living.objects[FRUIT].stock.light_fruit - 1) < 1e-9);
  assert.equal(total(w, 'rations'), meals);
  assert.equal(w.living.inventories[OWNER], undefined, 'time alone cannot gather into a resident bag');
  const before = structuredClone(w);
  assert.equal(advanceLivingResources(w, at(2)).accepted, false);
  assert.deepEqual(w, before);
});

test('a gathering reservation excludes another collector, preserves source capacity and refunds once', () => {
  const w = fixture(); installCommunitySupply(w, at(0)); advanceLivingResources(w, at(25));
  assert.equal(w.living.objects[FRUIT].stock.light_fruit, 12);
  const gather = start(w, 'reserved-fruit', 'gather-light-fruit', 25);
  assert.equal(gather.duration_seconds, 600);
  assert.deepEqual(gather.reservation.inputs, [{ container: FRUIT, resource: 'light_fruit', count: 2 }]);
  assert.equal(w.living.objects[FRUIT].stock.light_fruit, 10);
  assert.equal(w.living.inventories[OWNER], undefined, 'holding fruits creates no completed output');
  assert.throws(() => transferLivingResource(w, { actor_id: OWNER, object_id: FRUIT, resource: 'light_fruit', count: 1, operation: 'take' }, at(25)), { code: 'resource_source_requires_gathering' }, 'an ordinary transfer cannot bypass the gathering task');
  w.npcs.push({ npc_id: 'fruit-fixture-helper', display_name: '隔离采集者', location_id: 'backlit-grove' });
  assert.throws(() => prepareLivingActivity(w, 'gather-light-fruit', 'fruit-fixture-helper', at(25)), { code: 'activity_unavailable' });
  advanceLivingResources(w, at(26));
  assert.equal(w.living.objects[FRUIT].stock.light_fruit, 10, 'held fruit occupies the two source slots');
  assert.equal(total(w, 'light_fruit'), 12);
  releaseLivingReservation(w, gather, at(26)); gather.status = 'cancelled';
  assert.equal(w.living.objects[FRUIT].stock.light_fruit, 12);
  assert.equal(gather.reservation.status, 'returned');
  const refunded = structuredClone(w.living);
  releaseLivingReservation(w, gather, at(26)); assert.deepEqual(w.living, refunded);
});

test('gathering and cooking consume real finite inputs; distant cooking and a broken stove cannot produce meals', () => {
  const w = fixture(); installCommunitySupply(w, at(0)); advanceLivingResources(w, at(4 + 1 / 60));
  const beforeFruit = total(w, 'light_fruit');
  const gather = start(w, 'completed-fruit', 'gather-light-fruit', 4 + 1 / 60);
  const result = completeLivingActivity(w, gather, at(4 + 1 / 60 + 1 / 6));
  assert.equal(result.success, true); gather.status = 'completed';
  assert.equal(gather.reservation.status, 'consumed');
  assert.equal(w.living.inventories[OWNER].stock.light_fruit, 2);
  assert.ok(Math.abs(w.living.objects[FRUIT].stock.light_fruit - (beforeFruit - 2)) < 1e-9);
  assert.throws(() => prepareLivingActivity(w, 'cook-grove-stew', OWNER, at(4 + 1 / 60 + 1 / 6)), { code: 'activity_unavailable' });
  w.protagonist.location_id = 'warm-pot-courtyard';
  w.living.objects['trial-stove'].condition = .2;
  assert.throws(() => prepareLivingActivity(w, 'cook-grove-stew', OWNER, at(5)), { code: 'activity_unavailable' });
  w.living.objects['trial-stove'].condition = .9;
  const beforeWater = total(w, 'water'), beforeMeals = total(w, 'rations');
  const cook = start(w, 'completed-stew', 'cook-grove-stew', 5);
  assert.equal(cook.duration_seconds, 1200);
  assert.equal(total(w, 'rations'), beforeMeals, 'a plan or held recipe is not a cooked meal');
  assert.ok(Math.abs(total(w, 'light_fruit') - beforeFruit) < 1e-9);
  assert.equal(completeLivingActivity(w, cook, at(5 + 1 / 3)).success, true); cook.status = 'completed';
  assert.equal(total(w, 'rations'), beforeMeals + 3);
  assert.equal(total(w, 'water'), beforeWater - 1);
  assert.ok(Math.abs(total(w, 'light_fruit') - (beforeFruit - 2)) < 1e-9);
  assert.throws(() => completeLivingActivity(w, cook, at(6)), { code: 'activity_rules_changed' });
});

test('fourteen dry days keep the spring collectable, while bounded recovery and minute stepping agree', () => {
  const chunk = fixture(); installCommunitySupply(chunk, at(0)); const minute = structuredClone(chunk);
  const target = at(14 * 24);
  assert.equal(advanceLivingResources(chunk, target).pending, true);
  assert.equal(chunk.living.simulated_until, at(7 * 24));
  assert.equal(advanceLivingResources(chunk, target).pending, false);
  for (let index = 1; index <= 14 * 24 * 60; index++) advanceLivingResources(minute, new Date(START + index * 60_000).toISOString());
  assert.deepEqual(chunk.living.objects, minute.living.objects);
  assert.equal(chunk.living.objects[FRUIT].stock.light_fruit, 12);
  const spring = chunk.living.objects['floating-frame'];
  assert.ok(spring.water_level > .38 && spring.water_level < .47, 'authored spring flow prevents an inexorable dry-world lockout');
  assert.equal(spring.stock.raw_water, spring.capacity);
  assert.equal(total(chunk, 'rations'), 3, 'two offline weeks do not invent completed cooking or eating');
  const model = livingReadModel(chunk);
  assert.equal(model.community_supply.fruit_units_per_hour, .5);
  assert.equal(model.community_supply.source_kind, 'authored_world_physics');
  const object = livingObjectReadModel(chunk, chunk.map_catalog.objects.find(o => o.object_id === FRUIT));
  assert.match(object.status_text, /12\/12/);
  assert.match(object.status_text, /0.5/);
});
