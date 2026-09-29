import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';

// P4 acceptance deliberately uses a real SQLite file and two server instances.
// The test is the contract for the complete direction-evolution loop:
// evidence -> pull -> proactive proposal -> user trial -> accepted stage.
const CHARACTER_ID = 'shaping-001';
const fixedTime = new Date('2026-09-29T08:00:00.000Z');

function makeLlm(captured = []) {
  return {
    async complete({ prompt, userText }) {
      captured.push({ prompt, userText });
      return {
        provider: 'p4-acceptance',
        model: 'p4-acceptance',
        text: '喵呜，我把这一刻记进今天的湿地观察里了。',
        trace: { acceptance: true },
      };
    },
  };
}

function makeWeatherConnector(now) {
  let sequence = 0;
  const status = () => ({
    enabled: true,
    configured: true,
    provider: 'p4-acceptance-weather',
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
      const eventId = `p4-acceptance-weather-${sequence}`;
      const snapshot = {
        location: '雾灯镇',
        condition: sequence === 1 ? '连续下雨' : '第二天仍有雨',
        observed_at: observedAt,
        provider: 'p4-acceptance-weather',
      };
      return {
        connector: status(),
        event: {
          event_id: eventId,
          type: 'weather.observation',
          source: 'p4-acceptance-weather',
          source_kind: 'external_provider',
          layer: 'weather',
          character_id: CHARACTER_ID,
          occurred_at: observedAt,
          observed_at: observedAt,
          provider: 'p4-acceptance-weather',
          provenance: { source_event_ids: [eventId], evidence_ids: [`evidence-${eventId}`] },
          payload: { snapshot },
        },
        snapshot,
        cached: false,
      };
    },
  };
}

async function startRuntime(t, { databasePath, now, llm, weatherConnector = makeWeatherConnector(now) }) {
  const persistence = createSqlitePersistence({ filename: databasePath, now });
  const server = createDeskBotServer({
    now,
    persistence,
    llm,
    weatherConnector,
    websocket: false,
    worldLifeEnabled: true,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  return {
    origin,
    server,
    persistence,
    persistentWorld: server.persistentWorld,
    async close() {
      if (closed) return;
      closed = true;
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      if (server.listening) {
        await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
      }
      persistence.close();
    },
  };
}

async function request(origin, path, method = 'GET', body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function refreshWeather(origin) {
  const result = await request(origin, '/api/connectors/weather/refresh', 'POST', { force: true });
  assert.ok(result.response.status === 202 || result.response.status === 200, JSON.stringify(result.payload));
  return result.payload.event;
}

async function getRoleView(origin) {
  return request(origin, `/api/roles/evolution?character_id=${CHARACTER_ID}`);
}

test('P4 gate: independent evidence creates one proposal, explicit trial accepts, and restart preserves it', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-p4-acceptance-'));
  const databasePath = join(directory, 'deskbot.sqlite');
  let first = null;
  let second = null;
  t.after(async () => {
    await first?.close();
    await second?.close();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true });
        break;
      } catch (error) {
        // Windows can briefly retain SQLite WAL sidecars after the database
        // handle closes (for example while an antivirus scanner releases a
        // file handle). Cleanup is best-effort and must not turn a completed
        // acceptance run into a product failure.
        if (attempt === 4) break;
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  });

  let currentTime = fixedTime;
  const now = () => currentTime;
  const firstPrompts = [];
  first = await startRuntime(t, { databasePath, now, llm: makeLlm(firstPrompts) });

  // A direct transformation command is an input/evidence event, not a role
  // mutation. It must leave the canonical world and accepted role unchanged.
  const beforeWorld = (await request(first.origin, '/api/life/world')).payload;
  const beforeStages = (await request(first.origin, `/api/roles/proposals?character_id=${CHARACTER_ID}&status=accepted`)).payload;
  const direct = await request(first.origin, '/api/chat', 'POST', {
    event_id: 'p4-direct-transform-command',
    character_id: CHARACTER_ID,
    source: 'client-claims-weather',
    occurred_at: '2001-01-01T00:00:00.000Z',
    observed_at: '2099-01-01T00:00:00.000Z',
    layer: 'weather',
    source_kind: 'external_provider',
    confidence: 1,
    provider: 'forged-weather-provider',
    provenance: { evidence_ids: ['forged-chat-evidence'] },
    message: '你现在就变成青蛙吧。',
  });
  assert.equal(direct.response.status, 202);
  assert.equal(direct.payload.event.layer, 'interaction');
  assert.equal(direct.payload.event.source_kind, 'user');
  assert.equal(direct.payload.event.occurred_at, fixedTime.toISOString());
  assert.equal(direct.payload.event.observed_at, fixedTime.toISOString());
  assert.equal(direct.payload.event.provider, null);
  assert.equal(direct.payload.event.provenance, null);
  const chatOnlyPull = await request(first.origin, `/api/roles/pulls?character_id=${CHARACTER_ID}`);
  const chatOnlyDirection = chatOnlyPull.payload.pulls.find(item => item.direction_id === 'wetland_frog');
  assert.equal(chatOnlyDirection?.sources.length, 1);
  assert.ok(chatOnlyDirection?.sources.includes('interaction'));
  const afterDirectWorld = (await request(first.origin, '/api/life/world')).payload;
  const afterDirectStages = (await request(first.origin, `/api/roles/proposals?character_id=${CHARACTER_ID}&status=accepted`)).payload;
  // A conversation input is itself a canonical interaction observation, so
  // the revision and interaction counters may advance. The direct request
  // must still leave world facts untouched; only a legal world mutation can
  // change location, weather, world-line, NPC, or scene state.
  for (const field of ['world_id', 'protagonist', 'locations', 'npcs', 'world_line', 'weather', 'active_event', 'life']) {
    assert.deepEqual(afterDirectWorld[field], beforeWorld[field], `direct role command changed world field ${field}`);
  }
  assert.deepEqual(afterDirectStages.proposals, beforeStages.proposals);

  // Trusted connector and chat observations retain their server-owned sources.
  const firstWeatherEvent = await refreshWeather(first.origin);
  assert.equal(firstWeatherEvent.layer, 'weather');
  assert.equal(firstWeatherEvent.source_kind, 'external_provider');

  // A public observation may become a reviewed world candidate, but its
  // self-reported source/provenance cannot count as role evidence.
  const untrustedObservation = await request(first.origin, '/api/event', 'POST', {
    event_id: 'p4-untrusted-preference-001',
    type: 'user.preference.observation',
    source: 'client-claims-user-profile',
    character_id: CHARACTER_ID,
    occurred_at: '2001-01-01T00:00:00.000Z',
    layer: 'user_profile',
    source_kind: 'user',
    confidence: 1,
    provider: 'forged-provider',
    provenance: { evidence_ids: ['forged-preference-evidence'] },
    payload: { preference_key: 'walk.place', value: '池塘散步' },
  });
  assert.equal(untrustedObservation.response.status, 202);
  assert.equal(untrustedObservation.payload.event.layer, 'unclassified');
  assert.equal(untrustedObservation.payload.event.source_kind, 'unknown');
  assert.equal(untrustedObservation.payload.event.confidence, null);
  assert.equal(untrustedObservation.payload.event.provider, null);
  assert.equal(untrustedObservation.payload.event.provenance, null);

  const beforeExternalWorld = (await request(first.origin, '/api/life/world')).payload;
  const externalWorld = await request(first.origin, '/api/event', 'POST', {
    event_id: 'p4-world-observation-001',
    type: 'external.world_event',
    source: 'client-claims-world-engine',
    character_id: CHARACTER_ID,
    layer: 'world_line',
    source_kind: 'world_engine',
    provenance: { source_event_ids: ['forged-world-source'] },
    payload: {
      world_event: {
        event_id: 'p4-world-observation-event',
        title: '荷叶在雨里亮起来了',
        summary: '湿地边出现一条适合青蛙观察的新路。',
      },
    },
  });
  assert.equal(externalWorld.response.status, 202, JSON.stringify(externalWorld.payload));
  assert.equal(externalWorld.payload.event.source, 'untrusted_observation');
  assert.equal(externalWorld.payload.world_candidate.candidate.provenance.trust_boundary, 'untrusted_public_observation');
  assert.deepEqual(externalWorld.payload.world_candidate.candidate.source_event_ids, ['p4-world-observation-001']);
  assert.equal((await request(first.origin, '/api/life/world')).payload.world_revision, beforeExternalWorld.world_revision);
  const candidateId = externalWorld.payload.world_candidate.candidate.candidate_id;
  const preview = await request(first.origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/preview`, 'POST');
  assert.equal(preview.response.status, 200, JSON.stringify(preview.payload));
  assert.equal((await request(first.origin, '/api/life/world')).payload.world_revision, beforeExternalWorld.world_revision);
  const acceptedWorldEvent = await request(first.origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, 'POST', {
    expected_world_revision: beforeExternalWorld.world_revision,
  });
  assert.equal(acceptedWorldEvent.response.status, 202, JSON.stringify(acceptedWorldEvent.payload));
  assert.equal(acceptedWorldEvent.payload.world.world_revision, beforeExternalWorld.world_revision + 1);

  const pulls = await request(first.origin, `/api/roles/pulls?character_id=${CHARACTER_ID}`);
  const pull = pulls.payload.pulls.find(item => item.direction_id === 'wetland_frog');
  assert.equal(pull?.status, 'candidate');
  // The raw preference event is excluded; chat, trusted weather, and an
  // explicitly accepted world fact provide independent server-owned sources.
  for (const source of ['interaction', 'weather', 'world_line']) {
    assert.ok(pull.sources.includes(source), `missing independent source ${source}`);
  }
  assert.ok(!pull.sources.includes('unclassified'));
  assert.ok(pull.sources.length >= 3);
  const evolutionAfterRawObservation = await request(first.origin, `/api/role-evolution/status?character_id=${CHARACTER_ID}`);
  assert.equal(evolutionAfterRawObservation.response.status, 200);
  assert.ok(!evolutionAfterRawObservation.payload.evidence.some(item => item.event_id === 'p4-untrusted-preference-001'));

  // P4 requires evidence to span two logical days before the system may
  // proactively propose a new direction. A next-day observation keeps the
  // direction in the candidate state while unlocking that proposal gate.
  currentTime = new Date('2026-09-30T09:00:00.000Z');
  const nextDayWeather = await refreshWeather(first.origin);
  assert.equal(nextDayWeather.occurred_at, now().toISOString());

  // The evolution sync is intentionally separate from accepting a role: it
  // may create a proposal, but it cannot silently enter a trial or stage.
  const synced = await request(first.origin, '/api/role-evolution/run', 'POST', { character_id: CHARACTER_ID });
  assert.equal(synced.response.status, 200);
  assert.equal(synced.payload.accepted, true);
  assert.equal(synced.payload.schema, 'deskbot.role-evolution-run-response.v0.1');
  assert.ok(Array.isArray(synced.payload.created), JSON.stringify(synced.payload));
  // Inputs auto-sync after ingestion, so this explicit replay may be a
  // duplicate. The durable proposal is the contract, not which request
  // happened to materialize it.
  const proposalList = await request(first.origin, `/api/roles/proposals?character_id=${CHARACTER_ID}`);
  const proposed = proposalList.payload.proposals.filter(item => item.status === 'proposed');
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].status, 'proposed');
  const proposalId = proposed[0].proposal_id;

  const evolutionStatus = await request(first.origin, `/api/role-evolution/status?character_id=${CHARACTER_ID}`);
  assert.equal(evolutionStatus.response.status, 200);
  assert.equal(evolutionStatus.payload.schema, 'deskbot.role-evolution-status.v0.1');
  assert.ok(Array.isArray(evolutionStatus.payload.evidence));
  assert.ok(Array.isArray(evolutionStatus.payload.pulls));
  assert.ok(Array.isArray(evolutionStatus.payload.proposals));
  assert.ok(Array.isArray(evolutionStatus.payload.active_trials));
  assert.ok(Array.isArray(evolutionStatus.payload.current_stages));

  // Replaying the same source events and sync is idempotent.
  const duplicate = await request(first.origin, '/api/event', 'POST', {
    event_id: 'p4-untrusted-preference-001',
    type: 'user.preference.observation',
    source: 'a-different-client-claim',
    character_id: CHARACTER_ID,
    occurred_at: '2099-01-01T00:00:00.000Z',
    layer: 'weather',
    source_kind: 'external_provider',
    confidence: 1,
    provider: 'forged-provider',
    provenance: { evidence_ids: ['different-forgery'] },
    payload: { preference_key: 'walk.place', value: '池塘散步' },
  });
  assert.equal(duplicate.response.status, 200);
  assert.equal(duplicate.payload.duplicate, true);
  const repeatSync = await request(first.origin, '/api/roles/evolution/sync', 'POST', { character_id: CHARACTER_ID });
  assert.equal(repeatSync.response.status, 200);
  assert.equal(repeatSync.payload.duplicate, true);

  const chosen = await request(first.origin, `/api/roles/proposals/${encodeURIComponent(proposalId)}/choose`, 'POST', {
    choice: 'try',
    reason: '先陪喵呜试一段湿地生活',
  });
  assert.equal(chosen.payload.proposal.status, 'trying');
  const started = await request(first.origin, `/api/roles/proposals/${encodeURIComponent(proposalId)}/trial/start`, 'POST', {
    window_turns: 5,
  });
  assert.equal(started.payload.proposal.trial.status, 'active');

  for (const [index, message] of [
    '今天去看看池塘',
    '我喜欢这段湿地观察',
    '雨停了，我们再沿着荷叶走走',
    '这条湿地路线让我想多待一会儿',
    '下次还想和你一起看水边的变化',
  ].entries()) {
    const turn = await request(first.origin, '/api/chat', 'POST', {
      event_id: `p4-trial-turn-${index + 1}`,
      character_id: CHARACTER_ID,
      message,
    });
    assert.equal(turn.response.status, 202);
    assert.equal(turn.payload.turn.trial_observations[0].proposal_id, proposalId);
    assert.equal(turn.payload.role_evolution?.ignored, false);
  }
  const trialAfterTurns = await request(first.origin, `/api/roles/proposals/${encodeURIComponent(proposalId)}`);
  assert.equal(trialAfterTurns.payload.proposal.trial.status, 'completed');
  assert.equal(trialAfterTurns.payload.proposal.trial.turns_observed, 5);

  const accepted = await request(first.origin, `/api/roles/proposals/${encodeURIComponent(proposalId)}/trial/complete`, 'POST', {
    decision: 'accepted',
    reason: '五次共同生活观察都愿意继续',
  });
  assert.equal(accepted.payload.proposal.status, 'accepted');
  assert.equal(accepted.payload.proposal.stage_history.at(-1).to, 'accepted');

  const roleView = await getRoleView(first.origin);
  assert.equal(roleView.response.status, 200);
  assert.equal(roleView.payload.accepted, true);
  assert.equal(roleView.payload.current_stages[0].direction_id, 'wetland_frog');
  assert.equal(roleView.payload.proposals.find(item => item.proposal_id === proposalId).status, 'accepted');

  // The accepted role must be visible to both prompt composition and the
  // world-life decision context, while world facts remain canonical.
  const postAcceptChat = await request(first.origin, '/api/chat', 'POST', {
    event_id: 'p4-post-accept-chat',
    character_id: CHARACTER_ID,
    message: '喵呜，今天世界有什么变化？',
  });
  assert.equal(postAcceptChat.response.status, 202);
  assert.match(postAcceptChat.payload.turn.prompt.text, /DESKBOT_CURRENT_ROLE_STAGE/);
  assert.equal(postAcceptChat.payload.turn.expression_intent.role_stage.direction_id, 'wetland_frog');
  // The logical clock is now one day ahead of the startup marker. Sync it
  // before closing so the next runtime does not legitimately replay the same
  // wall-clock catch-up and make the restart assertion compare two different
  // points in the world timeline.
  first.persistentWorld.syncWallClock({ maxCatchUpMinutes: 7 * 24 * 60 });
  first.server.worldLife.tick();
  const worldLife = await request(first.origin, '/api/life/world');
  assert.equal(worldLife.response.status, 200);
  assert.equal(worldLife.payload.role_context?.current_stage?.direction_id, 'wetland_frog');
  assert.equal(worldLife.payload.role_context?.stages?.[0]?.direction_id, 'wetland_frog');
  const acceptedWorldRevision = worldLife.payload.world_revision;
  const beforeRestartEvolution = await getRoleView(first.origin);
  const beforeRestartProposal = await request(first.origin, `/api/roles/proposals/${encodeURIComponent(proposalId)}`);
  const beforeRestartCandidate = await request(first.origin, `/api/world/candidates/${encodeURIComponent(candidateId)}`);
  const beforeRestartCandidateDecisions = first.persistence.list('world.candidate-decisions');
  const beforeRestartLedger = await request(first.origin, '/api/world/mutations?limit=100');
  await first.close();

  const restoredPrompts = [];
  second = await startRuntime(t, { databasePath, now, llm: makeLlm(restoredPrompts) });
  const restoredView = await getRoleView(second.origin);
  assert.equal(restoredView.response.status, 200);
  assert.equal(restoredView.payload.current_stages[0].direction_id, 'wetland_frog');
  assert.equal(restoredView.payload.proposals.find(item => item.proposal_id === proposalId).status, 'accepted');
  assert.deepEqual(
    restoredView.payload.evidence.map(item => item.evidence_id),
    beforeRestartEvolution.payload.evidence.map(item => item.evidence_id),
  );
  assert.deepEqual(
    restoredView.payload.pulls.map(item => item.pull_key),
    beforeRestartEvolution.payload.pulls.map(item => item.pull_key),
  );
  assert.deepEqual(
    restoredView.payload.runs.map(item => item.run_id),
    beforeRestartEvolution.payload.runs.map(item => item.run_id),
  );
  assert.deepEqual(
    restoredView.payload.current_stages,
    beforeRestartEvolution.payload.current_stages,
  );
  const restoredProposal = await request(second.origin, `/api/roles/proposals/${encodeURIComponent(proposalId)}`);
  assert.deepEqual(restoredProposal.payload.proposal, beforeRestartProposal.payload.proposal);
  assert.deepEqual(restoredProposal.payload.decisions, beforeRestartProposal.payload.decisions);
  const restoredCandidate = await request(second.origin, `/api/world/candidates/${encodeURIComponent(candidateId)}`);
  assert.equal(restoredCandidate.response.status, 200);
  assert.deepEqual(restoredCandidate.payload.candidate, beforeRestartCandidate.payload.candidate);
  assert.deepEqual(second.persistence.list('world.candidate-decisions'), beforeRestartCandidateDecisions);
  const restoredWorld = await request(second.origin, '/api/life/world');
  const afterRestartLedger = await request(second.origin, '/api/world/mutations?limit=100');
  assert.equal(restoredWorld.payload.world_revision, acceptedWorldRevision);
  assert.deepEqual(
    afterRestartLedger.payload.mutations.map(mutation => mutation.mutation_id),
    beforeRestartLedger.payload.mutations.map(mutation => mutation.mutation_id),
  );
  const duplicateAcceptAfterRestart = await request(second.origin, `/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, 'POST', {
    expected_world_revision: -1,
  });
  assert.equal(duplicateAcceptAfterRestart.response.status, 200, JSON.stringify(duplicateAcceptAfterRestart.payload));
  assert.equal(duplicateAcceptAfterRestart.payload.duplicate, true);
  assert.equal((await request(second.origin, '/api/life/world')).payload.world_revision, acceptedWorldRevision);
  assert.deepEqual(
    (await request(second.origin, '/api/world/mutations?limit=100')).payload.mutations.map(mutation => mutation.mutation_id),
    beforeRestartLedger.payload.mutations.map(mutation => mutation.mutation_id),
  );
  const restoredChat = await request(second.origin, '/api/chat', 'POST', {
    event_id: 'p4-restored-chat',
    character_id: CHARACTER_ID,
    message: '你还记得我们试过的方向吗？',
  });
  assert.equal(restoredChat.response.status, 202);
  assert.match(restoredChat.payload.turn.prompt.text, /wetland_frog|荷叶青蛙/);
});
