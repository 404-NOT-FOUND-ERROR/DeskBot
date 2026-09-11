import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { normalizeChat } from '../src/input-store.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');
const server = createDeskBotServer({ now: () => fixedTime });
let baseUrl;

test('omitted chat identity uses the canonical 聚形域 character', () => {
  const event = normalizeChat({ event_id: 'evt-canonical-default', message: '你好' }, { now: () => fixedTime });
  assert.equal(event.character_id, 'shaping-001');
});

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('POST /api/chat normalizes text into a conversation input event', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'evt-chat-001',
      character_id: 'ember-001',
      source: 'deskbot-web',
      message: '今天有点累',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.accepted, true);
  assert.equal(body.duplicate, false);
  assert.equal(body.event.type, 'conversation.input');
  assert.equal(body.event.source, 'deskbot-web');
  assert.equal(body.event.payload.text, '今天有点累');
  assert.equal(body.event.payload.role, 'user');
  assert.equal(body.pipeline.current, 'output-router');
  assert.equal(body.pipeline.next, 'device-outbox');
});

test('POST /api/chat preserves an assistant reply as a separate event type', async () => {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'evt-reply-001',
      character_id: 'ember-001',
      source: 'deskbot-web',
      role: 'assistant',
      message: '我会陪你慢一点。',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.event.type, 'conversation.reply');
  assert.equal(body.event.payload.role, 'assistant');
});

test('POST /api/event deduplicates the same event and rejects conflicting reuse', async () => {
  const event = {
    event_id: 'evt-sensor-001',
    type: 'sensor.imu',
    source: 'vocat',
    device_id: 'vocat-001',
    payload: { yaw_deg: 2 },
  };
  const first = await fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  const second = await fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  const conflict = await fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...event, payload: { yaw_deg: 8 } }),
  });
  const secondBody = await second.json();
  const conflictBody = await conflict.json();

  assert.equal(first.status, 202);
  assert.equal(second.status, 200);
  assert.equal(secondBody.duplicate, true);
  assert.equal(conflict.status, 409);
  assert.equal(conflictBody.error, 'event_id_conflict');
});

test('GET /api/events returns normalized input events for replay', async () => {
  const response = await fetch(`${baseUrl}/api/events?limit=10`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.schema, 'foundry.event-list.v0.1');
  assert.equal(body.events.length, 4);
  assert.deepEqual(body.events.map((event) => event.event_id), ['evt-chat-001', 'reply-evt-chat-001', 'evt-reply-001', 'evt-sensor-001']);
});

test('POST /api/chat runs a deterministic DeskBot turn with world context and output plan', async () => {
  const worldEvent = await fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'evt-world-late-night',
      type: 'world.time',
      source: 'clock',
      character_id: 'ember-001',
      payload: { local_hour: 23 },
    }),
  });
  assert.equal(worldEvent.status, 202);

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'turn-late-night-tired',
      character_id: 'ember-001',
      source: 'deskbot-web',
      message: '今天有点累',
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.turn.provider, 'fake-llm-v0.1');
  assert.equal(body.turn.analysis.label, 'sadness');
  assert.equal(body.turn.matched_conditions[0].label, 'late-night');
  assert.match(body.turn.prompt.text, /深夜/);
  assert.match(body.turn.prompt.text, /今天有点累/);
  assert.match(body.turn.reply, /已经很晚了/);
  assert.deepEqual(body.turn.output_plan.map((output) => output.type), ['render.expression', 'speak']);

  const duplicate = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'turn-late-night-tired',
      character_id: 'ember-001',
      source: 'deskbot-web',
      message: '今天有点累',
    }),
  });
  const duplicateBody = await duplicate.json();
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateBody.duplicate, true);
  assert.equal(duplicateBody.turn.reply, body.turn.reply);
});
