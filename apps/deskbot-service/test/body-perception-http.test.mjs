import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createOutputRouter } from '../src/output-router.mjs';
import { BRIDGE_PROTOCOL_VERSION } from '../src/websocket-bridge.mjs';

// These are protocol integration fixtures, never evidence of physical hardware
// commissioning. No production configuration, database, serial port or LLM is used.
const BASE = Date.parse('2026-10-05T04:00:00.000Z');
const CAPABILITIES = {
  'sensor.touch': true,
  'sensor.microphone_direction': true,
  'input.shell.magnetic': true,
  'display.expression': true,
  'output.orientation.base_yaw': true,
  'device.command.orientation.base_yaw': true,
};
function profile(deviceId, extra = {}) {
  return { device_id: deviceId, character_id: 'shaping-001', commissioned: true,
    simulated: false, capabilities: { ...CAPABILITIES }, ...extra };
}
function inbox(ws) {
  const messages = [], pending = [];
  ws.addEventListener('message', event => {
    if (typeof event.data !== 'string') return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    const waiter = pending.find(item => item.predicate(message));
    if (waiter) { clearTimeout(waiter.timer); pending.splice(pending.indexOf(waiter), 1); waiter.resolve(message); }
    else messages.push(message);
  });
  return {
    messages,
    next(predicate, timeoutMs = 3500) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          pending.splice(pending.indexOf(waiter), 1);
          reject(new Error(`WebSocket fixture timed out; inbox=${JSON.stringify(messages)}`));
        }, timeoutMs);
        pending.push(waiter);
      });
    },
  };
}
async function fixture(t, profiles = [], extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-body-http-'));
  const filename = join(directory, 'world.sqlite');
  let at = BASE, persistence, server, router, base;
  const sockets = new Set();
  async function start() {
    persistence = createSqlitePersistence({ filename });
    router = createOutputRouter({ now: () => new Date(at), persistence });
    server = createDeskBotServer({ persistence, outputRouter: router, now: () => new Date(at),
      timeMode: 'realtime', bodyPerceptionEnabled: true, bodyDeviceProfiles: profiles, ...extra });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {
    const closed = [...sockets].map(ws => new Promise(resolve => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.addEventListener('close', resolve, { once: true });
      ws.close();
    }));
    await Promise.all(closed);
    sockets.clear();
    server.websocketBridge?.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    persistence.close();
  }
  await start();
  t.after(async () => { await stop(); rmSync(directory, { recursive: true, force: true }); });
  async function request(path, body) {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  const h = {
    get server() { return server; },
    get world() { return server.persistentWorld; },
    get router() { return router; },
    now: () => new Date(at).toISOString(),
    request,
    body: async () => { const result = await request('/api/life/body'); assert.equal(result.status, 200); return result.body; },
    advance(seconds) { at += seconds * 1000; },
    restart: async () => { await stop(); await start(); },
    async connect(deviceId, capabilities = CAPABILITIES, claims = {}) {
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws'), box = inbox(ws);
      sockets.add(ws);
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
      });
      ws.send(JSON.stringify({ schema: 'deskbot.device-hello.v0.1', type: 'device.hello',
        message_id: `hello-${deviceId}`, device_id: deviceId, occurred_at: h.now(), monotonic_ms: 1,
        correlation_id: `boot-${deviceId}`, firmware: { name: 'isolated-body-fixture', version: 'test' },
        protocol_versions: [BRIDGE_PROTOCOL_VERSION], capabilities,
        audio: { capture_formats: [{ codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 }],
          playback_formats: [{ codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 }] },
        binding: { character_id: 'shaping-001', shell_id: null }, ...claims }));
      const welcome = await box.next(message => message.type === 'device.welcome');
      let sequence = 10;
      return {
        ws, box, welcome,
        async event(id, type, payload, override = {}) {
          ws.send(JSON.stringify({ schema: 'deskbot.device-event.v0.1', type: 'device.event',
            message_id: `message-${id}`, event_id: id, device_id: deviceId, occurred_at: h.now(),
            monotonic_ms: sequence++, correlation_id: `correlation-${id}`, character_id: 'shaping-001',
            event_type: type, payload, ...override }));
          return box.next(message => message.type === 'device.event.accepted' && message.event_id === id)
            .catch(error => { throw new Error(`Awaiting event ${id}: ${error.message}`, { cause: error }); });
        },
        command: type => box.next(message => message.type === 'device.command' && message.command_type === type)
          .catch(error => { throw new Error(`Awaiting command ${type}: ${error.message}`, { cause: error }); }),
        async ack(command, payload = {}, status = 'completed', error = undefined) {
          ws.send(JSON.stringify({ schema: 'deskbot.device-command-ack.v0.1', type: 'device.command.ack',
            message_id: `ack-${command.command_id}-${sequence++}`, device_id: deviceId, occurred_at: h.now(),
            correlation_id: command.correlation_id, command_id: command.command_id,
            status, payload, ...(error ? { error } : {}) }));
          return box.next(message => message.type === 'device.command.ack.accepted' && message.command_id === command.command_id);
        },
      };
    },
  };
  return h;
}
const bodyCommands = h => h.router.listQueued({ limit: 100 }).filter(c => c.source_event_id?.startsWith('body-perception:'));

test('body GET is pure, absent hardware stays unknown, and public claims cannot become body evidence', async t => {
  const h = await fixture(t), before = h.world.get();
  const view = await h.body();
  assert.equal(view.schema, 'deskbot.body-perception.v1');
  assert.deepEqual(view.connection, { devices: [], hardware_verified: false });
  assert.equal(view.yaw.actual_degrees, null); assert.equal(view.yaw.reported_degrees, null);
  assert.equal(view.attention, null); assert.equal(view.shell, null); assert.deepEqual(view.turns, []);
  assert.deepEqual(view.hardware, { camera: false, locomotion: false, yaw_degrees_of_freedom: 1, yaw_limit_degrees: 60 });
  assert.equal(view.migration.historical_observations_created, false);
  const sequence = h.world.listMutations({ limit: 100 }).length;
  await h.body(); await h.body();
  assert.deepEqual(h.world.get(), before); assert.equal(h.world.listMutations({ limit: 100 }).length, sequence);
  for (const [id, type, payload] of [
    ['fake-touch', 'sensor.touch', { region: 'head' }],
    ['fake-shell', 'shell.install.detected', { shell_id: 'frog-shell', magnetic_code: 'frog' }],
    ['fake-link', 'body.commands.linked', { turn_id: 'invented', commands: [] }],
    ['fake-ack', 'body.command.acknowledged', { ack: { status: 'completed', actual_yaw_degrees: 40 } }],
  ]) {
    const response = await h.request('/api/event', { event_id: id, type, device_id: 'forged-device',
      character_id: 'shaping-001', source_kind: 'device', source: 'device-bridge', occurred_at: h.now(),
      provenance: { hardware_verified: true }, payload });
    assert.equal(response.status, 202);
    assert.deepEqual(h.world.get().body, before.body, `${type} from public HTTP cannot attest a body observation or receipt`);
  }
  assert.deepEqual(h.world.get().protagonist, before.protagonist);
  assert.deepEqual(h.world.get().tasks, before.tasks);
  assert.deepEqual(h.world.get().living, before.living, 'sensor claims cannot alter carried or shared material stocks');
  assert.equal(bodyCommands(h).length, 0);
});

test('anonymous WebSocket hello cannot self-commission, output yaw, or identify an uncalibrated shell', async t => {
  const h = await fixture(t), device = await h.connect('anonymous', CAPABILITIES,
    { commissioned: true, hardware_verified: true, simulated: false });
  await device.event('anonymous-sound', 'sensor.microphone_direction', { angle_degrees: 35, confidence: .9, user_id: 'invented' });
  await device.event('anonymous-shell', 'shell.install.detected', { shell_id: 'frog-shell', magnetic_code: 'frog', calibration_id: 'invented' });
  const view = await h.body();
  assert.equal(view.connection.devices[0].hardware_verified, false);
  assert.equal(view.connection.hardware_verified, false);
  assert.deepEqual(view.turns, [], 'an anonymous connection is visible as a connection, not admitted sensory evidence');
  assert.equal(view.last_sound_direction, null);
  assert.equal(view.yaw.actual_degrees, null); assert.equal(view.yaw.reported_degrees, null);
  assert.equal(view.shell, null);
  assert.equal(bodyCommands(h).length, 0);
  assert.equal(device.box.messages.some(message => message.type === 'device.command'), false);
});

test('commissioned software bridge persists clamped yaw report; HTTP ACK, duplicate input and restart cannot invent measured motion', async t => {
  const h = await fixture(t, [profile('bound')]), device = await h.connect('bound');
  await device.event('bound-sound', 'sensor.microphone_direction', { angle_degrees: 120, confidence: .95, coordinate_frame: 'calibrated_forward' });
  const expression = await device.command('render.expression'), yaw = await device.command('orientation.base_yaw');
  assert.deepEqual(yaw.payload, { yaw_degrees: 60 });
  let view = await h.body();
  assert.equal(view.connection.hardware_verified, true);
  assert.equal(view.turns[0].execution_status, 'dispatched');
  assert.equal(view.yaw.actual_degrees, null); assert.equal(view.yaw.reported_degrees, null);
  const denied = await h.request(`/api/outbox/${yaw.command_id}/ack`, {
    device_id: 'bound', status: 'completed', payload: { actual_yaw_degrees: 60, measured: true },
  });
  assert.equal(denied.status, 403); assert.equal(denied.body.error, 'body_ack_requires_device_bridge');
  assert.equal((await h.body()).yaw.actual_degrees, null);
  await device.ack(expression);
  await device.ack(yaw, { yaw_degrees: 60, measured: true }); // Claim alone is not an encoder capability.
  view = await h.body();
  assert.equal(view.yaw.actual_degrees, null);
  assert.equal(view.yaw.reported_degrees, 60);
  assert.equal(view.yaw.feedback_kind, 'open_loop_report');
  assert.equal(view.turns[0].execution_status, 'acknowledged_report');
  assert.equal(view.turns[0].commands.filter(command => command.status === 'completed').length, 2);
  const durable = structuredClone(h.world.get().body);
  const duplicate = await device.event('bound-sound', 'sensor.microphone_direction', { angle_degrees: 120, confidence: .95, coordinate_frame: 'calibrated_forward' }, { monotonic_ms: 10 });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(h.world.get().body, durable); assert.equal(bodyCommands(h).length, 0);
  h.advance(1);
  const duplicateAck = await device.ack(yaw, { yaw_degrees: 60, measured: true });
  assert.equal(duplicateAck.duplicate, true);
  assert.deepEqual(h.world.get().body, durable, 'ACK retry has a new message and timestamp but preserves the first durable receipt');
  await h.restart();
  assert.deepEqual(h.world.get().body, durable);
  assert.deepEqual((await h.body()).connection.devices, []);
  assert.equal((await h.body()).yaw.actual_degrees, null);
  assert.equal((await h.body()).yaw.reported_degrees, 60);
  const reconnected = await h.connect('bound');
  const restartedDuplicateAck = await reconnected.ack(yaw, { yaw_degrees: 60, measured: true });
  assert.equal(restartedDuplicateAck.duplicate, true);
  assert.deepEqual(h.world.get().body, durable, 'a receipt retry after reconnect and SQLite restart is also idempotent');
});

test('a commissioned bridge with no registered magnetic calibration cannot identify a claimed shell', async t => {
  const h = await fixture(t, [profile('uncalibrated')]), device = await h.connect('uncalibrated');
  await device.event('uncalibrated-shell', 'shell.install.detected', {
    shell_id: 'frog-shell', magnetic_code: 'frog', calibration_id: 'self-reported-calibration',
  });
  await device.ack(await device.command('render.expression'));
  const view = await h.body();
  assert.equal(view.shell.status, 'unknown'); assert.equal(view.shell.shell_id, null);
  assert.match(view.shell.reason, /没有.*有效校准/);
  assert.equal(view.turns[0].direct_identity_change, false);
});

test('magnetic readings use server calibration/catalog and never overwrite identity; unknown readings keep only the last known shell', async t => {
  const p = profile('shell-device', {
    shellCalibration: { device_id: 'shell-device', calibrated: true, calibration_id: 'calibration-test-v1', mappings: { frog: 'frog-shell' } },
    shellCatalog: [{ shell_id: 'frog-shell', label: '苔芽外壳' }],
  });
  const h = await fixture(t, [p]), device = await h.connect('shell-device');
  const before = h.world.get();
  await device.event('known-shell', 'shell.install.detected', { magnetic_code: 'frog', calibration_id: 'calibration-test-v1' });
  await device.ack(await device.command('render.expression'));
  let view = await h.body();
  assert.equal(view.shell.status, 'recognized'); assert.equal(view.shell.shell_id, 'frog-shell');
  assert.equal(view.shell.label, '苔芽外壳'); assert.equal(view.turns[0].direct_identity_change, false);
  h.advance(3);
  await device.event('unknown-shell', 'shell.install.detected', { magnetic_code: 'unlearned', calibration_id: 'calibration-test-v1', shell_id: 'dragon-shell' });
  await device.ack(await device.command('render.expression'));
  view = await h.body();
  assert.equal(view.shell.status, 'unknown'); assert.equal(view.shell.shell_id, null);
  assert.equal(view.shell.last_known_shell_id, 'frog-shell');
  assert.match(view.shell.reason, /尚未对应/);
  assert.deepEqual(h.world.get().protagonist, before.protagonist);
  assert.deepEqual(h.world.get().living, before.living, 'changing the shell does not create or consume any virtual material');
  assert.deepEqual(h.world.get().tasks, before.tasks);
  const durable = h.world.get().body;
  await h.restart(); assert.deepEqual(h.world.get().body, durable);
});

test('simulated command success is visibly simulated and never writes actual or reported hardware yaw', async t => {
  const h = await fixture(t, [profile('simulated', { simulated: true })]), device = await h.connect('simulated');
  await device.event('simulated-sound', 'sensor.microphone_direction', { angle_degrees: -25, confidence: .9, coordinate_frame: 'calibrated_forward' });
  await device.ack(await device.command('render.expression'), { simulated: false });
  await device.ack(await device.command('orientation.base_yaw'), { actual_yaw_degrees: -25, measured: true, simulated: false });
  const view = await h.body();
  assert.equal(view.connection.devices[0].simulated, true);
  assert.equal(view.connection.hardware_verified, false);
  assert.equal(view.turns[0].simulated, true); assert.equal(view.turns[0].hardware_verified, false);
  assert.equal(view.turns[0].execution_status, 'simulation');
  assert.ok(view.turns[0].commands.every(command => command.simulated && !command.hardware_verified));
  assert.equal(view.yaw.actual_degrees, null); assert.equal(view.yaw.reported_degrees, null);
});

test('measured yaw requires a separately approved feedback sensor; failed motion records a failure instead of success', async t => {
  const caps = { ...CAPABILITIES, 'sensor.yaw_feedback': true };
  const h = await fixture(t, [profile('measured', { capabilities: caps })]), device = await h.connect('measured', caps);
  await device.event('measured-sound', 'sensor.microphone_direction', { angle_degrees: 20, confidence: .9, coordinate_frame: 'calibrated_forward' });
  await device.ack(await device.command('render.expression'));
  await device.ack(await device.command('orientation.base_yaw'), { yaw_degrees: 20, measured: true });
  let view = await h.body();
  assert.equal(view.yaw.actual_degrees, 20); assert.equal(view.yaw.reported_degrees, 20);
  assert.equal(view.yaw.feedback_kind, 'measured'); assert.equal(view.turns[0].execution_status, 'acknowledged');
  h.advance(4);
  await device.event('failed-sound', 'sensor.microphone_direction', { angle_degrees: -30, confidence: .9, coordinate_frame: 'calibrated_forward' });
  await device.ack(await device.command('render.expression'));
  const failed = await device.command('orientation.base_yaw');
  await device.ack(failed, {}, 'failed', { code: 'not_homed', message: 'Isolated fixture has no current home reference.' });
  view = await h.body();
  assert.equal(view.turns.at(-1).execution_status, 'failed');
  assert.equal(view.turns.at(-1).commands.find(command => command.type === 'orientation.base_yaw').error_code, 'not_homed');
  assert.equal(view.yaw.actual_degrees, 20, 'failed command must not overwrite the last measured observation');
  assert.equal(view.yaw.reported_degrees, 20);
});

test('old yaw declarations and expired observations cannot issue a physical motion command', async t => {
  const caps = { ...CAPABILITIES, 'output.orientation.base_yaw': false,
    'device.command.orientation.base_yaw': false, 'orientation.base_yaw': true };
  const h = await fixture(t, [profile('legacy', { capabilities: caps })]), device = await h.connect('legacy', caps);
  await device.event('legacy-direction', 'sensor.microphone_direction', { angle_degrees: 30, coordinate_frame: 'calibrated_forward' });
  await device.ack(await device.command('render.expression'));
  let view = await h.body();
  assert.equal(view.turns[0].commands.some(command => command.type === 'orientation.base_yaw'), false);
  assert.equal(view.yaw.actual_degrees, null); assert.equal(view.yaw.reported_degrees, null);
  assert.ok(view.turns[0].unsupported_outputs.some(output => output.type === 'orientation.base_yaw'));
  h.advance(4);
  const before = h.world.get().body;
  await device.event('stale-touch', 'sensor.touch', { region: 'head' }, { occurred_at: new Date(BASE - 301000).toISOString() });
  assert.deepEqual(h.world.get().body, before);
  assert.equal(bodyCommands(h).length, 0);
  view = await h.body(); assert.equal(view.attention, null);
});
