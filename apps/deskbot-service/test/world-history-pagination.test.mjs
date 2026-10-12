import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createWorldObserver } from '../src/world-observer.mjs';

const now = () => new Date('2026-10-12T08:00:00.000Z');
function leaveScene(world, index) {
  return world.ingest({ event_id: `history-page-scene-${index}`, type: 'world.mutation', source: 'history-page-test',
    character_id: 'shaping-001', occurred_at: now().toISOString(), payload: { action: 'set_life_scene',
      scene: { scene_id: `page-scene-${index}`, location_id: 'shaping-field-desk', title: `第 ${index} 段生活`,
        narration: `桌边留下了第 ${index} 段确实发生的片段。`, started_at: now().toISOString() } } });
}

test('long history walks every entry once at a frozen head and recovers the same cursor after SQLite restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-feed-pages-'));
  const filename = join(directory, 'isolated.sqlite');
  let persistence;
  try {
    persistence = createSqlitePersistence({ filename, now });
    const world = createPersistentWorld({ persistence, now });
    for (let index = 0; index < 225; index += 1) leaveScene(world, index);
    const first = world.readLifeFeedPage({ limit: 9 });
    assert.equal(first.head_sequence, 225);
    assert.equal(first.entries.length, 9);
    const capturedHead = first.head_sequence;
    const newestId = first.cursor.after_id;
    leaveScene(world, 225);
    leaveScene(world, 226);
    const live = world.get();
    const allIds = first.entries.map(entry => entry.id);
    let current = first;
    while (current.cursor.has_more_before) {
      current = world.readLifeFeedPage({ beforeId: current.cursor.before_id, headSequence: capturedHead, limit: 9 });
      assert.equal(current.head_sequence, capturedHead);
      assert.equal(current.current_sequence, 227);
      assert.ok(current.entries.length <= 9);
      assert.ok(current.entries.every(entry => entry.provenance.sequence <= capturedHead));
      allIds.push(...current.entries.map(entry => entry.id));
    }
    assert.equal(allIds.length, 225);
    assert.equal(new Set(allIds).size, 225);
    const savedPage = world.readLifeFeedPage({ beforeId: first.cursor.before_id, headSequence: capturedHead, limit: 9 });
    assert.equal(world.readSnapshot({ feedLimit: 3 }).sequence, 227, 'snapshot reads the tail beyond the mutation API first page');
    assert.deepEqual(world.get(), live);
    persistence.close();
    persistence = createSqlitePersistence({ filename, now });
    const reopened = createPersistentWorld({ persistence, now });
    assert.deepEqual(reopened.readLifeFeedPage({ beforeId: first.cursor.before_id, headSequence: capturedHead, limit: 9 }), savedPage);
    const resumed = reopened.readLifeFeedPage({ afterId: newestId, limit: 1 });
    assert.equal(resumed.entries[0].provenance.sequence, 226);
    assert.equal(resumed.cursor.has_more_after, true);
    const completed = reopened.readLifeFeedPage({ afterId: resumed.cursor.after_id, headSequence: resumed.head_sequence, limit: 1 });
    assert.equal(completed.entries[0].provenance.sequence, 227);
    assert.equal(completed.cursor.has_more_after, false);
    assert.deepEqual(reopened.readWorldAtSequence({ sequence: 1 }).world.life.current_scene.title, '第 0 段生活');
    assert.deepEqual(reopened.get(), live);
  } finally {
    persistence?.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('same-commit pages stay bounded and expose stable item order without dropping an entry', () => {
  const world = createPersistentWorld({ now, timeMode: 'realtime' });
  // Installing residents follows the existing internal world-life adapter.
  const actors = ['one', 'two', 'three'];
  for (const id of actors) world.ingest({ event_id: `page-npc-${id}`, type: 'world.mutation', source: 'test',
    character_id: 'shaping-001', occurred_at: now().toISOString(), payload: { action: 'upsert_npc',
      npc: { npc_id: id, display_name: id, location_id: 'shaping-field-desk' } } });
  world.ingest({ event_id: 'page-autonomy', type: 'world.mutation', source: 'test', character_id: 'shaping-001',
    occurred_at: now().toISOString(), payload: { action: 'advance_autonomous_life' } });
  const all = world.listLifeFeed({ limit: 200 });
  assert.ok(all.length > 1);
  const first = world.readLifeFeedPage({ limit: 1 });
  assert.equal(first.entries.length, 1);
  const ids = [first.entries[0].id];
  let page = first;
  while (page.cursor.has_more_before) {
    page = world.readLifeFeedPage({ headSequence: first.head_sequence, beforeId: page.cursor.before_id, limit: 1 });
    ids.push(page.entries[0].id);
  }
  assert.deepEqual(ids.reverse(), all.map(entry => entry.id));
  assert.deepEqual(all.map(entry => entry.provenance.item_index), all.map((_, index) => index));
});

test('feed HTTP frozen-head contract rejects malformed, future and mixed cursors without writing state', async t => {
  const server = createDeskBotServer({ now, websocket: false });
  leaveScene(server.persistentWorld, 0);
  leaveScene(server.persistentWorld, 1);
  const observer = createWorldObserver({ persistentWorld: server.persistentWorld, now });
  t.after(() => observer.close());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const live = server.persistentWorld.get();
  const response = await fetch(`${origin}/api/life/world/feed?limit=1&head_sequence=1`);
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.equal(page.entries.length, 1);
  assert.equal(page.head_sequence, 1);
  assert.equal(page.current_sequence, 2);
  assert.equal(page.entries[0].provenance.sequence, 1);
  for (const query of ['head_sequence=', 'head_sequence=NaN', 'head_sequence=-1', 'limit=0', 'limit=201', 'limit=1.1',
    `after_id=${encodeURIComponent(page.cursor.after_id)}&before_id=${encodeURIComponent(page.cursor.before_id)}`]) {
    assert.equal((await fetch(`${origin}/api/life/world/feed?${query}`)).status, 400, query);
  }
  const future = await fetch(`${origin}/api/life/world/feed?head_sequence=999`);
  assert.equal(future.status, 409);
  assert.equal((await future.json()).error, 'life_feed_head_ahead');
  const snapshot = observer.buildSnapshot();
  assert.equal(snapshot.feed.head_sequence, snapshot.sequence);
  assert.deepEqual(server.persistentWorld.get(), live);
  assert.equal(server.persistentWorld.listMutations().length, 2);
});
