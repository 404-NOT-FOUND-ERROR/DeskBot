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

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test('GET /health returns the service identity', async () => {
  const response = await fetch(`${baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    schema: 'foundry.health.v0.1',
    service: 'deskbot-service',
    status: 'ok',
    version: '0.1.0',
    time: fixedTime.toISOString(),
  });
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('unknown routes return JSON 404 responses', async () => {
  const response = await fetch(`${baseUrl}/missing`);
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.deepEqual(body, {
    error: 'not_found',
    path: '/missing',
  });
});
