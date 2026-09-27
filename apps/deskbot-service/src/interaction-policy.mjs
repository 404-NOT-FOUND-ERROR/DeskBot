import { canonicalCharacterId } from './world-definition.mjs';

const POLICY_VERSION = 'interaction-policy.v0.2';
const DEFAULT_PROACTIVE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_CONSIDERED_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const DEFAULT_DEFERRED_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PROACTIVE_PER_PROMPT = 2;
const DEFAULT_MAX_IGNORED_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const ROUTES = Object.freeze({
  RECORD_ONLY: 'record_only',
  REPLY_CONTEXT: 'reply_context',
  PROACTIVE_CANDIDATE: 'proactive_candidate',
  SUPPRESS: 'suppress',
});

const PROACTIVE_STATES = Object.freeze({
  QUEUED: 'queued',
  CONSIDERED: 'considered',
  DEFERRED: 'deferred',
  DISMISSED: 'dismissed',
  CONSUMED: 'consumed',
  EXPIRED: 'expired',
});

const PROACTIVE_ACTIONS = Object.freeze({
  IGNORE: 'ignore',
  DEFER: 'defer',
  DISMISS: 'dismiss',
  CONSUME: 'consume',
  REOPEN: 'reopen',
});

class InteractionPolicyError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'InteractionPolicyError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

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

function normalizeDecision(decision) {
  if (!decision || typeof decision !== 'object') return decision;
  const isCandidate = decision.route === ROUTES.PROACTIVE_CANDIDATE && decision.candidate;
  if (!isCandidate) return decision;
  return {
    ...decision,
    // These two values are audit inputs for proactive ranking. They are kept
    // separate from priority so a caller can distinguish "worth mentioning"
    // from "safe to interrupt with" without changing world state.
    relevance: Number.isFinite(decision.relevance)
      ? Math.min(1, Math.max(0, Number(decision.relevance)))
      : null,
    interrupt_cost: Number.isFinite(decision.interrupt_cost)
      ? Math.min(1, Math.max(0, Number(decision.interrupt_cost)))
      : null,
    proactive_status: decision.proactive_status ?? PROACTIVE_STATES.QUEUED,
    surfaced_count: Number.isInteger(decision.surfaced_count) ? decision.surfaced_count : 0,
    ignored_count: Number.isInteger(decision.ignored_count) ? decision.ignored_count : 0,
    deferred_count: Number.isInteger(decision.deferred_count) ? decision.deferred_count : 0,
    considered_at: decision.considered_at ?? null,
    last_surfaced_at: decision.last_surfaced_at ?? null,
    last_ignored_at: decision.last_ignored_at ?? null,
    last_deferred_at: decision.last_deferred_at ?? null,
    considered_until: decision.considered_until ?? null,
    deferred_until: decision.deferred_until ?? null,
    dismissed_at: decision.dismissed_at ?? null,
    consumed_at: decision.consumed_at ?? null,
    ignored_cooldown_ms: Number.isFinite(decision.ignored_cooldown_ms) ? decision.ignored_cooldown_ms : null,
  };
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
    relevance: null,
    interrupt_cost: null,
    proactive_status: null,
    surfaced_count: 0,
    ignored_count: 0,
    deferred_count: 0,
    expires_at: null,
    considered_at: null,
    last_surfaced_at: null,
    last_ignored_at: null,
    last_deferred_at: null,
    considered_until: null,
    deferred_until: null,
    dismissed_at: null,
    consumed_at: null,
    ignored_cooldown_ms: null,
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
      relevance: 0.82,
      interrupt_cost: 0.48,
      proactive_status: PROACTIVE_STATES.QUEUED,
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
      relevance: 0.62,
      interrupt_cost: 0.68,
      proactive_status: PROACTIVE_STATES.QUEUED,
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
      relevance: 0.46,
      interrupt_cost: 0.28,
      proactive_status: PROACTIVE_STATES.QUEUED,
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
  deferredMs = DEFAULT_DEFERRED_MS,
  maxProactivePerPrompt = DEFAULT_MAX_PROACTIVE_PER_PROMPT,
  maxIgnoredCooldownMs = DEFAULT_MAX_IGNORED_COOLDOWN_MS,
} = {}) {
  const decisions = new Map(
    (persistence?.list('interaction.decisions') ?? []).map((decision) => [decision.event_id, normalizeDecision(decision)]),
  );
  const settings = new Map(
    (persistence?.list('interaction.settings') ?? []).map((item) => [characterKey(item.character_id), item]),
  );

  function save(decision) {
    const normalized = normalizeDecision(decision);
    decisions.set(normalized.event_id, normalized);
    persistence?.put('interaction.decisions', normalized.event_id, normalized);
    return normalized;
  }

  function defaultSettings(characterId) {
    return {
      schema: 'foundry.interaction-settings.v0.1',
      character_id: characterKey(characterId),
      proactive_enabled: true,
      quiet_until: null,
      updated_at: now().toISOString(),
    };
  }

  function getSettings(characterId = null) {
    const key = characterKey(characterId);
    return clone(settings.get(key) ?? defaultSettings(key));
  }

  function setSettings({ characterId = null, proactiveEnabled, quietUntil } = {}) {
    const key = characterKey(characterId);
    const current = settings.get(key) ?? defaultSettings(key);
    const next = {
      ...current,
      character_id: key,
      ...(proactiveEnabled === undefined ? {} : { proactive_enabled: proactiveEnabled === true }),
      ...(quietUntil === undefined ? {} : { quiet_until: quietUntil }),
      updated_at: now().toISOString(),
    };
    if (next.quiet_until !== null && (typeof next.quiet_until !== 'string' || Number.isNaN(Date.parse(next.quiet_until)))) {
      throw new InteractionPolicyError(400, 'invalid_quiet_until', 'quiet_until must be an ISO timestamp or null');
    }
    settings.set(key, next);
    persistence?.put('interaction.settings', key, next);
    return clone(next);
  }

  function updateSettings(input = {}) {
    return setSettings(input);
  }

  function quietReason(characterId) {
    const current = getSettings(characterId);
    if (current.proactive_enabled !== true) return '角色主动性已关闭。';
    if (current.quiet_until && Date.parse(current.quiet_until) > now().getTime()) return `安静窗口持续到 ${current.quiet_until}。`;
    return null;
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
    if (quietReason(canonicalId)) return [];
    const eligible = [];
    for (const decision of decisions.values()) {
      if (decision.event_id === excludeEventId) continue;
      if (characterKey(decision.character_id) !== canonicalId) continue;
      if (decision.route !== ROUTES.PROACTIVE_CANDIDATE || !decision.candidate) continue;
      if (decision.proactive_status === PROACTIVE_STATES.DISMISSED || decision.proactive_status === PROACTIVE_STATES.CONSUMED) continue;
      // A deferred candidate owns a later review window. Do not discard it at
      // the original short-lived queue TTL while the user explicitly asked
      // us to wait.
      if (decision.proactive_status !== PROACTIVE_STATES.DEFERRED
        && decision.expires_at && Date.parse(decision.expires_at) <= current.getTime()) {
        if (decision.proactive_status !== PROACTIVE_STATES.EXPIRED) save({ ...decision, proactive_status: PROACTIVE_STATES.EXPIRED });
        continue;
      }
      if (decision.proactive_status === PROACTIVE_STATES.DEFERRED
        && decision.deferred_until && Date.parse(decision.deferred_until) > current.getTime()) continue;
      const consideredUntil = decision.considered_until
        ? Date.parse(decision.considered_until)
        : decision.considered_at ? Date.parse(decision.considered_at) + consideredCooldownMs : 0;
      if (consideredUntil > current.getTime()) continue;
      eligible.push(decision);
    }
    return eligible
      .sort((a, b) => b.priority - a.priority || a.decided_at.localeCompare(b.decided_at))
      .slice(0, Math.max(1, Number.parseInt(maxProactivePerPrompt, 10) || DEFAULT_MAX_PROACTIVE_PER_PROMPT))
      .map((decision) => {
        const updated = {
          ...decision,
          proactive_status: PROACTIVE_STATES.CONSIDERED,
          considered_at: current.toISOString(),
          considered_until: new Date(current.getTime() + consideredCooldownMs).toISOString(),
          last_surfaced_at: current.toISOString(),
          surfaced_count: (decision.surfaced_count ?? 0) + 1,
          deferred_until: null,
        };
        return clone(save(updated));
      });
  }

  function act(eventId, { characterId = null, action, deferredUntil = null, reason = null } = {}) {
    const decision = decisions.get(eventId);
    if (!decision) throw new InteractionPolicyError(404, 'interaction_decision_not_found', 'interaction decision not found');
    if (characterId !== null && characterKey(decision.character_id) !== characterKey(characterId)) {
      throw new InteractionPolicyError(409, 'interaction_decision_character_mismatch', 'interaction decision belongs to another character');
    }
    if (decision.route !== ROUTES.PROACTIVE_CANDIDATE || !decision.candidate) {
      throw new InteractionPolicyError(409, 'interaction_decision_not_actionable', 'only proactive candidates can be managed');
    }
    if (!Object.values(PROACTIVE_ACTIONS).includes(action)) {
      throw new InteractionPolicyError(400, 'invalid_interaction_action', `unsupported interaction action: ${action}`);
    }
    const timestamp = now().toISOString();
    let next = { ...decision };
    if (action === PROACTIVE_ACTIONS.IGNORE) {
      const ignoredCount = (next.ignored_count ?? 0) + 1;
      const backoff = Math.min(
        Math.max(consideredCooldownMs, 1) * (2 ** Math.max(0, ignoredCount - 1)),
        Math.max(maxIgnoredCooldownMs, consideredCooldownMs),
      );
      next = { ...next, proactive_status: PROACTIVE_STATES.CONSIDERED, ignored_count: ignoredCount, ignored_cooldown_ms: backoff, last_ignored_at: timestamp, considered_at: timestamp, considered_until: new Date(now().getTime() + backoff).toISOString() };
    } else if (action === PROACTIVE_ACTIONS.DEFER) {
      const target = deferredUntil === null ? new Date(now().getTime() + deferredMs).toISOString() : deferredUntil;
      if (typeof target !== 'string' || Number.isNaN(Date.parse(target))) throw new InteractionPolicyError(400, 'invalid_deferred_until', 'deferred_until must be an ISO timestamp');
      const targetMs = Date.parse(target);
      const existingExpiryMs = next.expires_at ? Date.parse(next.expires_at) : 0;
      // Keep a deferred item available through its requested review time, with
      // a small queue window afterwards for the next prompt.
      const deferredExpiry = new Date(targetMs + proactiveTtlMs).toISOString();
      next = {
        ...next,
        proactive_status: PROACTIVE_STATES.DEFERRED,
        deferred_count: (next.deferred_count ?? 0) + 1,
        last_deferred_at: timestamp,
        deferred_until: target,
        considered_at: timestamp,
        expires_at: existingExpiryMs > targetMs ? next.expires_at : deferredExpiry,
      };
    } else if (action === PROACTIVE_ACTIONS.DISMISS) {
      next = { ...next, proactive_status: PROACTIVE_STATES.DISMISSED, dismissed_at: timestamp, dismiss_reason: reason };
    } else if (action === PROACTIVE_ACTIONS.CONSUME) {
      next = { ...next, proactive_status: PROACTIVE_STATES.CONSUMED, consumed_at: timestamp, consume_reason: reason };
    } else if (action === PROACTIVE_ACTIONS.REOPEN) {
      next = { ...next, proactive_status: PROACTIVE_STATES.QUEUED, dismissed_at: null, consumed_at: null, deferred_until: null, considered_at: null, considered_until: null };
    }
    return clone(save(next));
  }

  function resolveCandidate(eventId, input = {}) {
    return act(eventId, input);
  }

  function list({ characterId = null, route = null, status = null, limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    return [...decisions.values()]
      .filter((decision) => !characterId || characterKey(decision.character_id) === characterKey(characterId))
      .filter((decision) => !route || decision.route === route)
      .filter((decision) => !status || decision.proactive_status === status)
      .slice(-boundedLimit)
      .map(clone);
  }

  function get(eventId) {
    return clone(decisions.get(eventId) ?? null);
  }

  function listCandidates({ characterId = null, status = null, route = ROUTES.PROACTIVE_CANDIDATE, limit = 50 } = {}) {
    const current = now().getTime();
    // GET is also a lifecycle observation point, so stale queued/considered
    // candidates become explicitly expired even when no chat turn occurs.
    for (const decision of decisions.values()) {
      if (decision.route !== ROUTES.PROACTIVE_CANDIDATE || !decision.candidate) continue;
      if (decision.proactive_status === PROACTIVE_STATES.DEFERRED) continue;
      if (decision.expires_at && Date.parse(decision.expires_at) <= current
        && decision.proactive_status !== PROACTIVE_STATES.EXPIRED
        && decision.proactive_status !== PROACTIVE_STATES.DISMISSED
        && decision.proactive_status !== PROACTIVE_STATES.CONSUMED) {
        save({ ...decision, proactive_status: PROACTIVE_STATES.EXPIRED });
      }
    }
    return list({
      characterId,
      route,
      status,
      limit,
    });
  }

  return {
    evaluate,
    act,
    forPrompt,
    getSettings,
    get,
    list,
    listCandidates,
    quietReason,
    resolveCandidate,
    setSettings,
    updateSettings,
    policyVersion: POLICY_VERSION,
  };
}

export {
  DEFAULT_CONSIDERED_COOLDOWN_MS,
  DEFAULT_DEFERRED_MS,
  DEFAULT_MAX_PROACTIVE_PER_PROMPT,
  DEFAULT_MAX_IGNORED_COOLDOWN_MS,
  DEFAULT_PROACTIVE_TTL_MS,
  InteractionPolicyError,
  POLICY_VERSION,
  PROACTIVE_ACTIONS,
  PROACTIVE_STATES,
  ROUTES,
};
