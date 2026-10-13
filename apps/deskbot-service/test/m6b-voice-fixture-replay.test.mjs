import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { VoiceSidecarError } from '../src/voice-sidecar-client.mjs';
import {
  createCanonicalReplayCapture,
  createReplayChatProviders,
  exportCanonicalReplayCapture,
  replayServiceCapture,
} from '../src/replay-capture.mjs';

const BASE = new Date('2026-10-14T00:00:00.000Z');

test('standalone voice routes consume private fixtures without provider calls and fail closed', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-voice-fixture-replay-'));
  const databasePath = join(directory, 'source.sqlite');
  const archive = join(directory, 'archive');
  const persistence = createSqlitePersistence({ filename: databasePath, now: () => BASE });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now: () => BASE, codeFingerprint: 'voice-fixture-test' });
  const world = createPersistentWorld({ persistence, now: () => BASE, timeMode: 'realtime', replayCapture: capture });
  let transcribeCalls = 0;
  let ttsCalls = 0;
  const sourceVoice = {
    async transcribe(input) {
      transcribeCalls += 1;
      return { schema: 'voice.asr-result.v0.1', ok: true, request_id: input.request_id,
        correlation_id: input.correlation_id, results: [], done: true, provider: 'fixture-asr' };
    },
    async synthesize(input) {
      ttsCalls += 1;
      const data = Buffer.from('fixture-audio');
      return { schema: 'voice.tts-result.v0.1', ok: true, request_id: input.request_id,
        correlation_id: input.correlation_id, profile: 'fixture', provider: 'fixture-tts',
        audio: { format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 }, encoding: 'base64',
          data_base64: data.toString('base64'), byte_count: data.length, duration_ms: 1,
          audio_id: `audio-${input.request_id}` } };
    },
  };
  const source = createDeskBotServer({ now: () => BASE, persistence, persistentWorld: world,
    replayCapture: capture, voiceClient: sourceVoice, websocket: false,
    worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false });
  await new Promise((resolve, reject) => source.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const sourceBase = `http://127.0.0.1:${source.address().port}`;
  const post = (base, path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  t.after(async () => {
    try { await new Promise(resolve => source.close(() => resolve())); } catch {}
    capture.close(); persistence.close(); rmSync(directory, { recursive: true, force: true });
  });

  const transcribeRequest = { request_id: 'voice-replay-transcribe-001', correlation_id: 'voice-replay-corr-001' };
  const ttsRequest = { request_id: 'voice-replay-tts-001', correlation_id: 'voice-replay-corr-002', text: '喵呜' };
  assert.equal((await post(sourceBase, '/api/voice/transcribe', transcribeRequest)).status, 202);
  assert.equal((await post(sourceBase, '/api/voice/tts', ttsRequest)).status, 202);
  assert.equal(transcribeCalls, 1);
  assert.equal(ttsCalls, 1);

  exportCanonicalReplayCapture({ databasePath, directory: archive, codeFingerprint: 'voice-fixture-test' });
  const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
  const replayProviders = createReplayChatProviders({ tape });
  const replayCalls = { transcribe: 0, tts: 0 };
  const replayVoice = {
    resolveVoice: replayProviders.resolveVoice,
    providerCalls: replayProviders.providerCalls,
  };
  const runtimeFactory = ({ persistence: targetPersistence, now: targetNow, replayProviders: providers }) => {
    const targetWorld = createPersistentWorld({ persistence: targetPersistence, now: targetNow,
      timeMode: 'realtime', timeZone: 'Asia/Shanghai', syncClockOnCreate: false });
    const target = createDeskBotServer({ now: targetNow, persistence: targetPersistence,
      persistentWorld: targetWorld, replayProviders: providers, websocket: false,
      worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false });
    return { replayVoice: target.replayVoice, replayWorker: target.replayWorker, persistentWorld: targetWorld,
      providerCalls: providers.providerCalls, replayStartup: () => target.roleEvolution.syncAll(),
      close: () => { try { target.close(); } catch {} targetPersistence.close(); } };
  };
  // The archive is a complete service entry replay, not merely a fixture
  // consumer: fresh and restart-at-boundary runs must reproduce every
  // non-private namespace while making zero provider calls.
  const fresh = await replayServiceCapture({
    directory: archive, targetDatabase: join(directory, 'voice-fresh.sqlite'), runtimeFactory,
    codeFingerprint: 'voice-fixture-test',
  });
  const restarted = await replayServiceCapture({
    directory: archive, targetDatabase: join(directory, 'voice-restarted.sqlite'), runtimeFactory,
    restartAt: 1, codeFingerprint: 'voice-fixture-test',
  });
  assert.equal(fresh.verified, true);
  assert.equal(fresh.provider_calls, 0);
  assert.deepEqual(restarted.namespace_digests, fresh.namespace_digests);
  const replay = createDeskBotServer({ now: () => BASE, replayProviders: replayVoice, websocket: false,
    worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false });
  await new Promise((resolve, reject) => replay.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const replayBase = `http://127.0.0.1:${replay.address().port}`;
  t.after(async () => { try { await new Promise(resolve => replay.close(() => resolve())); } catch {} });
  const replayTranscribe = await post(replayBase, '/api/voice/transcribe', transcribeRequest);
  assert.equal(replayTranscribe.status, 202);
  const replayTts = await post(replayBase, '/api/voice/tts', ttsRequest);
  assert.equal(replayTts.status, 202);
  assert.equal(replayProviders.providerCalls(), 0);
  assert.equal(replayCalls.transcribe + replayCalls.tts, 0);

  const missing = structuredClone(tape);
  missing.providers = missing.providers.filter(item => item.operation_id !== 'voice.tts:voice-replay-tts-001');
  const missingProviders = createReplayChatProviders({ tape: missing });
  await assert.rejects(
    missingProviders.resolveVoice({ operation_id: 'voice.tts:voice-replay-tts-001', kind: 'tts' }),
    error => error.code === 'replay_provider_fixture_missing:voice.tts:voice-replay-tts-001:voice.tts',
  );

  const tampered = structuredClone(tape);
  const ttsFixture = tampered.providers.find(item => item.operation_id === 'voice.tts:voice-replay-tts-001');
  ttsFixture.ref.fixture.result.audio.data_base64 = Buffer.from('tampered').toString('base64');
  assert.throws(() => createReplayChatProviders({ tape: tampered }), /replay_capture_provider_corrupt/);

  const routeTampered = structuredClone(tape);
  routeTampered.voices[0].result_digest = 'tampered-route-digest';
  writeFileSync(join(archive, 'capture.json'), JSON.stringify(routeTampered));
  await assert.rejects(
    replayServiceCapture({
      directory: archive, targetDatabase: join(directory, 'voice-route-tampered.sqlite'), runtimeFactory,
      codeFingerprint: 'voice-fixture-test',
    }),
    /replay_capture_voice_corrupt/,
  );
  const duplicateRoute = structuredClone(tape);
  duplicateRoute.voices.push(structuredClone(duplicateRoute.voices[0]));
  duplicateRoute.session.voice_count += 1;
  writeFileSync(join(archive, 'capture.json'), JSON.stringify(duplicateRoute));
  await assert.rejects(
    replayServiceCapture({ directory: archive, targetDatabase: join(directory, 'voice-route-duplicate.sqlite'), runtimeFactory,
      codeFingerprint: 'voice-fixture-test' }),
    /replay_capture_voice_corrupt/,
  );
});

test('standalone voice route errors are archived and replayed without provider calls', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-voice-error-replay-'));
  const databasePath = join(directory, 'source.sqlite');
  const archive = join(directory, 'archive');
  const persistence = createSqlitePersistence({ filename: databasePath, now: () => BASE });
  const capture = createCanonicalReplayCapture({ persistence, directory: archive, now: () => BASE, codeFingerprint: 'voice-error-test' });
  const world = createPersistentWorld({ persistence, now: () => BASE, timeMode: 'realtime', replayCapture: capture });
  const source = createDeskBotServer({ now: () => BASE, persistence, persistentWorld: world, replayCapture: capture,
    voiceClient: { async transcribe() { throw new VoiceSidecarError(503, 'transport_error', 'fixture unavailable', { retryable: true }); } },
    websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false });
  await new Promise((resolve, reject) => source.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${source.address().port}`;
  const post = body => fetch(`${base}/api/voice/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  t.after(async () => { try { await new Promise(resolve => source.close(() => resolve())); } catch {} capture.close(); persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = { request_id: 'voice-error-001', correlation_id: 'voice-error-corr-001' };
  assert.equal((await post(request)).status, 503);
  exportCanonicalReplayCapture({ databasePath, directory: archive, codeFingerprint: 'voice-error-test' });
  const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
  assert.equal(tape.voices.length, 1);
  assert.equal(tape.voices[0].status, 'error');
  assert.equal(tape.voices[0].error.code, 'transport_error');
  const replayProviders = createReplayChatProviders({ tape });
  const runtimeFactory = ({ persistence: targetPersistence, now: targetNow, replayProviders: providers }) => {
    const targetWorld = createPersistentWorld({ persistence: targetPersistence, now: targetNow, timeMode: 'realtime', syncClockOnCreate: false });
    const target = createDeskBotServer({ now: targetNow, persistence: targetPersistence, persistentWorld: targetWorld,
      replayProviders: providers, websocket: false, worldLifeEnabled: false, autonomousLifeEnabled: false,
      residentLifeEnabled: false, livedMemoryEnabled: false });
    return { replayVoice: target.replayVoice, replayWorker: target.replayWorker, persistentWorld: targetWorld, providerCalls: providers.providerCalls,
      replayStartup: () => target.roleEvolution.syncAll(), close: () => targetPersistence.close() };
  };
  const replayed = await replayServiceCapture({ directory: archive, targetDatabase: join(directory, 'replayed.sqlite'), runtimeFactory, codeFingerprint: 'voice-error-test' });
  assert.equal(replayed.verified, true);
  assert.equal(replayed.provider_calls, 0);
});
