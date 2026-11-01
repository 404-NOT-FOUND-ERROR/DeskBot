import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request } from 'node:http';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');
const server = createDeskBotServer({ now: () => fixedTime });
let baseUrl;

// OS-assigned loopback ports may be in Fetch's browser blocked-port list.
// Exercise the HTTP server directly so that port allocation cannot fail a test
// before any request reaches the application.
function send(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, res => {
      let text = '';res.setEncoding('utf8');res.on('data', chunk => {text += chunk;});
      res.on('error', reject);res.on('end', () => {
        try { resolve({status:res.statusCode,body:JSON.parse(text)}); } catch(error) { reject(error); }
      });
    });
    req.on('error', reject);req.end(options.body);
  });
}

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
  const response = await send(`${baseUrl}/api/event`, {
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
  const body = response.body;

  assert.equal(response.status, 202);
  assert.equal(body.device.device_id, 'vocat-event-001');
  assert.equal(body.device.capabilities['display.expression'], true);

  const device = await send(`${baseUrl}/api/devices/vocat-event-001`);
  const deviceBody = device.body;
  assert.equal(device.status, 200);
  assert.equal(deviceBody.device.character_id, 'ember-001');
});

test('invalid device.hello through the unified event input returns a client error', async () => {
  const response = await send(`${baseUrl}/api/event`, {
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
  const body = response.body;

  assert.equal(response.status, 400);
  assert.equal(body.error, 'invalid_device_hello');
});
