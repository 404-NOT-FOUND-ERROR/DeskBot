import { canonicalCharacterId, characterIdsEqual } from './world-definition.mjs';

const DEFAULT_RULES = Object.freeze([
  {
    id: 'world.time.late_night',
    version: 'world-rules.v0.2',
    source: 'deskbot-world-rules',
    label: 'late-night',
    priority: 0.8,
    ttl_ms: 8 * 60 * 60 * 1000,
    match_reason: 'time is between 22:00 and 05:59, or the dialogue explicitly mentions late night',
    context: '现在是深夜，角色应降低节奏，避免制造压力，保持安静而陪伴的语气。',
    matches(event) {
      if (event.type === 'world.time') {
        const hour = Number(event.payload?.local_hour ?? event.payload?.hour);
        return Number.isInteger(hour) && (hour >= 22 || hour < 6);
      }
      const text = event.payload?.text ?? '';
      return /深夜|夜里|凌晨|很晚/.test(text);
    },
  },
  {
    id: 'world.topic.workshop',
    version: 'world-rules.v0.2',
    source: 'deskbot-world-rules',
    label: 'workshop-context',
    priority: 0.5,
    ttl_ms: 30 * 60 * 1000,
    match_reason: 'dialogue contains making, assembly, mechanical, or shell-design terms',
    context: '对话涉及制作、装配或外壳，角色可以使用具体、可执行的构造语言。',
    matches(event) {
      const text = event.payload?.text ?? '';
      return /外壳|打印|装配|设计|机械|制作|模型|接口/.test(text);
    },
  },
  {
    id: 'world.weather.rain',
    version: 'world-rules.v0.2',
    source: 'deskbot-world-rules',
    label: 'rainy-weather',
    priority: 0.4,
    ttl_ms: 3 * 60 * 60 * 1000,
    match_reason: 'weather event reports rain',
    context: '外部天气为雨，角色可以承认环境的安静感，但不能把天气当作用户情绪的确定证据。',
    matches(event) {
      return event.type === 'world.weather' && (event.payload?.weather === 'rain' || event.payload?.condition === 'rain');
    },
  },
]);

function keyFor(characterId, ruleId) {
  return `${canonicalCharacterId(characterId) ?? 'global'}:${ruleId}`;
}

export function createWorldContext({ now = () => new Date(), rules = DEFAULT_RULES, persistence = null } = {}) {
  const active = new Map(
    (persistence?.list('world.active') ?? []).map((condition) => [
      keyFor(condition.character_id, condition.rule_id),
      condition,
    ]),
  );
  const matchLog = persistence?.list('world.matches') ?? [];

  function isActive(condition) {
    return condition.expires_at === null || Date.parse(condition.expires_at) > now().getTime();
  }

  function observe(event) {
    if (event.type === 'conversation.reply'
      || event.type === 'voice.asr.partial'
      || event.type === 'voice.asr.final'
      || event.type === 'voice.partial'
      || event.type === 'voice.final'
      || event.type === 'conversation.input.partial'
      || event.type === 'conversation.input.final'
      || event.payload?.stage === 'partial'
      || event.payload?.stage === 'final') {
      return [];
    }
    const characterId = canonicalCharacterId(event.character_id) ?? 'global';
    const matched = [];

    for (const rule of rules) {
      if (!rule.matches(event)) continue;

      const matchedAt = now();
      const ttlMs = Number.isFinite(rule.ttl_ms) && rule.ttl_ms > 0 ? rule.ttl_ms : null;
      const condition = {
        id: rule.id,
        rule_id: rule.id,
        rule_version: rule.version ?? 'world-rules.unversioned',
        rule_source: rule.source ?? 'unknown',
        label: rule.label,
        priority: rule.priority,
        context: rule.context,
        character_id: characterId,
        matched_by: event.event_id,
        observed_at: event.occurred_at ?? now().toISOString(),
        matched_at: matchedAt.toISOString(),
        expires_at: ttlMs === null ? null : new Date(matchedAt.getTime() + ttlMs).toISOString(),
        match_reason: rule.match_reason ?? null,
        trigger: {
          event_id: event.event_id,
          event_type: event.type,
          event_source: event.source,
        },
      };
      const activeKey = keyFor(characterId, rule.id);
      const matchKey = `${event.event_id}:${rule.id}:${characterId}`;
      active.set(activeKey, condition);
      matchLog.push(condition);
      persistence?.put('world.active', activeKey, condition);
      persistence?.put('world.matches', matchKey, condition);
      matched.push(condition);
    }

    return matched;
  }

  function list(characterId) {
    for (const [key, condition] of active.entries()) {
      if (!isActive(condition)) {
        active.delete(key);
        persistence?.remove('world.active', key);
      }
    }

    return [...active.values()]
      .filter((condition) => condition.character_id === 'global' || characterIdsEqual(condition.character_id, characterId))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  function matches({ characterId, limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return matchLog
      .filter((condition) => !characterId || condition.character_id === 'global' || characterIdsEqual(condition.character_id, characterId))
      .slice(-boundedLimit);
  }

  return {
    active: list,
    matches,
    observe,
    rules: () => rules.map(({ matches: matcher, ...rule }) => ({ ...rule })),
  };
}

export { DEFAULT_RULES };
