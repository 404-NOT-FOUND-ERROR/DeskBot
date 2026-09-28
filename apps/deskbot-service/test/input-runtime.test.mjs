import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createInputRuntime } from '../src/input-runtime.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';

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
  clock = new Date('2026-09-28T00:05:00.000Z');
  const skipped = await runtime.tick();
  assert.equal(skipped[0].skipped, true);
  assert.equal(calls, 1);
  persistence.close();

  const restoredPersistence = createSqlitePersistence({ filename, now });
  const restored = createInputRuntime({ now, persistence: restoredPersistence, intervalMs: 60_000 });
  restored.registerSource({ sourceId: 'test-source', ttlMs: 600_000, refresh: async () => { calls += 1; return {}; } });
  assert.equal(restored.status().sources[0].last_success_at, '2026-09-28T00:00:00.000Z');
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
});
