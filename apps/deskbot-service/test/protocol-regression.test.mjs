import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';

import { createFakeDevice } from '../src/fake-device.mjs';
import { createOutputRouter } from '../src/output-router.mjs';
import {
  BRIDGE_PROTOCOL_VERSION,
  createWebSocketBridge,
} from '../src/websocket-bridge.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');
const resources = [];

afterEach(async () => {
  for (const resource of resources.splice(0).reverse()) {
    await resource.close();
  }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function commandResponse(command) {
  return jsonResponse({ commands: [command] });
}

function ackResponse(command, duplicate = false) {
  return jsonResponse({ accepted: true, duplicate, command });
}

function replayCommand(payload) {
  return {
    command_id: 'cmd-replay-regression-001',
    type: 'render.expression',
    target: 'fake-device',
    device_id: 'fake-device-replay-001',
    payload,
  };
}

test('fake device replays the same command payload but rejects a changed payload', async () => {
  const commands = [
    replayCommand({ expression: 'happy' }),
    replayCommand({ expression: 'happy' }),
    replayCommand({ expression: 'sad' }),
  ];
  const ackBodies = [];
  let pollCount = 0;
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/outbox') {
      return commandResponse(commands[Math.min(pollCount++, commands.length - 1)]);
    }
    if (parsed.pathname === '/api/outbox/cmd-replay-regression-001/ack') {
      const body = JSON.parse(init.body);
      ackBodies.push(body);
      return ackResponse({ ...commands[0], status: body.status }, body.duplicate === true);
    }
    throw new Error(`unexpected fake-device URL ${url}`);
  };
  const device = createFakeDevice({
    baseUrl: 'http://device.test',
    deviceId: 'fake-device-replay-001',
    fetchImpl,
  });

  const first = await device.pollOnce();
  const second = await device.pollOnce();
  const third = await device.pollOnce();

  assert.equal(first.processed.length, 1);
  assert.equal(second.processed.length, 1);
  assert.equal(third.processed.length, 1);
  assert.equal(device.executed().length, 1, 'a changed payload must not execute a second time');
  assert.equal(ackBodies.length, 3);
  assert.equal(ackBodies[0].status, 'completed');
  assert.equal(ackBodies[0].duplicate, false);
  assert.equal(ackBodies[1].status, 'completed');
  assert.equal(ackBodies[1].duplicate, true);
  assert.equal(ackBodies[2].status, 'failed');
  assert.equal(ackBodies[2].duplicate, false);
  assert.equal(ackBodies[2].error.code, 'command_conflict');
});

function hello(deviceId) {
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
      capture_formats: [{ codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 }],
      playback_formats: [{ codec: 'opus', sample_rate_hz: 16_000, channels: 1 }],
    },
    binding: { character_id: 'ember-001', shell_id: null },
    resume: { last_role_revision: 0, last_acked_command_id: null },
  };
}

function waitForMessage(ws, predicate, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      reject(new Error('timed out waiting for WebSocket message'));
    }, timeoutMs);
    const onMessage = (event) => {
      if (typeof event.data !== 'string') return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      resolve(message);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function startBridge({ outputRouter, audioArtifacts = null } = {}) {
  const httpServer = createServer();
  const bridge = createWebSocketBridge({
    server: httpServer,
    now: () => fixedTime,
    heartbeatIntervalMs: 0,
    outboxPollIntervalMs: 0,
    outputRouter,
    audioArtifacts,
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  resources.push({
    close: async () => {
      bridge.close();
      await new Promise((resolve, reject) => httpServer.close((error) => (error ? reject(error) : resolve())));
    },
  });
  return {
    bridge,
    wsUrl: `ws://127.0.0.1:${httpServer.address().port}/ws`,
  };
}

async function connect(wsUrl, deviceId) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.send(JSON.stringify(hello(deviceId)));
  const welcome = await waitForMessage(ws, (message) => message.type === 'device.welcome');
  assert.equal(welcome.device_id, deviceId);
  return ws;
}

function renderCommand({ commandId, deviceId, expiresAt = null } = {}) {
  return {
    schema: 'foundry.device-command.v0.1',
    command_id: commandId,
    source_event_id: `event-${commandId}`,
    type: 'render.expression',
    target: 'vocat',
    device_id: deviceId,
    character_id: 'ember-001',
    shell_id: null,
    role_revision: 0,
    correlation_id: `correlation-${commandId}`,
    priority: 'normal',
    expires_at: expiresAt,
    payload: { expression: 'happy' },
    status: 'queued',
    queued_at: fixedTime.toISOString(),
    acknowledgment: null,
  };
}

test('WebSocket bridge rejects an ACK from a different device and leaves the command queued', async () => {
  const outputRouter = createOutputRouter({ now: () => fixedTime });
  const command = outputRouter.enqueue({
    source_event: {
      event_id: 'event-cross-device-ack-001',
      device_id: 'vocat-owner-001',
      character_id: 'ember-001',
      correlation_id: 'corr-cross-device-ack-001',
      role_revision: 0,
    },
    output_plan: [{ type: 'render.expression', targets: ['vocat'], expression: 'happy' }],
  }).commands[0];
  const { wsUrl } = await startBridge({ outputRouter });
  const ws = await connect(wsUrl, 'vocat-attacker-001');
  resources.push({
    close: async () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
      await new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) resolve();
        else ws.addEventListener('close', resolve, { once: true });
      });
    },
  });

  ws.send(JSON.stringify({
    schema: 'deskbot.device-command-ack.v0.1',
    type: 'device.command.ack',
    message_id: 'ack-cross-device-001',
    command_id: command.command_id,
    device_id: 'vocat-attacker-001',
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 2,
    correlation_id: command.correlation_id,
    role_revision: 0,
    status: 'completed',
    duplicate: false,
    result: { rendered: true },
  }));
  const response = await waitForMessage(
    ws,
    (message) => message.type === 'bridge.error' || message.type === 'device.command.ack.accepted',
  );

  assert.equal(response.type, 'bridge.error');
  assert.ok(['command_device_mismatch', 'device_not_bound', 'bad_schema'].includes(response.code));
  assert.equal(outputRouter.get(command.command_id).status, 'queued');
  assert.equal(outputRouter.get(command.command_id).acknowledgment, null);
});

test('bridge turns an expired queued command into command_expired without sending it', async () => {
  const command = renderCommand({
    commandId: 'cmd-expired-regression-001',
    deviceId: 'vocat-expired-001',
    expiresAt: '2026-08-31T23:59:59.000Z',
  });
  const ackInputs = [];
  const outputRouter = {
    listQueued: () => [command],
    ack: (input) => {
      ackInputs.push(input);
      return { duplicate: false, command: { ...command, status: input.status, acknowledgment: input } };
    },
  };
  const { wsUrl } = await startBridge({ outputRouter });
  const ws = await connect(wsUrl, command.device_id);
  const wireMessages = [];
  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    try { wireMessages.push(JSON.parse(event.data)); } catch { /* ignore */ }
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(wireMessages.some((message) => message.type === 'device.command'), false);
  assert.equal(ackInputs.length, 1);
  assert.equal(ackInputs[0].status, 'failed');
  assert.equal(ackInputs[0].error.code, 'command_expired');
  ws.close();
});

test('unknown downlink storage errors are not converted into playback_failed ACKs', async () => {
  const command = {
    ...renderCommand({ commandId: 'cmd-unknown-downlink-001', deviceId: 'vocat-unknown-001' }),
    type: 'audio.play',
    payload: {
      audio_id: 'audio-unknown-001',
      stream_id: '550e8400-e29b-41d4-a716-446655440000',
      format: { codec: 'opus', sample_rate_hz: 16_000, channels: 1 },
    },
  };
  const ackInputs = [];
  const outputRouter = {
    listQueued: () => [command],
    ack: (input) => {
      ackInputs.push(input);
      return { duplicate: false, command: { ...command, status: input.status, acknowledgment: input } };
    },
  };
  const audioArtifacts = {
    read: () => {
      throw new Error('sqlite temporarily unavailable');
    },
  };
  const { wsUrl } = await startBridge({ outputRouter, audioArtifacts });
  const ws = await connect(wsUrl, command.device_id);
  const wireMessages = [];
  ws.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    try { wireMessages.push(JSON.parse(event.data)); } catch { /* ignore */ }
  });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(wireMessages.some((message) => message.type === 'device.command'), false);
  assert.equal(ackInputs.some((input) => input.error?.code === 'playback_failed'), false);
  ws.close();
});

test('unknown ACK adapter errors are opaque and release the command for retry', async () => {
  const command = renderCommand({
    commandId: 'cmd-unknown-ack-001',
    deviceId: 'vocat-unknown-ack-001',
  });
  let listCalls = 0;
  const outputRouter = {
    get: () => command,
    ack: async () => {
      const error = new Error('database is busy');
      error.code = 'SQLITE_BUSY';
      throw error;
    },
    // Keep the hello-time poll empty so the test can attach a listener before
    // explicitly delivering the command.
    listQueued: () => (listCalls++ === 0 ? [] : [command]),
  };
  const { bridge, wsUrl } = await startBridge({ outputRouter });
  const ws = await connect(wsUrl, command.device_id);
  const firstCommand = waitForMessage(ws, (message) => message.type === 'device.command');
  await bridge.sendCommand(command.device_id, command);
  await firstCommand;
  ws.send(JSON.stringify({
    schema: 'deskbot.device-command-ack.v0.1',
    type: 'device.command.ack',
    message_id: 'ack-unknown-ack-001',
    command_id: command.command_id,
    device_id: command.device_id,
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 3,
    correlation_id: command.correlation_id,
    role_revision: 0,
    status: 'completed',
    duplicate: false,
    result: { rendered: true },
  }));
  const response = await waitForMessage(ws, (message) => message.type === 'bridge.error');
  assert.equal(response.code, 'internal_error');
  assert.equal(response.message, 'bridge processing failed');
  assert.equal(response.retryable, true);

  // A persistence failure must not require a reconnect before the queued
  // command can be retried. The fake adapter still throws on the next ACK, so
  // only assert that a second command envelope is put on the wire.
  await bridge.sendCommand(command.device_id, command);
  await waitForMessage(ws, (message) => message.type === 'device.command');
  ws.close();
});

test('async ACK command lookup errors reset audio.play and allow same-connection resend', async () => {
  const deviceId = 'vocat-async-ack-read-001';
  const format = { codec: 'opus', sample_rate_hz: 16_000, channels: 1 };
  const command = {
    ...renderCommand({ commandId: 'cmd-async-ack-read-001', deviceId }),
    type: 'audio.play',
    payload: {
      audio_id: 'audio-async-ack-read-001',
      stream_id: '550e8400-e29b-41d4-a716-446655440001',
      format,
    },
  };
  let lookupCalls = 0;
  let ackCalls = 0;
  const outputRouter = {
    listQueued: () => [],
    get: async () => {
      lookupCalls += 1;
      throw new Error('persistence lookup failed: SQLITE_BUSY');
    },
    ack: async () => {
      ackCalls += 1;
      throw new Error('ACK must not be attempted after lookup failure');
    },
  };
  const audioArtifacts = {
    read: () => ({
      audio_id: command.payload.audio_id,
      buffer: Buffer.from([1, 2, 3, 4]),
      format,
    }),
  };
  const { bridge, wsUrl } = await startBridge({ outputRouter, audioArtifacts });
  const ws = await connect(wsUrl, deviceId);

  const firstWireCommand = waitForMessage(ws, (message) => message.type === 'device.command');
  assert.equal(await bridge.sendCommand(deviceId, command), true);
  await firstWireCommand;
  assert.equal(bridge.getPeer(deviceId).phase, 'playing');

  const errorMessage = waitForMessage(ws, (message) => message.type === 'bridge.error');
  ws.send(JSON.stringify({
    schema: 'deskbot.device-command-ack.v0.1',
    type: 'device.command.ack',
    message_id: 'ack-async-ack-read-001',
    command_id: command.command_id,
    device_id: deviceId,
    occurred_at: fixedTime.toISOString(),
    monotonic_ms: 4,
    correlation_id: command.correlation_id,
    role_revision: 0,
    status: 'completed',
    duplicate: false,
    result: { played_ms: 4 },
  }));
  const response = await errorMessage;
  assert.equal(response.code, 'internal_error');
  assert.equal(response.message, 'bridge processing failed');
  assert.equal(response.retryable, true);
  assert.equal(lookupCalls, 1);
  assert.equal(ackCalls, 0);
  assert.equal(bridge.getPeer(deviceId).phase, 'idle');

  const secondWireCommand = waitForMessage(ws, (message) => message.type === 'device.command');
  assert.equal(await bridge.sendCommand(deviceId, command), true);
  await secondWireCommand;
  ws.close();
});

test('local failure ACK storage errors release an expired command for retry', async () => {
  const command = renderCommand({
    commandId: 'cmd-local-failure-ack-001',
    deviceId: 'vocat-local-failure-001',
    expiresAt: '2026-08-31T23:59:59.000Z',
  });
  let listCalls = 0;
  let ackCalls = 0;
  const outputRouter = {
    listQueued: () => (listCalls++ === 0 ? [] : [command]),
    ack: async (input) => {
      ackCalls += 1;
      if (ackCalls === 1) {
        const error = new Error('database is busy');
        error.code = 'SQLITE_BUSY';
        throw error;
      }
      return {
        duplicate: false,
        command: { ...command, status: input.status, acknowledgment: input },
      };
    },
  };
  const { bridge, wsUrl } = await startBridge({ outputRouter });
  const ws = await connect(wsUrl, command.device_id);
  const errorMessage = waitForMessage(ws, (message) => message.type === 'bridge.error');
  assert.equal(await bridge.sendCommand(command.device_id, command), true);
  const response = await errorMessage;
  assert.equal(response.code, 'internal_error');
  assert.equal(response.retryable, true);

  // The first local expiry ACK failed before becoming durable. A second
  // delivery on the same connection must reach the adapter again.
  assert.equal(await bridge.sendCommand(command.device_id, command), true);
  assert.equal(ackCalls, 2);
  assert.equal(bridge.getPeer(command.device_id).phase, 'idle');
  ws.close();
});
