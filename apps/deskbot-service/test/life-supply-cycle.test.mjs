import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld, getWorldMap } from '../src/persistent-world.mjs';
import { createWorldLife } from '../src/world-life.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { passageFor } from '../src/world-map-content.mjs';

// The clock and starting stocks belong only to this disposable SQLite world.
// No server, external provider, production database or LLM configuration is used.
const START = Date.parse('2026-10-05T04:00:00.000Z');
const MINUTE = 60_000;
const OWN = 'shaping-001';
const GARDEN = 'moss-sprout-garden';
const KITCHEN = 'warm-pot-courtyard';
const WATER = 'echo-waterside';
const own = w => w.autonomy.actors[OWN];
const bag = (w, resource, actor = OWN) => w.living.inventories[actor]?.stock?.[resource] ?? 0;
const stock = (w, object, resource) => w.living.objects[object]?.stock?.[resource] ?? 0;
const activity = (w, id, status) => w.tasks.find(task => task.actor_id === OWN && task.activity_id === id && (!status || task.status === status));

function fixture(t, { location = KITCHEN } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-supply-cycle-'));
  const filename = join(directory, 'isolated-world.sqlite');
  let time = START, persistence, world, loop;
  const samples = [], seen = new Set();
  function open() {
    persistence = createSqlitePersistence({ filename, now: () => new Date(time) });
    world = createPersistentWorld({ persistence, now: () => new Date(time), timeMode: 'realtime' });
    loop = createAutonomousLife({ world, now: () => new Date(time), enabled: true });
  }
  open();
  createWorldLife({ worldSnapshot: () => world.get(), ingest: event => world.ingest(event), now: () => new Date(time), enabled: true }).seedNpcs();
  const initial = world.get();
  initial.protagonist.location_id = location;
  installAutonomy(initial, new Date(time).toISOString());
  for (const state of Object.values(initial.autonomy.actors)) state.paused = state.actor_id !== OWN;
  own(initial).energy = .98;
  initial.living.weather_window = null;
  initial.living.objects['seedling-rack'].stock.trays = 2;
  persistence.put('canonical-world.states', initial.world_id, initial);
  persistence.close(); open();
  function capture() {
    for (const task of world.get().tasks) {
      const key = `${task.task_id}:${task.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push({ minute: (time - START) / MINUTE, id: task.activity_id ?? task.kind, status: task.status, location: task.location_id ?? task.destination_location_id });
    }
  }
  t.after(() => { persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    get world() { return world; }, get elapsedMinutes() { return (time - START) / MINUTE; }, samples,
    now: () => new Date(time),
    tick() { const result = loop.tick(); capture(); return result; },
    restart() { persistence.close(); open(); },
    save(change) { const state = world.get(); change(state); persistence.put('canonical-world.states', state.world_id, state); this.restart(); },
    mutate(id, payload) { const result = world.ingest({ event_id: id, type: 'world.mutation', source: 'supply-cycle-fixture', character_id: OWN, occurred_at: new Date(time).toISOString(), payload }); capture(); return result; },
    advance(minutes = 1, { tick = true } = {}) {
      for (let i = 0; i < minutes; i++) {
        time += MINUTE; world.syncWallClock(); world.syncTasks();
        if (tick) this.tick(); else capture();
      }
    },
    until(predicate, limit = 240) {
      for (let i = 0; i <= limit; i++) {
        if (predicate(world.get())) return world.get();
        if (i < limit) this.advance();
      }
      assert.fail(`No expected supply phase within ${limit} minutes: ${JSON.stringify({ plan: own(world.get()).plan, samples })}`);
    },
    checkpoint() {
      const before = world.get(); this.restart(); this.tick();
      assert.deepEqual(world.get(), before, 'restart and the same minute must not replay a task, reservation or transfer');
      getWorldMap(world.get()); assert.deepEqual(world.get(), before, 'read projections must not advance the supply chain');
    },
  };
}

function hungryKitchen(h) {
  h.save(w => {
    own(w).appetite = .95;
    w.living.objects['trial-stove'].stock.water = 0;
    w.living.objects['seedling-rack'].stock.water = 0;
    w.living.objects['shared-table'].stock.rations = 0;
    w.living.inventories[OWN] = { stock: { moss: 2 }, capacity: 24 };
    Object.assign(w.living.objects['garden-bed'], { moisture: .65, health: .9, growth: .2, quantity: 10 });
  });
}

function totalMaterial(w, resource) {
  const held = w.tasks.filter(t => t.reservation?.status === 'held').flatMap(t => t.reservation.inputs)
    .filter(input => input.resource === resource).reduce((sum, input) => sum + input.count, 0);
  return Object.values(w.living.objects).reduce((sum, object) => sum + (object.stock?.[resource] ?? 0), 0)
    + Object.values(w.living.inventories).reduce((sum, inventory) => sum + (inventory.stock?.[resource] ?? 0), 0) + held;
}

test('isolated SQLite: a hungry resident obtains water, carries it home, cooks and eats, with restart at each phase', t => {
  const h = fixture(t); hungryKitchen(h); h.tick();
  let w = h.world.get();
  assert.equal(own(w).plan.goal, 'meal');
  assert.equal(w.tasks.find(task => task.actor_id === OWN && task.status === 'running').kind, 'travel');
  assert.equal(w.protagonist.location_id, KITCHEN, 'departure does not teleport the actor');
  assert.equal(own(w).plan.steps.find(step => step.kind === 'travel').location_id, WATER);
  assert.equal(stock(w, 'floating-frame', 'raw_water'), 12);
  h.checkpoint();

  w = h.until(w => activity(w, 'collect-water', 'running'));
  const collection = activity(w, 'collect-water', 'running');
  assert.equal(w.protagonist.location_id, WATER);
  assert.equal(collection.target_object_id, 'floating-frame');
  assert.equal(collection.duration_ms, 10 * MINUTE);
  assert.deepEqual(collection.reservation.inputs, [{ container: 'floating-frame', resource: 'raw_water', count: 4 }]);
  assert.equal(bag(w, 'water'), 0, 'starting a task only holds raw water; it does not create its output');
  h.checkpoint(); h.advance(9);
  assert.equal(activity(h.world.get(), 'collect-water').status, 'running');
  assert.equal(bag(h.world.get(), 'water'), 0);
  h.advance(); w = h.world.get();
  assert.equal(activity(w, 'collect-water').status, 'completed');
  assert.equal(activity(w, 'collect-water').reservation.status, 'consumed');
  assert.equal(bag(w, 'water'), 4);
  assert.equal(stock(w, 'trial-stove', 'water'), 0, 'the distant kitchen cannot receive water before actual travel and storage');
  h.checkpoint();

  w = h.until(w => activity(w, 'cook-moss', 'running'));
  assert.equal(w.protagonist.location_id, KITCHEN);
  const cooking = activity(w, 'cook-moss', 'running');
  assert.equal(cooking.duration_ms, 20 * MINUTE);
  assert.equal(cooking.reservation.inputs.find(input => input.resource === 'moss').count, 2);
  assert.equal(cooking.reservation.inputs.find(input => input.resource === 'water').container, 'trial-stove');
  assert.equal(bag(w, 'rations'), 0);
  assert.ok(w.autonomy.recent.some(note => note.kind === 'transfer' && note.text.includes('清水')));
  h.checkpoint(); h.advance(19);
  assert.equal(activity(h.world.get(), 'cook-moss').status, 'running');
  assert.equal(bag(h.world.get(), 'rations'), 0);
  h.advance(); w = h.world.get();
  assert.equal(activity(w, 'cook-moss').status, 'completed');
  assert.equal(totalMaterial(w, 'rations'), 2);
  assert.equal(totalMaterial(w, 'moss'), 0);
  h.checkpoint();

  w = h.until(w => activity(w, 'share-meal', 'running'));
  assert.equal(activity(w, 'share-meal', 'running').duration_ms, 10 * MINUTE);
  const appetite = own(w).appetite;
  h.checkpoint(); h.advance(9);
  assert.ok(own(h.world.get()).appetite >= appetite, 'reserved food does not satisfy hunger before the meal finishes');
  h.advance(); w = h.world.get();
  assert.equal(activity(w, 'share-meal').status, 'completed');
  assert.ok(own(w).appetite < .4);
  assert.equal(totalMaterial(w, 'rations'), 1, 'two cooked meals minus the one actually eaten');
  assert.equal(totalMaterial(w, 'water'), 3, 'four purified units minus one consumed by cooking');
  assert.ok(Math.abs(stock(w, 'floating-frame', 'raw_water') - (12 - 4 + h.elapsedMinutes * .75 / 60)) < .002, 'only bounded natural regeneration replenishes the raw source');
  assert.equal(w.tasks.filter(task => task.activity_id === 'collect-water').length, 1);
  assert.equal(w.tasks.filter(task => task.activity_id === 'cook-moss').length, 1);
  assert.equal(w.tasks.filter(task => task.activity_id === 'share-meal').length, 1);
  h.checkpoint();
  t.diagnostic(`Supply chain (${h.elapsedMinutes} simulated minutes; isolated 1:1 deadlines): ${JSON.stringify(h.samples)}`);
});

test('an empty dead bed first consumes two actual moss to save two seeds, stores them, then sows', t => {
  const h = fixture(t, { location: GARDEN });
  h.save(w => {
    Object.assign(w.living.objects['garden-bed'], { quantity: 0, dead_quantity: 10, health: 0, growth: 0, moisture: .6 });
    Object.assign(w.living.objects['seedling-rack'].stock, { seeds: 0, moss: 2 });
  });
  h.tick(); let w = h.world.get();
  assert.equal(own(w).plan.goal, 'sow');
  assert.deepEqual(own(w).plan.steps.filter(step => step.kind === 'activity').map(step => step.activity_id), ['save-seeds', 'sow-bed']);
  w = h.until(w => activity(w, 'save-seeds', 'running'));
  assert.equal(activity(w, 'save-seeds').target_object_id, 'seedling-rack');
  assert.equal(activity(w, 'save-seeds').duration_ms, 20 * MINUTE);
  assert.equal(totalMaterial(w, 'moss'), 2, 'held material is still conserved while seed preparation runs');
  assert.equal(totalMaterial(w, 'seeds'), 0);
  h.checkpoint(); h.advance(19);
  assert.equal(totalMaterial(h.world.get(), 'seeds'), 0);
  assert.equal(h.world.get().living.objects['garden-bed'].quantity, 0);
  h.advance(); w = h.world.get();
  assert.equal(activity(w, 'save-seeds').status, 'completed');
  assert.equal(totalMaterial(w, 'moss'), 0);
  assert.equal(totalMaterial(w, 'seeds'), 2);
  h.checkpoint();
  w = h.until(w => activity(w, 'sow-bed', 'running'));
  assert.deepEqual(activity(w, 'sow-bed').reservation.inputs, [{ container: 'seedling-rack', resource: 'seeds', count: 2 }]);
  assert.equal(bag(w, 'seeds'), 0, 'seeds must be stored in the real nursery before the bed can reserve them');
  assert.equal(w.living.objects['garden-bed'].quantity, 0);
  h.checkpoint(); h.advance(10); w = h.world.get();
  assert.equal(activity(w, 'sow-bed').status, 'completed');
  assert.equal(w.living.objects['garden-bed'].quantity, 10);
  assert.equal(w.living.objects['garden-bed'].dead_quantity, 0);
  assert.equal(totalMaterial(w, 'seeds'), 0);
  h.checkpoint();
  t.diagnostic(`Seed chain (${h.elapsedMinutes} simulated minutes): ${JSON.stringify(h.samples)}`);
});

test('fractional rainwater supports whole-unit supply and urgent watering without discarding the remainder', t => {
  const supply = fixture(t, { location: GARDEN });
  supply.save(w => {
    w.living.objects['seedling-rack'].stock.water = 2.8;
    Object.assign(w.living.objects['garden-bed'], { moisture: .6, health: .9, growth: .2 });
  });
  supply.tick();
  let w = supply.world.get();
  assert.equal(own(w).plan.goal, 'water-supply:nursery');
  assert.equal(own(w).plan.steps.find(step => step.kind === 'transfer' && step.resource === 'water').count, 2, 'the 1.2-unit deficit requires two whole carried units');
  supply.checkpoint();
  w = supply.until(w => own(w).plan.status === 'completed');
  assert.ok(activity(w, 'collect-water', 'completed'));
  assert.ok(Math.abs(stock(w, 'seedling-rack', 'water') - 4.8) < .000001);
  assert.equal(bag(w, 'water'), 2);
  assert.ok(Math.abs(totalMaterial(w, 'water') - 14.8) < .000001, '2.8 nursery + 8 kitchen + 4 purified; no fractional stock is discarded');
  supply.checkpoint();

  const urgent = fixture(t, { location: GARDEN });
  urgent.save(w => {
    w.living.objects['seedling-rack'].stock.water = 2.8;
    Object.assign(w.living.objects['garden-bed'], { moisture: .1, health: .9, growth: .2 });
  });
  urgent.tick(); w = urgent.world.get();
  assert.equal(own(w).plan.goal, 'water');
  assert.equal(own(w).plan.steps.find(step => step.kind === 'transfer' && step.resource === 'water').count, 1, 'the 0.2-unit recipe deficit requires one whole unit');
  urgent.checkpoint();
  w = urgent.until(w => activity(w, 'water-bed', 'completed'));
  assert.equal(activity(w, 'water-bed').reservation.status, 'consumed');
  assert.ok(Math.abs(stock(w, 'seedling-rack', 'water') - .8) < .000001);
  assert.equal(bag(w, 'water'), 3);
  assert.ok(Math.abs(totalMaterial(w, 'water') - 11.8) < .000001, '2.8 nursery + 8 kitchen + 4 purified minus the three actually used on the bed');
  urgent.checkpoint();
});

test('six isolated hours cannot conjure seeds, moss or plants from an exhausted dead bed', t => {
  const h = fixture(t, { location: GARDEN });
  h.save(w => {
    Object.assign(w.living.objects['garden-bed'], { quantity: 0, dead_quantity: 10, health: 0, growth: 0 });
    Object.assign(w.living.objects['seedling-rack'].stock, { seeds: 0, moss: 0 });
    w.living.inventories[OWN] = { stock: {}, capacity: 24 };
  });
  h.tick();
  assert.equal(own(h.world.get()).last_candidates.find(candidate => candidate.goal === 'sow').available, false);
  for (let hour = 0; hour < 6; hour++) { h.advance(60); h.checkpoint(); }
  const w = h.world.get();
  assert.equal(totalMaterial(w, 'moss'), 0);
  assert.equal(totalMaterial(w, 'seeds'), 0);
  assert.equal(w.living.objects['garden-bed'].quantity, 0);
  assert.ok(!w.tasks.some(task => ['save-seeds', 'sow-bed', 'harvest-bed', 'cook-moss'].includes(task.activity_id)));
  assert.ok(w.tasks.some(task => task.kind === 'travel' || task.life_action === 'observe' || task.life_action === 'rest'), 'a blocked supply chain leaves other finite daily choices available');
});

test('closing the current water route prevents arrival, purification and remote cooking', t => {
  const h = fixture(t); hungryKitchen(h); h.tick();
  const travel = h.world.get().tasks.find(task => task.actor_id === OWN && task.kind === 'travel' && task.status === 'running');
  const from = travel.from_location_id;
  const passage = passageFor(h.world.get(), from, travel.to_location_id);
  assert.ok(passage);
  h.mutate('close-current-supply-route', { action: 'set_passage_access', passage_id: passage.passage_id, status: 'closed', reason: 'Fixture bridge inspection', expected_passage_revision: h.world.get().passage_states[passage.passage_id].revision });
  h.checkpoint(); h.advance(Math.ceil(travel.duration_ms / MINUTE));
  let w = h.world.get();
  assert.equal(w.tasks.find(task => task.task_id === travel.task_id).status, 'failed');
  assert.equal(w.protagonist.location_id, from);
  assert.equal(own(w).plan.status, 'failed');
  assert.equal(bag(w, 'water'), 0);
  assert.equal(stock(w, 'trial-stove', 'water'), 0);
  assert.ok(!w.tasks.some(task => task.activity_id === 'collect-water' || task.activity_id === 'cook-moss'));
  h.checkpoint();
});

test('shared water collection excludes a second actor; unsafe completion returns all held raw water once', t => {
  const h = fixture(t, { location: WATER });
  h.save(w => {
    w.npcs.push({ npc_id: 'supply-helper', display_name: '隔离测试居民', location_id: WATER });
    installAutonomy(w, h.now().toISOString()); own(w).paused = true;
    w.autonomy.actors['supply-helper'].paused = true;
  });
  const start = { action: 'start_activity', task_id: 'held-water', activity_id: 'collect-water', actor_id: OWN };
  h.mutate('first-water-collection', start);
  const before = h.world.get();
  assert.equal(stock(before, 'floating-frame', 'raw_water'), 8);
  assert.throws(() => h.mutate('conflicting-water-collection', { ...start, actor_id: 'supply-helper', task_id: 'conflicting-water' }), { code: 'activity_unavailable' });
  assert.deepEqual(h.world.get(), before, 'a losing claimant cannot deduct resources or install a second task');
  h.restart(); assert.deepEqual(h.world.get(), before);
  assert.equal(h.mutate('first-water-collection', start).reason, 'event_already_applied');
  assert.deepEqual(h.world.get(), before);
  h.save(w => { w.living.objects['floating-frame'].condition = .2; });
  h.advance(10, { tick: false }); let w = h.world.get();
  const task = w.tasks.find(task => task.task_id === 'held-water');
  assert.equal(task.status, 'failed');
  assert.equal(task.reservation.status, 'returned');
  assert.equal(task.completion.effect, 'no_effect');
  assert.equal(totalMaterial(w, 'water'), 20, 'failure produces no purified water; unrelated authored nursery/kitchen water is unchanged');
  assert.equal(bag(w, 'water'), 0);
  assert.ok(Math.abs(stock(w, 'floating-frame', 'raw_water') - 12.125) < .002);
  const refunded = w.living; h.restart(); h.world.syncTasks();
  assert.deepEqual(h.world.get().living, refunded, 'reconciliation after restart cannot refund the same reservation twice');
});
