import { canonicalCharacterId } from './world-definition.mjs';

const POLICY_VERSION = 'interaction-policy.v0.1';
const DEFAULT_PROACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONSIDERED_COOLDOWN_MS = 2 * 60 * 60 * 1000;

const ROUTES = Object.freeze({
  RECORD_ONLY: 'record_only',
  REPLY_CONTEXT: 'reply_context',
  PROACTIVE_CANDIDATE: 'proactive_candidate',
  SUPPRESS: 'suppress',
});

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value);
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function characterKey(characterId) {
  return canonicalCharacterId(characterId) ?? 'unbound';
}

function layerOf(event) {
  if (event.layer) return event.layer;
  if (event.type === 'world.mutation') {
    const action = event.payload?.action;
    if (action === 'record_external_context') return 'external_context';
    if (action === 'update_weather') return 'weather';
    if (action === 'advance_calendar' || action === 'advance_time') return 'calendar';
    if (action === 'observe_user_preference') return 'user_profile';
    if (action === 'record_device_context') return 'device_context';
    return 'world_line';
  }
  return 'unclassified';
}

function candidateForWorldLine(event, worldSnapshot) {
  const item = event.payload?.event ?? worldSnapshot?.world_line?.latest_event ?? null;
  if (!item || typeof item !== 'object') return null;
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  if (!title && !summary) return null;
  return {
    topic: 'world_line_event',
    title: title || null,
    summary: summary || null,
    daily_consequence: item.daily_consequence ?? null,
    opportunity: item.opportunity ?? null,
    unresolved_hook: item.unresolved_hook ?? null,
    instruction: '仅在当前话题自然相关时，把它当作喵呜今天正在经历的生活情境；不要像系统通知一样播报。',
  };
}

function candidateForExternal(event) {
  const item = event.payload?.item ?? null;
  if (!item || typeof item !== 'object') return null;
  const provider = item.provider ?? event.provider ?? null;
  const title = typeof item.title === 'string' ? item.title.trim() : '';
  const summary = typeof item.summary === 'string' ? item.summary.trim() : '';
  if (!provider || (!title && !summary)) return null;
  return {
    topic: 'external_context',
    provider,
    title: title || null,
    summary: summary || null,
    instruction: '只有与用户当前话题或角色经历有自然关联时才提起；不能把来源字段直接念出来。',
  };
}

function candidateForWeather(event) {
  const snapshot = event.payload?.snapshot ?? null;
  if (!snapshot || typeof snapshot !== 'object') return null;
  const condition = typeof snapshot.condition === 'string' ? snapshot.condition.trim().toLowerCase() : '';
  const notable = /rain|storm|snow|typhoon|heat|cold|雷|暴|雨|雪|高温|低温/.test(condition);
  if (!notable) return null;
  return {
    topic: 'weather',
    location: snapshot.location ?? null,
    condition: snapshot.condition ?? null,
    temperature_c: snapshot.temperature_c ?? null,
    instruction: '把天气当作环境背景；只有在问候、出门、工作安排或用户主动谈及环境时自然带出。',
  };
}

function stablePreference(worldSnapshot, event) {
  const key = event.payload?.preference_key ?? event.payload?.key;
  if (typeof key !== 'string' || !key.trim()) return null;
  return worldSnapshot?.user_profile?.preferences?.[key.trim()] ?? null;
}

function buildDecision({ event, worldSnapshot, worldConditions, now, proactiveTtlMs }) {
  const characterId = characterKey(event.character_id);
  const layer = layerOf(event);
  const occurredAt = event.occurred_at ?? event.observed_at ?? now().toISOString();
  const base = {
    schema: 'foundry.interaction-decision.v0.1',
    policy_version: POLICY_VERSION,
    decision_id: `decision-${event.event_id}`,
    event_id: event.event_id,
    character_id: characterId,
    event_type: event.type,
    source: event.source ?? null,
    layer,
    occurred_at: occurredAt,
    decided_at: now().toISOString(),
    route: ROUTES.RECORD_ONLY,
    priority: 0,
    reason: '记录事件，但不改变当前角色表达。',
    audience: 'none',
    candidate: null,
    expires_at: null,
    considered_at: null,
  };

  if (event.type === 'conversation.input') {
    return {
      ...base,
      route: ROUTES.REPLY_CONTEXT,
      priority: 1,
      reason: '用户当前请求必须进入本轮回复上下文。',
      audience: 'current_reply',
    };
  }

  if (event.type === 'conversation.reply'
    || event.payload?.role === 'assistant'
    || event.type.startsWith('voice.')
    || event.type.startsWith('transport.')) {
    return {
      ...base,
      route: ROUTES.SUPPRESS,
      reason: '服务输出或传输阶段只作审计观察，不能再次驱动角色行为。',
      audience: 'none',
    };
  }

  if (event.type !== 'world.mutation') {
    return base;
  }

  const action = event.payload?.action;
  if (layer === 'world_line' || action === 'apply_world_line_event') {
    const candidate = candidateForWorldLine(event, worldSnapshot);
    if (!candidate) return { ...base, reason: '世界线事件缺少可供自然提及的标题或摘要，先只记录。' };
    return {
      ...base,
      route: ROUTES.PROACTIVE_CANDIDATE,
      priority: 0.7,
      reason: '世界线事件可能成为角色主动交流的话题，但不自动打断用户。',
      audience: 'proactive_queue',
      candidate,
      expires_at: new Date(now().getTime() + proactiveTtlMs).toISOString(),
    };
  }

  if (layer === 'external_context' || action === 'record_external_context') {
    const candidate = event.provider || event.provenance ? candidateForExternal(event) : null;
    if (!candidate) return { ...base, reason: '外部事实缺少 provider/provenance 或摘要，不能进入角色表达。' };
    return {
      ...base,
      route: ROUTES.PROACTIVE_CANDIDATE,
      priority: 0.55,
      reason: '有可追溯来源的外部事件可在相关话题中自然提起，但不直接播报。',
      audience: 'proactive_queue',
      candidate,
      expires_at: new Date(now().getTime() + proactiveTtlMs).toISOString(),
    };
  }

  if (layer === 'weather' || action === 'update_weather') {
    const candidate = candidateForWeather(event);
    if (!candidate) return { ...base, reason: '普通天气变化只作为环境记录，不主动打扰。' };
    return {
      ...base,
      route: ROUTES.PROACTIVE_CANDIDATE,
      priority: 0.4,
      reason: '显著天气是可选的环境话题，只有在语境相关时才自然带出。',
      audience: 'proactive_queue',
      candidate,
      expires_at: new Date(now().getTime() + proactiveTtlMs).toISOString(),
    };
  }

  if (layer === 'user_profile' || action === 'observe_user_preference') {
    const preference = stablePreference(worldSnapshot, event);
    if (preference?.stable === true) {
      return {
        ...base,
        route: ROUTES.REPLY_CONTEXT,
        priority: 0.35,
        reason: '该用户偏好已达到稳定观察门槛，可在相关任务中作为软约束使用。',
        audience: 'current_reply',
      };
    }
    return { ...base, reason: '用户偏好仍是待确认线索，不能升级为角色对用户的确定判断。' };
  }

  if (layer === 'device_context' || action === 'record_device_context') {
    return { ...base, reason: '设备状态只说明当前在场或运行情况，不直接推断用户人格。' };
  }

  if (layer === 'calendar' || action === 'advance_calendar' || action === 'advance_time') {
    return { ...base, reason: '叙事日历影响世界顺序，但不主动替代现实问答。' };
  }

  return base;
}

export function createInteractionPolicy({
  now = () => new Date(),
  persistence = null,
  proactiveTtlMs = DEFAULT_PROACTIVE_TTL_MS,
  consideredCooldownMs = DEFAULT_CONSIDERED_COOLDOWN_MS,
} = {}) {
  const decisions = new Map(
    (persistence?.list('interaction.decisions') ?? []).map((decision) => [decision.event_id, decision]),
  );

  function save(decision) {
    decisions.set(decision.event_id, decision);
    persistence?.put('interaction.decisions', decision.event_id, decision);
    return decision;
  }

  function evaluate({ event, worldSnapshot = null, worldConditions = [], runtimeContext = null } = {}) {
    if (!event || typeof event !== 'object' || typeof event.event_id !== 'string') {
      throw new TypeError('event with event_id is required');
    }
    const existing = decisions.get(event.event_id);
    if (existing) return clone(existing);
    // Keep these inputs explicit in the function contract. The first policy
    // version uses the canonical snapshot and event provenance, while later
    // versions can use conditions and source freshness without changing the
    // caller boundary.
    void worldConditions;
    void runtimeContext;
    return clone(save(buildDecision({
      event,
      worldSnapshot,
      worldConditions,
      now,
      proactiveTtlMs,
    })));
  }

  function forPrompt({ characterId, excludeEventId = null } = {}) {
    const current = now();
    const canonicalId = characterKey(characterId);
    const selected = [];
    for (const decision of decisions.values()) {
      if (decision.event_id === excludeEventId) continue;
      if (characterKey(decision.character_id) !== canonicalId) continue;
      if (decision.route !== ROUTES.PROACTIVE_CANDIDATE || !decision.candidate) continue;
      if (decision.expires_at && Date.parse(decision.expires_at) <= current.getTime()) continue;
      if (decision.considered_at && Date.parse(decision.considered_at) + consideredCooldownMs > current.getTime()) continue;
      const updated = { ...decision, considered_at: current.toISOString() };
      save(updated);
      selected.push(clone(updated));
    }
    return selected.sort((a, b) => b.priority - a.priority || a.decided_at.localeCompare(b.decided_at));
  }

  function list({ characterId = null, route = null, limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return [...decisions.values()]
      .filter((decision) => !characterId || characterKey(decision.character_id) === characterKey(characterId))
      .filter((decision) => !route || decision.route === route)
      .slice(-boundedLimit)
      .map(clone);
  }

  function get(eventId) {
    return clone(decisions.get(eventId) ?? null);
  }

  return {
    evaluate,
    forPrompt,
    get,
    list,
    policyVersion: POLICY_VERSION,
  };
}

export { DEFAULT_CONSIDERED_COOLDOWN_MS, DEFAULT_PROACTIVE_TTL_MS, POLICY_VERSION, ROUTES };
