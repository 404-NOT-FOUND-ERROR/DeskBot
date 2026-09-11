import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createContextSourceRegistry } from '../src/context-sources.mjs';

const fixedTime = new Date('2026-09-04T08:00:00.000Z');

test('runtime context exposes an auditable live server clock and unconfigured provider slots', () => {
  const context = createContextSourceRegistry({ now: () => fixedTime }).snapshot();

  assert.equal(context.schema, 'foundry.runtime-context.v0.1');
  assert.deepEqual(context.real_time, {
    source_id: 'clock',
    status: 'active',
    freshness: 'live',
    timezone: 'Asia/Shanghai',
    iso_utc: fixedTime.toISOString(),
    local_date: '2026-09-04',
    local_time: '16:00:00',
    weekday: '星期五',
    display: '2026年09月04日 星期五 16:00',
  });
  assert.deepEqual(
    context.sources.map((source) => [source.source_id, source.enabled, source.status]),
    [['clock', true, 'active'], ['weather', false, 'not_configured'], ['news', false, 'not_configured'], ['custom', false, 'not_configured']],
  );
});

test('context endpoint gives the LLM a live server clock without replacing the character reply', async (t) => {
  let capturedPrompt = null;
  const server = createDeskBotServer({
    now: () => fixedTime,
    websocket: false,
    llm: {
      async complete({ prompt }) {
        capturedPrompt = prompt;
        return { provider: 'test-llm', model: 'test-llm', text: '我这边已经下午四点了。你那边要看所在时区；如果也在中国标准时间，就是同一时间。', trace: {} };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const contextResponse = await fetch(`${origin}/api/context`);
  const context = await contextResponse.json();
  assert.equal(contextResponse.status, 200);
  assert.equal(context.real_time.display, '2026年09月04日 星期五 16:00');

  const connectionResponse = await fetch(`${origin}/api/connections`);
  const connections = await connectionResponse.json();
  assert.equal(connectionResponse.status, 200);
  assert.equal(connections.real_time.iso_utc, fixedTime.toISOString());

  const chatResponse = await fetch(`${origin}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'clock-chat-001',
      character_id: 'shaping-001',
      source: 'clock-test',
      message: '你那里几点，我现在又是几点？',
    }),
  });
  const chat = await chatResponse.json();
  assert.equal(chatResponse.status, 202);
  assert.equal(chat.turn.provider, 'test-llm');
  assert.equal(chat.turn.reply, '我这边已经下午四点了。你那边要看所在时区；如果也在中国标准时间，就是同一时间。');
  assert.equal(chat.turn.runtime_context.real_time.local_time, '16:00:00');
  assert.equal(chat.turn.canonical_world.snapshot.logical_time.day, 1);
  assert.ok(capturedPrompt);
  assert.match(capturedPrompt, /2026年09月04日 星期五 16:00/);
  assert.match(capturedPrompt, /禁止只输出日期、时间、时区或固定系统模板/);
  assert.match(capturedPrompt, /不?知道用户所在地/);
});
