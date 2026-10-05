/**
 * A small, replayable NPC decision layer inspired by NevaMind's split between
 * legal world actions and an agent choosing one of them.
 *
 * This module never mutates the world. It only records a decision and returns
 * a candidate for world-life/npc-goals to validate and execute.
 */

import { findWorldPath, worldHopAccess } from './world-map-content.mjs';

const DECISION_NAMESPACE = 'life.npc-agent-decisions';
const DECISION_SCHEMA = 'deskbot.npc-agent-decision.v0.1';
const SLOT_MINUTES = 120;
const MAX_DECISIONS = 120;
const AUTONOMY_PULSE_MODULUS = 8;

function clone(value) {
  return structuredClone(value);
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function slotKey(world) {
  const day = Math.max(1, Number(world?.logical_time?.day) || 1);
  const minute = Math.max(0, Number(world?.logical_time?.minute_of_day) || 0);
  return `${day}:${Math.floor(minute / SLOT_MINUTES)}`;
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function isAdjacent(world, from, to) {
  if (!from || !to || from === to) return false;
  return worldHopAccess(world, from, to).allowed;
}

function nextHopToward(world, from, target) {
  if (!from || !target || from === target) return null;
  return findWorldPath(world, from, target)?.[1] ?? null;
}

function candidate({
  id,
  actionName,
  locationId = null,
  status,
  priority,
  reason,
}) {
  return {
    candidate_id: id,
    action_name: actionName,
    ...(locationId ? { location_id: locationId } : {}),
    status: text(status, '保持自己的节奏'),
    priority,
    reason: text(reason, '当前生活中一个合法的小动作'),
  };
}

export function createNpcAgentLoop({
  now = () => new Date(),
  persistence = null,
  worldSnapshot,
  npcGoals = null,
  profiles = {},
  routines = {},
  enabled = true,
  decisionProvider = null,
} = {}) {
  if (typeof worldSnapshot !== 'function') throw new TypeError('npc agent loop needs worldSnapshot');

  const decisions = new Map(
    (persistence?.list?.(DECISION_NAMESPACE) ?? []).map((item) => [item.decision_id, item]),
  );

  function prune() {
    while (decisions.size > MAX_DECISIONS) {
      const oldestId = decisions.keys().next().value;
      if (oldestId === undefined) break;
      decisions.delete(oldestId);
      persistence?.remove?.(DECISION_NAMESPACE, oldestId);
    }
  }
  prune();

  function save(record) {
    const next = clone(record);
    decisions.set(next.decision_id, next);
    persistence?.put?.(DECISION_NAMESPACE, next.decision_id, next);
    prune();
    return clone(next);
  }

  function list({ npcId = null, limit = MAX_DECISIONS } = {}) {
    return [...decisions.values()]
      .filter((item) => !npcId || item.npc_id === npcId)
      .slice(-Math.max(1, Math.min(MAX_DECISIONS, Number(limit) || MAX_DECISIONS)))
      .map(clone);
  }

  function legalCandidates({ world, npc, profile, routine, scene = null }) {
    const legal = new Set(profile?.legal_actions ?? []);
    const result = [];
    const currentLocation = npc.location_id;
    const logicalSlot = Math.floor((Number(world.logical_time?.minute_of_day) || 0) / SLOT_MINUTES);
    const route = Array.isArray(routine?.route) ? routine.route : [];
    const routeTarget = route.length ? route[logicalSlot % route.length] : null;

    const routeHop = legal.has('move_to_adjacent_location') && routeTarget && routeTarget !== currentLocation
      ? nextHopToward(world, currentLocation, routeTarget)
      : null;
    if (routeHop && isAdjacent(world, currentLocation, routeHop)) {
      result.push(candidate({
        id: `route:${routeTarget}:${routeHop}`,
        actionName: 'move_to_adjacent_location',
        locationId: routeHop,
        status: `朝${routeTarget}走一步`,
        priority: 100,
        reason: '作者提供的目的地只是候选，代理只取通往它的一个合法相邻跳转',
      }));
    }

    if (legal.has('move_to_adjacent_location')) {
      const origin = (world.locations ?? []).find((location) => location.location_id === currentLocation);
      for (const neighbor of origin?.neighbors ?? []) {
        if (!isAdjacent(world, currentLocation, neighbor)) continue;
        if (neighbor === routeTarget) continue;
        result.push(candidate({
          id: `adjacent:${neighbor}`,
          actionName: 'move_to_adjacent_location',
          locationId: neighbor,
          status: `顺便看看${neighbor}有没有新的动静`,
          priority: 35,
          reason: '这是一个相邻地点，允许 NPC 自主偏离日程去观察',
        }));
      }
    }

    const sceneAction = scene?.npc_actions?.[npc.npc_id];
    if (sceneAction && legal.has(sceneAction.action_name)) {
      result.push(candidate({
        id: `scene:${sceneAction.action_name}`,
        actionName: sceneAction.action_name,
        status: sceneAction.status,
        priority: 90,
        reason: '当前 Scene 给出了一个与 NPC 身份相符的可执行动作',
      }));
    }

    if (legal.has('observe_current_location')) {
      result.push(candidate({
        id: `observe:${currentLocation}`,
        actionName: 'observe_current_location',
        status: npc.status,
        priority: 20,
        reason: '没有更强的目的地时，先观察眼前生活',
      }));
    }

    return result;
  }

  function chooseCandidate(candidates, context) {
    if (!candidates.length) return null;
    if (typeof decisionProvider === 'function') {
      try {
        const requested = decisionProvider({ candidates: clone(candidates), context: clone(context) });
        const requestedId = typeof requested === 'string' ? requested : requested?.candidate_id;
        const selected = candidates.find((item) => item.candidate_id === requestedId);
        if (selected) return selected;
      } catch {
        // Invalid providers never get to write world state; use the bounded
        // deterministic policy below instead.
      }
    }
    // A small, stable pulse lets an NPC occasionally follow its own curiosity.
    // It only considers already-legal adjacent observations, so this cannot
    // bypass authored routes or canonical-world movement validation.
    const explorations = candidates.filter((item) => item.candidate_id.startsWith('adjacent:'));
    const pulse = hash(`${context.npc.npc_id}:${context.slot_key}:autonomy`) % AUTONOMY_PULSE_MODULUS === 0;
    if (pulse && explorations.length) {
      return [...explorations].sort((left, right) => (
        hash(`${context.npc.npc_id}:${context.slot_key}:${left.candidate_id}`)
        - hash(`${context.npc.npc_id}:${context.slot_key}:${right.candidate_id}`)
      ))[0];
    }
    return [...candidates].sort((left, right) => (
      right.priority - left.priority
      || hash(`${context.npc.npc_id}:${context.slot_key}:${left.candidate_id}`)
        - hash(`${context.npc.npc_id}:${context.slot_key}:${right.candidate_id}`)
    ))[0];
  }

  function decide({ world = worldSnapshot(), npc, profile, routine, scene = null } = {}) {
    if (!enabled || !npc?.npc_id) return null;
    // One decision per NPC and logical slot. The chosen action may move the NPC;
    // a changed location must not grant a second decision in the same slot.
    const timeBasis = world.clock?.mode === 'real_time' ? `realtime:${world.logical_time.date}:` : '';
    const key = `${npc.npc_id}:${timeBasis}${slotKey(world)}`;
    const decisionId = `npc-agent:${key}`;
    const existing = decisions.get(decisionId);
    if (existing) {
      if (existing.status === 'planned' && existing.location_id !== npc.location_id) return markFailed(decisionId, 'npc_location_changed_before_execution');
      return clone(existing);
    }

    const context = { npc, slot_key: slotKey(world), world_revision: world.world_revision };
    const candidates = legalCandidates({ world, npc, profile: profile ?? profiles[npc.npc_id], routine: routine ?? routines[npc.npc_id], scene });
    const selected = chooseCandidate(candidates, context);
    if (!selected) return null;
    const autonomous = selected.candidate_id.startsWith('adjacent:')
      && !candidates.some((item) => item.candidate_id.startsWith('route:') && item.candidate_id === selected.candidate_id);

    return save({
      schema: DECISION_SCHEMA,
      decision_id: decisionId,
      npc_id: npc.npc_id,
      slot_key: context.slot_key,
      clock_mode: world.clock?.mode ?? 'simulation',
      calendar_date: world.logical_time.date ?? null,
      world_revision: world.world_revision,
      location_id: npc.location_id,
      legal_candidates: candidates,
      selected: clone(selected),
      selection_mode: autonomous ? 'autonomous_exploration' : 'routine_or_scene',
      status: 'planned',
      decided_at: now().toISOString(),
      executed_event_id: null,
      error: null,
    });
  }

  function markExecuted(decisionId, eventId) {
    const current = decisions.get(decisionId);
    if (!current) return null;
    return save({ ...current, status: 'executed', executed_event_id: eventId ?? null, executed_at: now().toISOString(), error: null });
  }

  function markFailed(decisionId, error) {
    const current = decisions.get(decisionId);
    if (!current) return null;
    return save({ ...current, status: 'failed', error: text(error, 'npc_agent_action_failed'), failed_at: now().toISOString() });
  }

  function bindGoal(decisionId, goalId) {
    const current = decisions.get(decisionId);
    if (!current || typeof goalId !== 'string' || !goalId.trim()) return null;
    if (current.goal_id === goalId) return clone(current);
    return save({ ...current, goal_id: goalId.trim() });
  }

  // npc-goals has two durable formats: steps-v1 records the mutation in
  // step_history, while legacy alternatives-v1 stores it on decision.event.
  // Keep the observation API stable across both formats after a restart.
  function executedEventId(goal) {
    return goal?.step_history?.at(-1)?.event_id
      ?? goal?.decision?.event?.event_id
      ?? null;
  }

  function goalIdForDecision(decision) {
    const [dayText, slotText] = String(decision?.slot_key ?? '').split(':');
    const day = Number(dayText);
    const slot = Number(slotText);
    if (!Number.isInteger(day) || !Number.isInteger(slot) || day < 1 || slot < 0) return null;
    const slotsPerDay = 1440 / SLOT_MINUTES;
    const timeBasis = decision.clock_mode === 'real_time' ? `realtime:${decision.calendar_date}:` : '';
    return `world-life-routine:${decision.npc_id}:${timeBasis}${(day - 1) * slotsPerDay + slot}`;
  }

  // Reconcile the durable decision journal with npc-goals after a restart.
  // The goal engine is the execution authority; this only repairs the
  // decision's observation state and never writes a world mutation.
  function reconcile({ goals = [] } = {}) {
    const byId = new Map((Array.isArray(goals) ? goals : []).map((goal) => [goal.id, goal]));
    const repaired = [];
    for (const decision of [...decisions.values()]) {
      if (decision.status !== 'planned') continue;
      const goalId = decision.goal_id ?? goalIdForDecision(decision);
      const goal = goalId ? byId.get(goalId) : null;
      if (!goal) continue;
      if (goal.state === 'completed') {
        repaired.push(markExecuted(decision.decision_id, executedEventId(goal)));
      } else if (['failed', 'missed', 'cancelled'].includes(goal.state)) {
        repaired.push(markFailed(decision.decision_id, `npc_goal_${goal.state}`));
      } else if (goalId && decision.goal_id !== goalId) {
        repaired.push(bindGoal(decision.decision_id, goalId));
      }
    }
    return repaired.filter(Boolean);
  }

  return {
    decide,
    list,
    markExecuted,
    markFailed,
    bindGoal,
    reconcile,
    legalCandidates,
    slotMinutes: SLOT_MINUTES,
  };
}

export { AUTONOMY_PULSE_MODULUS, DECISION_NAMESPACE, DECISION_SCHEMA, MAX_DECISIONS, SLOT_MINUTES };
