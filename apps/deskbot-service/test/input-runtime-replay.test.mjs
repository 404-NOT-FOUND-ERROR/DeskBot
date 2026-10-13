import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createInputRuntime } from '../src/input-runtime.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import {
  createCanonicalReplayCapture,
  exportCanonicalReplayCapture,
  replayServiceCapture,
} from '../src/replay-capture.mjs';

const BASE = new Date('2026-10-14T00:00:00.000Z');

function setup(dir, { replay = false, replayProviders = null, now } = {}) {
  const persistence = createSqlitePersistence({ filename: join(dir, replay ? 'target.sqlite' : 'source.sqlite'), now });
  const world = createPersistentWorld({ persistence, now, timeMode: 'simulation', timeZone: 'Asia/Shanghai', syncClockOnCreate: false });
  const runtime = createInputRuntime({ now, persistence, intervalMs: 60_000, backoffMs: [60_000], replayProviders });
  return { persistence, world, runtime };
}

test('input-runtime fixture capture replays success, skip, restart, and never calls source provider', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-input-runtime-replay-'));
  let clock = BASE;
  const now = () => new Date(clock);
  const sourcePersistence = createSqlitePersistence({ filename: join(dir, 'source.sqlite'), now });
  const sourceWorld = createPersistentWorld({ persistence: sourcePersistence, now, timeMode: 'simulation', timeZone: 'Asia/Shanghai', syncClockOnCreate: false });
  const capture = createCanonicalReplayCapture({
    persistence: sourcePersistence,
    directory: join(dir, 'archive'),
    now,
    expectedNamespaces: ['input-runtime.sources', 'input-runtime.runs'],
  });
  capture.initialize({ world: sourceWorld.get(), timeMode: 'simulation', timeZone: 'Asia/Shanghai' });
  let providerCalls = 0;
  const ingested = [];
  const sourceRuntime = createInputRuntime({ now, persistence: sourcePersistence, intervalMs: 60_000, operationScope: capture });
  sourceRuntime.registerSource({
    sourceId: 'fixture-news', displayName: 'fixture news', provider: 'fixture-provider', ttlMs: 600_000,
    refresh: async () => {
      providerCalls += 1;
      return {
        fetched_at: now().toISOString(),
        connector: { provider: 'fixture-provider', last_success_at: now().toISOString(), ttl_ms: 600_000 },
        event: { event_id: 'fixture-news-1', type: 'news.item', occurred_at: now().toISOString(), payload: { title: '一盏灯亮了' } },
        private_payload: { token: 'must-not-be-captured-in-journal' },
      };
    },
    ingest: async (event) => { ingested.push(event.event_id); },
  });
  t.after(() => { try { capture.close(); } catch {} try { sourcePersistence.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  const first = await sourceRuntime.tick({ force: true });
  assert.equal(first[0].status.freshness, 'fresh');
  assert.equal(providerCalls, 1);
  const repeated = await sourceRuntime.tick({ force: true });
  assert.equal(repeated[0].status.freshness, 'fresh');
  assert.equal(providerCalls, 2);
  clock = new Date(BASE.getTime() + 60_000);
  const skipped = await sourceRuntime.tick();
  assert.equal(skipped[0].skipped, true);
  assert.deepEqual(ingested, ['fixture-news-1', 'fixture-news-1']);

  exportCanonicalReplayCapture({ databasePath: join(dir, 'source.sqlite'), directory: join(dir, 'archive') });
  const tape = JSON.parse(readFileSync(join(dir, 'archive', 'capture.json'), 'utf8'));
  assert.equal(tape.input_runs.length, 3);
  assert.equal(tape.input_runs[0].run.status, 'completed');
  assert.equal(tape.input_runs[1].run.status, 'completed');
  assert.equal(tape.input_runs[2].run.status, 'skipped');
  assert.ok(tape.providers.some(record => record.kind === 'input-runtime'));
  assert.equal(JSON.stringify(tape.journals).includes('must-not-be-captured-in-journal'), false);

  const runtimeFactory = ({ persistence, now: replayNow, replayProviders }) => {
    const world = createPersistentWorld({ persistence, now: replayNow, timeMode: 'simulation', timeZone: 'Asia/Shanghai', syncClockOnCreate: false });
    const ingestedReplay = [];
    const runtime = createInputRuntime({ now: replayNow, persistence, intervalMs: 60_000, replayProviders });
    runtime.registerSource({
      sourceId: 'fixture-news', provider: 'fixture-provider', ttlMs: 600_000,
      refresh: async () => { throw new Error('external_provider_called'); },
      ingest: async (event) => { ingestedReplay.push(event.event_id); },
    });
    return {
      persistentWorld: world,
      replayInputRun: runtime.replayRun,
      providerCalls: () => 0,
      close: () => persistence.close(),
    };
  };
  const fresh = await replayServiceCapture({ directory: join(dir, 'archive'), targetDatabase: join(dir, 'fresh.sqlite'), runtimeFactory });
  const restarted = await replayServiceCapture({ directory: join(dir, 'archive'), targetDatabase: join(dir, 'restarted.sqlite'), runtimeFactory, restartAt: 1 });
  assert.equal(fresh.verified, true);
  assert.equal(fresh.provider_calls, 0);
  assert.deepEqual(restarted.namespace_digests, fresh.namespace_digests);
});

test('input-runtime replay fails closed for missing, tampered, and unregistered fixtures', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-input-runtime-replay-negative-'));
  const now = () => new Date(BASE);
  const source = join(dir, 'source.sqlite'), archive = join(dir, 'archive');
  const persistence = createSqlitePersistence({ filename: source, now });
  const world = createPersistentWorld({ persistence, now, timeMode: 'simulation', syncClockOnCreate: false });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now });
  capture.initialize({ world: world.get(), timeMode: 'simulation', timeZone: 'Asia/Shanghai' });
  const runtime = createInputRuntime({ now, persistence, operationScope: capture });
  runtime.registerSource({ sourceId: 'fixture-error', provider: 'fixture', refresh: async () => {
    const error = new Error('source unavailable'); error.code = 'fixture_offline'; throw error;
  } });
  await runtime.tick({ force: true });
  exportCanonicalReplayCapture({ databasePath: source, directory: archive });
  t.after(() => { try { capture.close(); } catch {} try { persistence.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });

  const original = readFileSync(join(archive, 'capture.json'), 'utf8');
  const missing = JSON.parse(original); missing.providers = [];
  writeFileSync(join(archive, 'capture.json'), JSON.stringify(missing));
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'missing.sqlite'), runtimeFactory: () => { throw Error('must_not_start'); } }), /replay_provider_fixture_missing/);
  assert.equal(existsSync(join(dir, 'missing.sqlite')), false);

  const restored = JSON.parse(original);
  restored.providers[0].ref.error.code = 'tampered';
  writeFileSync(join(archive, 'capture.json'), JSON.stringify(restored));
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'tampered.sqlite'), runtimeFactory: () => { throw Error('must_not_start'); } }), /replay_capture_provider_corrupt/);
  assert.equal(existsSync(join(dir, 'tampered.sqlite')), false);

  writeFileSync(join(archive, 'capture.json'), original);
  const runtimeFactory = ({ persistence: targetPersistence, now: targetNow, replayProviders }) => {
    const targetWorld = createPersistentWorld({ persistence: targetPersistence, now: targetNow, timeMode: 'simulation', syncClockOnCreate: false });
    const targetRuntime = createInputRuntime({ now: targetNow, persistence: targetPersistence, replayProviders });
    targetRuntime.registerSource({ sourceId: 'different-source', refresh: async () => ({}) });
    return { persistentWorld: targetWorld, replayInputRun: targetRuntime.replayRun, providerCalls: () => 0, close: () => targetPersistence.close() };
  };
  await assert.rejects(replayServiceCapture({ directory: archive, targetDatabase: join(dir, 'unregistered.sqlite'), runtimeFactory }), /replay_input_source_missing/);
  assert.equal(existsSync(join(dir, 'unregistered.sqlite')), true, 'runtime starts only after archive validation; source registration failure may leave target for cleanup');
});
