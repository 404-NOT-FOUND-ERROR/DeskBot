import test from 'node:test';
import assert from 'node:assert/strict';
import { goalPayload } from '../../deskbot-web/public/npc-goal-editor.js';
test('NPC editor maps ordered alternatives and optional travel to backend contract', () => {
  const rows = [ { kind: 'event_present', value: ' event-1 ', action_name: ' inspect ', status: ' scouting ', location_id: ' tidal-old-road ' }, { kind: 'npc_status', value: 'waiting', action_name: 'rest', status: 'resting', location_id: '' } ];
  const result = goalPayload('npc-1', ' explore ', rows, 'goal-1');
  assert.equal(result.purpose, 'explore');
  assert.deepEqual(result.options[0], { when: { kind: 'event_present', value: 'event-1' }, action_name: 'inspect', status: 'scouting', location_id: 'tidal-old-road' });
  assert.equal(Object.hasOwn(result.options[1], 'location_id'), false);
  assert.equal(result.options[1].when.kind, 'npc_status');
  assert.throws(() => goalPayload('', 'x', rows, 'x'));
  assert.throws(() => goalPayload('npc', 'x', [], 'x'));
  assert.throws(() => goalPayload('npc', 'x', Array(6).fill(rows[0]), 'x'));
  assert.throws(() => goalPayload('npc', 'x', [{ ...rows[0], value: ' ' }], 'x'));
});
