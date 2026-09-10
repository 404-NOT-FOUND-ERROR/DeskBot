import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');
const server = createDeskBotServer({ now: () => fixedTime });
let baseUrl;

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

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('chat turn exposes evidence and idempotent device outbox', async () => {
  await post('/api/event', {
    event_id: 'evt-integration-late-night',
    type: 'world.time',
    source: 'clock',
    character_id: 'ember-001',
    payload: { local_hour: 23 },
  });

  const chatResponse = await post('/api/chat', {
    event_id: 'turn-integration-001',
    source: 'deskbot-web',
    character_id: 'ember-001',
    device_id: 'vocat-001',
    message: '今天有点累',
  });
  const turnBody = await chatResponse.json();

  assert.equal(chatResponse.status, 202);
  assert.equal(turnBody.turn.evidence.input.eligibility.status, 'candidate');
  assert.equal(turnBody.turn.evidence.reply.eligibility.status, 'audit_only');
  assert.equal(turnBody.turn.output_route.commands.length, 5);
  assert.ok(turnBody.turn.output_route.commands.every((command) => command.command_id.startsWith('cmd-')));

  const evidenceResponse = await fetch(`${baseUrl}/api/evidence?character_id=ember-001`);
  const evidenceBody = await evidenceResponse.json();
  assert.equal(evidenceResponse.status, 200);
  assert.equal(evidenceBody.evidence.length, 3);

  const outboxResponse = await fetch(`${baseUrl}/api/outbox?device_id=vocat-001&target=vocat`);
  const outboxBody = await outboxResponse.json();
  assert.equal(outboxResponse.status, 200);
  assert.equal(outboxBody.commands.length, 2);

  const command = outboxBody.commands.find((item) => item.type === 'speak');
  const ackResponse = await post(`/api/outbox/${encodeURIComponent(command.command_id)}/ack`, {
    status: 'completed',
    source: 'fake-device',
    payload: { simulated: true },
  });
  const ackBody = await ackResponse.json();
  assert.equal(ackResponse.status, 200);
  assert.equal(ackBody.duplicate, false);
  assert.equal(ackBody.command.status, 'completed');

  const duplicateAckResponse = await post(`/api/outbox/${encodeURIComponent(command.command_id)}/ack`, {
    status: 'completed',
    source: 'fake-device',
    payload: { simulated: false },
  });
  const duplicateAckBody = await duplicateAckResponse.json();
  assert.equal(duplicateAckResponse.status, 200);
  assert.equal(duplicateAckBody.duplicate, true);
  assert.equal(duplicateAckBody.command.acknowledgment.payload.simulated, true);
});
