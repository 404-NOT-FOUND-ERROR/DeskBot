import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedLife } from '../src/shared-life.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { composePrompt } from '../src/prompt-composer.mjs';
import { once } from 'node:events';
import { createDeskBotServer } from '../src/app.mjs';
import { computeFantasyPull } from '../src/fantasy-pull.mjs';
import { previewStoryPackage } from '../src/story-packages.mjs';

test('story package preview can be composed without changing canonical world', () => {
  const before = { world_revision: 4, world_line: { recent_events: [] } };
  const result = previewStoryPackage('tide-path-three-days-v1', { now: new Date('2026-09-16T00:00:00Z'), plans: [], world: before });
  assert.equal(result.current_world_revision, 4);
  assert.deepEqual(before.world_line.recent_events, []);
});

test('older relevant memory is retrieved and memory boundary survives SQLite restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-memory-'));
  const filename = join(dir, 'test.sqlite');
  let db = createSqlitePersistence({ filename });
  let time = new Date('2026-09-16T00:00:00Z');
  const now = () => time;
  try {
    let life = createSharedLife({ persistence: db, now });
    life.remember({ id: 'old', text: '喜欢听雨声', confirmed: true, evidence_ref: 'note-old' });
    for (let i = 0; i < 25; i++) {
      time = new Date(time.getTime() + 1000);
      life.remember({ id: `note-${i}`, text: `散步记录 ${i}`, confirmed: true, evidence_ref: `note-${i}` });
    }
    assert.equal(life.recall(undefined, Infinity).length, 26);
    assert.equal(life.retrieve('shaping-001', '雨声')[0].id, 'old');
    assert.throws(() => life.remember({ id: 'old', character_id: 'other', text: '不同角色', confirmed: true, evidence_ref: 'new' }));
    life.forget('old');
    db.close();
    db = createSqlitePersistence({ filename });
    life = createSharedLife({ persistence: db, now });
    assert.equal(life.historyAfter('shaping-001'), time.toISOString());
    assert.ok(!JSON.stringify(life.retrieve('shaping-001', '雨声')).includes('雨声'));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('correction and forgetting remove old turn paraphrases from subsequent prompt', async t => {
  let time = new Date('2026-09-16T00:00:00Z');
  let captured = '';
  const server = createDeskBotServer({ websocket: false, now: () => time, llm: {
    async complete({ prompt }) { captured = prompt; return { text: '记得，你爱雷声。', provider: 'test', trace: {} }; },
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body) => {
    const r = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(r.ok, await r.text());
  };
  const memory = { id: 'rain', text: '喜欢雷声', confirmed: true, evidence_ref: 'explicit-note' };
  await post('/api/life/memories', memory);
  await post('/api/chat', { event_id: 'before', source: 'test', character_id: 'shaping-001', message: '我爱雷声' });
  time = new Date(time.getTime() + 1000);
  await post('/api/life/memories', { ...memory, text: '讨厌雷声' });
  time = new Date(time.getTime() + 1000);
  await post('/api/chat', { event_id: 'after-correction', source: 'test', character_id: 'shaping-001', message: '记得我的偏好吗' });
  assert.ok(captured.includes('讨厌雷声'));
  assert.ok(!captured.includes('我爱雷声'));
  assert.ok(!captured.includes('记得，你爱雷声'));
  await post('/api/life/memories', { operation: 'forget', id: 'rain' });
  time = new Date(time.getTime() + 1000);
  await post('/api/chat', { event_id: 'after-forget', source: 'test', character_id: 'shaping-001', message: '你好' });
  assert.ok(!captured.includes('雷声'));
});

test('scheduled world evidence needs another source; cancellation survives reload', () => {
  const records = new Map();
  const persistence = {
    list: ns => [...records.entries()].filter(([k]) => k.startsWith(ns + '/')).map(([,v]) => structuredClone(v)),
    put: (ns, id, value) => records.set(`${ns}/${id}`, structuredClone(value)),
  };
  const events = [];
  const now = () => new Date('2026-09-19T00:00:00Z');
  const options = { persistence, now, ingest: event => events.push(event) };
  const life = createSharedLife(options);
  life.schedule({ id: 'wetland', steps: [16, 17, 18].map(day => ({ at: `2026-09-${day}T00:00:00Z`, payload: { action: 'apply_world_line_event', event: { event_id: `day-${day}`, title: '湿地池塘开放' } } })) });
  life.tick();
  assert.equal(computeFantasyPull(events, { now: now() })[0].status, 'observing');
  const withUser = [...events, { event_id: 'user-walk', type: 'conversation.input', layer: 'interaction', payload: { text: '想和你去池塘散步' }, occurred_at: now().toISOString() }];
  assert.equal(computeFantasyPull(withUser, { now: now() })[0].status, 'candidate');
  life.schedule({ id: 'cancelled', steps: [{ at: now().toISOString(), payload: { action: 'upsert_npc', npc: { npc_id: 'visitor', display_name: '访客' } } }] });
  life.cancel('cancelled');
  assert.equal(createSharedLife(options).tick().applied, 0);
  assert.equal(events.length, 3);
  assert.throws(() => life.cancel('missing'));
});

test('HTTP memory reaches chat and scheduled NPC action reaches canonical ledger', async t => {
  let prompt = '';
  const server = createDeskBotServer({ websocket: false, llm: {
    async complete(input) { prompt = input.prompt; return { text: '喵，我记得雨声那件事。', provider: 'test', trace: {} }; },
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/life/memories', { id: 'rain', text: '我们一起听过雨声', confirmed: true, evidence_ref: 'user-confirmed-1' })).status, 200);
  assert.equal((await post('/api/chat', { event_id: 'life-chat', character_id: 'shaping-001', source: 'test', message: '你记得什么？' })).status, 202);
  assert.ok(prompt.includes('我们一起听过雨声'));
  assert.equal((await post('/api/life/plans', { id: 'npc-visit', steps: [{ at: '2026-01-01T00:00:00Z', payload: { action: 'upsert_npc', npc: { npc_id: 'test-courier', display_name: '送信员', status: '等待潮汐退去' } } }] })).status, 200);
  server.sharedLife.tick();
  const ledger = await (await fetch(origin + '/api/world/ledger')).json();
  assert.ok(JSON.stringify(ledger).includes('life:npc-visit:0'));
  await post('/api/life/memories', { operation: 'forget', id: 'rain' });
  const memories = await (await fetch(origin + '/api/life/memories')).json();
  assert.deepEqual(memories.memories, []);
});

test('confirmed memories survive restart, correction and deletion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-life-'));
  const filename = join(dir, 'test.sqlite');
  let db = createSqlitePersistence({ filename });
  try {
    let life = createSharedLife({ persistence: db });
    assert.throws(() => life.remember({ id: 'preference', text: 'rain' }));
    life.remember({ id: 'preference', text: '喜欢雨声', evidence_ref: 'user-note-1', confirmed: true });
    db.close();
    db = createSqlitePersistence({ filename });
    life = createSharedLife({ persistence: db });
    assert.equal(life.recall()[0].text, '喜欢雨声');
    life.remember({ id: 'preference', text: '喜欢小雨，不喜欢雷声', evidence_ref: 'user-note-2', confirmed: true });
    assert.equal(life.recall()[0].revision, 2);
    assert.equal(life.recall('someone-else').length, 0);
    const prompt = composePrompt({ relationshipMemories: life.recall(), userText: '记得吗' }).prompt;
    assert.ok(prompt.includes('喜欢小雨，不喜欢雷声'));
    life.forget('preference');
    assert.equal(createSharedLife({ persistence: db }).recall().length, 0);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('cross-day world steps are bounded, canonical and restart-idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-life-'));
  const db = createSqlitePersistence({ filename: join(dir, 'test.sqlite') });
  let time = new Date('2026-09-16T00:00:00Z');
  const now = () => time;
  const world = createPersistentWorld({ now, persistence: db });
  const options = { persistence: db, now, ingest: event => world.ingest(event) };
  try {
    let life = createSharedLife(options);
    life.schedule({ id: 'tide', steps: [0, 1, 2, 3].map(day => ({
      at: `2026-09-${16 + day}T00:00:00Z`,
      payload: { action: 'apply_world_line_event', event: { event_id: `tide-${day}`, title: `潮汐第${day}日`, summary: '远处市集升起路标' } },
    })) });
    assert.equal(life.tick().applied, 1);
    assert.equal(life.tick().applied, 0);
    time = new Date('2026-09-21T00:00:00Z');
    life = createSharedLife(options);
    assert.equal(life.tick().applied, 3);
    assert.equal(life.tick().applied, 0);
    assert.equal(world.listMutations().length, 4);
    assert.throws(() => life.schedule({ id: 'bad', steps: [{ at: time.toISOString(), payload: { action: 'observe_user_preference' } }] }));
    assert.throws(() => life.schedule({ id: 'invalid-npc', steps: [{ at: time.toISOString(), payload: { action: 'npc_action', npc_id: 'missing', action_name: 'walk' } }] }), { code: 'invalid_plan_world_mutation' });
    assert.equal(life.plans().length, 1);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('plan preview is side-effect free, supports sequential NPC dependencies and reserves resources', () => {
  const world = createPersistentWorld();
  const before = world.get();
  const life = createSharedLife({ worldSnapshot: () => world.get(), ingest: e => world.ingest(e) });
  const at = '2026-09-20T00:00:00Z';
  const npc = { action: 'upsert_npc', npc: { npc_id: 'courier', display_name: '巡路员' } };
  const action = { action: 'npc_action', npc_id: 'courier', action_name: 'inspect' };
  life.schedule({ id: 'first', steps: [{ at, payload: npc }, { at, payload: action }] });
  assert.deepEqual(world.get(), before);
  assert.equal(world.listMutations().length, 0);
  assert.throws(() => life.schedule({ id: 'second', steps: [{ at, payload: npc }] }), { code: 'plan_resource_conflict' });
  life.cancel('first');
  assert.doesNotThrow(() => life.schedule({ id: 'second', steps: [{ at, payload: npc }] }));
  assert.throws(() => life.schedule({ id: 'broken', steps: [null] }), { code: 'invalid_plan' });
  assert.throws(() => life.schedule({ id: 'missing-title', steps: [{ at, payload: { action: 'apply_world_line_event', event: { event_id: 'x' } } }] }), { code: 'invalid_plan_world_mutation' });
});

test('runtime world drift still blocks a validated plan and retains the domain error', () => {
  const life = createSharedLife({ now: () => new Date('2026-09-21T00:00:00Z'), ingest: () => { throw new Error('unexpected'); } });
  life.schedule({ id: 'drift', steps: [{ at: '2026-09-20T00:00:00Z', payload: { action: 'upsert_npc', npc: { npc_id: 'courier', display_name: '巡路员' } } }] });
  life.tick();
  assert.equal(life.plans()[0].steps[0].status, 'failed');
  assert.equal(life.plans()[0].steps[0].error, 'world_mutation_rejected');
});
