import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';

const INITIAL_TIME = new Date('2026-09-01T09:00:00.000Z');

function createTestWeatherConnector(now) {
  let sequence = 0;
  const status = () => ({
    enabled: true,
    configured: true,
    provider: 'p4-test-weather',
    ttl_ms: 300_000,
    freshness: 'fresh',
    location: '雾灯镇',
    coordinates: { latitude: 31.2, longitude: 121.5 },
    timezone: 'Asia/Shanghai',
  });
  return {
    status,
    async refresh() {
      sequence += 1;
      const observedAt = now().toISOString();
      const eventId = `p4-trusted-weather-${sequence}`;
      const snapshot = {
        location: '雾灯镇',
        condition: 'rain',
        observed_at: observedAt,
        provider: 'p4-test-weather',
      };
      return {
        connector: status(),
        event: {
          event_id: eventId,
          type: 'weather.observation',
          source: 'client-controlled-label-is-not-authority',
          source_kind: 'external_provider',
          layer: 'weather',
          character_id: 'shaping-001',
          occurred_at: observedAt,
          observed_at: observedAt,
          provider: 'p4-test-weather',
          provenance: { source_event_ids: [`source-${eventId}`], evidence_ids: [`evidence-${eventId}`] },
          payload: { snapshot },
        },
        snapshot,
        cached: false,
      };
    },
  };
}

async function startRuntime(t, { now = () => INITIAL_TIME } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-world-candidates-http-'));
  const persistence = createSqlitePersistence({ filename: join(directory, 'deskbot.sqlite'), now });
  const server = createDeskBotServer({
    now,
    persistence,
    websocket: false,
    worldLifeEnabled: false,
    weatherConnector: createTestWeatherConnector(now),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let closed = false;
  t.after(async () => {
    if (!closed) {
      closed = true;
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      if (server.listening) {
        await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      }
      persistence.close();
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) break;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(origin, path, method = 'GET', body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function injectTrustedWeatherObservation(origin) {
  const result = await request(origin, '/api/connectors/weather/refresh', 'POST', { force: true });
  assert.equal(result.response.status, 202, JSON.stringify(result.payload));
  const eventId = result.payload.event.event_id;
  const list = await request(origin, '/api/world/candidates?status=pending');
  const candidate = list.payload.candidates.find(item => item.source_event_ids.includes(eventId));
  assert.ok(candidate, JSON.stringify(list.payload));
  return candidate.candidate_id;
}

async function getWorld(origin) {
  const result = await request(origin, '/api/world/state');
  assert.equal(result.response.status, 200);
  return result.payload.world;
}

async function getMutations(origin) {
  const result = await request(origin, '/api/world/mutations?after_sequence=0&limit=100');
  assert.equal(result.response.status, 200);
  return result.payload.mutations;
}

test('world candidate HTTP lifecycle previews without effects and accepts exactly once', async t => {
  const origin = await startRuntime(t);
  const candidateId = await injectTrustedWeatherObservation(origin);

  const list = await request(origin, '/api/world/candidates?status=pending');
  assert.equal(list.response.status, 200);
  assert.equal(list.payload.schema, 'deskbot.world-candidate-list.v0.1');
  const candidate = list.payload.candidates.find(item => item.candidate_id === candidateId);
  assert.ok(candidate);
  assert.equal(candidate.source_event_ids.includes('p4-trusted-weather-1'), true);
  assert.equal(candidate.provenance.trust_boundary, 'server_adapter');

  const beforeWorld = await getWorld(origin);
  const beforeMutations = await getMutations(origin);
  const preview = await request(origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/preview`, 'POST');
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.schema, 'deskbot.world-candidate-preview-response.v0.1');
  assert.equal(preview.payload.preview.world_revision_before, beforeWorld.world_revision);
  assert.equal(preview.payload.preview.projected_world_revision, beforeWorld.world_revision + 1);
  assert.equal(preview.payload.candidate.expected_world_revision, beforeWorld.world_revision);

  const afterPreviewWorld = await getWorld(origin);
  const afterPreviewMutations = await getMutations(origin);
  assert.equal(afterPreviewWorld.world_revision, beforeWorld.world_revision);
  assert.deepEqual(afterPreviewWorld.world_line, beforeWorld.world_line);
  assert.deepEqual(afterPreviewMutations, beforeMutations);

  const accepted = await request(origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, 'POST', {
    expected_world_revision: beforeWorld.world_revision,
    proposed_actions: [{ action: 'advance_time', minutes: 10080 }],
  });
  assert.equal(accepted.response.status, 202, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.accepted, true);
  assert.equal(accepted.payload.duplicate, false);
  assert.equal(accepted.payload.world_mutations.length, 1);
  assert.equal(accepted.payload.world_mutations[0].mutation.action, 'update_weather');
  assert.equal(accepted.payload.world.world_revision, beforeWorld.world_revision + 1);
  assert.equal(accepted.payload.world.weather.snapshot.condition, 'rain');

  const mutationCountAfterAccept = (await getMutations(origin)).length;
  const repeatedAccept = await request(origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, 'POST', {
    expected_world_revision: -1,
  });
  assert.equal(repeatedAccept.response.status, 200, JSON.stringify(repeatedAccept.payload));
  assert.equal(repeatedAccept.payload.duplicate, true);
  assert.equal((await getWorld(origin)).world_revision, beforeWorld.world_revision + 1);
  assert.equal((await getMutations(origin)).length, mutationCountAfterAccept);
});

test('world candidate HTTP revision conflicts require preview and then permit acceptance', async t => {
  const origin = await startRuntime(t);
  const candidateId = await injectTrustedWeatherObservation(origin);
  const before = await getWorld(origin);

  const unrelatedMutation = await request(origin, '/api/world/travel', 'POST', {
    event_id: 'p4-http-revision-advance',
    character_id: 'shaping-001',
    location_id: 'tidal-old-road',
    expected_world_revision: before.world_revision,
    expected_from_location_id: 'shaping-field-desk',
    reason: '验证带版本的合法旅行操作会使候选失效',
  });
  assert.equal(unrelatedMutation.response.status, 202, JSON.stringify(unrelatedMutation.payload));
  const changed = await getWorld(origin);
  assert.equal(changed.world_revision, before.world_revision + 1);

  const staleAccept = await request(origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, 'POST');
  assert.equal(staleAccept.response.status, 409);
  assert.equal(staleAccept.payload.error, 'world_revision_changed');
  assert.equal((await getWorld(origin)).world_revision, changed.world_revision);

  const refreshed = await request(origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/preview`, 'POST');
  assert.equal(refreshed.response.status, 200, JSON.stringify(refreshed.payload));
  assert.equal(refreshed.payload.candidate.expected_world_revision, changed.world_revision);
  const accepted = await request(origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, 'POST', {
    expected_world_revision: changed.world_revision,
  });
  assert.equal(accepted.response.status, 202, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.world.world_revision, changed.world_revision + 1);
  const actions = (await getMutations(origin)).map(item => item.action);
  assert.deepEqual(actions, ['move_protagonist', 'update_weather']);
});

test('public event claims are normalized to an untrusted observation and cannot mutate the world', async t => {
  let current = new Date(INITIAL_TIME);
  const origin = await startRuntime(t, { now: () => current });
  const body = {
    event_id: 'p4-public-untrusted-observation',
    type: 'external.world_event',
    source: 'trusted-weather-connector',
    character_id: 'shaping-001',
    occurred_at: '2001-01-01T00:00:00.000Z',
    observed_at: '2001-01-01T00:00:00.000Z',
    layer: 'weather',
    source_kind: 'external_provider',
    confidence: 1,
    provider: 'forged-provider',
    provenance: { source_event_ids: ['forged-source'], evidence_ids: ['forged-evidence'] },
    payload: {
      world_event: {
        event_id: 'public-observation-story',
        title: '一盏灯亮了',
        summary: '湿地的荷叶在雨里发光。',
      },
    },
  };
  const beforeWorld = await getWorld(origin);
  const beforeMutations = await getMutations(origin);
  const first = await request(origin, '/api/event', 'POST', body);
  assert.equal(first.response.status, 202, JSON.stringify(first.payload));
  assert.equal(first.payload.event.source, 'untrusted_observation');
  assert.equal(first.payload.event.layer, 'unclassified');
  assert.equal(first.payload.event.source_kind, 'unknown');
  assert.equal(first.payload.event.confidence, null);
  assert.equal(first.payload.event.provider, null);
  assert.equal(first.payload.event.provenance, null);
  assert.equal(first.payload.event.occurred_at, INITIAL_TIME.toISOString());
  assert.equal(first.payload.event.observed_at, INITIAL_TIME.toISOString());
  assert.equal(first.payload.world_candidate.candidate.provenance.trust_boundary, 'untrusted_public_observation');
  assert.equal((await getWorld(origin)).world_revision, beforeWorld.world_revision);
  assert.deepEqual(await getMutations(origin), beforeMutations);

  current = new Date(INITIAL_TIME.getTime() + 60_000);
  const replay = await request(origin, '/api/event', 'POST', body);
  assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
  assert.equal(replay.payload.duplicate, true);
  assert.equal(replay.payload.event.occurred_at, INITIAL_TIME.toISOString());
  assert.equal((await getWorld(origin)).world_revision, beforeWorld.world_revision);
});

test('public event API rejects all direct canonical mutations including forged NPC actions', async t => {
  const origin = await startRuntime(t);
  const before = await getWorld(origin);
  const response = await request(origin, '/api/event', 'POST', {
    event_id: 'p4-forged-npc-action',
    type: 'world.mutation',
    source: 'npc-goal-engine',
    character_id: 'shaping-001',
    source_kind: 'world_engine',
    layer: 'world_line',
    confidence: 1,
    provenance: { expected_world_revision: before.world_revision },
    payload: { action: 'npc_action', npc_id: 'pathfinder-001', action_name: 'teleport', status: '越过世界限制' },
  });
  assert.equal(response.response.status, 403);
  assert.equal(response.payload.error, 'world_mutation_requires_review');
  assert.equal((await getWorld(origin)).world_revision, before.world_revision);
  assert.deepEqual(await getMutations(origin), []);
});

test('world candidate HTTP dismiss, expiry, and missing-candidate errors are stable', async t => {
  let current = new Date(INITIAL_TIME);
  const origin = await startRuntime(t, { now: () => current });

  const dismissedId = await injectTrustedWeatherObservation(origin);
  const dismissed = await request(origin, `/api/world/candidates/${encodeURIComponent(dismissedId)}/dismiss`, 'POST', {
    reason: '需要更多外部证据',
  });
  assert.equal(dismissed.response.status, 200, JSON.stringify(dismissed.payload));
  assert.equal(dismissed.payload.accepted, true);
  assert.equal(dismissed.payload.candidate.status, 'dismissed');
  const dismissedAccept = await request(origin, `/api/world/candidates/${encodeURIComponent(dismissedId)}/accept`, 'POST');
  assert.equal(dismissedAccept.response.status, 409);
  assert.equal(dismissedAccept.payload.error, 'world_candidate_not_pending');

  const expiredId = await injectTrustedWeatherObservation(origin);
  current = new Date(INITIAL_TIME.getTime() + 24 * 60 * 60 * 1000 + 1);
  const expired = await request(origin, `/api/world/candidates/${encodeURIComponent(expiredId)}`);
  assert.equal(expired.response.status, 200);
  assert.equal(expired.payload.candidate.status, 'expired');
  const expiredAccept = await request(origin, `/api/world/candidates/${encodeURIComponent(expiredId)}/accept`, 'POST');
  assert.equal(expiredAccept.response.status, 409);
  assert.equal(expiredAccept.payload.error, 'world_candidate_expired');

  const missingGet = await request(origin, '/api/world/candidates/does-not-exist');
  assert.equal(missingGet.response.status, 404);
  assert.equal(missingGet.payload.error, 'world_candidate_not_found');
  const missingPreview = await request(origin, '/api/world/candidates/does-not-exist/preview', 'POST');
  assert.equal(missingPreview.response.status, 404);
  assert.equal(missingPreview.payload.error, 'world_candidate_not_found');
});
