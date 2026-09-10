import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import {
  AudioArtifactError,
  createAudioArtifactStore,
} from '../src/audio-artifacts.mjs';

const format = {
  codec: 'pcm_s16le',
  sample_rate_hz: 16_000,
  channels: 1,
};

function encoded(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function artifactInput(bytes, overrides = {}) {
  return {
    audio_id: 'audio-focused-001',
    format,
    data_base64: encoded(bytes),
    ...overrides,
  };
}

test('same audio_id and immutable content is idempotent', () => {
  const store = createAudioArtifactStore({ now: () => new Date('2026-09-01T00:00:00.000Z') });
  const input = artifactInput(Buffer.from('same-audio'));

  const first = store.put(input);
  const second = store.put({
    ...input,
    request_id: 'retry-request',
    correlation_id: 'retry-correlation',
  });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.artifact, first.artifact);
  assert.equal(store.size(), 1);
});

test('same audio_id with different immutable content returns audio_id_conflict', () => {
  const store = createAudioArtifactStore();
  store.put(artifactInput(Buffer.from('original-audio')));

  assert.throws(
    () => store.put(artifactInput(Buffer.from('different-audio'))),
    (error) => error instanceof AudioArtifactError
      && error.statusCode === 409
      && error.code === 'audio_id_conflict',
  );
});

test('nested audio.format is accepted and normalized', () => {
  const store = createAudioArtifactStore();
  const bytes = Buffer.from('nested-format-audio');
  const result = store.put({
    correlation_id: 'nested-format-correlation',
    audio: {
      audio_id: 'audio-focused-nested',
      format: {
        codec: 'wav',
        sample_rate_hz: 48_000,
        channels: 2,
      },
      data_base64: encoded(bytes),
      byte_count: bytes.byteLength,
      content_type: 'audio/wav',
    },
  });

  assert.equal(result.duplicate, false);
  assert.equal(result.artifact.audio_id, 'audio-focused-nested');
  assert.deepEqual(result.artifact.format, {
    codec: 'wav',
    sample_rate_hz: 48_000,
    channels: 2,
  });
  assert.equal(result.artifact.byte_count, bytes.byteLength);
  assert.equal(result.artifact.content_type, 'audio/wav');
});

test('sha256 mismatch is rejected before storing the artifact', () => {
  const store = createAudioArtifactStore();
  const bytes = Buffer.from('hash-checked-audio');
  const wrongHash = createHash('sha256').update('different-bytes').digest('hex');

  assert.throws(
    () => store.put(artifactInput(bytes, { sha256: wrongHash })),
    (error) => error instanceof AudioArtifactError
      && error.statusCode === 400
      && error.code === 'audio_hash_mismatch',
  );
  assert.equal(store.size(), 0);
});
