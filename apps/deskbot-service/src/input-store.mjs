import { createHash, randomUUID } from 'node:crypto';

import { DEFAULT_CHARACTER_ID } from './world-definition.mjs';

const EVENT_LAYERS = Object.freeze([
  'interaction',
  'world_line',
  'external_context',
  'weather',
  'calendar',
  'user_profile',
  'device_context',
  'transport',
  'unclassified',
]);

const SOURCE_KINDS = Object.freeze([
  'user',
  'device',
  'service',
  'external_provider',
  'world_engine',
  'unknown',
]);

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InputError(400, 'invalid_input', `${field} must be a non-empty string`);
  }

  return value.trim();
}

function optionalText(value, field) {
  if (value === undefined || value === null) return null;
  return requireText(value, field);
}

function requireChoice(value, field, choices) {
  const normalized = requireText(value, field);
  if (!choices.includes(normalized)) {
    throw new InputError(400, 'invalid_input', `${field} must be one of: ${choices.join(', ')}`);
  }
  return normalized;
}

function normalizeDateTime(value, field, fallback) {
  const normalized = value ?? fallback;
  if (typeof normalized !== 'string' || Number.isNaN(Date.parse(normalized))) {
    throw new InputError(400, 'invalid_input', `${field} must be an ISO date-time string`);
  }
  return normalized;
}

function normalizeConfidence(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new InputError(400, 'invalid_input', 'confidence must be a number between 0 and 1');
  }
  return value;
}

function inferLayer(type, payload = {}) {
  if (type === 'world.mutation') {
    const action = payload.action;
    if (action === 'record_external_context') return 'external_context';
    if (action === 'update_weather') return 'weather';
    if (action === 'advance_calendar' || action === 'advance_time') return 'calendar';
    if (action === 'observe_user_preference') return 'user_profile';
    if (action === 'record_device_context') return 'device_context';
    return 'world_line';
  }
  if (type.startsWith('conversation.')) return 'interaction';
  if (type.startsWith('voice.')) return 'transport';
  if (type.startsWith('device.') || type.startsWith('sensor.') || type.startsWith('shell.')) return 'device_context';
  if (type.startsWith('weather.')) return 'weather';
  if (type.startsWith('calendar.') || type.startsWith('world.time')) return 'calendar';
  if (type.startsWith('news.') || type.startsWith('external.')) return 'external_context';
  if (type.startsWith('user.preference')) return 'user_profile';
  if (type.startsWith('npc.') || type.startsWith('world.')) return 'world_line';
  return 'unclassified';
}

function inferSourceKind(type, payload = {}) {
  if (type === 'conversation.input' && payload.role !== 'assistant') return 'user';
  if (type.startsWith('device.') || type.startsWith('sensor.') || type.startsWith('shell.')) return 'device';
  if (type === 'world.mutation' || type.startsWith('npc.') || type.startsWith('world.')) return 'world_engine';
  if (type.startsWith('news.') || type.startsWith('external.') || type.startsWith('weather.')) return 'external_provider';
  if (type.startsWith('conversation.') || type.startsWith('voice.')) return 'service';
  return 'unknown';
}

function enrichEvent(event) {
  const provenance = event.provenance ?? null;
  if (provenance !== null && (!provenance || typeof provenance !== 'object' || Array.isArray(provenance))) {
    throw new InputError(400, 'invalid_input', 'provenance must be a JSON object or null');
  }

  return {
    ...event,
    layer: event.layer === undefined
      ? inferLayer(event.type, event.payload)
      : requireChoice(event.layer, 'layer', EVENT_LAYERS),
    source_kind: event.source_kind === undefined
      ? inferSourceKind(event.type, event.payload)
      : requireChoice(event.source_kind, 'source_kind', SOURCE_KINDS),
    confidence: normalizeConfidence(event.confidence),
    observed_at: normalizeDateTime(event.observed_at, 'observed_at', event.occurred_at),
    provider: optionalText(event.provider, 'provider'),
    provenance,
  };
}

export class InputError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'InputError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createInputStore({ now = () => new Date(), persistence = null } = {}) {
  const events = new Map(
    (persistence?.list('input.events') ?? []).map((stored) => [stored.event.event_id, stored]),
  );

  function save(event) {
    const normalizedEvent = enrichEvent(event);
    const existing = events.get(normalizedEvent.event_id);

    if (existing) {
      if (existing.fingerprint !== fingerprint(normalizedEvent)) {
        throw new InputError(409, 'event_id_conflict', `event_id ${normalizedEvent.event_id} already contains a different event`);
      }

      return { event: existing.event, duplicate: true };
    }

    const stored = {
      event: normalizedEvent,
      fingerprint: fingerprint(normalizedEvent),
      received_at: now().toISOString(),
    };
    persistence?.put('input.events', normalizedEvent.event_id, stored);
    // Keep the process-local index consistent with durable storage.  If the
    // adapter rejects the write, callers can safely retry the event.
    events.set(normalizedEvent.event_id, stored);
    return { event: normalizedEvent, duplicate: false };
  }

  function get(eventId) {
    const stored = events.get(requireText(eventId, 'event_id'));
    return stored ? { ...stored.event, received_at: stored.received_at } : null;
  }

  function list({ limit = 50, layer, sourceKind, type } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return [...events.values()]
      .filter(({ event }) => !layer || event.layer === layer)
      .filter(({ event }) => !sourceKind || event.source_kind === sourceKind)
      .filter(({ event }) => !type || event.type === type)
      .slice(-boundedLimit)
      .map(({ event, received_at }) => ({
      ...event,
      received_at,
      }));
  }

  function remove(eventId) {
    const normalizedEventId = requireText(eventId, 'event_id');
    const removed = events.delete(normalizedEventId);
    if (removed) persistence?.remove('input.events', normalizedEventId);
    return removed;
  }

  return {
    get,
    list,
    remove,
    save,
    size: () => events.size,
  };
}

export function normalizeEvent(input, { now = () => new Date() } = {}) {
  const source = requireText(input.source, 'source');
  const type = requireText(input.type, 'type');
  const eventId = input.event_id === undefined ? `evt-${randomUUID()}` : requireText(input.event_id, 'event_id');
  const occurredAt = normalizeDateTime(input.occurred_at, 'occurred_at', now().toISOString());

  if (input.payload === undefined || input.payload === null || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    throw new InputError(400, 'invalid_input', 'payload must be a JSON object');
  }

  return enrichEvent({
    schema: input.schema ?? 'foundry.event.v0.1',
    event_id: eventId,
    type,
    source,
    occurred_at: occurredAt,
    character_id: input.character_id ?? null,
    device_id: input.device_id ?? null,
    shell_id: input.shell_id ?? null,
    role_revision: input.role_revision ?? null,
    correlation_id: input.correlation_id ?? null,
    layer: input.layer,
    source_kind: input.source_kind,
    confidence: input.confidence,
    observed_at: input.observed_at,
    provider: input.provider,
    provenance: input.provenance,
    payload: input.payload,
  });
}

export function normalizeChat(input, { now = () => new Date() } = {}) {
  const message = requireText(input.message ?? input.text, 'message');
  // New events use the canonical 聚形域 identity.  An explicitly supplied
  // legacy ID is kept verbatim so old records and devices remain readable;
  // the canonical-world layer resolves that alias when it projects state.
  const characterId = requireText(input.character_id ?? DEFAULT_CHARACTER_ID, 'character_id');
  const role = input.role ?? 'user';

  if (role !== 'user' && role !== 'assistant') {
    throw new InputError(400, 'invalid_input', 'role must be user or assistant');
  }

  const payload = {
    role,
    text: message,
    ...(input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? { metadata: input.metadata }
      : {}),
  };

  return normalizeEvent({
    schema: 'foundry.event.v0.1',
    event_id: input.event_id,
    type: role === 'assistant' ? 'conversation.reply' : 'conversation.input',
    source: input.source ?? 'dialogue',
    occurred_at: input.occurred_at,
    character_id: characterId,
    device_id: input.device_id,
    shell_id: input.shell_id,
    role_revision: input.role_revision,
    correlation_id: input.correlation_id,
    layer: input.layer,
    source_kind: input.source_kind,
    confidence: input.confidence,
    observed_at: input.observed_at,
    provider: input.provider,
    provenance: input.provenance,
    payload,
  }, { now });
}

export function getInputEventSchema() {
  return {
    schema: 'foundry.event-schema.v0.2',
    event_schema: 'foundry.event.v0.1',
    layers: [...EVENT_LAYERS],
    source_kinds: [...SOURCE_KINDS],
    confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    observed_at: { type: 'string', format: 'date-time', fallback: 'occurred_at' },
    optional_fields: ['provider', 'provenance'],
  };
}
