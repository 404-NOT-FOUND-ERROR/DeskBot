import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { FakeDeviceError, createFakeDevice } from '../src/fake-device.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');
const server = createDeskBotServer({ now: () => fixedTime });
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

test('fake device completes its target commands exactly once', async () => {
  const device = createFakeDevice({ baseUrl, deviceId: 'fake-vocat-001' });
  const hello = await device.hello();
  assert.equal(hello.accepted, true);

  const turnResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'turn-fake-device-001',
      character_id: 'ember-001',
      device_id: 'fake-vocat-001',
      message: '我今天很开心',
    }),
  });
  assert.equal(turnResponse.status, 202);

  const firstPoll = await device.pollOnce();
  assert.equal(firstPoll.fetched, 2);
  assert.equal(device.executed().length, 2);
  assert.deepEqual(device.executed().map((item) => item.type), ['render.expression', 'speak']);

  const secondPoll = await device.pollOnce();
  assert.equal(secondPoll.fetched, 0);
  assert.equal(device.executed().length, 2);
});

function artifactResponse(bytes, {
  audioId = 'audio-001',
  codec = 'wav',
  sampleRate = 16_000,
  channels = 1,
  status = 200,
} = {}) {
  return new Response(bytes, {
    status,
    headers: {
      'content-type': codec === 'wav' ? 'audio/wav' : 'application/octet-stream',
      'x-audio-id': audioId,
      'x-audio-codec': codec,
      'x-audio-sample-rate-hz': String(sampleRate),
      'x-audio-channels': String(channels),
    },
  });
}

function commandResponse(command) {
  return new Response(JSON.stringify({ commands: [command] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function ackResponse(command) {
  return new Response(JSON.stringify({ accepted: true, duplicate: false, command }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function audioCommand(payload) {
  return {
    command_id: 'cmd-audio-001',
    type: 'audio.play',
    payload,
  };
}

function fakeAudioFetch({ command, artifactBytes, artifactOptions = {}, onAck = () => {} }) {
  return async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/outbox') return commandResponse(command);
    if (parsed.pathname === '/api/audio/audio-001') return artifactResponse(artifactBytes, artifactOptions);
    if (parsed.pathname === '/api/outbox/cmd-audio-001/ack') {
      onAck(JSON.parse(init.body));
      return ackResponse({ ...command, status: 'completed' });
    }
    if (parsed.pathname === '/api/devices/hello') {
      return new Response(JSON.stringify({ accepted: true }), { status: 201 });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  };
}

test('fake device fetches same-origin audio.play artifact and verifies bytes, hash, and format before ACK', async () => {
  const bytes = Buffer.from('verified-audio');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ackBodies = [];
  const command = audioCommand({
    audio_id: 'audio-001',
    audio_ref: '/api/audio/audio-001',
    byte_count: bytes.byteLength,
    sha256,
    format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });
  const device = createFakeDevice({
    baseUrl: 'http://device.test/',
    deviceId: 'fake-audio-001',
    fetchImpl: fakeAudioFetch({ command, artifactBytes: bytes, onAck: (body) => ackBodies.push(body) }),
  });

  const result = await device.pollOnce();
  const executed = device.executed();
  assert.equal(result.fetched, 1);
  assert.equal(ackBodies.length, 1);
  assert.equal(ackBodies[0].status, 'completed');
  assert.equal(executed.length, 1);
  assert.equal(executed[0].type, 'audio.play');
  assert.deepEqual(executed[0].audio, {
    audio_id: 'audio-001',
    audio_ref: '/api/audio/audio-001',
    byte_count: bytes.byteLength,
    sha256,
    format_verified: true,
    format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });
});

test('fake device reports a deterministic corrupt audio artifact as a failed ACK', async () => {
  const bytes = Buffer.from('correct-audio');
  const command = audioCommand({
    audio_id: 'audio-001',
    audio_ref: '/api/audio/audio-001',
    byte_count: bytes.byteLength + 1,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });
  const ackBodies = [];
  const device = createFakeDevice({
    baseUrl: 'http://device.test',
    deviceId: 'fake-audio-002',
    fetchImpl: fakeAudioFetch({ command, artifactBytes: bytes, onAck: (body) => ackBodies.push(body) }),
  });

  const first = await device.pollOnce();
  assert.equal(first.processed.length, 1);
  assert.equal(ackBodies[0].status, 'failed');
  assert.equal(ackBodies[0].error.code, 'audio_byte_count_mismatch');
  assert.equal(ackBodies[0].payload.error.code, 'audio_byte_count_mismatch');
  assert.equal(device.executed()[0].status, 'failed');
  assert.equal(device.executed()[0].error.details.expected, bytes.byteLength + 1);

  // A repeated delivery reuses the recorded failure and only re-sends the
  // idempotent ACK; it does not attempt a second artifact execution.
  const second = await device.pollOnce();
  assert.equal(second.processed.length, 1);
  assert.equal(ackBodies.length, 2);
  assert.equal(device.executed().length, 1);
});

test('fake device rejects hash, format, and cross-origin audio references', async () => {
  const bytes = Buffer.from('audio-integrity');
  const goodHash = createHash('sha256').update(bytes).digest('hex');

  const hashCommand = audioCommand({
    audio_id: 'audio-001', audio_ref: '/api/audio/audio-001', byte_count: bytes.length,
    sha256: '0'.repeat(64), format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });
  const hashAcks = [];
  const hashDevice = createFakeDevice({
    baseUrl: 'http://device.test', deviceId: 'fake-audio-003',
    fetchImpl: fakeAudioFetch({ command: hashCommand, artifactBytes: bytes, onAck: (body) => hashAcks.push(body) }),
  });
  await hashDevice.pollOnce();
  assert.equal(hashAcks[0].status, 'failed');
  assert.equal(hashAcks[0].error.code, 'audio_sha256_mismatch');

  const formatCommand = audioCommand({
    audio_id: 'audio-001', audio_ref: '/api/audio/audio-001', byte_count: bytes.length,
    sha256: goodHash, format: { codec: 'pcm_s16le', sample_rate_hz: 8_000, channels: 1 },
  });
  const formatAcks = [];
  const formatDevice = createFakeDevice({
    baseUrl: 'http://device.test', deviceId: 'fake-audio-004',
    fetchImpl: fakeAudioFetch({ command: formatCommand, artifactBytes: bytes, onAck: (body) => formatAcks.push(body) }),
  });
  await formatDevice.pollOnce();
  assert.equal(formatAcks[0].status, 'failed');
  assert.equal(formatAcks[0].error.code, 'audio_format_mismatch');

  const crossOriginCommand = audioCommand({
    audio_id: 'audio-001', audio_ref: 'https://other.test/audio/audio-001', byte_count: bytes.length,
    sha256: goodHash, format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });
  const crossOriginAcks = [];
  const crossOriginDevice = createFakeDevice({
    baseUrl: 'http://device.test', deviceId: 'fake-audio-005',
    fetchImpl: fakeAudioFetch({ command: crossOriginCommand, artifactBytes: bytes, onAck: (body) => crossOriginAcks.push(body) }),
  });
  await crossOriginDevice.pollOnce();
  assert.equal(crossOriginAcks[0].status, 'failed');
  assert.equal(crossOriginAcks[0].error.code, 'audio_artifact_cross_origin');
});

test('fake device rejects an artifact with missing format metadata when format is declared', async () => {
  const bytes = Buffer.from('audio-no-format');
  const command = audioCommand({
    audio_id: 'audio-001', audio_ref: '/api/audio/audio-001', byte_count: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });
  const ackBodies = [];
  const noHeadersFetch = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/outbox') return commandResponse(command);
    if (parsed.pathname === '/api/audio/audio-001') return new Response(bytes, { status: 200 });
    if (parsed.pathname === '/api/outbox/cmd-audio-001/ack') {
      ackBodies.push(JSON.parse(init.body));
      return ackResponse({ ...command, status: 'completed' });
    }
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
  };
  const device = createFakeDevice({ baseUrl: 'http://device.test', deviceId: 'fake-audio-006', fetchImpl: noHeadersFetch });
  await device.pollOnce();
  assert.equal(ackBodies[0].status, 'failed');
  assert.equal(ackBodies[0].error.code, 'audio_format_missing');
});

test('fake device leaves transient artifact HTTP failures queued for retry', async () => {
  const bytes = Buffer.from('temporarily-unavailable');
  const command = audioCommand({
    audio_id: 'audio-001', audio_ref: '/api/audio/audio-001', byte_count: bytes.length,
    format: { codec: 'wav', sample_rate_hz: 16_000, channels: 1 },
  });
  let ackCount = 0;
  const device = createFakeDevice({
    baseUrl: 'http://device.test',
    deviceId: 'fake-audio-007',
    fetchImpl: fakeAudioFetch({
      command,
      artifactBytes: bytes,
      artifactOptions: { status: 503 },
      onAck: () => { ackCount += 1; },
    }),
  });

  await assert.rejects(
    () => device.pollOnce(),
    (error) => error instanceof FakeDeviceError
      && error.code === 'audio_artifact_http_error'
      && error.retryable === true,
  );
  assert.equal(ackCount, 0);
  assert.equal(device.executed().length, 0);
});
