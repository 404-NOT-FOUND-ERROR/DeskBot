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

const hello = {
  device_id: 'vocat-hello-001',
  hardware: 'esp-vocat-v1.2',
  firmware: 'esp-claw-adapter-0.1.0',
  shell_interface: 'shell-interface.v1',
  character_id: 'ember-001',
  capabilities: {
    'audio.capture': true,
    'audio.playback': true,
    'display.expression': true,
    'orientation.base_yaw': true,
    'orientation.head_yaw': false,
  },
};

test('device hello is exposed as an idempotent capability handshake', async () => {
  const first = await fetch(`${baseUrl}/api/devices/hello`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(hello),
  });
  const firstBody = await first.json();
  assert.equal(first.status, 201);
  assert.equal(firstBody.duplicate, false);
  assert.equal(firstBody.device.capabilities['orientation.head_yaw'], false);

  const second = await fetch(`${baseUrl}/api/devices/hello`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(hello),
  });
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.duplicate, true);

  const list = await fetch(`${baseUrl}/api/devices`);
  const listBody = await list.json();
  assert.equal(list.status, 200);
  assert.equal(listBody.devices.length, 1);
  assert.equal(listBody.devices[0].device_id, 'vocat-hello-001');
});
