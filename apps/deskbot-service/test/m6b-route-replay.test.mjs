import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createDeskBotServer } from '../src/app.mjs';
import { createCanonicalReplayCapture, exportCanonicalReplayCapture, replayServiceCapture } from '../src/replay-capture.mjs';

const BASE = Date.parse('2026-10-14T00:00:00.000Z');
const CODE = 'm6b-route-replay-contract-v1';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve());
  });
}

function createRuntime({ persistence, now, replayCapture = null }) {
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture, syncClockOnCreate: false });
  const server = createDeskBotServer({ now, persistence, persistentWorld: world, replayCapture,
    websocket: false, worldStreamEnabled: false, worldLifeEnabled: false, autonomousLifeEnabled: false,
    residentLifeEnabled: false, livedMemoryEnabled: false });
  return { world, server };
}

test('role and research HTTP routes are captured and replayed through their original domain handlers', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-route-replay-'));
  const source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  let time = BASE;
  let persistence = createSqlitePersistence({ filename: source, now: () => new Date(time) });
  const now = () => new Date(time);
  const seedWorld = createPersistentWorld({ persistence, now, timeMode: 'realtime', syncClockOnCreate: false });
  const seedServer = createDeskBotServer({ now, persistence, persistentWorld: seedWorld, websocket: false,
    worldStreamEnabled: false, worldLifeEnabled: false, autonomousLifeEnabled: false,
    residentLifeEnabled: false, livedMemoryEnabled: false });
  const candidateObservation = { event_id: 'route-candidate-observation-001', type: 'external.world_event',
    source: 'route-replay-fixture', source_kind: 'external_provider', character_id: 'shaping-001',
    occurred_at: now().toISOString(), observed_at: now().toISOString(),
    payload: { world_event: { title: '一圈回响', summary: '候选回放夹具' } } };
  const candidateResult = seedServer.worldCandidates.observe(candidateObservation, { world: seedWorld.get() });
  const candidateId = candidateResult.candidate?.candidate_id;
  assert.ok(candidateId);
  seedServer.close();
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const { world, server } = createRuntime({ persistence, now, replayCapture: capture });
  await listen(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  t.after(async () => {
    try { await new Promise(resolve => server.close(() => resolve())); } catch { /* already closed */ }
    try { seedServer.close(); } catch { /* already closed */ }
    capture.close(); persistence.close(); rmSync(dir, { recursive: true, force: true });
  });

  const role = await post('/api/role-evolution/run', { idempotency_key: 'route-role-001', character_id: 'shaping-001', limit: 20 });
  assert.ok([200, 201].includes(role.status));
  time += 1;
  const research = await post('/api/research/scenarios/run', { idempotency_key: 'route-research-001', scenario_id: 'world-line-echo' });
  assert.equal(research.status, 200);
  time += 1;
  const preview = await post(`/api/world/candidates/${encodeURIComponent(candidateId)}/preview`, {});
  assert.equal(preview.status, 200);
  time += 1;
  const accept = await post(`/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, {
    expected_world_revision: preview.body.world_revision,
  });
  assert.equal(accept.status, 202);
  const acceptBody = await accept.json();
  assert.equal(acceptBody.accepted, true);
  assert.equal(acceptBody.world_mutations.length, 1);
  const commitment = await post('/api/life/commitments', { id: 'route-commitment-001', confirmed: true,
    text: '今天把雾灯镇的回响记下来。', evidence_ref: 'route-replay-test' });
  assert.equal(commitment.status, 200);

  const routeRows = persistence.list('replay.capture-routes');
  assert.deepEqual(routeRows.map(row => row.route_id), ['role.evolution.run', 'research.scenario.run', 'world.candidate.preview', 'world.candidate.accept', 'life.commitment']);
  assert.deepEqual(routeRows.map(row => row.status), ['success', 'success', 'success', 'success', 'success']);
  assert.ok(routeRows.every(row => row.request && typeof row.request === 'object'));

  exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
  const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
  assert.equal(tape.routes.length, 5);
  assert.equal(tape.routes[0].request.idempotency_key, 'route-role-001');
  assert.equal(tape.routes[1].request.scenario_id, 'world-line-echo');
  assert.equal(tape.routes[2].request.candidate_id, candidateId);
  assert.equal(tape.routes[3].request.candidate_id, candidateId);
  assert.equal(tape.routes[4].request.id, 'route-commitment-001');

  const replayed = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'replayed.sqlite'),
    codeFingerprint: CODE, runtimeFactory: ({ persistence: targetPersistence, now: targetNow }) => {
      const target = createRuntime({ persistence: targetPersistence, now: targetNow });
      return { persistentWorld: target.world, replayRoute: target.server.replayRoute, ingestNonChatEvent: target.server.ingestNonChatEvent,
        replayStartup: target.server.replayStartup, replayWorker: target.server.replayWorker,
        provider_calls: 0, close: () => { try { target.server.close(); } catch {} targetPersistence.close(); } };
    } });
  assert.equal(replayed.verified, true);
  assert.equal(replayed.provider_calls, 0);
  assert.equal(replayed.coverage, 'service_ingress_namespaces_verified');
  const restarted = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'restarted.sqlite'),
    restartAt: 1, codeFingerprint: CODE, runtimeFactory: ({ persistence: targetPersistence, now: targetNow }) => {
      const target = createRuntime({ persistence: targetPersistence, now: targetNow });
      return { persistentWorld: target.world, replayRoute: target.server.replayRoute, ingestNonChatEvent: target.server.ingestNonChatEvent,
        replayStartup: target.server.replayStartup, replayWorker: target.server.replayWorker, provider_calls: 0,
        close: () => { try { target.server.close(); } catch {} targetPersistence.close(); } };
    } });
  assert.equal(restarted.verified, true);
  const manifest = join(archive, 'capture.json');
  const original = readFileSync(manifest, 'utf8');
  const tampered = JSON.parse(original);
  tampered.routes[0].request.limit = 999;
  writeFileSync(manifest, JSON.stringify(tampered));
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'tampered.sqlite'),
    codeFingerprint: CODE, runtimeFactory: () => ({}) }), /replay_capture_route_corrupt/);
  assert.equal(existsSync(join(dir, 'tampered.sqlite')), false);
  writeFileSync(manifest, original);
  assert.equal(world.get().world_revision, 2);
});
