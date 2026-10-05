import test from 'node:test';
import assert from 'node:assert/strict';
import { syncDevelopmentEvidence } from '../src/development-evidence.mjs';
import { roleDevelopmentReadModel } from '../src/role-development.mjs';
import { createRoleEvolution } from '../src/role-evolution.mjs';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { computeFantasyPull } from '../src/fantasy-pull.mjs';
import { LIVING_RULE_VERSION } from '../src/living-resources.mjs';

const AT = '2026-10-05T04:00:00.000Z';
const now = () => new Date(AT);
const direction = (read, id) => read.directions.find(item => item.direction_id === id);
function world() {
  return {
    protagonist: { character_id: 'shaping-001', display_name: '喵呜' },
    npcs: [{ npc_id: 'wetland-grower-001', display_name: '苔团' }],
    clock: { mode: 'real_time', time_zone: 'Asia/Shanghai', synced_at: AT },
    tasks: [], social: { commitments: [] }, resident_projects: { projects: {} },
    refraction: { records: [] }, autonomy: { actors: {} },
    memory: { episodes: [], seen: [], actors: {}, revision: 0 },
  };
}
function task(id, overrides = {}) {
  return {
    task_id: id, actor_id: 'shaping-001', kind: 'care', life_action: 'care',
    activity_id: 'water-bed', life_goal: 'water:garden-bed',
    location_id: 'moss-sprout-garden', origin: 'autonomous_life',
    life_source_ids: [], completion_effect: LIVING_RULE_VERSION,
    status: 'completed', finished_at: AT,
    completion: { due_at: AT, result: { text: '浇水完成。' } },
    ...overrides,
  };
}
function evolutionFor(state, { events = [], roles = createRoleProposalStore({ now }), persistence = null } = {}) {
  const inputStore = { list: () => structuredClone(events), add() { throw Error('development must not manufacture input events'); } };
  return { roles, inputStore, evolution: createRoleEvolution({ now, inputStore, roles, computeFantasyPull, persistence, worldSnapshot: () => state }) };
}

test('old or missing development state is read safely without installing it', () => {
  for (const state of [null, {}, world()]) {
    const before = structuredClone(state);
    const read = roleDevelopmentReadModel(state);
    assert.equal(read.mode, 'direction_observation_only');
    assert.equal(read.enabled, false);
    assert.equal(read.evidence_count, 0);
    assert.ok(read.directions.every(item => item.status === 'not_observed' && item.unlocked === false));
    assert.deepEqual(state, before);
  }
  const roles = createRoleProposalStore({ now });
  const evolution = createRoleEvolution({ now, inputStore: { list: () => [] }, roles, computeFantasyPull });
  assert.equal(evolution.snapshot().development.enabled, false);
});

test('actual outcomes observe directions without keyword inputs, role proposals or appearance changes', () => {
  const state = world();
  state.tasks.push(task('care'), task('repair', { kind: 'craft', life_action: 'craft', activity_id: 'repair-bench', life_goal: 'repair:repair-bench', location_id: 'spare-parts-house' }),
    task('cook', { kind: 'craft', life_action: 'craft', activity_id: 'cook-moss', life_goal: 'cook', location_id: 'warm-pot-courtyard' }));
  syncDevelopmentEvidence(state, AT);
  const { evolution, roles } = evolutionFor(state);
  const run = evolution.sync();
  assert.equal(run.event_count, 0);
  assert.deepEqual(run.created, []);
  const read = evolution.snapshot().development;
  assert.equal(read.enabled, true);
  assert.equal(read.evidence_count, 3);
  assert.deepEqual(direction(read, 'wetland_frog').root_outcome_ids, ['task:care']);
  assert.deepEqual(direction(read, 'workshop_maker').root_outcome_ids, ['task:repair']);
  assert.equal(direction(read, 'chef').availability, 'future_direction');
  assert.equal(direction(read, 'chef').status, 'observing');
  assert.equal(direction(read, 'chef').unlocked, false);
  assert.equal(roles.list().length, 0);
  assert.ok(read.directions.every(item => item.preference && item.capability && item.barriers.length === 3));
  assert.deepEqual(direction(read,'chef').capability.success_roots,['task:cook']);
  assert.equal(direction(read,'chef').preference.topics[0].status,'unobserved');
});

test('task, project and memory views share a single root rather than amplifying practice', () => {
  const state = world();
  state.tasks.push(task('one', { activity_id: 'seedbed-plant', life_goal: 'floating-seedbed' }));
  state.resident_projects.projects.p = {
    project_id: 'floating-seedbed', owner_id: 'shaping-001', name: '浮圃',
    history: [{ at: AT, task_id: 'one', actor_id: 'shaping-001', outcome: 'completed', stage_id: 'plant', location_id: 'moss-sprout-garden' }],
    evidence: [{ task_id: 'one', actor_id: 'shaping-001' }],
  };
  state.memory.episodes.push({ id: 'memory:view-one', origin_id: 'task:one:completed', kind: 'world_fact', actor_ids: ['shaping-001'], at: AT,
    topic: 'care', outcome: 'completed', location_id: 'moss-sprout-garden', source: { kind: 'canonical_task', task_id: 'one', activity_id: 'seedbed-plant' }, independent_evidence: true });
  syncDevelopmentEvidence(state, AT);
  syncDevelopmentEvidence(state, AT);
  const read = roleDevelopmentReadModel(state);
  const care = direction(read, 'wetland_frog');
  assert.equal(care.evidence_count, 1);
  assert.equal(care.counts.completed, 1);
  assert.equal(care.day_count, 1);
  assert.equal(care.context_count, 1);
  assert.equal(care.records[0].root_outcome_id, 'task:one');
  assert.ok(care.records[0].views.memory_ids.includes('memory:view-one'));
  assert.ok(care.records[0].views.project_stages.some(item => item.project_id === 'floating-seedbed'));
});

test('failure is an attempted outcome, not negative preference or a capability verdict', () => {
  const state = world();
  state.tasks.push(task('failure', { status: 'failed', completion: null, failure_reason: '材料不够' }));
  syncDevelopmentEvidence(state, AT);
  const read = roleDevelopmentReadModel(state);
  const care = direction(read, 'wetland_frog');
  assert.equal(care.counts.failed, 1);
  assert.equal(care.counts.completed, 0);
  assert.equal(care.preference.topics[0].status,'unobserved');
  assert.deepEqual(care.capability.unknown_failure_roots,['task:failure']);
  assert.deepEqual(care.capability.performance_failure_roots,[]);
  assert.equal(read.interpretation.failed_practice_is_negative_preference, false);
  assert.equal(read.interpretation.practice_count_is_capability, false);
});

test('owner-linked practice keeps its invitation provenance while autonomous practice remains separate', () => {
  const state = world();
  state.refraction.records.push({ id: 'user-idea', origin_id: 'user-origin', source_event_id: 'user-event', category: 'dialogue', attested: true, received_at: AT });
  state.tasks.push(task('own'), task('suggested', { life_goal: 'input:tend', life_source_ids: ['user-idea'] }));
  syncDevelopmentEvidence(state, AT);
  const care = direction(roleDevelopmentReadModel(state), 'wetland_frog');
  assert.equal(care.evidence_count, 2);
  assert.equal(care.counts.autonomous, 1);
  assert.equal(care.counts.invited, 1);
  assert.equal(care.counts.owner_linked, 1);
  assert.equal(care.records.find(item => item.root_outcome_id === 'task:suggested').owner_linked, true);
});

test('practice dates and contexts are unique, actor-filtered and never supplied by generic themes', () => {
  const state = world();
  state.tasks.push(task('day-one', { finished_at: '2026-10-03T16:10:00Z', completion: { due_at: '2026-10-03T16:10:00Z' } }),
    task('day-two', { activity_id: 'tend-bed', life_goal: 'tend', finished_at: '2026-10-04T16:10:00Z', completion: { due_at: '2026-10-04T16:10:00Z' } }),
    task('npc', { actor_id: 'wetland-grower-001' }),
    task('observe', { kind: 'observe', life_action: 'observe', life_goal: 'interest:explore', activity_id: null, location_id: 'tidal-old-road' }));
  syncDevelopmentEvidence(state, AT);
  const read = roleDevelopmentReadModel(state);
  assert.deepEqual(direction(read, 'wetland_frog').practice_days, ['2026-10-04', '2026-10-05']);
  assert.equal(direction(read, 'wetland_frog').context_count, 2);
  assert.equal(direction(read, 'wetland_frog').evidence_count, 2);
  assert.equal(direction(read, 'starry_observer').evidence_count, 0);
  assert.equal(direction(read, 'dream_cloud').evidence_count, 0);
  assert.equal(direction(roleDevelopmentReadModel(state, { actorId: 'wetland-grower-001' }), 'wetland_frog').evidence_count, 1);
});

test('snapshot is pure and returns detached references without persistence or input writes', () => {
  const state = world(); state.tasks.push(task('one')); syncDevelopmentEvidence(state, AT);
  const writes = [];
  const persistence = { list: () => [], put: (...args) => writes.push(args), remove: (...args) => writes.push(args) };
  const { evolution } = evolutionFor(state, { persistence });
  const before = structuredClone(state), first = evolution.snapshot();
  const fingerprint = first.development.evidence_fingerprint;
  first.development.directions[0].records[0].views.memory_ids.push('mutated-client');
  assert.equal(evolution.snapshot().development.evidence_fingerprint, fingerprint);
  assert.deepEqual(state, before);
  assert.deepEqual(writes, []);
});

test('legacy keyword proposals and dialogue trial lifecycle stay unchanged when practice is added', () => {
  const state = world();
  const events = [
    { event_id: 'rain', type: 'weather.observation', layer: 'weather', character_id: 'shaping-001', occurred_at: '2026-10-04T03:00:00Z', received_at: '2026-10-04T03:00:00Z', payload: { text: '雨落在湿地池塘荷叶边' } },
    { event_id: 'preference', type: 'user.preference', layer: 'user_profile', character_id: 'shaping-001', occurred_at: '2026-10-04T03:10:00Z', received_at: '2026-10-04T03:10:00Z', payload: { value: '荷叶边散步' } },
    { event_id: 'next-day', type: 'world.mutation', layer: 'world_line', character_id: 'shaping-001', occurred_at: '2026-10-05T03:00:00Z', received_at: '2026-10-05T03:00:00Z', payload: { summary: '池塘湿地荷叶很亮' } },
  ];
  const { evolution, roles } = evolutionFor(state, { events });
  const first = evolution.sync(); assert.equal(first.created.length, 1);
  const proposal = first.created[0]; roles.choose(proposal.proposal_id, 'try'); roles.startTrial(proposal.proposal_id, { windowTurns: 3 });
  const beforeProposal = roles.get(proposal.proposal_id), beforeRun = first.run_id;
  state.tasks.push(task('practice', { status: 'failed', completion: null })); syncDevelopmentEvidence(state, AT);
  const snapshot = evolution.snapshot();
  const candidate = snapshot.candidates.find(item => item.direction_id === 'wetland_frog');
  assert.equal(candidate.evidence_basis, 'legacy_input_cues');
  assert.equal(candidate.development_context.counts.failed, 1);
  assert.equal(candidate.development_context.lifecycle_changed, false);
  assert.deepEqual(roles.get(proposal.proposal_id), beforeProposal);
  assert.equal(evolution.sync().run_id, beforeRun);
  assert.equal(evolution.sync().duplicate, true);
  assert.equal(snapshot.development.legacy_context.trial_turns_are_practice, false);
  const chat = { event_id: 'trial-chat', type: 'conversation.input', layer: 'dialogue', character_id: 'shaping-001', occurred_at: AT, payload: { role: 'user', text: '现在怎样？' } };
  assert.equal(evolution.observeEvent(chat).trials[0].turns_observed, 1);
  assert.equal(evolution.observeEvent(chat).trials[0].turns_observed, 1);
});
