import { InputError } from './input-store.mjs';
import { canonicalCharacterId, DEFAULT_CHARACTER_ID } from './world-definition.mjs';

const COMMITMENT_STATUSES = new Set(['open', 'kept', 'missed', 'cancelled']);
const MAX_TEXT = 1000;
const MAX_SUMMARY_ITEMS = 30;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requiredText(value, field, max = MAX_TEXT) {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new InputError(400, 'invalid_life_report', `${field} must be non-empty text (max ${max})`);
  }
  return value.trim();
}

function optionalText(value, field, max = MAX_TEXT) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, max);
}

function isoDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new InputError(400, 'invalid_life_report', `${field} must be an ISO date-time string`);
  }
  return new Date(value).toISOString();
}

// Reports and commitments are intentionally not a secret store. The route is
// local today, but refusing obvious credentials keeps future UI integrations
// from turning this layer into an accidental key vault.
function rejectSensitiveText(value) {
  const normalized = String(value).toLowerCase();
  if (/(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|bearer\s+[a-z0-9._-]+|password|passwd|secret|private[ _-]?key|\bsk-[a-z0-9]{12,}|密码|口令|私钥|验证码|身份证号|银行卡号)/iu.test(normalized)) {
    throw new InputError(400, 'sensitive_commitment_rejected', 'Commitment cannot store credentials, authentication material, or identity numbers');
  }
}

function numericDay(value) {
  const day = Number.parseInt(value, 10);
  return Number.isInteger(day) && day > 0 ? day : null;
}

function mutationDay(mutation) {
  const candidates = [
    mutation?.logical_time_after?.day,
    mutation?.logical_time_before?.day,
    mutation?.details?.world_day,
    mutation?.occurred_at ? null : undefined,
  ];
  for (const candidate of candidates) {
    const day = numericDay(candidate);
    if (day !== null) return day;
  }
  return null;
}

function occurredAt(item) {
  return item?.occurred_at ?? item?.committed_at ?? item?.updated_at ?? null;
}

function trendDirection(delta) {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

function boundedItems(items, limit = MAX_SUMMARY_ITEMS) {
  return items.slice(-limit).map(clone);
}

function defaultSummaryText({ day, experiences, scenes, relationshipChanges, worldChanges }) {
  const parts = [`第 ${day} 天`];
  if (experiences.length) parts.push(`留下 ${experiences.length} 段共同经历`);
  if (scenes.length) parts.push(`经过 ${scenes.length} 个场景`);
  if (relationshipChanges.length) parts.push(`与 ${relationshipChanges.length} 个关系记录发生变化`);
  if (worldChanges.length) parts.push(`世界账本新增 ${worldChanges.length} 项变化`);
  if (parts.length === 1) return `第 ${day} 天没有足够的已记录生活片段可供总结。`;
  return `${parts.join('，')}。这是一份由世界账本整理出的记录，不包含未落账的推测。`;
}

function normalizeCommitment(body, { now, existing = null } = {}) {
  const id = requiredText(body.id, 'id', 160);
  const characterId = canonicalCharacterId(body.character_id ?? existing?.character_id ?? DEFAULT_CHARACTER_ID);
  const text = requiredText(body.text ?? existing?.text, 'text');
  rejectSensitiveText(text);
  const status = body.status ?? existing?.status ?? 'open';
  if (!COMMITMENT_STATUSES.has(status)) throw new InputError(400, 'invalid_commitment_status', 'status must be open, kept, missed, or cancelled');
  const createdAt = existing?.created_at ?? now().toISOString();
  return {
    schema: 'deskbot.life-commitment.v0.1',
    id,
    character_id: characterId,
    text,
    status,
    due_at: body.due_at === undefined ? (existing?.due_at ?? null) : isoDate(body.due_at, 'due_at'),
    source: 'explicit_user_confirmation',
    evidence_ref: requiredText(body.evidence_ref ?? existing?.evidence_ref, 'evidence_ref', 300),
    created_at: createdAt,
    updated_at: now().toISOString(),
  };
}

export function createSharedLifeReports({
  persistence = null,
  now = () => new Date(),
  worldSnapshot = () => null,
  listMutations = () => [],
} = {}) {
  const commitments = new Map((persistence?.list('life.commitments') ?? []).map(item => [item.id, item]));
  const summaries = new Map((persistence?.list('life.daily-summaries') ?? []).map(item => [item.id, item]));
  const inMemoryPut = (namespace, id, value) => persistence?.put(namespace, id, value);

  function listCommitments({ characterId = null, status = null } = {}) {
    const normalizedCharacter = characterId ? canonicalCharacterId(characterId) : null;
    return clone([...commitments.values()]
      .filter(item => !normalizedCharacter || item.character_id === normalizedCharacter)
      .filter(item => !status || item.status === status)
      .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))));
  }

  function createCommitment(body = {}) {
    if (body.confirmed !== true) throw new InputError(400, 'confirmation_required', 'Commitment needs explicit confirmation');
    const existing = commitments.get(requiredText(body.id, 'id', 160));
    const record = normalizeCommitment(body, { now, existing });
    if (existing) {
      if (existing.character_id !== record.character_id) throw new InputError(409, 'commitment_owner_conflict', 'A commitment cannot move between characters');
      if (existing.text !== record.text || existing.due_at !== record.due_at) {
        throw new InputError(409, 'commitment_conflict', 'A commitment id already exists with different content');
      }
      return clone(existing);
    }
    inMemoryPut('life.commitments', record.id, record);
    commitments.set(record.id, record);
    return clone(record);
  }

  function updateCommitment(body = {}) {
    const id = requiredText(body.id, 'id', 160);
    const existing = commitments.get(id);
    if (!existing) throw new InputError(404, 'commitment_not_found', 'Commitment not found');
    if (body.character_id && canonicalCharacterId(body.character_id) !== existing.character_id) {
      throw new InputError(409, 'commitment_owner_conflict', 'A commitment belongs to another character');
    }
    const operation = body.operation ?? 'resolve';
    const status = operation === 'cancel' ? 'cancelled' : body.status;
    if (!['kept', 'missed', 'cancelled', 'open'].includes(status)) {
      throw new InputError(400, 'invalid_commitment_status', 'Resolve requires kept, missed, cancelled, or open status');
    }
    if (body.confirmed !== true) throw new InputError(400, 'confirmation_required', 'Commitment updates need explicit confirmation');
    const next = { ...existing, status, updated_at: now().toISOString(), resolution_evidence_ref: optionalText(body.evidence_ref, 'evidence_ref', 300) ?? existing.resolution_evidence_ref ?? null };
    inMemoryPut('life.commitments', id, next);
    commitments.set(id, next);
    return clone(next);
  }

  function relationshipTrends({ npcId = null, day = null, limit = 50 } = {}) {
    const world = worldSnapshot() ?? {};
    const npcs = new Map((world.npcs ?? []).map(npc => [npc.npc_id, npc]));
    const mutations = listMutations({ limit: 200 }) ?? [];
    const observations = [];
    for (const mutation of mutations) {
      if (mutation.action !== 'npc_interaction' && mutation.event_type !== 'world.mutation') continue;
      const detail = mutation.details ?? {};
      const id = detail.npc_id ?? detail.interaction?.npc_id;
      if (!id || (npcId && id !== npcId)) continue;
      const mutationLogicalDay = mutationDay(mutation);
      if (day !== null && mutationLogicalDay !== numericDay(day)) continue;
      const relationship = detail.relationship;
      if (!relationship || typeof relationship !== 'object') continue;
      observations.push({
        evidence_id: mutation.mutation_id ?? mutation.event_id,
        npc_id: id,
        occurred_at: occurredAt(mutation) ?? detail.interaction?.occurred_at ?? null,
        logical_day: mutationLogicalDay,
        familiarity: Number(relationship.familiarity) || 0,
        trust: Number(relationship.trust) || 0,
        encounters: Number(relationship.encounters) || 0,
        intent: detail.intent ?? detail.interaction?.intent ?? null,
      });
    }
    const byNpc = new Map();
    for (const item of observations.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))) {
      const list = byNpc.get(item.npc_id) ?? [];
      list.push(item);
      byNpc.set(item.npc_id, list);
    }
    return clone([...byNpc.entries()].map(([id, entries]) => {
      const currentNpc = npcs.get(id);
      const first = entries[0];
      const last = entries.at(-1);
      const familiarityDelta = last.familiarity - first.familiarity;
      const trustDelta = last.trust - first.trust;
      return {
        npc_id: id,
        npc_name: currentNpc?.display_name ?? null,
        familiarity: { current: last.familiarity, delta: familiarityDelta, direction: trendDirection(familiarityDelta) },
        trust: { current: last.trust, delta: trustDelta, direction: trendDirection(trustDelta) },
        encounters: last.encounters,
        window_days: first.logical_day !== null && last.logical_day !== null ? Math.max(0, last.logical_day - first.logical_day) : null,
        observation_count: entries.length,
        status: entries.length >= 2 ? 'observed' : 'insufficient_data',
        evidence_ids: entries.slice(-Math.max(1, Number(limit) || 50)).map(item => item.evidence_id),
      };
    }));
  }

  function deriveDailySummary({ day = null, characterId = DEFAULT_CHARACTER_ID } = {}) {
    const world = worldSnapshot() ?? {};
    const worldDay = numericDay(day) ?? numericDay(world.logical_time?.day) ?? 1;
    const normalizedCharacter = canonicalCharacterId(characterId);
    const mutations = (listMutations({ limit: 200 }) ?? []).filter(item => {
      const itemDay = mutationDay(item);
      return itemDay === worldDay;
    });
    // Build from canonical mutation evidence rather than from the latest
    // bounded world arrays. This keeps an old day's report stable even after
    // the recent-scene/experience ring buffers rotate.
    const experiences = mutations.flatMap(item => {
      const experience = item.details?.experience;
      if (!experience || (experience.character_id && canonicalCharacterId(experience.character_id) !== normalizedCharacter)) return [];
      return [{ ...clone(experience), evidence_ids: [item.mutation_id ?? item.event_id] }];
    });
    const scenes = mutations.flatMap(item => item.action === 'set_life_scene' && item.details?.scene
      ? [{ ...clone(item.details.scene), evidence_ids: [item.mutation_id ?? item.event_id] }]
      : []);
    const relationshipChanges = mutations.filter(item => item.action === 'npc_interaction' || item.details?.relationship).map(item => ({
      evidence_id: item.mutation_id ?? item.event_id,
      npc_id: item.details?.npc_id ?? null,
      relationship: clone(item.details?.relationship ?? null),
      occurred_at: occurredAt(item),
    }));
    const worldChanges = mutations.flatMap(item => (item.changes ?? []).map(change => ({
      evidence_id: item.mutation_id ?? item.event_id,
      field_path: change.field_path,
      before: clone(change.before),
      after: clone(change.after),
      occurred_at: occurredAt(item),
    })));
    const openCommitments = listCommitments({ characterId: normalizedCharacter, status: 'open' });
    const boundedExperiences = boundedItems(experiences);
    const boundedScenes = boundedItems(scenes);
    const boundedRelationships = boundedItems(relationshipChanges);
    const boundedWorldChanges = boundedItems(worldChanges);
    return {
      schema: 'deskbot.life-daily-summary.v0.1',
      id: `${normalizedCharacter}:${worldDay}`,
      character_id: normalizedCharacter,
      world_day: worldDay,
      calendar_date: worldDay === numericDay(world.logical_time?.day) ? (world.calendar?.date ?? null) : null,
      generated_at: now().toISOString(),
      status: boundedExperiences.length || boundedScenes.length || boundedRelationships.length || boundedWorldChanges.length ? 'recorded' : 'empty',
      turn_count: world.interaction?.user_turn_count ?? 0,
      experiences: boundedExperiences,
      scenes: boundedScenes,
      open_commitments: openCommitments,
      relationship_changes: boundedRelationships,
      world_changes: boundedWorldChanges,
      summary: defaultSummaryText({ day: worldDay, experiences: boundedExperiences, scenes: boundedScenes, relationshipChanges: boundedRelationships, worldChanges: boundedWorldChanges }),
      evidence_ids: [...new Set([
        ...boundedExperiences.flatMap(item => item.evidence_ids ?? []),
        ...boundedScenes.flatMap(item => item.evidence_ids ?? []),
        ...boundedRelationships.map(item => item.evidence_id),
        ...boundedWorldChanges.map(item => item.evidence_id),
      ])].filter(Boolean),
    };
  }

  function previewDailySummary(options = {}) {
    return clone(deriveDailySummary(options));
  }

  function materializeDailySummary(options = {}) {
    const summary = deriveDailySummary(options);
    inMemoryPut('life.daily-summaries', summary.id, summary);
    summaries.set(summary.id, summary);
    return clone(summary);
  }

  function getDailySummary({ day = null, characterId = DEFAULT_CHARACTER_ID, materialize = false } = {}) {
    const worldDay = numericDay(day) ?? numericDay(worldSnapshot()?.logical_time?.day) ?? 1;
    const id = `${canonicalCharacterId(characterId)}:${worldDay}`;
    if (!materialize && summaries.has(id)) return clone(summaries.get(id));
    return materialize ? materializeDailySummary({ day: worldDay, characterId }) : previewDailySummary({ day: worldDay, characterId });
  }

  function listDailySummaries({ characterId = null } = {}) {
    const normalizedCharacter = characterId ? canonicalCharacterId(characterId) : null;
    return clone([...summaries.values()].filter(item => !normalizedCharacter || item.character_id === normalizedCharacter).sort((a, b) => a.world_day - b.world_day));
  }

  function promptContinuity({ characterId = DEFAULT_CHARACTER_ID, day = null } = {}) {
    const worldDay = numericDay(day) ?? numericDay(worldSnapshot()?.logical_time?.day) ?? 1;
    const previous = summaries.get(`${canonicalCharacterId(characterId)}:${worldDay - 1}`) ?? null;
    return {
      previous_day_summary: previous ? clone({ world_day: previous.world_day, summary: previous.summary, evidence_ids: previous.evidence_ids }) : null,
      open_commitments: listCommitments({ characterId, status: 'open' }).slice(0, 8),
      relationship_trends: relationshipTrends({ limit: 8 }),
    };
  }

  return {
    createCommitment,
    updateCommitment,
    listCommitments,
    relationshipTrends,
    previewDailySummary,
    materializeDailySummary,
    getDailySummary,
    listDailySummaries,
    promptContinuity,
  };
}

export { COMMITMENT_STATUSES };
