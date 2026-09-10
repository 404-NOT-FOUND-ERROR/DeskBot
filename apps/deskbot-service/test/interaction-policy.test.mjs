import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-09-07T08:00:00.000Z');

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
      event: { event_id: 'echo-001', title: '一阵回响', summary: '桌面世界出现一件小事', arc_id: 'opening' },
    },
  });
  assert.equal(world.response.status, 202);
  assert.equal(world.body.interaction_decision.route, 'proactive_candidate');
  assert.equal(world.body.interaction_decision.audience, 'proactive_queue');
  assert.match(world.body.interaction_decision.reason, /不自动打断/);

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
  assert.match(capturedPrompt, /不能自动打断或强行播报/);
  assert.match(capturedPrompt, /没有自然关联时保持安静/);
});
