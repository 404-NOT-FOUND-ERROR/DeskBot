import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createDeskBotServer } from '../src/app.mjs';

async function startServer(t, options = {}) {
  const server = createDeskBotServer({ websocket: false, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(origin, path, method = 'GET', body) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

test('P3 gate: corrected relationship memory, explicit commitment and continuity reports stay auditable', async t => {
  let now = new Date('2026-09-26T08:00:00.000Z');
  let capturedPrompt = '';
  const origin = await startServer(t, {
    now: () => now,
    llm: {
      async complete({ prompt }) {
        capturedPrompt = prompt;
        return { provider: 'p3-gate', model: 'p3-gate', text: '我先记下这次变化。', trace: {} };
      },
    },
  });

  const unconfirmed = await request(origin, '/api/life/memories', 'POST', {
    id: 'p3-memory-old', text: '喜欢旧路', evidence_ref: 'p3-test', confirmed: false,
  });
  assert.equal(unconfirmed.response.status, 400);
  assert.equal(unconfirmed.payload.error, 'confirmation_required');

  const saved = await request(origin, '/api/life/memories', 'POST', {
    id: 'p3-memory-old', character_id: 'shaping-001', text: '喜欢旧路', evidence_ref: 'p3-test-1', confirmed: true,
  });
  assert.equal(saved.response.status, 200);
  const oldChat = await request(origin, '/api/chat', 'POST', {
    event_id: 'p3-old-chat', character_id: 'shaping-001', source: 'p3-gate', message: '我喜欢旧路',
  });
  assert.equal(oldChat.response.status, 202);

  now = new Date('2026-09-26T08:00:01.000Z');
  const corrected = await request(origin, '/api/life/memories', 'POST', {
    id: 'p3-memory-new', character_id: 'shaping-001', text: '现在更喜欢潮痕旧路',
    fact_key: 'preferred-route', supersedes_id: 'p3-memory-old', evidence_ref: 'p3-test-2', confirmed: true,
  });
  assert.equal(corrected.response.status, 200);
  const memories = await request(origin, '/api/life/memories?character_id=shaping-001');
  assert.deepEqual(memories.payload.memories.map(item => item.id), ['p3-memory-new']);

  await request(origin, '/api/chat', 'POST', {
    event_id: 'p3-corrected-chat', character_id: 'shaping-001', source: 'p3-gate', message: '记得我的偏好吗',
  });
  assert.match(capturedPrompt, /现在更喜欢潮痕旧路/);
  assert.doesNotMatch(capturedPrompt, /我喜欢旧路/);

  const missingConfirmation = await request(origin, '/api/life/commitments', 'POST', {
    id: 'p3-walk', text: '明天一起看旧路', evidence_ref: 'p3-turn', confirmed: false,
  });
  assert.equal(missingConfirmation.response.status, 400);
  const commitment = await request(origin, '/api/life/commitments', 'POST', {
    id: 'p3-walk', character_id: 'shaping-001', text: '明天一起看旧路',
    due_at: '2026-09-27T08:00:00.000Z', evidence_ref: 'p3-turn', confirmed: true,
  });
  assert.equal(commitment.payload.status, 'open');
  const continuity = await request(origin, '/api/life/continuity?character_id=shaping-001');
  assert.equal(continuity.payload.open_commitments[0].id, 'p3-walk');
  const resolved = await request(origin, '/api/life/commitments', 'POST', {
    operation: 'resolve', id: 'p3-walk', status: 'kept', evidence_ref: 'p3-turn-done', confirmed: true,
  });
  assert.equal(resolved.payload.status, 'kept');
});

test('P3 gate: daily summary is preview-only until materialized and carries evidence IDs', async t => {
  const origin = await startServer(t, { now: () => new Date('2026-09-26T09:00:00.000Z') });
  const before = await request(origin, '/api/life/daily-summaries?character_id=shaping-001');
  assert.deepEqual(before.payload.summaries, []);
  const preview = await request(origin, '/api/life/daily-summary?day=1&character_id=shaping-001');
  assert.equal(preview.payload.summary.status, 'empty');
  assert.deepEqual(preview.payload.summary.evidence_ids, []);
  const materialized = await request(origin, '/api/life/daily-summary', 'POST', {
    operation: 'materialize', day: 1, character_id: 'shaping-001',
  });
  assert.equal(materialized.payload.summary.status, 'empty');
  const after = await request(origin, '/api/life/daily-summaries?character_id=shaping-001');
  assert.equal(after.payload.summaries.length, 1);
  assert.equal(after.payload.summaries[0].id, materialized.payload.summary.id);
});
