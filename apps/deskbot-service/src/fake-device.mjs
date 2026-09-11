import { createHash } from 'node:crypto';

function clone(value) {
  return structuredClone(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function commandPayloadFingerprint(command) {
  // The firmware's idempotency key covers the executable command, not just
  // its free-form payload. Otherwise the same ID could switch from an empty
  // render action to audio.play without being detected.
  const canonical = stableStringify({
    type: command?.type ?? command?.command_type ?? null,
    target: command?.target ?? null,
    device_id: command?.device_id ?? null,
    payload: command?.payload ?? {},
  }) ?? 'null';
  return createHash('sha256').update(canonical).digest('hex');
}

export class FakeDeviceError extends Error {
  constructor(code, message, { statusCode = 502, retryable = false, details = null, cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FakeDeviceError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
  }
}

function requireOk(response, operation) {
  const ok = typeof response?.ok === 'boolean'
    ? response.ok
    : Number.isInteger(response?.status) && response.status >= 200 && response.status < 300;
  if (ok) return response;
  const statusCode = response?.status || 502;
  const operationCode = operation.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  throw new FakeDeviceError(
    `${operationCode}_http_error`,
    `fake device ${operation} failed with HTTP ${response.status}`,
    {
      statusCode,
      retryable: statusCode === 408 || statusCode === 425 || statusCode === 429 || statusCode >= 500,
    },
  );
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('baseUrl must be a non-empty URL');
  }
  const normalized = value.trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL without credentials');
  }
  return normalized;
}

function header(response, name) {
  const fromHeaders = response.headers?.get?.(name);
  if (fromHeaders !== undefined && fromHeaders !== null) return fromHeaders;
  if (response.headers && typeof response.headers === 'object') {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(response.headers)) {
      if (key.toLowerCase() === lowerName) return String(value);
    }
  }
  return null;
}

function normalizeExpectedFormat(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FakeDeviceError('audio_format_invalid', 'audio.play format must be an object', { statusCode: 400 });
  }
  const codec = value.codec ?? value.encoding;
  const sampleRate = value.sample_rate_hz;
  const channels = value.channels;
  if (typeof codec !== 'string' || codec.trim() === ''
    || !Number.isInteger(sampleRate) || sampleRate < 1
    || !Number.isInteger(channels) || channels < 1) {
    throw new FakeDeviceError('audio_format_invalid', 'audio.play format is invalid', { statusCode: 400 });
  }
  return { codec: codec.trim().toLowerCase(), sample_rate_hz: sampleRate, channels };
}

function resolveAudioUrl(baseUrl, audioRef) {
  if (typeof audioRef !== 'string' || audioRef.trim() === '') {
    throw new FakeDeviceError('audio_artifact_missing_ref', 'audio.play requires audio_ref or audio_id', { statusCode: 400 });
  }
  let base;
  let resolved;
  try {
    base = new URL(baseUrl);
    resolved = new URL(audioRef, `${baseUrl}/`);
  } catch {
    throw new FakeDeviceError('audio_artifact_invalid_ref', 'audio.play audio_ref is not a valid URL');
  }
  if (resolved.origin !== base.origin || resolved.username || resolved.password) {
    throw new FakeDeviceError('audio_artifact_cross_origin', 'audio.play audio_ref must use the configured device service origin', {
      statusCode: 400,
      details: { origin: resolved.origin },
    });
  }
  return resolved.href;
}

function compareAudioFormat(expected, response) {
  if (!expected) {
    return {
      format_verified: false,
      format: {
        codec: header(response, 'x-audio-codec'),
        sample_rate_hz: Number.parseInt(header(response, 'x-audio-sample-rate-hz') ?? '', 10) || null,
        channels: Number.parseInt(header(response, 'x-audio-channels') ?? '', 10) || null,
      },
    };
  }
  const actual = {
    codec: header(response, 'x-audio-codec')?.trim().toLowerCase() ?? null,
    sample_rate_hz: Number.parseInt(header(response, 'x-audio-sample-rate-hz') ?? '', 10) || null,
    channels: Number.parseInt(header(response, 'x-audio-channels') ?? '', 10) || null,
  };
  if (actual.codec === null || actual.sample_rate_hz === null || actual.channels === null) {
    throw new FakeDeviceError('audio_format_missing', 'audio artifact response is missing format metadata', {
      details: { expected, actual },
    });
  }
  const mismatches = [];
  if (actual.codec !== null && actual.codec !== expected.codec) mismatches.push('codec');
  if (actual.sample_rate_hz !== null && actual.sample_rate_hz !== expected.sample_rate_hz) mismatches.push('sample_rate_hz');
  if (actual.channels !== null && actual.channels !== expected.channels) mismatches.push('channels');
  if (mismatches.length > 0) {
    throw new FakeDeviceError('audio_format_mismatch', 'audio.play artifact format does not match the command', {
      details: { expected, actual, mismatches },
    });
  }
  return {
    format_verified: actual.codec !== null && actual.sample_rate_hz !== null && actual.channels !== null,
    format: actual,
  };
}

async function verifyAudioArtifact({ payload, baseUrl, fetchImpl }) {
  const audioPayload = payload?.audio && typeof payload.audio === 'object' && !Array.isArray(payload.audio)
    ? { ...payload.audio, ...payload }
    : (payload ?? {});
  const audioId = audioPayload.audio_id ?? null;
  const audioRef = audioPayload.audio_ref
    ?? (typeof audioId === 'string' && audioId.trim() !== '' ? `/api/audio/${encodeURIComponent(audioId)}` : null);
  const url = resolveAudioUrl(baseUrl, audioRef);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'audio/*, application/octet-stream' },
    });
  } catch (error) {
    throw new FakeDeviceError('audio_artifact_fetch_failed', 'fake device could not fetch the audio artifact', {
      retryable: true,
      cause: error,
    });
  }
  requireOk(response, 'audio artifact');
  if (typeof response.arrayBuffer !== 'function') {
    throw new FakeDeviceError('audio_artifact_invalid_response', 'audio artifact response has no binary body');
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new FakeDeviceError('audio_artifact_invalid_response', 'audio artifact response body could not be read', { cause: error });
  }

  const expectedByteCount = audioPayload.byte_count ?? null;
  if (expectedByteCount !== null && (!Number.isInteger(expectedByteCount) || expectedByteCount < 0)) {
    throw new FakeDeviceError('audio_byte_count_invalid', 'audio.play byte_count must be a non-negative integer', { statusCode: 400 });
  }
  if (expectedByteCount !== null && bytes.byteLength !== expectedByteCount) {
    throw new FakeDeviceError('audio_byte_count_mismatch', 'audio artifact byte_count does not match the command', {
      details: { expected: expectedByteCount, actual: bytes.byteLength },
    });
  }

  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  const expectedSha256 = audioPayload.sha256 ?? audioPayload.audio_sha256 ?? null;
  if (expectedSha256 !== null) {
    if (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedSha256.trim())) {
      throw new FakeDeviceError('audio_sha256_invalid', 'audio.play sha256 must be a 64-character hexadecimal digest', { statusCode: 400 });
    }
    if (actualSha256 !== expectedSha256.trim().toLowerCase()) {
      throw new FakeDeviceError('audio_sha256_mismatch', 'audio artifact sha256 does not match the command', {
        details: { expected: expectedSha256.trim().toLowerCase(), actual: actualSha256 },
      });
    }
  }

  const format = compareAudioFormat(normalizeExpectedFormat(audioPayload.format), response);
  const responseAudioId = header(response, 'x-audio-id');
  if (audioId !== null && responseAudioId !== null && responseAudioId !== audioId) {
    throw new FakeDeviceError('audio_id_mismatch', 'audio artifact ID does not match the command', {
      details: { expected: audioId, actual: responseAudioId },
    });
  }
  return {
    audio_id: audioId ?? responseAudioId,
    audio_ref: audioRef,
    byte_count: bytes.byteLength,
    sha256: actualSha256,
    ...format,
  };
}

export function createFakeDevice({
  baseUrl = 'http://127.0.0.1:4311',
  deviceId,
  hello,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof deviceId !== 'string' || deviceId.trim() === '') throw new TypeError('deviceId is required');
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  const executed = new Map();
  const commandFingerprints = new Map();

  async function helloDevice() {
    const response = await fetchImpl(`${normalizedBaseUrl}/api/devices/hello`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_id: deviceId,
        hardware: 'fake-device',
        firmware: 'fake-device-v0.1',
        shell_interface: 'shell-interface.v1',
        capabilities: {
          'audio.capture': true,
          'audio.playback': true,
          'display.expression': true,
          'orientation.base_yaw': true,
          ...(hello?.capabilities ?? {}),
        },
        ...(hello ?? {}),
      }),
    });
    requireOk(response, 'hello');
    return response.json();
  }

  async function acknowledge(commandId, result, { duplicate = false } = {}) {
    const status = result?.status === 'failed' ? 'failed' : 'completed';
    const error = status === 'failed' && result?.error && typeof result.error === 'object'
      ? result.error
      : null;
    const response = await fetchImpl(`${normalizedBaseUrl}/api/outbox/${encodeURIComponent(commandId)}/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status,
        device_id: deviceId,
        duplicate,
        source: 'fake-device',
        payload: result,
        ...(error ? { error } : {}),
      }),
    });
    requireOk(response, 'ack');
    return response.json();
  }

  async function pollOnce() {
    const query = new URLSearchParams({ target: 'fake-device', device_id: deviceId });
    const response = await fetchImpl(`${normalizedBaseUrl}/api/outbox?${query}`);
    requireOk(response, 'poll');
    const body = await response.json();
    const processed = [];

    for (const command of body.commands ?? []) {
      const commandFingerprint = commandPayloadFingerprint(command);
      let execution;
      let duplicate = false;
      if (executed.has(command.command_id)) {
        if (commandFingerprints.get(command.command_id) !== commandFingerprint) {
          // The firmware contract forbids reusing an ID for a different
          // payload. Preserve the first execution and report a conflict.
          execution = {
            command_id: command.command_id,
            type: command.type,
            payload: clone(command.payload),
            simulated: true,
            status: 'failed',
            error: {
              code: 'command_conflict',
              message: 'command_id was already used with a different payload',
            },
          };
          const result = await acknowledge(command.command_id, execution);
          processed.push(result.command);
          continue;
        }
        duplicate = true;
      } else {
        execution = {
          command_id: command.command_id,
          type: command.type,
          payload: clone(command.payload),
          simulated: true,
        };
        try {
          if (command.type === 'audio.play') {
            execution.audio = await verifyAudioArtifact({
              payload: command.payload,
              baseUrl: normalizedBaseUrl,
              fetchImpl,
            });
          }
          execution.status = 'completed';
        } catch (error) {
          const deviceError = error instanceof FakeDeviceError
            ? error
            : new FakeDeviceError('device_execution_failed', 'fake device command execution failed', {
              retryable: false,
              cause: error,
            });
          // Transport/timeouts are expected to be retried by polling the
          // still-queued command. Deterministic protocol/artifact failures
          // are terminal for this command and receive a failed ACK.
          if (deviceError.retryable) throw deviceError;
          execution.status = 'failed';
          execution.error = {
            code: deviceError.code,
            message: deviceError.message,
            ...(deviceError.details === null || deviceError.details === undefined
              ? {}
              : { details: clone(deviceError.details) }),
          };
        }
        executed.set(command.command_id, execution);
        commandFingerprints.set(command.command_id, commandFingerprint);
      }
      execution = executed.get(command.command_id);
      const result = await acknowledge(command.command_id, execution, { duplicate });
      processed.push(result.command);
    }

    return {
      fetched: body.commands?.length ?? 0,
      processed,
    };
  }

  return {
    acknowledge,
    executed: () => [...executed.values()].map(clone),
    hello: helloDevice,
    pollOnce,
  };
}
