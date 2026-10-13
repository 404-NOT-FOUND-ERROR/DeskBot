import { safeReplayMetadata, createRuntimeTraceRecorder } from './runtime-contracts.mjs';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_BACKOFF_MS = Object.freeze([60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000]);
const RUN_NAMESPACE = 'input-runtime.runs';
const RUN_SCHEMA = 'foundry.input-runtime-run.v0.1';
const RULE_VERSION = 'input-runtime-rules.v0.1';
const MAX_RUNS = 500;

function iso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function errorDetail(error) {
  return {
    code: error?.code ?? 'input_source_refresh_failed',
    message: error?.message ?? '输入来源刷新失败',
    retryable: error?.retryable !== false,
  };
}

function requireSourceId(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('source_id must be a non-empty string');
  return value.trim();
}

function resultEventIds(result) {
  const ids = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) ids.add(value.trim());
  };
  add(result?.event_id);
  add(result?.event?.event_id);
  add(result?.source_event?.event_id);
  add(result?.input_event?.event_id);
  add(result?.result_event?.event_id);
  for (const event of Array.isArray(result?.events) ? result.events : []) add(event?.event_id ?? event);
  for (const eventId of Array.isArray(result?.result_event_ids) ? result.result_event_ids : []) add(eventId);
  return [...ids];
}

// Only this deterministic, connector-facing envelope is eligible for a
// private replay fixture.  Raw provider responses and credentials are never
// copied into the operation journal.  A source may opt into a richer,
// already-sanitized `replay_fixture` when its ingest callback needs it.
function replayFixture(result) {
  if (result === null || result === undefined) return null;
  if (result.replay_fixture && typeof result.replay_fixture === 'object') {
    return structuredClone(result.replay_fixture);
  }
  const fixture = {};
  for (const key of ['event', 'events', 'fetched_at', 'connector', 'result_event_ids']) {
    if (Object.hasOwn(result, key)) fixture[key] = structuredClone(result[key]);
  }
  return fixture;
}

function replayFixtureError(detail) {
  const error = new Error(detail?.message ?? 'input replay fixture failed');
  error.code = detail?.code ?? 'replay_input_fixture_error';
  error.retryable = detail?.retryable === true;
  return error;
}

function comparableRun(run) {
  const copy = structuredClone(run);
  if (copy?.trace) {
    delete copy.trace.duration_ms;
    for (const stage of copy.trace.stages ?? []) delete stage.duration_ms;
  }
  return copy;
}

function stableTrace(trace) {
  if (!trace) return trace;
  const copy = structuredClone(trace);
  copy.duration_ms = 0;
  for (const stage of copy.stages ?? []) stage.duration_ms = 0;
  return copy;
}

export function createInputRuntime({
  now = () => new Date(),
  persistence = null,
  intervalMs = DEFAULT_INTERVAL_MS,
  backoffMs = DEFAULT_BACKOFF_MS,
  // Optional service-operation journal seam.  The runtime deliberately keeps
  // this dependency structural so standalone tests and existing connectors do
  // not need to know about replay capture.  When supplied, every source run
  // (including its start/complete records and source state writes) executes
  // under one stable operation context.
  operationScope = null,
  // Trusted local replay only. When present, source.refresh is bypassed and
  // the registered source is resolved from an attested fixture.
  replayProviders = null,
} = {}) {
  const interval = Math.max(1000, Number.parseInt(intervalMs, 10) || DEFAULT_INTERVAL_MS);
  const sources = new Map();
  const restored = new Map((persistence?.list?.('input-runtime.sources') ?? [])
    .filter((record) => record && typeof record.source_id === 'string')
    .map((record) => [record.source_id, record]));
  const runs = new Map((persistence?.list?.(RUN_NAMESPACE) ?? [])
    .filter((record) => record && typeof record.run_id === 'string')
    .map((record) => [record.run_id, record]));
  let timer = null;
  let running = false;
  let ticking = null;
  let runSequence = runs.size;

  function persist(source) {
    persistence?.put?.('input-runtime.sources', source.source_id, {
      source_id: source.source_id,
      status: source.status,
      enabled: source.enabled,
      last_attempt_at: source.last_attempt_at,
      last_success_at: source.last_success_at,
      next_attempt_at: source.next_attempt_at,
      consecutive_failures: source.consecutive_failures,
      last_error: source.last_error,
      freshness: source.freshness,
      ttl_ms: source.ttl_ms,
      provider: source.provider,
      provenance: source.provenance,
    });
  }

  function persistRun(run) {
    const next = { ...run, result_event_ids: [...(run.result_event_ids ?? [])] };
    runs.set(next.run_id, next);
    persistence?.put?.(RUN_NAMESPACE, next.run_id, next);
    while (runs.size > MAX_RUNS) {
      const oldest = runs.keys().next().value;
      if (oldest === undefined) break;
      runs.delete(oldest);
      persistence?.remove?.(RUN_NAMESPACE, oldest);
    }
    return next;
  }

  function startRun(source, startedAt, request = null, runIdOverride = null) {
    runSequence += 1;
    const timestamp = startedAt.toISOString();
    const run = {
      schema: RUN_SCHEMA,
      rule_version: RULE_VERSION,
      run_id: runIdOverride ?? `input-runtime:${source.source_id}:${timestamp}:${runSequence}`,
      source_id: source.source_id,
      provider: source.provider ?? null,
      request: request ? {
        source_id: source.source_id,
        force: request.force === true,
        provider: source.provider ?? null,
        ttl_ms: source.ttl_ms,
      } : null,
      started_at: timestamp,
      completed_at: null,
      result_event_ids: [],
      error: null,
      status: 'running',
    };
    return persistRun(run);
  }

  function withOperation(runId, source, request, callback) {
    if (typeof operationScope?.withOperation !== 'function') return callback();
    return operationScope.withOperation({
      operation_id: runId,
      operation_kind: 'input-runtime.refresh',
      source: `input-runtime:${source.source_id}`,
      request,
    }, callback);
  }

  function setOperationResultRef(reference) {
    // Result references are intentionally a digest/summary boundary.  The
    // provider payload itself belongs to the connector and must not leak into
    // a public replay journal.
    try { operationScope?.setOperationResultRef?.(reference); } catch { /* audit-only */ }
  }

  function operationCount() {
    try { return operationScope?.operationCount?.() ?? null; } catch { return null; }
  }

  function completeRun(run, { completedAt, result, error = null, status = 'completed', skipped = false, trace = null,
    request = null, operationStart = null } = {}) {
    if (!run) return null;
    const resultRef = { schema: 'deskbot.input-runtime-result-ref.v1', source_id: run.source_id,
      run_id: run.run_id, status, provider: run.provider ?? null, result_event_ids: resultEventIds(result),
      fetched_at: iso(result?.fetched_at), ...(error ? { error: { ...error } } : {}) };
    // Put the public reference in the operation context before the run write;
    // recordInputRuntimeRun replaces the same provider phase with the private
    // fixture after the run has been persisted.
    if (typeof operationScope?.recordInputRuntimeRun === 'function') setOperationResultRef({ ...resultRef, purpose: 'input-runtime' });
    const persisted = persistRun({
      ...run,
      completed_at: iso(completedAt) ?? now().toISOString(),
      result_event_ids: resultEventIds(result),
      error: error ? { ...error } : null,
      status,
      ...(skipped ? { skipped: true } : {}),
      ...(trace ? { trace: stableTrace(trace), replay: safeReplayMetadata({
        pipeline: 'input-runtime', ruleVersion: RULE_VERSION,
        inputEventIds: [], outputEventIds: resultEventIds(result),
        inputs: request,
      }) } : {}),
    });
    if (typeof operationScope?.recordInputRuntimeRun === 'function') {
      operationScope.recordInputRuntimeRun({ run: persisted, request, fixture: replayFixture(result), resultRef,
        operation_start: operationStart, operation_end: operationCount() });
    } else {
      setOperationResultRef(resultRef);
    }
    return persisted;
  }

  function registerSource({
    sourceId,
    source_id,
    displayName = null,
    kind = 'external_provider',
    enabled = true,
    ttlMs = interval,
    refresh,
    ingest = null,
    provider = null,
    provenance = null,
    replayFixture = null,
  } = {}) {
    const id = requireSourceId(sourceId ?? source_id);
    if (typeof refresh !== 'function') throw new TypeError(`source ${id} must provide refresh()`);
    const previous = restored.get(id) ?? {};
    const source = {
      source_id: id,
      display_name: displayName ?? id,
      kind,
      enabled: enabled === true,
      status: previous.status ?? (enabled ? 'ready' : 'disabled'),
      last_attempt_at: previous.last_attempt_at ?? null,
      last_success_at: previous.last_success_at ?? null,
      next_attempt_at: previous.next_attempt_at ?? null,
      consecutive_failures: Number.isInteger(previous.consecutive_failures) ? previous.consecutive_failures : 0,
      last_error: previous.last_error ?? null,
      freshness: previous.freshness ?? 'unavailable',
      ttl_ms: Math.max(1000, Number.parseInt(ttlMs, 10) || interval),
      provider: provider ?? previous.provider ?? null,
      provenance: provenance ?? previous.provenance ?? null,
      replayFixture: typeof replayFixture === 'function' ? replayFixture : null,
      refresh,
      ingest,
    };
    sources.set(id, source);
    persist(source);
    return publicSource(source);
  }

  function publicSource(source) {
    const current = now();
    const expiresAt = source.last_success_at
      ? new Date(Date.parse(source.last_success_at) + source.ttl_ms).toISOString()
      : null;
    const fresh = Boolean(source.last_success_at && current.getTime() < Date.parse(expiresAt));
    return {
      source_id: source.source_id,
      display_name: source.display_name,
      kind: source.kind,
      enabled: source.enabled,
      status: source.enabled ? (source.last_error ? 'error' : (fresh ? 'fresh' : source.status)) : 'disabled',
      last_attempt_at: source.last_attempt_at,
      last_success_at: source.last_success_at,
      next_attempt_at: source.next_attempt_at,
      consecutive_failures: source.consecutive_failures,
      last_error: source.last_error,
      freshness: fresh ? 'fresh' : (source.last_success_at ? 'stale' : 'unavailable'),
      ttl_ms: source.ttl_ms,
      expires_at: expiresAt,
      provider: source.provider,
      provenance: source.provenance,
    };
  }

  function status() {
    return {
      schema: 'foundry.input-runtime-status.v0.1',
      running,
      interval_ms: interval,
      sources: [...sources.values()].map(publicSource),
      runs: [...runs.values()].slice(-50).map((run) => ({
        schema: run.schema,
        rule_version: run.rule_version,
        run_id: run.run_id,
        source_id: run.source_id,
        started_at: run.started_at,
        completed_at: run.completed_at,
        result_event_ids: [...(run.result_event_ids ?? [])],
        error: run.error ?? null,
        status: run.status,
        ...(run.skipped ? { skipped: true } : {}),
        ...(run.trace ? { trace: structuredClone(run.trace), replay: structuredClone(run.replay) } : {}),
      })),
    };
  }

  function due(source, force) {
    if (!source.enabled || force) return source.enabled;
    if (!source.next_attempt_at) return true;
    return now().getTime() >= Date.parse(source.next_attempt_at);
  }

  async function refreshSource(source, { force = false, replay = null } = {}) {
    const startedAt = replay?.run?.started_at ? new Date(replay.run.started_at) : now();
    // Derive the id before entering the scope so the journal can name the
    // transaction that creates the persisted `running` record.  Incrementing
    // remains inside the callback, preserving the existing sequence semantics
    // when multiple sources are refreshed concurrently.
    const runId = replay?.run?.run_id ?? `input-runtime:${source.source_id}:${startedAt.toISOString()}:${runSequence + 1}`;
    const request = replay?.request ?? replay?.run?.request ?? { source_id: source.source_id, force, provider: source.provider, ttl_ms: source.ttl_ms };
    const operationStart = replay?.operation_start ?? operationCount();
    return withOperation(runId, source, request, async () => {
      const run = startRun(source, startedAt, request, replay?.run?.run_id ?? null);
      const recorder = createRuntimeTraceRecorder({
        runId: run.run_id, pipeline: 'input-runtime', ruleVersion: RULE_VERSION,
        startedAt, now,
      });
      if (replay?.run?.status === 'skipped' || !due(source, force)) {
        completeRun(run, { completedAt: now(), status: 'skipped', skipped: true,
          trace: recorder.finish({ status: 'skipped' }), request, operationStart });
        return { source_id: source.source_id, skipped: true, reason: 'not_due', run_id: run.run_id };
      }
      const attemptedAt = startedAt.toISOString();
      source.last_attempt_at = attemptedAt;
      source.status = 'refreshing';
      source.last_error = null;
      persist(source);
      let result = null;
      try {
        result = await recorder.observe('input', () => replay
          ? (replay.fixture !== null && replay.fixture !== undefined
            ? replay.fixture
            : source.replayFixture
              ? source.replayFixture(replay)
            : replayProviders?.resolveInput?.({ source_id: source.source_id, run_id: run.run_id, record: replay }))
          : source.refresh({ force }));
        if (replay && result === undefined) throw replayFixtureError({ code: 'replay_input_fixture_missing', message: `missing fixture for ${run.run_id}` });
        if (source.ingest && result?.event) await recorder.observe('perception', () => source.ingest(result.event, result), {
          references: { event_ids: resultEventIds(result) },
        });
        const providerStatus = result?.connector ?? null;
        const outputEventIds = resultEventIds(result);
        const successAt = providerStatus?.last_success_at ?? result?.fetched_at ?? attemptedAt;
        source.last_success_at = iso(successAt) ?? attemptedAt;
        source.consecutive_failures = 0;
        source.last_error = null;
        source.status = 'fresh';
        source.freshness = 'fresh';
        source.ttl_ms = Number.parseInt(providerStatus?.ttl_ms, 10) || source.ttl_ms;
        source.provider = providerStatus?.provider ?? source.provider;
        source.next_attempt_at = new Date(Date.parse(source.last_success_at) + source.ttl_ms).toISOString();
        persist(source);
        completeRun(run, { completedAt: now(), result, status: 'completed',
          trace: recorder.finish({ resultEventIds: outputEventIds }), request, operationStart });
        return { source_id: source.source_id, skipped: false, result, status: publicSource(source), run_id: run.run_id };
      } catch (error) {
        const detail = errorDetail(error);
        source.consecutive_failures += 1;
        source.last_error = detail;
        source.status = 'error';
        source.freshness = source.last_success_at ? 'stale' : 'unavailable';
        const index = Math.min(source.consecutive_failures - 1, backoffMs.length - 1);
        const delay = Math.max(1000, Number.parseInt(backoffMs[index], 10) || DEFAULT_BACKOFF_MS[DEFAULT_BACKOFF_MS.length - 1]);
        source.next_attempt_at = new Date(now().getTime() + delay).toISOString();
        persist(source);
        completeRun(run, { completedAt: now(), result, error: detail, status: 'error',
          trace: recorder.finish({ status: 'error', error: detail, resultEventIds: resultEventIds(result) }), request, operationStart });
        return { source_id: source.source_id, skipped: false, error: detail, status: publicSource(source), run_id: run.run_id };
      }
    });
  }

  async function replayRun(record, { fixture = null } = {}) {
    if (!record || typeof record !== 'object' || !record.run) throw new TypeError('input replay record is required');
    const source = sources.get(record.source_id ?? record.run.source_id);
    if (!source) throw Object.assign(new Error(`replay_input_source_missing: ${record.source_id ?? record.run.source_id}`), { code: 'replay_input_source_missing' });
    const result = await refreshSource(source, { force: true, replay: { ...record, fixture } });
    const actual = runs.get(record.run.run_id);
    if (!actual || JSON.stringify(comparableRun(actual)) !== JSON.stringify(comparableRun(record.run))) {
      const error = new Error(`replay input run mismatch: ${record.run.run_id}`);
      error.code = 'replay_input_run_mismatch';
      error.actual = actual;
      error.expected = record.run;
      throw error;
    }
    return { ...result, run: actual };
  }

  async function tick({ force = false, sourceIds = null } = {}) {
    if (ticking) return ticking;
    ticking = Promise.all([...sources.values()].filter(source => sourceIds === null || sourceIds.includes(source.source_id)).map(async (source) => {
      try {
        return await refreshSource(source, { force });
      } catch (error) {
        const detail = errorDetail(error);
        source.consecutive_failures += 1;
        source.last_error = detail;
        source.status = 'error';
        source.freshness = source.last_success_at ? 'stale' : 'unavailable';
        const index = Math.min(source.consecutive_failures - 1, backoffMs.length - 1);
        const delay = Math.max(1000, Number.parseInt(backoffMs[index], 10) || DEFAULT_BACKOFF_MS[DEFAULT_BACKOFF_MS.length - 1]);
        source.next_attempt_at = new Date(now().getTime() + delay).toISOString();
        try { persist(source); } catch { /* Keep scheduler failures isolated from the service loop. */ }
        return { source_id: source.source_id, skipped: false, error: detail, status: publicSource(source) };
      }
    }))
      .finally(() => { ticking = null; });
    return ticking;
  }

  function start() {
    if (running) return status();
    running = true;
    timer = setInterval(() => { void tick(); }, interval);
    timer.unref?.();
    return status();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    running = false;
    return status();
  }

  return { registerSource, status, start, stop, tick, replayRun, operationCount };
}

export {
  DEFAULT_BACKOFF_MS,
  DEFAULT_INTERVAL_MS,
  MAX_RUNS,
  RULE_VERSION,
  RUN_NAMESPACE,
  RUN_SCHEMA,
  resultEventIds,
};
