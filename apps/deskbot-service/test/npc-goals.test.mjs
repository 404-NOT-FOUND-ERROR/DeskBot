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
