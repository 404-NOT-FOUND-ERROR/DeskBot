import { createHash } from 'node:crypto';
import { localWorldDate } from './realtime-world.mjs';

/**
 * Bounded cognition scheduling, adapted from Asamana's cadence gate.
 *
 * This module only answers whether a NEW model cognition request is worth
 * starting. It never cancels, pauses, or delays a canonical task, travel,
 * resource settlement, social commitment, or an already running request.
 * The state is deliberately kept under world.memory so the existing SQLite
 * canonical-world snapshot is the only persistence mechanism.
 */
export const COGNITION_CADENCE_SCHEMA = 'deskbot.cognition-cadence.v1';
export const COGNITION_CADENCE_RULE_VERSION = 'cadence-v1';
export const CADENCE_MIN_INTERVAL_MS = 120 * 60 * 1000;
export const CADENCE_MAIN_MAX_IDLE_MS = 180 * 60 * 1000;
export const CADENCE_BACKGROUND_MAX_IDLE_MS = 360 * 60 * 1000;
const FEEDBACK_KINDS = new Set(['completed', 'plan_completed', 'failed', 'replan', 'cancelled']);
const PRESSURE_CATEGORIES = new Set(['weather', 'external', 'agent', 'body', 'dialogue', 'user']);

const timestamp = value => Number.isFinite(Date.parse(value ?? '')) ? Date.parse(value) : null;
const actorIdOf = state => state?.actor_id ?? null;

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

function actor(world, id) {
  return id === world.protagonist?.character_id
    ? world.protagonist
    : (world.npcs ?? []).find(person => (person.character_id ?? person.npc_id) === id);
}

function actorIsMain(world, id) {
  return id === world.protagonist?.character_id;
}

function entry(world, id, at) {
  const cadence = world.memory.cognition_cadence;
  cadence.actors[id] ??= {
    actor_id: id,
    last_decision_at: null,
    last_reason: null,
    last_skip_reason: null,
    last_stable_key: null,
    last_evaluated_at: null,
    last_trigger_at: null,
    last_emotion_key: null,
    decision_count: 0,
    evaluation_count: 0,
    history: [],
    updated_at: at,
  };
  return cadence.actors[id];
}

/** Install/restore the persistent cadence projection without replacing data. */
export function ensureCognitionCadence(world, at) {
  if (!world?.memory) return { enabled: false, reason: 'memory_required' };
  const fresh = !world.memory.cognition_cadence;
  world.memory.cognition_cadence ??= {
    schema: COGNITION_CADENCE_SCHEMA,
    rule_version: COGNITION_CADENCE_RULE_VERSION,
    installed_at: at,
    revision: 0,
    actors: {},
  };
  const ids = [world.protagonist?.character_id, ...(world.npcs ?? []).map(person => person.character_id ?? person.npc_id)]
    .filter(Boolean);
  for (const id of ids) entry(world, id, at);
  return { enabled: true, fresh, cadence: world.memory.cognition_cadence };
}

/**
 * A stable key identifies the exact candidate set being considered. It makes
 * repeated wakeups and retries observationally idempotent without using model
 * prose as a source of truth.
 */
export function cognitionStableKey(world, state, choices, at) {
  const person = actor(world, actorIdOf(state));
  return `cadence:${digest({
    actor_id: actorIdOf(state),
    sequence: state?.sequence ?? 0,
    location_id: person?.location_id ?? null,
    day: localWorldDate(at,world.clock?.time_zone??'Asia/Shanghai').date,
    choices: (choices ?? []).filter(choice => choice.available).map(choice => ({
      goal: choice.goal,
      score: choice.score,
      source_ids: [...(choice.source_ids ?? [])].sort(),
      facet_root_ids: [...(choice.facet_root_ids ?? [])].sort(),
    })),
  })}`;
}

function livePressure(world, state, choices, at) {
  // Read the planner's already-normalized, legal pressure candidates. Mere
  // co-location, raw prose, or a low-actionability report cannot wake everyone.
  const actionableIds = new Set((choices ?? []).filter(choice => choice.available
    && (Number(choice.score) || 0) >= 40).flatMap(choice => choice.source_ids ?? []));
  const records = (world.refraction?.records ?? []).filter(record => {
    const expires = timestamp(record.expires_at);
    return actionableIds.has(record.id) && record.attested === true && PRESSURE_CATEGORIES.has(record.category)
      && ['pending', 'observed', 'chosen', 'deferred'].includes(record.status ?? 'observed')
      && (expires === null || expires > Date.parse(at));
  });
  const social = (world.social?.commitments ?? []).filter(commitment =>
    (commitment.actors ?? []).includes(actorIdOf(state))
      && ['proposed', 'accepted', 'active'].includes(commitment.status));
  return {
    ids: [...records.map(record => record.id), ...social.map(commitment => commitment.id)].filter(Boolean).slice(-12),
    count: records.length + social.length,
  };
}

function canonicalFeedback(world, state, at, lastDecisionAt) {
  const after = timestamp(lastDecisionAt) ?? -Infinity;
  const own = (world.autonomy?.recent ?? []).filter(note => note.actor_id === actorIdOf(state));
  const notes = own.filter(note => FEEDBACK_KINDS.has(note.kind) && (timestamp(note.at) ?? -Infinity) > after && (timestamp(note.at) ?? -Infinity) <= Date.parse(at));
  const tasks = (world.tasks ?? []).filter(task => task.actor_id === actorIdOf(state)
    && ['completed', 'failed', 'cancelled'].includes(task.status)
    && (timestamp(task.finished_at ?? task.completion?.due_at) ?? -Infinity) > after
    && (timestamp(task.finished_at ?? task.completion?.due_at) ?? -Infinity) <= Date.parse(at));
  const latest = [...notes, ...tasks.map(task => ({
    at: task.finished_at ?? task.completion?.due_at,
    kind: task.status,
    task_id: task.task_id,
  }))].sort((a, b) => (timestamp(b.at) ?? 0) - (timestamp(a.at) ?? 0))[0];
  return latest ? { id: latest.task_id ?? `${latest.kind}:${latest.at}`, kind: latest.kind, at: latest.at } : null;
}

function emotionalSalience(world, state, at, record) {
  const maintenance = world.memory?.maintenance?.actors?.[actorIdOf(state)];
  if (!maintenance?.feelings?.length) return null;
  const factual = new Set((world.memory.episodes ?? [])
    .filter(item => item.kind === 'world_fact' && item.model_safe === true).map(item => item.id));
  const after = timestamp(record.last_decision_at) ?? -Infinity;
  const usable = maintenance.feelings.filter(feeling => {
    const when = timestamp(feeling.at);
    const sources = Array.isArray(feeling.source_ids) ? feeling.source_ids : [];
    const expires = timestamp(feeling.expires_at);
    return when !== null && when > after && when <= Date.parse(at)
      && (expires === null || expires > Date.parse(at))
      && sources.length > 0 && sources.every(id => factual.has(id));
  });
  if (!usable.length) return null;
  const ids = [...new Set(usable.flatMap(feeling => feeling.source_ids))].sort();
  const key = digest([maintenance.request?.id ?? null, ids, usable.map(item => [item.feeling,item.at])]);
  if (key === record.last_emotion_key) return null;
  return { key, ids, feeling: usable.at(-1).feeling };
}

function needSignal(state, choices) {
  const maxChoice = Math.max(0, ...(choices ?? []).filter(choice => choice.available).map(choice => Number(choice.score) || 0));
  const energy = Number(state?.energy);
  const appetite = Number(state?.appetite);
  return {
    active: (Number.isFinite(energy) && energy < .65) || (Number.isFinite(appetite) && appetite > .55),
    urgent: (Number.isFinite(energy) && energy < .4) || (Number.isFinite(appetite) && appetite > .9),
    max_choice: maxChoice,
  };
}

/**
 * Evaluate cadence. `admit` means only "start a cognition request"; callers
 * still apply their existing urgent-needs and legal-action rules first.
 */
export function evaluateCognitionCadence(world, state, choices, at) {
  if (!world?.memory) return { admit: false, reason: 'memory_required' };
  const id = actorIdOf(state);
  const record = world.memory.cognition_cadence?.actors?.[id] ?? { last_decision_at: null };
  const stable_key = cognitionStableKey(world, state, choices, at);
  const legal = (choices ?? []).filter(choice => choice.available);
  if (!world.memory.planner?.enabled) return { admit: false, reason: 'planner_disabled', stable_key };
  if (legal.length < 2) return { admit: false, reason: 'no_candidates', stable_key };

  const now = Date.parse(at);
  const last = timestamp(record.last_decision_at);
  const elapsed = last === null ? null : Math.max(0, now - last);
  const needs = needSignal(state, legal);
  const pressure = livePressure(world, state, choices, at);
  const feedback = canonicalFeedback(world, state, at, record.last_decision_at);
  // Only M3 feelings grounded in canonical fact IDs may wake cognition.
  const emotion = emotionalSalience(world, state, at, record);
  let reason = null;
  if (last === null) reason = 'cold_start';
  else if (needs.active) reason = 'need';
  else if (pressure.count) reason = 'pressure';
  else if (emotion) reason = 'emotional_salience';
  else if (feedback) reason = 'feedback';
  else if (elapsed >= (actorIsMain(world, id) ? CADENCE_MAIN_MAX_IDLE_MS : CADENCE_BACKGROUND_MAX_IDLE_MS)) reason = 'max_idle';
  if (!reason) return { admit: false, reason: 'idle_window', stable_key, elapsed_ms: elapsed, needs, pressure, feedback };
  if (last !== null && elapsed < CADENCE_MIN_INTERVAL_MS) {
    return { admit: false, reason: 'cooldown', trigger: reason, stable_key, elapsed_ms: elapsed, needs, pressure, feedback };
  }
  return { admit: true, reason, stable_key, elapsed_ms: elapsed, needs, pressure, feedback, emotion };
}

/** Record an admission or skip once per stable evaluation, with bounded history. */
export function recordCognitionCadence(world, state, at, decision) {
  if (!world?.memory || !decision) return decision;
  ensureCognitionCadence(world, at);
  const record = entry(world, actorIdOf(state), at);
  const duplicate = record.last_evaluated_at === at && record.last_stable_key === decision.stable_key
    && record.last_reason === (decision.admit ? decision.reason : record.last_reason)
    && record.last_skip_reason === (decision.admit ? null : decision.reason);
  if (duplicate) return decision;
  record.evaluation_count++;
  record.last_evaluated_at = at;
  record.last_stable_key = decision.stable_key ?? record.last_stable_key;
  if (decision.admit) {
    record.last_decision_at = at;
    record.last_reason = decision.reason;
    record.last_skip_reason = null;
    record.last_trigger_at = at;
    if (decision.emotion?.key) record.last_emotion_key = decision.emotion.key;
    record.decision_count++;
  } else {
    record.last_skip_reason = decision.reason;
  }
  record.updated_at = at;
  record.history.push({ at, admitted: decision.admit === true, reason: decision.reason, stable_key: decision.stable_key ?? null });
  record.history = record.history.slice(-32);
  world.memory.cognition_cadence.revision++;
  return decision;
}

export function cognitionCadenceReadModel(world) {
  const cadence = world?.memory?.cognition_cadence;
  return cadence ? structuredClone(cadence) : null;
}
