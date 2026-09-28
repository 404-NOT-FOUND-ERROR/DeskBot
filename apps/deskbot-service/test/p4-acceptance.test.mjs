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

async function startRuntime(t, { databasePath, now, llm }) {
  const persistence = createSqlitePersistence({ filename: databasePath, now });
  const server = createDeskBotServer({
    now,
    persistence,
    llm,
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

async function postMutation(origin, eventId, payload, source = 'p4-acceptance') {
  const result = await request(origin, '/api/event', 'POST', {
    event_id: eventId,
    type: 'world.mutation',
    source,
    character_id: CHARACTER_ID,
    occurred_at: fixedTime.toISOString(),
    payload,
  });
  assert.ok(result.response.status === 202 || result.response.status === 200, JSON.stringify(result.payload));
  return result;
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

  let now = () => fixedTime;
  const firstPrompts = [];
  first = await startRuntime(t, { databasePath, now, llm: makeLlm(firstPrompts) });

  // A direct transformation command is an input/evidence event, not a role
  // mutation. It must leave the canonical world and accepted role unchanged.
  const beforeWorld = (await request(first.origin, '/api/life/world')).payload;
  const beforeStages = (await request(first.origin, `/api/roles/proposals?character_id=${CHARACTER_ID}&status=accepted`)).payload;
  const direct = await request(first.origin, '/api/chat', 'POST', {
    event_id: 'p4-direct-transform-command',
    character_id: CHARACTER_ID,
    message: '你现在就变成青蛙吧。',
  });
  assert.equal(direct.response.status, 202);
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

  // Three independent source layers satisfy the existing candidate threshold.
  await postMutation(first.origin, 'p4-weather-001', {
    action: 'update_weather',
    snapshot: { location: '上海', condition: '连续下雨', observed_at: fixedTime.toISOString() },
  }, 'qweather');
  await postMutation(first.origin, 'p4-preference-001', {
    action: 'observe_user_preference',
    preference_key: 'walk.place',
    value: '池塘散步',
  }, 'user-profile');
  await postMutation(first.origin, 'p4-worldline-001', {
    action: 'apply_world_line_event',
    event: {
      event_id: 'p4-worldline-event',
      title: '荷叶在雨里亮起来了',
      summary: '湿地边出现一条适合青蛙观察的新路。',
    },
  }, 'world-life');

  const pulls = await request(first.origin, `/api/roles/pulls?character_id=${CHARACTER_ID}`);
  const pull = pulls.payload.pulls.find(item => item.direction_id === 'wetland_frog');
  assert.equal(pull?.status, 'candidate');
  // The user's earlier chat is also a valid interaction evidence layer. The
  // gate requires the three independent external layers, while allowing that
  // fourth source to contribute to the same direction.
  for (const source of ['user_profile', 'weather', 'world_line']) {
    assert.ok(pull.sources.includes(source), `missing independent source ${source}`);
  }
  assert.ok(pull.sources.length >= 3);

  // The evolution sync is intentionally separate from accepting a role: it
  // may create a proposal, but it cannot silently enter a trial or stage.
  const synced = await request(first.origin, '/api/roles/evolution/sync', 'POST', { character_id: CHARACTER_ID });
  assert.equal(synced.response.status, 200);
  assert.equal(synced.payload.accepted, true);
  assert.ok(Array.isArray(synced.payload.created), JSON.stringify(synced.payload));
  // Inputs auto-sync after ingestion, so this explicit replay may be a
  // duplicate. The durable proposal is the contract, not which request
  // happened to materialize it.
  const proposalList = await request(first.origin, `/api/roles/proposals?character_id=${CHARACTER_ID}`);
  const proposed = proposalList.payload.proposals.filter(item => item.status === 'proposed');
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].status, 'proposed');
  const proposalId = proposed[0].proposal_id;

  // Replaying the same source events and sync is idempotent.
  const duplicate = await postMutation(first.origin, 'p4-weather-001', {
    action: 'update_weather',
    snapshot: { location: '上海', condition: '连续下雨', observed_at: fixedTime.toISOString() },
  }, 'qweather');
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
    window_turns: 2,
  });
  assert.equal(started.payload.proposal.trial.status, 'active');

  for (const [index, message] of ['今天去看看池塘', '我喜欢这段湿地观察'].entries()) {
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
  assert.equal(trialAfterTurns.payload.proposal.trial.turns_observed, 2);

  const accepted = await request(first.origin, `/api/roles/proposals/${encodeURIComponent(proposalId)}/trial/complete`, 'POST', {
    decision: 'accepted',
    reason: '两次共同生活观察都愿意继续',
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
  const worldLife = await request(first.origin, '/api/life/world');
  assert.equal(worldLife.response.status, 200);
  assert.equal(worldLife.payload.role_context?.current_stage?.direction_id, 'wetland_frog');
  assert.equal(worldLife.payload.role_context?.stages?.[0]?.direction_id, 'wetland_frog');
  const acceptedWorldRevision = worldLife.payload.world_revision;
  await first.close();

  const restoredPrompts = [];
  second = await startRuntime(t, { databasePath, now, llm: makeLlm(restoredPrompts) });
  const restoredView = await getRoleView(second.origin);
  assert.equal(restoredView.response.status, 200);
  assert.equal(restoredView.payload.current_stages[0].direction_id, 'wetland_frog');
  assert.equal(restoredView.payload.proposals.find(item => item.proposal_id === proposalId).status, 'accepted');
  const restoredWorld = await request(second.origin, '/api/life/world');
  assert.equal(restoredWorld.payload.world_revision, acceptedWorldRevision);
  const restoredChat = await request(second.origin, '/api/chat', 'POST', {
    event_id: 'p4-restored-chat',
    character_id: CHARACTER_ID,
    message: '你还记得我们试过的方向吗？',
  });
  assert.equal(restoredChat.response.status, 202);
  assert.match(restoredChat.payload.turn.prompt.text, /wetland_frog|荷叶青蛙/);
});
