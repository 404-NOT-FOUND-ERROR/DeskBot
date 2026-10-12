// Adapted from Asamana's separate retrieval scorer: one pure implementation
// supplies recall and its diagnostics. No embedding provider or read-side writes
// are required; importance and decay change recall, never canonical evidence.
export const MEMORY_RECALL_VERSION = 'deskbot.memory-recall.v1';
export const MEMORY_RECALL_POLICY = Object.freeze({
  schema: MEMORY_RECALL_VERSION,
  relevance: 'lexical_cosine_v1',
  weights: Object.freeze({ relevance: .7, recency: .2, importance: .1 }),
  recency_half_life_hours: 72,
  decay_half_life_hours: Object.freeze({ factual: 336, experiential: 168, reported: 72 }),
  duplicate_similarity: .9,
  factual_anchor_slot: 'one_when_limit_at_least_two',
  linked_factual_sources: 'at_most_three_no_extra_recall_slots',
  read_side_effects: false,
});
const HOUR = 3600000;
// Canonical task fixtures and clock reconciliation can place an observed record
// a few seconds ahead of the read clock. Keep the same bounded skew used by the
// role-evidence layer; genuinely future memories still remain excluded.
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const timestamp = value => value instanceof Date ? value.getTime()
  : typeof value === 'number' ? value : Date.parse(value ?? '');
const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));

export function memoryStream(episode) {
  return episode.kind === 'world_fact' ? 'factual'
    : episode.kind === 'personal_interpretation' ? 'experiential' : 'reported';
}

export function memoryAnchor(episode) {
  const source = episode.source ?? {};
  // Project and task views of one actual outcome share a recall anchor. This
  // collapses views, not facts or development roots in the persistent ledger.
  if (episode.kind === 'world_fact' && source.task_id) return `task:${source.task_id}:${episode.outcome ?? ''}`;
  if (source.commitment_id) return `commitment:${source.commitment_id}:${episode.outcome ?? ''}`;
  if (source.record_id) return `observation:${source.record_id}`;
  return episode.origin_id ?? episode.id;
}

function tokens(text) {
  const normalized = String(text ?? '').normalize('NFKC').toLowerCase();
  const result = new Map();
  const add = token => result.set(token, (result.get(token) ?? 0) + 1);
  for (const token of normalized.match(/[a-z0-9][a-z0-9_-]*/g) ?? []) add(token);
  for (const run of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) add(run);
    for (let i = 0; i < run.length - 1; i++) add(run.slice(i, i + 2));
  }
  return result;
}

function cosine(left, right) {
  let dot = 0, ln = 0, rn = 0;
  for (const [token, count] of left) { ln += count ** 2; dot += count * (right.get(token) ?? 0); }
  for (const count of right.values()) rn += count ** 2;
  return ln && rn ? clamp(dot / Math.sqrt(ln * rn)) : 0;
}

function normalize(values) {
  const low = Math.min(...values), high = Math.max(...values);
  return values.map(value => high - low < 1e-9 ? .5 : (value - low) / (high - low));
}

function importance(episode) {
  if (typeof episode.importance === 'number' && Number.isFinite(episode.importance)) return clamp(episode.importance);
  if (episode.kind === 'personal_interpretation') return .45;
  if (episode.kind !== 'world_fact') return .3;
  if (episode.source?.kind === 'canonical_commitment') return .8;
  if (episode.source?.kind === 'resident_project') return .75;
  if (episode.outcome === 'failed') return .7;
  return episode.independent_evidence ? .65 : .55;
}

function comparable(a, b) {
  return a.stream === b.stream && a.episode.kind === b.episode.kind
    && a.episode.topic === b.episode.topic && a.episode.outcome === b.episode.outcome
    && a.episode.location_id === b.episode.location_id;
}

/** R/I/R recall with MMR-style redundancy suppression and source diagnostics.
 * Every stored episode remains intact. Future/invalid records cannot be recalled,
 * expired reports are historical memories, and interpretation remains a separate
 * stream rather than being upgraded into factual evidence.
 */
export function rankMemoryEpisodes(episodes, {
  actorId, query = '', limit = 8, at,
  textForRecall = episode => episode.text,
  topicLabel = () => '',
} = {}) {
  const atMs = timestamp(at);
  if (!Number.isFinite(atMs)) return { schema: MEMORY_RECALL_VERSION, policy: MEMORY_RECALL_POLICY, selected: [], diagnostics: [] };
  const queryTokens = tokens(query);
  const rows = (episodes ?? []).filter(episode => episode.actor_ids?.includes(actorId)).map(episode => {
    const occurredMs = timestamp(episode.at);
    const stream = memoryStream(episode), ageHours = Number.isFinite(occurredMs) ? Math.max(0, (atMs - occurredMs) / HOUR) : Infinity;
    const rawImportance = importance(episode);
    const representation = String(textForRecall(episode) ?? '');
    const contentTokens = tokens(representation);
    const relevanceTokens = tokens(`${representation} ${topicLabel(episode.topic)}`);
    const expired = Boolean(episode.expires_at && timestamp(episode.expires_at) <= atMs);
    const decay = rawImportance >= .9 ? 1 : 2 ** (-ageHours / MEMORY_RECALL_POLICY.decay_half_life_hours[stream]);
    return { episode, stream, anchor: memoryAnchor(episode), contentTokens, representation,
      relevance: queryTokens.size ? cosine(queryTokens, relevanceTokens) : 0,
      recency: 2 ** (-ageHours / MEMORY_RECALL_POLICY.recency_half_life_hours), importance: rawImportance,
      decay, expired, eligible: Number.isFinite(occurredMs) && occurredMs <= atMs + MAX_FUTURE_SKEW_MS,
      dropped: Number.isFinite(occurredMs) ? occurredMs > atMs + MAX_FUTURE_SKEW_MS ? 'future' : null : 'invalid_time', duplicateOf: null };
  });
  const rowById = new Map(rows.map(row => [row.episode.id, row]));
  // Bind an interpretation to the factual event(s) it cites. This is the same
  // event_group_id invariant as Asamana: the feeling is recallable, but it can
  // never silently replace the citable world result.
  for (const row of rows) {
    const source = (row.episode.evidence_ids ?? []).map(id => rowById.get(id)).find(Boolean);
    if (source) row.anchor = source.anchor;
  }
  const eligible = rows.filter(row => row.eligible);
  const relevance = normalize(eligible.map(row => row.relevance));
  const recency = normalize(eligible.map(row => row.recency));
  const intrinsic = normalize(eligible.map(row => row.importance));
  const weights = MEMORY_RECALL_POLICY.weights;
  eligible.forEach((row, index) => {
    row.factors = { relevance: relevance[index], recency: recency[index], importance: intrinsic[index] };
    // Deeply faded memories are still available by a strong query; an expired
    // report is especially weak as current context, but is never silently erased.
    row.decayPenalty = row.decay < .2 ? row.decay : 1;
    row.expiryPenalty = row.expired && row.stream === 'reported' ? .2 : 1;
    row.score = (weights.relevance * row.factors.relevance + weights.recency * row.factors.recency
      + weights.importance * row.factors.importance) * row.decayPenalty * row.expiryPenalty;
  });
  eligible.sort((a, b) => b.score - a.score || String(b.episode.at).localeCompare(String(a.episode.at))
    || String(a.episode.id).localeCompare(String(b.episode.id)));
  const selected = [], count = Number.isFinite(limit) ? Math.floor(clamp(limit, 0, 48)) : 8;
  for (const row of eligible) {
    const duplicate = selected.find(prior => prior.stream === row.stream && prior.anchor === row.anchor
      || comparable(prior, row) && (prior.representation === row.representation
        || cosine(prior.contentTokens, row.contentTokens) > MEMORY_RECALL_POLICY.duplicate_similarity));
    if (duplicate) { row.dropped = 'mmr_duplicate'; row.duplicateOf = duplicate.episode.id; }
    else if (selected.length >= count) row.dropped = 'top_k';
    else selected.push(row);
  }
  // A run of recent self-interpretations must not exhaust all grounding slots.
  // With one slot, linked facts accompany the selected interpretation below;
  // with two or more slots, keep one independently recalled factual anchor.
  if (count >= 2 && !selected.some(row => row.stream === 'factual')) {
    const factual = eligible.find(row => row.stream === 'factual');
    if (factual) {
      if (selected.length === count) selected.pop().dropped = 'factual_anchor_reserved';
      factual.dropped = null;
      selected.push(factual);
    }
  }
  const eligibleIds = new Set(eligible.map(row => row.episode.id));
  const factsById = new Map(eligible.filter(row => row.stream === 'factual').map(row => [row.episode.id, row]));
  return {
    schema: MEMORY_RECALL_VERSION, policy: MEMORY_RECALL_POLICY,
    selected: selected.map(row => ({ ...structuredClone(row.episode), expired: row.expired,
      memory_stream: row.stream, event_anchor: row.anchor,
      linked_memory_ids: [...new Set((row.episode.evidence_ids ?? []).filter(id => eligibleIds.has(id)))],
      // An interpretation can be recalled in one slot, but it carries the exact
      // witnessed sources that grounded it. Source statements keep their own
      // factual type, never become part of the interpretation's assertion.
      factual_sources: [...new Set(row.episode.evidence_ids ?? [])].map(id => factsById.get(id)).filter(Boolean).slice(0, 3)
        .map(source => ({ ...structuredClone(source.episode), memory_stream: 'factual',
          event_anchor: source.anchor, expired: source.expired })),
    })),
    // Diagnostics carry no prose, especially not a private representation hidden
    // behind model_text. The exact scorer is shared with production recall.
    diagnostics: rows.map(row => ({ memory_id: row.episode.id, stream: row.stream, event_anchor: row.anchor,
      raw: { relevance: row.relevance, recency: Number.isFinite(row.recency) ? row.recency : 0,
        importance: row.importance, decay: Number.isFinite(row.decay) ? row.decay : 0 },
      normalized: row.factors ?? null, score: row.score ?? 0, expired: row.expired,
      dropped: row.dropped, duplicate_of: row.duplicateOf })),
  };
}
