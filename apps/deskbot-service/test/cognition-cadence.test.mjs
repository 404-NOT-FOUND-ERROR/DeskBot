import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CADENCE_MAIN_MAX_IDLE_MS,
  CADENCE_MIN_INTERVAL_MS,
  ensureCognitionCadence,
  evaluateCognitionCadence,
  recordCognitionCadence,
} from '../src/cognition-cadence.mjs';

const BASE = '2026-10-11T00:00:00.000Z';
const at = minutes => new Date(Date.parse(BASE) + minutes * 60000).toISOString();
function world({ planner = true, energy = .78, appetite = .35 } = {}) {
  return {
    protagonist: { character_id: 'shaping-001', location_id: 'moss-sprout-garden' },
    npcs: [{ npc_id: 'pathfinder-001', location_id: 'fog-lamp-square' }],
    memory: { planner: { enabled: planner }, episodes: [], refraction: undefined },
    autonomy: { actors: {
      'shaping-001': { actor_id: 'shaping-001', energy, appetite },
      'pathfinder-001': { actor_id: 'pathfinder-001', energy: .8, appetite: .3 },
    }, recent: [] },
    tasks: [],
    refraction: { records: [] },
    social: { commitments: [] },
  };
}
const choices = (sourceIds = []) => [
  { goal: 'interest:grove', score: 30, available: true, source_ids: sourceIds },
  { goal: 'interest:water', score: 28, available: true, source_ids: [] },
];

test('cold start admits one cognition request and records a stable decision', () => {
  const w = world(); const state = w.autonomy.actors['shaping-001'];
  const result = evaluateCognitionCadence(w, state, choices(), BASE);
  assert.equal(result.admit, true); assert.equal(result.reason, 'cold_start');
  recordCognitionCadence(w, state, BASE, result);
  const record = w.memory.cognition_cadence.actors['shaping-001'];
  assert.equal(record.last_decision_at, BASE); assert.equal(record.decision_count, 1);
  assert.match(record.last_stable_key, /^cadence:/);
});

test('the minimum interval suppresses duplicate wakeups, while max idle later admits again', () => {
  const w = world(); const state = w.autonomy.actors['shaping-001'];
  const first = evaluateCognitionCadence(w, state, choices(), BASE); recordCognitionCadence(w, state, BASE, first);
  const tooSoonAt = at(CADENCE_MIN_INTERVAL_MS / 60000 - 1);
  state.energy = .6;
  const tooSoon = evaluateCognitionCadence(w, state, choices(), tooSoonAt);
  assert.equal(tooSoon.admit, false); assert.equal(tooSoon.reason, 'cooldown');
  state.energy = .78;
  const laterAt = at(CADENCE_MAIN_MAX_IDLE_MS / 60000 + 1);
  const later = evaluateCognitionCadence(w, state, choices(), laterAt);
  assert.equal(later.admit, true); assert.equal(later.reason, 'max_idle');
});

test('need, canonical pressure, and canonical feedback are separate structured triggers', () => {
  const needWorld = world({ energy: .6 });
  let result = evaluateCognitionCadence(needWorld, needWorld.autonomy.actors['shaping-001'], choices(), BASE);
  assert.equal(result.reason, 'cold_start'); // cold start has precedence
  recordCognitionCadence(needWorld, needWorld.autonomy.actors['shaping-001'], BASE, result);
  result = evaluateCognitionCadence(needWorld, needWorld.autonomy.actors['shaping-001'], choices(), at(121));
  assert.equal(result.reason, 'need');

  const pressureWorld = world();
  const pState = pressureWorld.autonomy.actors['shaping-001'];
  let p = evaluateCognitionCadence(pressureWorld, pState, choices(), BASE); recordCognitionCadence(pressureWorld, pState, BASE, p);
  pressureWorld.refraction.records.push({ id: 'weather-1', category: 'weather', attested: true, status: 'observed', expires_at: at(300) });
  const pressureChoices = choices(['weather-1']); pressureChoices[0].score = 42;
  p = evaluateCognitionCadence(pressureWorld, pState, pressureChoices, at(121));
  assert.equal(p.reason, 'pressure'); assert.deepEqual(p.pressure.ids, ['weather-1']);

  const feedbackWorld = world(); const fState = feedbackWorld.autonomy.actors['shaping-001'];
  let f = evaluateCognitionCadence(feedbackWorld, fState, choices(), BASE); recordCognitionCadence(feedbackWorld, fState, BASE, f);
  feedbackWorld.autonomy.recent.push({ actor_id: 'shaping-001', kind: 'completed', at: at(60), task_id: 'task-1' });
  f = evaluateCognitionCadence(feedbackWorld, fState, choices(), at(121));
  assert.equal(f.reason, 'feedback'); assert.equal(f.feedback.id, 'task-1');
});

test('low-quality or non-canonical input cannot wake cadence, and recording is idempotent', () => {
  const w = world(); const state = w.autonomy.actors['shaping-001'];
  let result = evaluateCognitionCadence(w, state, choices(), BASE); recordCognitionCadence(w, state, BASE, result);
  w.refraction.records.push({ id: 'assistant-fiction', category: 'agent', attested: false, status: 'observed', expires_at: at(300) });
  result = evaluateCognitionCadence(w, state, choices(['assistant-fiction']), at(121));
  assert.equal(result.reason, 'idle_window');
  recordCognitionCadence(w, state, at(121), result);
  const recorded = structuredClone(w.memory.cognition_cadence);
  recordCognitionCadence(w, state, at(121), result);
  assert.deepEqual(w.memory.cognition_cadence, recorded);
});

test('slow-cognition feelings wake only once when grounded in new canonical facts', () => {
  const w = world(); const state = w.autonomy.actors['shaping-001'];
  let result = evaluateCognitionCadence(w, state, choices(), BASE); recordCognitionCadence(w, state, BASE, result);
  w.memory.episodes.push({ id: 'fact-1', kind: 'world_fact', model_safe: true });
  w.memory.maintenance = { actors: { 'shaping-001': { feelings: [{ feeling: 'hopeful', text: '还想再试试', at: at(60), source_ids: ['fact-1'] }] } } };
  result = evaluateCognitionCadence(w, state, choices(), at(121));
  assert.equal(result.admit, true); assert.equal(result.reason, 'emotional_salience');
  recordCognitionCadence(w, state, at(121), result);
  result = evaluateCognitionCadence(w, state, choices(), at(242));
  assert.notEqual(result.reason, 'emotional_salience');
});

test('disabled planner and one-candidate life fall back without creating a cognition request', () => {
  const disabled = world({ planner: false });
  let result = evaluateCognitionCadence(disabled, disabled.autonomy.actors['shaping-001'], choices(), BASE);
  assert.equal(result.admit, false); assert.equal(result.reason, 'planner_disabled');
  const one = world(); result = evaluateCognitionCadence(one, one.autonomy.actors['shaping-001'], [{ goal: 'rest', score: 100, available: true }], BASE);
  assert.equal(result.admit, false); assert.equal(result.reason, 'no_candidates');
});

test('cadence state survives a world snapshot round trip as ordinary memory data', () => {
  const w = world(); const state = w.autonomy.actors['shaping-001'];
  const decision = evaluateCognitionCadence(w, state, choices(), BASE); recordCognitionCadence(w, state, BASE, decision);
  const restored = structuredClone(w);
  assert.deepEqual(restored.memory.cognition_cadence, w.memory.cognition_cadence);
  assert.equal(restored.memory.cognition_cadence.schema, 'deskbot.cognition-cadence.v1');
});
