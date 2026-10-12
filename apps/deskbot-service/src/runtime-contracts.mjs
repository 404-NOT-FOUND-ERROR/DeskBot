import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';

/**
 * Code-layer contracts adapted from Asamana's cognition stage / StepTrace split.
 * Traces are observations, never inputs to policy, prompts or mutation authority.
 * Existing domain state machines and persistentWorld.ingest remain authoritative.
 */
export const RUNTIME_TRACE_SCHEMA = 'deskbot.runtime-trace.v1';
export const REPLAY_METADATA_SCHEMA = 'deskbot.runtime-replay-metadata.v1';
export const RUNTIME_CONTRACT_VERSION = 'deskbot.runtime-contracts.v1';
export const RUNTIME_STAGE_ORDER = Object.freeze([
  'clock', 'input', 'pressure', 'perception', 'interrupt', 'motivation',
  'decision', 'action', 'feedback', 'memory', 'compress', 'reflection',
  'relation_evolution', 'long_term_goals', 'event', 'snapshot', 'broadcast',
]);
const STAGES = new Set(RUNTIME_STAGE_ORDER);
const TERMINAL_STATUSES = new Set(['completed', 'skipped', 'error']);

/** @typedef {{code: string, message: string, retryable: boolean}} RuntimeError */
/** @typedef {{event_ids?: string[], evidence_ids?: string[], decision_ids?: string[], mutation_ids?: string[]}} RuntimeReferences */
/** @typedef {{schema: string, run_id: string, pipeline: string, rule_version: string, status: string, stages: object[], input_event_ids: string[]}} RuntimeTrace */

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value.trim();
}

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (value === null || value === undefined || !Number.isFinite(date.getTime())) throw new TypeError(`${field} must be a valid date`);
  return date.toISOString();
}

function revision(value, field) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer or null`);
  return value;
}

function ids(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new TypeError(`${field} must be an array of non-empty strings`);
  return [...new Set(value.map(item => item.trim()))].sort();
}

function jsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsonValue).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${jsonValue(value[key])}`).join(',')}}`;
  }
  throw new TypeError('runtime fingerprint input must contain only JSON values');
}

export function stableRuntimeFingerprint(value) {
  return createHash('sha256').update(jsonValue(value)).digest('hex');
}

export function createReplayMetadata({
  pipeline, ruleVersion, inputEventIds = [], outputEventIds = [], evidenceIds = [], inputs = null,
  worldRevisionBefore = null, worldRevisionAfter = null, sourceFingerprint = null,
} = {}) {
  const inputIds = ids(inputEventIds, 'input_event_ids');
  const evidence = ids(evidenceIds, 'evidence_ids');
  return {
    schema: REPLAY_METADATA_SCHEMA,
    pipeline: requiredText(pipeline, 'pipeline'),
    rule_version: requiredText(ruleVersion, 'rule_version'),
    authority: 'audit_only',
    input_event_ids: inputIds,
    output_event_ids: ids(outputEventIds, 'output_event_ids'),
    evidence_ids: evidence,
    // The digest identifies captured inputs, not proof that an LLM will repeat
    // its output. Missing captured content is stated rather than concealed.
    input_fingerprint: stableRuntimeFingerprint({ event_ids: inputIds, evidence_ids: evidence, inputs }),
    input_capture: inputs === null ? 'references_only' : 'captured_content',
    source_fingerprint: sourceFingerprint === null ? null : requiredText(sourceFingerprint, 'source_fingerprint'),
    world_revision_before: revision(worldRevisionBefore, 'world_revision_before'),
    world_revision_after: revision(worldRevisionAfter, 'world_revision_after'),
    replay_policy: 'existing_domain_idempotency',
  };
}

// Consumers use this when adding audit metadata to successful domain writes.
// A malformed optional annotation cannot convert an accepted input/action
// into a reported failure or create a second mutation on the caller's retry.
export function safeReplayMetadata(options) {
  try { return createReplayMetadata(options); }
  catch (error) {
    return { schema: REPLAY_METADATA_SCHEMA, authority: 'audit_only',
      input_capture: 'unavailable', audit_error: errorDetail(error) };
  }
}

function references(value = {}) {
  const result = {};
  for (const key of ['event_ids', 'evidence_ids', 'decision_ids', 'mutation_ids']) {
    if (value[key] !== undefined) result[key] = ids(value[key], key);
  }
  return result;
}

function errorDetail(error) {
  return {
    code: typeof error?.code === 'string' && error.code.trim() ? error.code : 'runtime_stage_failed',
    message: typeof error?.message === 'string' ? error.message : 'runtime stage failed',
    retryable: error?.retryable !== false,
  };
}

export function validateRuntimeTrace(trace) {
  if (trace?.schema !== RUNTIME_TRACE_SCHEMA || trace.authority !== 'audit_only') throw new TypeError('unsupported runtime trace contract');
  for (const field of ['trace_id', 'run_id', 'pipeline', 'rule_version']) requiredText(trace[field], field);
  const started = Date.parse(iso(trace.started_at, 'started_at'));
  ids(trace.input_event_ids, 'input_event_ids');
  if (!['running', ...TERMINAL_STATUSES].includes(trace.status)) throw new TypeError('invalid runtime trace status');
  if (!Array.isArray(trace.stages)) throw new TypeError('runtime trace stages must be an array');
  for (const [index, stage] of trace.stages.entries()) {
    if (!STAGES.has(stage.stage) || stage.sequence !== index + 1) throw new TypeError('invalid runtime stage or sequence');
    if (!['running', ...TERMINAL_STATUSES].includes(stage.status)) throw new TypeError('invalid runtime stage status');
    const stageStarted = Date.parse(iso(stage.started_at, 'stage.started_at'));
    if (stageStarted < started) throw new TypeError('runtime stage precedes its run');
    references(stage.references);
    if (stage.status !== 'running') {
      if (Date.parse(iso(stage.completed_at, 'stage.completed_at')) < stageStarted) throw new TypeError('runtime stage completion precedes its start');
      if (!Number.isFinite(stage.duration_ms) || stage.duration_ms < 0) throw new TypeError('invalid runtime stage duration');
    }
  }
  if (trace.status !== 'running') {
    const completed = Date.parse(iso(trace.completed_at, 'completed_at'));
    if (completed < started || trace.stages.some(stage => stage.status === 'running' || Date.parse(stage.completed_at) > completed)) throw new TypeError('runtime trace has unfinished stages');
    if (!Number.isFinite(trace.duration_ms) || trace.duration_ms < 0) throw new TypeError('invalid runtime trace duration');
  }
  return trace;
}

/**
 * observe() preserves synchronous/async return values and thrown errors.
 * It records actual seams only; absent stages are not fabricated. The return
 * value must not be read from trace data or retried by this recorder.
 */
export function createRuntimeTraceRecorder({
  runId, pipeline, ruleVersion, actorId = null, worldId = null, inputEventIds = [],
  startedAt = null, now = () => new Date(), monotonic = () => performance.now(),
} = {}) {
  const auditErrors = [];
  const safeTick = () => { try { const value = monotonic(); if (Number.isFinite(value)) return value; throw new Error('invalid monotonic clock'); }
    catch (error) { auditErrors.push(errorDetail(error)); return 0; } };
  const safeAt = fallback => { try { return iso(now(), 'timestamp'); }
    catch (error) { auditErrors.push(errorDetail(error)); return fallback; } };
  const clockStart = safeTick();
  let initialAt;
  try { initialAt = iso(startedAt ?? now(), 'started_at'); }
  catch (error) { auditErrors.push(errorDetail(error)); initialAt = new Date().toISOString(); }
  const trace = {
    schema: RUNTIME_TRACE_SCHEMA, contract_version: RUNTIME_CONTRACT_VERSION,
    trace_id: `runtime:${requiredText(runId, 'run_id')}`, run_id: runId,
    pipeline: requiredText(pipeline, 'pipeline'), rule_version: requiredText(ruleVersion, 'rule_version'),
    authority: 'audit_only', actor_id: actorId, world_id: worldId,
    input_event_ids: ids(inputEventIds, 'input_event_ids'),
    started_at: initialAt, completed_at: null,
    duration_ms: null, status: 'running', stages: [], error: null,
  };

  function observe(stage, operation, { references: refs = {} } = {}) {
    if (trace.status !== 'running') throw new TypeError('runtime trace is already complete');
    if (!STAGES.has(stage) || typeof operation !== 'function') throw new TypeError('observe requires a known stage and an operation');
    const tick = safeTick();
    let record = null;
    // Audit setup is deliberately best-effort. A broken clock, malformed
    // annotation, or persistence-only trace problem must never suppress the
    // domain operation being observed.
    try {
      record = { stage, sequence: trace.stages.length + 1, status: 'running',
        started_at: safeAt(trace.started_at), completed_at: null, duration_ms: null,
        references: references(refs), error: null };
      trace.stages.push(record);
    } catch { record = null; }
    function end(error = null) {
      if (!record) return;
      try {
        record.completed_at = safeAt(record.started_at);
        record.duration_ms = Math.max(0, safeTick() - tick);
        record.status = error ? 'error' : 'completed';
        record.error = error ? errorDetail(error) : null;
      } catch (auditError) {
        record.status = error ? 'error' : 'completed';
        record.duration_ms = null;
        record.error = error ? errorDetail(error) : errorDetail(auditError);
      }
    }
    try {
      const value = operation();
      if (value && typeof value.then === 'function') {
        return Promise.resolve(value).then(result => { end(); return result; }, error => { end(error); throw error; });
      }
      end();
      return value;
    } catch (error) { end(error); throw error; }
  }

  function finish({ status = null, error = null, resultEventIds = [] } = {}) {
    if (trace.status !== 'running') return structuredClone(trace);
    if (trace.stages.some(stage => stage.status === 'running')) throw new TypeError('cannot finish an in-flight runtime stage');
    const terminal = status ?? (trace.stages.some(stage => stage.status === 'error') ? 'error' : 'completed');
    if (!TERMINAL_STATUSES.has(terminal)) throw new TypeError('invalid terminal runtime status');
    trace.status = terminal;
    trace.completed_at = safeAt(trace.stages.at(-1)?.completed_at ?? trace.started_at);
    trace.duration_ms = Math.max(0, safeTick() - clockStart);
    try { trace.result_event_ids = ids(resultEventIds, 'result_event_ids'); }
    catch (error) { auditErrors.push(errorDetail(error)); trace.result_event_ids = []; }
    trace.error = error ? errorDetail(error) : trace.stages.find(stage => stage.error)?.error ?? null;
    try { validateRuntimeTrace(trace); } catch (auditError) {
      // Validation is an observability check. Keep the completed trace
      // available with a diagnostic instead of failing the world operation.
      trace.audit_error = errorDetail(auditError);
    }
    if (auditErrors.length) trace.audit_errors = [...auditErrors];
    return structuredClone(trace);
  }

  return { observe, finish, snapshot: () => structuredClone(trace) };
}

export function runtimeContractCatalog() {
  return {
    schema: RUNTIME_CONTRACT_VERSION, stage_order: [...RUNTIME_STAGE_ORDER],
    trace_schema: RUNTIME_TRACE_SCHEMA, replay_metadata_schema: REPLAY_METADATA_SCHEMA,
    trace_authority: 'audit_only', world_write_authority: 'persistentWorld.ingest',
    domain_contracts: {
      input: 'foundry.event.v0.1', evidence: 'deskbot.role-evidence.v0.3',
      action_feedback: 'deskbot.action-feedback.v1',
      proposal: ['deskbot.role-direction-proposal.v0.1', 'deskbot.role-direction-proposal.v0.2'],
      trial: ['deskbot.role-direction-proposal.v0.1', 'deskbot.practical-role-trial.v1'],
      world_candidate: 'deskbot.world-candidate.v0.1',
    },
    compatibility: 'additive_metadata_existing_domain_state_machines',
  };
}
