import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPersistentWorld,
  getWorldSchema,
} from '../src/persistent-world.mjs';

const fixedTime = new Date('2026-09-04T00:00:00.000Z');

function createWorld() {
  return createPersistentWorld({ now: () => fixedTime });
}

function mutation(eventId, action, payload, metadata = {}) {
  return {
    event_id: eventId,
    type: 'world.mutation',
    source: metadata.source ?? 'research-console',
    occurred_at: metadata.occurred_at ?? fixedTime.toISOString(),
    observed_at: metadata.observed_at ?? fixedTime.toISOString(),
    character_id: 'shaping-001',
    source_kind: metadata.source_kind ?? 'service',
    confidence: metadata.confidence ?? 0.9,
    provider: metadata.provider ?? 'test-provider',
    provenance: metadata.provenance ?? { test: true },
    payload: { action, ...payload },
  };
}

test('all seven input layers can be projected into the canonical world', () => {
  const world = createWorld();
  const ingest = (eventId, action, payload, metadata) => world.ingest(mutation(eventId, action, payload, metadata));

  ingest('multi-world-line', 'apply_world_line_event', {
    event: { event_id: 'line-001', title: '光域出现微弱回响', arc_id: 'arc-opening' },
  }, { source_kind: 'world_engine' });
  ingest('multi-external', 'record_external_context', {
    item: { item_id: 'news-001', title: '城市夜间降温', category: 'news', url: 'https://example.test/news-001' },
  }, { source_kind: 'external_provider', provider: 'news-test' });
  ingest('multi-weather', 'update_weather', {
    snapshot: { location: '实验室', condition: 'clear', temperature_c: 22, humidity: 0.45, wind_mps: 1.2, observed_at: '2026-09-04T08:00:00.000Z' },
  }, { source_kind: 'external_provider', provider: 'weather-test', observed_at: '2026-09-04T08:00:00.000Z' });
  ingest('multi-calendar', 'advance_calendar', {
    date: '2026-09-04T00:00:00.000Z', timezone: 'Asia/Shanghai', season: '秋', holiday: null,
  }, { source_kind: 'service' });
  ingest('multi-preference', 'observe_user_preference', {
    preference_key: 'conversation.pace', value: 'short',
  }, { source_kind: 'user' });
  ingest('multi-device', 'record_device_context', {
    device_id: 'deskbot-dev-001', status: 'online', metrics: { battery: 0.81 },
  }, { source_kind: 'device', provider: 'firmware-test' });
  const interaction = world.ingest({
    event_id: 'multi-interaction',
    type: 'conversation.input',
    source: 'research-console',
    occurred_at: fixedTime.toISOString(),
    observed_at: fixedTime.toISOString(),
    character_id: 'shaping-001',
    source_kind: 'user',
    confidence: 1,
    provider: 'research-console',
    provenance: { test: true },
    correlation_id: 'multi-turn-001',
    payload: { role: 'user', text: '请观察光域' },
  });

  const state = world.get();
  assert.equal(interaction.applied, true);
  assert.equal(state.world_line.latest_event.event_id, 'line-001');
  assert.equal(state.world_line.current_arc, 'arc-opening');
  assert.equal(state.external_context.items[0].item_id, 'news-001');
  assert.equal(state.weather.snapshot.condition, 'clear');
  assert.equal(state.calendar.date, '2026-09-04T00:00:00.000Z');
  assert.equal(state.user_profile.preferences['conversation.pace'].stable, false);
  assert.equal(state.device_context.devices['deskbot-dev-001'].status, 'online');
  assert.equal(state.interaction.user_turn_count, 1);

  const weatherMutation = world.listMutations().find((item) => item.event_id === 'multi-weather');
  assert.deepEqual(
    {
      source_kind: weatherMutation.source_kind,
      confidence: weatherMutation.confidence,
      provider: weatherMutation.provider,
      provenance: weatherMutation.provenance,
    },
    { source_kind: 'external_provider', confidence: 0.9, provider: 'weather-test', provenance: { test: true } },
  );
});

test('stale weather is audited but does not overwrite the accepted snapshot or revision', () => {
  const world = createWorld();
  world.ingest(mutation('weather-new', 'update_weather', {
    snapshot: { location: '实验室', condition: 'rain', temperature_c: 18, observed_at: '2026-09-04T10:00:00.000Z' },
  }, { observed_at: '2026-09-04T10:00:00.000Z', provider: 'weather-a' }));
  const before = world.get();
  const stale = world.ingest(mutation('weather-old', 'update_weather', {
    snapshot: { location: '实验室', condition: 'clear', temperature_c: 25, observed_at: '2026-09-04T09:00:00.000Z' },
  }, { observed_at: '2026-09-04T09:00:00.000Z', provider: 'weather-b' }));
  const after = world.get();

  assert.equal(stale.applied, true);
  assert.equal(stale.mutation.observation.accepted, false);
  assert.equal(stale.mutation.observation.reason, 'stale_observation');
  assert.equal(after.world_revision, before.world_revision);
  assert.deepEqual(after.weather.snapshot, before.weather.snapshot);
  assert.equal(world.listMutations().length, 2);
});

test('calendar is monotonic and preference stability requires three consistent observations', () => {
  const world = createWorld();
  world.ingest(mutation('calendar-forward', 'advance_calendar', { date: '2026-09-05T00:00:00.000Z' }));
  assert.throws(
    () => world.ingest(mutation('calendar-backward', 'advance_calendar', { date: '2026-09-04T00:00:00.000Z' })),
    (error) => error.code === 'calendar_time_conflict',
  );

  const observe = (eventId) => world.ingest(mutation(eventId, 'observe_user_preference', {
    preference_key: 'display.density', value: 'quiet',
  }, { source_kind: 'user' }));
  assert.equal(observe('pref-1').mutation.details.stable, false);
  assert.equal(observe('pref-2').mutation.details.stable, false);
  assert.equal(observe('pref-3').mutation.details.stable, true);
  assert.equal(world.get().user_profile.preferences['display.density'].observations, 3);
  assert.equal(world.get().user_profile.preferences['display.density'].stable, true);
});

test('NPC positions must be known and the world keeps at most three NPCs', () => {
  const world = createWorld();
  const add = (eventId, npc) => world.ingest(mutation(eventId, 'upsert_npc', { npc }));
  assert.throws(
    () => add('npc-invalid-location', { npc_id: 'npc-invalid', display_name: '无处可去', location_id: 'unknown-location' }),
    (error) => error.code === 'invalid_world_mutation',
  );
  for (let index = 1; index <= 3; index += 1) {
    add(`npc-${index}`, { npc_id: `npc-${index}`, display_name: `NPC ${index}` });
  }
  assert.throws(
    () => add('npc-4', { npc_id: 'npc-4', display_name: '第四个 NPC' }),
    (error) => error.code === 'npc_limit_reached',
  );
  const moved = world.ingest(mutation('npc-action', 'npc_action', {
    npc_id: 'npc-1', action_name: 'approach', location_id: 'shaping-field-desk', status: 'observing',
  }));
  assert.equal(moved.applied, true);
  assert.equal(world.get().npcs.length, 3);
  assert.equal(world.get().npcs[0].last_action, 'approach');
});

test('world schema exposes layers, actions, metadata and invariants for the research client', () => {
  const schema = getWorldSchema();
  assert.equal(schema.schema, 'foundry.canonical-world-schema.v0.1');
  assert.equal(schema.input_layers.length, 7);
  assert.deepEqual(
    schema.input_layers.map((layer) => layer.layer),
    ['world_line', 'external_context', 'weather', 'calendar', 'user_profile', 'device_context', 'interaction'],
  );
  assert.ok(schema.supported_mutations.some((item) => item.action === 'update_weather'));
  assert.ok(schema.supported_mutations.some((item) => item.action === 'record_external_context'));
  assert.ok(schema.invariants.some((item) => item.id === 'weather-freshness'));
  assert.ok(schema.metadata_fields.mutation.includes('provenance'));
});
