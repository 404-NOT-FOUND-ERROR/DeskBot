import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectLivedScene } from '../src/lived-scenes.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createWorldLife } from '../src/world-life.mjs';

const T0 = '2026-10-08T02:00:00.000Z';
const now = () => new Date(T0);
function snapshot() {
  return { clock: { mode: 'real_time' }, logical_time: { date: '2026-10-08', day: 1 },
    protagonist: { character_id: 'shaping-001', location_id: 'kitchen' },
    locations: [{ location_id: 'kitchen', name: '试菜厨房', description: '共用试菜灶和长桌所在的地方。' }],
    npcs: [], tasks: [], life: { recent_scenes: [] } };
}
function activity(actorId = 'shaping-001') {
  return { task_id: 'soup-1', actor_id: actorId, activity_id: 'cook-moss', kind: 'craft', status: 'running', revision: 0,
    title: '试做苔芽餐', location_id: 'kitchen', cause_event_id: 'cook-start-1', started_at: T0 };
}

test('a lived scene follows a real task and its result without minting world facts', () => {
  const world = snapshot(); world.tasks.push(activity());
  const before = structuredClone(world);
  const active = selectLivedScene(world, now());
  assert.match(active.narration, /我在试菜厨房忙着试做苔芽餐/);
  assert.equal(active.source_factors.task.task_id, 'soup-1');
  assert.deepEqual(world, before);
  world.life.current_scene = active;
  world.tasks[0] = { ...world.tasks[0], status: 'completed', revision: 1, finished_at: T0,
    completion: { due_at: T0, result: { success: true, text: '背包里多了两份苔芽餐。' } } };
  const result = selectLivedScene(world, now());
  assert.notEqual(result.scene_id, active.scene_id);
  assert.equal(result.continuity.previous_scene_id, active.scene_id);
  assert.match(result.narration, /背包里多了两份苔芽餐/);
  assert.equal(result.resolution_state, 'completed');
  world.life.recent_scenes.push(result); world.life.current_scene = null;
  assert.equal(selectLivedScene(world, now()).resolution_state, 'quiet', 'a consumed result does not reappear');
});

test('NPC scenes use only present residents, never travelling or remote activities', () => {
  const world = snapshot();
  world.npcs = [{ npc_id: 'npc-1', display_name: '小芽', location_id: 'kitchen' }];
  world.tasks = [activity('npc-1')];
  assert.match(selectLivedScene(world, now()).narration, /小芽正在试做苔芽餐/);
  world.tasks[0] = { ...world.tasks[0], kind: 'travel' };
  assert.deepEqual(selectLivedScene(world, now()).participants, []);
  assert.doesNotMatch(selectLivedScene(world, now()).narration, /小芽/);
  world.tasks[0] = activity('npc-1'); world.npcs[0].location_id = 'elsewhere';
  assert.equal(selectLivedScene(world, now()).resolution_state, 'quiet');
});

test('failures and paused tasks remain distinct from successful consequences', () => {
  const world = snapshot(); world.tasks = [{ ...activity(), status: 'paused', revision: 1 }];
  assert.match(selectLivedScene(world, now()).narration, /暂时停下/);
  world.tasks[0] = { ...world.tasks[0], status: 'failed', revision: 2, finished_at: T0,
    failure_reason: 'missing_materials', completion: { due_at: T0 } };
  const scene = selectLivedScene(world, now());
  assert.equal(scene.resolution_state, 'failed');
  assert.doesNotMatch(scene.narration, /背包里多了|missing_materials/);
});

test('late reconciliation does not present an old outcome as just lived', () => {
  const world = snapshot(); world.tasks = [{ ...activity(), status: 'completed', finished_at: T0,
    completion: { due_at: '2026-10-07T02:00:00.000Z', late: true } }];
  assert.equal(selectLivedScene(world, now()).resolution_state, 'quiet');
});

test('every admitted real-time place has a local setting instead of a desktop fallback', () => {
  const world = createPersistentWorld({ now, timeMode: 'realtime' }).get();
  for (const location of world.locations) {
    world.protagonist.location_id = location.location_id;
    const scene = selectLivedScene(world, now());
    assert.match(scene.title, new RegExp(location.name));
    assert.ok(scene.narration.includes(location.description));
    assert.equal(scene.location_id, location.location_id);
  }
});

test('actual task scene persists, continues across slots, and follows completion once after restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-lived-scenes-'));
  const filename = join(directory, 'world.sqlite');
  let clock = Date.parse(T0);
  let persistence = createSqlitePersistence({ filename });
  let world = createPersistentWorld({ now: () => new Date(clock), persistence, timeMode: 'realtime' });
  const createLife = () => createWorldLife({ now: () => new Date(clock), worldSnapshot: () => world.get(), ingest: event => world.ingest(event) });
  let life = createLife();
  t.after(() => { persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  world.ingest({ event_id: 'long-care', type: 'world.mutation', source: 'test', character_id: 'shaping-001', occurred_at: T0,
    payload: { action: 'start_activity', task_id: 'long-care', kind: 'care', title: '照料桌边的小东西', duration_seconds: 3600 } });
  life.tick();
  const first = world.get().life.current_scene;
  clock += 30 * 60000; world.syncWallClock(); life.tick();
  assert.equal(world.get().life.current_scene.scene_id, first.scene_id);
  assert.equal(world.get().life.current_scene.continuation_count, 1);
  persistence.close(); persistence = createSqlitePersistence({ filename });
  world = createPersistentWorld({ now: () => new Date(clock), persistence }); life = createLife();
  const count = world.listMutations().length; life.tick();
  assert.equal(world.listMutations().length, count);
  clock += 30 * 60000; world.syncWallClock(); world.syncTasks(); life.tick();
  assert.equal(world.get().life.current_scene.resolution_state, 'completed');
  assert.equal(world.get().life.current_scene.continuity.previous_scene_id, first.scene_id);
  const completedCount = world.listMutations().length; life.tick();
  assert.equal(world.listMutations().length, completedCount);
});
