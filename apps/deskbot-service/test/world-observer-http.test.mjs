import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPersistentWorld, getWorldMap } from '../src/persistent-world.mjs';
import { createWorldObserver } from '../src/world-observer.mjs';

const fixed = new Date('2026-10-11T00:00:00.000Z');

test('HTTP observer endpoint returns bounded unified snapshot', async t => {
  const persistentWorld = createPersistentWorld({ now: () => fixed });
  const observer = createWorldObserver({ persistentWorld, now: () => fixed });
  const server = createServer((request, response) => observer.handleHttp(request, response));
  observer.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    observer.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/world/snapshot?feed_limit=2`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schema, 'deskbot.world-observer-snapshot.v1');
  assert.equal(body.map.world_revision, body.world_revision);
  assert.equal(body.feed.world_revision, body.world_revision);
  assert.equal(body.sequence, 0);
  assert.ok(body.snapshot_id.startsWith('world-snapshot:'));
});

test('observer resume returns a bounded current snapshot with an explicit catch-up marker', async t => {
  const persistentWorld = createPersistentWorld({ now: () => fixed });
  persistentWorld.ingest({ event_id: 'observer-resume-1', type: 'world.mutation', source: 'observer-test', character_id: 'shaping-001',
    occurred_at: fixed.toISOString(), payload: { action: 'advance_time', minutes: 15 } });
  const observer = createWorldObserver({ persistentWorld, now: () => fixed });
  const server = createServer(); observer.attach(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { observer.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); });
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/world/stream`);
  const messages = [];
  ws.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  const nextMessage = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('observer resume timed out')), 2_000);
    ws.addEventListener('message', event => { clearTimeout(timer); resolve(JSON.parse(event.data)); }, { once: true });
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const first = nextMessage();
  ws.send(JSON.stringify({ schema: 'deskbot.world-stream.v1', type: 'world.subscribe', after_sequence: 0 }));
  await first;
  assert.equal(messages[0].type, 'world.snapshot');
  assert.deepEqual(messages[0].resume, { from_sequence: 0, to_sequence: 1, mode: 'snapshot', history_available: true });
  assert.equal(messages[0].snapshot.feed.head_sequence, 1);
  const resumed = nextMessage();
  ws.send(JSON.stringify({ type: 'world.resync', after_sequence: 1 }));
  await resumed;
  assert.equal(messages.at(-1).type, 'world.snapshot');
  assert.equal(messages.at(-1).resume.history_available, false);
  ws.close();
});

test('long-lived observer excludes duplicated history while retaining current display facts', async t => {
  const persistentWorld = createPersistentWorld({ now: () => fixed });
  const baseline = persistentWorld.get();
  const map = getWorldMap(baseline);
  const audit = 'past decision detail '.repeat(80);
  map.tasks = [
    { task_id: 'current-work', actor_id: 'shaping-001', status: 'running', title: 'Care for seedlings', due_at: fixed.toISOString(), history: [{ text: audit }] },
    { task_id: 'paused-trip', actor_id: 'resident-001', status: 'paused', title: 'Visit the river', history: [{ text: audit }] },
    ...Array.from({ length: 200 }, (_, index) => ({ task_id: `finished-${index}`, status: 'completed', completion: { text: audit }, history: [{ text: audit }] })),
  ];
  map.memory = {
    owner_id: 'shaping-001', actors: [{ actor_id: 'shaping-001', interests: {} }],
    recent: [{ id: 'memory-1', text: 'Cared for seedlings today', actor_ids: ['shaping-001'] }],
    own: Array.from({ length: 24 }, (_, index) => ({ id: `own-${index}`, text: `Memory ${index}`, actor_ids: ['shaping-001'] })),
    development: { enabled: true, facets: { actors: [{ actor_id: 'shaping-001', topics: [{ topic: 'care', root_outcome_ids: ['actual-1'] }] }] },
      recent: Array.from({ length: 48 }, (_, index) => ({ root_outcome_id: `result-${index}`, actor_ids: ['shaping-001'], title: `Actual result ${index}` })) },
    planner: { enabled: true, requests: Array.from({ length: 60 }, (_, index) => ({ actor_id: `resident-${index}`, status: 'complete', prompt: audit, response: audit })), recent: [{ text: audit }] },
  };
  map.autonomy = { actors: [{ actor_id: 'shaping-001', energy: 0.8, appetite: 0.5, plan: { status: 'executing', title: 'Care for seedlings', reason: 'Seedlings need water', steps: [{ kind: 'activity' }] },
    last_candidates: [{ text: audit }], cooldowns: { audit } }], cadence: { history: Array.from({ length: 40 }, () => audit) }, recent: [] };
  map.social = { commitments: [{ id: 'now', status: 'accepted' }, { id: 'past', status: 'fulfilled', changes: [{ text: audit }] }], residents: Array.from({ length: 20 }, () => ({ audit })), relationships: {}, recent: [] };
  map.npcs = [{ npc_id: 'resident-001', display_name: 'A-Li', location_id: map.protagonist.location_id, status: 'travelling',
    recent_interactions: Array.from({ length: 15 }, () => ({ text: audit })), last_response: audit }];
  map.refraction = { records: Array.from({ length: 30 }, (_, index) => ({ id: `input-${index}`, status: index === 2 ? 'pending' : 'observed', category: index === 0 ? 'weather' : 'external', text: audit })), source_status: [{ id: 'weather', status: 'ready' }] };
  const rawMap = structuredClone(map);
  assert.ok(Buffer.byteLength(JSON.stringify(map)) > 512 * 1024);
  const observer = createWorldObserver({ persistentWorld, now: () => fixed, mapReadModel: () => map,
    worldLife: { snapshot: world => ({ world_revision: world.world_revision, current_task: { task_id: 'current-work' } }) },
    roleWishes: world => ({ world_revision: world.world_revision, evolution: { wishes: { directions: [{ direction_id: 'care' }] } } }) });
  const server = createServer((request, response) => observer.handleHttp(request, response));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { observer.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); });

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/world/snapshot`);
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get('content-length')) < 512 * 1024);
  const snapshot = await response.json();
  assert.deepEqual(snapshot.map.tasks.map(task => task.task_id), ['current-work', 'paused-trip']);
  assert.equal(snapshot.map.tasks[0].history, undefined);
  assert.equal(snapshot.map.autonomy.actors[0].plan.reason, 'Seedlings need water');
  assert.equal(snapshot.map.autonomy.actors[0].energy, 0.8);
  assert.equal(snapshot.map.memory.recent[0].text, 'Cared for seedlings today');
  assert.equal(snapshot.map.memory.planner.requests[0].status, 'complete');
  assert.equal(snapshot.map.memory.planner.requests[0].prompt, undefined);
  assert.equal(snapshot.map.memory.development.facets.actors[0].topics[0].root_outcome_ids[0], 'actual-1');
  assert.equal(snapshot.map.social.commitments[0].id, 'now');
  assert.equal(snapshot.map.refraction.records.some(record => record.id === 'input-2'), true);
  assert.equal(snapshot.map.npcs[0].display_name, 'A-Li');
  assert.deepEqual(snapshot.role_wishes.evolution.wishes.directions, [{ direction_id: 'care' }]);
  assert.deepEqual(map, rawMap);
  assert.deepEqual(persistentWorld.get(), baseline);
});

test('WebSocket observer requires explicit subscribe and streams read-only updates', async t => {
  const persistentWorld = createPersistentWorld({ now: () => fixed });
  const observer = createWorldObserver({ persistentWorld, now: () => fixed, heartbeatMs: 60_000 });
  const server = createServer();
  observer.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/api/world/stream`);
  const messages = [];
  const first = new Promise((resolve, reject) => {
    ws.addEventListener('message', event => { const body = JSON.parse(event.data); messages.push(body); resolve(body); }, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  t.after(async () => {
    ws.close(); observer.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  ws.send(JSON.stringify({ schema: 'deskbot.world-stream.v1', type: 'world.subscribe', feed_limit: 2 }));
  const snapshot = await first;
  assert.equal(snapshot.type, 'world.snapshot');
  assert.equal(snapshot.snapshot.world_revision, 0);
  persistentWorld.ingest({ event_id: 'observer-http-update-001', type: 'world.mutation', source: 'observer-test', character_id: 'shaping-001',
    occurred_at: fixed.toISOString(), payload: { action: 'advance_time', minutes: 15 } });
  const update = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for world.update')), 2_000);
    ws.addEventListener('message', event => { const body = JSON.parse(event.data); if (body.type === 'world.update') { clearTimeout(timer); resolve(body); } });
  });
  assert.equal(update.sequence, 1);
  assert.equal(update.snapshot.world_revision, 1);
  ws.send(JSON.stringify({ type: 'world.mutation', payload: { action: 'advance_time', minutes: 999 } }));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(persistentWorld.get().world_revision, 1);
  assert.equal(messages[0].snapshot.world_revision, 0);
});

test('resident-rich observer preserves actual facets and fits both HTTP and WebSocket bounds', async t => {
  const persistentWorld = createPersistentWorld({ now: () => fixed });
  const before = persistentWorld.get();
  const map = getWorldMap(before);
  const actorIds = Array.from({ length: 13 }, (_, index) => index ? `resident-${index}` : 'shaping-001');
  const unusedExplanation = 'No actual practice is established. '.repeat(80);
  map.memory = {
    owner_id: 'shaping-001', own: [], recent: [], actors: actorIds.map(actor_id => ({ actor_id })),
    development: {
      recent: [],
      facets: { actors: actorIds.map(actor_id => ({ actor_id, topics: [
        { topic: 'care', contact: { count: 1 }, interest: { status: 'trying', active_roots: ['actual-interest'] },
          capability: { status: 'practiced', root_outcome_ids: ['actual-practice'] }, self_assessment: { status: 'evidence_summary' } },
        { topic: 'new-contact', contact: { count: 1 }, interest: { status: 'unobserved' }, capability: { status: 'unobserved' }, self_assessment: { status: 'unobserved' } },
        ...Array.from({ length: 6 }, (_, index) => ({ topic: `unused-${index}`, contact: { count: 0 },
          interest: { status: 'unobserved', summary: unusedExplanation },
          capability: { status: 'unobserved', summary: unusedExplanation },
          self_assessment: { status: 'unobserved', summary: unusedExplanation } })),
      ] })) },
    },
  };
  map.autonomy = { actors: actorIds.map(actor_id => ({ actor_id, energy: 0.8,
    last_feedback: { at: fixed.toISOString(), text: 'Cared for seedlings', kind: 'completed',
      action_feedback: { authority: 'audit_only', receipt_id: actor_id, detailed_receipt: unusedExplanation } } })),
    recent: [{ actor_id: actorIds[0], text: 'Cared for seedlings', action_feedback: { authority: 'audit_only', detailed_receipt: unusedExplanation } }],
  };
  const rawMap = structuredClone(map);
  assert.ok(Buffer.byteLength(JSON.stringify(map)) > 512 * 1024);
  const observer = createWorldObserver({ persistentWorld, now: () => fixed, mapReadModel: () => map, heartbeatMs: 60_000 });
  const server = createServer((request, response) => observer.handleHttp(request, response));
  observer.attach(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  let socket;
  t.after(async () => { socket?.close(); observer.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(origin + '/api/world/snapshot');
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get('content-length')) < 512 * 1024);
  const snapshot = await response.json();
  assert.deepEqual(snapshot.map.memory.development.facets.actors.map(actor => actor.actor_id), actorIds);
  for (const actor of snapshot.map.memory.development.facets.actors) {
    assert.deepEqual(actor.topics.map(topic => topic.topic), ['care', 'new-contact']);
    assert.deepEqual(actor.topics[0].capability.root_outcome_ids, ['actual-practice']);
  }
  assert.equal(snapshot.map.autonomy.actors[0].last_feedback.text, 'Cared for seedlings');
  assert.equal(snapshot.map.autonomy.actors[0].last_feedback.action_feedback, undefined);
  assert.equal(snapshot.map.autonomy.recent[0].action_feedback, undefined);
  socket = new WebSocket(origin.replace('http', 'ws') + '/api/world/stream');
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const initial = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bounded observer stream timed out')), 2_000);
    socket.addEventListener('message', event => { clearTimeout(timer); resolve(JSON.parse(event.data)); }, { once: true });
  });
  socket.send(JSON.stringify({ schema: 'deskbot.world-stream.v1', type: 'world.subscribe' }));
  const streamed = await initial;
  assert.equal(streamed.type, 'world.snapshot');
  assert.ok(Buffer.byteLength(JSON.stringify(streamed)) < 512 * 1024);
  assert.deepEqual(streamed.snapshot, snapshot);
  assert.deepEqual(map, rawMap);
  assert.deepEqual(persistentWorld.get(), before);
});
