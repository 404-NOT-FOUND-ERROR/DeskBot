const DIRECTIONS = Object.freeze({
  wetland_frog: Object.freeze({ label: '荷叶青蛙', life: '潮湿、有弹性、会蹲在荷叶上的生活', cues: ['雨', '池塘', '湿地', '荷叶', '青蛙', '散步'] }),
  starry_observer: Object.freeze({ label: '星空观察者', life: '在夜空和远方之间寻找线索的生活', cues: ['星空', '星星', '夜空', '月亮', '观测', '宇宙'] }),
  workshop_maker: Object.freeze({ label: '工坊学徒', life: '拆解、修理和亲手构造东西的生活', cues: ['齿轮', '机械', '工坊', '修理', '制作', '拆解'] }),
  dream_cloud: Object.freeze({ label: '云朵梦境生物', life: '轻盈、跳跃、把联想变成道路的生活', cues: ['梦', '云', '幻想', '童话', '漂浮', '想象'] }),
});

function textOf(event) {
  return [event.payload?.text, event.payload?.summary, event.payload?.title, event.payload?.event?.summary, event.payload?.event?.title]
    .filter((value) => typeof value === 'string').join(' ');
}

function sourceOf(event) {
  return event.layer ?? (event.type?.startsWith('world.') ? 'world_line' : event.source ?? 'unknown');
}

export function computeFantasyPull(events = [], { minSources = 2, minEvidence = 3, minScore = 0.25, maxCandidates = 3, now = new Date() } = {}) {
  const scores = new Map(Object.keys(DIRECTIONS).map((id) => [id, { score: 0, evidence: [], sources: new Set() }]));
  const seen = new Set();
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (!event.event_id || seen.has(event.event_id)) continue;
    seen.add(event.event_id);
    const text = textOf(event);
    if (!text) continue;
    const source = sourceOf(event);
    for (const [id, direction] of Object.entries(DIRECTIONS)) {
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
      const direction = DIRECTIONS[id];
      const eligible = bucket.evidence.length >= minEvidence && bucket.sources.size >= minSources;
      return {
        schema: 'deskbot.fantasy-pull.v0.1',
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
    .slice(0, Math.max(1, maxCandidates))
    .sort((a, b) => b.score - a.score || a.direction_id.localeCompare(b.direction_id));
}

export { DIRECTIONS };
