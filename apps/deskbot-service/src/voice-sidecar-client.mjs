import { randomUUID } from 'node:crypto';

import { DEFAULT_TTS_PROFILE } from './world-definition.mjs';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_BASE_URL = 'http://127.0.0.1:4321';
const DEFAULT_ASR_PATH = '/v1/asr';
const DEFAULT_TTS_PATH = '/v1/tts';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export class VoiceSidecarError extends Error {
  constructor(statusCode, code, message, {
    retryable = false,
    requestId = null,
    correlationId = null,
    details = null,
    cause = undefined,
  } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'VoiceSidecarError';
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
    this.errorCode = code;
    this.retryable = retryable;
    this.requestId = requestId;
    this.request_id = requestId;
    this.correlationId = correlationId;
    this.correlation_id = correlationId;
    this.details = details;
  }
}

class VoiceAbortError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'VoiceAbortError';
    this.reason = reason;
  }
}

function invalidRequest(message, options = {}) {
  return new VoiceSidecarError(400, 'invalid_request', message, options);
}

function withRequestContext(error, request) {
  if (!(error instanceof VoiceSidecarError)) return error;
  if (error.requestId === null || error.requestId === undefined) {
    error.requestId = request.request_id ?? null;
    error.request_id = error.requestId;
  }
  if (error.correlationId === null || error.correlationId === undefined) {
    error.correlationId = request.correlation_id ?? null;
    error.correlation_id = error.correlationId;
  }
  return error;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest(`${field} must be an object`);
  }
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidRequest(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value, field, { allowEmpty = false } = {}) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw invalidRequest(`${field} must be a string`);
  if (!allowEmpty && value.trim() === '') throw invalidRequest(`${field} must be a non-empty string`);
  return allowEmpty ? value : value.trim();
}

function responseText(value, field, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw new VoiceSidecarError(502, 'invalid_response', `${field} must be a string`);
  return value;
}

function responseId(value, fallback, field) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new VoiceSidecarError(502, 'invalid_response', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeTimeout(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw invalidRequest(`timeout_ms must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return value;
}

function normalizeCallOptions(options, fallbackTimeout, bodyTimeout = undefined) {
  if (options === undefined || options === null) options = {};
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw invalidRequest('call options must be an object');
  }
  const signal = options.signal ?? null;
  if (signal !== null && (typeof signal !== 'object' || typeof signal.addEventListener !== 'function')) {
    throw invalidRequest('signal must be an AbortSignal');
  }
  const requestedTimeout = options.timeoutMs ?? options.timeout_ms ?? options.timeout ?? bodyTimeout;
  return { timeout: normalizeTimeout(requestedTimeout, fallbackTimeout), signal };
}

function normalizePath(value, field, fallback) {
  const path = value === undefined || value === null ? fallback : requireText(value, field);
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeBaseUrl(value) {
  const raw = requireText(value, 'base_url').replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('baseUrl must be an absolute HTTP(S) URL without credentials');
  }
  return raw;
}

function joinUrl(baseUrl, path) {
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeFormat(value, field = 'format', defaults = {}) {
  if (value === undefined || value === null) value = {};
  if (typeof value === 'string') value = { codec: value };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRequest(`${field} must be an object or codec string`);
  }
  const codec = value.codec ?? value.encoding ?? defaults.codec;
  if (typeof codec !== 'string' || codec.trim() === '') {
    throw invalidRequest(`${field}.codec must be a non-empty string`);
  }
  const sampleRate = value.sample_rate_hz ?? defaults.sample_rate_hz;
  const channels = value.channels ?? defaults.channels;
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192_000) {
    throw invalidRequest(`${field}.sample_rate_hz must be a positive integer`);
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw invalidRequest(`${field}.channels must be an integer between 1 and 8`);
  }
  return { codec: codec.trim(), sample_rate_hz: sampleRate, channels };
}

function normalizeResponseFormat(value, request, defaults = {}) {
  try {
    return normalizeFormat(value, 'audio', defaults);
  } catch (error) {
    if (error instanceof VoiceSidecarError && error.code === 'invalid_request') {
      throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar returned an invalid audio format', {
        requestId: request.request_id,
        correlationId: request.correlation_id,
        cause: error,
      });
    }
    throw error;
  }
}

function encodeAudio(value, field = 'audio') {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.base64 === 'string') return value.base64;
    if (typeof value.data_base64 === 'string') return value.data_base64;
    if (typeof value.audio_b64 === 'string') return value.audio_b64;
    if (typeof value.data === 'string') return value.data;
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  throw invalidRequest(`${field} must be base64 text, bytes, or an audio object`);
}

function decodeBase64(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new VoiceSidecarError(502, 'invalid_response', `${field} must be a non-empty base64 string`);
  }
  const encoded = value.replace(/\s+/g, '');
  let buffer;
  try {
    buffer = Buffer.from(encoded, 'base64');
  } catch {
    throw new VoiceSidecarError(502, 'invalid_response', `${field} is not valid base64`);
  }
  const canonicalInput = encoded.replace(/=+$/, '');
  const canonicalOutput = buffer.toString('base64').replace(/=+$/, '');
  if (!buffer.length || canonicalInput !== canonicalOutput) {
    throw new VoiceSidecarError(502, 'invalid_response', `${field} is not valid base64`);
  }
  return { encoded, buffer };
}

function validateConfidence(value, field, statusCode = 502) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new VoiceSidecarError(statusCode, 'invalid_response', `${field} must be a number between 0 and 1`);
  }
  return value;
}

function makeAbortContext(signal, timeout) {
  const controller = new AbortController();
  let timer = null;
  let reason = null;
  let rejectAbort;
  const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = (nextReason, sourceReason = undefined) => {
    if (reason !== null) return;
    reason = nextReason;
    try { controller.abort(sourceReason); } catch { controller.abort(); }
    rejectAbort(new VoiceAbortError(nextReason));
  };
  const onCallerAbort = () => abort('cancelled', signal?.reason);
  if (signal?.aborted) onCallerAbort();
  else signal?.addEventListener('abort', onCallerAbort, { once: true });
  timer = setTimeout(() => abort('timeout'), timeout);
  timer.unref?.();
  return {
    signal: controller.signal,
    abortPromise,
    get reason() { return reason; },
    cleanup() {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onCallerAbort);
    },
  };
}

function abortFailure(context, callerSignal, error, request) {
  let reason = context.reason;
  if (!reason && callerSignal?.aborted) reason = 'cancelled';
  if (!reason && error?.name === 'TimeoutError') reason = 'timeout';
  if (!reason && error?.name === 'AbortError') reason = 'cancelled';
  if (reason === 'timeout') {
    return new VoiceSidecarError(408, 'timeout', 'voice sidecar request timed out', {
      retryable: true, requestId: request.request_id ?? null, correlationId: request.correlation_id ?? null, cause: error,
    });
  }
  if (reason === 'cancelled') {
    return new VoiceSidecarError(499, 'cancelled', 'voice sidecar request was cancelled', {
      retryable: false, requestId: request.request_id ?? null, correlationId: request.correlation_id ?? null, cause: error,
    });
  }
  return new VoiceSidecarError(503, 'transport_error', 'voice sidecar request failed', {
    retryable: true, requestId: request.request_id ?? null, correlationId: request.correlation_id ?? null, cause: error,
  });
}

function responseStatus(response) {
  return Number.isInteger(response?.status) ? response.status : 0;
}

function responseOk(response) {
  const status = responseStatus(response);
  return typeof response?.ok === 'boolean' ? response.ok : status >= 200 && status < 300;
}

function errorFromPayload(response, payload, request) {
  const status = responseStatus(response) || 502;
  const nested = payload?.error && typeof payload.error === 'object' && !Array.isArray(payload.error)
    ? payload.error
    : payload;
  const code = typeof nested?.code === 'string' && nested.code.trim() !== '' ? nested.code.trim() : 'sidecar_http_error';
  const message = typeof nested?.message === 'string' && nested.message.trim() !== ''
    ? nested.message
    : `voice sidecar returned HTTP ${status}`;
  const requestId = responseId(payload?.request_id ?? nested?.request_id, request.request_id ?? null, 'request_id');
  const correlationId = responseId(payload?.correlation_id ?? nested?.correlation_id, request.correlation_id ?? null, 'correlation_id');
  return new VoiceSidecarError(status, code, message, {
    retryable: nested?.retryable === true || status === 408 || status === 429 || status >= 500,
    requestId,
    correlationId,
    details: nested?.details ?? null,
  });
}

function normalizeAsrResult(body, request) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar returned a non-object ASR response', {
      requestId: request.request_id, correlationId: request.correlation_id,
    });
  }
  if (body.ok !== undefined && body.ok !== true) {
    throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar ASR response is not marked ok', {
      requestId: request.request_id, correlationId: request.correlation_id,
    });
  }
  const inheritedStage = body.stage
    ?? (body.is_final === true || body.final === true ? 'final' : body.partial === true ? 'partial' : null);
  const rawResults = Array.isArray(body.results) ? body.results : [body];
  const results = rawResults.map((result, index) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new VoiceSidecarError(502, 'invalid_response', `voice sidecar ASR result ${index} is invalid`, {
        requestId: request.request_id, correlationId: request.correlation_id,
      });
    }
    const stage = result.stage
      ?? (result.is_final === true || result.final === true ? 'final' : result.partial === true ? 'partial' : inheritedStage);
    if (stage !== 'partial' && stage !== 'final') {
      throw new VoiceSidecarError(502, 'invalid_response', `voice sidecar ASR result ${index} has invalid stage`, {
        requestId: request.request_id, correlationId: request.correlation_id,
      });
    }
    const raw = responseText(result.raw_utterance ?? result.raw_text ?? result.text, `results[${index}].raw_utterance`);
    const clean = responseText(result.clean_utterance ?? result.cleaned_text ?? result.text ?? raw, `results[${index}].clean_utterance`, raw);
    const confidence = validateConfidence(result.confidence, `results[${index}].confidence`);
    return {
      stage,
      is_final: stage === 'final',
      raw_utterance: raw,
      clean_utterance: clean,
      text: clean,
      confidence,
      seq: Number.isInteger(result.seq) ? result.seq : index,
      ...(result.event_id === undefined ? {} : { event_id: responseId(result.event_id, null, 'event_id') }),
      ...(result.audio === undefined ? {} : { audio: clone(result.audio) }),
      ...(result.language === undefined ? {} : { language: responseText(result.language, 'language') }),
      ...(result.metadata === undefined ? {} : { metadata: clone(result.metadata) }),
    };
  });
  const done = body.done ?? (body.is_final === true || results.some((result) => result.stage === 'final'));
  if (typeof done !== 'boolean') {
    throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar ASR response has invalid done flag', {
      requestId: request.request_id, correlationId: request.correlation_id,
    });
  }
  return {
    schema: typeof body.schema === 'string' ? body.schema : 'deskbot.asr-result.v0.1',
    ok: body.ok === undefined ? true : body.ok === true,
    request_id: responseId(body.request_id, request.request_id, 'request_id'),
    correlation_id: responseId(body.correlation_id, request.correlation_id, 'correlation_id'),
    utterance_id: responseId(body.utterance_id ?? body.stream_id, request.utterance_id, 'utterance_id'),
    stream_id: responseId(body.stream_id, request.stream_id ?? request.utterance_id, 'stream_id'),
    stage: body.stage ?? (results.length === 1 ? results[0].stage : null),
    is_final: body.is_final === undefined ? results.some((result) => result.stage === 'final') : body.is_final === true,
    results,
    done,
    elapsed_ms: body.elapsed_ms === undefined || body.elapsed_ms === null
      ? null : (Number.isFinite(body.elapsed_ms) ? body.elapsed_ms : null),
    language: body.language === undefined ? null : responseText(body.language, 'language'),
    provider: body.provider ?? body.engine ?? null,
    model: body.model ?? null,
    event: body.event === undefined ? null : clone(body.event),
    audio: body.audio === undefined ? null : clone(body.audio),
    metadata: body.metadata === undefined ? null : clone(body.metadata),
    raw: clone(body),
    ...(results.length === 1 ? {
      raw_utterance: results[0].raw_utterance,
      clean_utterance: results[0].clean_utterance,
      text: results[0].text,
      confidence: results[0].confidence,
    } : {}),
  };
}

function normalizeTtsResult(body, request) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar returned a non-object TTS response', {
      requestId: request.request_id, correlationId: request.correlation_id,
    });
  }
  if (body.ok !== undefined && body.ok !== true) {
    throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar TTS response is not marked ok', {
      requestId: request.request_id, correlationId: request.correlation_id,
    });
  }
  const audio = body.audio && typeof body.audio === 'object' && !Array.isArray(body.audio) ? body.audio : {};
  const encodedValue = audio.data_base64 ?? audio.audio_base64 ?? audio.data ?? body.audio_b64 ?? body.audio_base64;
  const { encoded, buffer } = decodeBase64(encodedValue, 'audio data');
  const format = normalizeResponseFormat(
    audio.format
      ?? body.format
      ?? (audio.codec || audio.encoding || audio.sample_rate_hz || audio.channels ? audio : request.format),
    request,
    request.format,
  );
  const byteCount = audio.byte_count ?? body.byte_count ?? buffer.byteLength;
  if (!Number.isInteger(byteCount) || byteCount < 0 || byteCount !== buffer.byteLength) {
    throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar TTS response has invalid byte_count', {
      requestId: request.request_id, correlationId: request.correlation_id,
    });
  }
  const duration = audio.duration_ms ?? body.duration_ms ?? null;
  if (duration !== null && (!Number.isFinite(duration) || duration < 0)) {
    throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar TTS response has invalid duration_ms', {
      requestId: request.request_id, correlationId: request.correlation_id,
    });
  }
  const audioId = responseId(audio.audio_id ?? body.audio_id, null, 'audio_id');
  const contentType = audio.content_type ?? audio.mime_type ?? body.content_type ?? body.mime_type ?? null;
  const normalizedAudio = {
    format,
    codec: format.codec,
    sample_rate_hz: format.sample_rate_hz,
    channels: format.channels,
    encoding: audio.encoding ?? 'base64',
    data_base64: encoded,
    audio_b64: encoded,
    byte_count: byteCount,
    duration_ms: duration,
    audio_id: audioId,
    content_type: contentType,
    mime_type: contentType,
    ...(typeof audio.sha256 === 'string' ? { sha256: audio.sha256 } : {}),
  };
  return {
    schema: typeof body.schema === 'string' ? body.schema : 'deskbot.tts-result.v0.1',
    ok: body.ok === undefined ? true : body.ok === true,
    request_id: responseId(body.request_id, request.request_id, 'request_id'),
    correlation_id: responseId(body.correlation_id, request.correlation_id, 'correlation_id'),
    text: body.text === undefined ? request.text : responseText(body.text, 'text'),
    profile: clone(body.profile ?? body.voice_profile ?? request.profile ?? { profile_id: 'default' }),
    stream_id: responseId(body.stream_id, request.stream_id ?? null, 'stream_id'),
    audio: normalizedAudio,
    audio_ref: body.audio_ref ?? null,
    provider: body.provider ?? body.engine ?? null,
    model: body.model ?? null,
    metadata: body.metadata === undefined ? null : clone(body.metadata),
    raw: clone(body),
  };
}

function stripCallOptions(input) {
  const body = { ...input };
  delete body.signal;
  delete body.timeoutMs;
  delete body.timeout;
  return body;
}

export function createVoiceSidecarClient({
  baseUrl = undefined,
  base_url = undefined,
  fetchImpl = globalThis.fetch,
  fetch: fetchAlias = undefined,
  timeoutMs = undefined,
  timeout_ms = undefined,
  asrPath = undefined,
  asr_path = undefined,
  ttsPath = undefined,
  tts_path = undefined,
} = {}) {
  const effectiveFetch = fetchAlias ?? fetchImpl;
  if (typeof effectiveFetch !== 'function') throw new TypeError('fetchImpl must be a function');
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl ?? base_url ?? DEFAULT_BASE_URL);
  const defaultTimeout = normalizeTimeout(timeoutMs ?? timeout_ms, DEFAULT_TIMEOUT_MS);
  const paths = {
    asr: normalizePath(asrPath ?? asr_path, 'asr_path', DEFAULT_ASR_PATH),
    tts: normalizePath(ttsPath ?? tts_path, 'tts_path', DEFAULT_TTS_PATH),
  };

  async function request(path, {
    method = 'POST',
    body = null,
    timeout = defaultTimeout,
    signal = null,
    requestId = null,
    correlationId = null,
  } = {}) {
    const requestBody = body && typeof body === 'object' ? body : {};
    const effectiveRequestId = requestId ?? requestBody.request_id ?? null;
    const effectiveCorrelationId = correlationId ?? requestBody.correlation_id ?? null;
    const wireBody = method === 'GET' ? undefined : JSON.stringify({
      ...requestBody,
      ...(effectiveRequestId === null ? {} : { request_id: effectiveRequestId }),
    });
    const context = makeAbortContext(signal, timeout);
    const headers = {
      accept: 'application/json',
      ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
      ...(effectiveCorrelationId ? { 'x-correlation-id': effectiveCorrelationId } : {}),
    };
    let response;
    try {
      if (context.reason === 'cancelled') throw new VoiceAbortError('cancelled');
      const fetchPromise = Promise.resolve().then(() => effectiveFetch(joinUrl(normalizedBaseUrl, path), {
        method, headers, ...(wireBody === undefined ? {} : { body: wireBody }), signal: context.signal,
      }));
      fetchPromise.catch(() => {});
      response = await Promise.race([fetchPromise, context.abortPromise]);
      if (!response || typeof response.json !== 'function') {
        throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar returned an invalid HTTP response', {
          requestId: effectiveRequestId, correlationId: effectiveCorrelationId,
        });
      }
      const jsonPromise = Promise.resolve().then(() => response.json());
      jsonPromise.catch(() => {});
      let payload;
      try {
        payload = await Promise.race([jsonPromise, context.abortPromise]);
      } catch (error) {
        if (error instanceof VoiceAbortError) throw error;
        throw new VoiceSidecarError(502, 'invalid_response', 'voice sidecar returned invalid JSON', {
          retryable: true,
          requestId: effectiveRequestId,
          correlationId: effectiveCorrelationId,
          cause: error,
        });
      }
      if (!responseOk(response)) throw errorFromPayload(response, payload, {
        request_id: effectiveRequestId, correlation_id: effectiveCorrelationId,
      });
      if (payload && typeof payload === 'object' && payload.ok === false) {
        throw errorFromPayload({ status: responseStatus(response) >= 400 ? responseStatus(response) : 502 }, payload, {
          request_id: effectiveRequestId, correlation_id: effectiveCorrelationId,
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof VoiceSidecarError) throw error;
      throw abortFailure(context, signal, error, {
        request_id: effectiveRequestId, correlation_id: effectiveCorrelationId,
      });
    } finally {
      context.cleanup();
    }
  }

  async function health(options = {}) {
    const call = normalizeCallOptions(options, defaultTimeout);
    return clone(await request('/health', { method: 'GET', timeout: call.timeout, signal: call.signal }));
  }

  async function capabilities(options = {}) {
    const call = normalizeCallOptions(options, defaultTimeout);
    return clone(await request('/capabilities', { method: 'GET', timeout: call.timeout, signal: call.signal }));
  }

  async function transcribe(input = {}, options = {}) {
    requireObject(input, 'ASR request');
    const correlationId = requireText(input.correlation_id, 'correlation_id');
    const requestId = input.request_id === undefined || input.request_id === null
      ? `asr-${randomUUID()}` : requireText(input.request_id, 'request_id');
    const utteranceId = input.utterance_id ?? input.stream_id ?? `utt-${randomUUID()}`;
    const normalizedUtteranceId = requireText(utteranceId, 'utterance_id');
    const stage = String(input.stage ?? (input.final === true ? 'final' : input.partial === true ? 'partial' : 'final'))
      .trim().toLowerCase();
    if (stage !== 'partial' && stage !== 'final') {
      throw new VoiceSidecarError(400, 'invalid_request', 'stage must be partial or final', {
        requestId, correlationId,
      });
    }
    const body = {
      ...stripCallOptions(input),
      schema: input.schema ?? 'deskbot.asr-request.v0.1',
      request_id: requestId,
      correlation_id: correlationId,
      utterance_id: normalizedUtteranceId,
      stream_id: input.stream_id === undefined ? normalizedUtteranceId : requireText(input.stream_id, 'stream_id'),
      stage,
    };
    const audioValue = input.audio_b64 ?? input.audio_base64 ?? input.audio;
    if (audioValue !== undefined && audioValue !== null) {
      body.audio_b64 = encodeAudio(audioValue);
      delete body.audio;
      if (input.audio_base64 !== undefined) body.audio_base64 = body.audio_b64;
    }
    const formatValue = input.audio_format ?? input.format;
    if (formatValue !== undefined && formatValue !== null) {
      const format = normalizeFormat(formatValue, 'format', {
        codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1,
      });
      body.format = format;
      body.audio_format = format;
    }
    const call = normalizeCallOptions(options, defaultTimeout, input.timeout_ms);
    const payload = await request(paths.asr, {
      body, timeout: call.timeout, signal: call.signal, requestId, correlationId,
    });
    try {
      return normalizeAsrResult(payload, body);
    } catch (error) {
      throw withRequestContext(error, body);
    }
  }

  async function synthesize(input = {}, options = {}) {
    requireObject(input, 'TTS request');
    const correlationId = requireText(input.correlation_id, 'correlation_id');
    const requestId = input.request_id === undefined || input.request_id === null
      ? `tts-${randomUUID()}` : requireText(input.request_id, 'request_id');
    const text = requireText(input.text ?? input.clean_utterance, 'text');
    const profile = input.profile ?? input.voice_profile ?? input.profile_id ?? DEFAULT_TTS_PROFILE;
    if (typeof profile !== 'string' && (!profile || typeof profile !== 'object' || Array.isArray(profile))) {
      throw invalidRequest('profile must be a string or object', { requestId, correlationId });
    }
    const format = normalizeFormat(input.format ?? input.audio_format, 'format', {
      codec: 'wav', sample_rate_hz: 16_000, channels: 1,
    });
    const body = {
      ...stripCallOptions(input),
      schema: input.schema ?? 'deskbot.tts-request.v0.1',
      request_id: requestId,
      correlation_id: correlationId,
      text,
      profile,
      profile_id: input.profile_id ?? (typeof profile === 'string' ? profile : profile.profile_id ?? profile.id ?? profile.name),
      format,
      audio_format: format,
    };
    const call = normalizeCallOptions(options, defaultTimeout, input.timeout_ms);
    const payload = await request(paths.tts, {
      body, timeout: call.timeout, signal: call.signal, requestId, correlationId,
    });
    try {
      return normalizeTtsResult(payload, { ...body, format, profile });
    } catch (error) {
      throw withRequestContext(error, body);
    }
  }

  async function cancel(input = {}, options = {}) {
    requireObject(input, 'cancel request');
    const requestId = input.request_id === undefined || input.request_id === null
      ? (input.job_id === undefined || input.job_id === null ? null : requireText(input.job_id, 'job_id'))
      : requireText(input.request_id, 'request_id');
    const correlationId = input.correlation_id === undefined || input.correlation_id === null
      ? null : requireText(input.correlation_id, 'correlation_id');
    if (!requestId && !correlationId) throw invalidRequest('request_id or correlation_id is required');
    const body = {
      ...stripCallOptions(input),
      schema: input.schema ?? 'deskbot.voice-cancel.v0.1',
      ...(requestId ? { request_id: requestId } : {}),
      ...(correlationId ? { correlation_id: correlationId } : {}),
      reason: input.reason ?? 'client_cancelled',
    };
    const call = normalizeCallOptions(options, defaultTimeout, input.timeout_ms);
    const path = requestId ? `/v1/jobs/${encodeURIComponent(requestId)}/cancel` : '/v1/cancel';
    return clone(await request(path, {
      body, timeout: call.timeout, signal: call.signal, requestId, correlationId,
    }));
  }

  return {
    asr: transcribe,
    baseUrl: normalizedBaseUrl,
    capabilities,
    cancel,
    health,
    synthesize,
    tts: synthesize,
    transcribe,
  };
}
