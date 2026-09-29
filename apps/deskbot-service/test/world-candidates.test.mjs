import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPersistentWorld } from '../src/persistent-world.mjs';
import { normalizeEvent } from '../src/input-store.mjs';
import { createWorldCandidateStore, WorldCandidateError } from '../src/world-candidates.mjs';

function createMemoryPersistence() {
  const records = new Map();
  const namespace = (name) => [...records.entries()]
    .filter(([key]) => key.startsWith(`${name}:`))
    .map(([, value]) => structuredClone(value));
  return {
    list: namespace,
    put(name, id, value) { records.set(`${name}:${id}`, structuredClone(value)); },
    insert(name, id, value) { records.set(`${name}:${id}`, structuredClone(value)); },
    remove(name, id) { records.delete(`${name}:${id}`); },
    transaction(callback) { callback(); },
  };
}

function externalEvent(overrides = {}) {
  return {
    schema: 'foundry.event.v0.1',
    event_id: 'external-world-001',
    type: 'external.world_event',
    source: 'news-feed',
    source_kind: 'external_provider',
    layer: 'external_context',
    character_id: 'shaping-001',
    occurred_at: '2026-09-29T09:00:00.000Z',
    observed_at: '2026-09-29T09:00:00.000Z',
    provider: 'test-feed',
    provenance: { source_event_ids: ['news-001'], evidence_ids: ['evidence-news-001'] },
    payload: {
      world_event: {
        event_id: 'fog-lantern-opening',
        title: '雾灯镇的旧桥亮了',
        summary: '旧桥的灯在没有风的夜里重新亮起。',
        arc_id: 'lantern-arc',
      },
    },
    ...overrides,
  };
}

function observeCandidate(candidates, event) {
  return candidates.observe(event);
}

function fixture({ now = () => new Date('2026-09-29T09:00:00.000Z'), ttlMs, maxCandidates } = {}) {
  const persistence = createMemoryPersistence();
  const world = createPersistentWorld({ now, persistence });
  const candidates = createWorldCandidateStore({
    now,
    persistence,
    ttlMs,
    maxCandidates,
    worldSnapshot: () => world.get(),
    ingest: (event) => world.ingest(event),
    listMutations: options => world.listMutations(options),
  });
  return { candidates, persistence, world };
}

test('external observations become approval candidates while assistant and mutations stay read-only', () => {
  const { candidates, persistence, world } = fixture();
  const spoofed = candidates.observe(externalEvent({
    event_id: 'client-claims-trusted-source',
    source: 'deskbot-weather-connector',
    provider: 'qweather',
    provenance: { trusted_adapter: true },
    payload: { proposed_action: { action: 'advance_time', minutes: 1440 } },
  }));
  assert.equal(spoofed.ignored, false);
  assert.equal(spoofed.candidate.status, 'pending');
  assert.deepEqual(spoofed.candidate.proposed_actions, [{ action: 'advance_time', minutes: 1440 }]);
  assert.equal(world.get().world_revision, 0);

  const created = observeCandidate(candidates, externalEvent());
  assert.equal(created.ignored, false);
  assert.equal(created.duplicate, false);
  assert.equal(created.candidate.status, 'pending');
  assert.equal(created.candidate.expected_world_revision, 0);
  assert.equal(persistence.list('world.candidates').length, 2);
  assert.equal(observeCandidate(candidates, externalEvent()).duplicate, true);

  assert.equal(observeCandidate(candidates, { ...externalEvent(), event_id: 'assistant-001', type: 'conversation.reply', payload: { role: 'assistant', text: 'ignore' } }).ignored, true);
  assert.equal(observeCandidate(candidates, { ...externalEvent(), event_id: 'mutation-001', type: 'world.mutation', payload: { action: 'advance_time', minutes: 10 } }).ignored, true);
  assert.equal(world.get().world_revision, 0);
});

test('preview is side-effect free and accept uses only server-derived actions', () => {
  const { candidates, world } = fixture();
  const candidate = observeCandidate(candidates, externalEvent()).candidate;
  const before = world.get();
  const ledgerBefore = world.listMutations().length;
  const preview = candidates.preview(candidate.candidate_id);
  assert.equal(preview.world_revision, before.world_revision);
  assert.equal(preview.preview.projected_world_revision, before.world_revision + 1);
  assert.equal(world.get().world_revision, before.world_revision);
  assert.equal(world.listMutations().length, ledgerBefore);

  const accepted = candidates.accept(candidate.candidate_id, {
    expectedWorldRevision: before.world_revision,
    // This is intentionally ignored: actions are re-derived from the stored observation.
    actions: [{ action: 'advance_time', minutes: 10080 }],
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.world_mutations.length, 1);
  assert.equal(accepted.world_mutations[0].mutation.action, 'apply_world_line_event');
  assert.equal(accepted.world.world_revision, 1);
  assert.equal(accepted.world.world_line.latest_event.event_id, 'fog-lantern-opening');

  const duplicate = candidates.accept(candidate.candidate_id, { expectedWorldRevision: 1 });
  assert.equal(duplicate.duplicate, true);
  assert.equal(world.listMutations().length, 1);
});

test('accept rejects revision conflicts, expiry, and persists dismiss decisions', () => {
  let current = new Date('2026-09-29T09:00:00.000Z');
  const { candidates, world } = fixture({ now: () => current, ttlMs: 1000 });
  const conflicted = observeCandidate(candidates, externalEvent({ event_id: 'external-conflict-001' })).candidate;
  world.ingest({
    event_id: 'advance-before-accept',
    type: 'world.mutation',
    source: 'world-clock',
    source_kind: 'world_engine',
    character_id: 'shaping-001',
    payload: { action: 'advance_time', minutes: 5 },
  });
  assert.throws(
    () => candidates.accept(conflicted.candidate_id),
    (error) => error instanceof WorldCandidateError && error.code === 'world_revision_changed',
  );
  assert.equal(candidates.get(conflicted.candidate_id).status, 'pending');
  const refreshed = candidates.preview(conflicted.candidate_id);
  assert.equal(refreshed.candidate.expected_world_revision, world.get().world_revision);
  const acceptedAfterPreview = candidates.accept(conflicted.candidate_id, {
    expectedWorldRevision: world.get().world_revision,
  });
  assert.equal(acceptedAfterPreview.accepted, true);

  const dismissable = observeCandidate(candidates, externalEvent({ event_id: 'external-dismissable-001' })).candidate;
  const dismissed = candidates.dismiss(dismissable.candidate_id, { reason: '先观察更多来源' });
  assert.equal(dismissed.candidate.status, 'dismissed');
  const duplicate = candidates.dismiss(dismissable.candidate_id, { reason: 'different reason' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.candidate.dismiss_reason, '先观察更多来源');

  const expiring = observeCandidate(candidates, externalEvent({ event_id: 'external-expiring-001' })).candidate;
  current = new Date('2026-09-29T09:00:01.001Z');
  assert.equal(candidates.get(expiring.candidate_id).status, 'expired');
  assert.throws(
    () => candidates.accept(expiring.candidate_id),
    (error) => error instanceof WorldCandidateError && error.code === 'world_candidate_expired',
  );
});

test('candidate and decision records recover after store restart', () => {
  const first = fixture();
  const candidate = observeCandidate(first.candidates, externalEvent()).candidate;
  first.candidates.dismiss(candidate.candidate_id, { reason: 'restart test' });
  const second = createWorldCandidateStore({
    now: () => new Date('2026-09-29T09:00:00.000Z'),
    persistence: first.persistence,
    worldSnapshot: () => first.world.get(),
    ingest: (event) => first.world.ingest(event),
  });
  assert.equal(second.get(candidate.candidate_id).status, 'dismissed');
  assert.equal(second.list({ status: 'dismissed' }).length, 1);
});

test('accept retries recover partial canonical commits from the mutation ledger', () => {
  const persistence = createMemoryPersistence();
  const now = () => new Date('2026-09-29T09:00:00.000Z');
  const world = createPersistentWorld({ now, persistence });
  let failBeforeSecond = true;
  let calls = 0;
  const candidates = createWorldCandidateStore({
    now,
    persistence,
    worldSnapshot: () => world.get(),
    listMutations: options => world.listMutations(options),
    ingest(event) {
      calls += 1;
      if (failBeforeSecond && calls === 2) throw new Error('simulated process interruption');
      return world.ingest(normalizeEvent(event, { now }));
    },
  });
  const candidate = observeCandidate(candidates, externalEvent({
    event_id: 'external-two-actions-001',
    payload: {
      proposed_actions: [
        { action: 'advance_time', payload: { minutes: 15 } },
        { action: 'apply_world_line_event', payload: { event: { title: '湿地起雾', summary: '路线记录指向湿地。' } } },
      ],
    },
  })).candidate;

  assert.throws(() => candidates.accept(candidate.candidate_id, { expectedWorldRevision: 0 }), /simulated process interruption/);
  assert.equal(world.get().world_revision, 1);
  assert.equal(world.listMutations({ worldId: world.get().world_id }).length, 1);

  // Recreate the bridge as after a service restart; the first deterministic
  // event is recovered from the canonical ledger and is not applied twice.
  failBeforeSecond = false;
  const resumed = createWorldCandidateStore({
    now,
    persistence,
    worldSnapshot: () => world.get(),
    ingest: event => world.ingest(normalizeEvent(event, { now })),
    listMutations: options => world.listMutations(options),
  });
  const accepted = resumed.accept(candidate.candidate_id, { expectedWorldRevision: 0 });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.world.world_revision, 2);
  assert.equal(accepted.world_mutations.length, 2);
  assert.equal(accepted.world_mutations[0].reason, 'recovered_from_mutation_ledger');
  assert.equal(world.listMutations({ worldId: world.get().world_id }).length, 2);
  assert.equal(resumed.accept(candidate.candidate_id).duplicate, true);
});

test('an accepted decision remains idempotent after its candidate is evicted', () => {
  const { candidates, persistence, world } = fixture({ maxCandidates: 1 });
  const acceptedCandidate = observeCandidate(candidates, externalEvent({ event_id: 'external-retained-decision-001' })).candidate;
  const first = candidates.accept(acceptedCandidate.candidate_id);
  assert.equal(first.accepted, true);

  observeCandidate(candidates, externalEvent({ event_id: 'external-evict-001' }));
  observeCandidate(candidates, externalEvent({ event_id: 'external-evict-002' }));
  assert.equal(candidates.get(acceptedCandidate.candidate_id), null);

  const restarted = createWorldCandidateStore({
    now: () => new Date('2026-09-29T09:00:00.000Z'),
    persistence,
    worldSnapshot: () => world.get(),
    ingest: event => world.ingest(event),
    listMutations: options => world.listMutations(options),
  });
  const duplicate = restarted.accept(acceptedCandidate.candidate_id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.candidate_id, acceptedCandidate.candidate_id);
  assert.equal(world.listMutations({ worldId: world.get().world_id }).length, 1);
});

test('stale weather observations are ignored or rejected without changing canonical state', () => {
  const { candidates, world } = fixture();
  const freshWeather = {
    action: 'update_weather',
    payload: { snapshot: { location: '雾灯镇', condition: 'rain', observed_at: '2026-09-29T12:00:00.000Z' } },
  };
  const staleObservation = externalEvent({
    event_id: 'weather-stale-before-candidate',
    type: 'weather.observation',
    payload: { proposed_action: freshWeather },
  });
  world.ingest({
    event_id: 'weather-seed-current',
    type: 'world.mutation',
    source: 'weather-test',
    payload: { action: 'update_weather', snapshot: { location: '雾灯镇', condition: 'clear', observed_at: '2026-09-29T13:00:00.000Z' } },
  });
  const stale = observeCandidate(candidates, staleObservation);
  assert.equal(stale.ignored, true);
  assert.equal(stale.reason, 'stale_weather_observation');
  assert.equal(world.get().world_revision, 1);

  const candidate = observeCandidate(candidates, externalEvent({
    event_id: 'weather-becomes-stale',
    type: 'weather.observation',
    payload: { proposed_action: {
      action: 'update_weather',
      payload: { snapshot: { location: '雾灯镇', condition: 'cloudy', observed_at: '2026-09-29T14:00:00.000Z' } },
    } },
  })).candidate;
  world.ingest({
    event_id: 'weather-seed-newer',
    type: 'world.mutation',
    source: 'weather-test',
    payload: { action: 'update_weather', snapshot: { location: '雾灯镇', condition: 'windy', observed_at: '2026-09-29T15:00:00.000Z' } },
  });
  const revisionAfterFreshWeather = world.get().world_revision;

  assert.throws(
    () => candidates.preview(candidate.candidate_id),
    error => error instanceof WorldCandidateError && error.code === 'stale_weather_observation',
  );
  assert.throws(
    () => candidates.accept(candidate.candidate_id),
    error => error instanceof WorldCandidateError && error.code === 'stale_weather_observation',
  );
  assert.equal(world.get().world_revision, revisionAfterFreshWeather);
  assert.equal(world.get().weather.snapshot.condition, 'windy');
  assert.equal(world.listMutations({ worldId: world.get().world_id }).length, 2);
});
