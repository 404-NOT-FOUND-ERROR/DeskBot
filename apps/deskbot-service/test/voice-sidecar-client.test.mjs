import assert from 'node:assert/strict';
import { test } from 'node:test';

import { VoiceSidecarError, createVoiceSidecarClient } from '../src/voice-sidecar-client.mjs';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(call) {
  return JSON.parse(call.init.body);
}

test('ASR sends canonical IDs/audio fields and normalizes a flat sidecar result', async () => {
  const calls = [];
  const client = createVoiceSidecarClient({
    baseUrl: 'http://sidecar.test:4320/',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        schema: 'voice.asr-result.v0.1',
        ok: true,
        request_id: 'asr-001',
        correlation_id: 'turn-001',
        utterance_id: 'utt-001',
        stream_id: 'stream-001',
        stage: 'final',
        is_final: true,
        raw_utterance: '  你好，世界  ',
        clean_utterance: '你好，世界',
        confidence: 0.97,
        provider: 'fake',
        model: 'identity-text-v0',
      });
    },
  });

  const result = await client.transcribe({
    request_id: 'asr-001',
    correlation_id: 'turn-001',
    utterance_id: 'utt-001',
    stream_id: 'stream-001',
    raw_utterance: '  你好，世界  ',
    stage: 'final',
    audio: Uint8Array.from([1, 2, 3]),
    format: { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 },
    character_id: 'ember-001',
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://sidecar.test:4320/v1/asr');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-correlation-id'], 'turn-001');
  const body = requestBody(calls[0]);
  assert.equal(body.request_id, 'asr-001');
  assert.equal(body.correlation_id, 'turn-001');
  assert.equal(body.audio_b64, 'AQID');
  assert.deepEqual(body.format, { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 });
  assert.equal(result.results[0].text, '你好，世界');
  assert.equal(result.results[0].raw_utterance, '  你好，世界  ');
  assert.equal(result.results[0].is_final, true);
  assert.equal(result.done, true);
});

test('TTS accepts the Python sidecar audio_b64 plus nested format and remains audio-store compatible', async () => {
  let call;
  const client = createVoiceSidecarClient({
    baseUrl: 'http://127.0.0.1:4320',
    fetchImpl: async (url, init) => {
      call = { url, init };
      return jsonResponse({
        schema: 'voice.tts-result.v0.1',
        ok: true,
        request_id: 'tts-001',
        correlation_id: 'turn-001',
        profile: 'ember',
        stream_id: 'tts-stream-001',
        audio: {
          format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
          mime_type: 'audio/wav',
          encoding: 'base64',
          byte_count: 3,
          duration_ms: 120,
          sha256: 'digest',
        },
        audio_b64: 'AQID',
        audio_ref: 'memory://voice-sidecar/tts-001.wav',
      });
    },
  });

  const result = await client.synthesize({
    request_id: 'tts-001',
    correlation_id: 'turn-001',
    text: '你好',
    profile_id: 'ember',
    format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });

  const body = requestBody(call);
  assert.equal(call.url, 'http://127.0.0.1:4320/v1/tts');
  assert.equal(body.profile, 'ember');
  assert.deepEqual(body.audio_format, body.format);
  assert.deepEqual(result.audio.format, { codec: 'wav', sample_rate_hz: 16_000, channels: 1 });
  assert.equal(result.audio.data_base64, 'AQID');
  assert.equal(result.audio.codec, 'wav');
  assert.equal(result.audio.byte_count, 3);
  assert.equal(result.audio.content_type, 'audio/wav');
  assert.equal(result.audio.mime_type, 'audio/wav');
  assert.equal(result.audio_ref, 'memory://voice-sidecar/tts-001.wav');
});

test('per-call timeout and caller AbortSignal produce distinct structured errors', async () => {
  const neverRespond = async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const client = createVoiceSidecarClient({ fetchImpl: neverRespond, timeoutMs: 1_000 });

  await assert.rejects(
    () => client.synthesize({ correlation_id: 'timeout-turn', text: '迟到' }, { timeoutMs: 15 }),
    (error) => error instanceof VoiceSidecarError
      && error.code === 'timeout'
      && error.statusCode === 408
      && error.retryable === true
      && error.correlation_id === 'timeout-turn',
  );

  const controller = new AbortController();
  const pending = client.synthesize({ correlation_id: 'cancel-turn', text: '取消' }, {
    timeoutMs: 1_000,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(
    () => pending,
    (error) => error instanceof VoiceSidecarError
      && error.code === 'cancelled'
      && error.statusCode === 499
      && error.retryable === false
      && error.correlation_id === 'cancel-turn',
  );
});

test('HTTP and transport failures retain stable codes without echoing response bodies', async () => {
  const httpClient = createVoiceSidecarClient({
    fetchImpl: async () => jsonResponse({
      schema: 'voice.error.v0.1',
      request_id: 'tts-fail',
      correlation_id: 'turn-fail',
      error: {
        code: 'model_unavailable',
        message: 'model is unavailable',
        details: { retry_after_ms: 50 },
      },
    }, 503),
  });
  await assert.rejects(
    () => httpClient.synthesize({ request_id: 'tts-fail', correlation_id: 'turn-fail', text: '测试' }),
    (error) => error instanceof VoiceSidecarError
      && error.code === 'model_unavailable'
      && error.statusCode === 503
      && error.retryable === true
      && error.details.retry_after_ms === 50
      && !error.message.includes('response body'),
  );

  const transportClient = createVoiceSidecarClient({
    fetchImpl: async () => { throw new Error('private upstream body and secret'); },
  });
  await assert.rejects(
    () => transportClient.health(),
    (error) => error instanceof VoiceSidecarError
      && error.code === 'transport_error'
      && error.statusCode === 503
      && !error.message.includes('private upstream body')
      && !error.message.includes('secret'),
  );
});

test('cancellation uses an encoded request path and supports correlation-only cancellation', async () => {
  const calls = [];
  const client = createVoiceSidecarClient({
    baseUrl: 'http://sidecar.test',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        schema: 'voice.cancel.v0.1',
        ok: true,
        accepted: true,
        request_id: 'job/a',
        correlation_id: 'turn-1',
        cancelled: true,
        request_ids: ['job/a'],
      });
    },
  });

  const byRequest = await client.cancel({ request_id: 'job/a', correlation_id: 'turn-1' });
  const byCorrelation = await client.cancel({ correlation_id: 'turn-1' });
  assert.equal(calls[0].url, 'http://sidecar.test/v1/jobs/job%2Fa/cancel');
  assert.equal(calls[1].url, 'http://sidecar.test/v1/cancel');
  assert.equal(JSON.parse(calls[1].init.body).correlation_id, 'turn-1');
  assert.equal(byRequest.cancelled, true);
  assert.deepEqual(byCorrelation.request_ids, ['job/a']);
});

test('health and capabilities use configurable GET requests', async () => {
  const paths = [];
  const client = createVoiceSidecarClient({
    baseUrl: 'http://sidecar.test/root',
    fetchImpl: async (url, init) => {
      paths.push([url, init]);
      return jsonResponse({ status: 'ok', capabilities: { asr: { available: true } } });
    },
  });
  const health = await client.health({ timeoutMs: 100 });
  const capabilities = await client.capabilities({ timeout_ms: 100 });
  assert.equal(paths[0][0], 'http://sidecar.test/root/health');
  assert.equal(paths[1][0], 'http://sidecar.test/root/capabilities');
  assert.equal(paths[0][1].method, 'GET');
  assert.equal(health.status, 'ok');
  assert.equal(capabilities.capabilities.asr.available, true);
});

test('validation and malformed success responses fail locally with structured errors', async () => {
  const client = createVoiceSidecarClient({ fetchImpl: async () => jsonResponse({ ok: true }) });
  await assert.rejects(
    () => client.transcribe({ text: 'missing correlation' }),
    (error) => error instanceof VoiceSidecarError && error.code === 'invalid_request' && error.statusCode === 400,
  );
  await assert.rejects(
    () => client.cancel({}),
    (error) => error instanceof VoiceSidecarError && error.code === 'invalid_request',
  );
  await assert.rejects(
    () => client.synthesize({ correlation_id: 'bad-tts', text: 'bad response' }),
    (error) => error instanceof VoiceSidecarError && error.code === 'invalid_response' && error.statusCode === 502,
  );
  assert.throws(
    () => createVoiceSidecarClient({ baseUrl: 'file:///tmp/sidecar', fetchImpl: async () => jsonResponse({}) }),
    /HTTP\(S\) URL/,
  );
});

