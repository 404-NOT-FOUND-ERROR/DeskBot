import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOutputRouter } from '../src/output-router.mjs';
import { installBodyPerception, applyBodyObservation, markBodyCommands, markBodyCommandDispatched, applyBodyCommandAck,
  settleBodyPerception, bodyReadModel, influenceBodyChoices, recordBodyLifeDecision } from '../src/body-perception.mjs';
const BASE = Date.parse('2026-10-05T03:00:00.000Z'), iso = at => new Date(at).toISOString();
function fixture({ simulated = false, feedback = false } = {}) {
  const world = { protagonist: { character_id: 'shaping-001', location_id: 'moss-sprout-garden', personality: { novelty: .5 }, identity: 'same-character' },
    clock: { synced_at: iso(BASE) }, tasks: [] };
  const device = { device_id: 'fixture-device', character_id: 'shaping-001', hardware: 'isolated-contract-fixture', capabilities: {
    'input.touch': true, 'input.microphone.direction': true, 'input.shell.magnetic': true, 'display.expression': true,
    'output.orientation.base_yaw': true, 'device.command.orientation.base_yaw': true, ...(feedback ? { 'sensor.yaw_feedback': true } : {}) } };
  // hardwareVerified exercises the trusted context contract in memory. This test
  // fixture makes no claim that a real ESP board or sensor has been commissioned.
  const ctx = { attestedKind: 'device', device, connected: true, deviceStatus: 'idle', session_id: 'fixture-session',
    hardwareVerified: !simulated, simulated, sourceLabel: '隔离协议样本', supportedCommandTypes: ['render.expression', 'orientation.base_yaw'] };
  let now = BASE, sequence = 0;
  const router = createOutputRouter({ now: () => new Date(now) }); installBodyPerception(world, iso(now));
  function observation(type, payload = {}, more = {}, override = {}) {
    const event = { event_id: `fixture-observation-${++sequence}`, device_id: device.device_id, character_id: 'shaping-001',
      type, occurred_at: iso(now), payload: { ...payload, monotonic_ms: sequence * 100 }, ...more };
    return { event, result: applyBodyObservation(world, event, iso(now), { ...ctx, ...override }) };
  }
  function queue(result) {
    const routed = router.enqueue({ source_event: result.source_event, output_plan: result.output_plan });
    assert.equal(markBodyCommands(world, result.turn_id, routed.commands, iso(now), { ...ctx, commandAttested: true }).accepted, true);
    return routed.commands;
  }
  function ack(command, payload = {}, override = {}) {
    const acknowledgment = { command_id: command.command_id, device_id: device.device_id, status: 'completed', occurred_at: iso(now), payload, ...override };
    const routed = router.ack(acknowledgment);
    return applyBodyCommandAck(world, acknowledgment, iso(now), { ...ctx, routerAccepted: true, command: routed.command });
  }
  return { world, device, ctx, observation, queue, ack, router, now: () => now, after(ms) { now += ms; world.clock.synced_at = iso(now); } };
}

test('body installation adds unknown physical state and is idempotent without changing identity or personality', () => {
  const world = { protagonist: { character_id: 'shaping-001', location_id: 'desk', personality: { x: .2 }, identity: 'still-me' }, tasks: [{ task_id: 'already-busy' }] }, before = structuredClone(world);
  assert.equal(installBodyPerception(world, iso(BASE)), true); assert.equal(world.body.yaw.actual_degrees, null); assert.equal(world.body.yaw.reported_degrees, null);
  assert.deepEqual(world.protagonist, before.protagonist); assert.deepEqual(world.tasks, before.tasks);
  assert.equal(world.body.hardware.camera, false); assert.equal(world.body.hardware.locomotion, false); assert.equal(world.body.turns.length, 0);
  const installed = structuredClone(world); assert.equal(installBodyPerception(world, iso(BASE + 1000)), false); assert.deepEqual(world, installed);
});

test('payload source, capabilities and identity cannot attest an unbound device observation', () => {
  const h = fixture(), snapshot = structuredClone(h.world);
  const event = { event_id: 'forged', device_id: h.device.device_id, type: 'sensor.touch', character_id: 'shaping-001', occurred_at: iso(BASE),
    source: 'device', payload: { region: 'head', capabilities: { 'input.touch': true }, attestedKind: 'device' } };
  assert.equal(applyBodyObservation(h.world, event, iso(BASE), {}).accepted, false); assert.deepEqual(h.world, snapshot);
  assert.equal(applyBodyObservation(h.world, { ...event, device_id: 'wrong-device' }, iso(BASE), h.ctx).accepted, false);
  assert.equal(applyBodyObservation(h.world, { ...event, character_id: 'other-character' }, iso(BASE), h.ctx).accepted, false);
});

test('freshness, monotonic replay and out-of-order observations do not repeat output', () => {
  const h = fixture(); const first = h.observation('sensor.touch', { region: 'head' });
  assert.equal(first.result.accepted, true); assert.equal(applyBodyObservation(h.world, first.event, iso(h.now()), h.ctx).reason, 'body_event_replayed');
  h.after(1000);
  assert.equal(h.observation('sensor.touch', { region: 'head' }, { occurred_at: iso(BASE - 300001) }).result.reason, 'body_time_stale');
  assert.equal(h.observation('sensor.touch', { region: 'head' }, { occurred_at: iso(h.now() + 1001) }).result.reason, 'body_time_future');
  assert.equal(h.observation('sensor.touch', { region: 'head' }, { occurred_at: iso(BASE - 1) }).result.reason, 'body_event_out_of_order');
  const replay = { ...first.event, event_id: 'different-id-same-sequence', occurred_at: iso(h.now()) };
  assert.equal(applyBodyObservation(h.world, replay, iso(h.now()), h.ctx).reason, 'body_event_replayed');
});

test('head and screen attention are explicit rounds; busy, cooldown and offline states suppress execution', () => {
  const h = fixture(), first = h.observation('sensor.touch', { region: 'head' }).result;
  assert.equal(h.world.body.attention.kind, 'head_touch'); assert.match(first.turn.response.text, /留意到了/); assert.equal(first.turn.execution_status, 'awaiting_queue');
  h.after(1000); const repeated = h.observation('sensor.touch', { region: 'head' }).result;
  assert.equal(repeated.turn.perception_status, 'cooldown'); assert.equal(repeated.output_plan.length, 0);
  h.after(1000); const screen = h.observation('sensor.touch', { region: 'screen' }, {}, { deviceStatus: 'busy' }).result;
  assert.equal(h.world.body.attention.kind, 'screen_touch'); assert.equal(screen.turn.execution_status, 'suppressed'); assert.equal(screen.turn.world_attention.status, 'pending');
  h.after(1000); assert.equal(h.observation('sensor.touch', { region: 'screen' }, {}, { connected: false, deviceStatus: 'offline' }).result.output_plan.length, 0);
  assert.equal(h.observation('sensor.imu', { x: 1, camera: true }).result.turn.perception_status, 'unsupported');
  assert.equal(h.world.body.hardware.camera, false); assert.equal(h.world.protagonist.location_id, 'moss-sprout-garden');
});

test('direction yields bounded yaw intent, never speaker identity, measured angle or locomotion', () => {
  const h = fixture(), result = h.observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 179, user_id: 'invented-user' }).result;
  assert.equal(h.world.body.last_sound_direction.speaker_identity, 'unknown');
  assert.deepEqual(result.output_plan.find(o => o.type === 'orientation.base_yaw').payload, { yaw_degrees: 60 });
  assert.equal(h.world.body.yaw.actual_degrees, null); assert.equal(h.world.body.yaw.reported_degrees, null);
  const oldFirmware = fixture(); delete oldFirmware.device.capabilities['device.command.orientation.base_yaw'];
  const unsupported = oldFirmware.observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 40 }).result;
  assert.ok(!unsupported.output_plan.some(o => o.type === 'orientation.base_yaw')); assert.equal(unsupported.turn.unsupported_outputs[0].type, 'orientation.base_yaw');
  const invalid = fixture().observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 181 }).result; assert.equal(invalid.usable, false);
  const uncertain = fixture().observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 30, confidence: .2 }).result;
  assert.ok(!uncertain.output_plan.some(o => o.type === 'orientation.base_yaw'));
  for (const coordinate_frame of [undefined, 'head_relative', 'invented_frame']) {
    const unknownFrame = fixture();
    const observed = unknownFrame.observation('sensor.microphone_direction', { angle_degrees: 30, coordinate_frame }).result;
    assert.equal(observed.usable, true); assert.equal(unknownFrame.world.body.last_sound_direction.coordinate_frame, 'unknown_frame');
    assert.ok(!observed.output_plan.some(o => o.type === 'orientation.base_yaw'));
    assert.match(observed.turn.unsupported_outputs[0].reason, /坐标参考/);
  }
});

test('only calibrated magnetic codes identify registered shells and an unknown shell preserves uncertainty', () => {
  const h = fixture(), shell = { shell_id: 'frog-shell', label: '青蛙壳' }, ctx = { shellCalibration: { device_id: h.device.device_id, calibrated: true, calibration_id: 'fixture-calibration', mappings: { 'code-a': 'frog-shell' } }, shellCatalog: [shell] };
  const first = h.observation('shell.install.detected', { calibration_id: 'fixture-calibration', magnetic_code: 'code-a' }, {}, ctx).result;
  assert.equal(h.world.body.shell.status, 'recognized'); assert.equal(h.world.body.shell.shell_id, 'frog-shell'); assert.match(first.turn.response.text, /我还是我/);
  h.after(3000); h.observation('shell.install.detected', { shell_id: 'frog-shell' }, {}, ctx);
  assert.equal(h.world.body.shell.status, 'unknown'); assert.equal(h.world.body.shell.shell_id, null); assert.equal(h.world.body.shell.last_known_shell_id, 'frog-shell');
  h.after(3000); h.observation('shell.install.detected', { calibration_id: 'fixture-calibration', magnetic_code: 'unknown-code' }, {}, ctx);
  assert.equal(h.world.body.shell.status, 'unknown'); assert.equal(h.world.protagonist.identity, 'same-character');
  assert.equal(h.world.protagonist.personality.novelty, .5);
});

test('only linked server outbox commands can become dispatched; observations and queued plans cannot acknowledge themselves', () => {
  const h = fixture(), result = h.observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 45 }).result;
  assert.equal(markBodyCommands(h.world, result.turn_id, [{ command_id: 'fake' }], iso(h.now()), {}).accepted, false);
  const commands = h.queue(result), yaw = commands.find(c => c.type === 'orientation.base_yaw');
  assert.equal(h.world.body.yaw.actual_degrees, null);
  assert.equal(markBodyCommandDispatched(h.world, yaw, iso(h.now()), { ...h.ctx, commandAttested: true }).accepted, true);
  assert.equal(h.world.body.turns.at(-1).execution_status, 'dispatched');
  assert.equal(markBodyCommandDispatched(h.world, yaw, iso(h.now()), { ...h.ctx, commandAttested: true }).duplicate, true);
  assert.equal(applyBodyCommandAck(h.world, { command_id: yaw.command_id, device_id: h.device.device_id, occurred_at: iso(h.now()), status: 'completed' }, iso(h.now()), h.ctx).accepted, false);
  assert.equal(h.world.body.yaw.actual_degrees, null);
});

test('real contract open-loop ACK updates reported yaw only; explicit supported measured feedback is separate', () => {
  const h = fixture(), commands = h.queue(h.observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 45 }).result);
  h.after(1000); for (const command of commands) assert.equal(h.ack(command, command.type === 'orientation.base_yaw' ? { yaw_degrees: 43 } : {}).accepted, true);
  assert.equal(h.world.body.yaw.reported_degrees, 43); assert.equal(h.world.body.yaw.actual_degrees, null); assert.equal(h.world.body.yaw.feedback_kind, 'open_loop_report');
  assert.equal(h.world.body.turns.at(-1).execution_status, 'acknowledged_report');
  const snapshot = structuredClone(h.world), yaw = commands.find(c => c.type === 'orientation.base_yaw');
  assert.equal(h.ack(yaw, { yaw_degrees: 43 }).duplicate, true); assert.deepEqual(h.world, snapshot);
  const measured = fixture({ feedback: true }), feedbackCommands = measured.queue(measured.observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: -30 }).result);
  measured.after(1000); for (const command of feedbackCommands) measured.ack(command, command.type === 'orientation.base_yaw' ? { yaw_degrees: -29, measured: true } : {});
  assert.equal(measured.world.body.yaw.actual_degrees, -29); assert.equal(measured.world.body.yaw.feedback_kind, 'measured');
});

test('simulated, missing, out-of-range and deviating feedback never claim a measured or reported yaw', () => {
  for (const sample of [{ simulated: true, payload: { yaw_degrees: 40, simulated: true } }, { payload: {} }, { payload: { yaw_degrees: 70 } }, { payload: { yaw_degrees: 0 } }]) {
    const h = fixture({ simulated: sample.simulated === true }), commands = h.queue(h.observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 40 }).result);
    h.after(1000); for (const command of commands) h.ack(command, command.type === 'orientation.base_yaw' ? sample.payload : { simulated: sample.simulated === true });
    assert.equal(h.world.body.yaw.actual_degrees, null); assert.equal(h.world.body.yaw.reported_degrees, null);
    assert.ok(['simulation', 'acknowledged_report'].includes(h.world.body.turns.at(-1).execution_status));
  }
});

test('failed commands preserve reason; local expiry is not device execution proof and reads never persist expiry', () => {
  const h = fixture(), commands = h.queue(h.observation('sensor.microphone_direction', { coordinate_frame: 'calibrated_forward', angle_degrees: 20 }).result);
  h.after(1000); const yaw = commands.find(c => c.type === 'orientation.base_yaw');
  assert.equal(h.ack(yaw, {}, { status: 'failed', error: { code: 'driver_busy', message: '底座驱动忙碌' } }).accepted, true);
  assert.equal(h.world.body.turns.at(-1).commands.find(c => c.command_id === yaw.command_id).error_code, 'driver_busy');
  h.after(20_000); const snapshot = structuredClone(h.world), view = bodyReadModel(h.world, iso(h.now()));
  assert.equal(view.attention, null); assert.equal(view.last_sound_direction.status, 'stale'); assert.equal(view.turns.at(-1).execution_status, 'expired'); assert.deepEqual(h.world, snapshot);
  assert.equal(view.yaw.actual_degrees, null); assert.equal(settleBodyPerception(h.world, iso(h.now())), true);
  assert.equal(settleBodyPerception(h.world, iso(h.now())), false);
});

test('touch invitation survives short attention, only offers a local idle plan, and consumes one selection without changing personality', () => {
  const h = fixture(), result = h.observation('sensor.touch', { region: 'head' }).result;
  h.after(20_000); const before = structuredClone(h.world), state = { actor_id: 'shaping-001', energy: .8, appetite: .2, plan: null };
  const choices = influenceBodyChoices(h.world, state, iso(h.now()), []);
  assert.equal(choices.length, 1); assert.equal(choices[0].score, 44); assert.equal(choices[0].steps[0].duration_seconds, 45); assert.ok(!choices[0].steps.some(step => step.kind === 'travel'));
  assert.deepEqual(h.world, before); assert.equal(bodyReadModel(h.world, iso(h.now())).attention, null);
  assert.equal(influenceBodyChoices(h.world, { ...state, appetite: .8 }, iso(h.now()), []).length, 0);
  assert.equal(influenceBodyChoices(h.world, { ...state, energy: .2 }, iso(h.now()), []).length, 0);
  assert.equal(influenceBodyChoices(h.world, { ...state, actor_id: 'wetland-grower-001' }, iso(h.now()), []).length, 0);
  h.world.tasks.push({ actor_id: 'shaping-001', status: 'running' }); assert.equal(influenceBodyChoices(h.world, state, iso(h.now()), []).length, 0); h.world.tasks = [];
  state.plan = { plan_id: 'fixture-local-observation', status: 'running' }; assert.equal(recordBodyLifeDecision(h.world, state, choices[0], iso(h.now())), true);
  assert.equal(recordBodyLifeDecision(h.world, state, choices[0], iso(h.now())), false);
  assert.equal(h.world.body.turns.find(t => t.turn_id === result.turn_id).world_attention.status, 'chosen');
  assert.equal(h.world.protagonist.personality.novelty, .5);
});
