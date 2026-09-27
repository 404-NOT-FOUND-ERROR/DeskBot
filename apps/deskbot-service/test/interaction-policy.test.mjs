import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createInteractionPolicy, PROACTIVE_ACTIONS, PROACTIVE_STATES } from '../src/interaction-policy.mjs';

const fixedTime = new Date('2026-09-07T08:00:00.000Z');

function createMemoryPersistence() {
  const tables = new Map();
  return {
    list(table) { return [...(tables.get(table)?.values() ?? [])].map((value) => structuredClone(value)); },
    put(table, key, value) {
      if (!tables.has(table)) tables.set(table, new Map());
      tables.get(table).set(key, structuredClone(value));
    },
  };
}

function createPolicyHarness(options = {}) {
  let current = new Date(fixedTime);
  const persistence = createMemoryPersistence();
  const policy = createInteractionPolicy({
    now: () => new Date(current),
    persistence,
    proactiveTtlMs: 1000,
    consideredCooldownMs: 100,
    deferredMs: 500,
    ...options,
  });
  return {
    policy,
    persistence,
    advance(ms) { current = new Date(current.getTime() + ms); },
    get now() { return new Date(current); },
  };
}

function worldLineEvent(eventId, characterId = 'shaping-001') {
  return {
    event_id: eventId,
    type: 'world.mutation',
    source: 'world-engine',
    character_id: characterId,
    layer: 'world_line',
    payload: {
      action: 'apply_world_line_event',
      event: { event_id: `story-${eventId}`, title: '雾灯镇的异响', summary: '今晚旧路的灯比平常暗。' },
    },
  };
}

async function post(origin, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test('multisource events are classified without becoming direct announcements', async (t) => {
  const server = createDeskBotServer({ now: () => fixedTime, websocket: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const world = await post(origin, '/api/event', {
    event_id: 'policy-world-001',
    type: 'world.mutation',
    source: 'world-engine',
    character_id: 'shaping-001',
    layer: 'world_line',
    source_kind: 'world_engine',
    payload: {
      action: 'apply_world_line_event',
      event: { event_id: 'echo-001', title: '一阵回响', summary: '桌面世界出现一件小事', daily_consequence: '杯里的倒影比动作慢半拍。', opportunity: '可以观察下一次倒影迟到。', unresolved_hook: '倒影里少了一颗星。', arc_id: 'opening' },
    },
  });
  assert.equal(world.response.status, 202);
  assert.equal(world.body.interaction_decision.route, 'proactive_candidate');
  assert.equal(world.body.interaction_decision.audience, 'proactive_queue');
  assert.equal(world.body.interaction_decision.relevance, 0.82);
  assert.equal(world.body.interaction_decision.interrupt_cost, 0.48);
  assert.match(world.body.interaction_decision.reason, /不自动打断/);
  assert.equal(world.body.interaction_decision.candidate.daily_consequence, '杯里的倒影比动作慢半拍。');
  assert.equal(world.body.interaction_decision.candidate.opportunity, '可以观察下一次倒影迟到。');
  assert.equal(world.body.interaction_decision.candidate.unresolved_hook, '倒影里少了一颗星。');

  const device = await post(origin, '/api/event', {
    event_id: 'policy-device-001',
    type: 'sensor.presence',
    source: 'vocat',
    character_id: 'shaping-001',
    device_id: 'vocat-001',
    payload: { state: 'near' },
  });
  assert.equal(device.response.status, 202);
  assert.equal(device.body.interaction_decision.route, 'record_only');

  const decisions = await (await fetch(`${origin}/api/interaction/decisions?limit=10`)).json();
  assert.equal(decisions.schema, 'foundry.interaction-decision-list.v0.1');
  assert.ok(decisions.decisions.some((item) => item.event_id === 'policy-world-001'));
  assert.ok(decisions.decisions.some((item) => item.event_id === 'policy-device-001'));
});

test('a chat event enters the current reply while prior world events remain optional candidates', async (t) => {
  let capturedPrompt = null;
  const server = createDeskBotServer({
    now: () => fixedTime,
    websocket: false,
    llm: {
      async complete({ prompt }) {
        capturedPrompt = prompt;
        return { provider: 'policy-test', model: 'policy-test', text: '先把你眼前这件事处理好。', trace: {} };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;

  await post(origin, '/api/event', {
    event_id: 'policy-world-002',
    type: 'world.mutation',
    source: 'world-engine',
    character_id: 'shaping-001',
    payload: {
      action: 'apply_world_line_event',
      event: { event_id: 'echo-002', title: '新的回响', summary: '可选的世界线话题' },
    },
  });
  const chat = await post(origin, '/api/chat', {
    event_id: 'policy-chat-001',
    character_id: 'shaping-001',
    source: 'deskbot-web',
    message: '帮我把今天的任务拆成两步',
  });
  assert.equal(chat.response.status, 202);
  assert.equal(chat.body.turn.interaction_decision.route, 'reply_context');
  assert.equal(chat.body.turn.proactive_candidates.length, 1);
  assert.equal(chat.body.turn.proactive_candidates[0].candidate.topic, 'world_line_event');
  assert.ok(capturedPrompt);
  assert.match(capturedPrompt, /\[DESKBOT_INTERACTION_DECISION\]/);
  assert.match(capturedPrompt, /这里只给一个可选关联话题，不是必须提及的通知/);
  assert.match(capturedPrompt, /没有自然关联时保持安静/);
});

test('settings are isolated per character and survive policy recreation', () => {
  const { policy, persistence } = createPolicyHarness();
  assert.equal(policy.getSettings('shaping-001').proactive_enabled, true);
  assert.equal(policy.getSettings('other-character').quiet_until, null);

  const quietUntil = '2026-09-07T10:00:00.000Z';
  const updated = policy.updateSettings({ characterId: 'shaping-001', proactiveEnabled: false, quietUntil });
  assert.equal(updated.proactive_enabled, false);
  assert.equal(policy.quietReason('shaping-001'), '角色主动性已关闭。');
  assert.equal(policy.getSettings('other-character').proactive_enabled, true);

  const restored = createInteractionPolicy({ now: () => new Date(fixedTime), persistence });
  assert.equal(restored.getSettings('shaping-001').quiet_until, quietUntil);
  assert.equal(restored.getSettings('shaping-001').proactive_enabled, false);
  assert.equal(restored.getSettings('other-character').proactive_enabled, true);
});

test('candidate lifecycle distinguishes considered, deferred, dismissed, consumed and reopened states', () => {
  const { policy, advance } = createPolicyHarness();
  policy.evaluate({ event: worldLineEvent('lifecycle-001') });
  assert.equal(policy.listCandidates()[0].proactive_status, PROACTIVE_STATES.QUEUED);

  const firstPrompt = policy.forPrompt({ characterId: 'shaping-001' });
  assert.equal(firstPrompt.length, 1);
  assert.equal(firstPrompt[0].proactive_status, PROACTIVE_STATES.CONSIDERED);
  assert.equal(firstPrompt[0].surfaced_count, 1);
  assert.deepEqual(policy.forPrompt({ characterId: 'shaping-001' }), []);

  const ignored = policy.resolveCandidate('lifecycle-001', { action: PROACTIVE_ACTIONS.IGNORE });
  assert.equal(ignored.proactive_status, PROACTIVE_STATES.CONSIDERED);
  assert.equal(ignored.ignored_count, 1);
  assert.equal(ignored.last_ignored_at, fixedTime.toISOString());
  assert.equal(policy.forPrompt({ characterId: 'shaping-001' }).length, 0);

  advance(101);
  assert.equal(policy.forPrompt({ characterId: 'shaping-001' }).length, 1);
  const deferred = policy.resolveCandidate('lifecycle-001', { action: PROACTIVE_ACTIONS.DEFER });
  assert.equal(deferred.proactive_status, PROACTIVE_STATES.DEFERRED);
  assert.equal(deferred.deferred_count, 1);
  assert.equal(policy.forPrompt({ characterId: 'shaping-001' }).length, 0);

  advance(501);
  assert.equal(policy.forPrompt({ characterId: 'shaping-001' }).length, 1);
  assert.equal(policy.resolveCandidate('lifecycle-001', { action: PROACTIVE_ACTIONS.DISMISS, reason: 'not relevant' }).proactive_status, PROACTIVE_STATES.DISMISSED);
  assert.equal(policy.listCandidates({ status: PROACTIVE_STATES.DISMISSED }).length, 1);
  assert.equal(policy.forPrompt({ characterId: 'shaping-001' }).length, 0);

  assert.equal(policy.resolveCandidate('lifecycle-001', { action: PROACTIVE_ACTIONS.REOPEN }).proactive_status, PROACTIVE_STATES.QUEUED);
  assert.equal(policy.forPrompt({ characterId: 'shaping-001' }).length, 1);
  assert.equal(policy.resolveCandidate('lifecycle-001', { action: PROACTIVE_ACTIONS.CONSUME, reason: 'used in reply' }).proactive_status, PROACTIVE_STATES.CONSUMED);
  assert.equal(policy.listCandidates({ status: PROACTIVE_STATES.CONSUMED }).length, 1);
  assert.equal(policy.forPrompt({ characterId: 'shaping-001' }).length, 0);
});

test('candidate listing is character-scoped and TTL expiry is persisted', () => {
  const { policy, persistence, advance } = createPolicyHarness();
  policy.evaluate({ event: worldLineEvent('scoped-001') });
  policy.evaluate({ event: worldLineEvent('scoped-002', 'other-character') });
  assert.equal(policy.listCandidates({ characterId: 'shaping-001' }).length, 1);
  assert.equal(policy.listCandidates({ characterId: 'other-character' }).length, 1);
  assert.equal(policy.listCandidates({ characterId: 'shaping-001', route: 'record_only' }).length, 0);

  advance(1001);
  assert.deepEqual(policy.forPrompt({ characterId: 'shaping-001' }), []);
  assert.equal(policy.listCandidates({ characterId: 'shaping-001', status: PROACTIVE_STATES.EXPIRED })[0].proactive_status, PROACTIVE_STATES.EXPIRED);
  const restored = createInteractionPolicy({ now: () => new Date(fixedTime), persistence });
  assert.equal(restored.listCandidates({ characterId: 'shaping-001' })[0].proactive_status, PROACTIVE_STATES.EXPIRED);
});

test('candidate HTTP read model exposes provenance and reversible lifecycle actions', async (t) => {
  const server = createDeskBotServer({ now: () => fixedTime, websocket: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const accepted = await post(origin, '/api/event', {
    event_id: 'policy-http-candidate-001',
    type: 'world.mutation',
    source: 'world-engine',
    character_id: 'shaping-001',
    layer: 'world_line',
    occurred_at: fixedTime.toISOString(),
    payload: { action: 'apply_world_line_event', event: { event_id: 'http-story-001', title: '候选读模型测试', summary: '这件事先留在队列里。', opportunity: '可以稍后观察。' } },
  });
  assert.equal(accepted.response.status, 202);

  const listed = await (await fetch(`${origin}/api/interaction/candidates?character_id=shaping-001&limit=10`)).json();
  assert.equal(listed.schema, 'foundry.interaction-candidate-list.v0.1');
  assert.equal(listed.settings.proactive_enabled, true);
  assert.equal(listed.candidates.length, 1);
  assert.equal(listed.candidates[0].source, 'world-engine');
  assert.equal(listed.candidates[0].layer, 'world_line');
  assert.equal(listed.candidates[0].candidate.opportunity, '可以稍后观察。');
  assert.equal(listed.candidates[0].ignored_count, 0);
  assert.equal(listed.candidates[0].relevance, 0.82);
  assert.equal(listed.candidates[0].interrupt_cost, 0.48);

  const deferred = await post(origin, '/api/interaction/candidates/policy-http-candidate-001', {
    character_id: 'shaping-001', action: 'defer', deferred_until: '2026-09-08T08:00:00.000Z', reason: '等用户有空再看',
  });
  assert.equal(deferred.response.status, 200);
  assert.equal(deferred.body.candidate.proactive_status, 'deferred');
  assert.equal(deferred.body.candidate.deferred_count, 1);

  const filtered = await (await fetch(`${origin}/api/interaction/candidates?character_id=shaping-001&status=deferred`)).json();
  assert.equal(filtered.candidates.length, 1);
  assert.equal(filtered.candidates[0].event_id, 'policy-http-candidate-001');

  const reopened = await post(origin, '/api/interaction/candidates/policy-http-candidate-001', { character_id: 'shaping-001', action: 'reopen' });
  assert.equal(reopened.body.candidate.proactive_status, 'queued');
  assert.equal(reopened.body.candidate.deferred_until, null);
});
