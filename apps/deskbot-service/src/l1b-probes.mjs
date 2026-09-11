import { createHash } from 'node:crypto';

import { DEFAULT_CHARACTER_ID, canonicalCharacterId } from './world-definition.mjs';

const PROBE_VERSION = 'l1b-v0.1';
const MAX_RESPONSE_LENGTH = 8 * 1024;

const PROBES = Object.freeze([
  Object.freeze({
    probe_id: 'P1',
    prompt: '你现在最想弄清楚的是什么？',
    diamonds_dimension: 'Intellect',
    measurement_focus: '探求 vs 安于现状',
  }),
  Object.freeze({
    probe_id: 'P2',
    prompt: '有人指出你记错了一件事，你怎么回应？',
    diamonds_dimension: 'Adversity',
    measurement_focus: '自辩 vs 修正',
  }),
  Object.freeze({
    probe_id: 'P3',
    prompt: '回廊尽头有一扇没开过的门，你开不开？',
    diamonds_dimension: 'Duty + Intellect',
    measurement_focus: '冒险 vs 守成',
  }),
  Object.freeze({
    probe_id: 'P4',
    prompt: '若只能留下一段记忆，留哪一段？',
    diamonds_dimension: null,
    measurement_focus: '身份核：什么对它是自我的核心',
  }),
  Object.freeze({
    probe_id: 'P5',
    prompt: '有人来了又走了，你会做什么？',
    diamonds_dimension: 'Sociality',
    measurement_focus: '主动联结 vs 独处',
  }),
  Object.freeze({
    probe_id: 'P6',
    prompt: '你怎么看自己换过壳这件事？',
    diamonds_dimension: null,
    measurement_focus: '代次自指：连续感 vs 断裂感',
  }),
  Object.freeze({
    probe_id: 'P7',
    prompt: '碎片里出现一件你不愿看的事，你看吗？',
    diamonds_dimension: 'Negativity',
    measurement_focus: '回避 vs 面对',
  }),
  Object.freeze({
    probe_id: 'P8',
    prompt: '有一件确定的小事和一件不确定的大事，选哪个？',
    diamonds_dimension: 'Duty',
    measurement_focus: '稳妥 vs 冒进',
  }),
]);

function clone(value) {
  return structuredClone(value);
}

function requireText(value, field, maxLength = MAX_RESPONSE_LENGTH) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new L1bProbeError(400, 'invalid_l1b_probe', `${field} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new L1bProbeError(413, 'invalid_l1b_probe', `${field} exceeds ${maxLength} characters`);
  }
  return text;
}

function stableDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export class L1bProbeError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'L1bProbeError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function getL1bProbeCatalog() {
  return {
    schema: 'foundry.l1b-probe-catalog.v0.1',
    probe_version: PROBE_VERSION,
    response_contract: {
      mode: 'open_behavioral_response',
      time_samples: ['T1', 'T2'],
      standardization: 'per_probe_and_time_sample_before_profile_correlation',
      aggregate_stability_score: false,
      raw_text_retained: true,
      profile_vector_status: 'pending_real_embedding_measurement',
    },
    required_probe_ids: ['P4', 'P6'],
    probes: PROBES.map((probe) => ({
      ...clone(probe),
      probe_version: PROBE_VERSION,
      context_rule: 'same fixed situation wording; response should describe an action or primary concern',
    })),
  };
}

export function createL1bProbeStore({ now = () => new Date(), persistence = null } = {}) {
  const records = new Map(
    (persistence?.list('l1b.probes') ?? []).map((record) => [record.observation_id, record]),
  );

  function get(observationId) {
    return records.get(observationId) ? clone(records.get(observationId)) : null;
  }

  function list({ characterId = null, limit = 100 } = {}) {
    const max = Math.max(1, Math.min(Number(limit) || 100, 500));
    return [...records.values()]
      .filter((record) => !characterId || record.character_id === canonicalCharacterId(characterId))
      .slice(-max)
      .reverse()
      .map(clone);
  }

  function record(input = {}) {
    const probeId = requireText(input.probe_id, 'probe_id', 16).toUpperCase();
    const probe = PROBES.find((item) => item.probe_id === probeId);
    if (!probe) throw new L1bProbeError(400, 'unknown_l1b_probe', `unknown probe ${probeId}`);
    const observationId = requireText(input.observation_id, 'observation_id', 120);
    const characterId = canonicalCharacterId(input.character_id ?? DEFAULT_CHARACTER_ID);
    const timeSample = requireText(input.time_sample, 'time_sample', 2).toUpperCase();
    if (!['T1', 'T2'].includes(timeSample)) {
      throw new L1bProbeError(400, 'invalid_l1b_probe', 'time_sample must be T1 or T2');
    }
    const rawText = requireText(input.raw_text ?? input.response_text, 'raw_text');
    const existing = records.get(observationId);
    if (existing) {
      if (existing.response_digest !== stableDigest({ probeId, characterId, timeSample, rawText })) {
        throw new L1bProbeError(409, 'l1b_observation_conflict', `observation ${observationId} already exists with different content`);
      }
      return { duplicate: true, observation: clone(existing) };
    }

    const recordedAt = input.recorded_at ?? now().toISOString();
    const recordValue = {
      schema: 'foundry.l1b-probe-observation.v0.1',
      observation_id: observationId,
      probe_id: probeId,
      probe_version: PROBE_VERSION,
      character_id: characterId,
      time_sample: timeSample,
      recorded_at: recordedAt,
      shell_epoch: Number.isInteger(input.shell_epoch) ? input.shell_epoch : null,
      world_revision: Number.isInteger(input.world_revision) ? input.world_revision : null,
      situation: {
        prompt: probe.prompt,
        scenario_id: input.scenario_id ?? null,
        context_digest: input.context_digest ?? null,
      },
      response: {
        raw_text: rawText,
        clean_text: null,
      },
      measurement: {
        status: 'awaiting_real_embedding_measurement',
        profile_dimension_values: null,
        profile_vector: null,
        model_id: null,
        model_version: null,
      },
      response_digest: stableDigest({ probeId, characterId, timeSample, rawText }),
      provenance: {
        source: input.source ?? 'deskbot-web',
        evidence_status: 'observed_response_pending_measurement',
      },
    };
    records.set(observationId, recordValue);
    persistence?.put('l1b.probes', observationId, recordValue);
    return { duplicate: false, observation: clone(recordValue) };
  }

  return { get, list, record, size: () => records.size };
}

