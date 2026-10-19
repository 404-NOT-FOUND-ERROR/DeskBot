import { randomUUID } from 'node:crypto';
import { getWorldMap } from './persistent-world.mjs';
import { reservedSocialActors } from './social-life.mjs';
import {mealSupplyReadModel} from './meal-policy.mjs';

export const WORLD_OBSERVER_SCHEMA = 'deskbot.world-observer-snapshot.v1';
const active = task => ['running', 'paused'].includes(task.status);

// Observer knowledge only. This projection never enters an actor's prompt and
// does not create tasks, switch planners, instantiate a worker or call a model.
export function worldRuntimeReadModel(world, {
  autonomousLifeEnabled = false, worldLifeEnabled = false,
  cognitiveWorkerRunning = false, modelConfigured = false, reservedActors = [],
  scope='live',
} = {}) {
  const people = [{ actor_id: world.protagonist.character_id, display_name: world.protagonist.display_name ?? '喵呜' },
    ...world.npcs.map(n => ({ actor_id: n.npc_id, display_name: n.display_name }))];
  const tasks = (world.tasks ?? []).filter(active);
  const socialReserved = reservedSocialActors(world);
  const actors = people.map(person => {
    const id = person.actor_id, autonomy = world.autonomy?.actors?.[id], cognition = world.cognition?.actors?.[id];
    const ownTasks = tasks.filter(t => t.actor_id === id);
    const reserved = reservedActors.includes(id) || socialReserved.includes(id);
    const scheduler = cognition?.enabled ? 'continuous_cognition'
      : reserved ? 'committed_plan' : autonomousLifeEnabled && world.autonomy?.enabled && autonomy ? 'autonomous_life'
      : worldLifeEnabled && !world.autonomy?.enabled && id !== world.protagonist.character_id ? 'legacy_routine' : 'manual';
    const paused = scheduler === 'autonomous_life' && autonomy.paused === true;
    const workerUnavailable = scheduler === 'continuous_cognition' && !cognitiveWorkerRunning;
    const waitSince = autonomy?.meal_wait_started_at;
    const waiting = Boolean(autonomy?.plan?.goal === 'wait-meal' && ['planned', 'executing'].includes(autonomy.plan.status));
    return { ...person, scheduler, decision_mode: scheduler === 'continuous_cognition' ? 'continuous_model'
      : scheduler === 'autonomous_life' ? world.memory?.planner?.enabled && modelConfigured ? 'bounded_model_choice' : 'rules' : scheduler,
      status: workerUnavailable ? 'worker_unavailable' : paused ? 'paused' : ownTasks.some(t => t.status === 'paused') ? 'task_paused' : ownTasks.length ? 'occupied' : 'ready',
      task_ids: ownTasks.map(t => t.task_id), next_decision_at: cognition?.enabled ? cognition.next_decision_at ?? null : autonomy?.next_decision_at ?? null,
      awaiting_meal: waiting, meal_wait_recorded_at: waiting && Number.isFinite(Date.parse(waitSince)) ? waitSince : null,
      wait_reason:waiting?autonomy.plan.wait_context?.reason??null:null,
      meal_need_due_at:autonomy?.meal_need?.due_at??null,
      // This timestamp may precede offline gaps; never call it online waiting duration.
      wait_time_basis: 'wall_timestamp_not_online_duration',
      latest_blocker: autonomy?.last_feedback?.reason ?? null,
      conflicts: ownTasks.length > 1 ? ['multiple_active_tasks'] : [],
    };
  });
  const facilities = [...new Set(tasks.map(t => t.target_object_id).filter(Boolean))].map(id => ({
    object_id: id, name: world.map_catalog?.objects?.find(o => o.object_id === id)?.name ?? id,
    tasks: tasks.filter(t => t.target_object_id === id).map(t => ({ task_id: t.task_id, actor_id: t.actor_id, title: t.title, status: t.status, due_at: t.due_at ?? null })),
  }));
  return { schema: 'deskbot.world-runtime.v1', world_id: world.world_id, world_revision: world.world_revision,
    scope, clock_mode: world.clock?.mode ?? 'simulation', actors, facilities,meal_supply:mealSupplyReadModel(world),
    continuous_cognition_count: actors.filter(a => a.scheduler === 'continuous_cognition').length,
    meal_wait_count: actors.filter(a => a.awaiting_meal).length,
    model_configured: modelConfigured, cognitive_worker_running: cognitiveWorkerRunning,
  };
}

/** One synchronous authoritative read; all projections share its revision and
 * projection time. Inspired by the experiment branch's observer contract,
 * adapted to the current Python cognition + canonical role-stage pipeline.
 * This first slice deliberately uses HTTP polling, with no new history ledger.
 */
export function createWorldObserver({ persistentWorld, worldLife, roleEvolution,
  inputReadModel = null, runtimeOptions = () => ({}), now = () => new Date(), instanceId = randomUUID() }) {
  let capture = 0;
  function snapshot({ worldId, characterId } = {}) {
    const { world, sequence } = persistentWorld.readSnapshot({ worldId });
    if (!world) throw Object.assign(new Error('world not found'), { statusCode: 404, code: 'world_not_found' });
    if (characterId && characterId !== world.protagonist.character_id) {
      throw Object.assign(new Error('observer follows the protagonist; NPC details are in the same snapshot'), { statusCode: 400, code: 'invalid_observer_character' });
    }
    const at = now(), actorId = world.protagonist.character_id;
    const map = getWorldMap(world, { characterId: actorId, now: at });
    if (map.refraction && inputReadModel) map.refraction = inputReadModel(world, at);
    const stages = roleEvolution.currentStages({ characterId: actorId, world, at });
    const life = worldLife.snapshot(world, { stages });
    const role_wishes = { world_id: world.world_id, world_revision: world.world_revision,
      evolution: roleEvolution.snapshot({ characterId: actorId, world, at }),
      proposals: roleEvolution.wishProposals({ characterId: actorId, world, at }) };
    const runtime = worldRuntimeReadModel(world, { ...runtimeOptions(world), at: at.toISOString() });
    if ([map, life, role_wishes, runtime].some(view => view.world_revision !== world.world_revision)) throw new Error('observer projection revision mismatch');
    return { schema: WORLD_OBSERVER_SCHEMA, world_id: world.world_id, world_revision: world.world_revision,
      sequence, instance_id: instanceId, capture: ++capture,
      snapshot_id: `${instanceId}:${capture}:${world.world_revision}:${sequence}`, captured_at: at.toISOString(),
      map, life, role_wishes, runtime };
  }
  return { snapshot };
}
