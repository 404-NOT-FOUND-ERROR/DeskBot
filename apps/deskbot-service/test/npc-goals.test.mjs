import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcGoals } from '../src/npc-goals.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';

function setup() {
  const rows = new Map();
  const persistence = { list: ns => [...rows.entries()].filter(([k]) => k.startsWith(ns + '/')).map(([,v]) => structuredClone(v)),
    put: (ns, id, value) => rows.set(`${ns}/${id}`, structuredClone(value)) };
  const world = createPersistentWorld();
  world.ingest({ event_id: 'create-npc', type: 'world.mutation', payload: { action: 'upsert_npc', npc: { npc_id: 'scout', display_name: '巡路员', status: 'waiting' } } });
  const config = { persistence, worldSnapshot: () => world.get(), ingest: e => world.ingest(e) };
  return { world, config, engine: createNpcGoals(config) };
}
const goal = { id: 'scout-goal', npc_id: 'scout', purpose: '确认路线是否可以通行', options: [
  { when: { kind: 'event_present', value: 'route-open' }, action_name: 'inspect', status: '正在巡查开放路线' },
] };

test('NPC waits for world evidence, pause persists, then acts once across restart', () => {
  const { world, config, engine } = setup();
  engine.add(goal); engine.tick();
  assert.equal(engine.list()[0].decision, null);
  engine.control(goal.id, 'pause');
  world.ingest({ event_id: 'open', type: 'world.mutation', payload: { action: 'apply_world_line_event', event: { event_id: 'route-open', title: '路线开放' } } });
  const resumed = createNpcGoals(config);
  resumed.tick(); assert.equal(resumed.list()[0].state, 'paused');
  resumed.control(goal.id, 'resume'); resumed.tick();
  assert.equal(resumed.list()[0].state, 'completed');
  assert.equal(world.get().npcs[0].status, '正在巡查开放路线');
  const count = world.listMutations().length;
  createNpcGoals(config).tick(); assert.equal(world.listMutations().length, count);
  assert.ok(resumed.list()[0].decision.world_revision >= 0);
});

test('NPC priorities, reservations, cancellation and failure are explicit', () => {
  const { config, engine } = setup();
  assert.throws(() => createNpcGoals({ ...config, reserved: () => true }).add(goal), { code: 'npc_reserved' });
  engine.add(goal);
  assert.throws(() => engine.add({ ...goal, id: 'other' }), { code: 'npc_reserved' });
  engine.control(goal.id, 'cancel'); assert.equal(engine.reserved('scout'), false);
  const failing = createNpcGoals({ ...config, ingest: () => { throw Object.assign(new Error(), { code: 'npc_not_found' }); } });
  failing.add({ ...goal, id: 'fail', options: [{ when: { kind: 'npc_status', value: 'waiting' }, action_name: 'look', status: 'looking' }] });
  failing.tick(); assert.equal(failing.list().at(-1).error, 'npc_not_found');
  assert.throws(() => failing.control('fail', 'pause'), { code: 'goal_terminal' });
  failing.control('fail', 'cancel');
});

test('persisted decision replays unchanged after interrupted delivery', () => {
  const { world, config } = setup();
  const engine = createNpcGoals(config);
  engine.add({ ...goal, options: [
    { when: { kind: 'npc_status', value: 'waiting' }, action_name: 'look', status: 'looking' },
    { when: { kind: 'npc_status', value: 'waiting' }, action_name: 'leave', status: 'leaving' },
  ] });
  engine.tick();
  assert.equal(world.get().npcs[0].status, 'looking');
  const record = engine.list()[0];
  record.state = 'active'; config.persistence.put('life.npc-goals', record.id, record);
  const count = world.listMutations().length;
  createNpcGoals(config).tick();
  assert.equal(world.listMutations().length, count);
});

test('NPC goal may move one adjacent map hop but cannot teleport', () => {
  const { world, engine } = setup();
  const moving = engine.add({
    id: 'scout-move',
    npc_id: 'scout',
    purpose: '去潮痕旧路确认路标',
    options: [{ when: { kind: 'npc_status', value: 'waiting' }, action_name: 'walk_to_road', status: '正在确认潮痕路标', location_id: 'tidal-old-road' }],
  });
  assert.equal(moving.options[0].payload.location_id, 'tidal-old-road');
  engine.tick();
  assert.equal(world.get().npcs[0].location_id, 'tidal-old-road');
  assert.equal(engine.list()[0].state, 'completed');

  assert.throws(() => createNpcGoals({ worldSnapshot: () => world.get(), ingest: event => world.ingest(event) }).add({
    id: 'scout-teleport',
    npc_id: 'scout',
    purpose: '直接跨越地图',
    options: [{ when: { kind: 'npc_status', value: '正在确认潮痕路标' }, action_name: 'teleport', status: '不应发生', location_id: 'echo-waterside' }],
  }), { code: 'npc_location_not_reachable' });
});

test('multi-step NPC goals advance one step, persist waiting, and record history', () => {
  const rows = new Map();
  const persistence = { list: ns => [...rows.entries()].filter(([key]) => key.startsWith(`${ns}/`)).map(([, value]) => structuredClone(value)), put: (ns, id, value) => rows.set(`${ns}/${id}`, structuredClone(value)) };
  const world = createPersistentWorld();
  world.ingest({ event_id: 'create-steps-npc', type: 'world.mutation', payload: { action: 'upsert_npc', npc: { npc_id: 'scout', display_name: '巡路员', status: 'waiting' } } });
  let clock = new Date('2026-09-17T00:00:00.000Z');
  const first = createNpcGoals({ persistence, now: () => clock, worldSnapshot: () => world.get(), ingest: event => world.ingest(event) });
  const goal = {
    id: 'scout-steps', npc_id: 'scout', purpose: '先看路再回报',
    steps: [
      { step_id: 'observe', when: { kind: 'always' }, action_name: 'inspect', status: '正在观察路线', wait_until: '2026-09-17T00:01:00.000Z' },
      { step_id: 'report', when: { kind: 'npc_status', value: '正在观察路线' }, action_name: 'report', status: '已经把路线记下来了' },
    ],
  };
  first.add(goal);
  first.tick();
  assert.equal(first.list()[0].state, 'waiting');
  assert.equal(first.list()[0].waiting.reason, 'wait_until');
  clock = new Date('2026-09-17T00:02:00.000Z');
  first.tick();
  assert.equal(world.get().npcs[0].status, '正在观察路线');
  assert.equal(first.list()[0].current_step_index, 1);
  assert.equal(first.list()[0].step_history[0].state, 'completed');
  first.tick();
  assert.equal(world.get().npcs[0].status, '已经把路线记下来了');
  assert.equal(first.list()[0].state, 'completed');
  assert.equal(first.list()[0].step_history.length, 2);
});

test('multi-step NPC deadline writes missed feedback and blocks later steps', () => {
  const rows = new Map();
  const persistence = { list: ns => [...rows.entries()].filter(([key]) => key.startsWith(`${ns}/`)).map(([, value]) => structuredClone(value)), put: (ns, id, value) => rows.set(`${ns}/${id}`, structuredClone(value)) };
  const world = createPersistentWorld();
  world.ingest({ event_id: 'create-deadline-npc', type: 'world.mutation', payload: { action: 'upsert_npc', npc: { npc_id: 'deadline', display_name: '迟到者', status: 'waiting' } } });
  let clock = new Date('2026-09-17T00:00:00.000Z');
  const engine = createNpcGoals({ persistence, now: () => clock, worldSnapshot: () => world.get(), ingest: event => world.ingest(event) });
  engine.add({ id: 'deadline-goal', npc_id: 'deadline', purpose: '等一条永远不会来的路', steps: [
    { step_id: 'wait', when: { kind: 'event_present', value: 'never' }, deadline_at: '2026-09-17T00:01:00.000Z', action_name: 'wait', status: 'still waiting', on_missed: { action_name: 'admit_missed', status: '承认这次错过了' } },
    { step_id: 'blocked', when: { kind: 'always' }, action_name: 'should_not_run', status: '不应执行' },
  ] });
  clock = new Date('2026-09-17T00:02:00.000Z');
  engine.tick();
  const saved = engine.list()[0];
  assert.equal(saved.state, 'missed');
  assert.equal(saved.step_history[0].error, 'deadline_missed');
  assert.equal(saved.step_history[0].feedback.status, 'applied');
  assert.equal(world.get().npcs[0].status, '承认这次错过了');
  assert.equal(saved.current_step_index, 0);
});
