import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createWorldLife } from '../src/world-life.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');
const testDirectory = mkdtempSync(join(tmpdir(), 'deskbot-world-restart-'));
const databasePath = join(testDirectory, 'deskbot.sqlite');

after(() => rmSync(testDirectory, { recursive: true, force: true }));

function voiceChat(eventId) {
  return {
    event_id: eventId,
    type: 'conversation.input',
    source: 'deskbot-chat',
    occurred_at: fixedTime.toISOString(),
    character_id: 'ember-001',
    correlation_id: 'restart-voice-turn-001',
    payload: { role: 'user', text: '记住这一刻' },
  };
}

test('world snapshot, ledger, event idempotency, and correlation index survive restart', () => {
  const firstPersistence = createSqlitePersistence({ filename: databasePath, now: () => fixedTime });
  const first = createPersistentWorld({ now: () => fixedTime, persistence: firstPersistence });
  first.ingest(voiceChat('restart-chat-001'));
  first.ingest({
    event_id: 'restart-time-001',
    type: 'world.mutation',
    source: 'world-controller',
    occurred_at: fixedTime.toISOString(),
    character_id: 'ember-001',
    correlation_id: null,
    payload: { action: 'advance_time', minutes: 45 },
  });
  firstPersistence.close();

  const secondPersistence = createSqlitePersistence({ filename: databasePath, now: () => fixedTime });
  const second = createPersistentWorld({ now: () => fixedTime, persistence: secondPersistence });
  assert.equal(second.get().world_revision, 2);
  assert.equal(second.get().logical_time.minute_of_day, 525);
  assert.equal(second.get().interaction.user_turn_count, 1);
  assert.deepEqual(second.listMutations().map((record) => record.sequence), [1, 2]);

  const repeatedEvent = second.ingest(voiceChat('restart-chat-001'));
  const repeatedCorrelation = second.ingest(voiceChat('restart-chat-002'));
  assert.equal(repeatedEvent.reason, 'event_already_applied');
  assert.equal(repeatedCorrelation.reason, 'correlation_already_counted');
  assert.equal(second.get().world_revision, 2);
  assert.equal(second.listMutations().length, 2);
  secondPersistence.close();
});

function worldEvent(eventId, payload, occurredAt = fixedTime.toISOString()) {
  return { event_id: eventId, type: 'world.mutation', source: 'restart-test',
    source_kind: 'world_engine', character_id: 'shaping-001', occurred_at: occurredAt, payload };
}

function observeLedgerReads(persistence) {
  const reads = { streamed: 0, hydrated: [] };
  return {
    reads,
    persistence: {
      ...persistence,
      list(namespace) {
        assert.notEqual(namespace, 'canonical-world.mutations', 'the durable ledger must never be materialized as one array');
        return persistence.list(namespace);
      },
      *iterate(namespace) {
        for (const record of persistence.iterate(namespace)) {
          if (namespace === 'canonical-world.mutations') reads.streamed += 1;
          yield record;
        }
      },
      get(namespace, recordId) {
        if (namespace === 'canonical-world.mutations') reads.hydrated.push(recordId);
        return persistence.get(namespace, recordId);
      },
    },
  };
}

test('streamed ledger restart hydrates bounded reads while preserving complete history, feed and idempotency', t => {
  const filename = join(testDirectory, 'streamed-ledger.sqlite');
  let persistence = createSqlitePersistence({ filename, now: () => fixedTime });
  t.after(() => persistence.close());
  const first = createPersistentWorld({ now: () => fixedTime, persistence });
  const initial = first.get();
  createWorldLife({ now: () => fixedTime, worldSnapshot: () => first.get(),
    ingest: event => first.ingest(event), listMutations: options => first.listMutations(options) }).tick();
  first.ingest(voiceChat('streamed-chat-001'));
  const afterChat = first.get();
  // The first ledger page is smaller than a long-lived world's cursor. Noise
  // must not force feed reads or restoration indexes to hydrate full diffs.
  for (let index = 0; index < 205; index += 1) {
    first.ingest(worldEvent(`streamed-clock-${index}`, { action: 'advance_time', minutes: 1 }));
  }
  const live = first.get();
  const expectedFeed = first.listLifeFeed({ limit: 200 });
  const originalChat = first.listMutations({ eventId: 'streamed-chat-001' })[0];
  const lastMutation = first.listMutations({ afterSequence: 209, limit: 1 })[0];
  assert.equal(lastMutation.sequence, 210);
  persistence.close();
  persistence = createSqlitePersistence({ filename, now: () => fixedTime });
  const observed = observeLedgerReads(persistence);
  const recovered = createPersistentWorld({ now: () => fixedTime, persistence: observed.persistence });
  assert.equal(observed.reads.streamed, 210);
  assert.deepEqual(observed.reads.hydrated, [], 'restoration streams once without retaining diff payloads for keyed reads');
  assert.deepEqual(recovered.get(), live);
  assert.deepEqual(recovered.listLifeFeed({ limit: 200 }), expectedFeed);
  assert.equal(recovered.readSnapshot().sequence, 210);
  assert.deepEqual(observed.reads.hydrated, [], 'live world/feed projection reads need no ledger hydration');

  const page = recovered.listMutations({ afterSequence: 208, limit: 2 });
  assert.deepEqual(page.map(record => record.sequence), [209, 210]);
  assert.equal(observed.reads.hydrated.length, 2);
  assert.deepEqual(page.at(-1), lastMutation);
  page.at(-1).changes.length = 0;
  page.at(-1).details.minutes = 999;
  assert.deepEqual(recovered.listMutations({ afterSequence: 209, limit: 1 })[0], lastMutation);

  observed.reads.hydrated.length = 0;
  const scenes = recovered.listMutations({ action: 'set_life_scene', includeChanges: false, limit: 200 });
  assert.equal(scenes.length, 1);
  assert.equal(Object.hasOwn(scenes[0], 'changes'), false);
  assert.equal(observed.reads.hydrated.length, 1, 'action filtering excludes every unrelated large diff before hydration');
  scenes[0].details.scene.title = 'changed only in returned copy';
  assert.notEqual(recovered.listMutations({ action: 'set_life_scene', includeChanges: false })[0].details.scene.title, scenes[0].details.scene.title);

  observed.reads.hydrated.length = 0;
  assert.deepEqual(recovered.readWorldAtSequence({ sequence: 209 }).world.logical_time,
    { ...live.logical_time, minute_of_day: live.logical_time.minute_of_day - 1, tick: live.logical_time.tick - 1 });
  assert.equal(observed.reads.hydrated.length, 1, 'reverse history loads one diff at a time from the selected tail');
  assert.deepEqual(recovered.readWorldAtSequence({ sequence: 5 }).world, afterChat);
  assert.deepEqual(recovered.readWorldAtSequence({ sequence: 0 }).world, initial);

  observed.reads.hydrated.length = 0;
  const duplicate = recovered.ingest(voiceChat('streamed-chat-001'));
  assert.equal(duplicate.reason, 'event_already_applied');
  assert.deepEqual(duplicate.mutation, originalChat);
  const correlated = recovered.ingest(voiceChat('streamed-chat-002'));
  assert.equal(correlated.reason, 'correlation_already_counted');
  assert.deepEqual(correlated.mutation, originalChat);
  assert.equal(observed.reads.hydrated.length, 2);
  duplicate.mutation.changes.length = 0;
  assert.deepEqual(recovered.ingest(voiceChat('streamed-chat-001')).mutation, originalChat);
  const feed = recovered.listLifeFeed({ limit: 200 });
  feed[0].text = 'changed only in returned copy';
  assert.deepEqual(recovered.listLifeFeed({ limit: 200 }), expectedFeed);
  assert.deepEqual(recovered.get(), live, 'every restore, duplicate, history and feed read leaves canonical state untouched');
});

test('world-life restores all consumed causal scenes without hydrating unrelated ledger diffs', t => {
  const filename = join(testDirectory, 'causal-scene-index.sqlite');
  let clock = new Date('2026-09-17T02:00:00.000Z');
  const now = () => new Date(clock);
  let persistence = createSqlitePersistence({ filename, now });
  t.after(() => persistence.close());
  const first = createPersistentWorld({ now, persistence });
  const life = createWorldLife({ now, worldSnapshot: () => first.get(), ingest: event => first.ingest(event),
    listMutations: options => first.listMutations(options) });
  life.tick();
  first.ingest(worldEvent('causal-index-road', { action: 'move_protagonist', location_id: 'tidal-old-road' }, now().toISOString()));
  life.interact({ interaction_id: 'causal-index-route', npc_id: 'pathfinder-001', intent: 'help' });
  const consumed = life.tick().current_scene;
  assert.equal(consumed.branch_key, 'tide-path-shared-route');
  for (let index = 0; index < 205; index += 1) {
    first.ingest(worldEvent(`causal-index-noise-${index}`, { action: 'advance_time', minutes: 1 }, now().toISOString()));
  }
  for (let index = 0; index < 14; index += 1) {
    first.ingest(worldEvent(`causal-index-later-scene-${index}`, { action: 'set_life_scene', scene: {
      scene_id: `causal-index-scene-${index}`, template_id: 'later-scene', location_id: 'tidal-old-road',
      title: '路边后来的一件小事', slot_key: `later-${index}`, started_at: now().toISOString(),
    } }, now().toISOString()));
  }
  const sceneMutationIds = first.listMutations({ action: 'set_life_scene', limit: 200 }).map(record => record.mutation_id);
  assert.ok(!first.get().life.recent_scenes.some(scene => scene.scene_id === consumed.scene_id));
  persistence.close();
  clock = new Date('2026-10-11T02:00:00.000Z');
  persistence = createSqlitePersistence({ filename, now });
  const observed = observeLedgerReads(persistence);
  const recovered = createPersistentWorld({ now, persistence: observed.persistence });
  const restoredLife = createWorldLife({ now, persistence: observed.persistence, worldSnapshot: () => recovered.get(),
    ingest: event => recovered.ingest(event), listMutations: options => recovered.listMutations(options) });
  const result = restoredLife.tick();
  assert.notEqual(result.current_scene.branch_key, consumed.branch_key, 'old branch remains consumed even after leaving the bounded scene window');
  assert.deepEqual(observed.reads.hydrated, sceneMutationIds, 'only complete set_life_scene records are relevant to the restored causal index');
  const revision = recovered.get().world_revision;
  observed.reads.hydrated.length = 0;
  restoredLife.tick();
  assert.equal(recovered.get().world_revision, revision);
  assert.equal(observed.reads.hydrated.length, 1, 'subsequent ticks hydrate only the newly committed Scene since the index cursor');
});

test('streamed feed scene references remain scoped to their canonical world', () => {
  const world = createPersistentWorld({ now: () => fixedTime }).get();
  const otherWorld = { ...structuredClone(world), world_id: 'other-world' };
  const records = [
    { mutation_id: 'world-a-scene', sequence: 1, world_id: world.world_id, action: 'set_life_scene',
      details: { scene: { scene_id: 'same-scene-id', title: '这边的灯', narration: '喵呜看着桌边的灯。', location_id: 'shaping-field-desk' } } },
    { mutation_id: 'world-b-scene', sequence: 2, world_id: otherWorld.world_id, action: 'set_life_scene',
      details: { scene: { scene_id: 'same-scene-id', title: '另一个世界的潮水', narration: '那边涨潮了。', location_id: 'tidal-old-road' } } },
    { mutation_id: 'world-a-continued', sequence: 3, world_id: world.world_id, action: 'continue_life_scene',
      details: { scene_id: 'same-scene-id', slot_key: 'next' } },
  ];
  const persistence = {
    list: namespace => namespace === 'canonical-world.states' ? [world, otherWorld] : [],
    *iterate() { yield* records; },
    get: (namespace, id) => records.find(record => record.mutation_id === id) ?? null,
  };
  const recovered = createPersistentWorld({ now: () => fixedTime, persistence });
  const continuation = recovered.listLifeFeed().find(entry => entry.kind === 'scene.continued');
  assert.equal(continuation.title, '这边的灯');
  assert.equal(continuation.text, '喵呜看着桌边的灯。');
  assert.equal(continuation.location_id, 'shaping-field-desk');
  assert.equal(recovered.listLifeFeed({ worldId: otherWorld.world_id }).length, 1);
});

