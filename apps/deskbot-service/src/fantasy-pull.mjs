import { createHash } from 'node:crypto';

const DIRECTIONS = Object.freeze({
  wetland_frog: Object.freeze({ label: '荷叶青蛙', life: '潮湿、有弹性、会蹲在荷叶上的生活', cues: ['雨', '池塘', '湿地', '荷叶', '青蛙', '散步'] }),
  starry_observer: Object.freeze({ label: '星空观察者', life: '在夜空和远方之间寻找线索的生活', cues: ['星空', '星星', '夜空', '月亮', '观测', '宇宙'] }),
  workshop_maker: Object.freeze({ label: '工坊学徒', life: '拆解、修理和亲手构造东西的生活', cues: ['齿轮', '机械', '工坊', '修理', '制作', '拆解'] }),
  dream_cloud: Object.freeze({ label: '云朵梦境生物', life: '轻盈、跳跃、把联想变成道路的生活', cues: ['梦', '云', '幻想', '童话', '漂浮', '想象'] }),
});

function dynamicDirections(events = []) {
  const result = new Map();
  for (const event of events) {
    if (!isFantasyEvidenceEvent(event)) continue;
    const hint = event.payload?.role_direction ?? event.payload?.direction_hint;
    if (!hint || typeof hint !== 'object') continue;
    const label = typeof hint.label === 'string' ? hint.label.trim() : '';
    const life = typeof hint.life === 'string' ? hint.life.trim() : '';
    const cues = Array.isArray(hint.cues) ? hint.cues.filter(c => typeof c === 'string' && c.trim()).map(c => c.trim()).slice(0, 12) : [];
    if (!label || !life || cues.length < 2) continue;
    const directionId = typeof hint.direction_id === 'string' && /^[a-z0-9][a-z0-9_-]{2,60}$/.test(hint.direction_id)
      ? hint.direction_id : `dynamic_${label.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '_').replace(/^_|_$/g, '').slice(0, 48)}`;
    if (Object.hasOwn(DIRECTIONS, directionId)) continue;
    const previous = result.get(directionId);
    result.set(directionId, { label, life, cues: [...new Set([...(previous?.cues ?? []), ...cues])] });
  }
  return result;
}

function textOf(event) {
  return [
    event.payload?.text,
    event.payload?.summary,
    event.payload?.title,
    event.payload?.event?.summary,
    event.payload?.event?.title,
    event.payload?.snapshot?.condition,
    event.payload?.snapshot?.location,
    event.payload?.preference_key,
    event.payload?.value,
    event.payload?.role_direction?.label,
    event.payload?.role_direction?.life,
    ...(event.payload?.role_direction?.cues ?? []),
    event.payload?.direction_hint?.label,
    event.payload?.direction_hint?.life,
    ...(event.payload?.direction_hint?.cues ?? []),
  ]
    .filter((value) => typeof value === 'string').join(' ');
}

function sourceOf(event) {
  return event.layer ?? (event.type?.startsWith('world.') ? 'world_line' : event.source ?? 'unknown');
}

function provenanceIds(event, key) {
  const values = event.provenance?.[key];
  return Array.isArray(values)
    ? [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))].sort()
    : [];
}

function evidenceIdFor(event) {
  const refs = provenanceIds(event, 'evidence_ids');
  const ids = refs.length ? refs : provenanceIds(event, 'source_event_ids');
  if (!ids.length) return `evidence-${event.event_id}`;
  if (ids.length === 1) return ids[0].startsWith('evidence-') ? ids[0] : `evidence-${ids[0]}`;
  const digest = createHash('sha256').update(JSON.stringify(ids)).digest('hex').slice(0, 24);
  return `evidence-${digest}`;
}

function userEvidence(event) {
  const layer = sourceOf(event);
  const role = typeof event.payload?.role === 'string' ? event.payload.role.toLowerCase() : 'user';
  const sourceKind = event.source_kind;
  if (role !== 'user' || (sourceKind !== undefined && sourceKind !== 'user')) return false;
  return event.type === 'conversation.input' || layer === 'dialogue' || layer === 'user_profile';
}

function explicitlyDislikesCue(text, cue) {
  const negative = '(?:不太喜欢|不喜欢|讨厌|厌恶|排斥|不愿(?:意)?|没兴趣|不想(?:要|去|再)?|不要|拒绝)';
  let cueAt = text.indexOf(cue);
  while (cueAt >= 0) {
    const prefix = text.slice(Math.max(0, cueAt - 16), cueAt);
    const suffix = text.slice(cueAt + cue.length, cueAt + cue.length + 16);
    if (/(?:不是|并非)\s*(?:不太喜欢|不喜欢|讨厌|厌恶|排斥|不愿(?:意)?|没兴趣|不想|不要|拒绝)/.test(prefix)) {
      cueAt = text.indexOf(cue, cueAt + cue.length);
      continue;
    }
    if (new RegExp(`${negative}[^，。！？；,.!?;]{0,8}$`).test(prefix)
      || new RegExp(`^[^，。！？；,.!?;]{0,8}${negative}`).test(suffix)) return true;
    cueAt = text.indexOf(cue, cueAt + cue.length);
  }
  return false;
}

function polarityFor(event, cue, text) {
  const explicit = event.payload?.evidence_polarity;
  if (['support', 'conflict', 'neutral'].includes(explicit)) return explicit;
  if (!userEvidence(event)) return 'support';
  return explicitlyDislikesCue(text, cue) ? 'conflict' : 'support';
}

const EVIDENCE_LAYERS = new Set([
  'dialogue',
  'world_line',
  'weather',
  'external_context',
  'user_profile',
  'device_context',
]);

export function isFantasyEvidenceEvent(event) {
  if (!event || typeof event !== 'object') return false;
  const type = typeof event.type === 'string' ? event.type : '';
  const role = typeof event.payload?.role === 'string' ? event.payload.role.toLowerCase() : '';
  if (type === 'conversation.reply' || role === 'assistant') return false;
  if (type.startsWith('voice.') || type.startsWith('transport.') || type.startsWith('service.')) return false;
  if (type.startsWith('conversation.output') || type.startsWith('device.output') || type.startsWith('device.lifecycle')) return false;

  const layer = sourceOf(event);
  return EVIDENCE_LAYERS.has(layer) || type === 'conversation.input';
}

export function computeFantasyPull(events = [], { minSources = 2, minEvidence = 3, minScore = 0.25, maxCandidates = 3, now = new Date() } = {}) {
  const directionCatalog = { ...DIRECTIONS, ...Object.fromEntries(dynamicDirections(events)) };
  const scores = new Map(Object.keys(directionCatalog).map((id) => [id, {
    supportScore: 0,
    conflictScore: 0,
    evidence: [],
    sources: new Set(),
    opposingSources: new Set(),
    supportEvidenceIds: new Set(),
    seenEvidenceIds: new Set(),
  }]));
  const seen = new Set();
  for (const event of events) {
    if (!isFantasyEvidenceEvent(event)) continue;
    if (!event.event_id || seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const text = textOf(event);
    if (!text) continue;
    const source = sourceOf(event);
    const evidenceId = evidenceIdFor(event);
    for (const [id, direction] of Object.entries(directionCatalog)) {
      const cues = direction.cues.filter((cue) => text.includes(cue));
      if (!cues.length) continue;
      const bucket = scores.get(id);
      if (bucket.seenEvidenceIds.has(evidenceId)) continue;
      bucket.seenEvidenceIds.add(evidenceId);
      const ageHours = Math.max(0, (new Date(now).getTime() - new Date(event.received_at ?? event.observed_at ?? event.occurred_at ?? now).getTime()) / 3600000);
      const decay = Number.isFinite(ageHours) ? 1 / (1 + ageHours / 72) : 1;
      const weightedCues = cues.map((cue) => ({ cue, polarity: polarityFor(event, cue, text) }));
      const supportCues = weightedCues.filter((item) => item.polarity === 'support').map((item) => item.cue);
      const conflictCues = weightedCues.filter((item) => item.polarity === 'conflict').map((item) => item.cue);
      const neutralCues = weightedCues.filter((item) => item.polarity === 'neutral').map((item) => item.cue);
      const weight = (count) => Math.min(count, 2) * (event.confidence ?? 1) * decay;
      bucket.supportScore += weight(supportCues.length);
      bucket.conflictScore += weight(conflictCues.length);
      if (supportCues.length) {
        bucket.sources.add(source);
        bucket.supportEvidenceIds.add(evidenceId);
      }
      if (conflictCues.length) bucket.opposingSources.add(source);
      bucket.evidence.push({
        evidence_id: evidenceId,
        event_id: event.event_id,
        source_event_ids: provenanceIds(event, 'source_event_ids'),
        cues,
        support_cues: supportCues,
        conflict_cues: conflictCues,
        neutral_cues: neutralCues,
        polarity: supportCues.length && conflictCues.length ? 'mixed' : conflictCues.length ? 'conflict' : neutralCues.length && !supportCues.length ? 'neutral' : 'support',
        support_weight: Math.round(weight(supportCues.length) * 100) / 100,
        conflict_weight: Math.round(weight(conflictCues.length) * 100) / 100,
        source,
        layer: event.layer ?? null,
        observed_at: event.observed_at ?? null,
        occurred_at: event.occurred_at ?? null,
        confidence: event.confidence ?? null,
      });
    }
  }
  return [...scores.entries()]
    .map(([id, bucket]) => {
      const direction = directionCatalog[id];
      const netScore = Math.max(0, bucket.supportScore - bucket.conflictScore);
      const eligible = bucket.supportEvidenceIds.size >= minEvidence && bucket.sources.size >= minSources;
      const hasEvidence = bucket.evidence.length > 0;
      const hasConflictEvidence = bucket.evidence.some((item) => item.conflict_cues.length > 0);
      const hasNeutralEvidence = bucket.evidence.some((item) => item.neutral_cues.length > 0);
      const score = Math.round(netScore * 100) / 100;
      return {
        schema: 'deskbot.fantasy-pull.v0.4',
        direction_id: id,
        label: direction.label,
        life: direction.life,
        score,
        support_score: Math.round(bucket.supportScore * 100) / 100,
        conflict_score: Math.round(bucket.conflictScore * 100) / 100,
        fantasy_pull: Math.min(1, Math.round((score / 6) * 100) / 100),
        // Keep the event-level explanation with the pull.  The role
        // evolution layer persists this as durable evidence instead of
        // asking callers to reconstruct it from a transient score.
        evidence: bucket.evidence.map((item) => ({
          ...item,
          source: item.source ?? null,
          layer: item.layer ?? null,
          observed_at: item.observed_at ?? null,
          occurred_at: item.occurred_at ?? null,
          confidence: item.confidence ?? null,
        })),
        evidence_ids: [...new Set(bucket.evidence.map((item) => item.evidence_id))],
        support_evidence_ids: [...bucket.supportEvidenceIds],
        conflict_evidence_ids: [...new Set(bucket.evidence.filter((item) => item.conflict_cues.length).map((item) => item.evidence_id))],
        sources: [...bucket.sources],
        opposing_sources: [...bucket.opposingSources],
        status: eligible && score >= minScore ? 'candidate' : 'observing',
        reason: eligible && score >= minScore ? '跨来源支持证据达到门槛，可供角色提案层考虑。' : score < minScore ? '净支持信号低于保留线，继续观察即可。' : '支持证据或来源仍不足，只保持观察。',
        has_evidence: hasEvidence,
        has_conflict_evidence: hasConflictEvidence,
        has_neutral_evidence: hasNeutralEvidence,
      };
    })
    .filter((item) => item.has_evidence)
    .filter((item) => item.status === 'candidate' || item.score >= minScore || item.has_conflict_evidence || item.has_neutral_evidence)
    .sort((a, b) => b.score - a.score || a.direction_id.localeCompare(b.direction_id))
    .slice(0, Math.max(1, maxCandidates));
}

export { DIRECTIONS };
