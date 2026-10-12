import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createDeskBotServer } from '../src/app.mjs';

const fixed = new Date('2026-10-11T00:00:00.000Z');

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('world stream message timeout')), 2000);
    socket.addEventListener('message', event => { clearTimeout(timer); resolve(JSON.parse(event.data)); }, { once: true });
  });
}
async function connect(origin) {
  const socket = new WebSocket(origin.replace('http', 'ws') + '/api/world/stream');
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  return socket;
}

test('app exposes one read snapshot and dispatches world and device upgrades without racing', async t => {
  const server = createDeskBotServer({ now: () => fixed, websocket: true, worldLifeEnabled: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.worldObserver.close(); server.websocketBridge.close(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const before = server.persistentWorld.get();
  const snapshot = await (await fetch(origin + '/api/world/snapshot')).json();
  assert.equal(snapshot.schema, 'deskbot.world-observer-snapshot.v1');
  assert.equal(snapshot.map.world_revision, before.world_revision);
  assert.equal(snapshot.life.world_revision, before.world_revision);
  assert.equal(snapshot.feed.world_revision, before.world_revision);
  assert.equal(snapshot.role_wishes.world_revision, before.world_revision);
  assert.equal(snapshot.role_wishes.evolution.schema, 'deskbot.role-evolution-public.v1');
  assert.equal(snapshot.role_wishes.evolution.evidence, undefined);
  assert.deepEqual(server.persistentWorld.get(), before);
  assert.equal((await fetch(origin + '/api/world/snapshot', { method: 'POST', body: JSON.stringify({ action: 'advance_time', minutes: 999 }) })).status, 405);
  const socket = await connect(origin); const initial = nextMessage(socket);
  socket.send(JSON.stringify({ schema: 'deskbot.world-stream.v1', type: 'world.subscribe' }));
  const first = await initial;
  assert.equal(first.type, 'world.snapshot');
  assert.equal(first.snapshot.map.world_revision, first.snapshot.life.world_revision);
  const updatePromise = nextMessage(socket);
  server.persistentWorld.ingest({ event_id: 'observer-app-time-001', type: 'world.mutation', source: 'test', character_id: 'shaping-001',
    occurred_at: fixed.toISOString(), payload: { action: 'advance_time', minutes: 15 } });
  const update = await updatePromise;
  assert.equal(update.type, 'world.update');
  assert.equal(update.sequence, first.sequence + 1);
  assert.equal(update.snapshot.map.world_revision, update.snapshot.role_wishes.world_revision);
  assert.equal(update.mutation.changes, undefined);
  socket.close();
  // The firmware endpoint continues to perform its own hello contract.
  const device = new WebSocket(origin.replace('http', 'ws') + '/ws');
  await new Promise((resolve, reject) => { device.addEventListener('open', resolve, { once: true }); device.addEventListener('error', reject, { once: true }); });
  assert.ok(server.websocketBridge);
  device.close();
});

test('app reconnect starts from latest canonical sequence with no duplicate mutation', async t => {
  const server = createDeskBotServer({ now: () => fixed, websocket: false });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.worldObserver.close(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const event = { event_id: 'observer-app-reconnect', type: 'world.mutation', source: 'test', character_id: 'shaping-001',
    occurred_at: fixed.toISOString(), payload: { action: 'advance_time', minutes: 15 } };
  server.persistentWorld.ingest(event);
  const socket = await connect(origin); const initial = nextMessage(socket);
  socket.send(JSON.stringify({ schema: 'deskbot.world-stream.v1', type: 'world.subscribe' }));
  const first = await initial; assert.equal(first.sequence, 1); socket.close();
  assert.equal(server.persistentWorld.ingest(event).duplicate, true);
  const reconnect = await connect(origin); const snapshot = nextMessage(reconnect);
  reconnect.send(JSON.stringify({ schema: 'deskbot.world-stream.v1', type: 'world.subscribe', after_sequence: 0 }));
  const result = await snapshot;
  assert.equal(result.sequence, first.sequence);
  assert.equal(result.snapshot.world_revision, 1);
  assert.equal(server.persistentWorld.listMutations().length, 1);
  reconnect.close();
});
