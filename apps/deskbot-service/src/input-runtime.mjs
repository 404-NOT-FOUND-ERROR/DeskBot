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

export function createInputRuntime({
  now = () => new Date(),
  persistence = null,
  intervalMs = DEFAULT_INTERVAL_MS,
  backoffMs = DEFAULT_BACKOFF_MS,
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

  function startRun(source, startedAt) {
    runSequence += 1;
    const timestamp = startedAt.toISOString();
    const run = {
      schema: RUN_SCHEMA,
      rule_version: RULE_VERSION,
      run_id: `input-runtime:${source.source_id}:${timestamp}:${runSequence}`,
      source_id: source.source_id,
      started_at: timestamp,
      completed_at: null,
      result_event_ids: [],
      error: null,
      status: 'running',
    };
    return persistRun(run);
  }

  function completeRun(run, { completedAt, result, error = null, status = 'completed', skipped = false } = {}) {
    if (!run) return null;
    return persistRun({
      ...run,
      completed_at: iso(completedAt) ?? now().toISOString(),
      result_event_ids: resultEventIds(result),
      error: error ? { ...error } : null,
      status,
      ...(skipped ? { skipped: true } : {}),
    });
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
      })),
    };
  }

  function due(source, force) {
    if (!source.enabled || force) return source.enabled;
    if (!source.next_attempt_at) return true;
    return now().getTime() >= Date.parse(source.next_attempt_at);
  }

  async function refreshSource(source, { force = false } = {}) {
    const startedAt = now();
    const run = startRun(source, startedAt);
    if (!due(source, force)) {
      completeRun(run, { completedAt: now(), status: 'skipped', skipped: true });
      return { source_id: source.source_id, skipped: true, reason: 'not_due', run_id: run.run_id };
    }
    const attemptedAt = startedAt.toISOString();
    source.last_attempt_at = attemptedAt;
    source.status = 'refreshing';
    source.last_error = null;
    persist(source);
    let result = null;
    try {
      result = await source.refresh({ force });
      if (source.ingest && result?.event) await source.ingest(result.event, result);
      const providerStatus = result?.connector ?? null;
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
      completeRun(run, { completedAt: now(), result, status: 'completed' });
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
      completeRun(run, { completedAt: now(), result, error: detail, status: 'error' });
      return { source_id: source.source_id, skipped: false, error: detail, status: publicSource(source), run_id: run.run_id };
    }
  }

  async function tick({ force = false } = {}) {
    if (ticking) return ticking;
    ticking = Promise.all([...sources.values()].map(async (source) => {
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

  return { registerSource, status, start, stop, tick };
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
