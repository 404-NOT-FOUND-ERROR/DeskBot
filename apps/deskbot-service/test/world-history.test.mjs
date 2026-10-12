import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';

const at = () => new Date('2026-10-12T08:00:00.000Z');

function advance(world, eventId, minutes) {
  return world.ingest({
    event_id: eventId,
    type: 'world.mutation',
    source: 'history-test',
    character_id: 'shaping-001',
    occurred_at: at().toISOString(),
    payload: { action: 'advance_time', minutes },
  });
}

function recordDevice(world, eventId, metrics) {
  return world.ingest({ event_id: eventId, type: 'world.mutation', source: 'history-test',
    character_id: 'shaping-001', occurred_at: at().toISOString(),
    payload: { action: 'record_device_context', device_id: 'history-device', metrics } });
}

test('live history uses the same added, removed and optional field semantics as SQLite history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-history-fields-'));
  const filename = join(directory, 'world.sqlite');
  let persistence;
  try {
    persistence = createSqlitePersistence({ filename, now: at });
    const world = createPersistentWorld({ now: at, persistence });
    const initial = world.get();
    recordDevice(world, 'device-first', { temperature: 18, auxiliary: 11, unavailable: undefined,
      samples: [18, undefined, 20] });
    const first = world.get();
    recordDevice(world, 'device-second', { temperature: 19 });
    const second = world.get();
    recordDevice(world, 'device-third', { temperature: 20, auxiliary: 12 });
    const live = world.get();
    assert.deepEqual(live, persistence.get('canonical-world.states', live.world_id));
    assert.equal(Object.hasOwn(first.device_context.devices['history-device'].metrics, 'unavailable'), false);
    assert.deepEqual(first.device_context.devices['history-device'].metrics.samples, [18, null, 20]);
    for (const [sequence, expected] of [[0, initial], [1, first], [2, second], [3, live]]) {
      assert.deepEqual(world.readWorldAtSequence({ sequence }).world, expected);
    }
    assert.deepEqual(world.get(), live);
    assert.deepEqual(world.listMutations(), persistence.list('canonical-world.mutations'));
    const removed = world.listMutations()[1].changes.find(change => change.field_path.endsWith('/metrics/auxiliary'));
    assert.equal(Object.hasOwn(removed, 'new_value'), false);
    persistence.close();
    persistence = createSqlitePersistence({ filename, now: at });
    const recovered = createPersistentWorld({ now: at, persistence });
    for (const [sequence, expected] of [[0, initial], [1, first], [2, second], [3, live]]) {
      assert.deepEqual(recovered.readWorldAtSequence({ sequence }).world, expected);
    }
  } finally {
    persistence?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('historical world snapshots reverse durable diffs without changing the live world', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-history-'));
  const filename = join(directory, 'world.sqlite');
  try {
    const firstPersistence = createSqlitePersistence({ filename, now: at });
    const first = createPersistentWorld({ now: at, persistence: firstPersistence });
    const initial = first.get();
    advance(first, 'history-first', 20);
    const afterFirst = first.get();
    advance(first, 'history-second', 35);
    const live = first.get();
    assert.deepEqual(first.readWorldAtSequence({ sequence: 1 }).world.logical_time, afterFirst.logical_time);
    assert.deepEqual(first.readWorldAtSequence({ sequence: 0 }).world.logical_time, initial.logical_time);
    assert.deepEqual(first.readWorldAtSequence({ sequence: 2 }).world.logical_time, live.logical_time);
    assert.deepEqual(first.get(), live);
    assert.equal(first.listMutations().length, 2);
    firstPersistence.close();

    const secondPersistence = createSqlitePersistence({ filename, now: at });
    const second = createPersistentWorld({ now: at, persistence: secondPersistence });
    assert.deepEqual(second.readWorldAtSequence({ sequence: 1 }).world.logical_time, afterFirst.logical_time);
    assert.deepEqual(second.get(), live);
    const altered = secondPersistence.get('canonical-world.mutations', 'mutation-history-second');
    assert.ok(altered.changes.length > 0);
    altered.changes[0].new_value = 'not-the-saved-value';
    secondPersistence.put('canonical-world.mutations', altered.mutation_id, altered);
    secondPersistence.close();
    const corruptedPersistence = createSqlitePersistence({ filename, now: at });
    const corrupted = createPersistentWorld({ now: at, persistence: corruptedPersistence });
    assert.throws(() => corrupted.readWorldAtSequence({ sequence: 1 }), error => error.code === 'history_unavailable');
    corruptedPersistence.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('history cannot present the wrong target revision across an unrecorded migration', () => {
  const records = new Map();
  const persistence = {
    list: namespace => [...records.values()].filter(item => item.namespace === namespace).map(item => structuredClone(item.value)),
    put: (namespace, id, value) => records.set(`${namespace}:${id}`, { namespace, value: structuredClone(value) }),
  };
  const first = createPersistentWorld({ now: at, persistence });
  advance(first, 'gap-before', 10);
  const migrated = first.get();
  migrated.world_revision += 3;
  persistence.put('canonical-world.states', migrated.world_id, migrated);
  const second = createPersistentWorld({ now: at, persistence });
  advance(second, 'gap-after', 15);
  const live = second.get();
  assert.throws(() => second.readWorldAtSequence({ sequence: 1 }), error => {
    assert.equal(error.code, 'history_unavailable');
    assert.deepEqual(error.historyBoundary, { requested_sequence: 1, head_sequence: 2,
      available_from_sequence: 2, reason: 'target_revision_gap' });
    return true;
  });
  assert.throws(() => second.readWorldAtSequence({ sequence: 0 }), error => error.code === 'history_unavailable');
  assert.deepEqual(second.readWorldAtSequence({ sequence: 2 }).world, live);
  assert.deepEqual(second.get(), live);
});

test('duplicate durable sequences remain ambiguous rather than choosing one world branch', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-history-branch-'));
  const filename = join(directory, 'world.sqlite');
  let persistence;
  try {
    persistence = createSqlitePersistence({ filename, now: at });
    const world = createPersistentWorld({ now: at, persistence });
    advance(world, 'branch-first', 10);
    advance(world, 'branch-second', 15);
    const branch = persistence.get('canonical-world.mutations', 'mutation-branch-second');
    branch.mutation_id = 'mutation-branch-unexecuted';
    branch.event_id = 'branch-unexecuted';
    persistence.insert('canonical-world.mutations', branch.mutation_id, branch);
    persistence.close();
    persistence = createSqlitePersistence({ filename, now: at });
    const recovered = createPersistentWorld({ now: at, persistence });
    for (const sequence of [0, 1, 2]) {
      assert.throws(() => recovered.readWorldAtSequence({ sequence }), error => error.code === 'history_unavailable');
    }
  } finally {
    persistence?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('history HTTP view is read-only and rejects missing or malformed sequences', async t => {
  let wallTime = '2026-10-12T08:00:00.000Z';
  const server = createDeskBotServer({ now: () => new Date(wallTime), websocket: false });
  advance(server.persistentWorld, 'history-http-first', 15);
  const first = server.persistentWorld.get();
  wallTime = '2026-10-12T09:00:00.000Z';
  advance(server.persistentWorld, 'history-http-second', 45);
  const live = server.persistentWorld.get();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const result = await fetch(`${origin}/api/world/history/at?sequence=1`);
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.schema, 'deskbot.world-history-at.v1');
  assert.equal(body.map.world_revision, first.world_revision);
  assert.deepEqual(body.map.logical_time, first.logical_time);
  assert.equal(body.map.environment.projected_at, '2026-10-12T08:00:00.000Z');
  assert.equal(body.head_sequence, 2);
  assert.equal(body.mutation.mutation_id, 'mutation-history-http-first');
  assert.equal((await fetch(`${origin}/api/world/history/at?sequence=NaN`)).status, 400);
  assert.equal((await fetch(`${origin}/api/world/history/at?sequence=99`)).status, 404);
  assert.equal((await fetch(`${origin}/api/world/history/at?sequence=1`, { method: 'POST' })).status, 405);
  assert.deepEqual(server.persistentWorld.get(), live);
  assert.equal(server.persistentWorld.listMutations().length, 2);
});
