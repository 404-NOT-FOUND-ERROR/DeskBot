import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import {
  createConfiguredLlm,
  createOpenAiCompatibleLlm,
  LlmConfigurationError,
  LlmProviderError,
  loadLlmConfiguration,
} from '../src/llm.mjs';

const testDirectory = mkdtempSync(join(tmpdir(), 'deskbot-llm-'));
after(() => rmSync(testDirectory, { recursive: true, force: true }));

test('fake LLM remains the default and needs no secret', async () => {
  const llm = createConfiguredLlm({ env: {} });
  const result = await llm.complete({
    userText: '你好',
    state: { interaction: { expression: 'neutral' } },
    worldConditions: [],
  });
  assert.equal(result.provider, 'fake-llm-v0.1');
});

test('explicit local configuration loads without exposing the API key', () => {
  const configPath = join(testDirectory, 'llm-config.json');
  writeFileSync(configPath, JSON.stringify({
    base_url: 'https://example.invalid/v1',
    api_key: 'test-secret-value',
    model: 'test-model',
  }));
  const configuration = loadLlmConfiguration({
    env: { DESKBOT_LLM_PROVIDER: 'deepseek', DESKBOT_LLM_CONFIG: configPath },
  });

  assert.equal(configuration.base_url, 'https://example.invalid/v1');
  assert.equal(configuration.model, 'test-model');
  assert.equal(JSON.stringify({ provider: configuration.provider, model: configuration.model }).includes('test-secret-value'), false);
});

test('OpenAI-compatible provider sends a text-only request and accepts assistant text', async () => {
  let request;
  const llm = createOpenAiCompatibleLlm({
    base_url: 'https://api.example/v1',
    api_key: 'not-a-real-secret',
    model: 'deepseek-chat',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { content: '  我听见了。  ' }, finish_reason: 'stop' }],
        usage: { total_tokens: 12 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await llm.complete({ prompt: '[DESKBOT_ROLE]\n只输出正文。' });
  const payload = JSON.parse(request.init.body);
  assert.equal(request.url, 'https://api.example/v1/chat/completions');
  assert.deepEqual(payload.messages, [{ role: 'user', content: '[DESKBOT_ROLE]\n只输出正文。' }]);
  assert.equal(payload.stream, false);
  assert.equal(result.text, '我听见了。');
  assert.equal(result.model, 'deepseek-chat');
  assert.equal(Object.hasOwn(result, 'state'), false);
});

test('provider errors report status but do not echo response bodies or credentials', async () => {
  const llm = createOpenAiCompatibleLlm({
    base_url: 'https://api.example/v1',
    api_key: 'secret-that-must-not-appear',
    model: 'deepseek-chat',
    fetchImpl: async () => new Response('sensitive upstream body', { status: 401 }),
  });

  await assert.rejects(
    () => llm.complete({ prompt: 'hello' }),
    (error) => error instanceof LlmProviderError
      && error.status === 401
      && !error.message.includes('sensitive upstream body')
      && !error.message.includes('secret-that-must-not-appear'),
  );
});

test('real provider requires an explicit complete configuration', () => {
  assert.throws(
    () => loadLlmConfiguration({ env: { DESKBOT_LLM_PROVIDER: 'deepseek' } }),
    (error) => error instanceof LlmConfigurationError && /base_url/.test(error.message),
  );
});
