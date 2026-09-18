import { InputError } from './input-store.mjs';
import { createPersistentWorld, previewWorldMutations, PersistentWorldError } from './persistent-world.mjs';
import { canonicalCharacterId, DEFAULT_CHARACTER_ID } from './world-definition.mjs';

function text(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) {
    throw new InputError(400, 'invalid_shared_life', `${field} must be non-empty text (max 2000)`);
  }
  return value.trim();
}

function hanNgrams(value, min = 2, max = 4) {
  const runs = String(value ?? '').match(/[\p{Script=Han}]+/gu) ?? [];
  const result = new Set();
  for (const run of runs) {
    for (let size = min; size <= Math.min(max, run.length); size++) {
      for (let index = 0; index <= run.length - size; index++) result.add(run.slice(index, index + size));
    }
  }
  return [...result];
}

// Only explicit user-confirmed notes are memories. Generated replies never enter here.
export function createSharedLife({ persistence = null, now = () => new Date(), ingest, worldSnapshot = null, npcReserved = () => false }) {
  const memories = new Map((persistence?.list('life.memories') ?? []).map(x => [x.id, x]));
  const plans = new Map((persistence?.list('life.plans') ?? []).map(x => [x.id, x]));
  const boundaries = new Map((persistence?.list('life.memory-boundaries') ?? []).map(x => [x.character_id, x]));
  function invalidateHistory(characterId) {
    const record = { character_id: characterId, before_or_at: now().toISOString() };
    persistence?.put('life.memory-boundaries', characterId, record);
    boundaries.set(characterId, record);
  }
  function atomic(operation) {
    return persistence?.transaction ? persistence.transaction(operation) : operation();
  }
  function remember(body) {
    if (body.confirmed !== true) throw new InputError(400, 'confirmation_required', 'Memory needs explicit confirmation');
    const id = text(body.id, 'id');
    const record = {
      id, character_id: canonicalCharacterId(body.character_id ?? DEFAULT_CHARACTER_ID),
      text: text(body.text, 'text'), source: 'user_confirmed',
      evidence_ref: text(body.evidence_ref, 'evidence_ref'),
      updated_at: now().toISOString(), revision: (memories.get(id)?.revision ?? 0) + 1,
    };
    const previous = memories.get(id);
    if (previous && previous.character_id !== record.character_id) {
      throw new InputError(409, 'memory_owner_conflict', 'A memory cannot move between characters');
    }
    atomic(() => {
      persistence?.put('life.memories', id, record);
      if (previous && previous.text !== record.text) invalidateHistory(record.character_id);
    });
    memories.set(id, record);
    return structuredClone(record);
  }
  function recall(characterId = DEFAULT_CHARACTER_ID, limit = 20) {
    return structuredClone([...memories.values()].filter(x => x.character_id === canonicalCharacterId(characterId))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)).slice(0, limit));
  }
  function forget(id) {
    const previous = memories.get(id);
    if (!previous) return false;
    atomic(() => {
      persistence?.remove('life.memories', id);
      invalidateHistory(previous.character_id);
    });
    return memories.delete(id);
  }
  function historyAfter(characterId) {
    return boundaries.get(canonicalCharacterId(characterId))?.before_or_at ?? null;
  }
  function retrieve(characterId, query = '') {
    // Local lexical retrieval, not semantic understanding. No external embeddings/cost.
    const terms = new Set(String(query).toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]/gu) ?? []);
    const scored = recall(characterId, Infinity).map(memory => ({ memory,
      score: [...terms].filter(term => memory.text.toLowerCase().includes(term)).length,
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, 8).map(x => x.memory);
  }
  function retrieveExperiences(query = '', providedWorld = null) {
    const world = providedWorld ?? worldSnapshot?.();
    if (!world) return [];
    const normalizedQuery = String(query).trim().toLowerCase();
    if (!normalizedQuery) return [];
    const temporalCue = /(刚才|上次|以前|之前|记得|那次|经历|发生|一起|去过|遇见)/u.test(normalizedQuery);
    const locations = new Map((world.locations ?? []).map(location => [location.location_id, location.name ?? location.location_id]));
    const experiences = (world.life?.recent_experiences ?? []).map(item => ({
      source_type: 'npc_experience',
      evidence_ids: [item.experience_id],
      experience_id: item.experience_id,
      scene_id: item.scene_id ?? null,
      npc_id: item.npc_id ?? null,
      npc_name: item.npc_name ?? null,
      location_id: item.location_id ?? null,
      location_name: locations.get(item.location_id) ?? item.location_id ?? null,
      summary: item.summary,
      occurred_at: item.occurred_at ?? null,
    }));
    const scenes = [world.life?.current_scene, ...(world.life?.recent_scenes ?? [])].filter(Boolean).map(scene => ({
      source_type: 'scene',
      evidence_ids: [scene.scene_id, ...(scene.cause_event_ids ?? []), ...(scene.cause_experience_ids ?? [])],
      experience_id: null,
      scene_id: scene.scene_id,
      npc_id: null,
      npc_name: null,
      location_id: scene.location_id,
      location_name: locations.get(scene.location_id) ?? scene.location_id ?? null,
      summary: [scene.title, scene.narration].filter(Boolean).join('：'),
      occurred_at: scene.ended_at ?? scene.started_at ?? null,
      arc_id: scene.arc_id ?? null,
      branch_key: scene.branch_key ?? null,
      resolution_state: scene.resolution_state ?? null,
    }));
    const candidates = [...experiences, ...scenes];
    const namedAnchors = new Set();
    for (const candidate of candidates) {
      for (const value of [candidate.npc_name, candidate.location_name, candidate.arc_id]) {
        for (const token of hanNgrams(value)) namedAnchors.add(token.toLowerCase());
        if (typeof value === 'string' && /[a-z0-9]/i.test(value)) namedAnchors.add(value.toLowerCase());
      }
    }
    const queryAnchors = [...namedAnchors].filter(anchor => normalizedQuery.includes(anchor));
    if (!temporalCue && queryAnchors.length === 0) return [];
    return candidates.map((candidate, index) => {
      const haystack = JSON.stringify(candidate).toLowerCase();
      const score = (temporalCue ? (candidate.source_type === 'npc_experience' ? 2 : 1) : 0)
        + queryAnchors.filter(anchor => haystack.includes(anchor)).length * 4;
      return { candidate, score, index };
    }).filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score
        || String(right.candidate.occurred_at ?? '').localeCompare(String(left.candidate.occurred_at ?? ''))
        || left.index - right.index)
      .slice(0, queryAnchors.length ? 6 : 2)
      .map(item => structuredClone(item.candidate));
  }
  function schedule(body) {
    const id = text(body.id, 'id');
    if (plans.has(id)) throw new InputError(409, 'plan_exists', 'Use a new plan ID');
    if (!Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 20) {
      throw new InputError(400, 'invalid_plan', 'A plan needs 1 to 20 steps');
    }
    const steps = body.steps.map((step, index) => {
      if (!step || typeof step !== 'object') throw new InputError(400, 'invalid_plan', 'Invalid step');
      const at = Date.parse(step.at);
      if (!Number.isFinite(at)) throw new InputError(400, 'invalid_plan', 'Invalid step time');
      if (!['apply_world_line_event', 'upsert_npc', 'npc_action'].includes(step.payload?.action)) {
        throw new InputError(400, 'invalid_plan', 'Only world-line and NPC actions can be scheduled');
      }
      return { index, at: new Date(at).toISOString(), payload: structuredClone(step.payload), status: 'pending' };
    });
    if (steps.some((step, i) => i > 0 && step.at < steps[i - 1].at)) {
      throw new InputError(400, 'invalid_plan', 'Steps must be chronological');
    }
    // Use the same domain rules as execution, on a clone with no ledger writes.
    try {
      previewWorldMutations(worldSnapshot?.() ?? createPersistentWorld({ now }).get(), steps.map(s => s.payload));
    } catch (error) {
      if (!(error instanceof PersistentWorldError)) throw error;
      throw new InputError(error.statusCode, 'invalid_plan_world_mutation', error.message);
    }
    const resources = new Set(steps.map(step => step.payload.action === 'apply_world_line_event'
      ? 'world-line' : `npc:${step.payload.npc?.npc_id ?? step.payload.npc_id}`));
    for (const resource of resources) {
      if (resource.startsWith('npc:') && npcReserved(resource.slice(4))) throw new InputError(409, 'npc_reserved', 'NPC has an unfinished goal');
    }
    for (const existing of plans.values()) {
      if (existing.cancelled_at) continue;
      const pending = existing.steps.filter(s => s.status === 'pending' || s.status === 'failed');
      for (const step of pending) {
        const resource = step.payload.action === 'apply_world_line_event'
          ? 'world-line' : `npc:${step.payload.npc?.npc_id ?? step.payload.npc_id}`;
        if (resources.has(resource)) {
          throw new InputError(409, 'plan_resource_conflict', `Resource ${resource} is reserved by plan ${existing.id}; cancel it first`);
        }
      }
    }
    const plan = { id, steps, created_at: now().toISOString() };
    persistence?.put('life.plans', id, plan);
    plans.set(id, plan);
    return structuredClone(plan);
  }
  function tick() {
    let applied = 0;
    // Limit catch-up work per tick; never generate fictional user participation.
    for (const plan of plans.values()) {
      if (plan.cancelled_at) continue;
      for (const step of plan.steps) {
        if (step.status === 'failed') break;
        if (step.status !== 'pending') continue;
        if (Date.parse(step.at) > now().getTime() || applied >= 3) break;
        try {
          ingest({ event_id: `life:${plan.id}:${step.index}`, type: 'world.mutation',
            source: 'shared-life-scheduler', source_kind: 'world_engine', layer: 'world_line',
            occurred_at: step.at, observed_at: step.at, confidence: 1,
            character_id: DEFAULT_CHARACTER_ID, payload: step.payload });
          step.status = 'applied';
          step.applied_at = now().toISOString();
          applied++;
        } catch (error) {
          step.status = 'failed';
          step.error = error instanceof PersistentWorldError || error instanceof InputError
            ? error.code : 'world_mutation_rejected';
        }
        persistence?.put('life.plans', plan.id, plan);
      }
    }
    return { applied };
  }
  function cancel(id) {
    const plan = plans.get(id);
    if (!plan) throw new InputError(404, 'plan_not_found', 'Plan not found');
    plan.cancelled_at ??= now().toISOString();
    for (const step of plan.steps) {
      if (step.status === 'pending') step.status = 'cancelled';
    }
    persistence?.put('life.plans', id, plan);
    return structuredClone(plan);
  }
  return { remember, recall, retrieve, retrieveExperiences, historyAfter, forget, schedule, tick, cancel,
    plans: () => structuredClone([...plans.values()]) };
}
