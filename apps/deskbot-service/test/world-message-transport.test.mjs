import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';
import { createWorldLife } from '../src/world-life.mjs';
import { advanceWorldMessages, resolveWorldMessageRecipients, worldMessageInbox } from '../src/world-message-transport.mjs';
import { actorCognitionContext, actorPerception, influenceActorCognitionChoices } from '../src/actor-perception.mjs';

const at = '2026-10-12T02:00:00.000Z', later = '2026-10-12T02:02:00.000Z';
function fixture() {
  return { updated_at: at, clock: { synced_at: at }, protagonist: { character_id: 'a', display_name: '喵呜', location_id: 'x' },
    npcs: [{ npc_id: 'b', display_name: '邻居', location_id: 'y' }, { npc_id: 'c', location_id: 'y' }], tasks: [],
    social: { relationships: {}, notices: [], commitments: [{ id: 'c1', actors: ['a', 'b'], status: 'proposed',
      title: '喝一碗汤', reason: '锅边还留着一份。', created_at: at, deadline_at: '2026-10-12T03:00:00.000Z' }] },
    memory: { episodes: [] }, role_stages: { current: {} }, living: { inventories: {} } };
}

test('routing combines recipients and location and excludes origin actors without global fallback', () => {
  const w = fixture(), base = { sender_id: 'a', actor_ids: [] };
  assert.deepEqual(resolveWorldMessageRecipients(w, { ...base, recipients: ['a', 'b', 'missing'], location_scope: null }), ['b']);
  assert.deepEqual(resolveWorldMessageRecipients(w, { ...base, recipients: null, location_scope: 'y' }), ['b', 'c']);
  assert.deepEqual(resolveWorldMessageRecipients(w, { ...base, recipients: ['b'], location_scope: 'x' }), []);
  assert.deepEqual(resolveWorldMessageRecipients(w, { ...base, recipients: null, location_scope: 'missing' }), []);
  assert.deepEqual(resolveWorldMessageRecipients(w, { ...base, recipients: null, location_scope: null, actor_ids: ['b'] }), ['c']);
  w.tasks = [{ actor_id: 'b', kind: 'travel', status: 'running' }];
  assert.deepEqual(resolveWorldMessageRecipients(w, { ...base, recipients: null, location_scope: 'y' }), ['c']);
});

test('delayed lossless delivery is actor-scoped, idempotent and has no action/relationship/memory effects', () => {
  const w = fixture(), unaffected = structuredClone({ relationships: w.social.relationships, tasks: w.tasks,
    memory: w.memory, stages: w.role_stages, living: w.living });
  assert.equal(advanceWorldMessages(w, at).queued, 1);
  const queued = structuredClone(w.social.message_transport);
  assert.equal(advanceWorldMessages(w, at).changed, false); assert.deepEqual(w.social.message_transport, queued);
  assert.deepEqual(worldMessageInbox(w, 'b'), []);
  assert.equal(advanceWorldMessages(w, later).delivered, 1); w.clock.synced_at = later;
  const inbox = worldMessageInbox(w, 'b');
  assert.equal(inbox[0].content, queued.records[0].content);
  assert.equal(inbox[0].independent_evidence, false);
  assert.deepEqual(worldMessageInbox(w, 'c'), []);
  assert.equal(actorPerception(w, 'b').messages[0].perception.visibility, 'delivered');
  assert.equal(actorCognitionContext(w, 'b', later).delivered[0].text, inbox[0].content);
  assert.deepEqual(actorCognitionContext(w, 'b', at).delivered, []);
  assert.deepEqual({ relationships: w.social.relationships, tasks: w.tasks, memory: w.memory,
    stages: w.role_stages, living: w.living }, unaffected);
  const delivered = structuredClone(w); assert.equal(advanceWorldMessages(w, later).changed, false); assert.deepEqual(w, delivered);
});

test('invalid canonical timestamps are isolated before date arithmetic', () => {
  const w = fixture();
  w.social.commitments.push({ ...w.social.commitments[0], id: 'bad-created', created_at: 'not-a-date' },
    { ...w.social.commitments[0], id: 'bad-deadline', deadline_at: 'not-a-date' },
    { ...w.social.commitments[0], id: 'complete', status: 'completed' });
  w.social.notices.push({ id: 'bad-news', text: '旧消息', at: 'not-a-date', audience: 'public',
    verified_by: 'canonical_world_record', source_commitment_id: 'complete' });
  assert.doesNotThrow(() => advanceWorldMessages(w, at));
  assert.equal(w.social.message_transport.records.length, 1);
  assert.equal(advanceWorldMessages(w, later).delivered, 1);
});

test('withdrawn delivered invitation preserves history and cannot influence choices as an active offer', () => {
  const w = fixture(); advanceWorldMessages(w, at); advanceWorldMessages(w, later);
  const original = worldMessageInbox(w, 'b', later)[0];
  const withdrawnAt = '2026-10-12T02:03:00.000Z';
  w.social.commitments[0].status = 'declined';
  assert.equal(advanceWorldMessages(w, withdrawnAt).updated, 1);
  const historical = worldMessageInbox(w, 'b', withdrawnAt)[0];
  assert.equal(historical.content, original.content);
  assert.equal(historical.invitation_state, 'declined');
  assert.equal(historical.actionable, false); assert.equal(historical.historical_only, true);
  assert.equal(worldMessageInbox(w, 'b', later)[0].actionable, true);
  assert.equal(actorCognitionContext(w, 'b', withdrawnAt).delivered[0].historical_only, true);
  const ranked = influenceActorCognitionChoices(w, 'b', [{ goal: 'visit', score: 20, available: true, development_topic: 'connection' }], withdrawnAt);
  assert.equal(ranked[0].perception_bonus, 0); assert.deepEqual(ranked[0].perception_source_ids, []);
  assert.equal(advanceWorldMessages(w, withdrawnAt).changed, false);
});

test('co-present, withdrawn, expired and forged announcements cannot fabricate delivery facts', () => {
  const local = fixture(); local.npcs[0].location_id = 'x';
  assert.equal(advanceWorldMessages(local, at).queued, 0);
  const withdrawn = fixture(); advanceWorldMessages(withdrawn, at); withdrawn.social.commitments[0].status = 'declined';
  assert.equal(advanceWorldMessages(withdrawn, later).withdrawn, 1); assert.deepEqual(worldMessageInbox(withdrawn, 'b', later), []);
  const expired = fixture(); advanceWorldMessages(expired, at);
  assert.equal(advanceWorldMessages(expired, '2026-10-12T04:00:00.000Z').expired, 1);
  const fake = fixture(); fake.social.notices = [{ id: 'fake', text: '我造好了房子', at, audience: 'public', verified_by: 'canonical_world_record', source_commitment_id: 'not-real' }];
  advanceWorldMessages(fake, at); assert.equal(fake.social.message_transport.records.some(m => m.source.id === 'fake'), false);
});

test('verified public notices route exact source content but participants do not overhear themselves', () => {
  const w = fixture(); Object.assign(w.social.commitments[0], { status: 'completed', changes: [] });
  w.social.notices = [{ id: 'news', text: '喵呜和邻居已喝完汤。', at, audience: 'public', author_id: 'b',
    verified_by: 'canonical_world_record', source_commitment_id: 'c1', source_task_ids: ['task1'] }];
  advanceWorldMessages(w, at); advanceWorldMessages(w, later);
  assert.deepEqual(worldMessageInbox(w, 'a', later), []);
  assert.equal(worldMessageInbox(w, 'c', later)[0].content, w.social.notices[0].text);
  assert.deepEqual(worldMessageInbox(w, 'c', later)[0].source.task_ids, ['task1']);
});

test('canonical autonomous mutation persists queue/delivery and restart never duplicates messages', t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-message-')), filename = join(directory, 'world.sqlite');
  let time = Date.parse('2026-10-12T04:00:00Z'), p = createSqlitePersistence({ filename });
  t.after(() => { p.close(); rmSync(directory, { recursive: true, force: true }); });
  const now = () => new Date(time);
  let world = createPersistentWorld({ persistence: p, now, timeMode: 'realtime' });
  createWorldLife({ worldSnapshot: () => world.get(), ingest: e => world.ingest(e), now, enabled: true }).seedNpcs();
  world.ingest({ event_id: 'residents', type: 'world.mutation', source: 'test', payload: { action: 'install_resident_life' } });
  const loop = () => createAutonomousLife({ world, now, enabled: true });
  loop().tick();
  const first = world.get(); assert.ok(first.social.message_transport.records.length);
  const queuedIds = first.social.message_transport.records.map(m => m.id);
  p.close(); p = createSqlitePersistence({ filename }); world = createPersistentWorld({ persistence: p, now, timeMode: 'realtime' });
  loop().tick(); assert.deepEqual(world.get(), first);
  time += 2 * 60000; world.syncWallClock(); world.syncTasks(); loop().tick();
  const after = world.get(); assert.ok(after.social.message_transport.records.some(m => m.status === 'delivered'));
  assert.ok(queuedIds.every(id => after.social.message_transport.records.filter(m => m.id === id).length === 1));
  p.close(); p = createSqlitePersistence({ filename }); world = createPersistentWorld({ persistence: p, now, timeMode: 'realtime' });
  loop().tick(); assert.deepEqual(world.get(), after);
});
