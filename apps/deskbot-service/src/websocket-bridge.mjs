import { createHash, randomUUID } from 'node:crypto';

/**
 * DeskBot <-> ESP-VoCat bridge transport.
 *
 * The service intentionally does not depend on a WebSocket package here.  The
 * Node runtime provides the HTTP upgrade/socket primitives, while this module
 * implements the small RFC6455 server surface needed by the local bridge.
 * Keeping the wire implementation in one module makes the firmware contract
 * testable without coupling it to the HTTP application router.
 */

export const BRIDGE_PROTOCOL_VERSION = 'deskbot.bridge.v0.1';
export const AUDIO_FRAME_VERSION = 1;
export const AUDIO_FRAME_HEADER_BYTES = 32;
export const AUDIO_DIRECTION_UPLINK = 1;
export const AUDIO_DIRECTION_DOWNLINK = 2;

export const DEFAULT_CAPTURE_FORMATS = Object.freeze([
  Object.freeze({ codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 }),
  Object.freeze({ codec: 'g711a', sample_rate_hz: 8_000, channels: 1 }),
]);

export const DEFAULT_PLAYBACK_FORMATS = Object.freeze([
  Object.freeze({ codec: 'opus', sample_rate_hz: 16_000, channels: 1 }),
  Object.freeze({ codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 }),
]);

export const DEFAULT_EVENT_TYPES = Object.freeze(new Set([
  'device.boot',
  'device.online',
  'device.offline_pending',
  'audio.wake_detected',
  'audio.vad_started',
  'audio.vad_ended',
  'sensor.touch',
  'sensor.imu',
  'device.playback_started',
  'device.playback_completed',
]));

export const SUPPORTED_COMMAND_TYPES = Object.freeze(new Set([
  'render.expression',
  'audio.play',
  'audio.stop',
  'device.set_volume',
]));

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_CONTROL_BYTES = 256 * 1024;
const DEFAULT_MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_FRAME_BYTES = 16 * 1024 * 1024;
const DEFAULT_CHUNK_BYTES = 16 * 1024;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_OUTBOX_POLL_INTERVAL_MS = 250;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireText(value, field, { trim = true } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BridgeProtocolError('bad_schema', `${field} must be a non-empty string`);
  }
  return trim ? value.trim() : value;
}

function optionalText(value, field) {
  if (value === undefined || value === null) return null;
  return requireText(value, field);
}

function validDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function normalizeOccurredAt(message) {
  if (!Object.prototype.hasOwnProperty.call(message, 'occurred_at')) {
    throw new BridgeProtocolError('bad_schema', 'occurred_at is required');
  }
  if (message.occurred_at !== null && !validDate(message.occurred_at)) {
    throw new BridgeProtocolError('bad_schema', 'occurred_at must be an ISO date-time string or null');
  }
  if (message.occurred_at === null) {
    if (!Number.isInteger(message.monotonic_ms) || message.monotonic_ms < 0) {
      throw new BridgeProtocolError('bad_schema', 'monotonic_ms is required when occurred_at is null');
    }
  } else if (message.monotonic_ms !== undefined
    && (!Number.isInteger(message.monotonic_ms) || message.monotonic_ms < 0)) {
    throw new BridgeProtocolError('bad_schema', 'monotonic_ms must be a non-negative integer');
  }
  return message.occurred_at;
}

function normalizeEnvelope(message, {
  expectedType = null,
  expectedSchema = null,
  deviceId = null,
  requireCorrelation = true,
} = {}) {
  if (!isObject(message)) throw new BridgeProtocolError('bad_schema', 'control message must be a JSON object');
  const schema = requireText(message.schema, 'schema');
  const type = requireText(message.type, 'type');
  requireText(message.message_id, 'message_id');
  const messageDeviceId = requireText(message.device_id, 'device_id');
  if (deviceId !== null && messageDeviceId !== deviceId) {
    throw new BridgeProtocolError('bad_schema', 'device_id does not match the connected device');
  }
  normalizeOccurredAt(message);
  if (requireCorrelation) requireText(message.correlation_id, 'correlation_id');
  if (expectedType !== null && type !== expectedType) {
    throw new BridgeProtocolError('bad_schema', `expected ${expectedType} message`);
  }
  if (expectedSchema !== null && schema !== expectedSchema) {
    throw new BridgeProtocolError('bad_schema', `schema must be ${expectedSchema}`);
  }
  return message;
}

function normalizeFormat(value, field = 'format') {
  if (!isObject(value)) throw new BridgeProtocolError('bad_schema', `${field} must be an object`);
  const codec = requireText(value.codec ?? value.encoding, `${field}.codec`).toLowerCase();
  const sampleRate = value.sample_rate_hz;
  const channels = value.channels;
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192_000) {
    throw new BridgeProtocolError('bad_schema', `${field}.sample_rate_hz must be a positive integer`);
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new BridgeProtocolError('bad_schema', `${field}.channels must be an integer between 1 and 8`);
  }
  return { codec, sample_rate_hz: sampleRate, channels };
}

function normalizeFormatList(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BridgeProtocolError('bad_schema', `${field} must be a non-empty array`);
  }
  return value.map((format, index) => normalizeFormat(format, `${field}[${index}]`));
}

function formatKey(format) {
  return `${format.codec}|${format.sample_rate_hz}|${format.channels}`;
}

function formatsEqual(left, right) {
  return formatKey(left) === formatKey(right);
}

function chooseFormat(deviceFormats, serverFormats, field) {
  const device = normalizeFormatList(deviceFormats, field);
  const server = serverFormats.map((format, index) => normalizeFormat(format, `server_${field}[${index}]`));
  for (const preferred of server) {
    const match = device.find((candidate) => formatsEqual(candidate, preferred));
    if (match) return clone(preferred);
  }
  throw new BridgeProtocolError('unsupported_audio_format', `no common ${field} format`, {
    details: {
      device_formats: device,
      server_formats: server,
    },
    fatal: true,
  });
}

/**
 * Select server-preferred capture/playback formats from a device hello.
 * Exported separately so firmware agents can test negotiation without opening
 * a socket.
 */
export function negotiateAudioFormats({
  hello,
  captureFormats = DEFAULT_CAPTURE_FORMATS,
  playbackFormats = DEFAULT_PLAYBACK_FORMATS,
} = {}) {
  if (!isObject(hello)) throw new BridgeProtocolError('bad_schema', 'hello is required');
  const audio = hello.audio;
  if (!isObject(audio)) throw new BridgeProtocolError('bad_schema', 'hello.audio is required');
  return {
    capture_format: chooseFormat(audio.capture_formats, captureFormats, 'capture_formats'),
    playback_format: chooseFormat(audio.playback_formats, playbackFormats, 'playback_formats'),
  };
}

function uuidBytes(value, field = 'stream_id') {
  const uuid = requireText(value, field).toLowerCase();
  // The contract treats this as an opaque UUID. Do not require a particular
  // version/variant: firmware fixtures can use UUID-like values from any
  // generator.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    throw new BridgeProtocolError('invalid_frame', `${field} must be a UUID`);
  }
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

function uuidFromBytes(value) {
  const bytes = Buffer.from(value);
  if (bytes.length !== 16) throw new BridgeProtocolError('invalid_frame', 'stream UUID must be 16 bytes');
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeDirection(value) {
  if (value === AUDIO_DIRECTION_UPLINK || value === 'uplink') return AUDIO_DIRECTION_UPLINK;
  if (value === AUDIO_DIRECTION_DOWNLINK || value === 'downlink') return AUDIO_DIRECTION_DOWNLINK;
  throw new BridgeProtocolError('invalid_frame', 'direction must be 1/uplink or 2/downlink');
}

/** Encode one contract-compliant DBA1 binary audio frame. */
export function encodeAudioFrame({
  streamId,
  seq,
  payload,
  direction = AUDIO_DIRECTION_UPLINK,
  version = AUDIO_FRAME_VERSION,
  flags = 0,
} = {}) {
  const stream = uuidBytes(streamId);
  const normalizedDirection = normalizeDirection(direction);
  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new BridgeProtocolError('invalid_frame', 'version must be an unsigned byte');
  }
  if (!Number.isInteger(flags) || flags < 0 || flags > 0xffff) {
    throw new BridgeProtocolError('invalid_frame', 'flags must be an unsigned 16-bit integer');
  }
  if (flags !== 0) throw new BridgeProtocolError('invalid_frame', 'flags must be zero in v0.1');
  if (!Number.isInteger(seq) || seq < 0 || seq > 0xffffffff) {
    throw new BridgeProtocolError('invalid_frame', 'seq must be an unsigned 32-bit integer');
  }
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? []);
  if (body.length > 0xffffffff) throw new BridgeProtocolError('invalid_frame', 'payload is too large');
  const frame = Buffer.allocUnsafe(AUDIO_FRAME_HEADER_BYTES + body.length);
  frame.write('DBA1', 0, 4, 'ascii');
  frame.writeUInt8(version, 4);
  frame.writeUInt8(normalizedDirection, 5);
  frame.writeUInt16BE(flags, 6);
  stream.copy(frame, 8);
  frame.writeUInt32BE(seq, 24);
  frame.writeUInt32BE(body.length, 28);
  body.copy(frame, AUDIO_FRAME_HEADER_BYTES);
  return frame;
}

/** Decode and validate one DBA1 binary frame. */
export function decodeAudioFrame(input, {
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  expectedDirection = null,
  expectedStreamId = null,
  expectedSeq = null,
  format = null,
} = {}) {
  const frame = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (frame.length < AUDIO_FRAME_HEADER_BYTES) {
    throw new BridgeProtocolError('invalid_frame', 'binary frame is shorter than the 32-byte header');
  }
  if (frame.length > maxFrameBytes) {
    throw new BridgeProtocolError('invalid_frame', `binary frame exceeds ${maxFrameBytes} bytes`);
  }
  if (frame.toString('ascii', 0, 4) !== 'DBA1') throw new BridgeProtocolError('invalid_frame', 'binary frame magic must be DBA1');
  const version = frame.readUInt8(4);
  if (version !== AUDIO_FRAME_VERSION) throw new BridgeProtocolError('invalid_frame', `unsupported binary frame version ${version}`);
  const direction = frame.readUInt8(5);
  if (direction !== AUDIO_DIRECTION_UPLINK && direction !== AUDIO_DIRECTION_DOWNLINK) {
    throw new BridgeProtocolError('invalid_frame', 'binary frame direction is invalid');
  }
  const flags = frame.readUInt16BE(6);
  if (flags !== 0) throw new BridgeProtocolError('invalid_frame', 'binary frame flags must be zero');
  const streamId = uuidFromBytes(frame.subarray(8, 24));
  const seq = frame.readUInt32BE(24);
  const payloadLength = frame.readUInt32BE(28);
  if (payloadLength !== frame.length - AUDIO_FRAME_HEADER_BYTES) {
    throw new BridgeProtocolError('payload_length_mismatch', 'binary frame payload length does not match its body', {
      details: { declared: payloadLength, actual: frame.length - AUDIO_FRAME_HEADER_BYTES },
    });
  }
  if (expectedDirection !== null && direction !== normalizeDirection(expectedDirection)) {
    throw new BridgeProtocolError('invalid_frame', 'binary frame direction does not match the stream');
  }
  if (expectedStreamId !== null && streamId !== requireText(expectedStreamId, 'expected_stream_id').toLowerCase()) {
    throw new BridgeProtocolError('invalid_frame', 'binary frame stream UUID does not match the stream');
  }
  if (expectedSeq !== null && seq !== expectedSeq) {
    throw new BridgeProtocolError('sequence_gap', `expected binary frame seq ${expectedSeq}, got ${seq}`, {
      details: { expected: expectedSeq, actual: seq },
    });
  }
  const body = frame.subarray(AUDIO_FRAME_HEADER_BYTES);
  if (format) {
    const normalized = normalizeFormat(format, 'stream.format');
    if (normalized.codec === 'pcm_s16le' && body.length % (2 * normalized.channels) !== 0) {
      throw new BridgeProtocolError('invalid_frame', 'pcm_s16le payload does not end on a complete sample frame');
    }
  }
  return {
    magic: 'DBA1',
    version,
    direction,
    flags,
    stream_id: streamId,
    seq,
    payload_length: payloadLength,
    payload: Buffer.from(body),
  };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export class BridgeProtocolError extends Error {
  constructor(code, message, {
    fatal = false,
    retryable = false,
    details = null,
    closeCode = 1002,
    cause = undefined,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'BridgeProtocolError';
    this.code = code;
    this.errorCode = code;
    this.fatal = fatal;
    this.retryable = retryable;
    this.details = details;
    this.closeCode = closeCode;
  }
}

function normalizeHello(message) {
  normalizeEnvelope(message, {
    expectedType: 'device.hello',
    expectedSchema: 'deskbot.device-hello.v0.1',
    requireCorrelation: true,
  });
  if (!Array.isArray(message.protocol_versions) || message.protocol_versions.length === 0
    || !message.protocol_versions.every((value) => typeof value === 'string' && value.trim() !== '')) {
    throw new BridgeProtocolError('bad_schema', 'protocol_versions must be a non-empty string array');
  }
  if (!isObject(message.capabilities)) throw new BridgeProtocolError('bad_schema', 'capabilities must be an object');
  for (const [key, enabled] of Object.entries(message.capabilities)) {
    requireText(key, 'capability name');
    if (typeof enabled !== 'boolean') throw new BridgeProtocolError('bad_schema', `capabilities.${key} must be boolean`);
  }
  if (!isObject(message.firmware)) {
    // Accept the legacy flat string form for development clients, but always
    // normalize it before handing it to DeviceRegistry.
    if (typeof message.firmware !== 'string' || message.firmware.trim() === '') {
      throw new BridgeProtocolError('bad_schema', 'firmware must be an object or non-empty string');
    }
  } else {
    requireText(message.firmware.name, 'firmware.name');
    requireText(message.firmware.version, 'firmware.version');
  }
  if (!isObject(message.audio)) throw new BridgeProtocolError('bad_schema', 'audio must be an object');
  normalizeFormatList(message.audio.capture_formats, 'audio.capture_formats');
  normalizeFormatList(message.audio.playback_formats, 'audio.playback_formats');
  if (message.binding !== undefined && !isObject(message.binding)) {
    throw new BridgeProtocolError('bad_schema', 'binding must be an object');
  }
  if (message.resume !== undefined && !isObject(message.resume)) {
    throw new BridgeProtocolError('bad_schema', 'resume must be an object');
  }
  return message;
}

function commandEnvelope(command, deviceId, now, roleRevision) {
  return {
    schema: 'deskbot.device-command.v0.1',
    type: 'device.command',
    message_id: `msg-${randomUUID()}`,
    command_id: command.command_id,
    device_id: deviceId,
    occurred_at: now().toISOString(),
    correlation_id: command.correlation_id ?? command.source_event_id ?? command.command_id,
    character_id: command.character_id ?? null,
    shell_id: command.shell_id ?? null,
    role_revision: command.role_revision ?? roleRevision,
    expires_at: command.expires_at ?? null,
    command_type: command.type,
    payload: clone(command.payload ?? {}),
  };
}

// Only errors from a known protocol/domain boundary may expose their code on
// the wire. Generic errors (including database/adapter exceptions) must stay
// opaque and be reported as internal_error.
const DOMAIN_ERROR_NAMES = new Set([
  'AudioArtifactError',
  'BridgeProtocolError',
  'DeviceRegistryError',
  'OutputRouterError',
]);

function isKnownDomainError(error) {
  return Boolean(error) && DOMAIN_ERROR_NAMES.has(error.name);
}

function makeErrorMessage(error, peer, correlationId = null, now = () => new Date()) {
  // Domain adapters (InputError, OutputRouterError, etc.) already expose a
  // stable machine code. Preserve it at the bridge boundary instead of
  // collapsing a useful conflict into an opaque internal_error.
  const expected = isKnownDomainError(error);
  return {
    schema: 'deskbot.bridge-error.v0.1',
    type: 'bridge.error',
    message_id: `msg-${randomUUID()}`,
    device_id: peer?.deviceId ?? null,
    occurred_at: now().toISOString(),
    correlation_id: correlationId ?? peer?.lastCorrelationId ?? null,
    code: expected ? error.code : 'internal_error',
    message: expected ? error.message : 'bridge processing failed',
    retryable: expected ? error.retryable === true : false,
    ...(expected && error.details !== null && error.details !== undefined ? { details: clone(error.details) } : {}),
  };
}

function registryHello(message) {
  const firmware = isObject(message.firmware)
    ? [message.firmware.name, message.firmware.version].filter(Boolean).join('@')
    : message.firmware;
  return {
    device_id: message.device_id,
    hardware: message.hardware
      ?? (isObject(message.firmware) ? message.firmware.source : null)
      ?? 'esp-vocat',
    firmware,
    shell_interface: message.shell_interface ?? 'deskbot.bridge.v0.1',
    capabilities: message.capabilities,
    character_id: message.binding?.character_id ?? message.character_id ?? null,
    shell_id: message.binding?.shell_id ?? message.shell_id ?? null,
  };
}

function eventToFoundry(message, peer, now) {
  const eventType = requireText(message.event_type, 'event_type');
  if (!peer.eventTypes.has(eventType)) {
    throw new BridgeProtocolError('bad_schema', `event_type ${eventType} is not allowed`);
  }
  const eventId = requireText(message.event_id, 'event_id');
  if (!isObject(message.payload)) throw new BridgeProtocolError('bad_schema', 'payload must be an object');
  return {
    schema: 'foundry.event.v0.1',
    event_id: eventId,
    type: eventType,
    source: 'vocat-websocket',
    occurred_at: message.occurred_at ?? now().toISOString(),
    character_id: message.character_id ?? peer.characterId ?? null,
    device_id: peer.deviceId,
    shell_id: message.shell_id ?? peer.shellId ?? null,
    role_revision: message.role_revision ?? peer.roleRevision,
    correlation_id: message.correlation_id,
    payload: {
      ...clone(message.payload),
      ...(message.monotonic_ms === undefined ? {} : { monotonic_ms: message.monotonic_ms }),
    },
  };
}

function isPast(expiresAt, now) {
  return typeof expiresAt === 'string' && validDate(expiresAt) && Date.parse(expiresAt) <= now().getTime();
}

function normalizeAckMessage(message, peer) {
  normalizeEnvelope(message, {
    expectedType: 'device.command.ack',
    expectedSchema: 'deskbot.device-command-ack.v0.1',
    deviceId: peer.deviceId,
    requireCorrelation: true,
  });
  const commandId = requireText(message.command_id, 'command_id');
  const status = requireText(message.status, 'status');
  if (status !== 'completed' && status !== 'failed') {
    throw new BridgeProtocolError('bad_schema', 'status must be completed or failed');
  }
  if (status === 'failed' && (!isObject(message.error) || typeof message.error.code !== 'string' || message.error.code.trim() === '')) {
    throw new BridgeProtocolError('bad_schema', 'failed ACK must include error.code');
  }
  if (message.duplicate !== undefined && typeof message.duplicate !== 'boolean') {
    throw new BridgeProtocolError('bad_schema', 'duplicate must be boolean');
  }
  return {
    ...message,
    command_id: commandId,
    status,
    error: status === 'failed' ? clone(message.error) : null,
  };
}

/**
 * Minimal RFC6455 peer. It handles masking, control frames, fragmentation and
 * bounded frame sizes; application protocol validation remains in the bridge.
 */
class WebSocketPeer {
  constructor(socket, {
    maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
    onText,
    onBinary,
    onClose,
    onPong,
    onError,
  } = {}) {
    this.socket = socket;
    this.maxFrameBytes = maxFrameBytes;
    this.onText = onText;
    this.onBinary = onBinary;
    this.onClose = onClose;
    this.onPong = onPong;
    this.onError = onError;
    this.buffer = Buffer.alloc(0);
    this.fragmentOpcode = null;
    this.fragmentParts = [];
    this.closed = false;
    this.closeSent = false;
    this.socket.on('data', (chunk) => this._consume(chunk));
    this.socket.on('error', (error) => this._fail(error));
    this.socket.on('close', () => this._finishClose());
    this.socket.on('end', () => this._finishClose());
  }

  _consume(chunk) {
    if (this.closed) return;
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    try {
      while (this.buffer.length > 1) {
        const parsed = this._parseOne();
        if (!parsed) break;
        this.buffer = this.buffer.subarray(parsed.consumed);
        this._dispatch(parsed);
        if (this.closed) break;
      }
    } catch (error) {
      this._fail(error);
    }
  }

  _parseOne() {
    if (this.buffer.length < 2) return null;
    const first = this.buffer[0];
    const second = this.buffer[1];
    const fin = (first & 0x80) !== 0;
    const rsv = first & 0x70;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (rsv !== 0) throw new BridgeProtocolError('invalid_frame', 'WebSocket RSV bits are not supported', { fatal: true });
    if (!masked) throw new BridgeProtocolError('invalid_frame', 'client WebSocket frames must be masked', { fatal: true });
    if (length === 126) {
      if (this.buffer.length < offset + 2) return null;
      length = this.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (this.buffer.length < offset + 8) return null;
      const high = this.buffer.readUInt32BE(offset);
      const low = this.buffer.readUInt32BE(offset + 4);
      if (high > 0x1fffff) throw new BridgeProtocolError('invalid_frame', 'WebSocket frame length is too large', { fatal: true });
      length = high * 0x100000000 + low;
      offset += 8;
    }
    const isControl = opcode >= 0x8;
    if (isControl && (!fin || length > 125)) {
      throw new BridgeProtocolError('invalid_frame', 'WebSocket control frames must be final and <=125 bytes', { fatal: true });
    }
    if (length > this.maxFrameBytes) {
      throw new BridgeProtocolError('invalid_frame', `WebSocket frame exceeds ${this.maxFrameBytes} bytes`, { fatal: true });
    }
    if (this.buffer.length < offset + 4 + length) return null;
    const mask = this.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.from(this.buffer.subarray(offset, offset + length));
    for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
    return { consumed: offset + length, fin, opcode, payload };
  }

  _dispatch(frame) {
    const { fin, opcode, payload } = frame;
    if (opcode === 0x8) {
      this._handleClose(payload);
      return;
    }
    if (opcode === 0x9) {
      this.sendFrame(0xA, payload);
      return;
    }
    if (opcode === 0xA) {
      this.onPong?.();
      return;
    }
    if (opcode === 0x0) {
      if (this.fragmentOpcode === null) throw new BridgeProtocolError('invalid_frame', 'unexpected continuation frame', { fatal: true });
      this.fragmentParts.push(payload);
      this.fragmentLength = (this.fragmentLength ?? 0) + payload.length;
      if (this.fragmentLength > this.maxFrameBytes) {
        throw new BridgeProtocolError('invalid_frame', `fragmented WebSocket message exceeds ${this.maxFrameBytes} bytes`, { fatal: true });
      }
      if (!fin) return;
      const full = Buffer.concat(this.fragmentParts);
      const original = this.fragmentOpcode;
      this.fragmentOpcode = null;
      this.fragmentParts = [];
      this.fragmentLength = 0;
      this._dispatch({ fin: true, opcode: original, payload: full });
      return;
    }
    if (opcode !== 0x1 && opcode !== 0x2) throw new BridgeProtocolError('invalid_frame', `unsupported WebSocket opcode ${opcode}`, { fatal: true });
    if (this.fragmentOpcode !== null) throw new BridgeProtocolError('invalid_frame', 'new data frame arrived before fragmented message ended', { fatal: true });
    if (!fin) {
      this.fragmentOpcode = opcode;
      this.fragmentParts = [payload];
      this.fragmentLength = payload.length;
      return;
    }
    if (opcode === 0x1) {
      if (payload.length > MAX_CONTROL_BYTES) throw new BridgeProtocolError('bad_schema', 'control message exceeds size limit');
      this.onText?.(payload.toString('utf8'));
    } else {
      this.onBinary?.(payload);
    }
  }

  _handleClose(payload) {
    if (payload.length === 1) throw new BridgeProtocolError('invalid_frame', 'close frame payload cannot be one byte', { fatal: true });
    if (!this.closeSent) this.sendFrame(0x8, payload);
    this.closeSent = true;
    this.socket.end();
    this.closed = true;
  }

  _fail(error) {
    if (this.closed) return;
    this.onError?.(error);
    const closeCode = error instanceof BridgeProtocolError ? error.closeCode : 1011;
    const reason = error instanceof BridgeProtocolError ? error.message.slice(0, 120) : 'internal error';
    const reasonBytes = Buffer.from(reason, 'utf8').subarray(0, 120);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(closeCode, 0);
    reasonBytes.copy(payload, 2);
    try { this.sendFrame(0x8, payload); } catch { /* socket is already failing */ }
    this.closeSent = true;
    this.closed = true;
    this.socket.end();
  }

  _finishClose() {
    if (this.closed && this._closeNotified) return;
    this.closed = true;
    this._closeNotified = true;
    this.onClose?.();
  }

  sendText(text) {
    const body = Buffer.from(String(text), 'utf8');
    if (body.length > MAX_CONTROL_BYTES) throw new RangeError('control message exceeds size limit');
    this.sendFrame(0x1, body);
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  sendBinary(value) {
    this.sendFrame(0x2, Buffer.isBuffer(value) ? value : Buffer.from(value));
  }

  sendPing(payload = Buffer.alloc(0)) {
    this.sendFrame(0x9, Buffer.from(payload).subarray(0, 125));
  }

  sendFrame(opcode, payload) {
    if (this.closed || this.socket.destroyed) return false;
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? []);
    let header;
    if (body.length < 126) {
      header = Buffer.from([0x80 | opcode, body.length]);
    } else if (body.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(body.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(Math.floor(body.length / 0x100000000), 2);
      header.writeUInt32BE(body.length >>> 0, 6);
    }
    return this.socket.write(Buffer.concat([header, body]));
  }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const reasonBytes = Buffer.from(String(reason), 'utf8').subarray(0, 120);
    const payload = Buffer.alloc(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    reasonBytes.copy(payload, 2);
    this.closeSent = true;
    this.sendFrame(0x8, payload);
    this.socket.end();
    this.closed = true;
  }
}

function acceptKey(key) {
  return createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

function validUpgrade(request) {
  const upgrade = String(request.headers?.upgrade ?? '').toLowerCase();
  const connection = String(request.headers?.connection ?? '').toLowerCase();
  const key = request.headers?.['sec-websocket-key'];
  const version = request.headers?.['sec-websocket-version'];
  return upgrade === 'websocket'
    && connection.split(',').map((value) => value.trim()).includes('upgrade')
    && typeof key === 'string'
    && String(version ?? '') === '13'
    && Buffer.from(key, 'base64').length === 16;
}

function sendHttpError(socket, status = 400, message = 'Bad Request') {
  if (socket.destroyed) return;
  const body = `${status} ${message}\n`;
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function defaultRoleRevision(value) {
  if (typeof value === 'function') return value;
  if (Number.isInteger(value) && value >= 0) return () => value;
  return () => 0;
}

function inferArtifact(audioArtifacts, payload) {
  if (!audioArtifacts || typeof audioArtifacts.read !== 'function') return null;
  const audioId = payload?.audio_id;
  if (typeof audioId !== 'string' || audioId.trim() === '') return null;
  try {
    return audioArtifacts.read(audioId);
  } catch (error) {
    // A storage/database failure does not prove that the artifact is invalid.
    // Keep the command queued so a later poll can retry it.
    throw new BridgeProtocolError(
      'artifact_store_unavailable',
      'audio artifact store is temporarily unavailable',
      { retryable: true, cause: error },
    );
  }
}

function ackError(error, fallbackCode = 'bridge_processing_failed') {
  return {
    code: error?.code ?? fallbackCode,
    message: error?.message ?? fallbackCode,
    ...(error?.details === null || error?.details === undefined ? {} : { details: clone(error.details) }),
  };
}

/**
 * Attach a DeskBot WebSocket bridge to an existing Node HTTP server.
 *
 * Dependencies are intentionally callback-based.  The bridge can therefore be
 * tested in isolation and can be wired to app.mjs' existing inputStore,
 * outputRouter and audioArtifacts without making those modules aware of raw
 * sockets.
 */
export function createWebSocketBridge({
  server = null,
  path = '/ws',
  now = () => new Date(),
  protocolVersion = BRIDGE_PROTOCOL_VERSION,
  captureFormats = DEFAULT_CAPTURE_FORMATS,
  playbackFormats = DEFAULT_PLAYBACK_FORMATS,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  outboxPollIntervalMs = DEFAULT_OUTBOX_POLL_INTERVAL_MS,
  chunkBytes = DEFAULT_CHUNK_BYTES,
  maxAudioBytes = DEFAULT_MAX_AUDIO_BYTES,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
  requireBinding = false,
  target = 'vocat',
  eventTypes = DEFAULT_EVENT_TYPES,
  deviceRegistry = null,
  outputRouter = null,
  audioArtifacts = null,
  inputStore = null,
  stateEngine = null,
  persistentWorld = null,
  evidenceLedger = null,
  onHello = null,
  onEvent = null,
  onAudioStream = null,
  onCommandAck = null,
  getRoleRevision = 0,
} = {}) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new TypeError('path must start with /');
  if (!Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 0) throw new TypeError('heartbeatIntervalMs must be a non-negative integer');
  if (!Number.isInteger(outboxPollIntervalMs) || outboxPollIntervalMs < 0) throw new TypeError('outboxPollIntervalMs must be a non-negative integer');
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 1_048_576) throw new TypeError('chunkBytes must be between 1 and 1048576');
  if (!Number.isInteger(maxAudioBytes) || maxAudioBytes < 1) throw new TypeError('maxAudioBytes must be positive');
  if (!Number.isInteger(maxFrameBytes) || maxFrameBytes < AUDIO_FRAME_HEADER_BYTES) throw new TypeError('maxFrameBytes is too small');

  const peers = new Set();
  const peersByDevice = new Map();
  const roleRevisionResolver = defaultRoleRevision(getRoleRevision);
  let attachedServer = null;
  let upgradeHandler = null;

  function sendError(peer, error, { fatal = false, correlationId = null } = {}) {
    if (!peer || peer.closed) return;
    const message = makeErrorMessage(error, peer, correlationId, now);
    try { peer.ws.sendJson(message); } catch { /* close path */ }
    if (fatal || error?.fatal) peer.ws.close(error?.closeCode ?? 1002, error?.code ?? 'protocol error');
  }

  function clearPeer(peer) {
    if (peer.pollTimer) clearInterval(peer.pollTimer);
    if (peer.heartbeatTimer) clearInterval(peer.heartbeatTimer);
    peers.delete(peer);
    if (peer.deviceId && peersByDevice.get(peer.deviceId) === peer) peersByDevice.delete(peer.deviceId);
    peer.activeStream = null;
    peer.sentCommandIds.clear();
  }

  function sendJson(peer, body) {
    if (!peer.ready || peer.ws.closed) return false;
    peer.ws.sendJson(body);
    return true;
  }

  function makeWelcome(peer, hello, selected, registeredDevice) {
    const bindingCharacter = hello.binding?.character_id ?? hello.character_id ?? registeredDevice?.character_id ?? null;
    const bindingShell = hello.binding?.shell_id ?? hello.shell_id ?? registeredDevice?.shell_id ?? null;
    let roleRevision = 0;
    try {
      const resolved = roleRevisionResolver({
        hello,
        device: registeredDevice,
        character_id: bindingCharacter,
        device_id: peer.deviceId,
      });
      roleRevision = Number.isInteger(resolved) && resolved >= 0 ? resolved : 0;
    } catch {
      roleRevision = 0;
    }
    peer.characterId = bindingCharacter;
    peer.shellId = bindingShell;
    peer.roleRevision = roleRevision;
    peer.captureFormat = selected.capture_format;
    peer.playbackFormat = selected.playback_format;
    peer.lastCorrelationId = hello.correlation_id;
    peer.resume = clone(hello.resume ?? {});
    return {
      schema: 'deskbot.device-welcome.v0.1',
      type: 'device.welcome',
      message_id: `msg-${randomUUID()}`,
      device_id: peer.deviceId,
      occurred_at: now().toISOString(),
      correlation_id: hello.correlation_id,
      protocol_version: protocolVersion,
      capture_format: clone(selected.capture_format),
      playback_format: clone(selected.playback_format),
      character_id: bindingCharacter,
      shell_id: bindingShell,
      role_revision: roleRevision,
      heartbeat_interval_ms: heartbeatIntervalMs,
    };
  }

  function normalizeAndRegisterHello(message) {
    const hello = normalizeHello(message);
    if (protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new BridgeProtocolError('unsupported_protocol', `server protocol ${protocolVersion} is not supported by v0.1 bridge`, { fatal: true });
    }
    if (!hello.protocol_versions.includes(protocolVersion)) {
      throw new BridgeProtocolError('unsupported_protocol', `device does not support ${protocolVersion}`, { fatal: true });
    }
    const bindingCharacter = hello.binding?.character_id ?? hello.character_id ?? null;
    if (requireBinding && (!bindingCharacter || typeof bindingCharacter !== 'string')) {
      throw new BridgeProtocolError('device_not_bound', 'device is not bound to a character', { fatal: true });
    }
    let registered = null;
    if (deviceRegistry?.register) {
      try {
        registered = deviceRegistry.register(registryHello(hello)).device;
      } catch (error) {
        if (error?.code) {
          throw new BridgeProtocolError(error.code, error.message, { details: error.details, fatal: true, cause: error });
        }
        throw error;
      }
    }
    const selected = negotiateAudioFormats({ hello, captureFormats, playbackFormats });
    return { hello, selected, registered };
  }

  async function ingestDefaultEvent(event, peer, message) {
    const saved = inputStore?.save ? inputStore.save(event) : { event, duplicate: false };
    if (saved.duplicate) return { ...saved, world_mutation: null, state: null, evidence: null };
    let worldMutation = null;
    if (persistentWorld?.ingest) worldMutation = persistentWorld.ingest(saved.event);
    let stateResult = null;
    if (stateEngine?.ingest) stateResult = stateEngine.ingest(saved.event);
    let evidence = null;
    if (evidenceLedger?.record) {
      evidence = evidenceLedger.record({ event: saved.event, analysis: stateResult?.analysis ?? null, worldMatches: [] }).evidence;
    }
    return {
      event: saved.event,
      duplicate: false,
      world_mutation: worldMutation,
      state: stateResult?.state ?? null,
      evidence,
      peer,
      message,
    };
  }

  async function handleHello(peer, message) {
    const { hello, selected, registered } = normalizeAndRegisterHello(message);
    const previous = peersByDevice.get(hello.device_id);
    if (previous && previous !== peer) previous.ws.close(1000, 'replaced by reconnect');
    peer.deviceId = hello.device_id;
    peersByDevice.set(peer.deviceId, peer);
    peer.eventTypes = eventTypes instanceof Set ? eventTypes : new Set(eventTypes);
    const welcome = makeWelcome(peer, hello, selected, registered);
    peer.ready = true;
    peer.phase = 'idle';
    peer.ws.sendJson(welcome);
    if (heartbeatIntervalMs > 0) {
      peer.heartbeatTimer = setInterval(() => {
        if (peer.ws.closed) return;
        const elapsed = Date.now() - peer.lastPongAt;
        if (elapsed > heartbeatIntervalMs * 2.5) {
          peer.ws.close(1001, 'heartbeat timeout');
          return;
        }
        peer.ws.sendPing();
      }, heartbeatIntervalMs);
      peer.heartbeatTimer.unref?.();
    }
    if (outboxPollIntervalMs > 0) {
      peer.pollTimer = setInterval(() => {
        void pollOutbox(peer);
      }, outboxPollIntervalMs);
      peer.pollTimer.unref?.();
    }
    await onHello?.({ hello: clone(hello), welcome: clone(welcome), device: clone(registered), peer });
    await pollOutbox(peer);
  }

  async function handleAudioStart(peer, message) {
    normalizeEnvelope(message, {
      expectedType: 'audio.start',
      expectedSchema: 'deskbot.audio-control.v0.1',
      deviceId: peer.deviceId,
      requireCorrelation: true,
    });
    if (message.direction !== 'uplink') throw new BridgeProtocolError('bad_schema', 'audio.start direction must be uplink');
    if (peer.phase !== 'idle') throw new BridgeProtocolError('busy_half_duplex', `device is in ${peer.phase} phase`, { retryable: true });
    const streamId = requireText(message.stream_id, 'stream_id').toLowerCase();
    uuidBytes(streamId, 'stream_id');
    const utteranceId = requireText(message.utterance_id, 'utterance_id');
    const format = normalizeFormat(message.format, 'format');
    if (!formatsEqual(format, peer.captureFormat)) throw new BridgeProtocolError('unsupported_audio_format', 'audio.start format does not match negotiated capture format');
    peer.activeStream = {
      stream_id: streamId,
      utterance_id: utteranceId,
      correlation_id: message.correlation_id,
      event_id: message.event_id ?? null,
      format,
      nextSeq: 0,
      byteCount: 0,
      chunks: [],
      roleRevision: message.role_revision ?? peer.roleRevision,
      startedAt: message.occurred_at,
    };
    peer.lastCorrelationId = message.correlation_id;
    peer.phase = 'capturing';
    await peer.onAudioStart?.({ message: clone(message), peer });
  }

  async function handleAudioEnd(peer, message) {
    normalizeEnvelope(message, {
      expectedType: 'audio.end',
      expectedSchema: 'deskbot.audio-control.v0.1',
      deviceId: peer.deviceId,
      requireCorrelation: true,
    });
    if (message.direction !== 'uplink') throw new BridgeProtocolError('bad_schema', 'audio.end direction must be uplink');
    const stream = peer.activeStream;
    if (!stream || stream.stream_id !== requireText(message.stream_id, 'stream_id').toLowerCase()) {
      throw new BridgeProtocolError('stream_not_started', 'audio.end does not match an active stream');
    }
    const expectedLastSeq = stream.nextSeq - 1;
    if (!Number.isInteger(message.last_seq) || message.last_seq !== expectedLastSeq) {
      peer.activeStream = null;
      peer.phase = 'idle';
      throw new BridgeProtocolError('sequence_gap', 'audio.end last_seq does not match received chunks', {
        details: { expected: expectedLastSeq, actual: message.last_seq },
      });
    }
    if (!Number.isInteger(message.byte_count) || message.byte_count !== stream.byteCount) {
      peer.activeStream = null;
      peer.phase = 'idle';
      throw new BridgeProtocolError('payload_length_mismatch', 'audio.end byte_count does not match received chunks', {
        details: { expected: stream.byteCount, actual: message.byte_count },
      });
    }
    const buffer = Buffer.concat(stream.chunks);
    peer.activeStream = null;
    peer.phase = 'waiting_reply';
    const result = {
      schema: 'deskbot.audio-stream.v0.1',
      device_id: peer.deviceId,
      character_id: peer.characterId,
      shell_id: peer.shellId,
      stream_id: stream.stream_id,
      utterance_id: stream.utterance_id,
      correlation_id: stream.correlation_id,
      format: clone(stream.format),
      byte_count: buffer.length,
      last_seq: expectedLastSeq,
      reason: message.reason ?? 'unknown',
      role_revision: stream.roleRevision,
      data: buffer,
      peer,
    };
    try {
      await onAudioStream?.(result);
    } catch (error) {
      peer.phase = 'idle';
      throw error;
    }
    peer.phase = 'idle';
    sendJson(peer, {
      schema: 'deskbot.audio-stream-accepted.v0.1',
      type: 'audio.accepted',
      message_id: `msg-${randomUUID()}`,
      device_id: peer.deviceId,
      occurred_at: now().toISOString(),
      correlation_id: stream.correlation_id,
      stream_id: stream.stream_id,
      utterance_id: stream.utterance_id,
      byte_count: buffer.length,
      last_seq: expectedLastSeq,
    });
  }

  async function handleEvent(peer, message) {
    normalizeEnvelope(message, {
      expectedType: 'device.event',
      expectedSchema: 'deskbot.device-event.v0.1',
      deviceId: peer.deviceId,
      requireCorrelation: true,
    });
    const event = eventToFoundry(message, peer, now);
    peer.lastCorrelationId = message.correlation_id;
    const result = onEvent
      ? await onEvent({ event: clone(event), message: clone(message), peer })
      : await ingestDefaultEvent(event, peer, message);
    sendJson(peer, {
      schema: 'deskbot.device-event-accepted.v0.1',
      type: 'device.event.accepted',
      message_id: `msg-${randomUUID()}`,
      device_id: peer.deviceId,
      occurred_at: now().toISOString(),
      correlation_id: message.correlation_id,
      event_id: event.event_id,
      duplicate: result?.duplicate === true,
    });
    return result;
  }

  async function handleAck(peer, message) {
    const ack = normalizeAckMessage(message, peer);
    peer.lastCorrelationId = ack.correlation_id;
    let command;
    try {
      command = await outputRouter?.get?.(ack.command_id);
    } catch (error) {
      // A read-side persistence failure is transient too. Release the local
      // delivery marker so the queued command can be retried on this socket.
      if (!isKnownDomainError(error)) {
        peer.sentCommandIds.delete(ack.command_id);
        peer.inFlightCommands.delete(ack.command_id);
        if (peer.phase === 'playing' && peer.inFlightCommands.size === 0) peer.phase = 'idle';
        throw new BridgeProtocolError('internal_error', 'bridge processing failed', {
          retryable: true,
          cause: error,
        });
      }
      throw error;
    }
    if (command && command.device_id !== peer.deviceId) {
      throw new BridgeProtocolError(
        'command_device_mismatch',
        `command ${ack.command_id} is not assigned to the connected device`,
      );
    }
    let result;
    if (outputRouter?.ack) {
      try {
        result = await outputRouter.ack({
          command_id: ack.command_id,
          device_id: peer.deviceId,
          target,
          status: ack.status,
          source: peer.deviceId,
          occurred_at: ack.occurred_at ?? now().toISOString(),
          correlation_id: ack.correlation_id,
          message_id: ack.message_id,
          monotonic_ms: ack.monotonic_ms,
          role_revision: ack.role_revision,
          duplicate: ack.duplicate,
          payload: ack.result ?? ack.payload ?? {},
          ...(ack.status === 'failed' ? { error: ack.error } : {}),
        });
      } catch (error) {
        if (isKnownDomainError(error)) {
          throw new BridgeProtocolError(error.code, error.message, { details: error.details });
        }
        // An adapter/storage failure leaves the command queued. Release the
        // local delivery marker so the same connection can retry; firmware
        // command_id idempotency prevents a duplicate physical action if the
        // ACK was persisted just before the adapter rejected the call.
        peer.sentCommandIds.delete(ack.command_id);
        peer.inFlightCommands.delete(ack.command_id);
        if (peer.phase === 'playing' && peer.inFlightCommands.size === 0) peer.phase = 'idle';
        throw new BridgeProtocolError('internal_error', 'bridge processing failed', {
          retryable: true,
          cause: error,
        });
      }
    } else {
      result = { duplicate: false, command: null };
    }
    peer.sentCommandIds.delete(ack.command_id);
    if (peer.inFlightCommands.has(ack.command_id)) peer.inFlightCommands.delete(ack.command_id);
    if (peer.phase === 'playing' && peer.inFlightCommands.size === 0) peer.phase = 'idle';
    await onCommandAck?.({ ack: clone(ack), result: clone(result), peer });
    sendJson(peer, {
      schema: 'deskbot.device-command-ack-accepted.v0.1',
      type: 'device.command.ack.accepted',
      message_id: `msg-${randomUUID()}`,
      device_id: peer.deviceId,
      occurred_at: now().toISOString(),
      correlation_id: ack.correlation_id,
      command_id: ack.command_id,
      duplicate: result?.duplicate === true,
      status: ack.status,
    });
    return result;
  }

  async function handleControl(peer, message) {
    if (!peer.ready) {
      if (message?.type !== 'device.hello') {
        throw new BridgeProtocolError('bad_schema', 'first control message must be device.hello', { fatal: true });
      }
      await handleHello(peer, message);
      return;
    }
    if (message?.device_id !== peer.deviceId) {
      throw new BridgeProtocolError('bad_schema', 'device_id does not match the connected device');
    }
    switch (message?.type) {
      case 'audio.start': return handleAudioStart(peer, message);
      case 'audio.end': return handleAudioEnd(peer, message);
      case 'device.event': return handleEvent(peer, message);
      case 'device.command.ack': return handleAck(peer, message);
      case 'device.hello': throw new BridgeProtocolError('bad_schema', 'device.hello is only valid as the first message');
      default: throw new BridgeProtocolError('bad_schema', `unsupported control message type ${message?.type ?? 'unknown'}`);
    }
  }

  async function handleBinary(peer, payload) {
    if (!peer.ready) throw new BridgeProtocolError('stream_not_started', 'binary audio arrived before device.hello', { fatal: true });
    const stream = peer.activeStream;
    if (!stream) throw new BridgeProtocolError('stream_not_started', 'binary audio arrived before audio.start');
    const frame = decodeAudioFrame(payload, {
      maxFrameBytes,
      expectedDirection: AUDIO_DIRECTION_UPLINK,
      expectedStreamId: stream.stream_id,
      expectedSeq: stream.nextSeq,
      format: stream.format,
    });
    if (stream.byteCount + frame.payload.length > maxAudioBytes) {
      peer.activeStream = null;
      peer.phase = 'idle';
      throw new BridgeProtocolError('capture_failed', `audio stream exceeds ${maxAudioBytes} bytes`);
    }
    stream.chunks.push(frame.payload);
    stream.byteCount += frame.payload.length;
    stream.nextSeq += 1;
  }

  function commandPayload(command) {
    return isObject(command.payload) ? command.payload : {};
  }

  async function markLocalCommandFailure(peer, command, code, message) {
    peer.sentCommandIds.add(command.command_id);
    if (!outputRouter?.ack) return;
    try {
      await outputRouter.ack({
        command_id: command.command_id,
        device_id: command.device_id ?? peer.deviceId,
        target: command.target ?? target,
        status: 'failed',
        source: 'deskbot-websocket-bridge',
        occurred_at: now().toISOString(),
        correlation_id: command.correlation_id ?? command.source_event_id ?? command.command_id,
        role_revision: command.role_revision ?? peer.roleRevision ?? null,
        duplicate: false,
        error: { code, message },
        payload: { retryable: false },
      });
    } catch (error) {
      // A local terminal classification is only durable after the ACK write
      // succeeds. If the adapter fails, keep the command retryable and do not
      // let this marker block the current connection forever.
      peer.sentCommandIds.delete(command.command_id);
      peer.inFlightCommands.delete(command.command_id);
      if (peer.phase === 'playing' && peer.inFlightCommands.size === 0) peer.phase = 'idle';
      if (!isKnownDomainError(error)) {
        sendError(peer, new BridgeProtocolError('internal_error', 'bridge processing failed', {
          retryable: true,
          cause: error,
        }), {
          correlationId: command.correlation_id ?? command.source_event_id ?? command.command_id,
        });
      }
    }
  }

function prepareDownlink(peer, command) {
    const payload = commandPayload(command);
    const streamId = requireText(payload.stream_id, 'audio.play.payload.stream_id').toLowerCase();
    uuidBytes(streamId, 'audio.play.payload.stream_id');
    const format = normalizeFormat(payload.format, 'audio.play.payload.format');
    if (!formatsEqual(format, peer.playbackFormat)) {
      throw new BridgeProtocolError('unsupported_audio_format', 'audio.play format does not match negotiated playback format');
    }
    const artifact = inferArtifact(audioArtifacts, payload);
    // An audio.play command without a complete local artifact cannot be
    // meaningfully executed. Do not put a command on the wire and leave the
    // device waiting for a stream that will never arrive.
    if (!artifact || !Buffer.isBuffer(artifact.buffer) || artifact.buffer.length === 0) {
      throw new BridgeProtocolError('playback_failed', 'audio artifact is unavailable or empty');
    }
    if (artifact.audio_id && payload.audio_id && artifact.audio_id !== payload.audio_id) {
      throw new BridgeProtocolError('playback_failed', 'audio artifact ID does not match audio.play payload');
    }
    if (artifact.format && !formatsEqual(normalizeFormat(artifact.format, 'audio_artifact.format'), format)) {
      throw new BridgeProtocolError('playback_failed', 'audio artifact format does not match audio.play format');
    }
    if (payload.byte_count !== undefined && payload.byte_count !== artifact.buffer.length) {
      throw new BridgeProtocolError('playback_failed', 'audio artifact byte_count does not match audio.play payload');
    }
    if (payload.sha256 !== undefined) {
      if (typeof payload.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.sha256.trim())) {
        throw new BridgeProtocolError('playback_failed', 'audio.play sha256 must be a 64-character hexadecimal digest');
      }
      const digest = createHash('sha256').update(artifact.buffer).digest('hex');
      if (payload.sha256.trim().toLowerCase() !== digest) throw new BridgeProtocolError('playback_failed', 'audio artifact sha256 does not match audio.play payload');
    }
    const correlationId = command.correlation_id ?? command.source_event_id ?? command.command_id;
    const start = {
      schema: 'deskbot.audio-control.v0.1',
      type: 'audio.start',
      message_id: `msg-${randomUUID()}`,
      device_id: peer.deviceId,
      occurred_at: now().toISOString(),
      correlation_id: correlationId,
      direction: 'downlink',
      stream_id: streamId,
      utterance_id: streamId,
      command_id: command.command_id,
      role_revision: command.role_revision ?? peer.roleRevision,
      format: clone(format),
      trigger: 'command',
    };
    const data = artifact.buffer;
    const sampleBytes = format.codec === 'pcm_s16le' ? 2 * format.channels : 1;
    const effectiveChunkBytes = format.codec === 'pcm_s16le'
      ? Math.max(sampleBytes, Math.floor(chunkBytes / sampleBytes) * sampleBytes)
      : chunkBytes;
    const frames = [];
    let seq = 0;
    for (let offset = 0; offset < data.length; offset += effectiveChunkBytes) {
      const chunk = data.subarray(offset, Math.min(offset + effectiveChunkBytes, data.length));
      if (chunk.length % sampleBytes !== 0) {
        throw new BridgeProtocolError('playback_failed', 'audio artifact does not end on a complete sample boundary');
      }
      frames.push(encodeAudioFrame({ streamId, seq, direction: AUDIO_DIRECTION_DOWNLINK, payload: chunk }));
      seq += 1;
    }
    const end = {
      schema: 'deskbot.audio-control.v0.1',
      type: 'audio.end',
      message_id: `msg-${randomUUID()}`,
      device_id: peer.deviceId,
      occurred_at: now().toISOString(),
      correlation_id: correlationId,
      direction: 'downlink',
      stream_id: streamId,
      utterance_id: streamId,
      command_id: command.command_id,
      last_seq: seq - 1,
      byte_count: data.length,
      reason: 'complete',
    };
    return { start, frames, end };
  }

function sendPreparedDownlink(peer, prepared) {
    sendJson(peer, prepared.start);
    for (const frame of prepared.frames) peer.ws.sendBinary(frame);
    sendJson(peer, prepared.end);
  }

  async function deliverCommand(peer, command) {
    if (!command || typeof command.command_id !== 'string') return;
    if (peer.sentCommandIds.has(command.command_id)) return;
    // A connection is bound to one device and this bridge serves one target.
    // Keep these checks local even when an injected outbox adapter ignores its
    // filter arguments.
    if (command.device_id !== undefined && command.device_id !== null
      && command.device_id !== peer.deviceId) {
      sendError(peer, new BridgeProtocolError(
        'command_device_mismatch',
        'command belongs to a different device',
      ), { correlationId: command.correlation_id ?? command.command_id });
      return;
    }
    if (command.target !== undefined && command.target !== null && command.target !== target) {
      sendError(peer, new BridgeProtocolError(
        'command_target_mismatch',
        'command target is not served by this bridge',
      ), { correlationId: command.correlation_id ?? command.command_id });
      return;
    }
    if (isPast(command.expires_at, now)) {
      await markLocalCommandFailure(peer, command, 'command_expired', 'command expires_at has passed');
      return;
    }
    if (!SUPPORTED_COMMAND_TYPES.has(command.type)) {
      // `speak` is an internal output plan; only a materialized audio.play is
      // allowed on the firmware wire.
      await markLocalCommandFailure(peer, command, 'command_not_supported', `command type ${command.type} is not allowed on the bridge`);
      return;
    }
    if (command.type === 'audio.play' && peer.phase !== 'idle') {
      // Playback is half-duplex. Leave the command queued until the current
      // capture/reply/playback phase has completed; this is not a terminal
      // device failure.
      return;
    }
    let preparedDownlink = null;
    try {
      // Validate and materialize every downlink frame before putting the
      // command envelope on the wire. A missing/corrupt artifact must not
      // leave the firmware waiting for an audio stream that cannot arrive.
      preparedDownlink = command.type === 'audio.play'
        ? prepareDownlink(peer, command)
        : null;
      if (!sendJson(peer, commandEnvelope(command, peer.deviceId, now, peer.roleRevision))) {
        throw new BridgeProtocolError(
          'bridge_transport_unavailable',
          'device socket is not writable',
          { retryable: true },
        );
      }
      peer.sentCommandIds.add(command.command_id);
      peer.inFlightCommands.set(command.command_id, command);
      if (preparedDownlink) {
        peer.phase = 'playing';
        sendPreparedDownlink(peer, preparedDownlink);
      }
    } catch (error) {
      peer.inFlightCommands.delete(command.command_id);
      if (error?.retryable === true) {
        // Keep the command queued for a later poll/reconnect. A retry starts
        // the downlink stream at sequence zero as required by v0.1.
        peer.sentCommandIds.delete(command.command_id);
        sendError(peer, error, {
          correlationId: command.correlation_id ?? command.source_event_id ?? command.command_id,
        });
      } else if (error instanceof BridgeProtocolError) {
        await markLocalCommandFailure(peer, command, error.code, error.message);
      } else {
        // Unknown adapter/storage failures are transient from the bridge's
        // perspective. Keep the command queued for retry and do not claim a
        // device playback failure that was never observed.
        peer.sentCommandIds.delete(command.command_id);
        sendError(peer, error, {
          correlationId: command.correlation_id ?? command.source_event_id ?? command.command_id,
        });
      }
      if (peer.phase === 'playing') peer.phase = 'idle';
    }
  }

  async function pollOutbox(peer) {
    if (!peer.ready || peer.polling || peer.ws.closed || !outputRouter?.listQueued) return;
    peer.polling = true;
    try {
      const commands = outputRouter.listQueued({ target, device_id: peer.deviceId, limit: 100 });
      for (const command of commands) {
        // Keep the target boundary local as well as in the router call. This
        // protects the device when an injected adapter ignores filter hints.
        if (command?.target !== undefined && command.target !== target) continue;
        if (command?.device_id !== undefined && command.device_id !== null && command.device_id !== peer.deviceId) continue;
        await deliverCommand(peer, command);
      }
    } catch (error) {
      // This function is called from a timer as well as the hello path. Never
      // let an outbox/persistence rejection become an unhandled promise.
      sendError(peer, error, { correlationId: peer.lastCorrelationId });
    } finally {
      peer.polling = false;
    }
  }

  function onPeerText(peer, text) {
    if (typeof text !== 'string' || text.length > MAX_CONTROL_BYTES) {
      sendError(peer, new BridgeProtocolError('bad_schema', 'control message is too large'));
      return;
    }
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      sendError(peer, new BridgeProtocolError('bad_schema', 'control message must be valid JSON'));
      return;
    }
    peer.queue = peer.queue
      .then(() => handleControl(peer, message))
      .catch((error) => {
        const fatal = error instanceof BridgeProtocolError && error.fatal === true;
        sendError(peer, error, { fatal, correlationId: message?.correlation_id ?? null });
      });
  }

  function onPeerBinary(peer, payload) {
    peer.queue = peer.queue
      .then(() => handleBinary(peer, payload))
      .catch((error) => {
        // A malformed or out-of-order chunk invalidates the whole utterance;
        // keeping it active would make a later chunk appear to repair a stream
        // that the contract requires to be restarted from seq 0.
        if (error?.code && error.code !== 'stream_not_started') {
          peer.activeStream = null;
          if (peer.phase === 'capturing') peer.phase = 'idle';
        }
        sendError(peer, error, { fatal: error instanceof BridgeProtocolError && error.fatal === true });
      });
  }

  function handleUpgrade(request, socket, head = Buffer.alloc(0)) {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    if (requestUrl.pathname !== path) {
      sendHttpError(socket, 404, 'Not Found');
      return false;
    }
    if (!validUpgrade(request)) {
      sendHttpError(socket, 400, 'Bad Request');
      return false;
    }
    const key = request.headers['sec-websocket-key'];
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '',
      '',
    ].join('\r\n'));
    socket.setNoDelay?.(true);
    const peer = {
      id: randomUUID(),
      ws: null,
      ready: false,
      closed: false,
      phase: 'awaiting_hello',
      deviceId: null,
      characterId: null,
      shellId: null,
      roleRevision: 0,
      captureFormat: null,
      playbackFormat: null,
      eventTypes: new Set(eventTypes),
      activeStream: null,
      sentCommandIds: new Set(),
      inFlightCommands: new Map(),
      queue: Promise.resolve(),
      lastPongAt: Date.now(),
      lastCorrelationId: null,
      heartbeatTimer: null,
      pollTimer: null,
      polling: false,
      onAudioStart: null,
    };
    const cleanup = () => {
      if (peer.closed) {
        clearPeer(peer);
        return;
      }
      peer.closed = true;
      clearPeer(peer);
    };
    peer.ws = new WebSocketPeer(socket, {
      maxFrameBytes,
      onText: (text) => onPeerText(peer, text),
      onBinary: (payload) => onPeerBinary(peer, payload),
      onPong: () => { peer.lastPongAt = Date.now(); },
      onClose: cleanup,
      onError: (error) => {
        if (!(error instanceof BridgeProtocolError)) sendError(peer, error);
      },
    });
    peers.add(peer);
    if (head?.length) peer.ws._consume(head);
    return true;
  }

  function attach(nextServer = server) {
    if (!nextServer || typeof nextServer.on !== 'function') throw new TypeError('an HTTP server is required');
    if (attachedServer) return bridge;
    attachedServer = nextServer;
    upgradeHandler = (request, socket, head) => {
      try {
        handleUpgrade(request, socket, head);
      } catch {
        sendHttpError(socket, 400, 'Bad Request');
      }
    };
    attachedServer.on('upgrade', upgradeHandler);
    return bridge;
  }

  function close() {
    for (const peer of [...peers]) peer.ws.close(1001, 'bridge shutting down');
    peers.clear();
    peersByDevice.clear();
    if (attachedServer && upgradeHandler) attachedServer.off('upgrade', upgradeHandler);
    attachedServer = null;
    upgradeHandler = null;
  }

  const bridge = {
    attach,
    close,
    handleUpgrade,
    peers: () => [...peers].map((peer) => ({
      id: peer.id,
      device_id: peer.deviceId,
      character_id: peer.characterId,
      phase: peer.phase,
      ready: peer.ready,
      capture_format: clone(peer.captureFormat),
      playback_format: clone(peer.playbackFormat),
    })),
    getPeer: (deviceId) => {
      const peer = peersByDevice.get(deviceId);
      return peer ? {
        id: peer.id,
        device_id: peer.deviceId,
        character_id: peer.characterId,
        phase: peer.phase,
        ready: peer.ready,
      } : null;
    },
    sendCommand: async (deviceId, command) => {
      const peer = peersByDevice.get(deviceId);
      if (!peer) return false;
      await deliverCommand(peer, command);
      return true;
    },
  };

  if (server) attach(server);
  return bridge;
}

// Naming alias used by a few integration callers.
export const attachWebSocketBridge = createWebSocketBridge;

export {
  formatsEqual,
  normalizeFormat,
  normalizeEnvelope,
};
