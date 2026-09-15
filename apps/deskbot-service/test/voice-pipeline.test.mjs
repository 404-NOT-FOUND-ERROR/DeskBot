import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');
const ttsBytes = Buffer.from('RIFFfake-audio');
const ttsBase64 = ttsBytes.toString('base64');

const voiceClient = {
  async transcribe(input) {
    return {
      schema: 'voice.asr-result.v0.1',
      ok: true,
      request_id: input.request_id ?? 'asr-pipeline-001',
      correlation_id: input.correlation_id,
      utterance_id: input.utterance_id ?? 'utt-pipeline-001',
      stream_id: input.stream_id ?? input.utterance_id ?? 'utt-pipeline-001',
      results: [
        {
          stage: input.stage ?? 'final',
          is_final: (input.stage ?? 'final') === 'final',
          raw_utterance: '  我今天很开心  ',
          clean_utterance: '我今天很开心',
          text: '我今天很开心',
          confidence: 0.96,
        },
      ],
      done: (input.stage ?? 'final') === 'final',
    };
  },
  async synthesize(input) {
    return {
      schema: 'voice.tts-result.v0.1',
      ok: true,
      request_id: input.request_id,
      correlation_id: input.correlation_id,
      profile: input.profile ?? 'ember-neutral',
      stream_id: `stream-${input.request_id}`,
      audio_ref: `memory://test/${input.request_id}.wav`,
      audio: {
        format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
        codec: 'wav',
        sample_rate_hz: 16_000,
        channels: 1,
        encoding: 'base64',
        data_base64: ttsBase64,
        byte_count: ttsBytes.byteLength,
        duration_ms: 240,
        audio_id: `audio-${input.request_id}`,
      },
    };
  },
  async health() { return { status: 'ok' }; },
  async capabilities() { return { status: 'ok', capabilities: { asr: {}, tts: {} } }; },
  async cancel() { return { cancelled: true }; },
};

const server = createDeskBotServer({ now: () => fixedTime, voiceClient });
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

test('voice pipeline keeps ASR transport read-only and routes final reply to audio', async () => {
  const partialResponse = await post('/api/voice/transcribe', {
    request_id: 'asr-pipeline-partial',
    correlation_id: 'voice-pipeline-001',
    utterance_id: 'utt-pipeline-001',
    stage: 'partial',
    text: '我今天很',
    character_id: 'ember-001',
    device_id: 'vocat-pipeline-001',
  });
  const partialBody = await partialResponse.json();
  assert.equal(partialResponse.status, 202);
  assert.equal(partialBody.ingested[0].event.type, 'voice.asr.partial');
  assert.equal(partialBody.ingested[0].turn, null);

  const finalResponse = await post('/api/voice/transcribe', {
    request_id: 'asr-pipeline-final',
    correlation_id: 'voice-pipeline-001',
    utterance_id: 'utt-pipeline-001',
    stage: 'final',
    text: '我今天很开心',
    character_id: 'ember-001',
    device_id: 'vocat-pipeline-001',
  });
  const finalBody = await finalResponse.json();
  assert.equal(finalResponse.status, 202);
  const finalIngest = finalBody.ingested[0];
  assert.equal(finalIngest.event.type, 'voice.asr.final');
  assert.equal(finalIngest.event.payload.raw_utterance, '  我今天很开心  ');
  assert.equal(finalIngest.event.payload.clean_utterance, '我今天很开心');
  assert.ok(finalIngest.turn);
  assert.equal(finalIngest.turn.input_event.payload.text, '我今天很开心');
  assert.equal(finalIngest.turn.input_event.correlation_id, 'voice-pipeline-001');
  assert.equal(finalIngest.turn.voice.audio_id, 'audio-tts-voice-chat-utt-pipeline-001');
  const render = finalIngest.turn.output_plan.find((item) => item.type === 'render.expression');
  const audio = finalIngest.turn.output_plan.find((item) => item.type === 'audio.play');
  assert.equal(audio.payload.audio_id, 'audio-tts-voice-chat-utt-pipeline-001');
  assert.deepEqual(audio.payload.expression_intent, render.expression_intent);

  const worldResponse = await fetch(`${baseUrl}/api/world/state`);
  const worldBody = await worldResponse.json();
  assert.equal(worldBody.world.interaction.user_turn_count, 1);

  const audioResponse = await fetch(`${baseUrl}${finalIngest.turn.voice.audio_ref}`);
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers.get('x-audio-id'), finalIngest.turn.voice.audio_id);
  assert.equal(audioResponse.headers.get('x-audio-codec'), 'wav');
  assert.equal(audioResponse.headers.get('x-audio-sample-rate-hz'), '16000');
  assert.equal(audioResponse.headers.get('x-audio-channels'), '1');
  assert.equal(audioResponse.headers.get('x-audio-sha256')?.length, 64);
  assert.equal(audioResponse.headers.get('content-type'), 'audio/wav');
  assert.equal(Buffer.from(await audioResponse.arrayBuffer()).toString(), ttsBytes.toString());

  const duplicateResponse = await post('/api/voice/transcribe', {
    request_id: 'asr-pipeline-final',
    correlation_id: 'voice-pipeline-001',
    utterance_id: 'utt-pipeline-001',
    stage: 'final',
    text: '我今天很开心',
    character_id: 'ember-001',
    device_id: 'vocat-pipeline-001',
  });
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicateBody.ingested[0].duplicate, true);
  const worldAfterDuplicate = await (await fetch(`${baseUrl}/api/world/state`)).json();
  assert.equal(worldAfterDuplicate.world.interaction.user_turn_count, 1);
});

test('empty ASR result is retained as an observation without creating a chat turn', async () => {
  const emptyVoiceClient = {
    async transcribe(input) {
      return {
        schema: 'voice.asr-result.v0.1',
        ok: true,
        request_id: input.request_id,
        correlation_id: input.correlation_id,
        results: [{
          stage: 'final',
          raw_utterance: '',
          clean_utterance: '',
          text: '',
          confidence: 0.2,
        }],
      };
    },
  };
  const emptyServer = createDeskBotServer({ now: () => fixedTime, voiceClient: emptyVoiceClient });
  await new Promise((resolve, reject) => emptyServer.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${emptyServer.address().port}`;
  try {
    const response = await fetch(`${url}/api/voice/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        request_id: 'asr-empty-001',
        correlation_id: 'voice-empty-001',
        utterance_id: 'utt-empty-001',
        character_id: 'ember-001',
      }),
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.equal(body.ingested.length, 1);
    assert.equal(body.ingested[0].empty_transcript, true);
    assert.equal(body.ingested[0].turn, null);
    assert.equal(body.ingested[0].event.payload.raw_utterance, '');
    assert.equal(body.ingested[0].event.payload.clean_utterance, '');
    const world = await (await fetch(`${url}/api/world/state`)).json();
    assert.equal(world.world.interaction.user_turn_count, 0);
  } finally {
    await new Promise((resolve, reject) => emptyServer.close((error) => (error ? reject(error) : resolve())));
  }
});

test('an explicit empty result list without transcript fields is not ingested', async () => {
  const noSegmentVoiceClient = {
    async transcribe(input) {
      return {
        schema: 'voice.asr-result.v0.1',
        ok: true,
        request_id: input.request_id,
        correlation_id: input.correlation_id,
        results: [],
        done: true,
      };
    },
  };
  const noSegmentServer = createDeskBotServer({ now: () => fixedTime, voiceClient: noSegmentVoiceClient });
  await new Promise((resolve, reject) => noSegmentServer.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${noSegmentServer.address().port}`;
  try {
    const response = await fetch(`${url}/api/voice/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ request_id: 'asr-none-001', correlation_id: 'voice-none-001' }),
    });
    const body = await response.json();
    assert.equal(response.status, 202);
    assert.deepEqual(body.ingested, []);
    assert.equal(body.sidecar.results.length, 0);
  } finally {
    await new Promise((resolve, reject) => noSegmentServer.close((error) => (error ? reject(error) : resolve())));
  }
});

test('voice routes return a clear unavailable response without a sidecar', async () => {
  const noVoiceServer = createDeskBotServer({ now: () => fixedTime });
  await new Promise((resolve, reject) => noVoiceServer.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
  const url = `http://127.0.0.1:${noVoiceServer.address().port}`;
  try {
    const response = await fetch(`${url}/api/voice/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ correlation_id: 'no-sidecar', text: '测试' }),
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error.code, 'voice_sidecar_not_configured');
  } finally {
    await new Promise((resolve, reject) => noVoiceServer.close((error) => (error ? reject(error) : resolve())));
  }
});
