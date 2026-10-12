import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createWorldObserver } from '../src/world-observer.mjs';

const fixed = new Date('2026-10-11T00:00:00.000Z');

function makeWorld() {
  return createPersistentWorld({ now: () => fixed, timeMode: 'simulation' });
}

test('observer snapshot is one canonical read projection and does not mutate world', () => {
  const world = makeWorld();
  const observer = createWorldObserver({
    persistentWorld: world,
    now: () => fixed,
    roleWishes: snapshot => ({ schema: 'test.role-wishes.v1', world_revision: snapshot.world_revision }),
    worldLife: { snapshot: snapshot => ({ schema: 'test.life.v1', world_revision: snapshot.world_revision }) },
  });
  const before = world.get();
  const snapshot = observer.buildSnapshot({ requestedFeedLimit: 4 });
  assert.equal(snapshot.schema, 'deskbot.world-observer-snapshot.v1');
  assert.equal(snapshot.world_revision, snapshot.map.world_revision);
  assert.equal(snapshot.world_revision, snapshot.life.world_revision);
  assert.equal(snapshot.world_revision, snapshot.feed.world_revision);
  assert.equal(snapshot.world_revision, snapshot.role_wishes.world_revision);
  assert.equal(snapshot.sequence, 0);
  assert.deepEqual(world.get(), before);
  observer.close();
});

test('observer emits a single ordered update after an accepted canonical mutation', () => {
  const world = makeWorld();
  const received = [];
  const observer = createWorldObserver({ persistentWorld: world, now: () => fixed });
  const unsubscribe = world.subscribeMutations(mutation => received.push(mutation));
  world.ingest({
    event_id: 'observer-test-time-001', type: 'world.mutation', source: 'observer-test',
    character_id: 'shaping-001', occurred_at: fixed.toISOString(),
    payload: { action: 'advance_time', minutes: 15 },
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].after_revision, 1);
  assert.equal(observer.buildSnapshot().world_revision, 1);
  unsubscribe(); observer.close();
});
