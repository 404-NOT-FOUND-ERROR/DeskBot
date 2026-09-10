import { randomUUID } from 'node:crypto';

import { InputError, normalizeEvent } from './input-store.mjs';
import { DEFAULT_CHARACTER_ID } from './world-definition.mjs';

const ASR_STAGES = new Set(['partial', 'final']);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new VoiceIngressError(400, 'invalid_voice_input', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value, field, fallback = null) {
  if (value === undefined || value === null) return fallback;
  return requireText(value, field);
}

// ASR transcripts are observations, not user-authored input. Preserve the
// sidecar's raw bytes-as-text (including surrounding whitespace and an
// explicit empty string) so the audit record cannot silently rewrite it.
function observedUtterance(value, field, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    throw new VoiceIngressError(400, 'invalid_voice_input', `${field} must be a string`);
  }
  return value;
}

function normalizeConfidence(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new VoiceIngressError(400, 'invalid_voice_input', 'confidence must be a number between 0 and 1');
  }
  return value;
}

function unwrapResult(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (input.result && typeof input.result === 'object' && !Array.isArray(input.result)) return input.result;
    if (input.asr_result && typeof input.asr_result === 'object' && !Array.isArray(input.asr_result)) return input.asr_result;
  }
  return input;
}

export class VoiceIngressError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'VoiceIngressError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Normalize one sidecar ASR result into a transport observation. The result is
 * deliberately separate from `conversation.input`: partial and final ASR
 * stages are retained for audit, but only the final clean text becomes a user
 * turn below.
 */
export function normalizeVoiceAsr(input, { now = () => new Date() } = {}) {
  const source = unwrapResult(input);
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new VoiceIngressError(400, 'invalid_voice_input', 'ASR result must be an object');
  }

  const correlationId = requireText(source.correlation_id, 'correlation_id');
  const utteranceId = optionalText(source.utterance_id ?? source.stream_id, 'utterance_id', `utt-${randomUUID()}`);
  const requestId = optionalText(source.request_id ?? source.asr_id, 'request_id', null);
  const stage = source.stage
    ?? (source.is_final === true || source.final === true ? 'final' : source.partial === true ? 'partial' : null);
  if (!ASR_STAGES.has(stage)) {
    throw new VoiceIngressError(400, 'invalid_voice_input', 'stage must be partial or final');
  }

  const rawSource = source.raw_utterance ?? source.raw_text ?? source.text;
  const rawUtterance = observedUtterance(
    rawSource,
    'raw_utterance',
    '',
  );
  const cleanSource = source.clean_utterance ?? source.cleaned_text;
  const cleanUtterance = observedUtterance(
    cleanSource,
    'clean_utterance',
    rawUtterance.trim(),
  );
  const eventId = optionalText(
    source.event_id,
    'event_id',
    `voice-asr-${stage}-${requestId ?? utteranceId}`,
  );
  const occurredAt = source.occurred_at ?? now().toISOString();
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) {
    throw new VoiceIngressError(400, 'invalid_voice_input', 'occurred_at must be an ISO date-time string');
  }

  return {
    schema: source.schema ?? 'deskbot.asr-result.v0.1',
    event_id: eventId,
    request_id: requestId,
    correlation_id: correlationId,
    utterance_id: utteranceId,
    stage,
    raw_utterance: rawUtterance,
    clean_utterance: cleanUtterance,
    text: cleanUtterance,
    confidence: normalizeConfidence(source.confidence),
    occurred_at: occurredAt,
    character_id: source.character_id ?? null,
    device_id: source.device_id ?? null,
    shell_id: source.shell_id ?? null,
    role_revision: source.role_revision ?? null,
    audio: clone(source.audio ?? source.format ?? null),
    provider: source.provider ?? source.engine ?? null,
    model: source.model ?? null,
    metadata: clone(source.metadata ?? null),
  };
}

export function createVoiceIngress({
  now = () => new Date(),
  inputStore,
  persistentWorld,
  stateEngine,
  evidenceLedger = null,
  orchestrator,
} = {}) {
  if (!inputStore || !persistentWorld || !stateEngine || !orchestrator) {
    throw new TypeError('inputStore, persistentWorld, stateEngine, and orchestrator are required');
  }

  async function ingest(input) {
    const result = normalizeVoiceAsr(input, { now });
    const event = {
      ...normalizeEvent({
        schema: 'foundry.event.v0.1',
        event_id: result.event_id,
        type: `voice.asr.${result.stage}`,
        source: input?.source ?? 'voice-sidecar',
        occurred_at: result.occurred_at,
        character_id: result.character_id,
        device_id: result.device_id,
        shell_id: result.shell_id,
        role_revision: result.role_revision,
        correlation_id: result.correlation_id,
        payload: {
          stage: result.stage,
          request_id: result.request_id,
          utterance_id: result.utterance_id,
          raw_utterance: result.raw_utterance,
          clean_utterance: result.clean_utterance,
          text: result.clean_utterance,
          confidence: result.confidence,
          audio: result.audio,
          provider: result.provider,
          model: result.model,
          metadata: result.metadata,
        },
      }, { now }),
    };

    const saved = inputStore.save(event);
    const worldResult = persistentWorld.ingest(saved.event);
    const stateResult = stateEngine.getResult(event.event_id) ?? stateEngine.ingest(event);
    const evidenceResult = evidenceLedger
      ? evidenceLedger.record({ event, analysis: null, worldMatches: [] })
      : null;

    let turn = null;
    let emptyTranscript = false;
    if (result.stage === 'final' && result.clean_utterance.trim() !== '') {
      const chatEventId = `voice-chat-${result.utterance_id}`;
      turn = await orchestrator.run({
        event_id: chatEventId,
        character_id: result.character_id ?? DEFAULT_CHARACTER_ID,
        device_id: result.device_id,
        shell_id: result.shell_id,
        role_revision: result.role_revision,
        correlation_id: result.correlation_id,
        source: 'voice-sidecar',
        message: result.clean_utterance,
        metadata: {
          asr_event_id: event.event_id,
          request_id: result.request_id,
          utterance_id: result.utterance_id,
          raw_utterance: result.raw_utterance,
          clean_utterance: result.clean_utterance,
          confidence: result.confidence,
          provider: result.provider,
          model: result.model,
          ...(result.metadata && typeof result.metadata === 'object' ? result.metadata : {}),
        },
      });
    } else if (result.stage === 'final' && result.clean_utterance.trim() === '') {
      emptyTranscript = true;
    }

    return {
      schema: 'foundry.voice-ingress.v0.1',
      accepted: true,
      duplicate: saved.duplicate || worldResult.duplicate === true || turn?.duplicate === true,
      empty_transcript: emptyTranscript,
      asr: result,
      event: saved.event,
      world_mutation: worldResult,
      state: stateResult.state,
      evidence: evidenceResult?.evidence ?? null,
      turn,
    };
  }

  return { ingest, normalize: (input) => normalizeVoiceAsr(input, { now }) };
}
