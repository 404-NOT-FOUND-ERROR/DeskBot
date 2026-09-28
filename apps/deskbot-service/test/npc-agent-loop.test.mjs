import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createNpcAgentLoop, MAX_DECISIONS } from '../src/npc-agent-loop.mjs';

function worldAt({ locationId = 'desk', revision = 3 } = {}) {
  return {
    world_revision: revision,
    logical_time: { day: 1, minute_of_day: 480 },
    locations: [
      { location_id: 'desk', neighbors: ['road'] },
      { location_id: 'road', neighbors: ['desk', 'market'] },
      { location_id: 'market', neighbors: ['road'] },
    ],
    npcs: [{ npc_id: 'npc-1', location_id: locationId, status: '在观察' }],
  };
}

function memoryPersistence(records = []) {
  const values = new Map(records.map((record) => [record.decision_id, structuredClone(record)]));
  const removed = [];
  return {
    list() { return [...values.values()].map((value) => structuredClone(value)); },
    put(_namespace, id, value) { values.set(id, structuredClone(value)); },
    remove(_namespace, id) { removed.push(id); return values.delete(id); },
    removed,
  };
}

const profile = { npc_id: 'npc-1', legal_actions: ['move_to_adjacent_location', 'observe_current_location'] };
const routine = { route: ['road', 'market'], purpose: '沿着旧路巡看' };

test('agent chooses an authored adjacent route and persists one decision per logical slot', () => {
  let current = worldAt();
  const persistence = memoryPersistence();
  const loop = createNpcAgentLoop({ worldSnapshot: () => current, persistence, profiles: { 'npc-1': profile }, routines: { 'npc-1': routine } });

  const first = loop.decide({ world: current, npc: current.npcs[0] });
  assert.equal(first.selected.action_name, 'move_to_adjacent_location');
  assert.equal(first.selected.location_id, 'road');
  assert.equal(first.status, 'planned');

  current = worldAt({ locationId: 'road', revision: 4 });
  const repeated = loop.decide({ world: current, npc: current.npcs[0] });
  assert.equal(repeated.decision_id, first.decision_id);
  assert.equal(loop.list().length, 1);
});

test('invalid provider output falls back to a legal deterministic candidate', () => {
  const current = worldAt();
  const loop = createNpcAgentLoop({
    worldSnapshot: () => current,
    profiles: { 'npc-1': profile },
    routines: { 'npc-1': routine },
    decisionProvider: () => ({ candidate_id: 'teleport:anywhere' }),
  });
  const decision = loop.decide({ world: current, npc: current.npcs[0] });
  assert.equal(decision.selected.location_id, 'road');
  assert.ok(decision.legal_candidates.every((candidate) => candidate.location_id === undefined || ['desk', 'road'].includes(candidate.location_id)));
});

test('reloading the persistence namespace restores the planned decision', () => {
  const current = worldAt();
  const persistence = memoryPersistence();
  const first = createNpcAgentLoop({ persistence, worldSnapshot: () => current, profiles: { 'npc-1': profile }, routines: { 'npc-1': routine } });
  const planned = first.decide({ world: current, npc: current.npcs[0] });
  const restarted = createNpcAgentLoop({ persistence, worldSnapshot: () => current, profiles: { 'npc-1': profile }, routines: { 'npc-1': routine } });
  assert.deepEqual(restarted.decide({ world: current, npc: current.npcs[0] }), planned);
});

test('agent never proposes a non-adjacent destination', () => {
  const current = worldAt();
  const loop = createNpcAgentLoop({
    worldSnapshot: () => current,
    profiles: { 'npc-1': { ...profile, legal_actions: ['move_to_adjacent_location'] } },
    routines: { 'npc-1': { route: ['market'], purpose: '远处看看' } },
  });
  const decision = loop.decide({ world: current, npc: current.npcs[0] });
  assert.equal(decision.selected.location_id, 'road');
  assert.ok(decision.legal_candidates.every((candidate) => candidate.location_id !== 'market'));
});

test('autonomous exploration is stable and remains on an adjacent edge', () => {
  let selected = null;
  for (let minute = 0; minute < 1440 && !selected; minute += 120) {
    const current = { ...worldAt(), logical_time: { day: 1, minute_of_day: minute } };
    const options = { worldSnapshot: () => current, profiles: { 'npc-1': profile }, routines: { 'npc-1': { route: ['desk'], purpose: '在附近闲逛' } } };
    const first = createNpcAgentLoop(options).decide({ world: current, npc: current.npcs[0] });
    const second = createNpcAgentLoop(options).decide({ world: current, npc: current.npcs[0] });
    if (first.selection_mode === 'autonomous_exploration') {
      selected = first;
      assert.deepEqual(second.selected, first.selected);
      assert.equal(first.selected.location_id, 'road');
    }
  }
  assert.ok(selected, 'a deterministic autonomy pulse should occur within one day');
});

test('decision journal pruning removes old records from persistence', () => {
  const records = Array.from({ length: MAX_DECISIONS + 5 }, (_, index) => ({
    decision_id: `npc-agent:old:${index}`,
    npc_id: 'npc-1',
    slot_key: `1:${index}`,
    status: 'executed',
  }));
  const persistence = memoryPersistence(records);
  const loop = createNpcAgentLoop({ persistence, worldSnapshot: () => worldAt() });
  assert.equal(loop.list().length, MAX_DECISIONS);
  assert.equal(persistence.list().length, MAX_DECISIONS);
  assert.equal(persistence.removed.length, 5);
});
