import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

function clone(value) {
  return structuredClone(value);
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AudioArtifactError(400, 'invalid_audio', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeFormat(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AudioArtifactError(400, 'invalid_audio', 'audio format must be an object');
  }
  const codec = requireText(value.codec ?? value.encoding, 'audio.codec');
  const sampleRate = value.sample_rate_hz;
  const channels = value.channels;
  if (!Number.isInteger(sampleRate) || sampleRate < 1 || sampleRate > 192_000) {
    throw new AudioArtifactError(400, 'invalid_audio', 'audio.sample_rate_hz must be a positive integer');
  }
  if (!Number.isInteger(channels) || channels < 1 || channels > 8) {
    throw new AudioArtifactError(400, 'invalid_audio', 'audio.channels must be an integer between 1 and 8');
  }
  return { codec, sample_rate_hz: sampleRate, channels };
}

function decodeBase64(value, field = 'audio.data_base64') {
  const encoded = requireText(value, field);
  // Buffer.from is deliberately followed by a canonical round-trip check so
  // malformed or silently truncated base64 never becomes a playable artifact.
  let buffer;
  try {
    buffer = Buffer.from(encoded, 'base64');
  } catch {
    throw new AudioArtifactError(400, 'invalid_audio', `${field} must be base64`);
  }
  const canonicalInput = encoded.replace(/\s+/g, '').replace(/=+$/, '');
  const canonicalOutput = buffer.toString('base64').replace(/=+$/, '');
  if (canonicalInput !== canonicalOutput) {
    throw new AudioArtifactError(400, 'invalid_audio', `${field} must be valid base64`);
  }
  return buffer;
}

function normalizeSha256(value, actual) {
  if (value === undefined || value === null) return actual;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value.trim())) {
    throw new AudioArtifactError(400, 'invalid_audio', 'audio.sha256 must be a 64-character hexadecimal digest');
  }
  const supplied = value.trim().toLowerCase();
  if (supplied !== actual) {
    throw new AudioArtifactError(400, 'audio_hash_mismatch', 'audio.sha256 does not match decoded data');
  }
  return actual;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function artifactIdentity(artifact) {
  return {
    audio_id: artifact.audio_id,
    format: artifact.format,
    encoding: artifact.encoding,
    byte_count: artifact.byte_count,
    duration_ms: artifact.duration_ms,
    sha256: artifact.sha256,
  };
}

function artifactFingerprint(artifact) {
  return fingerprint(artifactIdentity(artifact));
}

export class AudioArtifactError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AudioArtifactError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createAudioArtifactStore({
  now = () => new Date(),
  persistence = null,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive integer');
  }

  const artifacts = new Map(
    (persistence?.list('audio.artifacts') ?? []).map((artifact) => [artifact.audio_id, artifact]),
  );

  function put(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new AudioArtifactError(400, 'invalid_audio', 'audio artifact must be an object');
    }
    const audio = input.audio && typeof input.audio === 'object' && !Array.isArray(input.audio)
      ? input.audio
      : input;
    const encoded = audio.data_base64 ?? audio.audio_base64 ?? audio.audio_b64;
    const buffer = decodeBase64(encoded);
    if (buffer.byteLength > maxBytes) {
      throw new AudioArtifactError(413, 'audio_too_large', `audio artifact exceeds ${maxBytes} bytes`);
    }
    const format = normalizeFormat(audio.format ?? audio);
    const suppliedId = audio.audio_id ?? input.audio_id;
    const audioId = suppliedId === undefined || suppliedId === null
      ? `audio-${randomUUID()}`
      : requireText(suppliedId, 'audio_id');
    const byteCount = audio.byte_count ?? buffer.byteLength;
    if (!Number.isInteger(byteCount) || byteCount !== buffer.byteLength) {
      throw new AudioArtifactError(400, 'invalid_audio', 'audio.byte_count does not match decoded data');
    }
    const duration = audio.duration_ms ?? null;
    if (duration !== null && (!Number.isFinite(duration) || duration < 0)) {
      throw new AudioArtifactError(400, 'invalid_audio', 'audio.duration_ms must be a non-negative number');
    }
    const digest = createHash('sha256').update(buffer).digest('hex');
    normalizeSha256(audio.sha256 ?? input.sha256, digest);
    const contentType = audio.content_type ?? audio.mime_type ?? input.content_type ?? input.mime_type ?? null;
    if (contentType !== null && (typeof contentType !== 'string' || contentType.trim() === '')) {
      throw new AudioArtifactError(400, 'invalid_audio', 'audio.content_type must be a non-empty string');
    }
    const artifact = {
      schema: 'foundry.audio-artifact.v0.1',
      audio_id: audioId,
      correlation_id: input.correlation_id ?? null,
      request_id: input.request_id ?? null,
      profile: clone(input.profile ?? input.voice_profile ?? null),
      format,
      content_type: contentType === null ? null : contentType.trim(),
      mime_type: contentType === null ? null : contentType.trim(),
      encoding: audio.encoding ?? 'base64',
      byte_count: buffer.byteLength,
      duration_ms: duration,
      sha256: digest,
      data_base64: buffer.toString('base64'),
      created_at: now().toISOString(),
    };
    const artifactDigest = artifactFingerprint(artifact);
    const existing = artifacts.get(audioId);
    if (existing) {
      const existingFingerprint = artifactFingerprint(existing);
      if (existingFingerprint !== artifactDigest) {
        throw new AudioArtifactError(409, 'audio_id_conflict', `audio ${audioId} already contains different data`);
      }
      return { artifact: clone(existing), duplicate: true };
    }
    artifact.fingerprint = artifactDigest;
    artifacts.set(audioId, artifact);
    persistence?.put('audio.artifacts', audioId, artifact);
    return { artifact: clone(artifact), duplicate: false };
  }

  function get(audioId) {
    const normalizedId = requireText(audioId, 'audio_id');
    const artifact = artifacts.get(normalizedId);
    return artifact ? clone(artifact) : null;
  }

  function read(audioId) {
    const artifact = get(audioId);
    if (!artifact) return null;
    return {
      ...artifact,
      buffer: Buffer.from(artifact.data_base64, 'base64'),
    };
  }

  function list({ limit = 50 } = {}) {
    const bounded = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return [...artifacts.values()].slice(-bounded).map((artifact) => {
      const { data_base64: ignored, ...metadata } = artifact;
      return clone(metadata);
    });
  }

  return {
    get,
    list,
    put,
    read,
    size: () => artifacts.size,
  };
}
