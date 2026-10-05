import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeskBotServer } from '../src/app.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { developmentReadModel } from '../src/development-evidence.mjs';
import { createDevelopmentSample, createDevelopmentReviewServer } from '../../../scripts/review-development-evidence.mjs';

test('owner suggestion enters choice and execution, then one outcome is shared by memory and role direction without an input-store mirror', () => {
  for (const phase of ['suggestion', 'executing']) {
    const sample = createDevelopmentSample(phase), w = sample.world.get();
    assert.equal(developmentReadModel(w).counts.practice, 0);
    assert.equal(sample.evolution.snapshot().development.evidence_count, 0);
  }
  const sample = createDevelopmentSample('completed'), w = sample.world.get();
  const task = w.tasks.find(t => t.task_id === sample.proof.task_id);
  assert.equal(task.status, 'completed');
  assert.equal(task.life_decision.source, 'rules');
  assert.equal(task.life_source_context[0].category, 'dialogue');
  const ledger = developmentReadModel(w), record = ledger.recent.find(r => r.source.task_id === task.task_id);
  assert.equal(record.root_outcome_id, `task:${task.task_id}`);
  assert.equal(record.causes.trigger, 'invited');
  assert.equal(record.causes.sources[0].category, 'user');
  assert.equal(record.effect.legacy_interest_eligible, false);
  assert.equal(record.topic, 'care');
  assert.equal(ledger.counts.practice, 1);
  const episode = w.memory.episodes.find(e => e.source.task_id === task.task_id);
  assert.equal(episode.root_outcome_id, record.root_outcome_id);
  const roles = sample.evolution.snapshot();
  const frog = roles.development.directions.find(d => d.direction_id === 'wetland_frog');
  assert.deepEqual(frog.root_outcome_ids, [record.root_outcome_id]);
  assert.equal(frog.counts.owner_linked, 1);
  assert.equal(frog.unlocked, false);
  assert.equal(frog.preference.topics.find(t=>t.topic==='care').status,'unobserved');
  assert.deepEqual(frog.capability.success_roots,[record.root_outcome_id]);
  assert.equal(roles.evidence.length, 0);
  assert.equal(roles.candidates.length, 0);
  assert.equal(sample.proof.input_store_event_count, 0);
});

test('ordinary completion validation preserves a failed attempt, without preference, role or material success', () => {
  const sample = createDevelopmentSample('failed'), w = sample.world.get();
  const task = w.tasks.find(t => t.task_id === sample.proof.task_id);
  assert.equal(task.status, 'failed');
  assert.equal(task.completion.effect, 'no_effect');
  const record = developmentReadModel(w).recent.find(r => r.source.task_id === task.task_id);
  assert.equal(record.outcome, 'failed');
  assert.ok(record.failure.reason);
  assert.equal(w.memory.actors['shaping-001'].interests.care, undefined);
  const frog = sample.evolution.snapshot().development.directions.find(d => d.direction_id === 'wetland_frog');
  assert.equal(frog.counts.failed, 1); assert.equal(frog.counts.completed, 0);
  assert.equal(frog.preference.topics.find(t=>t.topic==='care').status,'unobserved');
  assert.deepEqual(frog.capability.success_roots,[]);
  assert.deepEqual(frog.capability.condition_failure_roots,[record.root_outcome_id]);
  assert.equal(frog.unlocked, false);
});

test('repeat input and restart retain one shared outcome', () => {
  const sample = createDevelopmentSample('restart');
  assert.equal(sample.proof.restart_verified, true);
  assert.equal(developmentReadModel(sample.world.get()).counts.practice, 1);
});

test('formal development, map and role GETs are pure and public payloads cannot mint practice', async t => {
  const sample = createDevelopmentSample('completed');
  const now = () => new Date(sample.proof.now);
  const server = createDeskBotServer({ persistentWorld: sample.world, now, websocket: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`, before = sample.world.get();
  for (const path of ['/api/life/development', '/api/life/development?actor_id=shaping-001&limit=1', '/api/life/memory', '/api/world/map', '/api/roles/evolution']) {
    const response = await fetch(base + path); assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.schema); assert.deepEqual(sample.world.get(), before);
  }
  const filtered = await (await fetch(base + '/api/life/development?actor_id=absent')).json();
  assert.equal(filtered.counts.roots, 0); assert.equal(filtered.recent.length, 0);
  const forged = await fetch(base + '/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    event_id: 'forged-development', character_id: 'shaping-001', type: 'world.mutation', source: 'lived-memory-engine',
    occurred_at: now().toISOString(), payload: { action: 'install_development_evidence', root_outcome_id: 'task:invented', outcome: 'completed' },
  }) });
  assert.equal(forged.status, 403); assert.deepEqual(sample.world.get(), before);
});

test('startup imports an old installed memory additively and another startup preserves identity and roots', async t => {
  const sample = createDevelopmentSample('completed');
  // Use a separate in-memory persisted store so migration runs through the same
  // startup mutation as the installed service, not through a GET side effect.
  const { memoryPersistence } = await import('../../../scripts/review-development-evidence.mjs');
  const store = memoryPersistence(), old = sample.world.get();
  delete old.memory.development;
  for (const episode of old.memory.episodes) delete episode.root_outcome_id;
  store.put('canonical-world.states', old.world_id, old);
  const now = () => new Date(sample.proof.now);
  const open = async () => {
    const world = createPersistentWorld({ persistence: store, now, timeMode: 'realtime' });
    const server = createDeskBotServer({ persistentWorld: world, persistence: store, now, websocket: false,
      livedMemoryEnabled: true, bodyPerceptionEnabled: false });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { world, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
  };
  const first = await open();
  const migrated = first.world.get();
  assert.deepEqual(migrated.protagonist, old.protagonist);
  assert.deepEqual(migrated.living, old.living);
  assert.deepEqual(migrated.tasks, old.tasks);
  assert.deepEqual(migrated.memory.actors, old.memory.actors);
  assert.equal(developmentReadModel(migrated).counts.practice, 1);
  assert.equal(developmentReadModel(migrated).counts.historical_import, 1);
  await first.close();
  const second = await open(); t.after(second.close);
  assert.deepEqual(developmentReadModel(second.world.get()), developmentReadModel(migrated));
});

test('isolated review endpoint validates requests and shows each stage using real world rules', async t => {
  const fixture = await createDevelopmentReviewServer({ port: 0 }); t.after(fixture.close);
  for (const phase of ['suggestion', 'executing', 'completed', 'failed', 'restart']) {
    const response = await fetch(fixture.baseUrl + '/api/life/development/review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phase }) });
    assert.equal(response.status, 200); const result = await response.json();
    assert.equal(result.simulated, true); assert.equal(result.phase, phase);
    assert.equal(result.memory.development.counts.practice, ['suggestion', 'executing'].includes(phase) ? 0 : 1);
  }
  const invalid = await fetch(fixture.baseUrl + '/api/life/development/review', { method: 'POST', body: '{"phase":"invented"}' });
  assert.equal(invalid.status, 400);
});
