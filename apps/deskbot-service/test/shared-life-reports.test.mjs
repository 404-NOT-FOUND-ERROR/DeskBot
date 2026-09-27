import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSharedLifeReports } from '../src/shared-life-reports.mjs';
import { createDeskBotServer } from '../src/app.mjs';
import { once } from 'node:events';

function setup() {
  let time = new Date('2026-09-26T00:00:00Z');
  const now = () => time;
  const world = createPersistentWorld({ now });
  const records = new Map();
  const persistence = {
    list: namespace => [...records.entries()]
      .filter(([key]) => key.startsWith(`${namespace}/`))
      .map(([, value]) => structuredClone(value)),
    put: (namespace, id, value) => records.set(`${namespace}/${id}`, structuredClone(value)),
    remove: (namespace, id) => records.delete(`${namespace}/${id}`),
  };
  const reports = createSharedLifeReports({ persistence, now, worldSnapshot: () => world.get(), listMutations: options => world.listMutations(options) });
  return { now, setTime: value => { time = new Date(value); }, world, persistence, reports };
}

test('commitments require explicit confirmation, are idempotent, and remain character scoped', () => {
  const { reports } = setup();
  assert.throws(() => reports.createCommitment({ id: 'walk', text: '去潮痕旧路', evidence_ref: 'turn-1' }), { code: 'confirmation_required' });
  const created = reports.createCommitment({ id: 'walk', text: '去潮痕旧路', evidence_ref: 'turn-1', confirmed: true });
  assert.equal(created.status, 'open');
  assert.deepEqual(reports.createCommitment({ id: 'walk', text: '去潮痕旧路', evidence_ref: 'turn-1', confirmed: true }), created);
  assert.throws(() => reports.createCommitment({ id: 'walk', character_id: 'other', text: '另一件事', evidence_ref: 'turn-2', confirmed: true }), { code: 'commitment_owner_conflict' });
  assert.throws(() => reports.createCommitment({ id: 'secret', text: '保存 api_key=abc', evidence_ref: 'turn-3', confirmed: true }), { code: 'sensitive_commitment_rejected' });
  const kept = reports.updateCommitment({ id: 'walk', operation: 'resolve', status: 'kept', confirmed: true, evidence_ref: 'turn-4' });
  assert.equal(kept.status, 'kept');
  assert.equal(reports.listCommitments({ status: 'open' }).length, 0);
});

test('commitments survive a persistence-backed reports recreation', () => {
  const { now, persistence, reports } = setup();
  reports.createCommitment({ id: 'tomorrow', text: '明天再看一眼新路标', due_at: '2026-09-27T08:00:00Z', evidence_ref: 'turn-5', confirmed: true });
  const reloaded = createSharedLifeReports({ persistence, now });
  assert.equal(reloaded.listCommitments()[0].id, 'tomorrow');
  assert.equal(reloaded.listCommitments()[0].due_at, '2026-09-27T08:00:00.000Z');
});

test('relationship trends need canonical mutation evidence and expose bounded direction', () => {
  const { world, reports } = setup();
  world.ingest({ event_id: 'npc-upsert', type: 'world.mutation', payload: { action: 'upsert_npc', npc: { npc_id: 'guide', display_name: '巡路员', location_id: 'shaping-field-desk' } } });
  world.ingest({ event_id: 'npc-first', type: 'world.mutation', occurred_at: '2026-09-26T08:00:00Z', payload: { action: 'npc_interaction', interaction_id: 'i-1', npc_id: 'guide', intent: 'greet', response: '早', experience: { experience_id: 'e-1', summary: '在桌边打了招呼', occurred_at: '2026-09-26T08:00:00Z' } } });
  world.ingest({ event_id: 'npc-second', type: 'world.mutation', occurred_at: '2026-09-26T09:00:00Z', payload: { action: 'npc_interaction', interaction_id: 'i-2', npc_id: 'guide', intent: 'help', response: '一起看路', experience: { experience_id: 'e-2', summary: '一起看路', occurred_at: '2026-09-26T09:00:00Z' } } });
  const trend = reports.relationshipTrends({ npcId: 'guide' })[0];
  assert.equal(trend.status, 'observed');
  assert.equal(trend.familiarity.direction, 'up');
  assert.equal(trend.trust.direction, 'up');
  assert.equal(trend.observation_count, 2);
  assert.equal(reports.relationshipTrends({ npcId: 'missing' })[0], undefined);
});

test('daily summary is empty without evidence and materialized reports survive reload', () => {
  const { now, setTime, world, persistence, reports } = setup();
  const empty = reports.previewDailySummary({ day: 1 });
  assert.equal(empty.status, 'empty');
  assert.deepEqual(empty.experiences, []);
  world.ingest({ event_id: 'life-scene', type: 'world.mutation', occurred_at: '2026-09-26T09:00:00Z', payload: { action: 'set_life_scene', scene: { scene_id: 'scene-1', location_id: 'shaping-field-desk', title: '桌边亮了一下', narration: '一颗亮珠滚到喵呜脚边。', started_at: '2026-09-26T09:00:00Z' } } });
  const preview = reports.previewDailySummary({ day: 1 });
  assert.equal(preview.status, 'recorded');
  assert.equal(preview.scenes[0].title, '桌边亮了一下');
  assert.equal(reports.listDailySummaries().length, 0);
  const saved = reports.materializeDailySummary({ day: 1 });
  assert.equal(reports.listDailySummaries()[0].id, saved.id);
  setTime('2026-09-27T00:00:00Z');
  const reloaded = createSharedLifeReports({ persistence, now, worldSnapshot: () => world.get(), listMutations: options => world.listMutations(options) });
  assert.equal(reloaded.listDailySummaries()[0].summary, saved.summary);
});

test('daily summary does not infer facts from assistant text', () => {
  const { world, reports } = setup();
  world.ingest({ event_id: 'assistant-only', type: 'conversation.reply', payload: { role: 'assistant', text: '我们今天去了集市。' } });
  const summary = reports.previewDailySummary({ day: 1 });
  assert.equal(summary.status, 'empty');
  assert.deepEqual(summary.experiences, []);
  assert.deepEqual(summary.scenes, []);
});

test('continuity HTTP routes expose read models without making assistant text canonical', async t => {
  const server = createDeskBotServer({ websocket: false });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const empty = await (await fetch(`${origin}/api/life/daily-summary`)).json();
  assert.equal(empty.summary.status, 'empty');
  const created = await fetch(`${origin}/api/life/commitments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'route-commitment', text: '明天看看潮路', evidence_ref: 'route-turn', confirmed: true }),
  });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).status, 'open');
  const continuity = await (await fetch(`${origin}/api/life/continuity`)).json();
  assert.equal(continuity.open_commitments[0].id, 'route-commitment');
  const trend = await (await fetch(`${origin}/api/life/relationship-trends`)).json();
  assert.deepEqual(trend.trends, []);
});

