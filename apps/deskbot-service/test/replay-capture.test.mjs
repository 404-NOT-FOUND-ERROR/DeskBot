import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createDeskBotServer } from '../src/app.mjs';
import { createCanonicalReplayCapture, exportCanonicalReplayCapture, replayCanonicalCapture, replayServiceCapture, replayFileDigest } from '../src/replay-capture.mjs';
import { installResidentLife } from '../src/resident-life.mjs';
import { installLivedMemory } from '../src/lived-memory.mjs';
import { createSlowCognitionWorker } from '../src/slow-cognition.mjs';
import { installLivingResources, installCommunitySupply } from '../src/living-resources.mjs';
import { parseReplayCaptureArgs } from '../../../scripts/replay-capture.mjs';

const OWNER = 'shaping-001', BASE = Date.parse('2026-10-05T04:00:00.000Z');
const CODE = 'test-controlled-rule-graph';

function fixture(t, { seeded = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-capture-')), databasePath = join(dir, 'source.sqlite'), directory = join(dir, 'archive');
  let time = BASE, persistence = createSqlitePersistence({ filename: databasePath }), world, replayCapture;
  const now = () => new Date(time);
  if (seeded) {
    const seedWorld = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    const seed = seedWorld.get();
    // Explicit authored initial conditions; no fictional completed task or
    // reflection is injected. Everything after capture uses real rules.
    installResidentLife(seed, now().toISOString()); installLivedMemory(seed, now().toISOString(), { plannerEnabled: true });
    installLivingResources(seed, now().toISOString()); installCommunitySupply(seed, now().toISOString());
    seed.protagonist.location_id = 'moss-sprout-garden';
    seed.living.objects['garden-bed'].health = .5;
    for (const actor of Object.values(seed.autonomy.actors)) actor.paused = actor.actor_id !== OWNER;
    persistence.put('canonical-world.states', seed.world_id, seed);
  }
  const reopen = () => {
    replayCapture?.close?.();
    replayCapture = createCanonicalReplayCapture({ persistence, directory, now, codeFingerprint: CODE });
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime',
      replayCapture });
  };
  reopen();
  t.after(() => { replayCapture?.close?.(); persistence.close(); rmSync(dir, { recursive: true, force: true }); });
  return {
    dir, directory, databasePath, now, get world() { return world; }, get persistence() { return persistence; },
    get capture() { return replayCapture; },
    restart() { persistence.close(); persistence = createSqlitePersistence({ filename: databasePath }); reopen(); },
    advance(ms) { time += ms; world.syncWallClock(); world.syncTasks(); },
    setAt(at) { time = Date.parse(at); world.syncWallClock(); world.syncTasks(); },
    mutate(action, payload = {}, adapter = {}) {
      return world.ingest({ event_id: `capture-test:${action}:${time}`, type: 'world.mutation', source: 'capture-test', character_id: OWNER,
        occurred_at: now().toISOString(), payload: { action, ...payload } }, adapter);
    },
    export() { return exportCanonicalReplayCapture({ databasePath, directory, codeFingerprint: CODE }); },
    replay(name, more = {}) { return replayCanonicalCapture({ directory, targetDatabase: join(dir, `${name}.sqlite`), codeFingerprint: CODE, ...more }); },
  };
}

test('opt-in capture survives source restart and fresh/restarted replay executes exact actual task and autonomous cadence output', async t => {
  const h = fixture(t, { seeded: true });
  h.mutate('advance_autonomous_life', { reserved_actors: [] });
  const task = h.world.get().tasks.find(item => item.actor_id === OWNER && item.status === 'running');
  assert.ok(task, 'actual activity task should start');
  h.setAt(task.due_at);
  assert.equal(h.world.get().tasks.find(item => item.task_id === task.task_id).status, 'completed');
  assert.ok(h.world.get().memory.episodes.length, 'actual settled task must create a memory fact');
  let providerCalls = 0;
  const provider = { id: 'capture-fixture-v1', complete: async ({ prompt, purpose }) => {
    providerCalls++;
    assert.equal(purpose, 'slow_cognition');
    const context = JSON.parse(prompt.split('\n').at(-1));
    const fact = context.memories[0];
    return { model: 'capture-fixture-v1', text: JSON.stringify({
      insights: [{ text: '刚才那件小事让我想再看看。', topic: fact.topic, feeling: 'curious', source_ids: [fact.id] }],
      goals: [], relations: [],
    }) };
  } };
  await createSlowCognitionWorker({ world: h.world, now: h.now, llm: provider, maxPerTick: 1 }).tick();
  assert.equal(providerCalls, 1);
  h.restart();
  await createSlowCognitionWorker({ world: h.world, now: h.now, llm: { id: 'must-not-call', complete: async () => { throw Error('provider_recalled'); } }, maxPerTick: 1 }).tick();
  h.advance(2 * 60_000);
  const snapshot = h.world.get(), summary = h.export();
  assert.ok(summary.operation_count >= 4);
  const tape = JSON.parse(readFileSync(join(h.directory, 'capture.json'), 'utf8'));
  assert.ok(tape.operations.some(operation => operation.event.payload.action === 'advance_task'));
  assert.ok(tape.operations.some(operation => operation.event.payload.action === 'advance_living_world'));
  const reflection = tape.operations.find(operation => operation.event.payload.action === 'resolve_slow_cognition');
  assert.equal(reflection.model_result.model, 'capture-fixture-v1');
  const fresh = h.replay('fresh'), restarted = h.replay('restarted', { restartAt: Math.floor(summary.operation_count / 2) });
  assert.equal(fresh.world_revision, snapshot.world_revision); assert.equal(fresh.world_hash, restarted.world_hash);
  assert.equal(fresh.verified, true); assert.equal(fresh.provider_calls, 0); assert.equal(fresh.coverage, 'canonical_world_only');
  assert.deepEqual(h.world.get(), snapshot, 'export/replay never mutate source canonical state');
});

test('capture is absent by default and freezes one receipt timestamp per canonical operation', t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-capture-disabled-')), filename = join(dir, 'source.sqlite');
  const persistence = createSqlitePersistence({ filename });
  t.after(() => { persistence.close(); rmSync(dir, { recursive: true, force: true }); });
  let time = BASE;
  const world = createPersistentWorld({ persistence, now: () => new Date(time++) });
  const result = world.ingest({ event_id: 'clock-edge', type: 'conversation.input', source: 'user', character_id: OWNER,
    occurred_at: new Date(BASE).toISOString(), payload: { text: '你好', role: 'user' } });
  assert.equal(result.world.updated_at, result.mutation.committed_at);
  assert.equal(result.mutation.time.committed_at, result.mutation.committed_at);
  assert.deepEqual(persistence.list('replay.capture-sessions'), []);
  assert.deepEqual(persistence.list('replay.capture-operations'), []);
});

test('operation journaling shares the canonical transaction and rolls back on capture failure', t => {
  const h = fixture(t), original = h.world.get();
  h.capture.close();
  const recorder = createCanonicalReplayCapture({ persistence: h.persistence, directory: h.directory, now: h.now, codeFingerprint: CODE });
  const world = createPersistentWorld({ persistence: h.persistence, now: h.now, timeMode: 'realtime', replayCapture: {
    initialize: value => recorder.initialize(value),
    recordCommit(value) { recorder.recordCommit(value); throw Error('simulated_capture_commit_failure'); },
  } });
  const before = h.persistence.list('replay.capture-operations');
  assert.throws(() => world.ingest({ event_id: 'transaction-fail', type: 'conversation.input', source: 'user', character_id: OWNER,
    occurred_at: h.now().toISOString(), payload: { text: '未提交', role: 'user' } }), /simulated_capture_commit_failure/);
  assert.deepEqual(h.persistence.list('replay.capture-operations'), before);
  assert.equal(h.persistence.get('canonical-world.mutations', 'mutation-transaction-fail'), null);
  assert.deepEqual(h.persistence.get('canonical-world.states', original.world_id), original);
  assert.deepEqual(world.get(), original);
});

test('tampered operation, changed rule graph, seed damage and existing target fail closed', t => {
  const h = fixture(t);
  h.world.ingest({ event_id: 'capture-content', type: 'conversation.input', source: 'user', character_id: OWNER,
    occurred_at: h.now().toISOString(), payload: { text: '一条本地捕获内容', role: 'user' } });
  h.export();
  const manifest = join(h.directory, 'capture.json'), original = readFileSync(manifest, 'utf8');
  const tape = JSON.parse(original); tape.operations[0].adapter.maintenanceInternal = true;
  writeFileSync(manifest, JSON.stringify(tape));
  assert.throws(() => h.replay('bad'), /replay_capture_operation_corrupt/);
  assert.equal(existsSync(join(h.dir, 'bad.sqlite')), false);
  writeFileSync(manifest, original);
  assert.throws(() => h.replay('changed', { codeFingerprint: 'changed-rules' }), /replay_capture_code_mismatch/);
  assert.throws(() => h.replay('source', { targetDatabase: h.databasePath }), /replay_target_must_be_new/);
  const seed = join(h.directory, 'seed.sqlite'), seedHash = replayFileDigest(seed);
  writeFileSync(seed, 'damaged-seed');
  assert.notEqual(replayFileDigest(seed), seedHash);
  assert.throws(() => h.replay('damaged'), /replay_capture_seed_mismatch/);
});

test('a capture disabled between restarts detects the unrecorded world gap', t => {
  const h = fixture(t);
  const unrecorded = createPersistentWorld({ persistence: h.persistence, now: h.now, timeMode: 'realtime' });
  unrecorded.ingest({ event_id: 'unrecorded-user-input', type: 'conversation.input', source: 'user', character_id: OWNER,
    occurred_at: h.now().toISOString(), payload: { text: '这次没开捕获', role: 'user' } });
  assert.throws(() => h.export(), /replay_capture_gap_detected/);
  h.capture.close();
  assert.throws(() => createPersistentWorld({ persistence: h.persistence, now: h.now, timeMode: 'realtime',
    replayCapture: createCanonicalReplayCapture({ persistence: h.persistence, directory: h.directory, now: h.now, codeFingerprint: CODE }) }), /replay_capture_gap_detected/);
});

test('local CLI requires explicit archive and source export/new replay target; importing makes no calls', () => {
  assert.throws(() => parseReplayCaptureArgs(['replay', '--archive', 'x']), /replay_requires_new_target_only/);
  assert.throws(() => parseReplayCaptureArgs(['export', '--archive', 'x', '--database', 'source', '--target', 'bad']), /export_requires_database_only/);
  assert.throws(() => parseReplayCaptureArgs(['replay', '--archive', 'x', '--target', 'fresh', '--restart-at', '1.5']), /invalid_restart_at/);
  assert.equal(parseReplayCaptureArgs(['replay', '--archive', 'x', '--target', 'fresh', '--restart-at', '2']).restartAt, 2);
});

test('service replay seam replays non-canonical ingress through original handlers and checks namespace digests', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-service-capture-')), source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  let time = BASE, persistence = createSqlitePersistence({ filename: source });
  const now = () => new Date(time);
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture: capture });
  const fake = { id: 'replay-service-fake', status: () => ({ configured: false }), complete: async () => { throw Error('provider_must_not_call'); } };
  const server = createDeskBotServer({ now, persistence, persistentWorld: world, llm: fake, websocket: false,
    worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false,
    replayCapture: capture });
  t.after(() => { try { server.close(); } catch {} persistence.close(); rmSync(dir, { recursive: true, force: true }); });
  const event = { event_id: 'service-capture-input', type: 'conversation.input', source: 'service-test', character_id: OWNER,
    occurred_at: now().toISOString(), payload: { role: 'user', text: '把这一刻留在小镇的记录里。' } };
  const first = server.ingestNonChatEvent(event);
  assert.equal(first.duplicate, false);
  time += 60_000;
  const second = server.ingestNonChatEvent({ ...event, event_id: 'service-capture-input-next', occurred_at: now().toISOString(),
    payload: { role: 'user', text: '又过了一小会儿。' } });
  assert.equal(second.duplicate, false);
  time += 60_000;
  assert.equal(server.ingestNonChatEvent(event).duplicate, true);
  const ingressJournals = persistence.list('replay.capture-journal');
  assert.ok(ingressJournals.some(journal => journal.operation_id === 'ingress:service-capture-input'));
  assert.ok(ingressJournals.some(journal => journal.operation_id === 'ingress:service-capture-input-next'));
  const exported = exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
  assert.equal(exported.coverage, 'canonical_world_with_service_ingress');
  const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
  assert.deepEqual(tape.ingresses.map(item => item.index), [0, 1, 2]);
  assert.deepEqual(tape.ingresses.map(item => item.duplicate), [false, false, true]);
  const runtimeFactory = ({ persistence: targetPersistence, now: targetNow }) => {
    const targetWorld = createPersistentWorld({ persistence: targetPersistence, now: targetNow, timeMode: 'realtime', syncClockOnCreate: false });
    const target = createDeskBotServer({ now: targetNow, persistence: targetPersistence, persistentWorld: targetWorld, llm: fake,
      websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false });
    return { ingestNonChatEvent: target.ingestNonChatEvent, persistentWorld: targetWorld,
      close: () => { try { target.close(); } catch {} targetPersistence.close(); } };
  };
  const replayed = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'service-replayed.sqlite'),
    runtimeFactory, codeFingerprint: CODE });
  assert.equal(replayed.verified, true);
  assert.equal(replayed.coverage, 'service_ingress_namespaces_verified');
  assert.equal(replayed.provider_calls, 0);
  const restarted = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'service-restarted.sqlite'),
    runtimeFactory, restartAt: 1, codeFingerprint: CODE });
  assert.deepEqual(restarted.namespace_digests, replayed.namespace_digests);
  const original = readFileSync(join(archive, 'capture.json'), 'utf8');
  tape.ingresses[0].adapter.maintenanceInternal = true;
  writeFileSync(join(archive, 'capture.json'), JSON.stringify(tape));
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'service-tampered.sqlite'),
    runtimeFactory, codeFingerprint: CODE }), /replay_capture_ingress_corrupt/);
  assert.equal(existsSync(join(dir, 'service-tampered.sqlite')), false);
  writeFileSync(join(archive, 'capture.json'), original);
  persistence.put('uncaptured-service-writer', 'unrecorded', { operation: 'not-in-ingress' });
  exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'service-gap.sqlite'),
    runtimeFactory, codeFingerprint: CODE }), error => error.code === 'replay_service_namespace_mismatch'
      && error.namespaces.includes('uncaptured-service-writer'));
});
