import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createDeskBotServer } from '../src/app.mjs';
import { createNpcGoals } from '../src/npc-goals.mjs';
import { createWorldLife } from '../src/world-life.mjs';
import { worldTaskReadModel } from '../src/realtime-world.mjs';
import { createRoleEvolution } from '../src/role-evolution.mjs';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { computeFantasyPull } from '../src/fantasy-pull.mjs';
import { createNpcAgentLoop } from '../src/npc-agent-loop.mjs';

const HOME = 'shaping-field-desk';
const ROAD = 'tidal-old-road';
const MARKET = 'whisper-market';
const T0 = Date.parse('2026-10-03T15:59:30.000Z');
function harness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-realtime-'));
  const filename = join(directory, 'world.sqlite');
  let current = T0;
  let persistence = createSqlitePersistence({ filename });
  const now = () => new Date(current);
  let world = createPersistentWorld({ now, persistence, timeMode: 'realtime' });
  t.after(() => { persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  return {
    now, get world() { return world; }, get persistence() { return persistence; },
    set(value) { current = typeof value === 'number' ? value : Date.parse(value); },
    after(ms) { current += ms; },
    restart() { persistence.close(); persistence = createSqlitePersistence({ filename }); world = createPersistentWorld({ now, persistence }); },
    mutate(id, payload, occurredAt = now().toISOString()) { return world.ingest({ event_id: id, type: 'world.mutation', source: 'test', character_id: 'shaping-001', occurred_at: occurredAt, payload }); },
  };
}

test('real clock uses local midnight, catches up directly after restart, and never downgrades', t => {
  const h = harness(t);
  assert.equal(h.world.get().logical_time.date, '2026-10-03');
  assert.equal(h.world.get().logical_time.minute_of_day, 1439);
  const revision = h.world.get().world_revision;
  h.after(1000); h.world.syncWallClock();
  assert.equal(h.world.get().world_revision, revision, 'no revision per second');
  h.after(29000); h.world.syncWallClock();
  assert.equal(h.world.get().logical_time.date, '2026-10-04');
  assert.equal(h.world.get().logical_time.day, 2);
  assert.equal(h.world.get().logical_time.minute_of_day, 0);
  h.after(3 * 86400000 + 3600000); h.restart();
  assert.equal(h.world.get().logical_time.date, '2026-10-07');
  assert.equal(h.world.get().logical_time.minute_of_day, 60);
  assert.equal(h.world.get().clock.mode, 'real_time');
  assert.equal(h.world.get().clock.rate, 1);
});

test('production clock rejects time warps, client timestamps do not determine task start', t => {
  const h = harness(t);
  assert.throws(() => h.mutate('fast', { action: 'advance_time', minutes: 120 }), { code: 'real_time_clock_locked' });
  assert.throws(() => h.mutate('date', { action: 'advance_calendar', date: '2040-01-01' }), { code: 'real_time_clock_locked' });
  const life = createWorldLife({ now: h.now, worldSnapshot: () => h.world.get(), ingest: event => h.world.ingest(event), enabled: true });
  assert.throws(() => life.replay({ minutes: 30 }), { code: 'real_time_replay_forbidden' });
  const result = h.mutate('travel', { action: 'move_protagonist', location_id: ROAD }, '1999-01-01T00:00:00Z');
  assert.equal(result.mutation.details.task.started_at, h.now().toISOString());
  assert.equal(result.mutation.details.arrival_text, null);
  assert.equal(h.world.get().protagonist.location_id, HOME);
  assert.equal(h.world.get().logical_time.minute_of_day, 1439);
});

test('travel persists across SQLite restart, completes once, and keeps original deadline', t => {
  const h = harness(t);
  const event = { event_id: 'trip', type: 'world.mutation', source: 'test', character_id: 'shaping-001', occurred_at: h.now().toISOString(), payload: { action: 'move_protagonist', location_id: ROAD } };
  const first = h.world.ingest(event);
  const due = first.mutation.details.task.due_at;
  h.set(Date.parse(due) - 1); h.world.syncTasks();
  assert.equal(h.world.get().protagonist.location_id, HOME);
  h.restart();
  assert.equal(h.world.ingest(event).duplicate, true);
  h.set(Date.parse(due) + 1234); h.world.syncTasks();
  assert.equal(h.world.get().protagonist.location_id, ROAD);
  assert.equal(h.world.get().tasks[0].status, 'completed');
  assert.equal(h.world.get().tasks[0].completion.due_at, due);
  assert.equal(h.world.get().tasks[0].completion.late, true);
  const count = h.world.listMutations().length;
  h.world.syncTasks(); h.restart(); h.world.syncTasks();
  assert.equal(h.world.listMutations().length, count, 'arrival is idempotent across restart');
});

test('pause freezes remaining time across downtime; resume keeps remaining duration', t => {
  const h = harness(t);
  const { task } = h.mutate('trip', { action: 'move_protagonist', location_id: ROAD }).mutation.details;
  h.after(60000);
  h.mutate('pause', { action: 'control_task', task_id: task.task_id, operation: 'pause' });
  const remaining = h.world.get().tasks[0].remaining_ms;
  h.after(86400000); h.restart(); h.world.syncTasks();
  assert.equal(h.world.get().tasks[0].status, 'paused');
  assert.equal(worldTaskReadModel(h.world.get(), h.now().toISOString())[0].remaining_seconds, remaining / 1000);
  h.mutate('resume', { action: 'control_task', task_id: task.task_id, operation: 'resume' });
  h.after(remaining - 1); h.world.syncTasks();
  assert.equal(h.world.get().protagonist.location_id, HOME);
  h.after(1); h.world.syncTasks();
  assert.equal(h.world.get().protagonist.location_id, ROAD);
});

test('a cancelled trip stays at last confirmed location and does not arrive later', t => {
  const h = harness(t);
  const { task } = h.mutate('trip', { action: 'move_protagonist', location_id: ROAD }).mutation.details;
  assert.throws(() => h.mutate('second', { action: 'move_protagonist', location_id: ROAD }), { code: 'actor_busy' });
  h.mutate('cancel', { action: 'control_task', task_id: task.task_id, operation: 'cancel' });
  h.after(86400000); h.world.syncTasks();
  assert.equal(h.world.get().protagonist.location_id, HOME);
  assert.equal(h.world.get().tasks[0].status, 'cancelled');
});

test('server continues a multi-hop route while client is absent with bounded reconciliation', t => {
  const h = harness(t);
  h.mutate('trip', { action: 'move_protagonist', location_id: ROAD, destination_location_id: MARKET });
  h.after(86400000); h.restart();
  assert.equal(h.world.syncTasks({ limit: 1 }).processed, 1);
  assert.equal(h.world.get().protagonist.location_id, ROAD);
  assert.equal(h.world.get().tasks[0].status, 'running');
  h.world.syncTasks();
  assert.equal(h.world.get().protagonist.location_id, MARKET);
  assert.equal(h.world.get().tasks[0].steps_completed, 2);
  assert.equal(h.world.get().tasks[0].status, 'completed');
});

test('route blocks fail the pending segment without teleporting or inventing arrival', t => {
  const h = harness(t);
  h.mutate('trip', { action: 'move_protagonist', location_id: ROAD });
  h.mutate('block', { action: 'activate_event', event: { event_id: 'storm', title: '道路封闭', blocks_travel: true } });
  h.after(86400000); h.world.syncTasks();
  assert.equal(h.world.get().protagonist.location_id, HOME);
  assert.equal(h.world.get().tasks[0].status, 'failed');
  assert.equal(h.world.get().tasks[0].failure_reason, 'travel_blocked');
  assert.equal(h.world.get().protagonist.travel_state.arrival_text, null);
});

test('craft and care persist, report completion, and cannot mint resources in step 2', t => {
  const h = harness(t);
  for (const kind of ['craft', 'care']) {
    h.mutate(`${kind}-start`, { action: 'start_activity', task_id: kind, kind, title: kind === 'craft' ? '缝一块布' : '照料种子', duration_seconds: 2, completion: { inventory: 999 } });
    h.after(2000); h.restart(); h.world.syncTasks();
    const task = h.world.get().tasks.find(task => task.task_id === kind);
    assert.equal(task.status, 'completed');
    assert.equal(task.completion.effect, 'record_activity_only');
    assert.equal(task.completion.inventory, undefined);
  }
});

test('clock rollback cannot finish overdue work until server time recovers', t => {
  const h = harness(t);
  h.mutate('care', { action: 'start_activity', task_id: 'care', kind: 'care', title: '照料', duration_seconds: 2 });
  h.after(-60000);
  assert.equal(h.world.syncWallClock().clock_moved_backwards, true);
  assert.equal(h.world.syncTasks().clock_moved_backwards, true);
  assert.throws(() => h.mutate('pause', { action: 'control_task', task_id: 'care', operation: 'pause' }), { code: 'clock_moved_backwards' });
  h.set(T0 + 2000); h.world.syncTasks();
  assert.equal(h.world.get().tasks[0].status, 'completed');
});

test('NPC goals wait for timed arrival and travelling actors cannot create local encounters', t => {
  const h = harness(t);
  h.mutate('npc', { action: 'upsert_npc', npc: { npc_id: 'neighbor', display_name: '邻居', location_id: HOME } });
  const goals = createNpcGoals({ now: h.now, persistence: h.persistence, worldSnapshot: () => h.world.get(), ingest: event => ({ worldMutation: h.world.ingest(event) }) });
  goals.add({ id: 'walk', npc_id: 'neighbor', purpose: '到路口去', steps: [{ action_name: 'walk', location_id: ROAD, status: '巡路' }] });
  goals.tick();
  assert.equal(goals.list()[0].state, 'waiting');
  assert.equal(h.world.get().npcs[0].location_id, HOME);
  assert.throws(() => h.mutate('greet', { action: 'npc_interaction', interaction_id: 'greet', npc_id: 'neighbor', intent: 'greet', response: '好' }), { code: 'actor_travelling' });
  goals.tick();
  assert.equal(goals.list()[0].state, 'waiting');
  h.after(86400000); h.world.syncTasks(); goals.tick();
  assert.equal(goals.list()[0].state, 'completed');
  assert.equal(h.world.get().npcs[0].location_id, ROAD);
});

test('HTTP task retries preserve start time, whitelist effects, and expose read-only state', async t => {
  const h = harness(t);
  const server = createDeskBotServer({ now: h.now, persistence: h.persistence, persistentWorld: h.world, timeMode: 'realtime' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { event_id: 'http-care', task_id: 'http-care', kind: 'care', title: '照料', duration_seconds: 10, due_at: '1999-01-01T00:00:00Z', completion_effect: 'create_gold' };
  assert.equal((await post('/api/world/tasks', body)).status, 202);
  h.after(1000);
  const retry = await post('/api/world/tasks', body);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);
  const revision = h.world.get().world_revision;
  const list = await (await fetch(base + '/api/world/tasks')).json();
  assert.equal(list.tasks[0].remaining_seconds, 9);
  assert.equal(list.tasks[0].completion_effect, 'record_activity_only');
  assert.equal(h.world.get().world_revision, revision);
  assert.equal((await post('/api/world/tasks', { ...body, duration_seconds: 1 })).status, 409);
  assert.equal((await post('/api/world/tasks', { event_id: 'cancel-http', task_id: 'http-care', operation: 'cancel' })).status, 202);
  const travelBody = { event_id: 'http-trip', location_id: ROAD, expected_world_revision: h.world.get().world_revision, expected_from_location_id: HOME };
  const travel = await (await post('/api/world/travel', travelBody)).json();
  assert.equal(travel.map.protagonist.location_id, HOME);
  assert.equal(travel.map.protagonist.travel_state.status, 'travelling');
  h.after(1000);
  assert.equal((await post('/api/world/travel', travelBody)).status, 200, 'retry is valid even after world revision changes');
});

test('failed task commit rolls back both location and task; retry commits one arrival', t => {
  const h = harness(t);
  let reject = false;
  const adapter = { ...h.persistence, insert(namespace, id, value) {
    if (reject && namespace === 'canonical-world.mutations') throw new Error('injected ledger failure');
    return h.persistence.insert(namespace, id, value);
  } };
  const world = createPersistentWorld({ persistence: adapter, now: h.now });
  world.ingest({ event_id: 'atomic-trip', type: 'world.mutation', character_id: 'shaping-001', payload: { action: 'move_protagonist', location_id: ROAD } });
  h.after(86400000); reject = true;
  assert.throws(() => world.syncTasks(), /injected ledger failure/);
  assert.equal(world.get().protagonist.location_id, HOME);
  const restored = createPersistentWorld({ persistence: h.persistence, now: h.now });
  assert.equal(restored.get().protagonist.location_id, HOME);
  assert.equal(restored.get().tasks[0].status, 'running');
  reject = false; restored.syncTasks();
  assert.equal(restored.get().protagonist.location_id, ROAD);
  assert.equal(restored.listMutations().filter(mutation => mutation.action === 'advance_task').length, 1);
});

test('growth uses event local dates across Beijing midnight even if delivery occurs on one day', t => {
  const h = harness(t);
  h.set('2026-10-03T16:03:00Z'); h.world.syncWallClock();
  const events = [
    { event_id: 'rain', type: 'weather.observation', layer: 'weather', occurred_at: '2026-10-03T15:58:00Z', payload: { text: '雨一直落在池塘边，湿地今天很亮' } },
    { event_id: 'profile', type: 'user.preference', layer: 'user_profile', occurred_at: '2026-10-03T15:59:00Z', payload: { value: '想去荷叶边散步' } },
    { event_id: 'world', type: 'world.mutation', layer: 'world_line', occurred_at: '2026-10-03T16:01:00Z', payload: { summary: '湿地出现一片会发光的荷叶' } },
  ].map(event => ({ ...event, character_id: 'shaping-001', received_at: h.now().toISOString() }));
  const roles = createRoleProposalStore({ now: h.now, persistence: h.persistence });
  const evolution = createRoleEvolution({ now: h.now, persistence: h.persistence, inputStore: { list: () => events }, roles, computeFantasyPull, worldSnapshot: () => h.world.get() });
  evolution.sync();
  const snapshot = evolution.snapshot({ characterId: 'shaping-001' });
  const rain = snapshot.evidence.find(item => item.event_id === 'rain');
  const nextDay = snapshot.evidence.find(item => item.event_id === 'world');
  assert.equal(rain.logical_day, '2026-10-03');
  assert.equal(nextDay.logical_day, '2026-10-04');
  assert.equal(rain.time_zone, 'Asia/Shanghai');
  assert.equal(rain.day_basis, 'occurred_at_local_calendar');
  assert.deepEqual(snapshot.candidates.find(item => item.direction_id === 'wetland_frog').logical_days, ['2026-10-03', '2026-10-04']);
});

test('real-time NPC decision IDs cannot collide with simulation decisions from the same slot', t => {
  const h = harness(t);
  const world = { world_revision: 5, logical_time: { day: 1, minute_of_day: 480 }, locations: [
    { location_id: 'home', neighbors: ['road'] }, { location_id: 'road', neighbors: ['home'] },
  ] };
  const npc = { npc_id: 'neighbor', location_id: 'home', status: '观察' };
  const loop = createNpcAgentLoop({ now: h.now, persistence: h.persistence, worldSnapshot: () => world });
  const args = { world, npc, profile: { legal_actions: ['move_to_adjacent_location', 'observe_current_location'] }, routine: { route: ['road'], purpose: '巡路' } };
  const simulated = loop.decide(args);
  loop.markExecuted(simulated.decision_id, 'old-action');
  const realWorld = { ...world, clock: { mode: 'real_time' }, logical_time: { ...world.logical_time, date: '2026-10-04' } };
  const real = loop.decide({ ...args, world: realWorld });
  assert.notEqual(real.decision_id, simulated.decision_id);
  assert.equal(real.status, 'planned');
  const stale = loop.decide({ ...args, world: realWorld, npc: { ...npc, location_id: 'road' } });
  assert.equal(stale.status, 'failed');
  assert.equal(stale.error, 'npc_location_changed_before_execution');
});
