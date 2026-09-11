import { randomUUID } from 'node:crypto';

import { DEFAULT_CHARACTER_ID, canonicalCharacterId } from './world-definition.mjs';

const SESSION_VERSION = 'p3-v0.1';
const MAX_TURNS = 200;
const CATEGORIES = Object.freeze([
  'direct_task',
  'fact_qa',
  'emotion_support',
  'world_discussion',
  'probe',
]);

function clone(value) {
  return structuredClone(value);
}

function requireText(value, field, maxLength = 200) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ResearchSessionError(400, 'invalid_research_session', `${field} must be a non-empty string`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new ResearchSessionError(413, 'invalid_research_session', `${field} exceeds ${maxLength} characters`);
  }
  return text;
}

function optionalText(value, field, maxLength = 200) {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, field, maxLength);
}

function category(value) {
  const normalized = requireText(value, 'category', 40);
  if (!CATEGORIES.includes(normalized)) {
    throw new ResearchSessionError(400, 'invalid_research_session', `category must be one of: ${CATEGORIES.join(', ')}`);
  }
  return normalized;
}

export class ResearchSessionError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ResearchSessionError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function getResearchSessionContract() {
  return {
    schema: 'foundry.research-session-contract.v0.1',
    session_version: SESSION_VERSION,
    categories: [...CATEGORIES],
    retention: 'session stores metadata and turn/probe references; raw chat remains in canonical chat ledger',
    world_write_policy: 'session operations do not mutate canonical world or short state',
  };
}

export function createResearchSessionStore({ now = () => new Date(), persistence = null, turnResolver = () => null, probeResolver = () => null } = {}) {
  const sessions = new Map(
    (persistence?.list('research.sessions') ?? []).map((session) => [session.session_id, session]),
  );

  function get(sessionId) {
    const id = requireText(sessionId, 'session_id', 120);
    const session = sessions.get(id);
    if (!session) return null;
    return clone(session);
  }

  function list({ characterId = null, status = null, limit = 50 } = {}) {
    const max = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    const canonicalId = characterId ? canonicalCharacterId(characterId) : null;
    return [...sessions.values()]
      .filter((session) => !canonicalId || session.character_id === canonicalId)
      .filter((session) => !status || session.status === status)
      .slice(-max)
      .reverse()
      .map(clone);
  }

  function start(input = {}) {
    const sessionId = optionalText(input.session_id, 'session_id', 120) || `research-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const existing = sessions.get(sessionId);
    const characterId = canonicalCharacterId(input.character_id ?? DEFAULT_CHARACTER_ID);
    const label = optionalText(input.label, 'label', 120);
    const scenarioId = optionalText(input.scenario_id, 'scenario_id', 120);
    const operatorId = optionalText(input.operator_id, 'operator_id', 120);
    if (existing) {
      if (existing.character_id !== characterId || existing.scenario_id !== scenarioId || existing.label !== label) {
        throw new ResearchSessionError(409, 'research_session_conflict', `session ${sessionId} already exists with different metadata`);
      }
      return { duplicate: true, session: clone(existing) };
    }
    const startedAt = input.started_at ?? now().toISOString();
    if (typeof startedAt !== 'string' || Number.isNaN(Date.parse(startedAt))) {
      throw new ResearchSessionError(400, 'invalid_research_session', 'started_at must be an ISO date-time string');
    }
    const session = {
      schema: 'foundry.research-session.v0.1',
      session_version: SESSION_VERSION,
      session_id: sessionId,
      character_id: characterId,
      status: 'open',
      label,
      scenario_id: scenarioId,
      operator_id: operatorId,
      started_at: startedAt,
      completed_at: null,
      turn_refs: [],
      probe_observation_ids: [],
      notes: [],
    };
    sessions.set(sessionId, session);
    persistence?.put('research.sessions', sessionId, session);
    return { duplicate: false, session: clone(session) };
  }

  function attachTurn(sessionId, input = {}) {
    const id = requireText(sessionId, 'session_id', 120);
    const session = sessions.get(id);
    if (!session) throw new ResearchSessionError(404, 'research_session_not_found', `unknown session ${id}`);
    if (session.status !== 'open') throw new ResearchSessionError(409, 'research_session_closed', `session ${id} is already completed`);
    const turnId = requireText(input.turn_id, 'turn_id', 200);
    const turn = turnResolver(turnId);
    if (!turn) throw new ResearchSessionError(404, 'research_turn_not_found', `unknown chat turn ${turnId}`);
    if (canonicalCharacterId(turn.input_event?.character_id) !== session.character_id) {
      throw new ResearchSessionError(409, 'research_character_conflict', 'turn character does not match session character');
    }
    const turnCategory = category(input.category);
    const existing = session.turn_refs.find((ref) => ref.turn_id === turnId);
    if (existing) {
      if (existing.category !== turnCategory) throw new ResearchSessionError(409, 'research_turn_conflict', `turn ${turnId} already has a different category`);
      return { duplicate: true, session: clone(session), turn_ref: clone(existing) };
    }
    if (session.turn_refs.length >= MAX_TURNS) throw new ResearchSessionError(413, 'research_session_full', `session cannot exceed ${MAX_TURNS} turns`);
    const turnRef = {
      turn_id: turnId,
      category: turnCategory,
      attached_at: now().toISOString(),
      state_revision: turn.state?.state_revision ?? null,
      world_revision: turn.canonical_world?.snapshot?.world_revision ?? null,
      provider: turn.provider ?? null,
      interaction_route: turn.interaction_decision?.route ?? turn.reply_interaction_decision?.route ?? null,
      input_event_id: turn.input_event?.event_id ?? null,
      reply_event_id: turn.reply_event?.event_id ?? null,
    };
    session.turn_refs.push(turnRef);
    persistence?.put('research.sessions', id, session);
    return { duplicate: false, session: clone(session), turn_ref: clone(turnRef) };
  }

  function attachProbe(sessionId, input = {}) {
    const id = requireText(sessionId, 'session_id', 120);
    const session = sessions.get(id);
    if (!session) throw new ResearchSessionError(404, 'research_session_not_found', `unknown session ${id}`);
    if (session.status !== 'open') throw new ResearchSessionError(409, 'research_session_closed', `session ${id} is already completed`);
    const observationId = requireText(input.observation_id, 'observation_id', 200);
    if (!probeResolver(observationId)) throw new ResearchSessionError(404, 'research_probe_not_found', `unknown probe observation ${observationId}`);
    if (session.probe_observation_ids.includes(observationId)) return { duplicate: true, session: clone(session) };
    session.probe_observation_ids.push(observationId);
    persistence?.put('research.sessions', id, session);
    return { duplicate: false, session: clone(session) };
  }

  function addNote(sessionId, input = {}) {
    const id = requireText(sessionId, 'session_id', 120);
    const session = sessions.get(id);
    if (!session) throw new ResearchSessionError(404, 'research_session_not_found', `unknown session ${id}`);
    if (session.status !== 'open') throw new ResearchSessionError(409, 'research_session_closed', `session ${id} is already completed`);
    const note = requireText(input.note, 'note', 2000);
    session.notes.push({ note, recorded_at: now().toISOString() });
    persistence?.put('research.sessions', id, session);
    return { session: clone(session) };
  }

  function complete(sessionId, input = {}) {
    const id = requireText(sessionId, 'session_id', 120);
    const session = sessions.get(id);
    if (!session) throw new ResearchSessionError(404, 'research_session_not_found', `unknown session ${id}`);
    if (session.status === 'completed') return { duplicate: true, session: clone(session) };
    session.status = 'completed';
    session.completed_at = input.completed_at ?? now().toISOString();
    persistence?.put('research.sessions', id, session);
    return { duplicate: false, session: clone(session) };
  }

  return { start, get, list, attachTurn, attachProbe, addNote, complete, size: () => sessions.size };
}

export { CATEGORIES, SESSION_VERSION };
