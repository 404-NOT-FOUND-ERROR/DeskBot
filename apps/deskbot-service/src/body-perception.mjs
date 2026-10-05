import { createHash } from 'node:crypto';
import { characterIdsEqual } from './world-definition.mjs';

export const BODY_PERCEPTION_VERSION = 'deskbot.body-perception.v1';
export const BODY_YAW_LIMIT = 60;
const SOURCE_MAX_AGE = 300_000, REACTION_MAX_AGE = 10_000, FUTURE_TOLERANCE = 1_000;
const COOLDOWN = { head_touch: 2_000, screen_touch: 2_000, sound_direction: 3_000, shell_detection: 2_000 };
const clone = value => structuredClone(value);
const ms = value => Date.parse(value ?? '');
const date = value => new Date(value).toISOString();
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const text = (value, maximum = 200) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const has = (device, keys) => keys.some(key => device?.capabilities?.[key] === true);
const terminal = new Set(['completed', 'failed', 'expired']);
const hardware = Object.freeze({ camera: false, locomotion: false, yaw_degrees_of_freedom: 1, yaw_limit_degrees: BODY_YAW_LIMIT });

export function installBodyPerception(world, at) {
  if (!world.protagonist?.character_id || !Number.isFinite(ms(at)) || world.body?.schema === BODY_PERCEPTION_VERSION) return false;
  if (world.body) return false; // Do not overwrite another admitted body schema.
  world.body = { schema: BODY_PERCEPTION_VERSION, installed_at: at, character_id: world.protagonist.character_id,
    revision: 0, hardware: clone(hardware), attention: null, last_sound_direction: null, shell: null,
    yaw: { actual_degrees: null, reported_degrees: null, feedback_kind: 'unknown', last_ack_at: null, device_id: null, status: 'unknown' },
    turns: [], event_keys: [], watermarks: {}, cooldowns: {},
    migration: { additive: true, historical_observations_created: false, identity_and_personality_preserved: true } };
  return true;
}
function bound(world, deviceId, characterId, ctx) {
  if (ctx.attestedKind !== 'device' || !ctx.device || ctx.device.device_id !== deviceId) return 'device_not_server_attested';
  if (!characterIdsEqual(ctx.device.character_id, world.protagonist.character_id) ||
    (characterId && !characterIdsEqual(characterId, world.protagonist.character_id))) return 'device_character_mismatch';
  return null;
}
function kindFor(event) {
  const p = event.payload ?? {};
  if (event.type === 'sensor.touch') return (p.region ?? p.target) === 'head' ? 'head_touch' : (p.region ?? p.target) === 'screen' ? 'screen_touch' : 'unsupported';
  if (event.type === 'sensor.microphone_direction') return 'sound_direction';
  if (event.type === 'shell.install.detected') return 'shell_detection';
  return 'unsupported';
}
function sensorCapability(device, kind) {
  if (kind === 'head_touch') return has(device, ['input.touch', 'sensor.touch', 'sensor.head_touch', 'head_touch']);
  if (kind === 'screen_touch') return has(device, ['input.touch', 'sensor.touch', 'sensor.screen_touch', 'screen_touch']);
  if (kind === 'sound_direction') return has(device, ['input.microphone.direction', 'sensor.microphone_direction', 'microphone_direction']);
  if (kind === 'shell_detection') return has(device, ['input.shell.magnetic', 'shell.install.detected', 'magnetic_shell_detection']);
  return false;
}
function supported(ctx, type) {
  return (ctx.supportedCommandTypes ?? ['render.expression']).includes(type);
}
function verified(ctx) { return ctx.simulated === false && ctx.hardwareVerified === true; }
function shellMeaning(world, event, ctx) {
  const p = event.payload ?? {}, calibration = ctx.shellCalibration;
  const last = world.body.shell?.shell_id ?? world.body.shell?.last_known_shell_id ?? null;
  const unknown = reason => ({ status: 'unknown', shell_id: null, label: null, last_known_shell_id: last, reason });
  if (!calibration || calibration.device_id !== event.device_id || calibration.calibrated !== true || !text(calibration.calibration_id)) return unknown('磁传感器还没有服务端登记的有效校准。');
  if (p.calibration_id !== calibration.calibration_id) return unknown('这次地磁读数的校准版本不匹配。');
  const code = text(p.magnetic_code, 64);
  if (!code || !Object.hasOwn(calibration.mappings ?? {}, code)) return unknown('地磁读数尚未对应到已校准的壳。');
  const shellId = calibration.mappings[code];
  const catalog = Array.isArray(ctx.shellCatalog) ? ctx.shellCatalog : Object.values(ctx.shellCatalog ?? {});
  const shell = catalog.find(item => item?.shell_id === shellId);
  if (!shell || !text(shell.shell_id, 64)) return unknown('这次校准读数对应的壳尚未登记。');
  if (p.shell_id && p.shell_id !== shell.shell_id) return unknown('设备声称的壳标识与服务端校准读数不一致。');
  return { status: 'recognized', shell_id: shell.shell_id, label: text(shell.label ?? shell.name ?? shell.shell_id, 80), last_known_shell_id: shell.shell_id,
    reason: '根据已登记壳与这台设备的校准读数识别；角色身份保持不变。', calibration_id: calibration.calibration_id, magnetic_code: code };
}
function pushTurn(body, turn) {
  body.turns.push(turn);
  // Keep outstanding receipts so their later ACK cannot become an orphan.
  while (body.turns.length > 96) {
    const index = body.turns.findIndex(t => !t.commands.some(c => !terminal.has(c.status)));
    if (index < 0) break;
    body.turns.splice(index, 1);
  }
  body.revision += 1;
}
function sourceFor(world, turn) {
  return { event_id: turn.source_event_id, character_id: world.protagonist.character_id, device_id: turn.device_id, correlation_id: turn.turn_id };
}
function canReact(body, kind, event, at, ctx) {
  if (ms(at) - ms(event.observed_at ?? event.occurred_at) > REACTION_MAX_AGE) return '观测已不是眼前这一刻，只记录感知，不补发动作。';
  if (ctx.connected !== true || ctx.deviceStatus === 'offline') return '设备目前没有在线执行通路。';
  if (ctx.deviceStatus !== 'idle') return '设备正在忙碌，先保留感知，不打断当前输出。';
  if (ms(body.cooldowns[`${event.device_id}:${kind}`]) > ms(at)) return '同类感知回应还在冷却，避免重复动作。';
  if (body.turns.some(t => t.device_id === event.device_id && t.commands.some(c => !terminal.has(c.status)))) return '还有身体输出没有收到终结回执，先不叠加动作。';
  return null;
}
export function applyBodyObservation(world, event, at, ctx = {}) {
  const body = world.body;
  if (body?.schema !== BODY_PERCEPTION_VERSION) return { accepted: false, reason: 'body_not_installed' };
  if (!Number.isFinite(ms(at)) || !text(event?.event_id, 256) || !text(event?.device_id, 128)) return { accepted: false, reason: 'invalid_body_event' };
  const binding = bound(world, event.device_id, event.character_id, ctx);
  if (binding) return { accepted: false, reason: binding };
  const observed = ms(event.observed_at ?? event.occurred_at), age = ms(at) - observed;
  if (!Number.isFinite(observed)) return { accepted: false, reason: 'body_time_unknown' };
  if (age < -FUTURE_TOLERANCE) return { accepted: false, reason: 'body_time_future' };
  if (age > SOURCE_MAX_AGE) return { accepted: false, reason: 'body_time_stale' };
  const kind = kindFor(event), key = digest(`${event.device_id}:${event.event_id}`), watermarkKey = `${event.device_id}:${kind}`;
  if (body.event_keys.includes(key)) return { accepted: false, duplicate: true, reason: 'body_event_replayed' };
  const monotonic = event.payload?.monotonic_ms ?? event.monotonic_ms;
  if (monotonic !== undefined && (!Number.isSafeInteger(monotonic) || monotonic < 0)) return { accepted: false, reason: 'invalid_body_sequence' };
  const session = text(ctx.session_id, 128) || 'bound-device-session';
  const previous = body.watermarks[watermarkKey];
  if (previous && observed < ms(previous.observed_at)) return { accepted: false, reason: 'body_event_out_of_order' };
  if (previous?.session_id === session && monotonic !== undefined && previous.monotonic_ms !== null && monotonic <= previous.monotonic_ms) return { accepted: false, reason: 'body_event_replayed' };
  if (previous && observed === ms(previous.observed_at) && monotonic === undefined) return { accepted: false, reason: 'body_event_replayed' };
  const turn = { turn_id: `body:${digest(`${event.device_id}:${event.event_id}`)}`, event_id: event.event_id, source_event_id: `body-perception:${event.event_id}`,
    device_id: event.device_id, kind, observed_at: date(observed), received_at: at, expires_at: date(observed + SOURCE_MAX_AGE),
    perception_status: 'observed', summary: '', response: { text: '', expression: 'neutral', intensity: .4 }, execution_status: 'not_requested',
    commands: [], requested_outputs: [], simulated: ctx.simulated === true, hardware_verified: verified(ctx),
    source_label: text(ctx.sourceLabel, 100) || (ctx.simulated === true ? '模拟设备感受' : '服务端绑定设备上报'), independent_evidence: false, direct_identity_change: false };
  const p = event.payload ?? {};
  let usable = sensorCapability(ctx.device, kind), invalid = null;
  if (!usable) invalid = kind === 'unsupported' ? '这个输入没有受支持的身体感受规则。' : '设备没有声明对应传感器能力。';
  if (usable && kind === 'sound_direction' && (!Number.isFinite(p.angle_degrees) || p.angle_degrees < -180 || p.angle_degrees > 180 ||
    (p.confidence !== undefined && (!Number.isFinite(p.confidence) || p.confidence < 0 || p.confidence > 1)))) { usable = false; invalid = '声源方向读数不在协议允许范围。'; }
  if (usable && ['head_touch', 'screen_touch'].includes(kind) && p.phase === 'release') { usable = false; invalid = '这是触摸结束报告，只保留来源，不重复唤起注意。'; }
  if (invalid) {
    turn.perception_status = 'unsupported'; turn.summary = invalid; turn.response.text = '收到设备报告，但这条输入目前无法确认成身体感受。'; turn.execution_status = 'unsupported';
  } else if (kind === 'head_touch' || kind === 'screen_touch') {
    turn.summary = kind === 'head_touch' ? '设备报告头部被触碰，注意回到现实这边。' : '设备报告屏幕被触碰，注意回到现实这边。';
    turn.response = { text: kind === 'head_touch' ? '头顶被碰了一下，我留意到了。' : '屏幕被碰了一下，我留意到了。', expression: 'surprised', intensity: .5 };
    body.attention = { kind, observed_at: turn.observed_at, expires_at: date(observed + 15_000), device_id: event.device_id, turn_id: turn.turn_id };
    turn.world_attention = { status: 'pending', expires_at: date(observed + 600_000), decision: null };
  } else if (kind === 'sound_direction') {
    const uncertain = p.confidence !== undefined && p.confidence < .5;
    const calibrated = p.coordinate_frame === 'calibrated_forward';
    turn.summary = uncertain ? '麦克风报告了不够确定的声源方向，暂时不转头。' : calibrated ? `麦克风报告相对校准正前的声音方向 ${p.angle_degrees}°，不知道说话者是谁。` : `麦克风报告声音方向 ${p.angle_degrees}°，坐标参考尚未确认，暂时不转头。`;
    turn.response.text = uncertain ? '刚才似乎有声音，方向还不够确定。' : '这边传来声音了，我还不知道是谁。';
    body.last_sound_direction = { angle_degrees: p.angle_degrees, confidence: p.confidence ?? null, speaker_identity: 'unknown', observed_at: turn.observed_at,
      coordinate_frame: calibrated ? 'calibrated_forward' : 'unknown_frame', expires_at: date(observed + 10_000), device_id: event.device_id, status: uncertain ? 'uncertain' : 'fresh' };
  } else if (kind === 'shell_detection') {
    body.shell = { ...shellMeaning(world, event, ctx), observed_at: turn.observed_at, expires_at: turn.expires_at, device_id: event.device_id, hardware_verified: verified(ctx) };
    turn.summary = body.shell.status === 'recognized' ? `识别到已登记的${body.shell.label}；身份没有变化。` : `这次换壳还不能确定：${body.shell.reason}`;
    turn.response.text = body.shell.status === 'recognized' ? `这次识别到${body.shell.label}了，我还是我。` : '外壳似乎变了，我还不能确定是哪一个。';
  }
  body.event_keys.push(key); body.event_keys = body.event_keys.slice(-768);
  body.watermarks[watermarkKey] = { observed_at: turn.observed_at, monotonic_ms: monotonic ?? null, session_id: session };
  const suppression = usable ? canReact(body, kind, event, at, ctx) : null;
  if (suppression) { turn.execution_status = 'suppressed'; turn.execution_reason = suppression; if (/冷却/.test(suppression)) turn.perception_status = 'cooldown'; }
  if (usable && !suppression) {
    const expires_at = date(ms(at) + 10_000);
    if (has(ctx.device, ['display.expression', 'output.display.expression']) && supported(ctx, 'render.expression')) {
      turn.requested_outputs.push({ type: 'render.expression', targets: [ctx.target ?? 'vocat'], expires_at,
        payload: { expression: turn.response.expression, intensity: turn.response.intensity } });
    }
    if (kind === 'sound_direction' && body.last_sound_direction.status === 'fresh') {
      if (p.coordinate_frame !== 'calibrated_forward') {
        turn.unsupported_outputs = [{ type: 'orientation.base_yaw', reason: '声源方向的坐标参考未确认成校准正前；不能把相对当前麦阵的角度当作绝对底座转角。' }];
      } else if (has(ctx.device, ['output.orientation.base_yaw']) && has(ctx.device, ['device.command.orientation.base_yaw']) && supported(ctx, 'orientation.base_yaw')) {
        turn.requested_outputs.push({ type: 'orientation.base_yaw', targets: [ctx.target ?? 'vocat'], expires_at,
          payload: { yaw_degrees: Math.max(-BODY_YAW_LIMIT, Math.min(BODY_YAW_LIMIT, p.angle_degrees)) } });
      } else turn.unsupported_outputs = [{ type: 'orientation.base_yaw', reason: '设备尚未声明可执行的单轴转头命令契约。' }];
    }
    turn.execution_status = turn.requested_outputs.length ? 'awaiting_queue' : turn.unsupported_outputs?.length ? 'unsupported' : 'not_requested';
    body.cooldowns[`${event.device_id}:${kind}`] = date(ms(at) + (COOLDOWN[kind] ?? 2_000));
  }
  pushTurn(body, turn);
  return { accepted: true, usable, turn_id: turn.turn_id, turn: clone(turn), source_event: sourceFor(world, turn), output_plan: clone(turn.requested_outputs) };
}
function equalPayload(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
export function markBodyCommands(world, turnId, commands, at, ctx = {}) {
  const body = world.body, turn = body?.turns?.find(t => t.turn_id === turnId);
  if (!turn || ctx.commandAttested !== true || !Array.isArray(commands) || !commands.length || !Number.isFinite(ms(at))) return { accepted: false, reason: 'body_commands_not_attested' };
  if (ctx.device?.device_id !== turn.device_id || !characterIdsEqual(ctx.device?.character_id, world.protagonist.character_id)) return { accepted: false, reason: 'body_command_device_mismatch' };
  if (turn.commands.length) return commands.every(c => turn.commands.some(old => old.command_id === c.command_id)) ? { accepted: true, duplicate: true } : { accepted: false, reason: 'body_command_conflict' };
  if (turn.execution_status !== 'awaiting_queue') return { accepted: false, reason: 'body_turn_not_awaiting_queue' };
  if (commands.length !== turn.requested_outputs.length || commands.some(c => c.status !== 'queued' || c.device_id !== turn.device_id || c.source_event_id !== turn.source_event_id ||
    !characterIdsEqual(c.character_id, world.protagonist.character_id) || !text(c.command_id, 128) || ms(c.expires_at) <= ms(at) ||
    !turn.requested_outputs.some(o => o.type === c.type && o.targets.includes(c.target) && o.expires_at === c.expires_at && equalPayload(o.payload, c.payload)))) return { accepted: false, reason: 'body_command_plan_mismatch' };
  if (new Set(commands.map(c => c.command_id)).size !== commands.length) return { accepted: false, reason: 'body_command_conflict' };
  turn.commands = commands.map(c => ({ command_id: c.command_id, type: c.type, status: 'queued', expires_at: c.expires_at,
    ...(c.type === 'orientation.base_yaw' ? { requested_yaw_degrees: c.payload.yaw_degrees } : {}) }));
  turn.execution_status = 'queued'; body.revision += 1;
  return { accepted: true, turn_id: turn.turn_id };
}
export function markBodyCommandDispatched(world, command, at, ctx = {}) {
  if (ctx.commandAttested !== true || ctx.connected !== true || !Number.isFinite(ms(at))) return { accepted: false, reason: 'body_dispatch_not_attested' };
  const body = world.body, turn = body?.turns.find(t => t.commands.some(c => c.command_id === command?.command_id));
  const linked = turn?.commands.find(c => c.command_id === command.command_id);
  if (!turn || ctx.device?.device_id !== turn.device_id || !characterIdsEqual(ctx.device?.character_id, world.protagonist.character_id) || command.device_id !== turn.device_id ||
    command.source_event_id !== turn.source_event_id || command.type !== linked.type || ms(linked.expires_at) <= ms(at)) return { accepted: false, reason: 'body_dispatch_link_mismatch' };
  if (linked.status === 'dispatched') return { accepted: true, duplicate: true, turn_id: turn.turn_id };
  if (linked.status !== 'queued') return { accepted: false, reason: 'body_dispatch_not_queued' };
  linked.status = 'dispatched'; linked.dispatched_at = at; turn.execution_status = 'dispatched'; body.revision += 1;
  return { accepted: true, turn_id: turn.turn_id };
}
export function applyBodyCommandAck(world, ack, at, ctx = {}) {
  const body = world.body;
  if (!body || !Number.isFinite(ms(at)) || !ack?.command_id || !['completed', 'failed'].includes(ack.status)) return { accepted: false, reason: 'invalid_body_ack' };
  const binding = bound(world, ack.device_id, ack.character_id, ctx);
  if (binding || ctx.routerAccepted !== true) return { accepted: false, reason: binding ?? 'body_ack_not_router_verified' };
  const turn = body.turns.find(t => t.device_id === ack.device_id && t.commands.some(c => c.command_id === ack.command_id));
  if (!turn) return { accepted: false, reason: 'body_ack_command_unknown' };
  const command = turn.commands.find(c => c.command_id === ack.command_id), receipt = ctx.command;
  const occurred = ms(ack.occurred_at), age = ms(at) - occurred;
  if (!Number.isFinite(occurred) || age < -FUTURE_TOLERANCE || age > SOURCE_MAX_AGE || occurred < ms(turn.received_at)) return { accepted: false, reason: 'body_ack_time_invalid' };
  if (terminal.has(command.status)) return command.status === ack.status ? { accepted: true, duplicate: true } : { accepted: false, reason: 'body_ack_conflict' };
  if (!receipt || receipt.command_id !== command.command_id || receipt.device_id !== turn.device_id || receipt.source_event_id !== turn.source_event_id || receipt.type !== command.type ||
    receipt.status !== ack.status || receipt.acknowledgment?.status !== ack.status || receipt.acknowledgment?.device_id !== ack.device_id) return { accepted: false, reason: 'body_ack_receipt_mismatch' };
  if (occurred > ms(command.expires_at) || receipt.acknowledgment?.error?.code === 'command_expired') return { accepted: false, reason: 'body_ack_after_expiry' };
  if (ack.status === 'failed' && !text(ack.error?.code ?? receipt.acknowledgment?.error?.code, 100)) return { accepted: false, reason: 'body_ack_failure_without_reason' };
  const result = receipt.acknowledgment?.payload ?? {}, simulated = turn.simulated || ctx.simulated === true || result.simulated === true;
  let hardwareVerified = !simulated && turn.hardware_verified && verified(ctx);
  const actual = result.actual_yaw_degrees ?? result.yaw_degrees ?? null;
  let verification_status = hardwareVerified ? 'verified' : simulated ? 'simulation' : 'unverified_device_report';
  if (command.type === 'orientation.base_yaw' && ack.status === 'completed' && hardwareVerified) {
    if (!Number.isFinite(actual)) verification_status = 'verification_missing';
    else if (Math.abs(actual) > BODY_YAW_LIMIT) verification_status = 'actual_yaw_out_of_range';
    else if (Math.abs(actual - command.requested_yaw_degrees) > 5) verification_status = 'actual_yaw_deviates_from_request';
    hardwareVerified = verification_status === 'verified';
  }
  Object.assign(command, { status: ack.status, acknowledged_at: ack.occurred_at, simulated, hardware_verified: hardwareVerified,
    verification_status,
    result: { simulated, ...(Number.isFinite(actual) ? { reported_yaw_degrees: actual } : {}), ...(result.measured === true ? { measured: true } : {}) },
    ...(ack.status === 'failed' ? { error_code: text(ack.error?.code ?? receipt.acknowledgment?.error?.code, 100), error_message: text(ack.error?.message ?? receipt.acknowledgment?.error?.message, 200) } : {}) });
  if (command.type === 'orientation.base_yaw' && command.status === 'completed' && hardwareVerified) {
    const measured = has(ctx.device, ['sensor.yaw_feedback']) && result.measured === true;
    command.feedback_kind = measured ? 'measured' : 'open_loop_report';
    if (measured) command.result.measured_actual_yaw_degrees = actual;
    body.yaw = { actual_degrees: measured ? actual : null, reported_degrees: actual, feedback_kind: command.feedback_kind,
      last_ack_at: ack.occurred_at, device_id: turn.device_id, status: measured ? 'measured' : 'acknowledged_report' };
  }
  turn.execution_status = turn.commands.some(c => c.status === 'failed') ? 'failed' : turn.commands.every(c => terminal.has(c.status)) ?
    turn.commands.some(c => c.simulated) ? 'simulation' : turn.commands.every(c => c.hardware_verified) && !turn.commands.some(c => c.feedback_kind === 'open_loop_report') ? 'acknowledged' : 'acknowledged_report' : turn.commands.some(c=>c.status==='dispatched')?'dispatched':'queued';
  body.revision += 1;
  return { accepted: true, turn_id: turn.turn_id, hardware_verified: hardwareVerified };
}
export function settleBodyPerception(world, at) {
  const body = world.body; if (!body || !Number.isFinite(ms(at))) return false;
  let changed = false;
  if (body.attention && ms(body.attention.expires_at) <= ms(at)) { body.attention = null; changed = true; }
  if (body.last_sound_direction && ms(body.last_sound_direction.expires_at) <= ms(at) && body.last_sound_direction.status !== 'stale') { body.last_sound_direction.status = 'stale'; changed = true; }
  if (body.shell?.status === 'recognized' && ms(body.shell.expires_at) <= ms(at)) { body.shell.status = 'stale'; changed = true; }
  for (const turn of body.turns) {
    if (turn.world_attention?.status === 'pending' && ms(turn.world_attention.expires_at) <= ms(at)) { turn.world_attention.status = 'expired'; changed = true; }
    if (turn.execution_status === 'awaiting_queue' && turn.requested_outputs.every(o => ms(o.expires_at) <= ms(at))) { turn.execution_status = 'expired'; changed = true; }
    for (const command of turn.commands) if (!terminal.has(command.status) && ms(command.expires_at) <= ms(at)) { command.status = 'expired'; command.error_code = 'command_expired_without_device_ack'; changed = true; }
    if (turn.commands.some(c => c.status === 'expired') && turn.execution_status !== 'expired') { turn.execution_status = 'expired'; changed = true; }
  }
  if (changed) body.revision += 1;
  return changed;
}
// A bridge rejection is a service result, never a device execution receipt.
export function applyBodyCommandLocalFailure(world, receipt, at, ctx={}) {
  if(ctx.commandAttested!==true || receipt?.status!=='failed' || !Number.isFinite(ms(at))
    || !['deskbot-websocket-bridge','deskbot-outbox-expirer'].includes(receipt.acknowledgment?.source))return {accepted:false,reason:'body_local_failure_not_attested'};
  const turn=world.body?.turns.find(turn=>turn.source_event_id===receipt.source_event_id && turn.device_id===receipt.device_id);
  const command=turn?.commands.find(command=>command.command_id===receipt.command_id && command.type===receipt.type);
  if(!command)return {accepted:false,reason:'body_local_failure_unknown_command'};
  if(terminal.has(command.status))return {accepted:true,duplicate:true};
  command.status=receipt.acknowledgment.error?.code==='command_expired'?'expired':'failed';
  command.error_code=receipt.acknowledgment.error?.code??'bridge_rejected';
  command.error_message=text(receipt.acknowledgment.error?.message,200);
  command.verification_status='service_rejection';command.hardware_verified=false;
  turn.execution_status=command.status;world.body.revision++;
  return {accepted:true,turn_id:turn.turn_id};
}
export function bodyReadModel(world, at = world.clock?.synced_at) {
  if (!world.body) return null;
  const view = { body: clone(world.body) }; settleBodyPerception(view, at);
  const { event_keys, watermarks, cooldowns, ...body } = view.body;
  body.turns = body.turns.slice(-24).map(({ requested_outputs, ...turn }) => turn);
  return body;
}
export function influenceBodyChoices(world, state, at, candidates) {
  if (state.actor_id !== world.protagonist?.character_id || !world.body || !Number.isFinite(ms(at)) || state.appetite > .6 || state.energy < .4 ||
    ['running', 'paused'].includes(state.plan?.status) || (world.tasks ?? []).some(t => t.actor_id === state.actor_id && ['running', 'paused'].includes(t.status)) ||
    candidates.some(c => c.goal === 'rest' && c.available && c.score >= 90)) return candidates;
  const pending = world.body.turns.filter(t => t.world_attention?.status === 'pending' && ms(t.world_attention.expires_at) > ms(at) && ['head_touch', 'screen_touch'].includes(t.kind));
  if (!pending.length) return candidates;
  const turn = pending.at(-1), goal = `body-attention:${turn.turn_id}`;
  if (candidates.some(c => c.goal === goal)) return candidates;
  return [...candidates, { goal, title: '留意一下现实这边', reason: '刚才的触碰还在心上，手头空下来后，在当前位置留意一会儿。', score: 44, available: true,
    source_ids: [turn.event_id], body_turn_id: turn.turn_id, steps: [{ kind: 'observe', title: '留意一下现实这边', duration_seconds: 45, body_turn_id: turn.turn_id }] }];
}
export function recordBodyLifeDecision(world, state, choice, at) {
  if (!world.body || state.actor_id !== world.protagonist?.character_id || !choice?.body_turn_id || !Number.isFinite(ms(at))) return false;
  const turn = world.body.turns.find(t => t.turn_id === choice.body_turn_id);
  if (turn?.world_attention?.status !== 'pending' || ms(turn.world_attention.expires_at) <= ms(at) ||
    !choice.source_ids?.includes(turn.event_id) || !choice.goal?.startsWith('body-attention:')) return false;
  turn.world_attention = { ...turn.world_attention, status: 'chosen', decision: { at, selected: true, actor_id: state.actor_id, plan_id: state.plan?.plan_id ?? null,
    goal: choice.goal, location_id: world.protagonist.location_id, text: '实际选择了在当前位置留意现实的短安排；这不是硬件执行回执。' } };
  world.body.revision += 1; return true;
}
