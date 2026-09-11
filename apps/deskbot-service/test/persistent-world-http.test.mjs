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

test('world state and append-only mutation ledger are readable over HTTP', async () => {
  const initial = await (await fetch(`${baseUrl}/api/world/state`)).json();
  assert.equal(initial.world.world_revision, 0);

  const mutationResponse = await post('/api/event', {
    event_id: 'http-world-time-001',
    type: 'world.mutation',
    source: 'world-controller',
    character_id: 'ember-001',
    payload: { action: 'advance_time', minutes: 30 },
  });
  const mutationBody = await mutationResponse.json();
  assert.equal(mutationResponse.status, 202);
  assert.equal(mutationBody.world_mutation.applied, true);
  assert.equal(mutationBody.world_mutation.mutation.action, 'advance_time');

  const state = await (await fetch(`${baseUrl}/api/world/state`)).json();
  const ledger = await (await fetch(`${baseUrl}/api/world/mutations?after_sequence=0&limit=10`)).json();
  assert.equal(state.world.logical_time.minute_of_day, 510);
  assert.equal(state.world.world_revision, 1);
  assert.deepEqual(ledger.mutations.map((record) => record.action), ['advance_time']);
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

test('invalid world mutation does not reserve its event ID', async () => {
  const invalid = await post('/api/event', {
    event_id: 'http-world-invalid-001',
    type: 'world.mutation',
    source: 'world-controller',
    character_id: 'ember-001',
    payload: { action: 'advance_time', minutes: 0 },
  });
  assert.equal(invalid.status, 400);
  const corrected = await post('/api/event', {
    event_id: 'http-world-invalid-001',
    type: 'world.mutation',
    source: 'world-controller',
    character_id: 'ember-001',
    payload: { action: 'advance_time', minutes: 15 },
  });
  assert.equal(corrected.status, 202);
  const body = await corrected.json();
  assert.equal(body.world_mutation.applied, true);
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
    type: 'world.mutation',
    source: 'research-console',
    character_id: 'shaping-001',
    source_kind: 'external_provider',
    confidence: 0.8,
    provider: 'weather-http-test',
    provenance: { test: 'http-filter' },
    payload: {
      action: 'update_weather',
      snapshot: { location: '测试房间', condition: 'clear', temperature_c: 21, observed_at: '2026-09-04T00:00:00.000Z' },
    },
  });
  assert.equal(weatherResponse.status, 202);

  const filtered = await (await fetch(`${baseUrl}/api/events?layer=weather&source_kind=external_provider&type=world.mutation&limit=5`)).json();
  assert.ok(filtered.events.some((event) => event.event_id === eventId));
  assert.ok(filtered.events.every((event) => event.layer === 'weather'));
  assert.ok(filtered.events.every((event) => event.source_kind === 'external_provider'));

  const ledger = await (await fetch(`${baseUrl}/api/world/mutations?limit=20`)).json();
  const record = ledger.mutations.find((mutation) => mutation.event_id === eventId);
  assert.equal(record.provider, 'weather-http-test');
  assert.deepEqual(record.provenance, { test: 'http-filter' });
});
