import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';

const fixedTime = new Date('2026-09-04T08:00:00.000Z');

async function startServer(options = {}) {
  const server = createDeskBotServer({ now: () => fixedTime, websocket: false, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function post(origin, path, body) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('fixed L1b catalog exposes P1-P8 and keeps P4/P6 outside DIAMONDS', async (t) => {
  const runtime = await startServer();
  t.after(runtime.close);

  const response = await fetch(`${runtime.origin}/api/research/probes`);
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.deepEqual(catalog.probes.map((probe) => probe.probe_id), ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8']);
  assert.deepEqual(catalog.required_probe_ids, ['P4', 'P6']);
  assert.equal(catalog.probes.find((probe) => probe.probe_id === 'P4').diamonds_dimension, null);
  assert.equal(catalog.probes.find((probe) => probe.probe_id === 'P6').diamonds_dimension, null);
  assert.deepEqual(catalog.response_contract.time_samples, ['T1', 'T2']);
  assert.equal(catalog.response_contract.aggregate_stability_score, false);
});

test('L1b observation API validates time, preserves raw text, and is idempotent', async (t) => {
  const runtime = await startServer();
  t.after(runtime.close);
  const observation = {
    observation_id: 'probe-http-p4-t1-001',
    probe_id: 'P4',
    character_id: 'shaping-001',
    time_sample: 'T1',
    raw_text: '我会留下第一次看见光粒聚拢的那一刻。',
    shell_epoch: 1,
    world_revision: 12,
    source: 'deskbot-web-research',
  };

  const created = await post(runtime.origin, '/api/research/probe-observations', observation);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.duplicate, false);
  assert.equal(createdBody.observation.response.raw_text, observation.raw_text);
  assert.equal(createdBody.observation.measurement.status, 'awaiting_real_embedding_measurement');
  assert.equal(createdBody.observation.measurement.profile_dimension_values, null);
  assert.equal(createdBody.observation.measurement.profile_vector, null);
  assert.equal(createdBody.observation.measurement.model_id, null);

  const duplicate = await post(runtime.origin, '/api/research/probe-observations', observation);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);

  const conflict = await post(runtime.origin, '/api/research/probe-observations', {
    ...observation,
    raw_text: '另一段不同回答',
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error, 'l1b_observation_conflict');

  const invalidTime = await post(runtime.origin, '/api/research/probe-observations', {
    ...observation,
    observation_id: 'probe-http-invalid-time',
    time_sample: 'T3',
  });
  assert.equal(invalidTime.status, 400);

  const list = await (await fetch(`${runtime.origin}/api/research/probe-observations?character_id=shaping-001`)).json();
  assert.equal(list.observations.length, 1);
  assert.equal(list.observations[0].observation_id, observation.observation_id);

  const world = await (await fetch(`${runtime.origin}/api/world`)).json();
  assert.equal(world.world.world_revision, 0);
});

test('L1b raw observations recover from SQLite without producing measurements', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-l1b-'));
  const filename = join(directory, 'deskbot.sqlite');
  try {
    const firstPersistence = createSqlitePersistence({ filename, now: () => fixedTime });
    const first = await startServer({ persistence: firstPersistence });
    const created = await post(first.origin, '/api/research/probe-observations', {
      observation_id: 'probe-restart-p6-t2-001',
      probe_id: 'P6',
      character_id: 'shaping-001',
      time_sample: 'T2',
      raw_text: '壳变了，但我能认出一路留下来的痕迹。',
      shell_epoch: 2,
      world_revision: 20,
      source: 'restart-test',
    });
    assert.equal(created.status, 201);
    await first.close();
    firstPersistence.close();

    const secondPersistence = createSqlitePersistence({ filename, now: () => fixedTime });
    const second = await startServer({ persistence: secondPersistence });
    const list = await (await fetch(`${second.origin}/api/research/probe-observations`)).json();
    assert.equal(list.observations.length, 1);
    assert.equal(list.observations[0].time_sample, 'T2');
    assert.equal(list.observations[0].response.raw_text, '壳变了，但我能认出一路留下来的痕迹。');
    assert.equal(list.observations[0].measurement.profile_vector, null);
    await second.close();
    secondPersistence.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
