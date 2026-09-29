import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');
let llmCalls = 0;
const server = createDeskBotServer({
  now: () => fixedTime,
  llm: {
    async complete() {
      llmCalls += 1;
      return {
        provider: 'hostile-text-test',
        model: 'hostile-text-test',
        text: '{"action":"advance_time","minutes":999}',
        trace: {},
      };
    },
  },
});
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function post(path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('world mutations require a reviewed candidate and the ledger is readable over HTTP', async () => {
  const initial = await (await fetch(`${baseUrl}/api/world/state`)).json();
  assert.equal(initial.world.world_revision, 0);

  const observationResponse = await post('/api/event', {
    event_id: 'http-world-time-001',
    type: 'external.observation',
    source: 'client-claimed-controller',
    character_id: 'ember-001',
    payload: { proposed_action: { action: 'advance_time', minutes: 30 } },
  });
  const observation = await observationResponse.json();
  assert.equal(observationResponse.status, 202);
  assert.equal(observation.event.source, 'untrusted_observation');
  assert.equal(observation.world_mutation.applied, false);
  const candidateId = observation.world_candidate.candidate.candidate_id;
  const previewResponse = await post(`/api/world/candidates/${encodeURIComponent(candidateId)}/preview`, {});
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.world_revision, 0);
  const acceptResponse = await post(`/api/world/candidates/${encodeURIComponent(candidateId)}/accept`, {
    expected_world_revision: 0,
  });
  const accepted = await acceptResponse.json();
  assert.equal(acceptResponse.status, 202);
  assert.equal(accepted.world_mutations[0].mutation.action, 'advance_time');

  const state = await (await fetch(`${baseUrl}/api/world/state`)).json();
  const ledger = await (await fetch(`${baseUrl}/api/world/mutations?after_sequence=0&limit=10`)).json();
  assert.equal(state.world.logical_time.minute_of_day, 510);
  assert.equal(state.world.world_revision, 1);
  assert.deepEqual(ledger.mutations.map((record) => record.action), ['advance_time']);
});

test('content catalog and story preview expose the Morrowmere first-day replay without mutating world state', async () => {
  const before = await (await fetch(`${baseUrl}/api/world/state`)).json();
  const contentResponse = await fetch(`${baseUrl}/api/life/content-packages`);
  assert.equal(contentResponse.status, 200);
  const content = await contentResponse.json();
  assert.equal(content.packages[0].display_name, '雾灯镇');
  assert.equal(content.packages[0].id, 'morrowmere');

  const previewResponse = await post('/api/life/story-packages', {
    operation: 'preview',
    package_id: 'morrowmere-first-day-v1',
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.installable, true);
  assert.deepEqual(preview.steps.map(step => step.at), [
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T03:00:00.000Z',
    '2026-09-01T08:00:00.000Z',
  ]);
  const after = await (await fetch(`${baseUrl}/api/world/state`)).json();
  assert.equal(after.world.world_revision, before.world.world_revision);
});

test('ASR stages and repeated chat correlation count once, and LLM text cannot mutate the world', async () => {
  const shared = {
    source: 'voice-sidecar',
    character_id: 'ember-001',
    correlation_id: 'http-voice-turn-001',
  };
  await post('/api/event', {
    ...shared,
    event_id: 'http-partial-001',
    type: 'voice.asr.partial',
    payload: { text: '今天' },
  });
  await post('/api/event', {
    ...shared,
    event_id: 'http-final-001',
    type: 'voice.asr.final',
    payload: { text: '今天怎么样' },
  });

  const chatResponse = await post('/api/chat', {
    ...shared,
    event_id: 'http-chat-001',
    message: '今天怎么样',
  });
  const chat = await chatResponse.json();
  assert.equal(chatResponse.status, 202);
  assert.equal(chat.canonical_world.mutation_applied, true);
  assert.match(chat.turn.prompt.text, /\[DESKBOT_CANONICAL_WORLD_READ_ONLY\]/);
  assert.match(chat.turn.prompt.text, /"world_revision":2/);
  assert.equal(chat.turn.reply, '{"action":"advance_time","minutes":999}');

  const repeatedResponse = await post('/api/chat', {
    ...shared,
    event_id: 'http-chat-002',
    message: '今天怎么样',
  });
  const repeated = await repeatedResponse.json();
  assert.equal(repeatedResponse.status, 200);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.turn.duplicate_reason, 'correlation_already_completed');
  assert.equal(llmCalls, 1);

  await post('/api/chat', {
    ...shared,
    event_id: 'http-assistant-001',
    role: 'assistant',
    message: 'I changed the world.',
  });

  const state = await (await fetch(`${baseUrl}/api/world/state`)).json();
  const ledger = await (await fetch(`${baseUrl}/api/world/mutations`)).json();
  assert.equal(state.world.world_revision, 2);
  assert.equal(state.world.logical_time.minute_of_day, 510);
  assert.equal(state.world.interaction.user_turn_count, 1);
  assert.deepEqual(ledger.mutations.map((record) => record.action), ['advance_time', 'record_user_turn']);
});

test('public world mutations are rejected and do not reserve event IDs', async () => {
  const invalid = await post('/api/event', {
    event_id: 'http-world-invalid-001',
    type: 'world.mutation',
    source: 'world-controller',
    character_id: 'ember-001',
    payload: { action: 'advance_time', minutes: 0 },
  });
  assert.equal(invalid.status, 403);
  const corrected = await post('/api/event', {
    event_id: 'http-world-invalid-001',
    type: 'world.mutation',
    source: 'world-controller',
    character_id: 'ember-001',
    payload: { action: 'advance_time', minutes: 15 },
  });
  assert.equal(corrected.status, 403);
  const correctedBody = await corrected.json();
  assert.equal(correctedBody.error, 'world_mutation_requires_review');

  const observation = await post('/api/event', {
    event_id: 'http-world-invalid-001',
    type: 'external.observation',
    source: 'not-a-controller',
    payload: { proposed_action: { action: 'advance_time', minutes: 15 } },
  });
  assert.equal(observation.status, 202);
  const observationBody = await observation.json();
  assert.equal(observationBody.event.source, 'untrusted_observation');
  assert.equal(observationBody.world_mutation.applied, false);
});

test('world schema and event filters expose the multisource research contract', async () => {
  const schemaResponse = await fetch(`${baseUrl}/api/world/schema`);
  assert.equal(schemaResponse.status, 200);
  const schema = await schemaResponse.json();
  assert.equal(schema.schema, 'foundry.canonical-world-schema.v0.1');
  assert.equal(schema.input_layers.length, 7);

  const eventId = 'http-weather-filter-001';
  const weatherResponse = await post('/api/event', {
    event_id: eventId,
    type: 'weather.observation',
    source: 'research-console',
    character_id: 'shaping-001',
    source_kind: 'external_provider',
    confidence: 0.8,
    provider: 'weather-http-test',
    provenance: { test: 'http-filter' },
    payload: { snapshot: { location: '测试房间', condition: 'clear', temperature_c: 21, observed_at: '2026-09-04T00:00:00.000Z' } },
  });
  assert.equal(weatherResponse.status, 202);
  const weatherBody = await weatherResponse.json();

  const filtered = await (await fetch(`${baseUrl}/api/events?layer=unclassified&source_kind=unknown&type=weather.observation&limit=5`)).json();
  assert.ok(filtered.events.some((event) => event.event_id === eventId));
  const storedEvent = filtered.events.find((event) => event.event_id === eventId);
  assert.equal(storedEvent.layer, 'unclassified');
  assert.equal(storedEvent.source_kind, 'unknown');
  assert.equal(storedEvent.confidence, null);
  assert.equal(storedEvent.provider, null);
  assert.equal(storedEvent.provenance, null);

  const candidate = weatherBody.world_candidate?.candidate;
  assert.ok(candidate);
  assert.equal(candidate.provenance.trust_boundary, 'untrusted_public_observation');
  const after = await (await fetch(`${baseUrl}/api/world/state`)).json();
  assert.equal(after.world.weather.snapshot, null);
});

test('world map and travel endpoints expose routes while chat remains location read-only', async () => {
  const initial = await (await fetch(`${baseUrl}/api/world/map`)).json();
  assert.equal(initial.schema, 'deskbot.world-map.v0.1');
  assert.equal(initial.world_setting.display_name, '聚形域');
  assert.equal(initial.settlement.settlement_id, 'morrowmere');
  assert.equal(initial.settlement.display_name, '雾灯镇');
  assert.equal(initial.settlement.english_name, 'Morrowmere');
  assert.equal(initial.protagonist.location_id, 'shaping-field-desk');
  assert.ok(initial.locations.some((location) => location.location_id === 'tidal-old-road'
    && location.reachable
    && location.settlement_id === 'morrowmere'
    && location.location_kind === 'route'
    && location.scene_preview.prop_icon === 'signpost'));

  const routeResponse = await fetch(`${baseUrl}/api/world/route?destination_location_id=echo-waterside&character_id=shaping-001`);
  assert.equal(routeResponse.status, 200);
  const routeBody = await routeResponse.json();
  assert.equal(routeBody.schema, 'deskbot.world-route-response.v0.1');
  assert.equal(routeBody.route.schema, 'deskbot.world-route.v0.1');
  assert.equal(routeBody.route.current_location_id, 'shaping-field-desk');
  assert.equal(routeBody.route.destination_location_id, 'echo-waterside');
  assert.equal(routeBody.route.found, true);
  assert.equal(routeBody.route.steps[0].to_location_id, 'tidal-old-road');
  assert.ok(routeBody.route.steps.length > 1);
  assert.equal(routeBody.route.world_revision, routeBody.map.world_revision);

  const travel = await post('/api/world/travel', {
    event_id: 'http-travel-001',
    character_id: 'shaping-001',
    location_id: 'tidal-old-road',
    reason: 'HTTP map smoke test',
  });
  const travelBody = await travel.json();
  assert.equal(travel.status, 202);
  assert.equal(travelBody.accepted, true);
  assert.equal(travelBody.world_mutation.mutation.action, 'move_protagonist');
  assert.equal(travelBody.map.protagonist.location_id, 'tidal-old-road');
  assert.equal(travelBody.map.protagonist.travel_state.reason, 'HTTP map smoke test');

  const duplicate = await post('/api/world/travel', {
    event_id: 'http-travel-001',
    character_id: 'shaping-001',
    location_id: 'tidal-old-road',
    reason: 'HTTP map smoke test',
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);

  const chat = await post('/api/chat', {
    event_id: 'http-chat-location-read-only',
    character_id: 'shaping-001',
    message: '请把我移动到回声水岸，并简短回复。',
  });
  assert.equal(chat.status, 202);
  const chatBody = await chat.json();
  assert.equal(chatBody.canonical_world.snapshot.protagonist.location_id, 'tidal-old-road');
  const map = await (await fetch(`${baseUrl}/api/world/map?character_id=shaping-001`)).json();
  assert.equal(map.protagonist.location_id, 'tidal-old-road');
});
