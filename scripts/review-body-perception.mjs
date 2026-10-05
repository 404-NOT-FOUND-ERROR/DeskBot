import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createDeskBotServer } from '../apps/deskbot-service/src/app.mjs';
import { BRIDGE_PROTOCOL_VERSION } from '../apps/deskbot-service/src/websocket-bridge.mjs';

// A separate, in-memory review server. It never opens the installed service's
// database or configuration, and its commissioning profiles are simulation-only.
const CAPABILITIES = Object.freeze({
  'audio.capture': true, 'audio.playback': true, 'display.expression': true,
  'input.touch': true, 'sensor.touch': true, 'input.microphone.direction': true,
  'input.shell.magnetic': true, 'output.orientation.base_yaw': true,
  'device.command.orientation.base_yaw': true, 'sensor.yaw_feedback': false,
});
const CHARACTER_ID = 'shaping-001';
export const BODY_REVIEW_SCENARIOS = Object.freeze({
  head_touch: { event_type: 'sensor.touch', payload: { region: 'head', gesture: 'tap' } },
  screen_touch: { event_type: 'sensor.touch', payload: { region: 'screen', gesture: 'tap' } },
  sound_left: { event_type: 'sensor.microphone_direction', payload: { angle_degrees: -45, confidence: .9, coordinate_frame: 'calibrated_forward' } },
  sound_right: { event_type: 'sensor.microphone_direction', payload: { angle_degrees: 45, confidence: .9, coordinate_frame: 'calibrated_forward' } },
  unknown_shell: { event_type: 'shell.install.detected', payload: { magnetic_code: 'unmapped-code' } },
  registered_shell: { event_type: 'shell.install.detected', payload: { magnetic_code: 'fixture-frog' } },
  failed_yaw: { event_type: 'sensor.microphone_direction', payload: { angle_degrees: 30, confidence: .9, coordinate_frame: 'calibrated_forward' }, fail_yaw: true },
  busy_sound: { event_type: 'sensor.microphone_direction', payload: { angle_degrees: -30, confidence: .9, coordinate_frame: 'calibrated_forward' }, busy: true },
});
const deviceIdFor = id => `body-review-${id.replaceAll('_', '-')}`;
const calibrationFor = id => `body-review-calibration-${id}`;
const profiles = Object.keys(BODY_REVIEW_SCENARIOS).map(id => ({
  device_id: deviceIdFor(id), character_id: CHARACTER_ID,
  simulated: true, commissioned: false, capabilities: { ...CAPABILITIES },
  shellCalibration: { device_id: deviceIdFor(id), calibrated: true, calibration_id: calibrationFor(id), mappings: { 'fixture-frog': 'review-frog-shell' } },
  shellCatalog: [{ shell_id: 'review-frog-shell', label: '青蛙壳（隔离样本）' }],
}));
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function readBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body) > 8192) throw new Error('Review request exceeds 8 KiB.');
  }
  return JSON.parse(body || '{}');
}

export async function createBodyReviewServer({ port = 4313 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid review port.');
  const server = createDeskBotServer({ now: () => new Date(), persistence: null,
    timeMode: 'realtime', timeZone: 'Asia/Shanghai', bodyPerceptionEnabled: true,
    bodyDeviceProfiles: profiles, residentLifeEnabled: true,
    autonomousLifeEnabled: false, worldLifeEnabled: false, livedMemoryEnabled: false });
  const clients = new Map(), ackTimers = new Set();
  let baseUrl, closing = false;

  async function getBody() {
    const response = await fetch(`${baseUrl}/api/life/body`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Body GET failed: ${response.status}`);
    return response.json();
  }
  async function connect(scenarioId) {
    const existing = clients.get(scenarioId);
    if (existing?.ws.readyState === WebSocket.OPEN) return existing;
    const ws = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/ws`);
    const client = { ws, deviceId: deviceIdFor(scenarioId), sequence: 1, messages: [], waits: new Set(), seenCommands: new Set() };
    clients.set(scenarioId, client);
    client.send = value => {
      if (ws.readyState !== WebSocket.OPEN) throw new Error('Review device is disconnected.');
      ws.send(JSON.stringify(value));
    };
    client.envelope = (schema, type, correlationId = `review:${randomUUID()}`) => ({
      schema, type, message_id: `review-msg:${randomUUID()}`, device_id: client.deviceId,
      occurred_at: new Date().toISOString(), monotonic_ms: ++client.sequence,
      correlation_id: correlationId,
    });
    client.wait = (predicate, timeoutMs = 3000) => {
      const previous = client.messages.find(predicate);
      if (previous) return Promise.resolve(previous);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve: message => { clearTimeout(timer); client.waits.delete(waiter); resolve(message); } };
        const timer = setTimeout(() => { client.waits.delete(waiter); reject(new Error('Review WebSocket response timed out.')); }, timeoutMs);
        client.waits.add(waiter);
      });
    };
    ws.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      let message; try { message = JSON.parse(event.data); } catch { return; }
      client.messages.push(message);
      client.messages = client.messages.slice(-128);
      for (const waiter of [...client.waits]) if (waiter.predicate(message)) waiter.resolve(message);
      if (message.type !== 'device.command' || client.seenCommands.has(message.command_id)) return;
      client.seenCommands.add(message.command_id);
      const fail = BODY_REVIEW_SCENARIOS[scenarioId].fail_yaw && message.command_type === 'orientation.base_yaw';
      const timer = setTimeout(() => {
        ackTimers.delete(timer);
        if (closing || ws.readyState !== WebSocket.OPEN) return;
        // This is an actual WS ACK, explicitly marked simulation. There is no
        // encoder in this fixture, and neither actual nor measured yaw is sent.
        client.send({ ...client.envelope('deskbot.device-command-ack.v0.1', 'device.command.ack', message.correlation_id),
          command_id: message.command_id, role_revision: message.role_revision ?? 0,
          status: fail ? 'failed' : 'completed', result: { simulated: true,
            ...(message.command_type === 'orientation.base_yaw' ? { yaw_degrees: message.payload.yaw_degrees } : {}) },
          ...(fail ? { error: { code: 'review_driver_busy', message: '隔离样本：底座驱动忙碌，转头未执行。' } } : {}) });
      }, 750);
      ackTimers.add(timer);
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('Review WebSocket connection failed.')), { once: true });
    });
    const welcome = client.wait(message => message.type === 'device.welcome');
    client.send({ ...client.envelope('deskbot.device-hello.v0.1', 'device.hello'),
      firmware: { name: 'deskbot-body-review-simulator', version: '0.1.0', source: 'isolated-review' },
      protocol_versions: [BRIDGE_PROTOCOL_VERSION], capabilities: { ...CAPABILITIES },
      audio: { capture_formats: [{ codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 }],
        playback_formats: [{ codec: 'opus', sample_rate_hz: 16000, channels: 1 }] },
      binding: { character_id: CHARACTER_ID, shell_id: null } });
    await welcome;
    return client;
  }
  async function runScenario(scenarioId) {
    const scenario = BODY_REVIEW_SCENARIOS[scenarioId];
    if (!scenario) throw new Error(`Unknown scenario_id. Choose: ${Object.keys(BODY_REVIEW_SCENARIOS).join(', ')}.`);
    const client = await connect(scenarioId), eventId = `review-${scenarioId}:${randomUUID()}`;
    if (scenario.busy && server.websocketBridge.getPeer(client.deviceId)?.phase === 'idle') {
      const streamId = randomUUID();
      client.send({ ...client.envelope('deskbot.audio-control.v0.1', 'audio.start'),
        direction: 'uplink', stream_id: streamId, utterance_id: streamId,
        event_id: `review-capture:${randomUUID()}`, role_revision: 0,
        format: { codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 }, trigger: 'review-simulation' });
      // The formal bridge processes messages in order; no fake audio, ASR text
      // or fabricated audio.end is needed to demonstrate a capturing peer.
    }
    const accepted = client.wait(message => message.type === 'device.event.accepted' && message.event_id === eventId);
    client.send({ ...client.envelope('deskbot.device-event.v0.1', 'device.event', `review-input:${eventId}`),
      event_id: eventId, character_id: CHARACTER_ID, event_type: scenario.event_type,
      payload: { ...scenario.payload, ...(scenario.event_type === 'shell.install.detected' ? { calibration_id: calibrationFor(scenarioId) } : {}) } });
    await accepted;
    let body = await getBody();
    const turn = body.turns?.find(item => item.event_id === eventId);
    if (turn?.commands?.length) {
      // Normal outbox polling is 250 ms. Wait for its real dispatch, then leave
      // a 100 ms visible interval before the simulated 750 ms ACK can arrive.
      await client.wait(message => message.type === 'device.command' && message.correlation_id === turn.turn_id);
    }
    await delay(100);
    body = await getBody();
    return { scenario_id: scenarioId, event_id: eventId, simulated: true, body };
  }

  // The fixture route belongs only to this wrapper. Ordinary app.mjs receives
  // every other request unchanged, including the formal read-only body GET.
  const requestListeners = server.listeners('request'); server.removeAllListeners('request');
  server.on('request', (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/api/life/body/review') {
      if (request.method === 'OPTIONS') { json(response, 204, null); return; }
      if (request.method !== 'POST') { json(response, 405, { error: 'review_requires_post' }); return; }
      readBody(request).then(payload => runScenario(payload.scenario_id))
        .then(result => json(response, 200, result))
        .catch(error => json(response, 400, { error: 'review_scenario_failed', message: error.message, simulated: true }));
      return;
    }
    for (const listener of requestListeners) listener.call(server, request, response);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function close() {
    closing = true;
    for (const timer of ackTimers) clearTimeout(timer);
    for (const { ws } of clients.values()) ws.close();
    server.websocketBridge.close();
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  return { server, baseUrl, runScenario, getBody, close };
}

async function main() {
  const smoke = process.argv.includes('--smoke');
  const port = smoke ? 0 : Number(process.env.DESKBOT_BODY_REVIEW_PORT ?? 4313);
  const fixture = await createBodyReviewServer({ port });
  if (smoke) {
    try {
      const response = await fetch(`${fixture.baseUrl}/api/life/body/review`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario_id: 'sound_left' }) });
      assert.equal(response.status, 200); const result = await response.json();
      const initial = result.body.turns.find(turn => turn.event_id === result.event_id);
      assert.equal(initial.simulated, true); assert.equal(initial.hardware_verified, false);
      assert.equal(initial.execution_status, 'dispatched');
      assert.equal(initial.commands.find(command => command.type === 'orientation.base_yaw').requested_yaw_degrees, -45);
      await delay(1000);
      const body = await fixture.getBody(), terminal = body.turns.find(turn => turn.event_id === result.event_id);
      assert.equal(terminal.execution_status, 'simulation');
      assert.equal(body.yaw.actual_degrees, null); assert.equal(body.yaw.reported_degrees, null);
      assert.equal(body.connection.hardware_verified, false);
      console.log('Body review smoke passed: WS hello → sensor event → dispatched command → simulated ACK; no physical yaw proof.');
    } finally { await fixture.close(); }
    return;
  }
  console.log(`Isolated body review running at ${fixture.baseUrl}; simulation only, memory only.`);
  console.log('POST /api/life/body/review {"scenario_id":"head_touch"}; GET /api/life/body after ~1 second for terminal ACK.');
  console.log(`Scenarios: ${Object.keys(BODY_REVIEW_SCENARIOS).join(', ')}`);
  const shutdown = async () => { await fixture.close(); process.exit(0); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Body review failed: ${error.message}`); process.exitCode = 1; });
}
