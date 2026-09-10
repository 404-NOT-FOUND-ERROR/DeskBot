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

test('device.hello event registers the device through the unified event input', async () => {
  const response = await fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'evt-device-hello-001',
      type: 'device.hello',
      source: 'vocat',
      device_id: 'vocat-event-001',
      character_id: 'ember-001',
      payload: {
        hardware: 'esp-vocat-v1.2',
        firmware: 'esp-claw-adapter-0.1.0',
        capabilities: { 'display.expression': true },
      },
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 202);
  assert.equal(body.device.device_id, 'vocat-event-001');
  assert.equal(body.device.capabilities['display.expression'], true);

  const device = await fetch(`${baseUrl}/api/devices/vocat-event-001`);
  const deviceBody = await device.json();
  assert.equal(device.status, 200);
  assert.equal(deviceBody.device.character_id, 'ember-001');
});

test('invalid device.hello through the unified event input returns a client error', async () => {
  const response = await fetch(`${baseUrl}/api/event`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'evt-device-hello-invalid-001',
      type: 'device.hello',
      source: 'vocat',
      device_id: 'vocat-event-invalid-001',
      character_id: 'ember-001',
      payload: {
        hardware: 'esp-vocat-v1.2',
        firmware: 'esp-claw-adapter-0.1.0',
        capabilities: { 'audio.capture': 'yes' },
      },
    }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_device_hello');
});
