import assert from 'node:assert/strict';
import test from 'node:test';

import { computeFantasyPull } from '../src/fantasy-pull.mjs';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { createRoleEvolution } from '../src/role-evolution.mjs';

const fixedNow = () => new Date('2026-09-29T12:00:00.000Z');
const events = [
  { event_id: 'evo-weather', type: 'weather.observation', layer: 'weather', character_id: 'shaping-001', occurred_at: '2026-09-29T09:00:00.000Z', payload: { text: '雨一直落在池塘边，湿地今天很亮' } },
  { event_id: 'evo-profile', type: 'user.preference', layer: 'user_profile', character_id: 'shaping-001', occurred_at: '2026-09-29T10:00:00.000Z', payload: { value: '想去荷叶边散步' } },
  { event_id: 'evo-world', type: 'world.mutation', layer: 'world_line', character_id: 'shaping-001', occurred_at: '2026-09-29T11:00:00.000Z', payload: { summary: '湿地出现一片会发光的荷叶' } },
];

function inputStoreFor(list) {
  return { list: () => list.map((item) => structuredClone(item)) };
}

test('P4 role evolution materializes one durable proposal from a cross-source candidate', () => {
  const records = new Map();
  const persistence = {
    list: (namespace) => [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value)),
    put: (namespace, id, value) => records.set(`${namespace}:${id}`, structuredClone(value)),
    remove: (namespace, id) => records.delete(`${namespace}:${id}`),
  };
  const roles = createRoleProposalStore({ persistence, now: fixedNow });
  const evolution = createRoleEvolution({ now: fixedNow, inputStore: inputStoreFor(events), roles, computeFantasyPull, persistence });
  const first = evolution.sync({ characterId: 'shaping-001' });
  const pull = first.pulls.find((item) => item.direction_id === 'wetland_frog');
  assert.equal(pull.status, 'candidate');
  assert.equal(first.materialized.filter((item) => item.created).length, 1);
  assert.equal(roles.list({ characterId: 'shaping-001' }).length, 1);
  const second = evolution.sync({ characterId: 'shaping-001' });
  assert.equal(second.duplicate, true);
  assert.equal(roles.list({ characterId: 'shaping-001' }).length, 1);
  assert.equal(evolution.snapshot({ characterId: 'shaping-001' }).candidates[0].proposal_status, 'proposed');
});

test('assistant output and transport are ignored, and active trials receive neutral observations once', () => {
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
  const observed = evolution.observeEvent(events[0]);
  assert.equal(observed.trials[0].turns_observed, 1);
  const duplicate = evolution.observeEvent(events[0]);
  assert.equal(duplicate.trials[0].turns_observed, 1);
});

test('candidate and run ledgers survive recreation', () => {
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
