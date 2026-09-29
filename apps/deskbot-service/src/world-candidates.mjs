import { createHash } from 'node:crypto';

import { previewWorldMutations } from './persistent-world.mjs';

/**
 * World candidates are an approval boundary between an external observation
 * and the canonical world.  An observation may suggest a small, structured
 * action, but only the candidate bridge can turn it into a world.mutation
 * event.  This module deliberately does not expose a way to submit arbitrary
 * mutation payloads from the HTTP layer.
 */

const CANDIDATE_NAMESPACE = 'world.candidates';
const DECISION_NAMESPACE = 'world.candidate-decisions';
const RULE_VERSION = 'world-candidates.v0.1';
const DEFAULT_WORLD_ID = 'deskbot-small-world';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CANDIDATES = 200;
const MAX_ACTIONS = 4;

const CANDIDATE_STATUSES = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  DISMISSED: 'dismissed',
  EXPIRED: 'expired',
});

const OBSERVATION_TYPES = Object.freeze([
  'external.observation',
  'external.context',
  'external.world_event',
  'news.observation',
  'news.world_event',
  'weather.observation',
  'world.observation',
]);

const SAFE_ACTIONS = new Set([
  'advance_time',
  'apply_world_line_event',
  'enqueue_pending_item',
  'record_external_context',
  'update_weather',
  'advance_calendar',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function text(value, field, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    throw new WorldCandidateError(400, 'invalid_world_candidate', `${field} must be a non-empty string`);
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WorldCandidateError(400, 'invalid_world_candidate', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value, field) {
  return text(value, field, { optional: true });
}

function iso(value, field, fallback = null) {
  const candidate = value ?? fallback;
  if (candidate === null || candidate === undefined) return null;
  const date = candidate instanceof Date ? candidate : new Date(candidate);
  if (Number.isNaN(date.valueOf())) {
    throw new WorldCandidateError(400, 'invalid_world_candidate', `${field} must be an ISO date-time string`);
  }
  return date.toISOString();
}

function integer(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new WorldCandidateError(400, 'invalid_world_candidate', `${field} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function boundedLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(Math.max(Number.isFinite(parsed) ? parsed : fallback, 1), MAX_CANDIDATES);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function sourceEventIds(event) {
  const fromProvenance = event?.provenance?.source_event_ids ?? event?.provenance?.event_ids;
  const values = Array.isArray(fromProvenance) ? fromProvenance : [];
  return [...new Set([event?.event_id, ...values].filter(value => typeof value === 'string' && value.trim() !== '').map(value => value.trim()))];
}

function isSuppressedObservation(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return true;
  const type = typeof event.type === 'string' ? event.type : '';
  const source = typeof event.source === 'string' ? event.source : '';
  if (!type || type === 'world.mutation') return true;
  if (event.payload?.role === 'assistant' || type === 'conversation.reply') return true;
  if (type.startsWith('voice.') || type.startsWith('transport.') || type.startsWith('service.')) return true;
  if (source === 'world-candidate-bridge' || source === 'role-evolution-engine') return true;
  return !OBSERVATION_TYPES.includes(type);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeWorldEvent(item, fallbackEventId, source) {
  const value = safeObject(item);
  const title = optionalText(value.title, 'event.title');
  const summary = optionalText(value.summary, 'event.summary');
  if (!title && !summary) return null;
  const event = {
    event_id: optionalText(value.event_id, 'event.event_id') ?? fallbackEventId,
    title: title ?? summary,
  };
  for (const key of ['summary', 'daily_consequence', 'opportunity', 'unresolved_hook', 'arc_id', 'status', 'outcome', 'occurred_at']) {
    if (value[key] !== undefined && value[key] !== null) {
      event[key] = key === 'occurred_at' ? iso(value[key], `event.${key}`) : optionalText(value[key], `event.${key}`);
    }
  }
  event.source = optionalText(value.source, 'event.source') ?? source;
  return event;
}

function safeExternalItem(item, fallbackItemId, source, observedAt) {
  const value = safeObject(item);
  const title = optionalText(value.title, 'item.title');
  const summary = optionalText(value.summary, 'item.summary');
  if (!title && !summary) return null;
  const normalized = {
    item_id: optionalText(value.item_id, 'item.item_id') ?? fallbackItemId,
    title: title ?? summary,
  };
  for (const key of ['summary', 'category', 'url', 'published_at', 'observed_at', 'provider']) {
    if (value[key] !== undefined && value[key] !== null) {
      normalized[key] = ['published_at', 'observed_at'].includes(key)
        ? iso(value[key], `item.${key}`)
        : optionalText(value[key], `item.${key}`);
    }
  }
  normalized.provider ??= source;
  normalized.observed_at ??= observedAt;
  return normalized;
}

function safeWeatherSnapshot(snapshot, observedAt, source) {
  const value = safeObject(snapshot);
  const location = optionalText(value.location, 'snapshot.location');
  const condition = optionalText(value.condition, 'snapshot.condition');
  if (!location && !condition) return null;
  const normalized = {
    location: location ?? 'unknown',
    condition: condition ?? 'unknown',
    observed_at: iso(value.observed_at, 'snapshot.observed_at', observedAt),
    provider: optionalText(value.provider, 'snapshot.provider') ?? source,
  };
  for (const key of ['temperature_c', 'humidity', 'wind_mps']) {
    if (value[key] !== undefined && value[key] !== null) {
      if (typeof value[key] !== 'number' || !Number.isFinite(value[key])) {
        throw new WorldCandidateError(400, 'invalid_world_candidate', `snapshot.${key} must be a finite number`);
      }
      normalized[key] = value[key];
    }
  }
  return normalized;
}

function safeCalendar(value, observedAt) {
  const item = safeObject(value);
  const date = optionalText(item.date, 'calendar.date');
  if (!date) return null;
  const normalized = { date, observed_at: iso(item.observed_at, 'calendar.observed_at', observedAt) };
  for (const key of ['timezone', 'season', 'solar_term', 'holiday']) {
    if (item[key] !== undefined && item[key] !== null) normalized[key] = optionalText(item[key], `calendar.${key}`);
  }
  return normalized;
}

function safeActionHint(hint, candidateId, index, source, observedAt) {
  const value = safeObject(hint);
  const action = optionalText(value.action, 'action');
  if (!action || !SAFE_ACTIONS.has(action)) return null;
  const payload = safeObject(value.payload);
  switch (action) {
    case 'advance_time':
      return { action, minutes: integer(payload.minutes ?? value.minutes, 'minutes', 1, 7 * 24 * 60) };
    case 'apply_world_line_event': {
      const event = safeWorldEvent(payload.event ?? value.event, `${candidateId}:event:${index}`, source);
      return event ? { action, event } : null;
    }
    case 'enqueue_pending_item': {
      const item = safeObject(payload.item ?? value.item);
      const summary = optionalText(item.summary, 'item.summary');
      if (!summary) return null;
      return {
        action,
        item: {
          item_id: optionalText(item.item_id, 'item.item_id') ?? `${candidateId}:item:${index}`,
          summary,
          ...(optionalText(item.kind, 'item.kind') ? { kind: item.kind.trim() } : {}),
          source: optionalText(item.source, 'item.source') ?? source,
        },
      };
    }
    case 'record_external_context': {
      const item = safeExternalItem(payload.item ?? value.item, `${candidateId}:context:${index}`, source, observedAt);
      return item ? { action, item } : null;
    }
    case 'update_weather': {
      const snapshot = safeWeatherSnapshot(payload.snapshot ?? value.snapshot, observedAt, source);
      return snapshot ? { action, snapshot } : null;
    }
    case 'advance_calendar': {
      const calendar = safeCalendar(payload.calendar ?? value.calendar ?? value, observedAt);
      return calendar ? { action, ...calendar } : null;
    }
    default:
      return null;
  }
}

function deriveActions(event, candidateId) {
  const payload = safeObject(event.payload);
  const observedAt = iso(event.observed_at ?? event.occurred_at, 'observed_at', new Date().toISOString());
  const source = optionalText(event.provider, 'provider') ?? optionalText(event.source, 'source') ?? 'external-observation';
  const actions = [];
  // An explicit hint remains constrained to the server-owned action whitelist
  // and is normalized field-by-field. It is never copied into ingest as-is.
  const hints = Array.isArray(payload.proposed_actions)
    ? payload.proposed_actions
    : payload.proposed_action ? [payload.proposed_action] : [];
  hints.forEach((hint, index) => {
    const action = safeActionHint(hint, candidateId, index, source, observedAt);
    if (action) actions.push(action);
  });

  const worldItem = payload.world_event ?? payload.event;
  if (actions.length === 0 && (event.type === 'external.world_event' || event.type === 'news.world_event' || event.type === 'world.observation' || worldItem)) {
    const eventValue = safeWorldEvent(worldItem ?? payload, `${candidateId}:event:0`, source);
    if (eventValue) actions.push({ action: 'apply_world_line_event', event: eventValue });
  }
  if (actions.length === 0 && (event.type === 'weather.observation' || payload.snapshot || payload.weather)) {
    const snapshot = safeWeatherSnapshot(payload.snapshot ?? payload.weather, observedAt, source);
    if (snapshot) actions.push({ action: 'update_weather', snapshot });
  }
  if (actions.length === 0 && (event.type === 'external.observation' || event.type === 'external.context' || event.type === 'news.observation')) {
    const item = safeExternalItem(payload.item ?? payload.context ?? payload, `${candidateId}:context:0`, source, observedAt);
    if (item) actions.push({ action: 'record_external_context', item });
  }
  return actions.slice(0, MAX_ACTIONS);
}

function sourceObservation(event) {
  return {
    schema: 'deskbot.world-candidate-observation.v0.1',
    event_id: text(event.event_id, 'event.event_id'),
    type: text(event.type, 'event.type'),
    source: optionalText(event.source, 'event.source'),
    source_kind: optionalText(event.source_kind, 'event.source_kind'),
    layer: optionalText(event.layer, 'event.layer'),
    provider: optionalText(event.provider, 'event.provider'),
    character_id: optionalText(event.character_id, 'event.character_id'),
    occurred_at: iso(event.occurred_at, 'event.occurred_at'),
    observed_at: iso(event.observed_at, 'event.observed_at', event.occurred_at),
    provenance: clone(event.provenance ?? null),
    payload: clone(event.payload ?? {}),
  };
}

function candidatePreview(world, actions) {
  assertFreshActions(world, actions);
  const projected = previewWorldMutations(world, actions);
  return {
    schema: 'deskbot.world-candidate-preview.v0.1',
    world_id: projected.world_id,
    world_revision_before: world.world_revision,
    projected_world_revision: world.world_revision + actions.length,
    action_count: actions.length,
    actions: clone(actions),
    projected_world: clone(projected),
  };
}

function assertFreshActions(world, actions) {
  let previousWeatherAt = world?.weather?.snapshot?.observed_at ?? null;
  for (const action of actions) {
    if (action.action !== 'update_weather') continue;
    const observedAt = action.snapshot?.observed_at ?? null;
    if (previousWeatherAt && observedAt && Date.parse(observedAt) < Date.parse(previousWeatherAt)) {
      throw new WorldCandidateError(409, 'stale_weather_observation', 'weather observation is older than the canonical snapshot');
    }
    if (observedAt) previousWeatherAt = observedAt;
  }
}

function createCandidateId(event) {
  return `world-candidate:${fingerprint({ event_id: event.event_id, event: event }).slice(0, 32)}`;
}

export class WorldCandidateError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'WorldCandidateError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createWorldCandidateStore({
  now = () => new Date(),
  persistence = null,
  worldSnapshot,
  ingest,
  listMutations = null,
  worldId = DEFAULT_WORLD_ID,
  ttlMs = DEFAULT_TTL_MS,
  maxCandidates = MAX_CANDIDATES,
} = {}) {
  if (typeof worldSnapshot !== 'function') throw new TypeError('worldSnapshot must be a function');
  if (typeof ingest !== 'function') throw new TypeError('ingest must be a function');
  if (listMutations !== null && typeof listMutations !== 'function') throw new TypeError('listMutations must be a function');
  if (!Number.isInteger(ttlMs) || ttlMs < 1) throw new TypeError('ttlMs must be a positive integer');
  const boundedMax = Math.min(Math.max(Number.parseInt(maxCandidates, 10) || MAX_CANDIDATES, 1), MAX_CANDIDATES);
  const candidates = new Map((persistence?.list?.(CANDIDATE_NAMESPACE) ?? []).map(item => [item.candidate_id, item]));
  const decisions = new Map((persistence?.list?.(DECISION_NAMESPACE) ?? []).map(item => [item.decision_id, item]));

  // An accept decision and its candidate status are one read-model contract.
  // A process can stop after the decision row is committed, so reconcile that
  // narrow recovery window before exposing the store after a restart.
  function reconcileAcceptedDecision(decision) {
    if (!decision || decision.action !== 'accept' || !decision.candidate_id) return null;
    const candidate = candidates.get(decision.candidate_id);
    if (!candidate || candidate.status === CANDIDATE_STATUSES.ACCEPTED) return candidate ?? null;
    const timestamp = decision.decided_at ?? now().toISOString();
    const repaired = {
      ...candidate,
      status: CANDIDATE_STATUSES.ACCEPTED,
      accepted_at: candidate.accepted_at ?? timestamp,
      updated_at: timestamp,
      decision_id: decision.decision_id,
    };
    candidates.set(repaired.candidate_id, clone(repaired));
    persistence?.put?.(CANDIDATE_NAMESPACE, repaired.candidate_id, repaired);
    return repaired;
  }

  for (const decision of decisions.values()) reconcileAcceptedDecision(decision);

  function saveCandidate(candidate) {
    const next = clone(candidate);
    candidates.set(next.candidate_id, next);
    persistence?.put?.(CANDIDATE_NAMESPACE, next.candidate_id, next);
    while (candidates.size > boundedMax) {
      const oldest = candidates.keys().next().value;
      if (oldest === undefined) break;
      candidates.delete(oldest);
      persistence?.remove?.(CANDIDATE_NAMESPACE, oldest);
    }
    return clone(next);
  }

  function saveDecision(decision) {
    const next = clone(decision);
    decisions.set(next.decision_id, next);
    persistence?.put?.(DECISION_NAMESPACE, next.decision_id, next);
    return clone(next);
  }

  function expire(candidate) {
    if (candidate.status === CANDIDATE_STATUSES.PENDING
      && candidate.expires_at
      && Date.parse(candidate.expires_at) <= now().getTime()) {
      return saveCandidate({ ...candidate, status: CANDIDATE_STATUSES.EXPIRED, updated_at: now().toISOString() });
    }
    return candidate;
  }

  function get(candidateId) {
    const candidate = candidates.get(text(candidateId, 'candidate_id'));
    return candidate ? expire(clone(candidate)) : null;
  }

  function list({ worldId: filterWorldId = null, characterId = null, status = null, limit = 50 } = {}) {
    return [...candidates.values()]
      .map(expire)
      .filter(item => !filterWorldId || item.world_id === filterWorldId)
      .filter(item => !characterId || item.character_id === characterId)
      .filter(item => !status || item.status === status)
      .slice(-boundedLimit(limit))
      .map(clone);
  }

  function observe(event, { world = null } = {}) {
    if (isSuppressedObservation(event)) return { ignored: true, reason: 'ineligible_observation', candidate: null, duplicate: false };
    const snapshot = world ?? worldSnapshot();
    if (!snapshot || snapshot.world_id !== worldId) return { ignored: true, reason: 'world_not_found', candidate: null, duplicate: false };
    const candidateId = createCandidateId(event);
    const existing = candidates.get(candidateId);
    if (existing) return { ignored: false, reason: null, candidate: clone(expire(existing)), duplicate: true };
    const actions = deriveActions(event, candidateId);
    if (!actions.length) return { ignored: true, reason: 'no_legal_world_action', candidate: null, duplicate: false };
    let preview;
    try {
      preview = candidatePreview(snapshot, actions);
    } catch (error) {
      return { ignored: true, reason: error?.code ?? 'world_action_rejected', candidate: null, duplicate: false };
    }
    const timestamp = now().toISOString();
    const candidate = {
      schema: 'deskbot.world-candidate.v0.1',
      candidate_id: candidateId,
      world_id: worldId,
      character_id: event.character_id ?? snapshot.protagonist?.character_id ?? null,
      source_event_ids: sourceEventIds(event),
      evidence_ids: Array.isArray(event.provenance?.evidence_ids)
        ? [...new Set(event.provenance.evidence_ids.filter(value => typeof value === 'string'))]
        : [`evidence-${event.event_id}`],
      provenance: {
        trust_boundary: event.source === 'untrusted_observation' ? 'untrusted_public_observation' : 'server_adapter',
        source: event.source ?? null,
        source_kind: event.source_kind ?? null,
        layer: event.layer ?? null,
        provider: event.provider ?? null,
        observation_type: event.type,
        ...(event.provenance && typeof event.provenance === 'object' ? clone(event.provenance) : {}),
      },
      source_observation: sourceObservation(event),
      proposed_actions: clone(actions),
      action_fingerprint: fingerprint(actions),
      preview,
      expected_world_revision: snapshot.world_revision,
      created_at: timestamp,
      updated_at: timestamp,
      expires_at: new Date(now().getTime() + ttlMs).toISOString(),
      status: CANDIDATE_STATUSES.PENDING,
      rule_version: RULE_VERSION,
    };
    return { ignored: false, reason: null, candidate: saveCandidate(candidate), duplicate: false };
  }

  function preview(candidateId) {
    const candidate = get(candidateId);
    if (!candidate) throw new WorldCandidateError(404, 'world_candidate_not_found', 'world candidate not found');
    if (candidate.status === CANDIDATE_STATUSES.EXPIRED) throw new WorldCandidateError(409, 'world_candidate_expired', 'world candidate has expired');
    if (candidate.status !== CANDIDATE_STATUSES.PENDING) throw new WorldCandidateError(409, 'world_candidate_not_pending', `world candidate is ${candidate.status}`);
    const snapshot = worldSnapshot();
    let actions;
    try {
      actions = deriveActions(candidate.source_observation, candidate.candidate_id);
      if (!actions.length || fingerprint(actions) !== candidate.action_fingerprint) {
        throw new WorldCandidateError(409, 'world_candidate_invalidated', 'world candidate action is no longer valid');
      }
      if (actions.some((_, index) => findMutation(`${candidate.candidate_id}:mutation:${index + 1}`, candidate))) {
        throw new WorldCandidateError(409, 'world_candidate_recovery_required', 'a partially committed candidate must finish acceptance recovery');
      }
      const projected = candidatePreview(snapshot, actions);
      const updated = saveCandidate({
        ...candidate,
        preview: projected,
        expected_world_revision: snapshot.world_revision,
        updated_at: now().toISOString(),
      });
      return { candidate: updated, preview: projected, world_revision: snapshot.world_revision };
    } catch (error) {
      if (error instanceof WorldCandidateError) throw error;
      throw new WorldCandidateError(409, 'world_candidate_preview_rejected', error.message);
    }
  }

  function mutationEvent(candidate, candidateId, payload, index) {
    const sourceObservation = candidate.source_observation;
    const occurredAt = sourceObservation.occurred_at ?? sourceObservation.observed_at ?? candidate.created_at;
    return {
      schema: 'foundry.event.v0.1',
      event_id: `${candidateId}:mutation:${index + 1}`,
      type: 'world.mutation',
      source: 'world-candidate-bridge',
      source_kind: 'world_engine',
      layer: 'world_line',
      character_id: candidate.character_id,
      device_id: null,
      shell_id: null,
      role_revision: null,
      correlation_id: candidateId,
      occurred_at: occurredAt,
      observed_at: sourceObservation.observed_at ?? occurredAt,
      confidence: null,
      provider: null,
      provenance: {
        candidate_id: candidateId,
        source_event_ids: [...candidate.source_event_ids],
        evidence_ids: [...candidate.evidence_ids],
        candidate_rule_version: RULE_VERSION,
        ...(candidate.provenance ?? {}),
      },
      payload: clone(payload),
    };
  }

  function findMutation(eventId, candidate) {
    if (typeof listMutations !== 'function') return null;
    const records = listMutations({ worldId: candidate.world_id, eventId, limit: 1 });
    return Array.isArray(records) ? records.find(record => record.event_id === eventId) ?? null : null;
  }

  function asIngestResult(mutation, world, { recovered = false } = {}) {
    return {
      applied: mutation.applied !== false,
      duplicate: false,
      reason: recovered ? 'recovered_from_mutation_ledger' : null,
      mutation: clone(mutation),
      world: clone(world),
    };
  }

  function recordAcceptDecision(candidate, id, worldMutations, world) {
    const result = {
      schema: 'deskbot.world-candidate-accept-result.v0.1',
      accepted: true,
      duplicate: false,
      candidate_id: id,
      world_mutations: clone(worldMutations),
      world: clone(world),
    };
    const timestamp = now().toISOString();
    const decisionRecord = {
      schema: 'deskbot.world-candidate-decision.v0.1',
      decision_id: `${id}:accept`,
      candidate_id: id,
      action: 'accept',
      result,
      decided_at: timestamp,
      rule_version: RULE_VERSION,
    };
    const candidateRecord = {
      ...candidate,
      status: CANDIDATE_STATUSES.ACCEPTED,
      accepted_at: candidate.accepted_at ?? timestamp,
      updated_at: timestamp,
      decision_id: decisionRecord.decision_id,
    };
    const persist = () => {
      persistence?.put?.(DECISION_NAMESPACE, decisionRecord.decision_id, decisionRecord);
      persistence?.put?.(CANDIDATE_NAMESPACE, candidateRecord.candidate_id, candidateRecord);
    };
    if (typeof persistence?.transaction === 'function') persistence.transaction(persist);
    else persist();
    decisions.set(decisionRecord.decision_id, clone(decisionRecord));
    candidates.set(candidateRecord.candidate_id, clone(candidateRecord));
    const decision = clone(decisionRecord);
    return { ...result, decision };
  }

  function accept(candidateId, { expectedWorldRevision = undefined } = {}) {
    const id = text(candidateId, 'candidate_id');
    const prior = decisions.get(`${id}:accept`);
    if (prior) {
      reconcileAcceptedDecision(prior);
      return { ...clone(prior.result), duplicate: true, decision: clone(prior) };
    }

    const storedCandidate = candidates.get(id);
    if (!storedCandidate) throw new WorldCandidateError(404, 'world_candidate_not_found', 'world candidate not found');
    const candidate = clone(storedCandidate);
    const actions = deriveActions(candidate.source_observation, candidate.candidate_id);
    if (!actions.length || fingerprint(actions) !== candidate.action_fingerprint) {
      throw new WorldCandidateError(409, 'world_candidate_invalidated', 'world candidate action is no longer valid');
    }
    const events = actions.map((payload, index) => mutationEvent(candidate, id, payload, index));
    const committed = events.map(event => findMutation(event.event_id, candidate));
    const committedIndexes = committed.flatMap((mutation, index) => mutation ? [index] : []);
    const committedCount = committedIndexes.length;
    const isPrefix = committedIndexes.every((index, offset) => index === offset);
    if (!isPrefix) {
      throw new WorldCandidateError(409, 'world_candidate_recovery_conflict', 'world candidate mutations are not a recoverable prefix');
    }
    for (let index = 0; index < committedCount; index += 1) {
      const mutation = committed[index];
      if (mutation.event_fingerprint !== fingerprint(events[index])) {
        throw new WorldCandidateError(409, 'world_candidate_recovery_conflict', 'a deterministic mutation event id was committed with different content');
      }
      if (mutation.before_revision !== candidate.expected_world_revision + index
        || mutation.after_revision !== candidate.expected_world_revision + index + 1
        || mutation.applied === false) {
        throw new WorldCandidateError(409, 'world_candidate_recovery_conflict', 'world candidate mutation history does not match the expected revision sequence');
      }
    }

    const snapshot = worldSnapshot();
    if (!snapshot || snapshot.world_id !== candidate.world_id) throw new WorldCandidateError(409, 'world_not_found', 'canonical world is unavailable');
    if (committedCount === actions.length) {
      const recoveredResults = committed.map(mutation => asIngestResult(mutation, snapshot, { recovered: true }));
      return recordAcceptDecision(candidate, id, recoveredResults, snapshot);
    }
    try {
      assertFreshActions(snapshot, actions.slice(committedCount));
    } catch (error) {
      if (error instanceof WorldCandidateError) throw error;
      throw new WorldCandidateError(409, 'world_candidate_preview_rejected', error.message);
    }

    if (committedCount === 0) {
      const current = expire(candidate);
      if (current.status === CANDIDATE_STATUSES.EXPIRED) throw new WorldCandidateError(409, 'world_candidate_expired', 'world candidate has expired');
      if (current.status !== CANDIDATE_STATUSES.PENDING) throw new WorldCandidateError(409, 'world_candidate_not_pending', `world candidate is ${current.status}`);
    } else if (candidate.status === CANDIDATE_STATUSES.DISMISSED) {
      throw new WorldCandidateError(409, 'world_candidate_recovery_conflict', 'a partially committed candidate cannot be dismissed');
    }
    const expectedRevisionAfterPartial = candidate.expected_world_revision + committedCount;
    if (snapshot.world_revision !== expectedRevisionAfterPartial
      || (expectedWorldRevision !== undefined
        && expectedWorldRevision !== candidate.expected_world_revision
        && expectedWorldRevision !== snapshot.world_revision)) {
      throw new WorldCandidateError(409, 'world_revision_changed', 'world changed after candidate preview; re-preview before accepting');
    }

    try {
      // This validates all actions before the first write. The projection is
      // intentionally discarded; only persistentWorld.ingest may commit facts.
      previewWorldMutations(snapshot, actions.slice(committedCount));
    } catch (error) {
      throw new WorldCandidateError(409, 'world_candidate_preview_rejected', error.message);
    }

    const worldMutations = [];
    let currentWorld = snapshot;
    for (let index = 0; index < actions.length; index += 1) {
      if (committed[index]) {
        worldMutations.push(asIngestResult(committed[index], currentWorld, { recovered: true }));
        continue;
      }
      const result = ingest(events[index]);
      // The app-level ingest adapter returns the full pipeline envelope while
      // direct store users may return the canonical mutation result. Keep the
      // candidate decision contract stable by recording only the world result.
      const mutationResult = result?.worldMutation ?? result;
      if (!mutationResult?.mutation) {
        throw new WorldCandidateError(409, 'world_candidate_mutation_not_committed', 'world mutation was not committed');
      }
      worldMutations.push(clone(mutationResult));
      currentWorld = mutationResult?.world ?? currentWorld;
    }
    return recordAcceptDecision(candidate, id, worldMutations, currentWorld);
  }

  function dismiss(candidateId, { reason = null } = {}) {
    const id = text(candidateId, 'candidate_id');
    const prior = decisions.get(`${id}:dismiss`);
    if (prior) return { candidate: clone(prior.candidate), decision: clone(prior), duplicate: true };
    const candidate = get(id);
    if (!candidate) throw new WorldCandidateError(404, 'world_candidate_not_found', 'world candidate not found');
    if (candidate.status === CANDIDATE_STATUSES.ACCEPTED) throw new WorldCandidateError(409, 'world_candidate_not_dismissable', 'accepted world candidate cannot be dismissed');
    const actions = deriveActions(candidate.source_observation, candidate.candidate_id);
    if (actions.some((_, index) => findMutation(`${id}:mutation:${index + 1}`, candidate))) {
      throw new WorldCandidateError(409, 'world_candidate_recovery_required', 'a partially committed candidate must finish acceptance recovery');
    }
    if (candidate.status === CANDIDATE_STATUSES.ACCEPTED) throw new WorldCandidateError(409, 'world_candidate_not_dismissable', 'accepted world candidate cannot be dismissed');
    const timestamp = now().toISOString();
    const next = saveCandidate({ ...candidate, status: CANDIDATE_STATUSES.DISMISSED, dismiss_reason: optionalText(reason, 'reason'), dismissed_at: timestamp, updated_at: timestamp });
    const decision = saveDecision({ schema: 'deskbot.world-candidate-decision.v0.1', decision_id: `${id}:dismiss`, candidate_id: id, action: 'dismiss', reason: optionalText(reason, 'reason'), decided_at: timestamp, candidate: next, rule_version: RULE_VERSION });
    return { candidate: next, decision, duplicate: false };
  }

  return {
    accept,
    constants: { candidateNamespace: CANDIDATE_NAMESPACE, decisionNamespace: DECISION_NAMESPACE, ruleVersion: RULE_VERSION },
    dismiss,
    get,
    list,
    observe,
    preview,
  };
}

export const createWorldCandidates = createWorldCandidateStore;
export {
  CANDIDATE_NAMESPACE,
  CANDIDATE_STATUSES,
  DECISION_NAMESPACE,
  DEFAULT_TTL_MS,
  MAX_CANDIDATES,
  OBSERVATION_TYPES,
  RULE_VERSION,
  SAFE_ACTIONS,
};
