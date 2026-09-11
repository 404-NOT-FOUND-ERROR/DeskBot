import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { LlmProviderError } from '../src/llm.mjs';

const server = createDeskBotServer({
  websocket: false,
  llm: {
    async complete() {
      throw new LlmProviderError('llm_http_error', 'LLM endpoint returned HTTP 401', {
        status: 401,
        retryable: false,
      });
    },
  },
});
let origin;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

test('chat exposes provider failures as a diagnostic 502 without sensitive details', async () => {
  const response = await fetch(`${origin}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: 'llm-http-error-001', character_id: 'miaowu-001', message: '连接测试' }),
  });
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.deepEqual(body, {
    error: 'llm_http_error',
    message: 'LLM endpoint returned HTTP 401',
    retryable: false,
    provider_status: 401,
  });
});
