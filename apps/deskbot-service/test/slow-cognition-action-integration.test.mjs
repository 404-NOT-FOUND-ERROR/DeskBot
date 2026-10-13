import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { installLivedMemory } from '../src/lived-memory.mjs';
import { createSlowCognitionWorker } from '../src/slow-cognition.mjs';

const OWN = 'shaping-001', COOK = 'pot-cook-001';
const MINUTE = 60000, BASE = Date.parse('2026-10-12T04:00:00.000Z');

function fixture(t, { actorId = OWN, cook = false, fruit = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-slow-action-'));
  const filename = join(directory, 'world.sqlite');
  let time = BASE, store = createSqlitePersistence({ filename }), world, life;
  const now = () => new Date(time);
  function reload() {
    world = createPersistentWorld({ persistence: store, now, timeMode: 'realtime' });
    life = createAutonomousLife({ world, now, enabled: true });
  }
  reload();
  if (cook || fruit) world.ingest({ event_id: 'fixture:residents', type: 'world.mutation', source: 'test',
    payload: { action: 'install_resident_life' } });
  const initial = world.get();
  installAutonomy(initial, now().toISOString());
  installLivedMemory(initial, now().toISOString(), { plannerEnabled: false });
  for (const state of Object.values(initial.autonomy.actors)) state.paused = state.actor_id !== actorId;
  if (initial.social) initial.social.next_offer_at = new Date(BASE + 86400000).toISOString();
  (actorId === OWN ? initial.protagonist : initial.npcs.find(n => n.npc_id === actorId))
    .location_id = cook ? 'warm-pot-courtyard' : fruit ? 'backlit-grove' : 'spare-parts-house';
  Object.assign(initial.living.objects['garden-bed'], { moisture: .6, growth: .2, health: .9 });
  initial.living.objects['seedling-rack'].stock.trays = cook || fruit ? 2 : 0;
  initial.living.objects['seedling-rack'].stock.moss = cook ? 8 : 0;
  initial.living.objects['shared-table'].stock.rations = cook || fruit ? 0 : 6;
  if (fruit) {
    initial.living.objects['light-fruit-bough'].stock.light_fruit = 8;
    initial.npcs.find(n => n.npc_id === 'shade-collector-001').location_id = 'moss-sprout-garden';
  }
  store.put('canonical-world.states', initial.world_id, initial); reload();
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });

  return {
    get world() { return world; }, actorId, now,
    tick() { return life.tick(); },
    minute() { time += MINUTE; world.syncWallClock(); world.syncTasks(); life.tick(); },
    until(predicate, maxMinutes = 240) {
      for (let i = 0; i <= maxMinutes; i++) {
        if (predicate(world.get())) return;
        if (i < maxMinutes) this.minute();
      }
      assert.fail('canonical action did not reach the expected state');
    },
    settleActor() {
      this.until(world => {
        const state = world.autonomy.actors[actorId];
        return !world.tasks.some(task => task.actor_id === actorId && ['running', 'paused'].includes(task.status))
          && (!state.plan || ['completed', 'failed', 'cancelled'].includes(state.plan.status));
      }, 480);
    },
    resetTrayRetry() {
      // Branch the fixture after its first real plan has settled. Only the
      // actor position and retry window are arranged for the next scenario;
      // completed tasks, resources, source memories and goal state stay exact.
      const snapshot = world.get();
      snapshot.protagonist.location_id = 'spare-parts-house';
      snapshot.autonomy.actors[actorId].next_decision_at = now().toISOString();
      snapshot.autonomy.actors[actorId].cooldowns.tray = now().toISOString();
      store.put('canonical-world.states', snapshot.world_id, snapshot); reload();
    },
    restart() { store.close(); store = createSqlitePersistence({ filename }); reload(); },
    async reflect(activityId, topic) {
      let calls = 0;
      const worker = createSlowCognitionWorker({ world, now, llm: { id: 'grounded-action-fixture',
        complete: async () => {
          calls++;
          const request = world.get().memory.maintenance.actors[actorId].request;
          const source = request.memories.find(memory => memory.activity_id === activityId && memory.outcome === 'completed');
          assert.ok(source, 'the reflection must cite a real completed autonomous task');
          return { model: 'fixture', text: JSON.stringify({ insights: [],
            goals: [{ text: '想把这件已经试过的小事再做一次。', topic, activity_id: activityId, source_ids: [source.id] }], relations: [] }) };
        } } });
      await worker.tick();
      assert.equal(calls, 1);
      const goal = world.get().memory.maintenance.actors[actorId].goals[0];
      assert.equal(goal.activity_id, activityId); assert.equal(goal.status, 'intended');
      return goal.goal_id;
    },
  };
}

const goalFor = (world, actorId, goalId) => world.memory.maintenance.actors[actorId].goals.find(goal => goal.goal_id === goalId);
const actualTask = (world, actorId, activityId) => world.tasks.find(task => task.actor_id === actorId
  && task.activity_id === activityId && task.origin === 'autonomous_life' && task.status === 'completed');

test('the existing tray candidate binds a reflected goal to a real task; SQLite restart and settlement count it once', async t => {
  const h = fixture(t); h.tick();
  h.until(world => actualTask(world, OWN, 'craft-tray'));
  const goalId = await h.reflect('craft-tray', 'craft');
  h.settleActor(); h.resetTrayRetry();
  h.until(world => world.tasks.some(task => task.cognition_goal_id === goalId && task.status === 'running'));
  const started = h.world.get(), candidate = started.autonomy.actors[OWN].last_candidates.find(choice => choice.goal === 'tray');
  assert.equal(candidate.activity_id, 'craft-tray'); assert.equal(candidate.development_topic, 'craft');
  assert.equal(candidate.cognition_goal_id, goalId); assert.equal(candidate.cognition_bonus, 2);
  const task = started.tasks.find(task => task.cognition_goal_id === goalId);
  assert.equal(task.activity_id, 'craft-tray'); assert.equal(goalFor(started, OWN, goalId).status, 'trying');
  assert.equal(goalFor(started, OWN, goalId).progress.completed, 0);
  h.restart(); assert.deepEqual(goalFor(h.world.get(), OWN, goalId).task_ids, [task.task_id]);
  h.until(world => goalFor(world, OWN, goalId).status === 'completed', 30);
  const completed = goalFor(h.world.get(), OWN, goalId);
  assert.equal(completed.progress.completed, 1); assert.equal(completed.history[0].task_id, task.task_id);
  assert.equal(h.world.get().tasks.find(item => item.task_id === task.task_id).status, 'completed');
  h.restart(); h.tick(); h.minute();
  assert.equal(goalFor(h.world.get(), OWN, goalId).progress.completed, 1);
  assert.equal(goalFor(h.world.get(), OWN, goalId).history.length, 1);
});

test('the existing cook candidate binds the actual authored recipe while preparation and deposits stay outside goal progress', async t => {
  const h = fixture(t, { actorId: COOK, cook: true }); h.tick();
  h.until(world => actualTask(world, COOK, 'cook-moss'));
  const goalId = await h.reflect('cook-moss', 'cook');
  h.until(world => world.tasks.some(task => task.cognition_goal_id === goalId && task.status === 'running'));
  const started = h.world.get(), candidate = started.autonomy.actors[COOK].last_candidates.find(choice => choice.goal === 'cook');
  assert.equal(candidate.activity_id, 'cook-moss'); assert.equal(candidate.development_topic, 'cook');
  assert.equal(candidate.cognition_goal_id, goalId);
  const task = started.tasks.find(task => task.cognition_goal_id === goalId);
  assert.equal(task.activity_id, 'cook-moss'); assert.equal(task.status, 'running');
  assert.ok(started.tasks.filter(item => item.cognition_goal_id === goalId).every(item => item.activity_id === 'cook-moss'));
  assert.equal(goalFor(started, COOK, goalId).progress.completed, 0);
  h.restart(); h.until(world => goalFor(world, COOK, goalId).status === 'completed', 30);
  assert.equal(goalFor(h.world.get(), COOK, goalId).progress.completed, 1);
  assert.equal(h.world.get().tasks.find(item => item.task_id === task.task_id).completion.result.success, true);
  h.restart(); h.tick(); assert.equal(goalFor(h.world.get(), COOK, goalId).progress.completed, 1);
});

test('fruit supply carries its actual recipe topic; a real journey and deposit cannot settle a reflected gathering goal', async t => {
  const h = fixture(t, { fruit: true }); h.tick();
  h.until(world => actualTask(world, OWN, 'gather-light-fruit'));
  const goalId = await h.reflect('gather-light-fruit', 'care');
  h.settleActor();
  const fruit = h.world.get().living.objects['seedling-rack'].stock.light_fruit;
  // Another resident takes the actual supplied stock; the next gather must
  // still come from the finite grove source rather than this held basket.
  h.world.ingest({ event_id: 'fixture:take-supplied-fruit', type: 'world.mutation', source: 'test',
    character_id: OWN, occurred_at: h.now().toISOString(), payload: { action: 'transfer_resource',
      actor_id: 'shade-collector-001', object_id: 'seedling-rack', resource: 'light_fruit', count: fruit, operation: 'take' } });
  h.until(world => world.autonomy.actors[OWN].plan?.cognition_goal_id === goalId
    && world.tasks.some(task => task.actor_id === OWN && task.kind === 'travel' && task.status === 'running'));
  assert.deepEqual(goalFor(h.world.get(), OWN, goalId).task_ids, []);
  assert.equal(goalFor(h.world.get(), OWN, goalId).progress.completed, 0);
  h.restart();
  h.until(world => world.tasks.some(task => task.cognition_goal_id === goalId && task.status === 'running'));
  const started = h.world.get(), candidate = started.autonomy.actors[OWN].last_candidates.find(choice => choice.goal === 'fruit-supply');
  assert.equal(candidate.activity_id, 'gather-light-fruit'); assert.equal(candidate.development_topic, 'care');
  assert.equal(candidate.cognition_goal_id, goalId); assert.equal(candidate.cognition_bonus, 0);
  assert.ok(started.tasks.filter(task => task.cognition_goal_id === goalId).every(task => task.activity_id === 'gather-light-fruit'));
  assert.equal(goalFor(started, OWN, goalId).progress.completed, 0);
  h.restart(); h.until(world => goalFor(world, OWN, goalId).status === 'completed', 30);
  assert.equal(goalFor(h.world.get(), OWN, goalId).progress.completed, 1);
  h.restart(); h.tick(); assert.equal(goalFor(h.world.get(), OWN, goalId).progress.completed, 1);
});

test('a reflected tray goal cannot fabricate progress after the real material stock is removed', async t => {
  const h = fixture(t); h.tick(); h.until(world => actualTask(world, OWN, 'craft-tray'));
  const goalId = await h.reflect('craft-tray', 'craft');
  h.settleActor(); h.resetTrayRetry();
  const wood = h.world.get().living.objects['parts-drawers'].stock.wood;
  h.world.ingest({ event_id: 'fixture:remove-shared-wood', type: 'world.mutation', source: 'test',
    character_id: OWN, occurred_at: h.now().toISOString(), payload: { action: 'transfer_resource',
      actor_id: OWN, object_id: 'parts-drawers', resource: 'wood', count: wood, operation: 'take' } });
  h.until(world => world.autonomy.actors[OWN].last_candidates.some(choice => choice.goal === 'tray' && !choice.available));
  const world = h.world.get(), candidate = world.autonomy.actors[OWN].last_candidates.find(choice => choice.goal === 'tray');
  assert.equal(candidate.activity_id, 'craft-tray'); assert.equal(candidate.development_topic, 'craft');
  assert.equal(candidate.cognition_goal_id, null); assert.equal(candidate.cognition_bonus, 0);
  assert.deepEqual(goalFor(world, OWN, goalId).task_ids, []);
  assert.equal(goalFor(world, OWN, goalId).status, 'intended');
  assert.equal(goalFor(world, OWN, goalId).progress.completed, 0);
  h.restart(); h.minute(); assert.equal(goalFor(h.world.get(), OWN, goalId).progress.completed, 0);
  assert.equal(h.world.get().tasks.some(task => task.cognition_goal_id === goalId), false);
});
