import assert from 'node:assert/strict';
import test from 'node:test';

import { computeFantasyPull } from '../src/fantasy-pull.mjs';
import { normalizeChat } from '../src/input-store.mjs';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { createRoleEvolution } from '../src/role-evolution.mjs';

let currentTime = new Date('2026-09-29T12:00:00.000Z');
const fixedNow = () => new Date(currentTime);
const events = [
  { event_id: 'evo-weather', type: 'weather.observation', layer: 'weather', character_id: 'shaping-001', occurred_at: '2026-09-29T09:00:00.000Z', received_at: '2026-09-29T09:00:00.000Z', payload: { text: '雨一直落在池塘边，湿地今天很亮' } },
  { event_id: 'evo-profile', type: 'user.preference', layer: 'user_profile', character_id: 'shaping-001', occurred_at: '2026-09-29T10:00:00.000Z', received_at: '2026-09-29T10:00:00.000Z', payload: { value: '想去荷叶边散步' } },
  { event_id: 'evo-world', type: 'world.mutation', layer: 'world_line', character_id: 'shaping-001', occurred_at: '2026-09-29T11:00:00.000Z', received_at: '2026-09-29T11:00:00.000Z', payload: { summary: '湿地出现一片会发光的荷叶' } },
];

function inputStoreFor(list) {
  return { list: () => list.map((item) => structuredClone(item)) };
}

test('P4 role evolution waits for two logical days before materializing a proposal', () => {
  currentTime = new Date('2026-09-29T12:00:00.000Z');
  const records = new Map();
  const persistence = {
    list: (namespace) => [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value)),
    put: (namespace, id, value) => records.set(`${namespace}:${id}`, structuredClone(value)),
    remove: (namespace, id) => records.delete(`${namespace}:${id}`),
  };
  const roles = createRoleProposalStore({ persistence, now: fixedNow });
  const eventStore = structuredClone(events);
  const evolution = createRoleEvolution({ now: fixedNow, inputStore: inputStoreFor(eventStore), roles, computeFantasyPull, persistence });
  const first = evolution.sync({ characterId: 'shaping-001' });
  const pull = first.pulls.find((item) => item.direction_id === 'wetland_frog');
  assert.equal(pull.status, 'candidate');
  assert.equal(first.materialized.filter((item) => item.created).length, 0);
  assert.equal(first.materialized.find((item) => item.direction_id === 'wetland_frog').suppressed, 'cross_logical_day_gate');
  assert.equal(evolution.snapshot({ characterId: 'shaping-001' }).candidates[0].proposal_gate.eligible, false);
  assert.equal(roles.list({ characterId: 'shaping-001' }).length, 0);

  // A fresh event on the next logical day unlocks the proactive proposal gate.
  eventStore.push({
    event_id: 'evo-weather-next-day',
    type: 'weather.observation',
    layer: 'weather',
    character_id: 'shaping-001',
    occurred_at: '2026-09-30T09:00:00.000Z',
    observed_at: '2026-09-30T09:00:00.000Z',
    received_at: '2026-09-30T09:00:00.000Z',
    payload: { text: '第二天雨还在池塘边落着，湿地仍然很亮' },
  });
  currentTime = new Date('2026-09-30T12:00:00.000Z');
  const acrossDays = evolution.sync({ characterId: 'shaping-001' });
  assert.equal(acrossDays.materialized.filter((item) => item.created).length, 1);
  assert.equal(acrossDays.created.length, 1);
  const candidate = evolution.snapshot({ characterId: 'shaping-001' }).candidates[0];
  assert.ok(candidate.logical_days.includes('2026-09-29'));
  assert.ok(candidate.logical_days.includes('2026-09-30'));
  assert.equal(candidate.proposal_gate.eligible, true);
  assert.equal(roles.list({ characterId: 'shaping-001' }).length, 1);
  const second = evolution.sync({ characterId: 'shaping-001' });
  assert.equal(second.duplicate, true);
  assert.equal(roles.list({ characterId: 'shaping-001' }).length, 1);
  assert.equal(evolution.snapshot({ characterId: 'shaping-001' }).candidates[0].proposal_status, 'proposed');

  currentTime = new Date('2026-10-01T12:00:00.000Z');
  const decayed = evolution.sync({ characterId: 'shaping-001' });
  assert.equal(decayed.duplicate, false);
  assert.notEqual(decayed.run_id, acrossDays.run_id);
  assert.ok(decayed.pulls.find((item) => item.direction_id === 'wetland_frog').support_score
    < acrossDays.pulls.find((item) => item.direction_id === 'wetland_frog').support_score);
});

test('conflict evidence remains durable but cannot satisfy the two-day support gate', () => {
  currentTime = new Date('2026-09-29T12:00:00.000Z');
  const records = new Map();
  const persistence = {
    list: (namespace) => [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value)),
    put: (namespace, id, value) => records.set(`${namespace}:${id}`, structuredClone(value)),
    remove: (namespace, id) => records.delete(`${namespace}:${id}`),
  };
  const eventStore = [...events];
  const roles = createRoleProposalStore({ persistence, now: fixedNow });
  const evolution = createRoleEvolution({ now: fixedNow, inputStore: inputStoreFor(eventStore), roles, computeFantasyPull, persistence });
  evolution.sync({ characterId: 'shaping-001' });
  currentTime = new Date('2026-09-30T12:00:00.000Z');
  eventStore.push(normalizeChat({
    event_id: 'evo-dislike-next-day',
    message: '我不喜欢湿地，不想再去池塘',
    character_id: 'shaping-001',
    occurred_at: '2026-09-30T09:00:00.000Z',
  }));
  eventStore.at(-1).received_at = currentTime.toISOString();
  assert.equal(eventStore.at(-1).layer, 'interaction');
  assert.equal(eventStore.at(-1).source_kind, 'user');
  const afterConflict = evolution.sync({ characterId: 'shaping-001' });
  const candidate = evolution.snapshot({ characterId: 'shaping-001' }).candidates.find((item) => item.direction_id === 'wetland_frog');
  const conflict = evolution.snapshot({ characterId: 'shaping-001' }).evidence.find((item) => item.event_id === 'evo-dislike-next-day');
  assert.equal(afterConflict.created.length, 0);
  assert.equal(candidate.proposal_gate.eligible, false);
  assert.deepEqual(candidate.logical_days, ['2026-09-29']);
  assert.equal(candidate.support_evidence_count, 3);
  assert.ok(candidate.conflict_evidence_ids.includes('evidence-evo-dislike-next-day'));
  assert.equal(conflict.polarity, 'conflict');
  assert.ok(conflict.conflict_weight > 0);
  assert.equal(roles.list({ characterId: 'shaping-001' }).length, 0);
});

test('malformed provenance IDs are ignored and valid source IDs are normalized', () => {
  const records = new Map();
  const persistence = {
    list: (namespace) => [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value)),
    put: (namespace, id, value) => records.set(`${namespace}:${id}`, structuredClone(value)),
    remove: (namespace, id) => records.delete(`${namespace}:${id}`),
  };
  const pull = {
    schema: 'deskbot.fantasy-pull.v0.4',
    direction_id: 'wetland_frog',
    label: '荷叶青蛙',
    life: '湿地生活',
    score: 0.4,
    support_score: 0.4,
    conflict_score: 0,
    fantasy_pull: 0.2,
    status: 'observing',
    evidence_ids: ['malformed-evidence'],
    support_evidence_ids: ['malformed-evidence'],
    conflict_evidence_ids: [],
    sources: ['weather'],
    evidence: [{
      evidence_id: 'malformed-evidence',
      event_id: 'evo-weather',
      source_event_ids: 'not-an-array',
      cues: ['湿地'],
      support_cues: ['湿地'],
      conflict_cues: [],
      neutral_cues: [],
      polarity: 'support',
      support_weight: 1,
      conflict_weight: 0,
      source: 'weather',
    }],
  };
  const roles = createRoleProposalStore({ persistence, now: fixedNow });
  const evolution = createRoleEvolution({
    now: fixedNow,
    inputStore: inputStoreFor(events),
    roles,
    computeFantasyPull: () => [pull],
    persistence,
  });

  assert.doesNotThrow(() => evolution.sync());
  const evidence = evolution.snapshot().evidence.find((item) => item.evidence_id === 'malformed-evidence');
  assert.deepEqual(evidence.source_event_ids, []);
});

test('assistant, transport, and non-chat observations do not consume trial turns', () => {
  const roles = createRoleProposalStore({ now: fixedNow });
  const proposal = roles.propose({ status: 'candidate', direction_id: 'wetland_frog', label: '荷叶青蛙', life: '湿地生活', fantasy_pull: 0.8, evidence_ids: ['a', 'b', 'c'] }, { characterId: 'shaping-001', proposalId: 'manual-proposal' });
  roles.choose(proposal.proposal_id, 'try');
  roles.startTrial(proposal.proposal_id, { windowTurns: 3 });
  const store = inputStoreFor([
    { event_id: 'assistant', type: 'conversation.reply', layer: 'interaction', character_id: 'shaping-001', payload: { role: 'assistant', text: '雨' } },
    { event_id: 'transport', type: 'voice.asr.final', layer: 'transport', character_id: 'shaping-001', payload: { text: '池塘' } },
    ...events,
  ]);
  const evolution = createRoleEvolution({ now: fixedNow, inputStore: store, roles, computeFantasyPull });
  const ignored = evolution.observeEvent({ event_id: 'assistant', type: 'conversation.reply', layer: 'interaction', character_id: 'shaping-001', payload: { role: 'assistant' } });
  assert.equal(ignored.ignored, true);
  const weather = evolution.observeEvent(events[0]);
  assert.deepEqual(weather.trials, []);
  assert.equal(roles.get(proposal.proposal_id).trial.turns_observed, 0);

  const userChat = {
    event_id: 'user-chat-001',
    type: 'conversation.input',
    layer: 'dialogue',
    character_id: 'shaping-001',
    occurred_at: '2026-09-29T11:30:00.000Z',
    payload: { role: 'user', text: '雨停了，我还是想去池塘边看看。' },
  };
  const observed = evolution.observeEvent(userChat);
  assert.equal(observed.trials[0].turns_observed, 1);
  const duplicate = evolution.observeEvent(userChat);
  assert.equal(duplicate.trials[0].turns_observed, 1);
});

test('candidate and run ledgers survive recreation', () => {
  currentTime = new Date('2026-09-29T12:00:00.000Z');
  const records = new Map();
  const persistence = {
    list: (namespace) => [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value)),
    put: (namespace, id, value) => records.set(`${namespace}:${id}`, structuredClone(value)),
    remove: (namespace, id) => records.delete(`${namespace}:${id}`),
  };
  const roles1 = createRoleProposalStore({ persistence, now: fixedNow });
  const first = createRoleEvolution({ now: fixedNow, inputStore: inputStoreFor(events), roles: roles1, computeFantasyPull, persistence });
  first.sync();
  const roles2 = createRoleProposalStore({ persistence, now: fixedNow });
  const second = createRoleEvolution({ now: fixedNow, inputStore: inputStoreFor(events), roles: roles2, computeFantasyPull, persistence });
  assert.equal(second.snapshot().candidates.length, 1);
  assert.equal(second.snapshot().runs.length, 1);
  assert.equal(second.sync().duplicate, true);
});

test('evidence beyond the 30-day window expires and leaves no active candidate', () => {
  currentTime = new Date('2026-09-29T12:00:00.000Z');
  const records = new Map();
  const persistence = {
    list: (namespace) => [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value)),
    put: (namespace, id, value) => records.set(`${namespace}:${id}`, structuredClone(value)),
    remove: (namespace, id) => records.delete(`${namespace}:${id}`),
  };
  const roles = createRoleProposalStore({ persistence, now: fixedNow });
  const evolution = createRoleEvolution({ now: fixedNow, inputStore: inputStoreFor(events), roles, computeFantasyPull, persistence });
  evolution.sync();
  assert.equal(evolution.snapshot().candidates.find((item) => item.direction_id === 'wetland_frog').status, 'candidate');

  currentTime = new Date('2026-10-31T12:00:00.000Z');
  const expiredRun = evolution.sync();
  const snapshot = evolution.snapshot();
  assert.equal(expiredRun.duplicate, false);
  assert.equal(snapshot.evidence.every((item) => item.status === 'expired'), true);
  const candidate = snapshot.candidates.find((item) => item.direction_id === 'wetland_frog');
  assert.equal(candidate.status, 'stale');
  assert.equal(candidate.stale_reason, 'support_evidence_expired');
  assert.equal(candidate.proposal_gate.eligible, false);
});

test('future-dated unreceived observations cannot enter the evidence window', () => {
  currentTime = new Date('2026-09-29T12:00:00.000Z');
  const futureEvent = {
    event_id: 'future-weather',
    type: 'weather.observation',
    source: 'weather',
    source_kind: 'external_provider',
    layer: 'weather',
    character_id: 'shaping-001',
    occurred_at: '2026-10-01T09:00:00.000Z',
    observed_at: '2026-10-01T09:00:00.000Z',
    payload: { text: '未来的雨落在池塘边，湿地有荷叶' },
  };
  const roles = createRoleProposalStore({ now: fixedNow });
  const evolution = createRoleEvolution({
    now: fixedNow,
    inputStore: inputStoreFor([futureEvent]),
    roles,
    computeFantasyPull,
  });
  evolution.sync();
  assert.equal(evolution.snapshot().evidence.length, 0);
  assert.equal(evolution.snapshot().candidates.length, 0);
});
