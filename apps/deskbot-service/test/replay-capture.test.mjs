import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    const targetWorld = createPersistentWorld({
      persistence: targetPersistence,
      now: targetNow,
      timeMode: 'realtime',
      syncClockOnCreate: false,
    });
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

test('HTTP chat is journaled as one operation without retaining message text', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-chat-capture-'));
  const databasePath = join(dir, 'source.sqlite');
  const archive = join(dir, 'archive');
  const persistence = createSqlitePersistence({ filename: databasePath, now: () => new Date(BASE) });
  const now = () => new Date(BASE);
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture: capture });
  const llm = {
    id: 'chat-journal-fake',
    status: () => ({ configured: false }),
    complete: async () => ({ provider: 'chat-journal-fake', model: 'fixture-v1', text: '喵呜。记下了。' }),
  };
  const server = createDeskBotServer({
    now,
    persistence,
    persistentWorld: world,
    replayCapture: capture,
    llm,
    websocket: false,
    worldLifeEnabled: false,
    autonomousLifeEnabled: false,
    residentLifeEnabled: false,
    livedMemoryEnabled: false,
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    capture.close();
    persistence.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const message = '这句正文只应该参与哈希，不应该落进操作封套。';
  const request = { event_id: 'chat-journal-001', correlation_id: 'chat-correlation-001', message };
  const first = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  });
  assert.equal(first.status, 202);
  const firstBody = await first.json();
  assert.equal(firstBody.duplicate, false);
  const journalsAfterFirst = persistence.list('replay.capture-journal');
  const chatJournals = journalsAfterFirst.filter(journal => journal.operation_id === 'chat:chat-journal-001');
  assert.ok(chatJournals.length >= 1);
  assert.ok(chatJournals.every(journal => journal.operation_kind === 'chat.request'));
  assert.ok(chatJournals.every(journal => journal.source === 'http.chat'));
  assert.ok(chatJournals.every(journal => /^[a-f0-9]{64}$/.test(journal.request_hash)));
  assert.ok(chatJournals.some(journal => journal.result_ref?.schema === 'deskbot.provider-result-ref.v1'));
  assert.ok(chatJournals.every(journal => !JSON.stringify(journal).includes(message)));

  const duplicate = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  });
  assert.equal(duplicate.status, 200);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.duplicate, true);
  assert.equal(persistence.list('replay.capture-journal').length, journalsAfterFirst.length);
});
test('original chat handler replays a captured LLM fixture with zero provider calls and restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-chat-replay-'));
  const source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  let time = BASE;
  const now = () => new Date(time);
  const persistence = createSqlitePersistence({ filename: source, now });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture: capture });
  let sourceProviderCalls = 0;
  const llm = {
    id: 'chat-replay-source',
    status: () => ({ configured: true, provider: 'chat-replay-source' }),
    complete: async () => {
      sourceProviderCalls++;
      return { provider: 'chat-replay-source', model: 'fixture-v1', text: '喵呜。小镇把这句话收好了。' };
    },
  };
  const server = createDeskBotServer({ now, persistence, persistentWorld: world, replayCapture: capture, llm,
    websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false,
    livedMemoryEnabled: false });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(async () => {
    try { await new Promise(resolve => server.close(() => resolve())); } catch {}
    capture.close(); persistence.close(); rmSync(dir, { recursive: true, force: true });
  });
  const request = { event_id: 'chat-replay-success-001', correlation_id: 'chat-replay-correlation-001', message: '把这句留在小镇里。' };
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).duplicate, false);
  assert.equal(sourceProviderCalls, 1);
  const duplicate = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  const summary = exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
  const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
  assert.ok(tape.chats.some(item => item.event_id === request.event_id));
  assert.ok(tape.providers.some(item => item.operation_id === `chat:${request.event_id}` && item.kind === 'llm'));
  const runtimeFactory = ({ persistence: targetPersistence, now: targetNow, replayProviders }) => {
    const targetWorld = createPersistentWorld({ persistence: targetPersistence, now: targetNow, timeMode: 'realtime', timeZone: 'Asia/Shanghai', syncClockOnCreate: false });
    const target = createDeskBotServer({ now: targetNow, persistence: targetPersistence, persistentWorld: targetWorld,
      llm: { id: 'must-not-call', complete: async () => { throw Error('external_provider_called'); } },
      replayProviders, websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false,
      residentLifeEnabled: false, livedMemoryEnabled: false });
    // Mirror the non-network startup bootstrap performed by the source
    // server's listen hook without opening a port or starting workers.
    return { chat: target.chat, replayWorker: target.replayWorker, persistentWorld: targetWorld, providerCalls: replayProviders.providerCalls,
      replayStartup: () => target.roleEvolution.syncAll(),
      close: () => { try { target.close(); } catch {} targetPersistence.close(); } };
  };
  const fresh = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'fresh.sqlite'), runtimeFactory, codeFingerprint: CODE });
  const restarted = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'restarted.sqlite'), runtimeFactory,
    restartAt: Math.floor(summary.operation_count / 2), codeFingerprint: CODE });
  assert.equal(fresh.verified, true);
  assert.equal(fresh.chats, 1);
  assert.equal(fresh.provider_calls, 0);
  assert.deepEqual(restarted.namespace_digests, fresh.namespace_digests);
});

test('chat replay fails closed before target creation when its provider fixture is missing or tampered', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-chat-replay-negative-'));
  const source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  let time = BASE;
  const now = () => new Date(time);
  const persistence = createSqlitePersistence({ filename: source, now });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture: capture });
  const server = createDeskBotServer({ now, persistence, persistentWorld: world, replayCapture: capture,
    llm: { id: 'negative-source', status: () => ({ configured: true }), complete: async () => ({ provider: 'negative-source', model: 'v1', text: '喵呜。' }) },
    websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(async () => { try { await new Promise(resolve => server.close(() => resolve())); } catch {}
    capture.close(); persistence.close(); rmSync(dir, { recursive: true, force: true }); });
  const request = { event_id: 'chat-replay-negative-001', message: '请留下痕迹。' };
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
  assert.equal(response.status, 202);
  exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
  const tapePath = join(archive, 'capture.json');
  const original = readFileSync(tapePath, 'utf8');
  const tape = JSON.parse(original);
  tape.providers = [];
  writeFileSync(tapePath, JSON.stringify(tape));
  const runtimeFactory = () => { throw Error('runtime_must_not_start'); };
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'missing.sqlite'), runtimeFactory, codeFingerprint: CODE }), /replay_provider_fixture_missing/);
  assert.equal(existsSync(join(dir, 'missing.sqlite')), false);
  writeFileSync(tapePath, original);
  const restored = JSON.parse(original);
  restored.providers[0].ref.fixture.text = '被篡改的 fixture';
  writeFileSync(tapePath, JSON.stringify(restored));
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'tampered.sqlite'), runtimeFactory, codeFingerprint: CODE }), /replay_capture_provider_corrupt/);
  assert.equal(existsSync(join(dir, 'tampered.sqlite')), false);
});

test('chat replay preserves a successful TTS fixture and re-enters the original handler without a provider', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-chat-tts-replay-'));
  const source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  let time = BASE;
  const now = () => new Date(time);
  const persistence = createSqlitePersistence({ filename: source, now });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture: capture });
  const bytes = Buffer.from('RIFF-chat-replay-audio');
  const audio = {
    format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
    encoding: 'base64', data_base64: bytes.toString('base64'), byte_count: bytes.length,
    duration_ms: 180, audio_id: 'audio-chat-replay-001',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
  let llmCalls = 0, ttsCalls = 0;
  const sourceServer = createDeskBotServer({ now, persistence, persistentWorld: world, replayCapture: capture,
    llm: { id: 'chat-tts-source', complete: async () => {
      llmCalls += 1; return { provider: 'chat-tts-source', model: 'fixture-v1', text: '喵呜。声音也收好了。' };
    } },
    voiceClient: { synthesize: async input => {
      ttsCalls += 1; return { schema: 'voice.tts-result.v0.1', ok: true, request_id: input.request_id,
        correlation_id: input.correlation_id, profile: input.profile, audio };
    } },
    websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false,
    residentLifeEnabled: false, livedMemoryEnabled: false,
  });
  await new Promise((resolve, reject) => sourceServer.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const request = { event_id: 'chat-tts-replay-001', correlation_id: 'chat-tts-correlation-001', message: '请把这句说出来。' };
  try {
    const response = await fetch(`http://127.0.0.1:${sourceServer.address().port}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.turn.voice.audio_id, audio.audio_id);
    assert.equal(llmCalls, 1); assert.equal(ttsCalls, 1);
    exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
    const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
    const providers = tape.providers.filter(item => item.operation_id === `chat:${request.event_id}`);
    assert.ok(providers.some(item => item.kind === 'llm'));
    const ttsFixture = providers.find(item => item.kind === 'tts');
    assert.equal(ttsFixture.ref.fixture.kind, 'tts.synthesize.v1');
    assert.equal(ttsFixture.ref.fixture.audio.audio.audio_id, audio.audio_id);
    const replayProviders = (await import('../src/replay-capture.mjs')).createReplayChatProviders({ tape });
    const runtimeFactory = ({ persistence: targetPersistence, now: targetNow, replayProviders: providersForReplay }) => {
      const targetWorld = createPersistentWorld({ persistence: targetPersistence, now: targetNow, timeMode: 'realtime',
        timeZone: 'Asia/Shanghai', syncClockOnCreate: false });
      const target = createDeskBotServer({ now: targetNow, persistence: targetPersistence, persistentWorld: targetWorld,
        llm: { id: 'must-not-call', complete: async () => { throw Error('external_provider_called'); } },
        replayProviders: providersForReplay, websocket: false, worldLifeEnabled: false,
        autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false,
      });
      return { chat: target.chat, replayWorker: target.replayWorker, persistentWorld: targetWorld,
        providerCalls: providersForReplay.providerCalls, replayStartup: () => target.roleEvolution.syncAll(),
        close: () => { try { target.close(); } catch {} targetPersistence.close(); } };
    };
    const replay = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'replay.sqlite'),
      runtimeFactory, codeFingerprint: CODE });
    const restarted = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'replay-restarted.sqlite'),
      runtimeFactory, restartAt: 1, codeFingerprint: CODE });
    assert.equal(replay.verified, true);
    assert.equal(restarted.verified, true);
    assert.equal(replay.provider_calls, 0);
    assert.equal(restarted.provider_calls, 0);
  } finally {
    await new Promise(resolve => sourceServer.close(() => resolve()));
    capture.close(); persistence.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test('chat replay records TTS failure as an error fixture and preserves the non-voice chat path', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-chat-tts-error-'));
  const source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  const now = () => new Date(BASE);
  const persistence = createSqlitePersistence({ filename: source, now });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture: capture });
  const sourceServer = createDeskBotServer({ now, persistence, persistentWorld: world, replayCapture: capture,
    llm: { id: 'chat-tts-error-source', complete: async () => ({ provider: 'chat-tts-error-source', model: 'v1', text: '喵呜。今天先用文字。' }) },
    voiceClient: { synthesize: async () => { throw Object.assign(new Error('sidecar unavailable'), { code: 'sidecar_unavailable', retryable: true }); } },
    websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false,
  });
  await new Promise((resolve, reject) => sourceServer.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  try {
    const request = { event_id: 'chat-tts-error-001', message: '文字也可以。' };
    const response = await fetch(`http://127.0.0.1:${sourceServer.address().port}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
    });
    assert.equal(response.status, 202);
    const body = await response.json();
    assert.equal(body.turn.voice, null);
    assert.equal(body.turn.voice_error.code, 'sidecar_unavailable');
    exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
    const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
    const ttsFixture = tape.providers.find(item => item.operation_id === `chat:${request.event_id}` && item.kind === 'tts');
    assert.equal(ttsFixture.ref.status, 'error');
    assert.equal(ttsFixture.ref.error_code, 'sidecar_unavailable');
  } finally {
    await new Promise(resolve => sourceServer.close(() => resolve()));
    capture.close(); persistence.close(); rmSync(dir, { recursive: true, force: true });
  }
});
