import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLE_WISH_SCHEMA, roleWishReadModel } from '../src/role-wishes.mjs';
import { DEVELOPMENT_FACETS_VERSION } from '../src/development-facets.mjs';
import { loadWorldMapContent } from '../src/world-map-content.mjs';
import { installLivingResources, livingReadModel } from '../src/living-resources.mjs';
import { installAutonomy } from '../src/life-state.mjs';

const OWNER = 'shaping-001', FRIEND = 'pot-cook-001';
const START = '2026-10-06T00:00:00.000Z', AT = '2026-10-09T04:00:00.000Z';
const dates = ['2026-10-06T04:00:00Z', '2026-10-07T04:00:00Z', '2026-10-08T04:00:00Z'];
function record(id, { at = dates[0], actor = OWNER, activity = 'water-bed', location = 'moss-sprout-garden', motivation = 'self_continuation', outcome = 'completed', ...rest } = {}) {
  return { root_outcome_id: `task:${id}`, actor_ids: [actor], at, outcome, activity_id: activity, location_id: location, topic: 'care',
    source: { kind: 'canonical_task', task_kind: 'care', life_action: null },
    causes: { trigger: 'own', motivation: { kind: motivation } }, effect: { practice: true }, failure: null, ...rest };
}
function observe(id, { topic = 'care', location = 'moss-sprout-garden', ...rest } = {}) {
  return record(id, { activity: null, location, topic, effect: { practice: false }, source: { kind: 'canonical_task', task_kind: 'observe', life_action: 'observe' }, ...rest });
}
function world(records = []) {
  const catalog = loadWorldMapContent();
  const w = { protagonist: { character_id: OWNER, display_name: '喵呜', location_id: 'shaping-field-desk', form: 'anchor' },
    npcs: [{ npc_id: FRIEND, display_name: '阿砾', location_id: 'warm-pot-courtyard' }],
    clock: { mode: 'real_time', time_zone: 'Asia/Shanghai', synced_at: AT },
    map_catalog: catalog, locations: structuredClone(catalog.locations), passage_states: {}, tasks: [],
    memory: { actors: {}, development: { schema: 'deskbot.development-evidence.v1', installed_at: START, revision: 1, records, contacts: [],
      facets: { schema: DEVELOPMENT_FACETS_VERSION, installed_at: START, revision: 1 } } } };
  installLivingResources(w, START); installAutonomy(w, START);
  w.living.inventories[OWNER] = { stock: { moss: 5, light_fruit: 4 }, capacity: 24 };
  return w;
}
const direction = (w, id = 'wetland_frog', options = {}) => roleWishReadModel(w, { at: AT, ...options }).directions.find(item => item.direction_id === id);
const barrier = (read, id) => read.readiness.barriers.some(item => item.id === id);
function readyFrog() {
  return world(dates.map((at, index) => record(`frog-${index}`, { at, activity: index === 1 ? 'tend-bed' : 'water-bed' })));
}
function readyChef() {
  return world(dates.flatMap((at, index) => [observe(`c-observe-${index}`, { at, topic: 'cook', location: 'warm-pot-courtyard' }),
    record(`cook-${index}`, { at: new Date(Date.parse(at) + 20 * 60_000).toISOString(), activity: 'cook-moss', location: 'warm-pot-courtyard' })]));
}

test('old worlds and absent facets stay disabled without installation or mutation', () => {
  for (const w of [null, {}, world()]) {
    if (w?.memory) delete w.memory.development.facets;
    const before = structuredClone(w), view = roleWishReadModel(w, { at: AT });
    assert.equal(view.schema, ROLE_WISH_SCHEMA); assert.equal(view.enabled, false);
    assert.ok(view.directions.every(item => !item.readiness.eligible)); assert.deepEqual(w, before);
  }
  assert.equal(roleWishReadModel(world(), { actorId: 'absent', at: AT }).enabled, false);
  assert.equal(roleWishReadModel(readyFrog(), { at: 'invalid' }).enabled, false);
});

test('owner contact, repeated chats and old XP cannot establish an independent wish', () => {
  const w = world();
  w.memory.development.contacts = Array.from({ length: 100 }, (_, i) => ({ source_record_id: `owner-${i}`, actor_id: OWNER, topic: 'care', at: dates[i % 3] }));
  w.memory.actors[OWNER] = { interests: { care: { successes: 500, bonus: 100 } } };
  w.refraction = { records: [{ id: 'suggestion', category: 'dialogue', text: 'PRIVATE become a frog now' }] };
  const read = direction(w);
  assert.equal(read.basis.counts.roots, 0); assert.ok(barrier(read, 'active_days')); assert.equal(read.readiness.eligible, false);
  assert.doesNotMatch(JSON.stringify(read), /PRIVATE|500|100/);
});

test('actual invited practice supports capability but never supplies autonomous interest', () => {
  const w = world(dates.map((at, i) => record(`invited-${i}`, { at, activity: i === 1 ? 'tend-bed' : 'water-bed',
    causes: { trigger: 'invited', motivation: { kind: 'self_continuation' } } })));
  const read = direction(w);
  assert.equal(read.basis.counts.practice_successes, 3); assert.equal(read.basis.counts.invited_practice, 3);
  assert.equal(read.basis.counts.active, 0); assert.ok(barrier(read, 'active_roots')); assert.ok(barrier(read, 'active_days'));
});

test('one context, unknown location and mismatched recipe locations remain insufficient', () => {
  const single = world(dates.flatMap((at, day) => Array.from({ length: 20 }, (_, i) => record(`same-${day}-${i}`, { at }))));
  assert.equal(direction(single).basis.counts.active_threshold_roots, 6);
  assert.equal(direction(single).basis.active_contexts.length, 1); assert.ok(barrier(direction(single), 'active_contexts'));
  const unknown = world(dates.flatMap((at, i) => [record(`unknown-${i}`, { at, location: null }),
    record(`invented-${i}`, { at, location: 'new-unknown-place' }), record(`wrong-${i}`, { at, location: 'echo-waterside' })]));
  assert.equal(direction(unknown).basis.counts.roots, 0);
  assert.equal(direction(unknown).readiness.eligible, false);
});

test('direction-level daily representatives preserve a later actual different context', () => {
  const w = world(dates.flatMap((at, day) => [
    ...Array.from({ length: 20 }, (_, i) => observe(`repeat-${day}-${i}`, { at: new Date(Date.parse(at) + i * 60_000).toISOString() })),
    record(`later-practice-${day}`, { at: new Date(Date.parse(at) + 30 * 60_000).toISOString(), activity: 'tend-bed' }),
  ]));
  const read = direction(w);
  assert.equal(read.basis.counts.active, 63); assert.equal(read.basis.counts.active_threshold_roots, 6);
  assert.equal(read.basis.active_contexts.length, 2); assert.equal(read.readiness.eligible, true);
  assert.ok(read.basis.threshold_root_ids.includes('task:later-practice-2'));
});

test('three real dates, known different contexts and repeated actual results make a wish eligible only', () => {
  const w = readyFrog(), before = structuredClone(w), view = roleWishReadModel(w, { at: AT }), frog = view.directions[0];
  assert.equal(view.enabled, true); assert.equal(frog.readiness.eligible, true); assert.equal(frog.axis, 'form');
  assert.equal(frog.basis.practice_days.length, 3); assert.match(frog.authored_reason, /我想试试荷叶青蛙/);
  assert.equal(view.interpretation.eligibility_is_role_unlock, false); assert.equal(view.interpretation.automatic_appearance_changes, false);
  frog.basis.root_outcome_ids.push('client-mutation'); frog.readiness.checks[0].passed = false;
  assert.deepEqual(w, before); assert.equal(direction(w).basis.root_outcome_ids.length, 3);
  const saved = JSON.parse(JSON.stringify(w)); assert.deepEqual(roleWishReadModel(saved, { at: AT }), roleWishReadModel(w, { at: AT }));
});

test('duplicate task/project/memory views and another actor cannot amplify the same actual root', () => {
  const w = readyFrog(), root = w.memory.development.records[0];
  w.memory.development.records.push({ ...structuredClone(root), source: { kind: 'resident_project' } },
    { ...structuredClone(root), source: { kind: 'legacy_memory_fact' } });
  assert.equal(direction(w).basis.counts.roots, 3);
  w.memory.development.records.unshift(record('borrowed', { actor: FRIEND }),
    { ...record('borrowed'), source: { kind: 'resident_project' } });
  assert.equal(direction(w).basis.counts.roots, 3, 'canonical actor wins over a lower-rank project owner view');
  assert.equal(direction(w, 'wetland_frog', { actorId: FRIEND }).basis.counts.roots, 1);
});

test('future and outside-window outcomes cannot supply dates, contexts or practice', () => {
  const w = world([record('one'), record('two', { at: dates[1] }),
    record('future', { at: '2026-10-10T04:00:00Z', activity: 'tend-bed' }),
    record('old', { at: '2026-09-20T04:00:00Z', activity: 'tend-bed' })]);
  const read = direction(w); assert.equal(read.basis.counts.roots, 2); assert.equal(read.basis.active_days.length, 2);
  assert.equal(read.readiness.eligible, false); assert.equal(read.basis.latest_actual_outcome_at, dates[1]);
  assert.equal(roleWishReadModel(w, { at: '2026-10-06T03:59:59Z' }).directions[0].basis.counts.roots, 0);
});

test('form and vocation are independent, and serving or tasting is not actual cooking competence', () => {
  const w = readyChef(); w.memory.development.records.push(...readyFrog().memory.development.records);
  const read = roleWishReadModel(w, { at: AT });
  const frog = read.directions.find(item => item.direction_id === 'wetland_frog'), chef = read.directions.find(item => item.direction_id === 'chef');
  assert.equal(frog.readiness.eligible, true); assert.equal(chef.readiness.eligible, true);
  assert.equal(frog.axis, 'form'); assert.equal(chef.axis, 'vocation');
  assert.equal(chef.basis.counts.practice_successes, 3); assert.equal(chef.readiness.checks.find(item => item.id === 'practice_successes').required, 3);
  const served = world(dates.map((at, i) => record(`serve-${i}`, { at, activity: i === 1 ? 'soup-taste-trial' : 'soup-serve-trial', location: 'warm-pot-courtyard' })));
  assert.equal(direction(served, 'chef').basis.counts.practice_successes, 0);
  assert.ok(barrier(direction(served, 'chef'), 'practice_successes'));
});

test('conditions, performance failures and cancelled attempts remain distinct from preference', () => {
  const w = readyFrog();
  w.memory.development.records.push(record('resource-failure', { outcome: 'failed', failure: { classification: 'resource', reason: 'PRIVATE raw prose' } }),
    record('performance', { outcome: 'failed', failure: { classification: 'performance' } }),
    record('unknown', { outcome: 'failed', failure: { classification: 'unclassified' } }), record('cancelled', { outcome: 'cancelled' }));
  const read = direction(w);
  assert.equal(read.basis.counts.condition_failures, 1); assert.equal(read.basis.counts.performance_failures, 1);
  assert.equal(read.basis.counts.unknown_failures, 1); assert.equal(read.basis.counts.cancellations, 1);
  assert.equal(read.readiness.eligible, true); assert.equal(read.basis.counts.active, 3);
  assert.doesNotMatch(JSON.stringify(read), /PRIVATE/);
});

test('needs, task occupancy, paths and finite stock defer an otherwise supported direction without writes', () => {
  const w = readyChef(), previous = structuredClone(w), first = direction(w, 'chef'); assert.equal(first.readiness.eligible, true);
  w.autonomy.actors[OWNER].energy = .2; assert.ok(barrier(direction(w, 'chef'), 'current_needs'));
  w.autonomy.actors[OWNER].energy = .8; w.autonomy.actors[OWNER].appetite = .9; assert.ok(barrier(direction(w, 'chef'), 'current_needs'));
  w.autonomy.actors[OWNER].appetite = .3; w.tasks.push({ task_id: 'busy', actor_id: OWNER, status: 'running' });
  assert.ok(barrier(direction(w, 'chef'), 'actor_available')); w.tasks = [];
  w.active_event = { blocks_travel: true }; assert.ok(barrier(direction(w, 'chef'), 'practice_available')); delete w.active_event;
  w.living.inventories[OWNER].stock = {}; assert.ok(barrier(direction(w, 'chef'), 'practice_available'));
  const beforeRead = structuredClone(w); direction(w, 'chef'); assert.deepEqual(w, beforeRead);
  assert.equal(w.memory.development.records.length, previous.memory.development.records.length);
  assert.equal(w.protagonist.form, previous.protagonist.form);
});

test('unimplemented fantasy directions stay explicitly unavailable', () => {
  const w = readyFrog(); w.memory.development.records.push(observe('sky', { topic: 'explore', location: 'fog-lamp-square' }));
  for (const id of ['starry_observer', 'dream_cloud']) {
    const read = direction(w, id); assert.ok(barrier(read, 'authored_practice')); assert.equal(read.basis.counts.roots, 0);
    assert.equal(read.readiness.eligible, false); assert.equal(read.axis, 'form');
  }
});

test('same gate has a stable fingerprint as continuous need values and the clock advance', () => {
  const w = readyFrog(), original = direction(w), signature = original.fingerprint;
  w.autonomy.actors[OWNER].energy -= .01; w.autonomy.actors[OWNER].appetite += .01;
  const later = direction(w, 'wetland_frog', { at: '2026-10-09T04:01:00Z' });
  assert.equal(later.fingerprint, signature); assert.equal(later.readiness.eligible, true);
  w.autonomy.actors[OWNER].energy = .54; assert.notEqual(direction(w).fingerprint, signature);
});

test('bounded evidence references retain newest dated roots for cooldown reconsideration', () => {
  const w = world(Array.from({ length: 120 }, (_, i) => record(`many-${i}`, {
    at: new Date(Date.parse(dates[0]) + i * 10 * 60_000).toISOString(), activity: i % 2 ? 'water-bed' : 'tend-bed' })));
  const read = direction(w);
  assert.ok(read.basis.root_outcome_ids.length <= 32); assert.ok(read.basis.root_outcomes.length <= 32);
  assert.ok(read.basis.active_roots.length <= 28); assert.ok(read.basis.practice_success_roots.length <= 32);
  assert.equal(read.basis.counts.practice_successes, 120);
  assert.ok(read.basis.root_outcomes.some(item => item.root_outcome_id === 'task:many-119'));
  assert.ok(read.basis.latest_root_outcome_ids.includes('task:many-119'));
});

test('pure living eligibility respects the actual project observation delay and explicit read time', () => {
  const w = world(), helper = 'spare-mender-001';
  w.npcs.push({ npc_id: helper, display_name: '扣扣', location_id: 'echo-waterside' });
  w.resident_projects = { projects: { 'floating-seedbed': { project_id: 'floating-seedbed', owner_id: 'wetland-grower-001',
    status: 'active', stage_id: 'inspect', evidence: [], attempt: 1 } } };
  w.living.objects['floating-frame'].project_assets = { floating_seedbed: { installed_at: START, quantity: 3, health: .9 } };
  w.clock.synced_at = '2026-10-06T11:59:59Z';
  const before = structuredClone(w), blocked = livingReadModel(w, helper).activities.find(activity => activity.activity_id === 'seedbed-inspect');
  assert.equal(blocked.available, false); assert.match(blocked.unavailable_reason, /至少 12 小时/);
  const after = livingReadModel(w, helper, { at: '2026-10-06T12:00:00Z' }).activities.find(activity => activity.activity_id === 'seedbed-inspect');
  assert.equal(after.available, true); assert.deepEqual(w, before);
});

test('pure living eligibility does not show an expired carried recipe batch as usable', () => {
  const w = world();
  w.npcs[0].location_id = 'warm-pot-courtyard';
  w.resident_projects = { projects: { 'leaf-signature-soup': { project_id: 'leaf-signature-soup', owner_id: FRIEND,
    status: 'active', stage_id: 'serve', evidence: [], attempt: 1 } } };
  w.living.objects['trial-stove'].project_batches = { 'leaf-signature-soup': { batch_id: 'batch-1', status: 'carried', carrier_id: FRIEND,
    prepared_at: START, expires_at: '2026-10-06T02:00:00Z' } };
  w.living.inventories[FRIEND] = { stock: { trial_soup: 2 }, capacity: 24 };
  w.living.objects['shared-table'].stock.trial_soup = 0;
  w.clock.synced_at = '2026-10-06T02:00:00Z';
  const before = structuredClone(w), expired = livingReadModel(w, FRIEND).activities.find(activity => activity.activity_id === 'soup-serve-trial');
  assert.equal(expired.available, false); assert.match(expired.unavailable_reason, /过期/);
  const fresh = livingReadModel(w, FRIEND, { at: '2026-10-06T01:59:59Z' }).activities.find(activity => activity.activity_id === 'soup-serve-trial');
  assert.equal(fresh.available, true); assert.deepEqual(w, before);
});
