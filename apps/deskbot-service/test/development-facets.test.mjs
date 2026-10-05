import test from 'node:test';
import assert from 'node:assert/strict';
import { activityTopic, DEVELOPMENT_FACETS_VERSION, developmentFacetsReadModel, syncDevelopmentFacets } from '../src/development-facets.mjs';

const OWN = 'shaping-001', FRIEND = 'pot-cook-001';
const START = '2026-10-06T00:00:00.000Z', END = '2026-10-10T12:00:00.000Z';
function world(records = []) {
  return { protagonist: { character_id: OWN, display_name: '喵呜', form: 'anchor' }, npcs: [{ npc_id: FRIEND, display_name: '阿砾' }],
    clock: { mode: 'real_time', time_zone: 'Asia/Shanghai', synced_at: END }, tasks: [],
    living: { inventories: { [OWN]: { stock: { rations: 2 }, capacity: 24 } } },
    memory: { actors: { [OWN]: { interests: { cook: { successes: 50, bonus: 18 } } } }, episodes: [],
      development: { schema: 'deskbot.development-evidence.v1', installed_at: START, revision: 1, records, contacts: [] } },
    role_trials: { enabled: true, proposals: [] } };
}
function record(id, { at = START, actor = OWN, activity = 'cook-grove-stew', motivation = 'self_continuation', outcome = 'completed', location = 'warm-pot-courtyard', ...rest } = {}) {
  return { root_outcome_id: `task:${id}`, actor_ids: [actor], at, outcome, activity_id: activity, location_id: location, topic: 'craft',
    source: { kind: 'canonical_task', task_kind: 'care', life_action: null },
    causes: { trigger: 'own', motivation: { kind: motivation } }, effect: { practice: true }, failure: null, ...rest };
}
const topic = (w, name = 'cook', actorId = OWN) => developmentFacetsReadModel(w, { actorId, at: END }).actors[0].topics.find(item => item.topic === name);

test('actual authored activity decides the topic rather than a plan title or inherited project topic', () => {
  for (const [activity, expected] of [['cook-grove-stew', 'cook'], ['soup-serve-trial', 'cook'], ['gather-light-fruit', 'care'],
    ['pump-assemble', 'repair'], ['repair-stove', 'repair'], ['seedbed-plant', 'care'], ['craft-tray', 'craft'], ['share-meal', null], ['made-up-chef', null]]) {
    assert.equal(activityTopic(activity), expected, activity);
  }
  const w = world([record('gather', { activity: 'gather-light-fruit' }), record('cook', { activity: 'cook-grove-stew' })]);
  assert.deepEqual(topic(w, 'care').capability.success_roots, ['task:gather']);
  assert.deepEqual(topic(w).capability.success_roots, ['task:cook']);
  assert.equal(topic(w, 'craft').capability.success_roots.length, 0);
});

test('task, project, memory and commitment references to one result count once per facet', () => {
  const actual = record('one');
  const old = { ...record('one', { motivation: 'unknown' }), source: { kind: 'legacy_memory_fact' }, views: { commitment_ids: ['a'], memory_ids: ['b'] } };
  const w = world([old, actual, { ...actual, source: { kind: 'resident_project' } }]);
  const view = developmentFacetsReadModel(w, { at: END }), cooking = topic(w);
  assert.equal(view.coverage.roots, 1);
  assert.equal(cooking.capability.success_roots.length, 1);
  assert.deepEqual(cooking.interest.active_roots, ['task:one']);
  assert.deepEqual(cooking.interest.unknown_roots, []);
});

test('one-day repetition cannot manufacture sustained interest or an automatic wish', () => {
  const w = world(Array.from({ length: 20 }, (_, index) => record(`same-day-${index}`, { at: `2026-10-06T0${index % 8}:00:00.000Z` })));
  const cooking = topic(w);
  assert.equal(cooking.interest.active_roots.length, 20);
  assert.equal(cooking.interest.threshold_root_ids.length, 2);
  assert.equal(cooking.interest.status, 'initial');
  assert.equal(cooking.interest.bonus, 0);
  assert.equal(cooking.capability.status, 'practiced', 'same-day quantity does not prove cross-day repetition');
  assert.deepEqual(cooking.wish, { status: 'not_established', automatic: false, stable_interest: false });
});

test('an autonomous need, an invitation and an unknown old own flag stay separate from self continuation', () => {
  const w = world([record('hungry', { motivation: 'need' }), record('invited', { motivation: 'invited' }),
    record('legacy-own', { causes: { trigger: 'own' } }), record('continued')]);
  const cooking = topic(w);
  assert.deepEqual(cooking.interest.active_roots, ['task:continued']);
  assert.deepEqual(cooking.interest.obligation_roots, ['task:hungry']);
  assert.deepEqual(cooking.interest.invited_roots, ['task:invited']);
  assert.deepEqual(cooking.interest.unknown_roots, ['task:legacy-own']);
  assert.equal(cooking.capability.success_roots.length, 4, 'actual invited practice still provides execution evidence');
  assert.match(cooking.self_assessment.summary, /实际做成|尚不能|仍需/);
  const conflicting = topic(world([record('mixed', { causes: { trigger: 'invited', motivation: { kind: 'self_continuation' } } })]));
  assert.deepEqual(conflicting.interest.active_roots, []);
  assert.deepEqual(conflicting.interest.invited_roots, ['task:mixed']);
});

test('cross-day continuation uses Shanghai days, diverse real contexts and a bounded bonus', () => {
  const w = world([record('first', { at: '2026-10-06T15:50:00.000Z' }),
    record('second', { at: '2026-10-06T16:10:00.000Z' }),
    record('third', { at: '2026-10-07T16:10:00.000Z', activity: 'cook-moss' })]);
  const cooking = topic(w);
  assert.deepEqual(cooking.interest.active_days, ['2026-10-06', '2026-10-07', '2026-10-08']);
  assert.equal(cooking.interest.active_contexts.length, 2);
  assert.equal(cooking.interest.status, 'continuing');
  assert.equal(cooking.interest.bonus, 6);
  assert.equal(cooking.wish.stable_interest, true);
  assert.equal(cooking.wish.status, 'not_established');
  const singleContext = topic(world(w.memory.development.records.map(r => ({ ...r, activity_id: 'cook-grove-stew' }))));
  assert.equal(singleContext.interest.status, 'trying');
  assert.equal(singleContext.interest.bonus, 3);
  const missingContext = topic(world([record('known-a', { at: '2026-10-06T00:00:00.000Z' }),
    record('known-b', { at: '2026-10-07T00:00:00.000Z' }),
    record('missing', { at: '2026-10-08T00:00:00.000Z', activity: 'cook-moss', location: null })]));
  assert.equal(missingContext.interest.active_contexts.length, 1, 'missing location is not a second actual context');
  assert.equal(missingContext.interest.status, 'trying');
});

test('successful registered recipes are counted by recipe, never combined into chef certification', () => {
  const w = world([record('fruit-a'), record('fruit-b', { at: '2026-10-07T00:00:00.000Z' }),
    record('fruit-c', { at: '2026-10-07T01:00:00.000Z' }), record('moss', { activity: 'cook-moss' }),
    record('friend', { actor: FRIEND })]);
  const cooking = topic(w);
  assert.equal(cooking.capability.status, 'repeated_in_context');
  const fruit = cooking.capability.activities.find(activity => activity.activity_id === 'cook-grove-stew');
  const moss = cooking.capability.activities.find(activity => activity.activity_id === 'cook-moss');
  assert.equal(fruit.successes, 3); assert.equal(fruit.status, 'repeated_in_context');
  assert.equal(moss.successes, 1); assert.equal(moss.status, 'practiced');
  assert.equal(topic(w, 'cook', FRIEND).capability.success_roots.length, 1);
  assert.match(cooking.capability.summary, /不代表职业资格/);
  assert.equal(cooking.wish.automatic, false);
});

test('server-attested contact metadata and repeated news text never become practice or interest', () => {
  const w = world();
  w.memory.development.contacts = [
    { source_record_id: 'news-one', actor_id: OWN, topic: 'cook', at: START, category: 'external', expires_at: '2026-10-06T01:00:00.000Z', text: 'PRIVATE NEWS' },
    { source_record_id: 'news-one', actor_id: OWN, topic: 'cook', at: '2026-10-07T00:00:00.000Z', category: 'external' },
    { source_record_id: 'owner-message', actor_id: OWN, topic: 'cook', at: START, category: 'user' },
    { source_record_id: 'other-actor', actor_id: FRIEND, topic: 'cook', at: START, category: 'agent' },
  ];
  w.memory.episodes = [{ kind: 'dialogue', text: 'I am a brilliant chef', topic: 'cook', actor_ids: [OWN], at: START }];
  const cooking = topic(w);
  assert.equal(cooking.contact.count, 2); assert.deepEqual(cooking.contact.days, ['2026-10-06']);
  assert.equal(cooking.interest.bonus, 0); assert.equal(cooking.capability.success_roots.length, 0);
  assert.equal(cooking.wish.status, 'not_established');
  assert.doesNotMatch(JSON.stringify(developmentFacetsReadModel(w)), /PRIVATE|brilliant chef/);
});

test('conditions, explicit performance, unknown failure and cancellation remain distinct without text guessing', () => {
  const w = world([
    record('missing-fruit', { outcome: 'failed', failure: { classification: 'resource', code: 'activity_missing_input', reason: '不会做' } }),
    record('unreachable', { outcome: 'failed', failure: { classification: 'route', code: 'route_unavailable' } }),
    record('technique', { outcome: 'failed', failure: { classification: 'performance', code: 'authored_trial_execution_incomplete' } }),
    record('unknown', { outcome: 'failed', failure: { classification: 'unclassified', reason: '技术失败、完全不会做这道菜' } }),
    record('cancelled', { outcome: 'cancelled', failure: { classification: 'cancelled', code: 'activity_cancelled' } }),
  ]);
  const cooking = topic(w);
  assert.equal(cooking.capability.status, 'unobserved');
  assert.deepEqual(cooking.capability.condition_failure_roots, ['task:missing-fruit', 'task:unreachable']);
  assert.deepEqual(cooking.capability.performance_failure_roots, ['task:technique']);
  assert.deepEqual(cooking.capability.unknown_failure_roots, ['task:unknown']);
  assert.deepEqual(cooking.capability.cancelled_roots, ['task:cancelled']);
  assert.deepEqual(cooking.interest.active_roots, []);
  assert.match(cooking.self_assessment.summary, /不说明不会做/);
  assert.match(cooking.self_assessment.summary, /明确执行不足/);
  assert.match(cooking.self_assessment.summary, /原因尚未判明/);
});

test('authored actual observations may show interest, while rest, travel, eating and uncommitted effects cannot', () => {
  const observing = record('observe', { activity: null, location: 'backlit-grove', topic: 'explore',
    source: { kind: 'canonical_task', task_kind: 'care', life_action: 'observe' }, effect: { practice: false } });
  const w = world([observing,
    record('rest', { source: { kind: 'canonical_task', task_kind: 'care', life_action: 'rest' } }),
    record('travel', { source: { kind: 'canonical_task', task_kind: 'travel' } }),
    record('eat', { activity: 'share-meal' }),
    record('uncommitted', { effect: { practice: false } }),
    record('generic-prose', { activity: null, topic: 'explore' })]);
  assert.deepEqual(topic(w, 'explore').interest.active_roots, ['task:observe']);
  assert.equal(topic(w, 'explore').capability.success_roots.length, 0);
  assert.equal(topic(w).interest.active_roots.length, 0);
  assert.equal(topic(w, 'connection').capability.success_roots.length, 0);
});

test('read projection is pure and sync adds only metadata/cache without rewarding old state', () => {
  const w = world([record('one')]), before = structuredClone(w);
  const first = developmentFacetsReadModel(w, { at: END });
  assert.equal(first.schema, DEVELOPMENT_FACETS_VERSION);
  assert.deepEqual(w, before);
  assert.deepEqual(developmentFacetsReadModel(w, { at: END }), first);
  const installed = syncDevelopmentFacets(w, END);
  assert.equal(installed.installed, true); assert.equal(installed.changed, true);
  const added = structuredClone(w.memory.development.facets);
  const unchanged = syncDevelopmentFacets(w, '2026-10-11T12:00:00.000Z');
  assert.equal(unchanged.changed, false); assert.deepEqual(w.memory.development.facets, added);
  const stripped = structuredClone(w); delete stripped.memory.development.facets;
  assert.deepEqual(stripped, before, 'old interests, identity, task state, stock, role trials and ledger stay untouched');
  assert.equal(syncDevelopmentFacets({}, END).enabled, false);
});

test('serialized reload retains common-root outcomes and rebuilding cache gives the same assessment', () => {
  const w = world([record('one'), record('two', { at: '2026-10-07T00:00:00.000Z' })]);
  syncDevelopmentFacets(w, END);
  const before = developmentFacetsReadModel(w, { at: END }), loaded = JSON.parse(JSON.stringify(w));
  assert.equal(syncDevelopmentFacets(loaded, END).changed, false);
  assert.deepEqual(developmentFacetsReadModel(loaded, { at: END }), before);
  loaded.memory.development.records.push(record('three', { at: '2026-10-08T00:00:00.000Z', activity: 'cook-moss' }));
  loaded.memory.development.revision += 1;
  assert.equal(syncDevelopmentFacets(loaded, END).changed, true);
  assert.equal(topic(loaded).interest.status, 'continuing');
  assert.equal(w.memory.development.records.length, 2);
});

test('future, malformed and out-of-actor records do not enter current evidence and empty views stay disabled', () => {
  const w = world([record('future', { at: '2026-10-11T00:00:00.000Z' }), record('bad-date', { at: 'private nonsense' }),
    record('outsider', { actor: 'unregistered-person' })]);
  assert.equal(topic(w).capability.success_roots.length, 0);
  assert.equal(developmentFacetsReadModel(w, { actorId: 'absent', at: END }).actors.length, 0);
  const blank = developmentFacetsReadModel({});
  assert.equal(blank.enabled, false); assert.equal(blank.actors.length, 0);
});

test('cached reads equal a fresh derivation, retain current metadata and cannot mutate stored cache', () => {
  const w = world([record('one'), record('two', { at: '2026-10-07T00:00:00.000Z' })]);
  syncDevelopmentFacets(w, END);
  const cached = developmentFacetsReadModel(w, { actorId: OWN, at: END });
  const fresh = structuredClone(w); delete fresh.memory.development.facets.cache;
  assert.deepEqual(cached, developmentFacetsReadModel(fresh, { actorId: OWN, at: END }));
  cached.actors[0].topics[0].interest.active_roots.push('forged-root'); cached.coverage.roots = 999;
  assert.doesNotMatch(JSON.stringify(w.memory.development.facets.cache), /forged-root/);
  assert.equal(developmentFacetsReadModel(w, { at: END }).coverage.roots, 2);
  w.memory.development.facets.revision = 17;
  w.memory.development.facets.installed_at = '2026-10-06T00:10:00.000Z';
  const metadata = developmentFacetsReadModel(w, { at: END });
  assert.equal(metadata.revision, 17); assert.equal(metadata.installed_at, w.memory.development.facets.installed_at);
});

test('earlier or newly crossed future outcomes bypass cache and never leak future evidence', () => {
  const w = world([record('past'), record('later', { at: '2026-10-07T00:00:00.000Z' })]);
  const early = '2026-10-06T02:00:00.000Z';
  syncDevelopmentFacets(w, early);
  assert.equal(developmentFacetsReadModel(w, { at: early }).coverage.roots, 1);
  assert.equal(developmentFacetsReadModel(w, { at: END }).coverage.roots, 2, 'later root is admitted after its time crosses the cached bound');
  syncDevelopmentFacets(w, END);
  const earlierRead = developmentFacetsReadModel(w, { at: early });
  assert.equal(earlierRead.coverage.roots, 1);
  assert.deepEqual(earlierRead.actors[0].topics.find(t => t.topic === 'cook').capability.success_roots, ['task:past']);
  assert.equal(w.memory.development.facets.cache.coverage.roots, 2, 'read stays pure when bypassing cache');
});

test('sparse indexed cache restores all resident defaults and follows common-ledger revision changes', () => {
  const w = world([record('one'), record('two', { at: '2026-10-07T00:00:00.000Z' })]);
  w.npcs = Array.from({ length: 12 }, (_, index) => ({ npc_id: `resident-${index}`, display_name: `居民${index}` }));
  syncDevelopmentFacets(w, END);
  const cache = w.memory.development.facets.cache;
  assert.equal(cache.actors.length, 1, 'residents with no evidence need no stored topic boilerplate');
  assert.equal(cache.actors[0].topics.length, 1);
  assert.ok(cache.actors[0].topics[0].capability.success_roots.every(Number.isInteger));
  const view = developmentFacetsReadModel(w, { at: END });
  assert.equal(view.actors.length, 13); assert.equal(view.actors[12].topics.length, 6);
  assert.equal(view.actors[12].topics[0].interest.status, 'unobserved');
  assert.equal(view.actors[12].topics[0].wish.automatic, false);
  const fresh = structuredClone(w); delete fresh.memory.development.facets.cache;
  assert.deepEqual(view, developmentFacetsReadModel(fresh, { at: END }));
  w.memory.development.records.reverse(); w.memory.development.revision += 1;
  assert.equal(syncDevelopmentFacets(w, END).changed, true);
  assert.deepEqual(topic(w).capability.success_roots, ['task:one', 'task:two']);
});
