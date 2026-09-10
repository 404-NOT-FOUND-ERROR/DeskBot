import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-09-07T08:00:00.000Z');

async function startServer() {
  const server = createDeskBotServer({ now: () => fixedTime, websocket: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function post(origin, path, body) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('research session captures turn/probe references without mutating world', async (t) => {
  const runtime = await startServer();
  t.after(runtime.close);

  const initial = await (await fetch(`${runtime.origin}/api/world`)).json();
  const chat = await post(runtime.origin, '/api/chat', {
    event_id: 'p3-session-chat-001',
    character_id: 'shaping-001',
    source: 'p3-test',
    message: '帮我列出今天的三个待办。',
  });
  assert.equal(chat.status, 202);
  const turn = await chat.json();
  assert.equal(turn.turn.turn_id, 'p3-session-chat-001');

  const started = await post(runtime.origin, '/api/research/sessions', {
    session_id: 'p3-session-001',
    character_id: 'shaping-001',
    label: 'P3 四类表达首轮',
    scenario_id: 'p3-real-multiturn-v0.1',
  });
  assert.equal(started.status, 201);

  const attached = await post(runtime.origin, '/api/research/sessions/p3-session-001/turns', {
    turn_id: 'p3-session-chat-001',
    category: 'direct_task',
  });
  assert.equal(attached.status, 202);
  const attachedBody = await attached.json();
  assert.equal(attachedBody.turn_ref.state_revision, turn.turn.state.state_revision);
  assert.equal(attachedBody.turn_ref.world_revision, turn.turn.canonical_world.snapshot.world_revision);
  assert.equal(attachedBody.turn_ref.interaction_route, 'reply_context');

  const observation = await post(runtime.origin, '/api/research/probe-observations', {
    observation_id: 'p3-session-p4-t1-001',
    probe_id: 'P4',
    character_id: 'shaping-001',
    time_sample: 'T1',
    raw_text: '我会留下第一次被认真听见的那一刻。',
    source: 'p3-test',
  });
  assert.equal(observation.status, 201);
  const probeAttach = await post(runtime.origin, '/api/research/sessions/p3-session-001/probes', {
    observation_id: 'p3-session-p4-t1-001',
  });
  assert.equal(probeAttach.status, 202);

  const completed = await post(runtime.origin, '/api/research/sessions/p3-session-001/complete', {});
  assert.equal(completed.status, 202);
  const session = await (await fetch(`${runtime.origin}/api/research/sessions/p3-session-001`)).json();
  assert.equal(session.session.status, 'completed');
  assert.equal(session.session.turn_refs.length, 1);
  assert.deepEqual(session.session.probe_observation_ids, ['p3-session-p4-t1-001']);

  const final = await (await fetch(`${runtime.origin}/api/world`)).json();
  assert.equal(final.world.world_revision, initial.world.world_revision + 1);
});

test('research session rejects unknown turns and conflicting categories', async (t) => {
  const runtime = await startServer();
  t.after(runtime.close);
  assert.equal((await post(runtime.origin, '/api/research/sessions', { session_id: 'p3-session-002' })).status, 201);
  const missing = await post(runtime.origin, '/api/research/sessions/p3-session-002/turns', { turn_id: 'missing-turn', category: 'fact_qa' });
  assert.equal(missing.status, 404);
  const missingProbe = await post(runtime.origin, '/api/research/sessions/p3-session-002/probes', { observation_id: 'missing-probe' });
  assert.equal(missingProbe.status, 404);
  assert.equal((await post(runtime.origin, '/api/research/sessions/p3-session-002/complete', {})).status, 202);
  const closedNote = await post(runtime.origin, '/api/research/sessions/p3-session-002/notes', { note: 'closed' });
  assert.equal(closedNote.status, 409);
});
