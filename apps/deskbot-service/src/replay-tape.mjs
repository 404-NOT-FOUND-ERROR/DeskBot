import { createHash } from 'node:crypto';

import { normalizeEvent } from './input-store.mjs';

/**
 * A small, versioned input tape for deterministic DeskBot acceptance tests.
 *
 * The tape is deliberately an input fixture, not another world writer.  A
 * runner only calls the runtime's existing ingress function (normally
 * `server.ingestNonChatEvent`) and records the resulting read model.  This is
 * useful for proving restart/idempotency without pretending that a model's
 * prose or a provider's wall clock is deterministic.
 */
export const REPLAY_TAPE_SCHEMA = 'deskbot.replay-tape.v1';
export const REPLAY_CHECKPOINT_SCHEMA = 'deskbot.replay-checkpoint.v1';
export const REPLAY_RULE_VERSION = 'deskbot.replay-tape-rules.v1';

const DEFAULT_VOLATILE_KEYS = new Set([
  'duration_ms',
  'trace',
  'audit_errors',
  'audit_error',
]);
const READ_ONLY_REPLAY_TYPES = Object.freeze([
  'conversation.reply',
  'device.action.completed',
  'device.hello',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReplayContractError(400, 'invalid_replay_contract', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReplayContractError(400, 'invalid_replay_contract', `${field} must be an object`);
  }
  return value;
}

/** Stable JSON for hashes and equality assertions. Object insertion order is
 * intentionally ignored; array order remains semantic unless the caller
 * normalizes that array before hashing. */
export function stableReplayStringify(value, { volatileKeys = DEFAULT_VOLATILE_KEYS } = {}) {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? 'null' : stableReplayStringify(item, { volatileKeys })).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter(key => !volatileKeys.has(key) && value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableReplayStringify(value[key], { volatileKeys })}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalDigest(value, options = {}) {
  return createHash('sha256')
    .update(stableReplayStringify(value, options))
    .digest('hex');
}

function eventFingerprint(event) {
  return canonicalDigest(event, { volatileKeys: new Set() });
}

function validateRuleVersions(value) {
  const rules = plainObject(value ?? {}, 'rule_versions');
  return Object.fromEntries(Object.keys(rules).sort().map(key => [text(key, 'rule_versions key'), text(rules[key], `rule_versions.${key}`)]));
}

function normalizeAdapter(adapter) {
  if (adapter === undefined || adapter === null) return {};
  plainObject(adapter, 'adapter');
  const allowed = new Set(['attestedKind', 'sourceLabel', 'rolePracticalInternal', 'roleStageInternal', 'maintenanceInternal']);
  if (Object.keys(adapter).some(key => !allowed.has(key))) throw new ReplayContractError(400, 'invalid_replay_adapter', 'unsupported replay adapter field');
  if (adapter.attestedKind !== undefined && !['user', 'provider'].includes(adapter.attestedKind)) throw new ReplayContractError(400, 'invalid_replay_adapter', 'replay adapter kind must be user or provider');
  for (const key of ['rolePracticalInternal', 'roleStageInternal', 'maintenanceInternal']) {
    if (adapter[key] !== undefined && adapter[key] !== true) throw new ReplayContractError(400, 'invalid_replay_adapter', `${key} must be true when present`);
  }
  if (adapter.sourceLabel !== undefined) text(adapter.sourceLabel, 'adapter.sourceLabel');
  return clone(adapter);
}

function normalizeClock(value, field, fallback) {
  const candidate = value ?? fallback;
  if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) {
    throw new ReplayContractError(400, 'invalid_replay_contract', `${field} must be a valid ISO date-time string`);
  }
  return new Date(candidate).toISOString();
}

function normalizePostActions(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ReplayContractError(400, 'invalid_replay_contract', 'post_actions must be an array');
  return value.map((action) => {
    plainObject(action, 'post_action');
    if (action.kind !== 'accept_world_candidate') {
      throw new ReplayContractError(400, 'invalid_replay_contract', 'unsupported replay post_action');
    }
    const sourceEventId = text(action.source_event_id, 'post_action.source_event_id');
    return { kind: action.kind, source_event_id: sourceEventId };
  });
}

function normalizeReplayEvent(event, { now = null } = {}) {
  plainObject(event, 'event');
  // A replay tape must never silently invent identity or time.  The ordinary
  // ingress normalizer may generate an event_id for production callers, but
  // doing that here would make a tape impossible to reproduce.
  text(event.event_id, 'event.event_id');
  text(event.type, 'event.type');
  text(event.source, 'event.source');
  if (typeof event.occurred_at !== 'string' || Number.isNaN(Date.parse(event.occurred_at))) {
    throw new ReplayContractError(400, 'invalid_replay_contract', 'event.occurred_at must be a valid ISO date-time string');
  }
  const eventNow = now ?? (() => new Date(event.occurred_at));
  return normalizeEvent(clone(event), { now: eventNow });
}

function validateTape(tape) {
  plainObject(tape, 'tape');
  if (tape.schema !== REPLAY_TAPE_SCHEMA) throw new ReplayContractError(409, 'replay_schema_mismatch', 'unsupported replay tape schema');
  text(tape.tape_id, 'tape_id');
  text(tape.rule_version, 'rule_version');
  if (tape.rule_version !== REPLAY_RULE_VERSION) throw new ReplayContractError(409, 'replay_rule_version_mismatch', 'unsupported replay tape rule version');
  validateRuleVersions(tape.rule_versions);
  text(tape.seed_hash, 'seed_hash');
  if (tape.seed_hash !== canonicalDigest(tape.seed, { volatileKeys: new Set() })) {
    throw new ReplayContractError(409, 'replay_seed_mismatch', 'tape seed_hash does not match seed content');
  }
  if (!Array.isArray(tape.events)) throw new ReplayContractError(400, 'invalid_replay_contract', 'tape.events must be an array');
  const seen = new Set();
  for (const item of tape.events) {
    plainObject(item, 'tape event');
    text(item.event_id, 'tape event.event_id');
    if (item.event_id !== item.event?.event_id) throw new ReplayContractError(409, 'replay_event_conflict', `tape event identity mismatch for ${item.event_id}`);
    if (item.index !== seen.size) throw new ReplayContractError(409, 'replay_event_conflict', `tape event index mismatch for ${item.event_id}`);
    if (seen.has(item.event_id)) throw new ReplayContractError(409, 'replay_event_conflict', `duplicate tape event ${item.event_id}`);
    seen.add(item.event_id);
    if (item.fingerprint !== eventFingerprint(item.event)) throw new ReplayContractError(409, 'replay_event_conflict', `event fingerprint mismatch for ${item.event_id}`);
    normalizeReplayEvent(item.event);
    if (READ_ONLY_REPLAY_TYPES.includes(item.event.type) || item.event.type.startsWith('voice.')
      || item.event.type.startsWith('transport.') || item.event.type.startsWith('service.')
      || item.event.payload?.role === 'assistant') throw new ReplayContractError(400, 'replay_read_only_event', `${item.event.type} cannot be a canonical replay input`);
    normalizeAdapter(item.adapter);
    normalizeClock(item.logical_at, 'tape event.logical_at');
    normalizeClock(item.received_at, 'tape event.received_at');
    normalizePostActions(item.post_actions);
    if (item.adapter?.roleStageInternal === true && (item.event.source !== 'role-stage-engine' || !['accept_role_stage', 'rollback_role_stage'].includes(item.event.payload?.action))) {
      throw new ReplayContractError(400, 'invalid_replay_adapter', 'roleStageInternal only belongs to canonical role stage engine events');
    }
    if (item.adapter?.rolePracticalInternal === true && (item.event.source !== 'role-practical-trial-engine' || !['start_role_practical_trial', 'control_role_practical_trial'].includes(item.event.payload?.action))) {
      throw new ReplayContractError(400, 'invalid_replay_adapter', 'rolePracticalInternal only belongs to canonical trial engine events');
    }
    if (item.adapter?.maintenanceInternal === true && (item.event.type !== 'world.mutation'
      || item.event.source !== 'slow-cognition-engine'
      || !['install_slow_cognition', 'prepare_slow_cognition', 'claim_slow_cognition', 'resolve_slow_cognition'].includes(item.event.payload?.action))) {
      throw new ReplayContractError(400, 'invalid_replay_adapter', 'maintenanceInternal only belongs to canonical slow cognition engine events');
    }
  }
  return tape;
}

export class ReplayContractError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ReplayContractError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createReplayTape({
  tapeId,
  seed = {},
  ruleVersions = {},
  clock = { time_zone: 'Asia/Shanghai', mode: 'simulation' },
  events = [],
} = {}) {
  const id = text(tapeId, 'tape_id');
  const normalizedRules = validateRuleVersions(ruleVersions);
  const tape = {
    schema: REPLAY_TAPE_SCHEMA,
    rule_version: REPLAY_RULE_VERSION,
    tape_id: id,
    seed: clone(plainObject(seed, 'seed')),
    seed_hash: canonicalDigest(seed, { volatileKeys: new Set() }),
    rule_versions: normalizedRules,
    clock: clone(plainObject(clock, 'clock')),
    events: [],
  };
  for (const item of events) {
    const event = item?.event ?? item;
    tape.events.push(appendReplayEvent(tape, event, {
      adapter: item?.adapter ?? {}, logicalAt: item?.logical_at, receivedAt: item?.received_at,
      postActions: item?.post_actions,
    }).events.at(-1));
  }
  return validateTape(tape);
}

/** Return a cloned tape with one normalized, complete event appended. */
export function appendReplayEvent(tape, event, { adapter = {}, now = null, logicalAt = null, receivedAt = null, postActions = [] } = {}) {
  validateTape(tape);
  const normalized = normalizeReplayEvent(event, { now });
  if (READ_ONLY_REPLAY_TYPES.includes(normalized.type)
    || normalized.type.startsWith('voice.')
    || normalized.type.startsWith('transport.')
    || normalized.type.startsWith('service.')
    || normalized.payload?.role === 'assistant') {
    throw new ReplayContractError(400, 'replay_read_only_event', `${normalized.type} cannot be a canonical replay input`);
  }
  const existing = tape.events.find(item => item.event_id === normalized.event_id);
  const entry = {
    index: tape.events.length,
    event_id: normalized.event_id,
    event: normalized,
    adapter: normalizeAdapter(adapter),
    logical_at: normalizeClock(logicalAt, 'logical_at', normalized.occurred_at),
    received_at: normalizeClock(receivedAt, 'received_at', normalized.occurred_at),
    post_actions: normalizePostActions(postActions),
    fingerprint: eventFingerprint(normalized),
  };
  if (existing) {
    if (existing.fingerprint !== entry.fingerprint
      || stableReplayStringify(existing.adapter, { volatileKeys: new Set() }) !== stableReplayStringify(entry.adapter, { volatileKeys: new Set() })
      || existing.logical_at !== entry.logical_at || existing.received_at !== entry.received_at
      || stableReplayStringify(existing.post_actions, { volatileKeys: new Set() }) !== stableReplayStringify(entry.post_actions, { volatileKeys: new Set() })) {
      throw new ReplayContractError(409, 'replay_event_conflict', `event ${normalized.event_id} already has different tape content`);
    }
    return clone(tape);
  }
  const next = clone(tape);
  next.events.push(entry);
  next.events.forEach((item, index) => { item.index = index; });
  return validateTape(next);
}

function runtimeParts(runtime) {
  const server = runtime?.server ?? runtime;
  const ingest = runtime?.ingest ?? server?.ingestNonChatEvent;
  const persistence = runtime?.persistence ?? server?.persistence ?? null;
  const worldSnapshot = runtime?.worldSnapshot ?? (() => server?.persistentWorld?.get?.() ?? null);
  const listMutations = runtime?.listMutations ?? ((options = {}) => server?.persistentWorld?.listMutations?.(options) ?? []);
  if (typeof ingest !== 'function') throw new ReplayContractError(500, 'replay_runtime_invalid', 'runtime must expose the existing ingress function');
  if (typeof worldSnapshot !== 'function') throw new ReplayContractError(500, 'replay_runtime_invalid', 'runtime must expose worldSnapshot()');
  return { server, ingest: ingest.bind(server), persistence, worldSnapshot, listMutations };
}

function summarizeResult(value) {
  const envelope = value?.worldMutation ?? value;
  const mutation = envelope?.mutation;
  return {
    event_id: value?.event?.event_id ?? mutation?.event_id ?? null,
    duplicate: Boolean(value?.duplicate || envelope?.duplicate),
    reason: envelope?.reason ?? null,
    mutation_id: mutation?.mutation_id ?? null,
    sequence: mutation?.sequence ?? null,
    before_revision: mutation?.before_revision ?? null,
    after_revision: mutation?.after_revision ?? null,
    candidate_id: value?.worldCandidate?.candidate?.candidate_id ?? null,
  };
}

async function executePostAction(runtime, action) {
  if (action.kind !== 'accept_world_candidate') return;
  const store = runtime?.worldCandidates ?? runtime?.server?.worldCandidates;
  if (!store?.list || !store?.preview || !store?.accept) {
    throw new ReplayContractError(500, 'replay_runtime_invalid', 'runtime does not expose world candidate approval APIs');
  }
  const candidate = store.list({ limit: 200 }).find(item => item.source_event_ids?.includes(action.source_event_id));
  if (!candidate) throw new ReplayContractError(409, 'replay_post_action_missing', `no candidate for ${action.source_event_id}`);
  if (candidate.status === 'accepted') return store.accept(candidate.candidate_id);
  try { store.preview(candidate.candidate_id); }
  catch (error) {
    // A crash after canonical prefix commit is recovered by the existing
    // candidate accept implementation; replay does not bypass that recovery.
    if (error?.code !== 'world_candidate_recovery_required') throw error;
  }
  return store.accept(candidate.candidate_id, { expectedWorldRevision: runtime.worldSnapshot?.()?.world_revision ?? runtime.server?.persistentWorld?.get?.()?.world_revision });
}

function recordSnapshot(persistence, namespace) {
  if (!persistence?.list) return [];
  return persistence.list(namespace).map(clone);
}

function allMutations(listMutations, worldId) {
  if (typeof listMutations !== 'function') return [];
  const result = [];
  let afterSequence = 0;
  for (let guard = 0; guard < 10000; guard += 1) {
    const page = listMutations({ worldId, afterSequence, limit: 200 });
    if (!Array.isArray(page) || page.length === 0) break;
    result.push(...page.map(clone));
    const last = page.at(-1)?.sequence;
    if (!Number.isSafeInteger(last) || last <= afterSequence) break;
    afterSequence = last;
    if (page.length < 200) break;
  }
  return result;
}

export function captureReplayCheckpoint({ tape, runtime, checkpointId = null, namespaces = [] } = {}) {
  validateTape(tape);
  const { worldSnapshot, listMutations, persistence } = runtimeParts(runtime);
  const world = clone(worldSnapshot());
  const mutations = allMutations(listMutations, world?.world_id);
  const records = Object.fromEntries([...new Set(namespaces)].map(namespace => [namespace, recordSnapshot(persistence, namespace)]));
  const projection = { world, mutations, records };
  return {
    schema: REPLAY_CHECKPOINT_SCHEMA,
    rule_version: REPLAY_RULE_VERSION,
    checkpoint_id: checkpointId ?? `${tape.tape_id}:${tape.events.length}`,
    tape_id: tape.tape_id,
    seed_hash: tape.seed_hash,
    rule_versions: clone(tape.rule_versions),
    event_count: tape.events.length,
    last_event_id: tape.events.at(-1)?.event_id ?? null,
    world_revision: world?.world_revision ?? null,
    mutation_sequence: mutations.at(-1)?.sequence ?? 0,
    namespace_digests: Object.fromEntries(Object.keys(records).sort().map(namespace => [namespace, canonicalDigest(records[namespace])])),
    digest: canonicalDigest(projection),
    projection,
  };
}

function assertExpectedRules(tape, expectedRuleVersions) {
  if (expectedRuleVersions === undefined || expectedRuleVersions === null) return;
  const expected = validateRuleVersions(expectedRuleVersions);
  const actual = tape.rule_versions;
  if (stableReplayStringify(actual, { volatileKeys: new Set() }) !== stableReplayStringify(expected, { volatileKeys: new Set() })) {
    throw new ReplayContractError(409, 'replay_rule_version_mismatch', 'tape rule versions do not match this runtime');
  }
}

/**
 * Run a tape through an existing runtime. `runtimeFactory` is called by the
 * caller, allowing a test to reopen the same SQLite file between segments.
 * The function intentionally does not create a world or call persistentWorld
 * directly; only the supplied ingress is used.
 */
export async function replayTape({
  tape,
  runtime,
  runtimeFactory = null,
  mode = 'fresh',
  fromIndex = 0,
  toIndex = null,
  expectedRuleVersions = null,
  checkpointNamespaces = [],
  checkpoint = null,
  onEvent = null,
} = {}) {
  validateTape(tape);
  assertExpectedRules(tape, expectedRuleVersions);
  if (onEvent !== null && typeof onEvent !== 'function') throw new ReplayContractError(400, 'invalid_replay_hook', 'onEvent must be a function');
  if (!['fresh', 'restart', 'duplicate'].includes(mode)) throw new ReplayContractError(400, 'invalid_replay_mode', 'mode must be fresh, restart, or duplicate');
  if (!Number.isInteger(fromIndex) || fromIndex < 0) throw new ReplayContractError(400, 'invalid_replay_range', 'invalid replay starting index');
  const start = fromIndex;
  const end = toIndex === null ? tape.events.length : toIndex;
  if (!Number.isInteger(end) || end < start || end > tape.events.length) throw new ReplayContractError(400, 'invalid_replay_range', 'invalid replay event range');
  const ownedRuntime = runtime ?? (typeof runtimeFactory === 'function' ? await runtimeFactory({ tape, mode }) : null);
  if (!ownedRuntime) throw new ReplayContractError(400, 'replay_runtime_required', 'runtime or runtimeFactory is required');
  const { ingest } = runtimeParts(ownedRuntime);
  if (mode === 'fresh' && start !== 0) throw new ReplayContractError(400, 'invalid_replay_range', 'fresh replay must begin at event zero');
  if (mode === 'fresh' && tape.seed.world && canonicalDigest(runtimeParts(ownedRuntime).worldSnapshot()) !== canonicalDigest(tape.seed.world)) {
    throw new ReplayContractError(409, 'replay_seed_mismatch', 'fresh runtime does not match the captured seed world');
  }
  if (mode === 'restart') {
    if (checkpoint?.schema !== REPLAY_CHECKPOINT_SCHEMA || checkpoint.tape_id !== tape.tape_id
      || checkpoint.seed_hash !== tape.seed_hash || checkpoint.event_count !== start
      || checkpoint.digest !== canonicalDigest(checkpoint.projection)) {
      throw new ReplayContractError(409, 'replay_checkpoint_mismatch', 'restart checkpoint does not match the tape prefix');
    }
    const actual = captureReplayCheckpoint({ tape: { ...tape, events: tape.events.slice(0, start) }, runtime: ownedRuntime,
      namespaces: Object.keys(checkpoint.projection.records) });
    if (actual.digest !== checkpoint.digest) throw new ReplayContractError(409, 'replay_checkpoint_mismatch', 'reopened runtime does not match its durable checkpoint');
  }
  const results = [];
  for (const item of tape.events.slice(start, end)) {
    // The caller owns the isolated runtime and its clock. A replay never
    // changes a production clock; a fixture clock hook freezes receipt time.
    if (typeof ownedRuntime.setClock === 'function') ownedRuntime.setClock({ logical_at: item.logical_at, received_at: item.received_at });
    const result = await ingest(clone(item.event), clone(item.adapter));
    results.push(summarizeResult(result));
    for (const action of item.post_actions ?? []) await executePostAction(ownedRuntime, action);
    if (onEvent !== null) {
      if (typeof onEvent !== 'function') throw new ReplayContractError(400, 'invalid_replay_hook', 'onEvent must be a function');
      await onEvent({ item: clone(item), result, runtime: ownedRuntime, index: item.index });
    }
  }
  return {
    schema: 'deskbot.replay-run.v1',
    rule_version: REPLAY_RULE_VERSION,
    tape_id: tape.tape_id,
    mode,
    from_index: start,
    to_index: end,
    results,
    checkpoint: captureReplayCheckpoint({ tape: { ...tape, events: tape.events.slice(0, end) }, runtime: ownedRuntime, namespaces: checkpointNamespaces }),
    runtime: ownedRuntime,
  };
}

export function replaySnapshotDigest(checkpoint) {
  if (checkpoint?.schema !== REPLAY_CHECKPOINT_SCHEMA) throw new ReplayContractError(400, 'invalid_replay_checkpoint', 'invalid replay checkpoint');
  return checkpoint.digest;
}
