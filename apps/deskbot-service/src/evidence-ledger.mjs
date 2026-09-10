import { InputError } from './input-store.mjs';
import { characterIdsEqual } from './world-definition.mjs';

function eligibilityFor(event) {
  if (event.type === 'voice.asr.partial'
    || event.type === 'voice.asr.final'
    || event.type === 'voice.partial'
    || event.type === 'voice.final'
    || event.type === 'conversation.input.partial'
    || event.type === 'conversation.input.final'
    || event.payload?.stage === 'partial'
    || event.payload?.stage === 'final') {
    return {
      status: 'audit_only',
      reason: 'ASR transport stages are not independent user observations',
      weight_hint: 0,
    };
  }

  if (event.type === 'conversation.reply' || event.type === 'device.action.completed' || event.type === 'device.hello') {
    return {
      status: 'audit_only',
      reason: 'output and device lifecycle events cannot directly change long-term role state',
      weight_hint: 0,
    };
  }

  if (event.source === 'manual') {
    return { status: 'candidate', reason: 'explicitly labelled human observation', weight_hint: 1 };
  }

  if (event.type === 'conversation.input') {
    return { status: 'candidate', reason: 'user interaction can support a later rule-based transition', weight_hint: 0.6 };
  }

  if (event.type.startsWith('world.')) {
    return { status: 'context_only', reason: 'world conditions shape the current situation but do not prove a trait', weight_hint: 0.35 };
  }

  if (event.type.startsWith('sensor.')) {
    return { status: 'candidate', reason: 'sensor observation requires confidence and repetition checks', weight_hint: 0.35 };
  }

  return { status: 'candidate', reason: 'unclassified input requires a later evidence rule', weight_hint: 0.25 };
}

export function createEvidenceLedger({ now = () => new Date(), persistence = null } = {}) {
  const records = new Map(
    (persistence?.list('evidence.records') ?? []).map((record) => [record.evidence_id, record]),
  );

  function record({ event, analysis = null, worldMatches = [] }) {
    const evidenceId = `evidence-${event.event_id}`;
    const existing = records.get(evidenceId);

    if (existing) {
      const sameEvent = existing.event_id === event.event_id
        && existing.event_type === event.type
        && existing.source === event.source;
      if (!sameEvent) {
        throw new InputError(409, 'evidence_id_conflict', `${evidenceId} already refers to a different event`);
      }
      return { evidence: existing, duplicate: true };
    }

    const eligibility = eligibilityFor(event);
    const evidence = {
      schema: 'foundry.evidence.v0.1',
      evidence_id: evidenceId,
      event_id: event.event_id,
      event_type: event.type,
      character_id: event.character_id,
      source: event.source,
      observed_at: event.occurred_at,
      recorded_at: now().toISOString(),
      eligibility,
      analysis: analysis ? {
        analyzer: analysis.analyzer ?? 'external',
        label: analysis.label ?? null,
        valence: analysis.valence ?? null,
        arousal: analysis.arousal ?? null,
        confidence: analysis.confidence ?? null,
        cues: analysis.cues ?? [],
      } : null,
      world_rule_matches: worldMatches.map((match) => ({
        rule_id: match.rule_id,
        rule_version: match.rule_version,
        priority: match.priority,
        expires_at: match.expires_at,
      })),
      role_revision_committed: null,
    };

    records.set(evidenceId, evidence);
    persistence?.put('evidence.records', evidenceId, evidence);
    return { evidence, duplicate: false };
  }

  function list({ characterId, status, limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return [...records.values()]
      .filter((record) => !characterId || characterIdsEqual(record.character_id, characterId))
      .filter((record) => !status || record.eligibility.status === status)
      .slice(-boundedLimit);
  }

  return {
    get: (evidenceId) => records.get(evidenceId) ?? null,
    list,
    record,
    size: () => records.size,
  };
}

export { eligibilityFor };
