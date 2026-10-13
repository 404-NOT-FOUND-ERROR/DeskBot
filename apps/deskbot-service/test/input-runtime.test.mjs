import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createInputRuntime, RUN_NAMESPACE, RUN_SCHEMA, RULE_VERSION } from '../src/input-runtime.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createCanonicalReplayCapture } from '../src/replay-capture.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';

test('input runtime persists success, TTL scheduling, and skips work before due', async () => {
  let clock = new Date('2026-09-28T00:00:00.000Z');
  const now = () => new Date(clock);
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-input-runtime-'));
  const filename = join(directory, 'runtime.sqlite');
  const persistence = createSqlitePersistence({ filename, now });
  let calls = 0;
  const runtime = createInputRuntime({ now, persistence, intervalMs: 60_000 });
  runtime.registerSource({
    sourceId: 'test-source',
    ttlMs: 10 * 60_000,
    refresh: async () => { calls += 1; return { connector: { last_success_at: now().toISOString(), ttl_ms: 600_000 } }; },
  });
  const first = await runtime.tick();
  assert.equal(first[0].skipped, false);
  assert.equal(calls, 1);
  const runs = persistence.list(RUN_NAMESPACE);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].schema, RUN_SCHEMA);
  assert.equal(runs[0].rule_version, RULE_VERSION);
  assert.equal(runs[0].source_id, 'test-source');
  assert.equal(typeof runs[0].run_id, 'string');
  assert.equal(runs[0].started_at, '2026-09-28T00:00:00.000Z');
  assert.equal(runs[0].completed_at, '2026-09-28T00:00:00.000Z');
  assert.deepEqual(runs[0].result_event_ids, []);
  assert.equal(runs[0].error, null);
  assert.equal(runs[0].trace.schema, 'deskbot.runtime-trace.v1');
  assert.equal(runs[0].replay.authority, 'audit_only');
  assert.equal(runtime.status().runs[0].run_id, runs[0].run_id);
  clock = new Date('2026-09-28T00:05:00.000Z');
  const skipped = await runtime.tick();
  assert.equal(skipped[0].skipped, true);
  assert.equal(calls, 1);
  const skippedRun = persistence.list(RUN_NAMESPACE).at(-1);
  assert.equal(skippedRun.status, 'skipped');
  assert.equal(skippedRun.skipped, true);
  assert.equal(skippedRun.source_id, 'test-source');
  assert.equal(skippedRun.trace.status, 'skipped');
  assert.deepEqual(skippedRun.trace.stages, []);
  persistence.close();

  const restoredPersistence = createSqlitePersistence({ filename, now });
  const restored = createInputRuntime({ now, persistence: restoredPersistence, intervalMs: 60_000 });
  restored.registerSource({ sourceId: 'test-source', ttlMs: 600_000, refresh: async () => { calls += 1; return {}; } });
  assert.equal(restored.status().sources[0].last_success_at, '2026-09-28T00:00:00.000Z');
  assert.equal(restored.status().runs.length, 2);
  assert.equal(restored.status().runs[0].run_id, runs[0].run_id);
  assert.deepEqual(restored.status().runs[0].trace, runs[0].trace);
  assert.deepEqual(restored.status().runs[0].replay, runs[0].replay);
  const restoredSkipped = await restored.tick();
  assert.equal(restoredSkipped[0].skipped, true);
  assert.equal(calls, 1);
  restoredPersistence.close();
  rmSync(directory, { recursive: true, force: true });
});

test('input runtime records retry backoff without throwing into the scheduler', async () => {
  const now = () => new Date('2026-09-28T00:00:00.000Z');
  const runtime = createInputRuntime({ now, intervalMs: 60_000, backoffMs: [60_000, 300_000] });
  runtime.registerSource({
    sourceId: 'failing-source',
    refresh: async () => { const error = new Error('provider offline'); error.code = 'transport'; throw error; },
  });
  const result = await runtime.tick();
  assert.equal(result[0].error.code, 'transport');
  const source = runtime.status().sources[0];
  assert.equal(source.status, 'error');
  assert.equal(source.consecutive_failures, 1);
  assert.equal(source.last_error.message, 'provider offline');
  assert.equal(source.next_attempt_at, '2026-09-28T00:01:00.000Z');
});

test('input runtime persists result event ids and normalized errors in run records', async () => {
  const now = () => new Date('2026-09-28T00:00:00.000Z');
  const records = new Map();
  const persistence = {
    list: namespace => [...(records.get(namespace)?.values() ?? [])],
    put: (namespace, id, value) => {
      if (!records.has(namespace)) records.set(namespace, new Map());
      records.get(namespace).set(id, structuredClone(value));
    },
  };
  const runtime = createInputRuntime({ now, persistence, intervalMs: 60_000, backoffMs: [60_000] });
  runtime.registerSource({
    sourceId: 'event-source',
    refresh: async () => ({ events: [{ event_id: 'event-1' }, { event_id: 'event-2' }] }),
  });
  await runtime.tick();
  assert.deepEqual(runtime.status().runs[0].result_event_ids, ['event-1', 'event-2']);

  runtime.registerSource({
    sourceId: 'failing-event-source',
    refresh: async () => {
      const error = new Error('provider offline');
      error.code = 'transport';
      throw error;
    },
  });
  await runtime.tick();
  const failed = runtime.status().runs.find((run) => run.source_id === 'failing-event-source');
  assert.equal(failed.status, 'error');
  assert.equal(failed.trace.stages[0].status, 'error');
  assert.equal(failed.trace.stages[0].error.code, 'transport');
  assert.deepEqual(failed.error, { code: 'transport', message: 'provider offline', retryable: true });
  assert.equal(failed.completed_at, '2026-09-28T00:00:00.000Z');
});

test('input runtime contains persistence failures inside a scheduled tick', async () => {
  let failWrites = false;
  const persistence = {
    list: () => [],
    put: () => {
      if (failWrites) throw new Error('storage temporarily unavailable');
    },
  };
  const runtime = createInputRuntime({
    now: () => new Date('2026-09-28T00:00:00.000Z'),
    persistence,
    intervalMs: 60_000,
    backoffMs: [60_000],
  });
  runtime.registerSource({ sourceId: 'persisted-source', refresh: async () => ({}) });
  failWrites = true;

  const result = await runtime.tick();

  assert.equal(result[0].error.code, 'input_source_refresh_failed');
  assert.equal(result[0].status.status, 'error');
  assert.equal(runtime.status().sources[0].consecutive_failures, 1);
});

test('input runtime ingests provider events through the supplied canonical callback', async () => {
  const now = () => new Date('2026-09-28T00:00:00.000Z');
  const ingested = [];
  const runtime = createInputRuntime({ now });
  runtime.registerSource({
    sourceId: 'weather',
    refresh: async () => ({ event: { event_id: 'weather-runtime-1' }, connector: { last_success_at: now().toISOString(), ttl_ms: 60_000 } }),
    ingest: async (event) => ingested.push(event.event_id),
  });
  await runtime.tick();
  assert.deepEqual(ingested, ['weather-runtime-1']);
  assert.deepEqual(runtime.status().runs[0].trace.stages.map(stage => stage.stage), ['input', 'perception']);
  assert.deepEqual(runtime.status().runs[0].trace.result_event_ids, ['weather-runtime-1']);
});

test('input runtime wraps each source run in one operation scope and only exposes a result reference', async () => {
  const now = () => new Date('2026-09-28T00:00:00.000Z');
  const operations = [];
  const resultRefs = [];
  const runtime = createInputRuntime({
    now,
    operationScope: {
      withOperation(context, callback) {
        operations.push(context);
        return callback();
      },
      setOperationResultRef(reference) { resultRefs.push(structuredClone(reference)); },
    },
  });
  runtime.registerSource({
    sourceId: 'journal-weather',
    provider: 'qweather',
    refresh: async () => ({
      event: { event_id: 'journal-weather-event' },
      fetched_at: now().toISOString(),
      connector: { provider: 'qweather', last_success_at: now().toISOString(), ttl_ms: 60_000 },
      // This simulates connector-private content and must not be copied into
      // the operation result reference.
      private_payload: { api_key: 'secret', raw: 'provider response' },
    }),
  });
  const result = await runtime.tick();

  assert.equal(result[0].run_id, operations[0].operation_id);
  assert.equal(operations[0].operation_kind, 'input-runtime.refresh');
  assert.equal(operations[0].source, 'input-runtime:journal-weather');
  assert.deepEqual(operations[0].request, {
    source_id: 'journal-weather', force: false, provider: 'qweather', ttl_ms: 300000,
  });
  assert.deepEqual(resultRefs.at(-1), {
    schema: 'deskbot.input-runtime-result-ref.v1', source_id: 'journal-weather',
    run_id: result[0].run_id, status: 'completed', provider: 'qweather',
    result_event_ids: ['journal-weather-event'], fetched_at: '2026-09-28T00:00:00.000Z',
  });
  assert.equal(JSON.stringify(resultRefs).includes('secret'), false);
});

test('input runtime run writes carry the operation journal context in SQLite', async t => {
  const now = () => new Date('2026-09-28T00:00:00.000Z');
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-input-runtime-journal-'));
  const persistence = createSqlitePersistence({ filename: join(directory, 'runtime.sqlite'), now });
  const world = createPersistentWorld({ persistence, now, timeMode: 'simulation', syncClockOnCreate: false });
  const capture = createCanonicalReplayCapture({
    persistence,
    directory: join(directory, 'capture'),
    now,
    expectedNamespaces: ['input-runtime.sources', RUN_NAMESPACE],
  });
  capture.initialize({ world: world.get(), timeMode: 'simulation', timeZone: 'Asia/Shanghai' });
  t.after(() => {
    try { capture.close(); } catch {}
    try { persistence.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const runtime = createInputRuntime({ now, persistence, operationScope: capture, intervalMs: 60_000 });
  runtime.registerSource({ sourceId: 'journal-source', refresh: async () => ({ event: { event_id: 'journal-event' } }) });
  const [result] = await runtime.tick();
  const journals = persistence.list('replay.capture-journal');
  const runWrites = journals.filter(journal => journal.writes.some(write => write.namespace === RUN_NAMESPACE));

  assert.ok(runWrites.length >= 2, 'run start and completion must be journaled');
  assert.ok(runWrites.every(journal => journal.operation_id === result.run_id));
  assert.ok(runWrites.every(journal => journal.operation_kind === 'input-runtime.refresh'));
  assert.ok(runWrites.some(journal => journal.result_ref?.schema === 'deskbot.input-runtime-result-ref.v1'));
  assert.equal(JSON.stringify(journals).includes('provider response'), false,
    'provider payload is not journaled');
});
