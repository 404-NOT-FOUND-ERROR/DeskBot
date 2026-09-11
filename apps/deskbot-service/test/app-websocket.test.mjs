import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import {
  AUDIO_DIRECTION_DOWNLINK,
  BRIDGE_PROTOCOL_VERSION,
  decodeAudioFrame,
} from '../src/websocket-bridge.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');
const deviceId = 'vocat-app-smoke-001';
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
  server.websocketBridge?.close();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function hello() {
  return {
    schema: 'deskbot.device-hello.v0.1',
    type: 'device.hello',
    message_id: 'app-smoke-hello-001',
    device_id: deviceId,
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 1,
    correlation_id: 'app-smoke-boot-001',
    firmware: { name: 'deskbot-vocat', version: '0.1.0', source: 'esp-vocat' },
    protocol_versions: [BRIDGE_PROTOCOL_VERSION],
    capabilities: {
      'audio.capture': true,
      'audio.playback': true,
      'display.expression': true,
      'sensor.touch': true,
    },
    audio: {
      capture_formats: [{ codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 }],
      playback_formats: [{ codec: 'opus', sample_rate_hz: 16_000, channels: 1 }],
    },
    binding: { character_id: 'ember-app-smoke-001', shell_id: null },
  };
}

function waitForMessage(ws, predicate = () => true, timeoutMs = 2_000) {
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
      if (Buffer.isBuffer(value)) return;
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

function waitForBinary(ws, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for WebSocket binary message'));
    }, timeoutMs);
    const onMessage = async (event) => {
      let value = event.data;
      if (typeof value === 'string') return;
      if (value instanceof Blob) value = Buffer.from(await value.arrayBuffer());
      else value = Buffer.from(value);
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(value);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function openDevice() {
  const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws`);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.send(JSON.stringify(hello()));
  const welcome = await waitForMessage(ws, (message) => message.type === 'device.welcome');
  return { ws, welcome };
}

test('default app wiring carries WebSocket device events and filters chat outbox to vocat', async () => {
  assert.ok(server.websocketBridge);
  const { ws, welcome } = await openDevice();
  assert.equal(welcome.device_id, deviceId);
  assert.equal(server.websocketBridge.getPeer(deviceId).ready, true);

  ws.send(JSON.stringify({
    schema: 'deskbot.device-event.v0.1',
    type: 'device.event',
    message_id: 'app-smoke-event-msg-001',
    event_id: 'app-smoke-device-event-001',
    device_id: deviceId,
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 10,
    correlation_id: 'app-smoke-event-corr-001',
    character_id: 'ember-app-smoke-001',
    event_type: 'sensor.touch',
    payload: { control: 'left', gesture: 'tap' },
  }));
  const eventAck = await waitForMessage(ws, (message) => message.type === 'device.event.accepted');
  assert.equal(eventAck.event_id, 'app-smoke-device-event-001');

  const eventsResponse = await fetch(`${baseUrl}/api/events?limit=100`);
  const eventsBody = await eventsResponse.json();
  assert.equal(eventsResponse.status, 200);
  assert.equal(eventsBody.events.some((event) => event.event_id === 'app-smoke-device-event-001'), true);

  const chatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: 'app-smoke-chat-001',
      character_id: 'ember-app-smoke-001',
      device_id: deviceId,
      correlation_id: 'app-smoke-chat-corr-001',
      message: '请把这次接口联调记下来',
    }),
  });
  const chatBody = await chatResponse.json();
  assert.equal(chatResponse.status, 202);
  const routeCommands = chatBody.turn.output_route.commands;
  assert.equal(routeCommands.length, 5);
  assert.deepEqual(
    [...new Set(routeCommands.map((command) => command.target))].sort(),
    ['fake-device', 'vocat', 'web'],
  );

  const wirePromise = waitForMessage(ws, (message) => message.type === 'device.command');
  const wireCommand = await wirePromise;
  assert.equal(wireCommand.device_id, deviceId);
  const vocatCommand = routeCommands.find((command) => command.command_id === wireCommand.command_id);
  assert.equal(vocatCommand?.target, 'vocat');

  const nonVocat = routeCommands.filter((command) => command.target !== 'vocat');
  assert.equal(nonVocat.every((command) => command.status === 'queued'), true);

  ws.send(JSON.stringify({
    schema: 'deskbot.device-command-ack.v0.1',
    type: 'device.command.ack',
    message_id: 'app-smoke-ack-001',
    command_id: wireCommand.command_id,
    device_id: deviceId,
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 20,
    correlation_id: 'app-smoke-chat-corr-001',
    role_revision: 0,
    status: 'completed',
    result: { rendered: true },
  }));
  const ackAccepted = await waitForMessage(ws, (message) => message.type === 'device.command.ack.accepted');
  assert.equal(ackAccepted.command_id, wireCommand.command_id);

  const commandResponse = await fetch(`${baseUrl}/api/outbox/${encodeURIComponent(wireCommand.command_id)}`);
  const commandBody = await commandResponse.json();
  assert.equal(commandResponse.status, 200);
  assert.equal(commandBody.command.status, 'completed');

  ws.close();
  await new Promise((resolve) => ws.addEventListener('close', resolve, { once: true }));
});

test('voice chat uses a bridge-safe PCM UUID stream for downlink audio', async () => {
  const ttsRequests = [];
  const pcm = Buffer.from([0, 1, 2, 3]);
  const voiceServer = createDeskBotServer({
    now: () => fixedTime,
    voiceClient: {
      async synthesize(input) {
        ttsRequests.push(input);
        return {
          schema: 'voice.tts-result.v0.1',
          ok: true,
          request_id: input.request_id,
          correlation_id: input.correlation_id,
          profile: input.profile_id,
          // Deliberately exercise the sidecar compatibility fallback. The
          // bridge contract still requires a UUID on the device wire.
          stream_id: `tts-${input.request_id}`,
          audio: {
            format: { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 },
            encoding: 'base64',
            data_base64: pcm.toString('base64'),
            byte_count: pcm.length,
            duration_ms: 10,
            audio_id: 'audio-app-ws-voice-001',
          },
        };
      },
    },
  });
  await new Promise((resolve, reject) => {
    voiceServer.once('error', reject);
    voiceServer.listen(0, '127.0.0.1', resolve);
  });
  const voiceBaseUrl = `http://127.0.0.1:${voiceServer.address().port}`;
  const ws = new WebSocket(`${voiceBaseUrl.replace('http', 'ws')}/ws`);
  try {
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    ws.send(JSON.stringify({
      ...hello(),
      message_id: 'app-smoke-voice-hello-001',
      device_id: 'vocat-app-voice-001',
      correlation_id: 'app-smoke-voice-boot-001',
      binding: { character_id: 'ember-app-voice-001', shell_id: null },
      audio: {
        capture_formats: [{ codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 }],
        playback_formats: [{ codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 }],
      },
    }));
    await waitForMessage(ws, (message) => message.type === 'device.welcome');

    const wirePromise = waitForMessage(ws, (message) => (
      message.type === 'device.command' && message.command_type === 'audio.play'
    ), 4_000);
    const startPromise = waitForMessage(ws, (message) => (
      message.type === 'audio.start' && message.direction === 'downlink'
    ), 4_000);
    const binaryPromise = waitForBinary(ws, 4_000);
    const endPromise = waitForMessage(ws, (message) => (
      message.type === 'audio.end' && message.direction === 'downlink'
    ), 4_000);
    const chatResponse = await fetch(`${voiceBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_id: 'app-smoke-voice-chat-001',
        character_id: 'ember-app-voice-001',
        device_id: 'vocat-app-voice-001',
        correlation_id: 'app-smoke-voice-chat-corr-001',
        message: '语音桥接联调',
      }),
    });
    const chatBody = await chatResponse.json();
    const [wire, start, binary, end] = await Promise.all([
      wirePromise, startPromise, binaryPromise, endPromise,
    ]);
    assert.equal(chatResponse.status, 202);
    assert.equal(ttsRequests.length, 1);
    assert.match(ttsRequests[0].stream_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.deepEqual(ttsRequests[0].format, { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 });
    assert.deepEqual(wire.payload.format, { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 });
    assert.match(wire.payload.stream_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(start.stream_id, wire.payload.stream_id);
    const decoded = decodeAudioFrame(binary, {
      expectedDirection: AUDIO_DIRECTION_DOWNLINK,
      expectedStreamId: wire.payload.stream_id,
      expectedSeq: 0,
      format: wire.payload.format,
    });
    assert.deepEqual([...decoded.payload], [...pcm]);
    assert.equal(end.stream_id, wire.payload.stream_id);
    assert.equal(end.byte_count, pcm.length);
    assert.equal(chatBody.turn.output_plan.find((item) => item.type === 'audio.play').payload.stream_id, wire.payload.stream_id);

    ws.send(JSON.stringify({
      schema: 'deskbot.device-command-ack.v0.1',
      type: 'device.command.ack',
      message_id: 'app-smoke-voice-ack-001',
      command_id: wire.command_id,
      device_id: 'vocat-app-voice-001',
      occurred_at: fixedTime.toISOString(),
      monotonic_ms: 30,
      correlation_id: 'app-smoke-voice-chat-corr-001',
      role_revision: 0,
      status: 'completed',
      result: { played_ms: 10 },
    }));
    await waitForMessage(ws, (message) => message.type === 'device.command.ack.accepted');
    const commandResponse = await fetch(`${voiceBaseUrl}/api/outbox/${encodeURIComponent(wire.command_id)}`);
    const commandBody = await commandResponse.json();
    assert.equal(commandResponse.status, 200);
    assert.equal(commandBody.command.status, 'completed');
  } finally {
    await new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) resolve();
      else {
        ws.addEventListener('close', resolve, { once: true });
        ws.close();
      }
    });
    voiceServer.websocketBridge?.close();
    await new Promise((resolve, reject) => voiceServer.close((error) => (error ? reject(error) : resolve())));
  }
});
