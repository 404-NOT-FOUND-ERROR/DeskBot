import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createNpcGoals } from '../src/npc-goals.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createWorldLife } from '../src/world-life.mjs';

function createMemoryPersistence() {
  const records = new Map();
  let clockWrites = 0;
  let failClockWrite = null;
  const namespace = (name) => {
    if (!records.has(name)) records.set(name, new Map());
    return records.get(name);
  };
  return {
    get(name, id) { return namespace(name).get(id) ?? null; },
    list(name) { return [...namespace(name).values()]; },
    put(name, id, value) {
      if (name === 'canonical-world.wall-clock') {
        clockWrites += 1;
        if (clockWrites === failClockWrite) throw new Error('simulated clock marker write failure');
      }
      namespace(name).set(id, structuredClone(value));
      return value;
    },
    insert(name, id, value) {
      if (namespace(name).has(id)) throw new Error(`duplicate record ${id}`);
      namespace(name).set(id, structuredClone(value));
      return value;
    },
    transaction(operation) { return operation(); },
    failOnClockWrite(index) { failClockWrite = index; },
  };
}

const T0 = Date.parse('2026-09-20T00:00:00.000Z');

test('wall clock anchors once, keeps sub-minute remainder, and bounds each catch-up step', () => {
  let clock = new Date(T0);
  const persistence = createMemoryPersistence();
  const world = createPersistentWorld({ now: () => new Date(clock), persistence });

  const anchor = world.syncWallClock();
  assert.equal(anchor.anchored, true);
  assert.equal(anchor.advanced_minutes, 0);

  clock = new Date(T0 + 90_000);
  const first = world.syncWallClock({ maxCatchUpMinutes: 4 });
  assert.equal(first.advanced_minutes, 1);
  assert.equal(first.remainder_ms, 30_000);
  assert.equal(first.pending_minutes, 0);
  assert.equal(world.get().logical_time.minute_of_day, 481);

  clock = new Date(T0 + 11 * 60_000 + 30_000);
  const second = world.syncWallClock({ maxCatchUpMinutes: 4 });
  assert.equal(second.advanced_minutes, 4);
  assert.equal(second.pending_minutes, 6);
  assert.equal(second.remainder_ms, 30_000);
  const third = world.syncWallClock({ maxCatchUpMinutes: 4 });
  assert.equal(third.advanced_minutes, 4);
  assert.equal(third.pending_minutes, 2);
  const fourth = world.syncWallClock({ maxCatchUpMinutes: 4 });
  assert.equal(fourth.advanced_minutes, 2);
  assert.equal(fourth.pending_minutes, 0);
  assert.equal(fourth.remainder_ms, 30_000);
  assert.equal(world.get().logical_time.minute_of_day, 491);
});

test('wall clock retries the persisted in-flight segment after a marker commit failure', () => {
  let clock = new Date(T0);
  const persistence = createMemoryPersistence();
  const world = createPersistentWorld({ now: () => new Date(clock), persistence });
  world.syncWallClock();
  clock = new Date(T0 + 5 * 60_000);
  persistence.failOnClockWrite(3);

  assert.throws(() => world.syncWallClock(), /simulated clock marker write failure/);
  assert.equal(world.get().logical_time.minute_of_day, 485);
  const wallEvents = world.listMutations().filter((item) => item.event_source === 'world-wall-clock');
  assert.equal(wallEvents.length, 1);
  const eventId = wallEvents[0].event_id;

  const recovered = world.syncWallClock();
  assert.equal(recovered.recovered_pending_step, true);
  assert.equal(recovered.duplicate, true);
  assert.equal(recovered.advanced_minutes, 0);
  assert.equal(recovered.event_id, eventId);
  assert.equal(world.get().logical_time.minute_of_day, 485);
  assert.equal(world.listMutations().filter((item) => item.event_source === 'world-wall-clock').length, 1);
});

test('wall clock startup catches up after SQLite restart without reapplying a segment', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-wall-clock-'));
  const filename = join(directory, 'world.sqlite');
  let clock = new Date(T0);
  let persistence = createSqlitePersistence({ filename, now: () => new Date(clock) });
  let server = createDeskBotServer({ now: () => new Date(clock), persistence, websocket: false, worldLifeEnabled: false });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    assert.equal(persistence.get('canonical-world.wall-clock', 'deskbot-small-world').last_wall_at, clock.toISOString());
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));

    clock = new Date(T0 + 17 * 60_000);
    persistence.close();
    persistence = createSqlitePersistence({ filename, now: () => new Date(clock) });
    server = createDeskBotServer({ now: () => new Date(clock), persistence, websocket: false, worldLifeEnabled: false });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const world = persistence.get('canonical-world.states', 'deskbot-small-world');
    assert.equal(world.logical_time.minute_of_day, 497);
    assert.equal(persistence.get('canonical-world.wall-clock', 'deskbot-small-world').last_wall_at, clock.toISOString());
    const wallEvents = persistence.list('canonical-world.mutations').filter((item) => item.event_source === 'world-wall-clock');
    assert.deepEqual(wallEvents.map((item) => item.details.minutes), [17]);
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(() => resolve()));
    persistence.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('replay has independent idempotency and later wall time advances only its unprocessed interval', () => {
  let clock = new Date(T0);
  const persistence = createMemoryPersistence();
  const now = () => new Date(clock);
  const world = createPersistentWorld({ now, persistence });
  const goals = createNpcGoals({ now, persistence, worldSnapshot: () => world.get(), ingest: (event) => world.ingest(event) });
  const life = createWorldLife({ now, worldSnapshot: () => world.get(), ingest: (event) => world.ingest(event), npcGoals: goals });
  world.syncWallClock();

  const replay = life.replay({ minutes: 120, replay_id: 'clock-independent-replay' });
  const replayedTime = world.get().logical_time.minute_of_day;
  const replayAgain = life.replay({ minutes: 120, replay_id: 'clock-independent-replay' });
  assert.equal(replayAgain.steps.every((step) => step.duplicate), true);
  assert.equal(world.get().logical_time.minute_of_day, replayedTime);
  assert.ok(replay.steps.every((step) => step.event_id.startsWith('world-life-replay:')));

  clock = new Date(T0 + 2 * 60_000);
  const wallClock = world.syncWallClock();
  assert.equal(wallClock.advanced_minutes, 2);
  assert.equal(world.get().logical_time.minute_of_day, replayedTime + 2);
  assert.equal(world.listMutations().filter((item) => item.event_source === 'world-wall-clock').length, 1);
});

test('wall-clock synchronization is disabled without persistence', () => {
  const world = createPersistentWorld({ now: () => new Date(T0) });
  assert.deepEqual(world.syncWallClock(), { enabled: false, reason: 'persistence_required' });
});
