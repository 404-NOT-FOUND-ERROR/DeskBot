import { InputError } from './input-store.mjs';
import { DEFAULT_CHARACTER_ID } from './world-definition.mjs';
import { previewWorldMutations } from './persistent-world.mjs';

const ACTIVE_STATES = new Set(['active', 'waiting']);
const RESERVED_STATES = new Set(['active', 'waiting', 'paused', 'failed']);
const TERMINAL_STATES = new Set(['completed', 'cancelled', 'missed']);
const CONDITION_KINDS = new Set(['always', 'event_present', 'npc_status']);

const requireText = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new InputError(400, 'invalid_goal', 'Expected text up to 500 characters');
  return value.trim();
};

function optionalDateTime(value, field) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new InputError(400, 'invalid_goal', `${field} must be a valid date-time`);
  return new Date(timestamp).toISOString();
}

function conditionSatisfied(when, world) {
  if (when.kind === 'always') return true;
  if (when.kind === 'event_present') return world.world_line.recent_events.some(event => event.event_id === when.value);
  return world.npcs.some(npc => npc.npc_id === when.npc_id && npc.status === when.value);
}

function normalizeWhen(value, npcId) {
  if (!value || !CONDITION_KINDS.has(value.kind)) throw new InputError(400, 'invalid_goal', 'Unsupported world condition');
  return {
    kind: value.kind,
    ...(value.kind === 'always' ? {} : { value: requireText(value.value) }),
    ...(value.kind === 'npc_status' ? { npc_id: npcId } : {}),
  };
}

function normalizePayload(value, npcId) {
  const source = value?.payload && typeof value.payload === 'object' ? value.payload : value;
  const payload = {
    action: 'npc_action',
    npc_id: npcId,
    action_name: requireText(source?.action_name),
    status: requireText(source?.status),
  };
  if (source?.location_id !== undefined && source?.location_id !== null && String(source.location_id).trim()) {
    payload.location_id = requireText(String(source.location_id));
  }
  return payload;
}

function normalizeFeedback(value, npcId, kind) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError(400, 'invalid_goal', `${kind} feedback must be an object`);
  return {
    action: 'npc_action',
    npc_id: npcId,
    action_name: requireText(value.action_name ?? `goal_${kind}`),
    status: requireText(value.status),
  };
}

function eventFor(goal, step, timestamp, suffix = 'apply', payload = step.payload) {
  return {
    event_id: `npc-goal:${goal.id}:${step.step_id}:${suffix}`,
    type: 'world.mutation',
    source: goal.origin === 'world-life-engine' ? 'world-life-engine' : 'npc-goal-engine',
    source_kind: 'world_engine',
    layer: 'world_line',
    character_id: DEFAULT_CHARACTER_ID,
    occurred_at: timestamp,
    observed_at: timestamp,
    payload: { ...payload, occurred_at: timestamp },
  };
}

// Authored finite goals. Legacy ordered alternatives remain readable while steps-v1
// advances at most one durable action per tick.
export function createNpcGoals({ persistence = null, now = () => new Date(), worldSnapshot, ingest, reserved = () => false }) {
  const goals = new Map((persistence?.list('life.npc-goals') ?? []).map(goal => [goal.id, goal]));
  function save(goal) { persistence?.put('life.npc-goals', goal.id, goal); goals.set(goal.id, goal); return structuredClone(goal); }
  function pruneManagedGoals() {
    const stale = [...goals.values()]
      .filter(goal => goal.origin === 'world-life-engine' && [...TERMINAL_STATES, 'failed'].includes(goal.state))
      .sort((left, right) => String(right.completed_at ?? right.ended_at ?? right.created_at).localeCompare(String(left.completed_at ?? left.ended_at ?? left.created_at)))
      .slice(12);
    for (const goal of stale) {
      goals.delete(goal.id);
      persistence?.remove?.('life.npc-goals', goal.id);
    }
  }
  function assertNpcAvailable(npcId) {
    if (reserved(npcId) || [...goals.values()].some(goal => goal.npc_id === npcId && RESERVED_STATES.has(goal.state))) {
      throw new InputError(409, 'npc_reserved', 'NPC already has an unfinished plan or goal');
    }
  }
  function add(body) {
    const id = requireText(body.id);
    const npcId = requireText(body.npc_id);
    if (goals.has(id)) throw new InputError(409, 'goal_exists', 'Goal ID already exists');
    assertNpcAvailable(npcId);
    const origin = body.origin === 'world-life-engine' ? 'world-life-engine' : 'author';
    const base = { id, npc_id: npcId, purpose: requireText(body.purpose), origin, state: 'active', created_at: now().toISOString() };

    if (Array.isArray(body.steps)) {
      if (!body.steps.length || body.steps.length > 20) throw new InputError(400, 'invalid_goal', 'Provide 1 to 20 ordered steps');
      const seen = new Set();
      const steps = body.steps.map((source, index) => {
        if (!source || typeof source !== 'object') throw new InputError(400, 'invalid_goal', 'Invalid goal step');
        const stepId = requireText(source.step_id ?? `step-${index + 1}`);
        if (seen.has(stepId)) throw new InputError(400, 'invalid_goal', 'Step IDs must be unique');
        seen.add(stepId);
        const waitUntil = optionalDateTime(source.wait_until, 'wait_until');
        const deadlineAt = optionalDateTime(source.deadline_at, 'deadline_at');
        if (waitUntil && deadlineAt && waitUntil > deadlineAt) throw new InputError(400, 'invalid_goal', 'wait_until must not be after deadline_at');
        return {
          step_id: stepId,
          when: normalizeWhen(source.when ?? { kind: 'always' }, npcId),
          payload: normalizePayload(source, npcId),
          wait_until: waitUntil,
          deadline_at: deadlineAt,
          on_missed: normalizeFeedback(source.on_missed, npcId, 'missed'),
          on_failed: normalizeFeedback(source.on_failed, npcId, 'failed'),
          state: 'pending',
          decision: null,
        };
      });
      previewWorldMutations(worldSnapshot(), steps.map(step => step.payload));
      return save({ ...base, format: 'steps-v1', steps, current_step_index: 0, step_history: [], waiting: null });
    }

    if (!Array.isArray(body.options) || !body.options.length || body.options.length > 5) throw new InputError(400, 'invalid_goal', 'Provide 1 to 5 ordered alternatives or a steps array');
    const options = body.options.map(option => {
      const when = normalizeWhen(option?.when, npcId);
      if (when.kind === 'always') throw new InputError(400, 'invalid_goal', 'Legacy alternatives need an explicit condition');
      const payload = normalizePayload(option, npcId);
      previewWorldMutations(worldSnapshot(), [payload]);
      return { when, payload };
    });
    return save({ ...base, format: 'alternatives-v1', options, decision: null });
  }
  function control(id, operation) {
    const current = goals.get(id);
    if (!current) throw new InputError(404, 'goal_not_found', 'Goal not found');
    if (!['pause', 'resume', 'cancel'].includes(operation)) throw new InputError(400, 'invalid_goal_operation', 'Invalid goal operation');
    if (TERMINAL_STATES.has(current.state) || (operation !== 'cancel' && current.state === 'failed')) throw new InputError(409, 'goal_terminal', 'Create a new goal after this terminal goal');
    if (operation === 'resume' && current.state !== 'paused') throw new InputError(409, 'goal_not_paused', 'Only a paused goal can resume');
    const state = operation === 'pause' ? 'paused' : operation === 'resume' ? 'active' : 'cancelled';
    return save({ ...current, state, waiting: state === 'active' ? null : current.waiting, ...(state === 'cancelled' ? { ended_at: now().toISOString() } : {}) });
  }
  function deliverFeedback(goal, step, kind, errorCode = null) {
    const payload = kind === 'missed' ? step.on_missed : step.on_failed;
    if (!payload) return null;
    const timestamp = now().toISOString();
    const event = eventFor(goal, step, timestamp, kind, payload);
    try {
      const result = ingest(event);
      return { kind, event_id: event.event_id, status: 'applied', duplicate: Boolean(result?.duplicate), error: errorCode };
    } catch (error) {
      return { kind, event_id: event.event_id, status: 'failed', error: error?.code ?? 'npc_goal_feedback_failed', cause: errorCode };
    }
  }
  function tickSteps(original) {
    const goal = structuredClone(original);
    const step = goal.steps[goal.current_step_index];
    if (!step) {
      goal.state = 'completed';
      goal.completed_at ??= now().toISOString();
      save(goal);
      return;
    }
    const timestamp = now();
    const world = worldSnapshot();
    const deadlinePassed = step.deadline_at && timestamp.getTime() > Date.parse(step.deadline_at);
    const readyAtPassed = !step.wait_until || timestamp.getTime() >= Date.parse(step.wait_until);
    const conditionReady = conditionSatisfied(step.when, world);

    if (deadlinePassed && (!readyAtPassed || !conditionReady)) {
      step.state = 'missed';
      step.ended_at = timestamp.toISOString();
      step.error = 'deadline_missed';
      const feedback = deliverFeedback(goal, step, 'missed', step.error);
      goal.step_history.push({ step_id: step.step_id, state: 'missed', ended_at: step.ended_at, error: step.error, feedback });
      goal.state = 'missed';
      goal.ended_at = step.ended_at;
      goal.waiting = null;
      save(goal);
      return;
    }
    if (!readyAtPassed || !conditionReady) {
      goal.state = 'waiting';
      goal.waiting = {
        step_id: step.step_id,
        reason: !readyAtPassed ? 'wait_until' : 'condition',
        wait_until: step.wait_until,
        deadline_at: step.deadline_at,
        condition: step.when,
        since: goal.waiting?.step_id === step.step_id ? goal.waiting.since : timestamp.toISOString(),
      };
      save(goal);
      return;
    }
    if (reserved(goal.npc_id)) return;
    if (!step.decision) {
      const occurredAt = timestamp.toISOString();
      step.decision = { world_revision: world.world_revision, condition: step.when, event: eventFor(goal, step, occurredAt) };
      step.state = 'decided';
      goal.state = 'active';
      goal.waiting = null;
      save(goal);
    }
    try {
      const result = ingest(step.decision.event);
      step.state = 'completed';
      step.ended_at = now().toISOString();
      goal.step_history.push({ step_id: step.step_id, state: 'completed', ended_at: step.ended_at, event_id: step.decision.event.event_id, duplicate: Boolean(result?.duplicate) });
      goal.current_step_index += 1;
      goal.state = goal.current_step_index >= goal.steps.length ? 'completed' : 'active';
      if (goal.state === 'completed') goal.completed_at = step.ended_at;
    } catch (error) {
      step.state = 'failed';
      step.ended_at = now().toISOString();
      step.error = error?.code ?? 'npc_action_failed';
      const feedback = deliverFeedback(goal, step, 'failed', step.error);
      goal.step_history.push({ step_id: step.step_id, state: 'failed', ended_at: step.ended_at, error: step.error, feedback });
      goal.state = 'failed';
      goal.error = step.error;
      goal.ended_at = step.ended_at;
    }
    save(goal);
  }
  function tickLegacy(original) {
    const goal = structuredClone(original);
    if (!goal.decision) {
      if (reserved(goal.npc_id)) return;
      const world = worldSnapshot();
      const index = goal.options.findIndex(option => conditionSatisfied(option.when, world));
      if (index < 0) return;
      const chosen = goal.options[index];
      const timestamp = now().toISOString();
      goal.decision = { option_index: index, condition: chosen.when, world_revision: world.world_revision,
        event: { ...eventFor(goal, { step_id: 'legacy', payload: chosen.payload }, timestamp), event_id: `npc-goal:${goal.id}` } };
      save(goal);
    }
    try { ingest(goal.decision.event); goal.state = 'completed'; goal.completed_at = now().toISOString(); }
    catch (error) { goal.state = 'failed'; goal.error = error.code ?? 'npc_action_failed'; goal.ended_at = now().toISOString(); }
    save(goal);
  }
  function tick() {
    let processed = 0;
    for (const original of goals.values()) {
      if (!ACTIVE_STATES.has(original.state)) continue;
      if (original.format === 'steps-v1' || Array.isArray(original.steps)) tickSteps(original);
      else tickLegacy(original);
      processed += 1;
    }
    pruneManagedGoals();
    return { processed };
  }
  return {
    add,
    control,
    tick,
    list: () => structuredClone([...goals.values()]),
    reserved: npcId => [...goals.values()].some(goal => goal.npc_id === npcId && RESERVED_STATES.has(goal.state)),
  };
}

export { ACTIVE_STATES, RESERVED_STATES };
