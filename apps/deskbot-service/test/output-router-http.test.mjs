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

test('chat output is available through the device outbox and ACK is retry-safe', async () => {
  const turnResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'turn-outbox-http-001',
      character_id: 'ember-001',
      device_id: 'vocat-001',
      message: '今天有点累',
    }),
  });
  const turn = await turnResponse.json();

  assert.equal(turnResponse.status, 202);
  assert.equal(turn.turn.output_route.duplicate, false);
  assert.equal(turn.turn.output_route.commands.length, 5);
  const commandId = turn.turn.output_route.commands[0].command_id;

  const duplicateTurnResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'turn-outbox-http-001',
      character_id: 'ember-001',
      device_id: 'vocat-001',
      message: '今天有点累',
    }),
  });
  const duplicateTurn = await duplicateTurnResponse.json();
  assert.equal(duplicateTurnResponse.status, 200);
  assert.equal(duplicateTurn.duplicate, true);
  assert.equal(duplicateTurn.turn.output_route.commands.length, 5);

  const listResponse = await fetch(`${baseUrl}/api/outbox?device_id=vocat-001`);
  const list = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(list.schema, 'foundry.device-command-list.v0.1');
  assert.equal(list.commands.length, 5);

  const ackResponse = await fetch(`${baseUrl}/api/outbox/${encodeURIComponent(commandId)}/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'completed', source: 'fake-device' }),
  });
  const ack = await ackResponse.json();
  assert.equal(ackResponse.status, 200);
  assert.equal(ack.duplicate, false);
  assert.equal(ack.command.status, 'completed');

  const duplicateAckResponse = await fetch(`${baseUrl}/api/outbox/${encodeURIComponent(commandId)}/ack`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'completed', source: 'fake-device' }),
  });
  const duplicateAck = await duplicateAckResponse.json();
  assert.equal(duplicateAckResponse.status, 200);
  assert.equal(duplicateAck.duplicate, true);

  const commandResponse = await fetch(`${baseUrl}/api/outbox/${encodeURIComponent(commandId)}`);
  const commandBody = await commandResponse.json();
  assert.equal(commandBody.command.status, 'completed');
});
