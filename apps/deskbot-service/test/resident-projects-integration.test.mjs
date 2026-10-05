import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld, getWorldMap } from '../src/persistent-world.mjs';
import { createWorldLife } from '../src/world-life.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';
import { activeWorldTask } from '../src/realtime-world.mjs';
import { findWorldPath, passageFor } from '../src/world-map-content.mjs';
import { projectReadModel } from '../src/resident-projects.mjs';

const START = Date.parse('2026-10-06T03:00:00.000Z');
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const OWN = 'shaping-001', GROWER = 'wetland-grower-001', MENDER = 'spare-mender-001';
const COOK = 'pot-cook-001', TRADER = 'market-trader-001';
const WATER = 'echo-waterside', PARTS = 'spare-parts-house', KITCHEN = 'warm-pot-courtyard';
const person = (w, id) => id === OWN ? w.protagonist : w.npcs.find(npc => npc.npc_id === id);
const project = (w, id) => w.resident_projects.projects[id];
const stock = (w, objectId, resource) => w.living.objects[objectId]?.stock?.[resource] ?? 0;
const carried = (w, actorId, resource) => w.living.inventories[actorId]?.stock?.[resource] ?? 0;
const seedbed = w => w.living.objects['floating-frame'].project_assets?.floating_seedbed;
const pump = w => w.living.objects['floating-frame'].project_assets?.small_water_pump;

// All simulated dates, starting stocks and actor scheduling scope belong to a
// disposable database. Production configuration, providers and storage are never used.
function fixture(t, { install = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-resident-projects-'));
  const filename = join(directory, 'isolated-project-world.sqlite');
  let time = START, persistence, world, loop, sequence = 0, scope = null;
  const samples = [], seen = new Set(), events = new Map(), completedTasks = new Map();
  const now = () => new Date(time);
  function open() {
    persistence = createSqlitePersistence({ filename, now });
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    loop = createAutonomousLife({ world, now, enabled: true,
      reserved: () => scope ? Object.keys(world.get().autonomy.actors).filter(id => !scope.includes(id)) : [] });
  }
  open();
  createWorldLife({ worldSnapshot: () => world.get(), ingest: event => world.ingest(event), now, enabled: true }).seedNpcs();
  function capture() {
    for (const task of world.get().tasks) {
      if (!task.project_id) continue;
      if (task.status === 'completed') completedTasks.set(task.task_id, structuredClone(task));
      const key = `${task.task_id}:${task.status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push({ at: now().toISOString(), project_id: task.project_id, stage_id: task.project_stage_id,
        task_id: task.task_id, activity_id: task.activity_id, actor_id: task.actor_id,
        status: task.status, due_at: task.due_at });
    }
  }
  const h = {
    get world() { return world; }, get persistence() { return persistence; }, now, samples, completedTasks,
    scope(ids) { scope = ids; },
    restart() { persistence.close(); open(); },
    save(change) { const state = world.get(); change(state); persistence.put('canonical-world.states', state.world_id, state); this.restart(); },
    mutate(id, payload) {
      const event = { event_id: id, type: 'world.mutation', source: 'resident-project-fixture',
        character_id: OWN, occurred_at: now().toISOString(), payload };
      events.set(id, event); const result = world.ingest(event); capture(); return result;
    },
    repeat(id) { return world.ingest(events.get(id)); },
    tick() { const result = loop.tick(); capture(); return result; },
    at(value, { tick = false } = {}) {
      const next = typeof value === 'number' ? value : Date.parse(value);
      assert.ok(next >= time, 'the isolated test clock only moves forward');
      time = next; world.syncWallClock(); world.syncTasks(); if (tick) this.tick(); capture();
    },
    advance(ms, options) { this.at(time + ms, options); },
    checkpoint() {
      const before = world.get(), mutations = world.listMutations().length;
      this.restart(); world.syncTasks();
      assert.deepEqual(world.get(), before, 'SQLite restart and same-time reconciliation preserve every recorded stage and reservation');
      assert.equal(world.listMutations().length, mutations);
      getWorldMap(world.get()); projectReadModel(world.get());
      assert.deepEqual(world.get(), before, 'map/project projection does not execute tasks');
    },
    start(activityId, actorId, id = `project-step-${++sequence}`) {
      return this.mutate(id, { action: 'start_activity', activity_id: activityId, actor_id: actorId,
        task_id: id, duration_seconds: 1, completion: { resource: 999 }, project_id: 'client-forgery' }).mutation.details.task;
    },
    finish(taskId, { exact = true } = {}) {
      const task = world.get().tasks.find(task => task.task_id === taskId);
      assert.equal(task.status, 'running');
      const due = Date.parse(task.due_at);
      if (exact && due > time) {
        this.at(due - 1);
        assert.equal(world.get().tasks.find(task => task.task_id === taskId).status, 'running');
        this.checkpoint();
      }
      this.at(due);
      const completed = world.get().tasks.find(task => task.task_id === taskId);
      assert.equal(completed.status, 'completed', `${completed.activity_id}: ${completed.failure_reason}`);
      assert.equal(completed.completion.due_at, task.due_at);
      this.checkpoint(); return completed;
    },
    go(actorId, destination) {
      const origin = person(world.get(), actorId).location_id;
      if (origin === destination) return;
      const route = findWorldPath(world.get(), origin, destination);
      assert.ok(route?.[1]);
      const id = `project-travel-${++sequence}`;
      const { task } = this.mutate(id, { action: 'npc_action', npc_id: actorId,
        action_name: '去完成实际职业项目', location_id: route[1], destination_location_id: destination }).mutation.details;
      assert.equal(person(world.get(), actorId).location_id, origin);
      while (world.get().tasks.find(item => item.task_id === task.task_id).status === 'running') {
        this.at(world.get().tasks.find(item => item.task_id === task.task_id).due_at);
      }
      assert.equal(world.get().tasks.find(item => item.task_id === task.task_id).status, 'completed');
      assert.equal(person(world.get(), actorId).location_id, destination);
    },
    until(predicate, maxHours = 36) {
      const end = time + maxHours * HOUR;
      while (time <= end) {
        if (predicate(world.get())) return world.get();
        const due = world.get().tasks.filter(task => task.status === 'running' && Date.parse(task.due_at) > time)
          .map(task => Date.parse(task.due_at));
        this.at(Math.min(time + 5 * MINUTE, ...due), { tick: true });
      }
      assert.fail(`No expected project phase: ${JSON.stringify({ projects: world.get().resident_projects, samples })}`);
    },
  };
  t.after(() => { persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  if (install) {
    h.mutate('install-resident-project-fixture', { action: 'install_resident_life' });
    h.restart(); // Exercise the same additive migration as reopening an old world.
  }
  return h;
}

function materialCount(w, resource) {
  const held = w.tasks.filter(task => task.reservation?.status === 'held').flatMap(task => task.reservation.inputs)
    .filter(input => input.resource === resource).reduce((total, input) => total + input.count, 0);
  return Object.values(w.living.objects).reduce((total, object) => total + (object.stock?.[resource] ?? 0), 0)
    + Object.values(w.living.inventories).reduce((total, inventory) => total + (inventory.stock?.[resource] ?? 0), 0) + held;
}

function assertResidentSchedulingIntact(w) {
  assert.equal(w.npcs.length, 12);
  assert.equal(Object.keys(w.autonomy.actors).length, 13);
  assert.ok(Object.values(w.autonomy.actors).every(actor => !actor.paused), 'the fixture never pauses the residents to force a career choice');
}

function autonomousStartingSupplies(h, locations, inventories = {}) {
  h.save(w => {
    for (const [id, location] of Object.entries(locations)) person(w, id).location_id = location;
    for (const [id, supplies] of Object.entries(inventories)) w.living.inventories[id] = { stock: supplies, capacity: 24 };
    for (const actor of Object.values(w.autonomy.actors)) { actor.energy = .98; actor.appetite = .05; }
    // Author the isolated starting conditions once. Needs, stocks, ecology,
    // conflict checks, choices and project phases evolve normally thereafter.
    w.social.next_offer_at = '2099-01-01T00:00:00.000Z';
    for (const object of Object.values(w.living.objects)) if (typeof object.condition === 'number') object.condition = .95;
    Object.assign(w.living.objects['garden-bed'], { moisture: .65, health: .95, growth: .05, quantity: 10 });
    Object.assign(w.living.objects['seedling-rack'].stock, { water: 24, seeds: 24, moss: 24, trays: 2 });
    w.living.objects['shared-table'].stock.rations = 24;
  });
  assertResidentSchedulingIntact(h.world.get());
  assert.equal(h.world.get().tasks.length, 0);
  assert.ok(Object.values(h.world.get().resident_projects.projects).every(p => !p.evidence.length), 'the autonomous fixture starts before any career work');
}

function autonomousTaskProofs(h, projectId, expectedActivities) {
  const w = h.world.get(), evidence = project(w, projectId).evidence;
  for (const activityId of expectedActivities) assert.ok(evidence.some(e => e.activity_id === activityId), `missing actual autonomous ${activityId}`);
  for (const e of evidence) {
    const task = h.completedTasks.get(e.task_id);
    assert.equal(task?.origin, 'autonomous_life', `${e.activity_id} must be launched by the scheduler`);
    assert.equal(task.status, 'completed');
    assert.equal(task.project_id, projectId);
    assert.equal(task.project_settled_at, e.at);
    assert.equal(task.actor_id, e.actor_id);
    if (task.reservation) assert.equal(task.reservation.status, 'consumed', 'only real finite inputs can become project evidence');
  }
  return evidence;
}

function exportSyntheticSample(h, label) {
  if (!process.env.DESKBOT_PROJECT_REPLAY_PATH) return;
  const workspace = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
  const requested = resolve(process.env.DESKBOT_PROJECT_REPLAY_PATH);
  assert.ok(requested.toLowerCase().startsWith(`${workspace.toLowerCase()}${sep}`), 'sample export must stay inside the explicitly authorized workspace');
  const prefix = requested.replace(/\.json$/i, '');
  mkdirSync(dirname(requested), { recursive: true });
  writeFileSync(`${prefix}-${label}.json`, `${JSON.stringify(h.world.get(), null, 2)}\n`, 'utf8');
  writeFileSync(`${prefix}-${label}.summary.json`, `${JSON.stringify({ kind: 'isolated_canonical_rule_sample',
    production_clock_changed: false, start: new Date(START).toISOString(), end: h.now().toISOString(),
    elapsed_hours: (h.now().getTime() - START) / HOUR, tasks: h.samples,
    projects: projectReadModel(h.world.get()) }, null, 2)}\n`, 'utf8');
}

test('three-date manual task sample: pump materials, installation, a different real trial user and durable acceptance', t => {
  const h = fixture(t);
  h.save(w => {
    person(w, MENDER).location_id = PARTS;
    person(w, GROWER).location_id = 'moss-sprout-garden';
    w.living.inventories[MENDER] = { stock: { wood: 1, fasteners: 2 }, capacity: 24 };
    w.living.inventories[GROWER] = { stock: {}, capacity: 24 };
  });
  assertResidentSchedulingIntact(h.world.get());
  h.finish(h.start('pump-survey', MENDER).task_id);
  const wood = materialCount(h.world.get(), 'wood'), fasteners = materialCount(h.world.get(), 'fasteners');
  const assembly = h.start('pump-assemble', MENDER, 'actual-pump-assembly');
  assert.equal(assembly.duration_ms, 30 * MINUTE);
  assert.equal(assembly.project_id, 'small-water-pump', 'client-forged project metadata cannot change the server-owned career');
  assert.equal(materialCount(h.world.get(), 'wood'), wood);
  assert.equal(materialCount(h.world.get(), 'fasteners'), fasteners);
  assert.equal(carried(h.world.get(), MENDER, 'pump_kit'), 0);
  h.finish(assembly.task_id);
  assert.equal(materialCount(h.world.get(), 'wood'), wood - 1);
  assert.equal(materialCount(h.world.get(), 'fasteners'), fasteners - 2);
  assert.equal(carried(h.world.get(), MENDER, 'pump_kit'), 1);
  h.go(MENDER, WATER);
  h.finish(h.start('pump-install', MENDER).task_id);
  assert.equal(carried(h.world.get(), MENDER, 'pump_kit'), 0);
  assert.equal(pump(h.world.get()).status, 'installed_trial');
  assert.equal(h.world.get().living.objects['repair-bench'].project_assets.small_water_pump.status, 'moved');
  let w = h.world.get(); const withoutTrial = structuredClone(w);
  assert.throws(() => h.start('pump-trial', MENDER), error => Boolean(error.code));
  assert.deepEqual(h.world.get(), withoutTrial, 'a maker cannot impersonate the required user to invent a trial');
  h.go(GROWER, WATER);
  const trial = h.start('pump-trial', GROWER);
  assert.equal(trial.duration_ms, 10 * MINUTE);
  assert.deepEqual(trial.reservation.inputs, [{ container: 'floating-frame', resource: 'raw_water', count: 2 }]);
  h.finish(trial.task_id);
  w = h.world.get(); assert.equal(carried(w, GROWER, 'water'), 2);
  assert.equal(pump(w).use_count, 1);
  assert.equal(project(w, 'small-water-pump').evidence.find(e => e.activity_id === 'pump-trial').actor_id, GROWER);
  assert.notEqual(project(w, 'small-water-pump').status, 'completed');
  const ready = Date.parse(project(w, 'small-water-pump').ready_at);
  assert.ok(ready > h.now().getTime());
  h.at(ready - 1); const beforeReady = h.world.get();
  assert.throws(() => h.start('pump-accept', MENDER), error => Boolean(error.code));
  assert.deepEqual(h.world.get(), beforeReady);
  h.checkpoint();
  h.at(START + DAY + 10 * MINUTE);
  h.finish(h.start('pump-accept', MENDER).task_id);
  assert.equal(project(h.world.get(), 'small-water-pump').status, 'completed');
  assert.equal(pump(h.world.get()).status, 'ready');
  assert.ok(pump(h.world.get()).accepted_at);
  const accepted = structuredClone(project(h.world.get(), 'small-water-pump'));
  h.at(START + 2 * DAY + 10 * MINUTE); h.checkpoint();
  assert.deepEqual(project(h.world.get(), 'small-water-pump'), accepted, 'a durable accepted project survives another real test date without replaying installation or trial');
  assert.equal(h.world.get().tasks.filter(task => task.activity_id === 'pump-assemble').length, 1);
  assert.equal(h.world.get().tasks.filter(task => task.activity_id === 'pump-trial').length, 1);
  assert.equal(h.world.get().tasks.filter(task => task.activity_id === 'pump-accept').length, 1);
  const use = h.start('pump-water', GROWER);
  assert.equal(use.duration_ms, 5 * MINUTE, 'the accepted pump makes subsequent real water collection faster');
  h.finish(use.task_id);
  assert.equal(carried(h.world.get(), GROWER, 'water'), 6);
  assert.equal(pump(h.world.get()).use_count, 2);
  exportSyntheticSample(h, 'pump');
  t.diagnostic(`Manual canonical tasks across three isolated dates: ${JSON.stringify(h.samples)}`);
});

test('three-date manual task sample: floating seedlings live through twelve hours before another resident inspects them', t => {
  const h = fixture(t);
  h.save(w => {
    person(w, GROWER).location_id = WATER;
    person(w, MENDER).location_id = PARTS;
    w.living.inventories[GROWER] = { stock: { wood: 1, fasteners: 1, seeds: 2, water: 3 }, capacity: 24 };
  });
  assertResidentSchedulingIntact(h.world.get());
  h.finish(h.start('seedbed-survey', GROWER).task_id);
  const before = Object.fromEntries(['wood', 'fasteners', 'seeds', 'water'].map(resource => [resource, materialCount(h.world.get(), resource)]));
  const planting = h.start('seedbed-plant', GROWER);
  assert.equal(planting.duration_ms, 20 * MINUTE);
  assert.equal(seedbed(h.world.get()), undefined, 'the plan or reservation alone cannot create a planted asset');
  h.finish(planting.task_id);
  let w = h.world.get();
  for (const [resource, used] of [['wood', 1], ['fasteners', 1], ['seeds', 2], ['water', 2]]) assert.equal(materialCount(w, resource), before[resource] - used);
  assert.equal(seedbed(w).quantity, 6); assert.equal(seedbed(w).status, 'prototype');
  assert.equal(seedbed(w).accepted_at, null);
  const planted = structuredClone(seedbed(w));
  h.go(MENDER, WATER);
  assert.throws(() => h.start('seedbed-inspect', GROWER), error => Boolean(error.code));
  const ready = Date.parse(project(h.world.get(), 'floating-seedbed').ready_at);
  assert.equal(ready - Date.parse(planted.installed_at), 12 * HOUR);
  h.at(ready - 1); const waiting = h.world.get();
  assert.throws(() => h.start('seedbed-inspect', MENDER), error => Boolean(error.code));
  assert.deepEqual(h.world.get(), waiting);
  assert.ok(!project(waiting, 'floating-seedbed').evidence.some(e => e.activity_id === 'seedbed-inspect'));
  h.checkpoint();
  h.at(START + DAY);
  assert.equal(seedbed(h.world.get()).quantity, 6);
  assert.ok(seedbed(h.world.get()).health >= .6);
  assert.ok(seedbed(h.world.get()).growth > planted.growth, 'the prototype participates in elapsed-day ecology while the career waits');
  h.finish(h.start('seedbed-care', GROWER).task_id);
  assert.equal(carried(h.world.get(), GROWER, 'water'), 0);
  h.finish(h.start('seedbed-inspect', MENDER).task_id);
  w = h.world.get();
  const inspection = project(w, 'floating-seedbed').evidence.find(e => e.activity_id === 'seedbed-inspect');
  assert.equal(inspection.actor_id, MENDER);
  assert.ok(inspection.details.observed_hours >= 12);
  assert.equal(seedbed(w).last_inspected_at, inspection.at);
  h.finish(h.start('seedbed-accept', GROWER).task_id);
  w = h.world.get(); assert.equal(project(w, 'floating-seedbed').status, 'completed');
  assert.ok(seedbed(w).accepted_at); assert.ok(['growing', 'ready'].includes(seedbed(w).status));
  const accepted = structuredClone(project(w, 'floating-seedbed')), growth = seedbed(w).growth;
  h.at(START + 2 * DAY); h.checkpoint();
  assert.deepEqual(project(h.world.get(), 'floating-seedbed'), accepted);
  assert.equal(seedbed(h.world.get()).quantity, 6);
  assert.ok(seedbed(h.world.get()).growth > growth, 'an accepted bed keeps living rather than becoming a static badge');
  exportSyntheticSample(h, 'seedbed');
  t.diagnostic(`Manual canonical floating-bed tasks across three isolated dates: ${JSON.stringify(h.samples)}`);
});

test('three-date manual task sample: two different residents consume the actual trial soup before a recipe is saved', t => {
  const h = fixture(t);
  h.save(w => {
    person(w, COOK).location_id = KITCHEN;
    person(w, GROWER).location_id = WATER;
    person(w, TRADER).location_id = 'whisper-market';
    w.living.inventories[COOK] = { stock: { moss: 6 }, capacity: 24 };
    w.living.objects['trial-stove'].stock.water = 3;
  });
  assertResidentSchedulingIntact(h.world.get());
  h.finish(h.start('soup-record-ratio', COOK).task_id);
  const moss = materialCount(h.world.get(), 'moss'), water = materialCount(h.world.get(), 'water');
  h.finish(h.start('soup-cook-trial', COOK).task_id);
  let w = h.world.get();
  assert.equal(materialCount(w, 'moss'), moss - 2); assert.equal(materialCount(w, 'water'), water - 1);
  assert.equal(carried(w, COOK, 'trial_soup'), 2); assert.equal(stock(w, 'shared-table', 'trial_soup'), 0);
  h.finish(h.start('soup-serve-trial', COOK).task_id);
  w = h.world.get(); const batchId = w.living.objects['shared-table'].project_batches['leaf-signature-soup'].batch_id;
  assert.equal(carried(w, COOK, 'trial_soup'), 0); assert.equal(stock(w, 'shared-table', 'trial_soup'), 2);
  const noFeedback = structuredClone(w);
  assert.throws(() => h.start('soup-taste-trial', COOK), error => Boolean(error.code));
  assert.deepEqual(h.world.get(), noFeedback, 'the cook cannot count their own statement as independent tasting');
  h.go(GROWER, KITCHEN); h.finish(h.start('soup-taste-trial', GROWER).task_id);
  w = h.world.get(); assert.equal(stock(w, 'shared-table', 'trial_soup'), 1);
  const oneTaste = structuredClone(w);
  assert.throws(() => h.start('soup-taste-trial', GROWER), error => Boolean(error.code));
  assert.deepEqual(h.world.get(), oneTaste, 'one person cannot consume the second portion and create a second independent opinion');
  h.go(TRADER, KITCHEN); h.finish(h.start('soup-taste-trial', TRADER).task_id);
  w = h.world.get();
  const feedback = w.living.objects['shared-table'].project_batches['leaf-signature-soup'].feedback;
  assert.deepEqual(feedback.map(f => f.actor_id).sort(), [GROWER, TRADER].sort());
  assert.ok(feedback.every(f => f.batch_id === batchId && f.task_id && f.verdict === 'acceptable'));
  assert.equal(stock(w, 'shared-table', 'trial_soup'), 0); assert.equal(materialCount(w, 'trial_soup'), 0);
  assert.equal(w.living.objects['trial-stove'].recipe_book?.['leaf-signature-soup'], undefined);
  const ready = Date.parse(project(w, 'leaf-signature-soup').ready_at);
  assert.equal(ready - Date.parse(w.living.objects['shared-table'].project_batches['leaf-signature-soup'].prepared_at), 6 * HOUR);
  h.at(ready - 1); const waiting = h.world.get();
  assert.throws(() => h.start('soup-confirm-recipe', COOK), error => Boolean(error.code));
  assert.deepEqual(h.world.get(), waiting); h.checkpoint();
  h.at(START + DAY); h.finish(h.start('soup-confirm-recipe', COOK).task_id);
  w = h.world.get(); assert.equal(project(w, 'leaf-signature-soup').status, 'completed');
  const recipe = w.living.objects['trial-stove'].recipe_book['leaf-signature-soup'];
  assert.equal(recipe.yield_count, 3); assert.equal(recipe.feedback.length, 2);
  assert.equal(carried(w, COOK, 'rations'), 3);
  assert.equal(materialCount(w, 'moss'), moss - 4); assert.equal(materialCount(w, 'water'), water - 2);
  const record = structuredClone(project(w, 'leaf-signature-soup'));
  h.at(START + 2 * DAY); h.checkpoint();
  assert.deepEqual(project(h.world.get(), 'leaf-signature-soup'), record);
  assert.deepEqual(h.world.get().living.objects['trial-stove'].recipe_book['leaf-signature-soup'], recipe);
  h.finish(h.start('cook-leaf-soup', COOK).task_id);
  assert.equal(carried(h.world.get(), COOK, 'rations'), 6, 'the saved recipe can actually be repeated with a fresh finite batch');
  assert.equal(materialCount(h.world.get(), 'moss'), moss - 6);
  assert.equal(materialCount(h.world.get(), 'water'), water - 3);
  exportSyntheticSample(h, 'soup');
  t.diagnostic(`Manual canonical soup tasks across three isolated dates: ${JSON.stringify(h.samples)}`);
});

test('bounded autonomous ticks complete a real pump including independent trial and six-hour observation', t => {
  const h = fixture(t);
  h.scope([MENDER, GROWER]);
  h.save(w => {
    person(w, MENDER).location_id = PARTS;
    person(w, GROWER).location_id = WATER;
    for (const actor of Object.values(w.autonomy.actors)) { actor.energy = .98; actor.appetite = .05; }
    w.social.next_offer_at = '2099-01-01T00:00:00.000Z';
    for (const object of Object.values(w.living.objects)) if (typeof object.condition === 'number') object.condition = .95;
    Object.assign(w.living.objects['garden-bed'], { moisture: .65, health: .95, growth: .05, quantity: 10 });
    Object.assign(w.living.objects['seedling-rack'].stock, { water: 24, seeds: 24, moss: 24, trays: 2 });
    w.living.objects['shared-table'].stock.rations = 24;
  });
  const before = h.world.get(); assertResidentSchedulingIntact(before);
  assert.equal(project(before, 'small-water-pump').evidence.length, 0);
  h.tick();
  h.until(w => project(w, 'small-water-pump').evidence.some(e => e.activity_id === 'pump-install'));
  h.checkpoint();
  const installed = pump(h.world.get()).installed_at;
  let w = h.until(w => project(w, 'small-water-pump').evidence.some(e => e.activity_id === 'pump-trial'));
  assert.equal(project(w, 'small-water-pump').evidence.find(e => e.activity_id === 'pump-trial').actor_id, GROWER);
  assert.equal(pump(w).use_count, 1);
  assert.notEqual(project(w, 'small-water-pump').status, 'completed');
  h.checkpoint();
  w = h.until(w => project(w, 'small-water-pump').status === 'completed');
  assertResidentSchedulingIntact(w);
  const evidence = project(w, 'small-water-pump').evidence;
  assert.deepEqual(evidence.map(e => e.activity_id), ['pump-survey', 'pump-assemble', 'pump-install', 'pump-trial', 'pump-accept']);
  assert.equal(evidence.filter(e => e.actor_id === MENDER).length, 4);
  assert.equal(evidence.find(e => e.activity_id === 'pump-trial').details.actual_clean_water, 2);
  assert.ok(Date.parse(evidence.find(e => e.activity_id === 'pump-accept').at) >= Date.parse(installed) + 6 * HOUR);
  for (const e of evidence) {
    const task = w.tasks.find(task => task.task_id === e.task_id);
    assert.equal(task?.origin, 'autonomous_life', 'every project stage was actually started by the bounded scheduler');
    assert.equal(task.status, 'completed'); assert.equal(task.project_settled_at, e.at);
  }
  assert.equal(carried(w, MENDER, 'pump_kit'), 0);
  assert.equal(pump(w).status, 'ready');
  const settled = structuredClone(project(w, 'small-water-pump'));
  h.checkpoint(); h.tick();
  assert.deepEqual(project(h.world.get(), 'small-water-pump'), settled);
  exportSyntheticSample(h, 'autonomous-pump');
  t.diagnostic(`Autonomous pump sample (${(h.now().getTime() - START) / HOUR} isolated hours; all residents retain scheduling): ${JSON.stringify(h.samples)}`);
});

test('bounded autonomous ticks grow and inspect a live seedbed after twelve hours without installing project phases', t => {
  const h = fixture(t);
  h.scope([GROWER, MENDER]);
  autonomousStartingSupplies(h, { [GROWER]: WATER, [MENDER]: PARTS }, {
    [GROWER]: { wood: 1, fasteners: 1, seeds: 2, water: 4 },
    [MENDER]: { wood: 1, fasteners: 2 },
  });
  h.tick();
  h.until(w => Boolean(seedbed(w)));
  const planted = structuredClone(seedbed(h.world.get()));
  assert.equal(planted.quantity, 6);
  assert.equal(planted.accepted_at, null);
  assert.equal(project(h.world.get(), 'floating-seedbed').stage_id, 'inspect');
  assert.equal(Date.parse(project(h.world.get(), 'floating-seedbed').ready_at) - Date.parse(planted.installed_at), 12 * HOUR);
  h.checkpoint();
  let w = h.until(w => project(w, 'floating-seedbed').evidence.some(e => e.activity_id === 'seedbed-inspect'));
  assert.notEqual(project(w, 'floating-seedbed').status, 'completed');
  h.checkpoint();
  w = h.until(w => project(w, 'floating-seedbed').status === 'completed');
  const evidence = autonomousTaskProofs(h, 'floating-seedbed', ['seedbed-survey', 'seedbed-plant', 'seedbed-inspect', 'seedbed-accept']);
  const planting = h.completedTasks.get(evidence.find(e => e.activity_id === 'seedbed-plant').task_id);
  assert.deepEqual(planting.reservation.inputs, [
    { container: `bag:${GROWER}`, resource: 'wood', count: 1 },
    { container: `bag:${GROWER}`, resource: 'fasteners', count: 1 },
    { container: `bag:${GROWER}`, resource: 'seeds', count: 2 },
    { container: `bag:${GROWER}`, resource: 'water', count: 2 },
  ]);
  const inspection = evidence.find(e => e.activity_id === 'seedbed-inspect');
  assert.equal(inspection.actor_id, MENDER);
  assert.ok(inspection.details.observed_hours >= 12);
  assert.ok(inspection.details.health >= .6);
  assert.ok(Date.parse(h.completedTasks.get(inspection.task_id).started_at) >= Date.parse(planted.installed_at) + 12 * HOUR);
  assert.equal(evidence.find(e => e.activity_id === 'seedbed-accept').actor_id, GROWER);
  assert.equal(seedbed(w).quantity, 6);
  assert.ok(seedbed(w).health >= .6);
  assert.ok(seedbed(w).growth > planted.growth);
  assert.ok(seedbed(w).accepted_at);
  assertResidentSchedulingIntact(w);
  const settled = structuredClone(project(w, 'floating-seedbed'));
  h.checkpoint(); h.tick();
  assert.deepEqual(project(h.world.get(), 'floating-seedbed'), settled);
  exportSyntheticSample(h, 'autonomous-seedbed');
  t.diagnostic(`Autonomous floating-bed sample: ${JSON.stringify({ elapsed_hours: (h.now().getTime() - START) / HOUR, installed_at: planted.installed_at, evidence })}`);
});

test('bounded autonomous ticks prepare soup, bring two real tasters and repeat its recipe after six hours', t => {
  const h = fixture(t);
  h.scope([COOK, GROWER, TRADER]);
  autonomousStartingSupplies(h, { [COOK]: KITCHEN, [GROWER]: WATER, [TRADER]: 'whisper-market' }, {
    [COOK]: { moss: 6 },
    [GROWER]: { wood: 1, fasteners: 1, seeds: 2, water: 4 },
  });
  h.tick();
  h.until(w => Boolean(w.living.objects['shared-table'].project_batches?.['leaf-signature-soup']));
  const batch = structuredClone(h.world.get().living.objects['shared-table'].project_batches['leaf-signature-soup']);
  assert.equal(batch.remaining_portions, 2);
  assert.equal(batch.feedback.length, 0);
  assert.equal(stock(h.world.get(), 'shared-table', 'trial_soup'), 2);
  h.checkpoint();
  let w = h.until(w => w.living.objects['shared-table'].project_batches['leaf-signature-soup'].feedback.length === 2);
  const feedback = structuredClone(w.living.objects['shared-table'].project_batches['leaf-signature-soup'].feedback);
  assert.deepEqual(feedback.map(f => f.actor_id).sort(), [GROWER, TRADER].sort());
  assert.ok(feedback.every(f => f.batch_id === batch.batch_id && f.verdict === 'acceptable'));
  assert.equal(stock(w, 'shared-table', 'trial_soup'), 0);
  assert.equal(project(w, 'leaf-signature-soup').status, 'active');
  assert.equal(w.living.objects['trial-stove'].recipe_book?.['leaf-signature-soup'], undefined);
  assert.equal(Date.parse(project(w, 'leaf-signature-soup').ready_at) - Date.parse(batch.prepared_at), 6 * HOUR);
  h.checkpoint();
  w = h.until(w => project(w, 'leaf-signature-soup').status === 'completed');
  const evidence = autonomousTaskProofs(h, 'leaf-signature-soup', ['soup-record-ratio', 'soup-cook-trial', 'soup-serve-trial', 'soup-taste-trial', 'soup-confirm-recipe']);
  assert.equal(evidence.filter(e => e.activity_id === 'soup-taste-trial').length, 2);
  assert.ok(evidence.filter(e => e.activity_id !== 'soup-taste-trial').every(e => e.actor_id === COOK));
  for (const f of feedback) {
    const task = h.completedTasks.get(f.task_id);
    assert.equal(task.project_batch_id, batch.batch_id);
    assert.equal(task.location_id, KITCHEN);
    assert.deepEqual(task.reservation.inputs, [{ container: 'shared-table', resource: 'trial_soup', count: 1 }]);
  }
  const confirmation = h.completedTasks.get(evidence.find(e => e.activity_id === 'soup-confirm-recipe').task_id);
  assert.ok(Date.parse(confirmation.started_at) >= Date.parse(batch.prepared_at) + 6 * HOUR);
  for (const activityId of ['soup-cook-trial', 'soup-confirm-recipe']) {
    const task = h.completedTasks.get(evidence.find(e => e.activity_id === activityId).task_id);
    assert.deepEqual(task.reservation.inputs, [
      { container: `bag:${COOK}`, resource: 'moss', count: 2 },
      { container: 'trial-stove', resource: 'water', count: 1 },
    ]);
  }
  assert.equal(carried(w, COOK, 'rations'), 3);
  assert.equal(w.living.objects['trial-stove'].recipe_book['leaf-signature-soup'].yield_count, 3);
  assert.deepEqual(w.living.objects['trial-stove'].recipe_book['leaf-signature-soup'].feedback, feedback);
  assertResidentSchedulingIntact(w);
  const settled = structuredClone(project(w, 'leaf-signature-soup'));
  h.checkpoint(); h.tick();
  assert.deepEqual(project(h.world.get(), 'leaf-signature-soup'), settled);
  exportSyntheticSample(h, 'autonomous-soup');
  t.diagnostic(`Autonomous soup sample: ${JSON.stringify({ elapsed_hours: (h.now().getTime() - START) / HOUR, batch_id: batch.batch_id, prepared_at: batch.prepared_at, evidence })}`);
});

test('paused career work never completes offline; cancellation and failed retry refund once without deleting earlier proof', t => {
  const h = fixture(t);
  h.save(w => {
    person(w, MENDER).location_id = PARTS;
    w.living.inventories[MENDER] = { stock: { wood: 1, fasteners: 2 }, capacity: 24 };
  });
  h.finish(h.start('pump-survey', MENDER).task_id);
  const originalEvidence = structuredClone(project(h.world.get(), 'small-water-pump').evidence);
  const assembly = h.start('pump-assemble', MENDER, 'paused-pump-assembly');
  h.advance(10 * MINUTE);
  h.mutate('pause-pump-assembly', { action: 'control_task', task_id: assembly.task_id, operation: 'pause' });
  const remaining = h.world.get().tasks.find(task => task.task_id === assembly.task_id).remaining_ms;
  h.advance(DAY); h.checkpoint();
  let w = h.world.get();
  assert.equal(w.tasks.find(task => task.task_id === assembly.task_id).status, 'paused');
  assert.equal(w.tasks.find(task => task.task_id === assembly.task_id).remaining_ms, remaining);
  assert.equal(carried(w, MENDER, 'pump_kit'), 0);
  assert.deepEqual(project(w, 'small-water-pump').evidence, originalEvidence);
  h.mutate('cancel-pump-assembly', { action: 'control_task', task_id: assembly.task_id, operation: 'cancel' });
  w = h.world.get();
  assert.equal(w.tasks.find(task => task.task_id === assembly.task_id).reservation.status, 'returned');
  assert.equal(carried(w, MENDER, 'wood'), 1); assert.equal(carried(w, MENDER, 'fasteners'), 2);
  assert.equal(project(w, 'small-water-pump').status, 'setback');
  assert.deepEqual(project(w, 'small-water-pump').evidence, originalEvidence);
  const cancelled = structuredClone(w);
  assert.equal(h.repeat('cancel-pump-assembly').duplicate, true);
  assert.deepEqual(h.world.get(), cancelled); h.checkpoint();
  const retry = h.start('pump-assemble', MENDER, 'failed-pump-assembly');
  assert.ok(retry.project_attempt > assembly.project_attempt);
  h.save(w => { w.living.objects['repair-bench'].condition = .2; });
  h.at(retry.due_at); w = h.world.get();
  const failed = w.tasks.find(task => task.task_id === retry.task_id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.reservation.status, 'returned');
  assert.equal(carried(w, MENDER, 'wood'), 1); assert.equal(carried(w, MENDER, 'fasteners'), 2);
  assert.equal(carried(w, MENDER, 'pump_kit'), 0);
  assert.equal(w.living.objects['repair-bench'].project_assets?.small_water_pump, undefined);
  assert.deepEqual(project(w, 'small-water-pump').evidence, originalEvidence);
  assert.equal(project(w, 'small-water-pump').retry_count, 2);
  assert.ok(project(w, 'small-water-pump').history.some(outcome => outcome.kind === 'cancelled'));
  assert.ok(project(w, 'small-water-pump').history.some(outcome => !outcome.success && outcome.kind === 'setback'));
  const refunded = structuredClone(w); h.checkpoint();
  assert.deepEqual(h.world.get(), refunded);
});

test('missing supplies and a closed route block career execution instead of fabricating material or delivery', t => {
  const h = fixture(t);
  h.scope([MENDER]);
  h.save(w => {
    person(w, MENDER).location_id = PARTS;
    w.living.inventories[MENDER] = { stock: {}, capacity: 24 };
    w.living.objects['parts-drawers'].stock.wood = 0;
    w.social.next_offer_at = '2099-01-01T00:00:00.000Z';
  });
  h.finish(h.start('pump-survey', MENDER).task_id);
  const noWood = h.world.get();
  assert.throws(() => h.start('pump-assemble', MENDER), error => Boolean(error.code));
  assert.deepEqual(h.world.get(), noWood);
  h.tick(); let w = h.world.get();
  const blocked = project(w, 'small-water-pump').scheduling[MENDER];
  assert.equal(blocked.available, false); assert.ok(blocked.blocked_reason);
  assert.equal(carried(w, MENDER, 'pump_kit'), 0);
  assert.equal(project(w, 'small-water-pump').stage_id, 'assemble');
  const busy = activeWorldTask(w, MENDER);
  if (busy) h.mutate('cancel-unrelated-fixture-plan', { action: 'control_task', task_id: busy.task_id, operation: 'cancel' });
  h.save(w => { w.living.inventories[MENDER] = { stock: { wood: 1, fasteners: 2 }, capacity: 24 }; });
  h.finish(h.start('pump-assemble', MENDER).task_id);
  const route = findWorldPath(h.world.get(), PARTS, WATER);
  const travel = h.mutate('actual-pump-delivery', { action: 'npc_action', npc_id: MENDER,
    action_name: '携带实际组装的小泵送往水岸', location_id: route[1], destination_location_id: WATER }).mutation.details.task;
  const passage = passageFor(h.world.get(), travel.from_location_id, travel.to_location_id);
  h.mutate('close-pump-delivery-passage', { action: 'set_passage_access', passage_id: passage.passage_id,
    status: 'closed', reason: '隔离样本中的桥面检查', expected_passage_revision: h.world.get().passage_states[passage.passage_id].revision });
  h.at(travel.due_at); w = h.world.get();
  assert.equal(w.tasks.find(task => task.task_id === travel.task_id).status, 'failed');
  assert.equal(person(w, MENDER).location_id, PARTS);
  assert.equal(carried(w, MENDER, 'pump_kit'), 1, 'failed travel cannot consume or remotely install the carried prototype');
  assert.equal(pump(w), undefined);
  assert.equal(project(w, 'small-water-pump').stage_id, 'install');
  assert.ok(!project(w, 'small-water-pump').evidence.some(e => e.activity_id === 'pump-install'));
  h.checkpoint();
});

test('career installation is additive for an existing resident world, active task, author project and inventory', t => {
  const h = fixture(t);
  h.save(w => {
    const npc = person(w, MENDER);
    npc.project = { ...npc.project, goal: '已有存档的作者项目说明', legacy_note: '保留用户的旧注记' };
    npc.location_id = PARTS;
    w.living.inventories[MENDER] = { stock: { wood: 3, fasteners: 5 }, capacity: 24 };
  });
  h.mutate('existing-resident-work', { action: 'start_activity', actor_id: MENDER,
    task_id: 'existing-resident-work', kind: 'care', title: '既有实际检查任务', duration_seconds: 7200 });
  const original = h.world.get();
  const legacy = structuredClone(original); delete legacy.resident_projects;
  for (const npc of legacy.npcs) { npc.project.status = 'authored_goal'; delete npc.project.progress; }
  h.persistence.put('canonical-world.states', legacy.world_id, legacy);
  h.restart(); const installed = h.world.get();
  assert.ok(installed.resident_projects);
  assertResidentSchedulingIntact(installed);
  assert.deepEqual(installed.tasks, original.tasks);
  assert.deepEqual(installed.living.inventories, original.living.inventories);
  const authored = npc => { const { status, progress, ...text } = npc.project; return text; };
  assert.deepEqual(installed.npcs.map(authored), legacy.npcs.map(authored));
  assert.equal(project(installed, 'small-water-pump').goal, '已有存档的作者项目说明');
  assert.equal(person(installed, MENDER).location_id, PARTS);
  for (const [id, object] of Object.entries(original.living.objects)) {
    for (const [resource, count] of Object.entries(object.stock ?? {})) assert.equal(stock(installed, id, resource), count);
  }
  assert.equal(Object.values(installed.resident_projects.projects).filter(record => record.status === 'completed').length, 0, 'installation cannot invent prior career achievements');
  h.checkpoint();
});
