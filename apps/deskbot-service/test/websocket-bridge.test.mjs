import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';

import {
  AUDIO_DIRECTION_DOWNLINK,
  AUDIO_DIRECTION_UPLINK,
  BRIDGE_PROTOCOL_VERSION,
  createWebSocketBridge,
  decodeAudioFrame,
  encodeAudioFrame,
} from '../src/websocket-bridge.mjs';
import { createAudioArtifactStore } from '../src/audio-artifacts.mjs';
import { createOutputRouter } from '../src/output-router.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');
const httpServer = createServer();
const outputRouter = createOutputRouter({ now: () => fixedTime });
const audioArtifacts = createAudioArtifactStore({ now: () => fixedTime });
const receivedEvents = [];
const receivedAudio = [];
const bridge = createWebSocketBridge({
  server: httpServer,
  now: () => fixedTime,
  heartbeatIntervalMs: 0,
  outboxPollIntervalMs: 0,
  outputRouter,
  audioArtifacts,
  onEvent: async ({ event }) => {
    receivedEvents.push(event);
    return { duplicate: receivedEvents.filter((item) => item.event_id === event.event_id).length > 1 };
  },
  onAudioStream: async (stream) => {
    receivedAudio.push(stream);
  },
});
let wsUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  wsUrl = `ws://127.0.0.1:${httpServer.address().port}/ws`;
});

after(async () => {
  bridge.close();
  await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
});

function hello(deviceId = 'vocat-ws-001') {
  return {
    schema: 'deskbot.device-hello.v0.1',
    type: 'device.hello',
    message_id: `hello-${deviceId}`,
    device_id: deviceId,
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 1,
    correlation_id: `boot-${deviceId}`,
    firmware: { name: 'deskbot-vocat', version: '0.1.0', source: 'esp-vocat' },
    protocol_versions: [BRIDGE_PROTOCOL_VERSION],
    capabilities: {
      'audio.capture': true,
      'audio.playback': true,
      'display.expression': true,
      'sensor.touch': true,
      'sensor.imu': true,
      'audio.barge_in': false,
    },
    audio: {
      capture_formats: [
        { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 },
        { codec: 'g711a', sample_rate_hz: 8_000, channels: 1 },
      ],
      playback_formats: [
        { codec: 'opus', sample_rate_hz: 16_000, channels: 1 },
        { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 },
      ],
    },
    binding: { character_id: 'ember-001', shell_id: null },
    resume: { last_role_revision: 0, last_acked_command_id: null },
  };
}

function waitForMessage(ws, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = async (event) => {
      let value = event.data;
      if (typeof value !== 'string') {
        if (value instanceof Blob) value = Buffer.from(await value.arrayBuffer());
        else value = Buffer.from(value);
      }
      if (Buffer.isBuffer(value)) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMessage);
        resolve(value);
        return;
      }
      let parsed;
      try { parsed = JSON.parse(value); } catch { return; }
      if (!predicate(parsed)) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(parsed);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function openDevice(deviceId = 'vocat-ws-001') {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.send(JSON.stringify(hello(deviceId)));
  const welcome = await waitForMessage(ws, (message) => message.type === 'device.welcome');
  return { ws, welcome };
}

test('DBA1 frame encode/decode validates direction, UUID, sequence and payload size', () => {
  const streamId = '550e8400-e29b-41d4-a716-446655440000';
  const encoded = encodeAudioFrame({
    streamId,
    seq: 4,
    direction: AUDIO_DIRECTION_UPLINK,
    payload: Buffer.from([1, 2, 3, 4]),
  });
  const decoded = decodeAudioFrame(encoded, {
    expectedDirection: AUDIO_DIRECTION_UPLINK,
    expectedStreamId: streamId,
    expectedSeq: 4,
    format: { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 },
  });
  assert.equal(decoded.stream_id, streamId);
  assert.deepEqual([...decoded.payload], [1, 2, 3, 4]);
  assert.throws(
    () => decodeAudioFrame(encoded, { expectedDirection: AUDIO_DIRECTION_DOWNLINK }),
    (error) => error.code === 'invalid_frame',
  );
});

test('hello negotiates formats, device events are ingested, and a complete uplink is delivered', async () => {
  const { ws, welcome } = await openDevice('vocat-ws-event-001');
  assert.equal(welcome.protocol_version, BRIDGE_PROTOCOL_VERSION);
  assert.deepEqual(welcome.capture_format, { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 });
  assert.deepEqual(welcome.playback_format, { codec: 'opus', sample_rate_hz: 16_000, channels: 1 });

  ws.send(JSON.stringify({
    schema: 'deskbot.device-event.v0.1',
    type: 'device.event',
    message_id: 'event-msg-001',
    event_id: 'evt-touch-ws-001',
    device_id: 'vocat-ws-event-001',
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 20,
    correlation_id: 'corr-touch-001',
    character_id: 'ember-001',
    event_type: 'sensor.touch',
    payload: { control: 'left', gesture: 'tap' },
  }));
  const eventAck = await waitForMessage(ws, (message) => message.type === 'device.event.accepted');
  assert.equal(eventAck.event_id, 'evt-touch-ws-001');
  assert.equal(receivedEvents.at(-1).type, 'sensor.touch');

  const streamId = '550e8400-e29b-41d4-a716-446655440000';
  const format = { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 };
  ws.send(JSON.stringify({
    schema: 'deskbot.audio-control.v0.1',
    type: 'audio.start',
    message_id: 'audio-start-001',
    device_id: 'vocat-ws-event-001',
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 30,
    correlation_id: 'corr-audio-001',
    direction: 'uplink',
    stream_id: streamId,
    utterance_id: streamId,
    event_id: 'evt-audio-start-001',
    role_revision: 0,
    format,
    trigger: 'wakenet',
  }));
  ws.send(encodeAudioFrame({ streamId, seq: 0, direction: AUDIO_DIRECTION_UPLINK, payload: Buffer.from([0, 1, 2, 3]) }));
  ws.send(JSON.stringify({
    schema: 'deskbot.audio-control.v0.1',
    type: 'audio.end',
    message_id: 'audio-end-001',
    device_id: 'vocat-ws-event-001',
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 40,
    correlation_id: 'corr-audio-001',
    direction: 'uplink',
    stream_id: streamId,
    utterance_id: streamId,
    last_seq: 0,
    byte_count: 4,
    reason: 'vad_end',
  }));
  const accepted = await waitForMessage(ws, (message) => message.type === 'audio.accepted');
  assert.equal(accepted.byte_count, 4);
  assert.equal(receivedAudio.at(-1).stream_id, streamId);
  assert.deepEqual([...receivedAudio.at(-1).data], [0, 1, 2, 3]);
  ws.close();
  await new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
});

test('outbox command is sent over the bridge and ACK remains idempotent', async () => {
  const { ws } = await openDevice('vocat-ws-command-001');
  const route = outputRouter.enqueue({
    source_event: {
      event_id: 'evt-ws-command-001',
      device_id: 'vocat-ws-command-001',
      character_id: 'ember-001',
      correlation_id: 'corr-command-001',
      role_revision: 1,
    },
    output_plan: [{ type: 'render.expression', targets: ['vocat'], expression: 'happy' }],
  });
  const command = route.commands[0];
  const wirePromise = waitForMessage(ws, (message) => message.type === 'device.command');
  assert.equal(await bridge.sendCommand('vocat-ws-command-001', command), true);
  const wire = await wirePromise;
  assert.equal(wire.command_id, command.command_id);
  assert.equal(wire.command_type, 'render.expression');
  ws.send(JSON.stringify({
    schema: 'deskbot.device-command-ack.v0.1',
    type: 'device.command.ack',
    message_id: 'ack-ws-command-001',
    command_id: command.command_id,
    device_id: 'vocat-ws-command-001',
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 50,
    correlation_id: 'corr-command-001',
    role_revision: 1,
    status: 'completed',
    duplicate: false,
    result: { rendered: true },
  }));
  const ackAccepted = await waitForMessage(ws, (message) => message.type === 'device.command.ack.accepted');
  assert.equal(ackAccepted.command_id, command.command_id);
  assert.equal(outputRouter.get(command.command_id).status, 'completed');
  ws.close();
  await new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
});

test('sequence gap invalidates the active stream so a reconnect/new stream can proceed', async () => {
  const { ws } = await openDevice('vocat-ws-gap-001');
  const streamId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const format = { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 };
  ws.send(JSON.stringify({
    schema: 'deskbot.audio-control.v0.1', type: 'audio.start', message_id: 'gap-start',
    device_id: 'vocat-ws-gap-001', occurred_at: fixedTime.toISOString(), monotonic_ms: 1,
    correlation_id: 'gap-corr', direction: 'uplink', stream_id: streamId, utterance_id: streamId,
    format, trigger: 'wakenet',
  }));
  ws.send(encodeAudioFrame({ streamId, seq: 1, payload: Buffer.from([0, 1]), direction: AUDIO_DIRECTION_UPLINK }));
  const error = await waitForMessage(ws, (message) => message.type === 'bridge.error');
  assert.equal(error.code, 'sequence_gap');
  const nextStream = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  ws.send(JSON.stringify({
    schema: 'deskbot.audio-control.v0.1', type: 'audio.start', message_id: 'gap-start-2',
    device_id: 'vocat-ws-gap-001', occurred_at: fixedTime.toISOString(), monotonic_ms: 2,
    correlation_id: 'gap-corr-2', direction: 'uplink', stream_id: nextStream, utterance_id: nextStream,
    format, trigger: 'wakenet',
  }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const peer = bridge.getPeer('vocat-ws-gap-001');
  assert.equal(peer.phase, 'capturing');
  ws.close();
  await new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
});

test('audio.play sends command, downlink DBA1 chunks and matching end metadata', async () => {
  const { ws } = await openDevice('vocat-ws-play-001');
  const messages = [];
  ws.addEventListener('message', async (event) => {
    let value = event.data;
    if (typeof value !== 'string') {
      if (value instanceof Blob) value = Buffer.from(await value.arrayBuffer());
      else value = Buffer.from(value);
    }
    if (Buffer.isBuffer(value)) messages.push(value);
    else {
      try { messages.push(JSON.parse(value)); } catch { /* ignore malformed test noise */ }
    }
  });
  const format = { codec: 'opus', sample_rate_hz: 16_000, channels: 1 };
  const artifact = audioArtifacts.put({
    audio_id: 'audio-ws-play-001',
    format,
    data_base64: Buffer.from([1, 2, 3, 4, 5]).toString('base64'),
  }).artifact;
  const streamId = '7f1f5390-6a71-44ac-9df0-6a42da85df7e';
  const route = outputRouter.enqueue({
    source_event: {
      event_id: 'evt-ws-play-001', device_id: 'vocat-ws-play-001',
      character_id: 'ember-001', correlation_id: 'corr-play-001', role_revision: 0,
    },
    output_plan: [{
      type: 'audio.play', targets: ['vocat'],
      payload: {
        audio_id: artifact.audio_id,
        stream_id: streamId,
        format,
        byte_count: artifact.byte_count,
        sha256: artifact.sha256,
      },
    }],
  });
  await bridge.sendCommand('vocat-ws-play-001', route.commands[0]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const command = messages.find((message) => message.type === 'device.command');
  assert.equal(command.command_type, 'audio.play');
  const start = messages.find((message) => message.type === 'audio.start' && message.direction === 'downlink');
  assert.equal(start.stream_id, streamId);
  const binary = messages.find((message) => Buffer.isBuffer(message));
  const decoded = decodeAudioFrame(binary, {
    expectedDirection: AUDIO_DIRECTION_DOWNLINK,
    expectedStreamId: streamId,
    expectedSeq: 0,
  });
  assert.deepEqual([...decoded.payload], [1, 2, 3, 4, 5]);
  const end = messages.find((message) => message.type === 'audio.end' && message.direction === 'downlink');
  assert.equal(end.last_seq, 0);
  assert.equal(end.byte_count, 5);
  ws.send(JSON.stringify({
    schema: 'deskbot.device-command-ack.v0.1', type: 'device.command.ack',
    message_id: 'play-ack-001', command_id: route.commands[0].command_id,
    device_id: 'vocat-ws-play-001', occurred_at: fixedTime.toISOString(), monotonic_ms: 5,
    correlation_id: 'corr-play-001', role_revision: 0, status: 'completed',
    result: { played_ms: 10 },
  }));
  await waitForMessage(ws, (message) => message.type === 'device.command.ack.accepted');
  assert.equal(outputRouter.get(route.commands[0].command_id).status, 'completed');
  ws.close();
  await new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
});

test('audio.play validates the artifact before sending a command envelope', async () => {
  const { ws } = await openDevice('vocat-ws-invalid-play-001');
  const messages = [];
  ws.addEventListener('message', async (event) => {
    let value = event.data;
    if (typeof value !== 'string') {
      if (value instanceof Blob) value = Buffer.from(await value.arrayBuffer());
      else value = Buffer.from(value);
    }
    if (typeof value === 'string') {
      try { messages.push(JSON.parse(value)); } catch { /* ignore */ }
    }
  });
  const format = { codec: 'opus', sample_rate_hz: 16_000, channels: 1 };
  const route = outputRouter.enqueue({
    source_event: {
      event_id: 'evt-ws-invalid-play-001', device_id: 'vocat-ws-invalid-play-001',
      character_id: 'ember-001', correlation_id: 'corr-invalid-play-001', role_revision: 0,
    },
    output_plan: [{
      type: 'audio.play', targets: ['vocat'],
      payload: {
        audio_id: 'audio-does-not-exist',
        stream_id: '8f1f5390-6a71-44ac-9df0-6a42da85df7e',
        format,
      },
    }],
  });
  await bridge.sendCommand('vocat-ws-invalid-play-001', route.commands[0]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(messages.some((message) => message.type === 'device.command'), false);
  assert.equal(messages.some((message) => message.type === 'audio.start'), false);
  const stored = outputRouter.get(route.commands[0].command_id);
  assert.equal(stored.status, 'failed');
  assert.equal(stored.acknowledgment.error.code, 'playback_failed');
  ws.close();
  await new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
});
