import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-10-14T00:00:00.000Z');

test('voice HTTP side-effect routes enter stable M6b operation contexts', async (t) => {
  const operations = [];
  const providerRefs = [];
  const replayCapture = {
    withOperation(context, callback) {
      operations.push(structuredClone(context));
      return callback();
    },
    setOperationResultRef(ref) {
      providerRefs.push(structuredClone(ref));
      return ref;
    },
  };
  const voiceClient = {
    async transcribe(input) {
      return { schema: 'voice.asr-result.v0.1', ok: true, request_id: input.request_id,
        correlation_id: input.correlation_id, results: [], done: true };
    },
    async synthesize(input) {
      return { request_id: input.request_id, correlation_id: input.correlation_id,
        profile: 'm6b-test', audio: { format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
          encoding: 'base64', data_base64: Buffer.from('m6b').toString('base64'), byte_count: 3,
          duration_ms: 1, audio_id: `audio-${input.request_id}` } };
    },
    async cancel(input) { return { cancelled: true, request_id: input.request_id }; },
  };
  const server = createDeskBotServer({ now: () => fixedTime, voiceClient, replayCapture, websocket: false });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  t.after(() => new Promise(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const asr = await post('/api/voice/asr', { request_id: 'asr-route-001', correlation_id: 'voice-route-001',
    utterance_id: 'utt-route-001', stage: 'partial', raw_utterance: '嗯', clean_utterance: '嗯' });
  assert.equal(asr.status, 202);
  const transcribe = await post('/api/voice/transcribe', { request_id: 'transcribe-route-001', correlation_id: 'voice-route-002' });
  assert.equal(transcribe.status, 202);
  const tts = await post('/api/voice/tts', { request_id: 'tts-route-001', correlation_id: 'voice-route-003', text: '喵呜' });
  assert.equal(tts.status, 202);
  const cancel = await post('/api/voice/cancel', { request_id: 'cancel-route-001', correlation_id: 'voice-route-004' });
  assert.equal(cancel.status, 200);

  assert.deepEqual(operations.filter(operation => operation.route_id?.startsWith('voice.')).map(operation => ({ id: operation.operation_id, kind: operation.operation_kind, route: operation.route_id })), [
    { id: 'voice.asr:asr-route-001', kind: 'voice.asr', route: 'voice.asr' },
    { id: 'voice.transcribe:transcribe-route-001', kind: 'voice.transcribe', route: 'voice.transcribe' },
    { id: 'voice.tts:tts-route-001', kind: 'voice.tts', route: 'voice.tts' },
    { id: 'voice.cancel:cancel-route-001', kind: 'voice.cancel', route: 'voice.cancel' },
  ]);
  assert.deepEqual(providerRefs.map(ref => ref.purpose), ['voice.transcribe', 'voice.tts']);
});
