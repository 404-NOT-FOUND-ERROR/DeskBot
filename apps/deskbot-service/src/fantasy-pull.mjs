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
  const scores = new Map(Object.keys(directionCatalog).map((id) => [id, { score: 0, evidence: [], sources: new Set() }]));
  const seen = new Set();
  for (const event of events) {
    if (!isFantasyEvidenceEvent(event)) continue;
    if (!event.event_id || seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const text = textOf(event);
    if (!text) continue;
    const source = sourceOf(event);
    for (const [id, direction] of Object.entries(directionCatalog)) {
      const cues = direction.cues.filter((cue) => text.includes(cue));
      if (!cues.length) continue;
      const bucket = scores.get(id);
      const ageHours = Math.max(0, (new Date(now).getTime() - new Date(event.occurred_at ?? event.observed_at ?? now).getTime()) / 3600000);
      const decay = Number.isFinite(ageHours) ? 1 / (1 + ageHours / 72) : 1;
      bucket.score += Math.min(cues.length, 2) * (event.confidence ?? 1) * decay;
      bucket.evidence.push({ evidence_id: `evidence-${event.event_id}`, event_id: event.event_id, cues });
      bucket.sources.add(source);
    }
  }
  return [...scores.entries()]
    .map(([id, bucket]) => {
      const direction = directionCatalog[id];
      const eligible = bucket.evidence.length >= minEvidence && bucket.sources.size >= minSources;
      return {
        schema: Object.hasOwn(DIRECTIONS, id) ? 'deskbot.fantasy-pull.v0.2' : 'deskbot.fantasy-pull.v0.3',
        direction_id: id,
        label: direction.label,
        life: direction.life,
        score: Math.round(bucket.score * 100) / 100,
        fantasy_pull: Math.min(1, Math.round((bucket.score / 6) * 100) / 100),
        evidence_ids: [...new Set(bucket.evidence.map((item) => item.evidence_id))],
        sources: [...bucket.sources],
        status: eligible && bucket.score >= minScore ? 'candidate' : 'observing',
        reason: eligible && bucket.score >= minScore ? '跨来源且达到最小证据量，可供角色提案层考虑。' : bucket.score < minScore ? '信号已衰减到低于保留线，继续观察即可。' : '证据或来源仍不足，只保持观察。',
      };
    })
    .filter((item) => item.evidence_ids.length > 0)
    .filter((item) => item.status === 'candidate' || item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.direction_id.localeCompare(b.direction_id))
    .slice(0, Math.max(1, maxCandidates));
}

export { DIRECTIONS };
