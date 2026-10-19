import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createCanonicalReplayCapture, exportCanonicalReplayCapture, replayServiceCapture } from '../src/replay-capture.mjs';
import { roleStageHttpFixture } from './support/role-stage-http-fixture.mjs';

const AT = '2026-10-14T08:00:00.000Z';
const CODE = 'role-proposal-route-replay.v1';
const OWNER = 'shaping-001';

function runtime(persistence, now, replayCapture = null) {
  const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', syncClockOnCreate: false, replayCapture });
  const server = createDeskBotServer({ persistence, now, persistentWorld: world, replayCapture,
    websocket: false, worldStreamEnabled: false, worldLifeEnabled: false, autonomousLifeEnabled: false,
    residentLifeEnabled: false, livedMemoryEnabled: false });
  return { world, server };
}

test('proposal create/choose/trial/complete/archive routes replay fresh and across restart with failed attempts retained', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-role-route-replay-'));
  const source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  let time = Date.parse(AT);
  const now = () => new Date(time);
  const persistence = createSqlitePersistence({ filename: source, now });
  const seed = runtime(persistence, now);
  const seedMutation = (eventId, layer, payload) => seed.server.ingestNonChatEvent({ event_id: eventId,
    type: 'world.mutation', source: 'role-replay-fixture', character_id: OWNER, layer,
    source_kind: layer === 'weather' ? 'external_provider' : layer === 'user_profile' ? 'user' : 'world_engine',
    confidence: 1, occurred_at: AT, payload });
  seedMutation('role-route-weather', 'weather', { action: 'update_weather', snapshot: { condition: '连续下雨', observed_at: AT } });
  seedMutation('role-route-user', 'user_profile', { action: 'observe_user_preference', preference_key: 'walk.place', value: '池塘散步' });
  seedMutation('role-route-world', 'world_line', { action: 'apply_world_line_event', event: { event_id: 'role-route-worldline', title: '荷叶亮起来了', summary: '湿地青蛙正在寻找新的落脚处。' } });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
  const current = runtime(persistence, now, capture);
  await new Promise(resolve => current.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${current.server.address().port}`;
  const post = async (path, body = {}) => { const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }); const result = { status: response.status, body: await response.json() }; time += 1; return result; };
  t.after(async () => { await new Promise(resolve => current.server.close(resolve)); capture.close(); persistence.close(); rmSync(dir, { recursive: true, force: true }); });
  const id = 'role-route-explicit-proposal';
  const request = { proposal_id: id, character_id: OWNER, direction_id: 'wetland_frog' };
  assert.equal((await post('/api/roles/proposals', request)).status, 201);
  assert.equal((await post('/api/roles/proposals', request)).body.duplicate, true);
  const root = `/api/roles/proposals/${encodeURIComponent(id)}`;
  assert.equal((await post(`${root}/trial/start`, { window_turns: 2 })).body.error, 'role_trial_not_startable');
  assert.equal((await post(`${root}/choose`, { choice: 'try' })).body.proposal.status, 'trying');
  assert.equal((await post(`${root}/trial/start`, { window_turns: 2, idempotency_key: 'start-ready' })).body.proposal.trial.status, 'active');
  assert.equal((await post(`${root}/trial/observations`, { event_id: 'route-observation-one', signal: 'positive' })).body.proposal.trial.turns_observed, 1);
  assert.equal((await post(`${root}/trial/observations`, { event_id: 'route-observation-one', signal: 'positive' })).body.proposal.trial.turns_observed, 1);
  assert.equal((await post(`${root}/trial/observations`, { event_id: 'route-observation-two', signal: 'neutral' })).body.proposal.trial.status, 'completed');
  assert.equal((await post(`${root}/trial/complete`, { decision: 'accepted' })).body.proposal.status, 'accepted');
  assert.equal((await post(`${root}/archive`, {})).body.proposal.status, 'archived');
  assert.equal((await post('/api/roles/proposals/missing/trial/start')).status, 404);
  assert.equal((await post('/api/roles/proposals', { character_id: OWNER, direction_id: 'not-a-candidate' })).status, 409);
  assert.equal((await post('/api/roles/proposals', { character_id: OWNER, direction_id: '' })).status, 400);
  const routes = persistence.list('replay.capture-routes');
  assert.ok(routes.some(row => row.route_id === 'role.proposal.create'));
  for (const action of ['choose', 'trial/start', 'trial/observations', 'trial/complete', 'archive']) {
    assert.ok(routes.some(row => row.route_id === `role.proposal.${action}`));
  }
  assert.ok(routes.some(row => row.status === 'error' && row.error.code === 'role_trial_not_startable'));
  assert.ok(routes.some(row => row.status === 'error' && row.error.code === 'role_proposal_not_found'));
  assert.equal(routes.filter(row => row.route_id === 'role.proposal.create' && row.request.proposal_id === id).length, 1);
  exportCanonicalReplayCapture({ databasePath: source, directory: archive, codeFingerprint: CODE });
  const makeRuntime = ({ persistence: targetPersistence, now: targetNow }) => {
    const target = runtime(targetPersistence, targetNow);
    return { persistentWorld: target.world, replayRoute: target.server.replayRoute,
      replayWorker: target.server.replayWorker, replayStartup: target.server.replayStartup,
      ingestNonChatEvent: target.server.ingestNonChatEvent, provider_calls: 0,
      close: () => { target.server.close(); targetPersistence.close(); } };
  };
  const fresh = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'fresh.sqlite'), runtimeFactory: makeRuntime, codeFingerprint: CODE });
  assert.equal(fresh.verified, true);
  const restarted = await replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'restart.sqlite'), runtimeFactory: makeRuntime, restartAt: 8, codeFingerprint: CODE });
  assert.deepEqual(restarted.namespace_digests, fresh.namespace_digests);
  const manifest = join(archive, 'capture.json'), original = readFileSync(manifest, 'utf8'), tape = JSON.parse(original);
  tape.routes.find(row => row.route_id === 'role.proposal.trial/observations').request.signal = 'negative';
  writeFileSync(manifest, JSON.stringify(tape));
  const tamperedTarget = join(dir, 'tampered.sqlite');
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: tamperedTarget, runtimeFactory: makeRuntime, codeFingerprint: CODE }), /replay_capture_route_corrupt/);
  assert.equal(existsSync(tamperedTarget), false);
  writeFileSync(manifest, original);
});

test('practical route and trusted replay share validation, default event id and idempotent canonical writer', async t => {
  const h = await roleStageHttpFixture(t), proposal = await h.prepare('wetland_frog');
  const root = `/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}`;
  const bad = await h.post(`${root}/practical-trial/start`, { activity_id: 'invented', duration_seconds: 1 });
  assert.equal(bad.status, 400);
  await assert.rejects(h.server.replayRoute('role.practical.start', { proposal_id: proposal.proposal_id, activity_id: 'invented' }), { code: 'invalid_practical_trial_request' });
  const started = await h.post(`${root}/practical-trial/start`, { variant: 'waterside' });
  assert.equal(started.status, 202, JSON.stringify(started));
  const revision = h.world.get().world_revision;
  const generatedEventId = started.body.world_mutation?.mutation?.event_id;
  assert.equal(typeof generatedEventId, 'string');
  const repeated = await h.server.replayRoute('role.practical.start', { proposal_id: proposal.proposal_id, event_id: generatedEventId, variant: 'waterside' });
  assert.equal(repeated.duplicate, true);
  assert.equal(h.world.get().world_revision, revision);
  const paused = await h.post(`${root}/practical-trial/pause`, { event_id: 'route-practical-pause' });
  assert.equal(paused.status, 202, JSON.stringify(paused));
  assert.equal((await h.server.replayRoute('role.practical.pause', { proposal_id: proposal.proposal_id, event_id: 'route-practical-pause' })).duplicate, true);
  const adjusted = await h.post(`${root}/practical-trial/adjust`, { event_id: 'route-practical-adjust', variant: 'waterside' });
  assert.equal(adjusted.status, 202, JSON.stringify(adjusted));
  const pausedAgain = await h.post(`${root}/practical-trial/pause`, { event_id: 'route-practical-pause-again' });
  assert.equal(pausedAgain.status, 202, JSON.stringify(pausedAgain));
  const resumed = await h.post(`${root}/practical-trial/resume`, { event_id: 'route-practical-resume' });
  assert.equal(resumed.status, 202, JSON.stringify(resumed));
  const exited = await h.post(`${root}/practical-trial/exit`, { event_id: 'route-practical-exit', reason: '先停一停' });
  assert.equal(exited.status, 202, JSON.stringify(exited));
  await h.restart();
  assert.equal((await h.server.replayRoute('role.practical.exit', { proposal_id: proposal.proposal_id, event_id: 'route-practical-exit', reason: '先停一停' })).duplicate, true);
});
