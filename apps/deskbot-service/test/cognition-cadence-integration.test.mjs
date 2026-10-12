import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createWorldLife } from '../src/world-life.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';
import { createLifeChoiceWorker } from '../src/life-choice.mjs';
import { ensureCognitionCadence, recordCognitionCadence } from '../src/cognition-cadence.mjs';

const OWN = 'shaping-001';
const M = 60000;
const BASE = Date.parse('2026-10-05T04:00:00.000Z');

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-cadence-'));
  const file = join(dir, 'world.sqlite');
  let persistence = createSqlitePersistence({ filename: file });
  let time = BASE, world, loop;
  const now = () => new Date(time);
  const reload = () => {
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    loop = createAutonomousLife({ world, now, enabled: true });
  };
  reload();
  createWorldLife({ worldSnapshot: () => world.get(), ingest: event => world.ingest(event), now, enabled: true }).seedNpcs();
  const initial = world.get(); installAutonomy(initial, now().toISOString());
  for (const actor of Object.values(initial.autonomy.actors)) actor.paused = actor.actor_id !== OWN;
  initial.protagonist.location_id = 'moss-sprout-garden';
  initial.living.objects['garden-bed'].moisture = .6;
  initial.living.objects['garden-bed'].growth = .2;
  initial.living.objects['garden-bed'].health = .9;
  initial.living.objects['seedling-rack'].stock.trays = 2;
  persistence.put('canonical-world.states', initial.world_id, initial); reload();
  const h = {
    get world() { return world; }, get loop() { return loop; }, now,
    mutate(action, more = {}, id = `cadence-test:${action}:${time}`) {
      return world.ingest({ event_id: id, type: 'world.mutation', source: 'test-world',
        character_id: OWN, occurred_at: now().toISOString(), payload: { action, ...more } });
    },
    save(fn) { const w = world.get(); fn(w); persistence.put('canonical-world.states', w.world_id, w); reload(); },
    advance(ms) { time += ms; world.syncWallClock(); world.syncTasks(); },
    restart() { persistence.close(); persistence = createSqlitePersistence({ filename: file }); reload(); },
    worker(llm, more = {}) { return createLifeChoiceWorker({ world, llm, now, wake: id => loop.tick({ wakeId: id }), ...more }); },
  };
  h.mutate('install_lived_memory', { planner_enabled: true });
  t.after(() => { persistence.close(); rmSync(dir, { recursive: true, force: true }); });
  return h;
}
const state = w => w.autonomy.actors[OWN];
const request = w => w.memory.planner.requests[OWN];

test('a cadence skip runs a legal rule plan and task instead of stopping life', t => {
  const h = fixture(t);
  h.save(w => {
    ensureCognitionCadence(w, h.now().toISOString());
    recordCognitionCadence(w, state(w), h.now().toISOString(), { admit: true, reason: 'cold_start', stable_key: 'prior' });
  });
  h.advance(5 * M); h.loop.tick();
  const w = h.world.get();
  assert.equal(request(w), undefined);
  assert.equal(state(w).plan.decision.source, 'rules');
  assert.equal(state(w).plan.decision.cadence_reason, 'idle_window');
  assert.ok(w.tasks.some(task => task.actor_id === OWN && task.status === 'running'));
  assert.ok(w.living.objects['garden-bed'].moisture < .6);
});

test('active and user-paused canonical tasks are not reconsidered or billed by cadence', async t => {
  const h = fixture(t);
  h.mutate('start_activity', { kind: 'care', title: '原先就做着的观察', duration_seconds: 900, task_id: 'busy-observation' });
  h.save(w => { state(w).energy = .1; });
  h.loop.tick();
  assert.equal(request(h.world.get()), undefined);
  assert.equal(state(h.world.get()).plan, null);
  h.mutate('control_task', { task_id: 'busy-observation', operation: 'pause' });
  h.advance(10 * M); h.loop.tick();
  let calls = 0;
  await h.worker({ id: 'cadence-test', complete: async () => { calls++; } }).tick();
  assert.equal(calls, 0);
  assert.equal(h.world.get().tasks.find(task => task.task_id === 'busy-observation').status, 'paused');
  assert.equal(state(h.world.get()).plan, null);
});

test('cadence and pending request recover from SQLite without a second admission or bill', async t => {
  const h = fixture(t); h.loop.tick();
  const before = h.world.get();
  assert.equal(request(before).cadence.reason, 'cold_start');
  assert.equal(before.memory.cognition_cadence.actors[OWN].decision_count, 1);
  h.restart();
  assert.deepEqual(h.world.get().memory.cognition_cadence, before.memory.cognition_cadence);
  assert.deepEqual(h.loop.tick(), { enabled: true, duplicate: true });
  const r = request(h.world.get()); h.mutate('claim_life_choice', { actor_id: OWN, request_id: r.id });
  h.restart();
  let calls = 0;
  await h.worker({ id: 'cadence-test', complete: async () => { calls++; } }).tick();
  assert.equal(calls, 0); assert.equal(h.world.get().memory.planner.attempts.length, 1);
  assert.equal(request(h.world.get()).model_call.reject_reason, 'interrupted_request');
  assert.equal(h.world.get().memory.cognition_cadence.actors[OWN].decision_count, 1);
});

test('worker timeout gives one fallback; the late model reply cannot create an interpretation or mutation', async t => {
  const h = fixture(t); h.loop.tick();
  let release, calls = 0;
  const delayed = new Promise(resolve => { release = resolve; });
  const worker = h.worker({ id: 'cadence-test', complete: () => { calls++; return delayed; } }, { requestTimeoutMs: 10 });
  await worker.tick();
  assert.equal(calls, 1);
  const beforeLate = h.world.get();
  assert.equal(request(beforeLate).model_call.reject_reason, 'provider_timeout');
  assert.equal(state(beforeLate).plan.decision.source, 'fallback');
  assert.equal(beforeLate.memory.episodes.some(item => item.source.kind === 'model_choice'), false);
  const mutations = h.world.listMutations();
  release({ model: 'cadence-test', text: JSON.stringify({ goal: 'interest:backlit-grove', reason: '我想去林间', memory_ids: [] }) });
  await delayed; await Promise.resolve();
  assert.deepEqual(h.world.get(), beforeLate);
  assert.deepEqual(h.world.listMutations(), mutations);
});

test('model audit distinguishes provider success, contract parsing, and actual legal adoption', async t => {
  const h = fixture(t); h.loop.tick();
  await h.worker({ id: 'cadence-test', complete: async () => ({ model: 'cadence-test',
    text: JSON.stringify({ goal: 'interest:backlit-grove', reason: '我想去林间留一会儿', memory_ids: [] }) }) }).tick();
  const w = h.world.get(), r = request(w);
  assert.deepEqual(r.model_call, { provider_ok: true, parse_ok: true, adopted: true, reject_reason: null });
  assert.equal(r.runtime_trace.authority, 'audit_only');
  assert.deepEqual(r.runtime_trace.stages.map(stage => stage.stage), ['perception', 'decision']);
  assert.equal(r.runtime_trace.stages.some(stage => stage.stage === 'action'), false);
  assert.equal(w.protagonist.location_id, 'moss-sprout-garden'); // real travel has only begun
  assert.ok(w.tasks.some(task => task.actor_id === OWN && task.kind === 'travel' && task.status === 'running'));
});

test('successful transport with an invalid choice falls back and never counts as adopted', async t => {
  const h = fixture(t); h.loop.tick();
  await h.worker({ id: 'cadence-test', complete: async () => ({ model: 'cadence-test', text: JSON.stringify({ goal: 'teleport:moon', reason: '去月亮', memory_ids: [] }) }) }).tick();
  const r = request(h.world.get());
  assert.deepEqual(r.model_call, { provider_ok: true, parse_ok: false, adopted: false, reject_reason: 'invalid_choice' });
  assert.equal(state(h.world.get()).plan.decision.source, 'fallback');
});
