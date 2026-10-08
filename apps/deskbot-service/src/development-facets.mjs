import { ACTIVITIES } from './living-resources.mjs';

// These are views of the settled common ledger. They do not grant experience,
// change old interests, certify a profession, or establish a character wish.
export const DEVELOPMENT_FACETS_VERSION = 'deskbot.development-facets.v1';
const TOPICS = Object.freeze({ care: '照料', craft: '制作', repair: '修缮', cook: '做饭', explore: '观察小镇', connection: '与人相处' });
const REGISTERED = new Set(ACTIVITIES.map(activity => activity.activity_id));
const CONDITION_FAILURES = new Set(['resource', 'condition', 'route', 'coordination']);
const SOURCE_RANK = { canonical_task: 3, canonical_commitment: 3, resident_project: 2, legacy_memory_fact: 1 };
const CACHE_FORMAT = 'root_indexed_topics.v1';
const INTEREST_ROOT_FIELDS = ['active_roots', 'invited_roots', 'obligation_roots', 'unknown_roots', 'threshold_root_ids'];
const CAPABILITY_ROOT_FIELDS = ['success_roots', 'performance_failure_roots', 'condition_failure_roots', 'unknown_failure_roots', 'cancelled_roots', 'root_outcome_ids'];
const clean = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const unique = values => [...new Set(values.filter(Boolean))].sort();
const dateMs = value => Number.isFinite(Date.parse(value ?? '')) ? Date.parse(value) : null;
const people = w => [w?.protagonist, ...(w?.npcs ?? [])].filter(Boolean).map(person => ({
  actor_id: person.character_id ?? person.npc_id,
  display_name: clean(person.display_name) ?? clean(person.name) ?? person.character_id ?? person.npc_id,
})).filter(person => person.actor_id);
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const localDay = at => DAY_FORMAT.format(new Date(at));

// Explicit authored recipes, rather than a plan title or the model's prose,
// establish what was actually practised. Eating is not social competence.
export function activityTopic(activityId) {
  if (!REGISTERED.has(activityId) || activityId === 'share-meal') return null;
  if (activityId.startsWith('cook-') || activityId.startsWith('soup-')) return 'cook';
  if (activityId.startsWith('repair-') || activityId.startsWith('pump-') || activityId === 'stitch-canopy') return 'repair';
  if (activityId.startsWith('craft-')) return 'craft';
  if (activityId === 'scout-route') return 'explore';
  if (activityId.startsWith('seedbed-') || ['harvest-float-bed', 'sow-float-bed', 'water-bed', 'drain-bed', 'tend-bed', 'harvest-bed', 'sow-bed', 'gather-light-fruit', 'collect-water', 'save-seeds'].includes(activityId)) return 'care';
  return null;
}

function actualTopic(record) {
  if (record.source?.task_kind === 'travel' || record.source?.life_action === 'rest') return null;
  const topic = activityTopic(record.activity_id);
  if (topic && record.effect?.practice === true) return topic;
  // The server assigns an authored observation topic and keeps the actual action
  // marker. An arbitrary care task, historical story or message cannot qualify.
  if (!record.activity_id && record.source?.life_action === 'observe' && Object.hasOwn(TOPICS, record.topic)) return record.topic;
  return null;
}

function uniqueRecords(development, at) {
  const limit = dateMs(at), records = new Map();
  for (const record of development?.records ?? []) {
    const root = clean(record.root_outcome_id), settled = dateMs(record.at);
    if (!root || settled === null || (limit !== null && settled > limit) || !['completed', 'failed', 'cancelled'].includes(record.outcome)) continue;
    const prior = records.get(root);
    if (!prior || (SOURCE_RANK[record.source?.kind] ?? 0) > (SOURCE_RANK[prior.source?.kind] ?? 0)) records.set(root, record);
  }
  return [...records.values()].sort((a, b) => a.at.localeCompare(b.at) || a.root_outcome_id.localeCompare(b.root_outcome_id));
}

function motivation(record) {
  // An invitation cannot be relabelled independent by an old generic own flag.
  if (record.causes?.trigger === 'invited' || record.causes?.motivation?.kind === 'invited') return 'invited';
  const kind = record.causes?.motivation?.kind;
  return kind === 'self_continuation' || kind === 'need' ? kind : 'unknown';
}

function interestSummary(status) {
  return status === 'continuing' ? '已在至少三个上海日主动继续，并有不同活动或观察情境；这表示持续投入的规则证据。'
    : status === 'trying' ? '已跨两个上海日主动继续，仍需更多实际情境观察。'
      : status === 'initial' ? '已有一天的主动继续记录，还不足以判断稳定兴趣。'
        : '尚无可确认的主动继续记录；做成、受邀或满足需要都不能单独证明喜欢。';
}

function interestView(records) {
  const complete = records.filter(record => record.outcome === 'completed');
  const active = complete.filter(record => motivation(record) === 'self_continuation');
  const perDay = new Map(), threshold = [];
  for (const record of active) {
    const day = localDay(record.at), already = perDay.get(day) ?? 0;
    if (already >= 2) continue;
    perDay.set(day, already + 1); threshold.push(record);
  }
  const activeDays = unique(threshold.map(record => localDay(record.at)));
  const activeContexts = unique(threshold.filter(record => clean(record.location_id))
    .map(record => `${record.activity_id ?? 'observe'}:${record.location_id}`));
  const continuing = activeDays.length >= 3 && activeContexts.length >= 2;
  const status = continuing ? 'continuing' : activeDays.length >= 2 ? 'trying' : active.length ? 'initial' : 'unobserved';
  return {
    status, summary: interestSummary(status),
    active_roots: active.map(record => record.root_outcome_id),
    invited_roots: complete.filter(record => motivation(record) === 'invited').map(record => record.root_outcome_id),
    obligation_roots: complete.filter(record => motivation(record) === 'need').map(record => record.root_outcome_id),
    unknown_roots: complete.filter(record => motivation(record) === 'unknown').map(record => record.root_outcome_id),
    active_days: activeDays, active_contexts: activeContexts,
    threshold_root_ids: threshold.map(record => record.root_outcome_id), daily_limit: 2,
    bonus: continuing ? 6 : activeDays.length >= 2 ? 3 : 0,
  };
}

function capabilitySummary(status) {
  return status === 'repeated_in_context' ? '至少一种实际配方跨日重复做成；只说明这些既定情境里的执行记录，不代表职业资格或作品质量。'
    : status === 'practiced' ? '已有实际配方做成记录，尚不足以证明跨情境能力或作品质量。'
      : '尚无实际配方做成记录；计划、消息和观察不会形成技能证明。';
}

function capabilityView(records) {
  const practice = records.filter(record => record.effect?.practice === true && activityTopic(record.activity_id));
  const success = practice.filter(record => record.outcome === 'completed');
  const failed = practice.filter(record => record.outcome === 'failed' && record.failure?.classification !== 'cancelled');
  const performance = failed.filter(record => record.failure?.classification === 'performance');
  const condition = failed.filter(record => CONDITION_FAILURES.has(record.failure?.classification));
  const unknown = failed.filter(record => !CONDITION_FAILURES.has(record.failure?.classification) && record.failure?.classification !== 'performance');
  const cancelled = practice.filter(record => record.outcome === 'cancelled' || record.failure?.classification === 'cancelled');
  const activityIds = unique(practice.map(record => record.activity_id));
  const activities = activityIds.map(activityId => {
    const actual = practice.filter(record => record.activity_id === activityId);
    const done = actual.filter(record => record.outcome === 'completed');
    const days = unique(done.map(record => localDay(record.at)));
    return { activity_id: activityId, successes: done.length, failures: actual.filter(record => record.outcome === 'failed' && record.failure?.classification !== 'cancelled').length,
      cancellations: actual.filter(record => record.outcome === 'cancelled' || record.failure?.classification === 'cancelled').length,
      days, status: done.length >= 3 && days.length >= 2 ? 'repeated_in_context' : done.length ? 'practiced' : 'unobserved' };
  });
  const status = activities.some(activity => activity.status === 'repeated_in_context') ? 'repeated_in_context' : success.length ? 'practiced' : 'unobserved';
  return { status, summary: capabilitySummary(status), success_roots: success.map(record => record.root_outcome_id),
    performance_failure_roots: performance.map(record => record.root_outcome_id),
    condition_failure_roots: condition.map(record => record.root_outcome_id),
    unknown_failure_roots: unknown.map(record => record.root_outcome_id),
    cancelled_roots: cancelled.map(record => record.root_outcome_id), activities,
    root_outcome_ids: practice.map(record => record.root_outcome_id) };
}

function assessmentView(interest, capability) {
  const parts = [];
  if (capability.success_roots.length) parts.push(`实际做成过 ${capability.success_roots.length} 次已登记配方`);
  if (capability.condition_failure_roots.length) parts.push('有资源、环境、路线或协作条件导致的失败，这些不说明不会做');
  if (capability.performance_failure_roots.length) parts.push('有明确执行不足的失败，应在对应活动里继续练习');
  if (capability.unknown_failure_roots.length) parts.push('另有失败原因尚未判明，不能据此判断能力');
  if (capability.cancelled_roots.length) parts.push('取消的尝试不算做成，也不证明能力不足');
  if (interest.status === 'continuing') parts.push('有跨日主动继续的行为证据，尚不能确认想成为某种角色');
  else if (interest.status === 'trying' || interest.status === 'initial') parts.push('已经主动尝试，仍需观察兴趣是否持续');
  else parts.push('尚不知是否喜欢这个方向');
  const roots = unique([...capability.root_outcome_ids, ...interest.threshold_root_ids]);
  return { status: roots.length ? 'evidence_summary' : 'unobserved', summary: `${parts.join('；')}。`, basis: 'rules', root_outcome_ids: roots };
}

function contactView(development, actorId, topic, at) {
  const limit = dateMs(at), seen = new Map();
  for (const contact of development?.contacts ?? []) {
    const settled = dateMs(contact.at), id = clean(contact.source_record_id);
    if (contact.actor_id !== actorId || contact.topic !== topic || !id || settled === null || (limit !== null && settled > limit)) continue;
    // Admission/attestation is done by the server at receipt. Once admitted,
    // this is a historical contact, not a current external command or reward.
    if (!seen.has(id)) seen.set(id, contact);
  }
  return { count: seen.size, source_record_ids: [...seen.keys()].sort(), days: unique([...seen.values()].map(contact => localDay(contact.at))) };
}

function cacheMatches(development, registered, at) {
  const cache = development?.facets?.cache, limit = dateMs(at);
  return cache?.format === CACHE_FORMAT && limit !== null && cache.source_revision === (development.revision ?? 0)
    && cache.actor_signature === JSON.stringify(registered)
    && limit >= (dateMs(cache.max_settled_at) ?? 0)
    && (cache.next_future_at === null || (dateMs(cache.next_future_at) !== null && limit < dateMs(cache.next_future_at)));
}

function publicTopic(topic, interest, capability, contact) {
  return { topic, label: TOPICS[topic], contact, interest, capability,
    self_assessment: assessmentView(interest, capability),
    wish: { status: 'not_established', automatic: false, stable_interest: interest.status === 'continuing' } };
}

function packCacheActors(actors, development) {
  const rootIndex = new Map();
  for (const [index, record] of (development.records ?? []).entries()) if (!rootIndex.has(record.root_outcome_id)) rootIndex.set(record.root_outcome_id, index);
  const packed = [];
  for (const actor of actors) {
    const topics = [];
    for (const topic of actor.topics) {
      if (!topic.contact.count && !INTEREST_ROOT_FIELDS.some(key => topic.interest[key].length) && !topic.capability.root_outcome_ids.length) continue;
      const interest = { ...topic.interest }, capability = { ...topic.capability };
      delete interest.summary; delete capability.summary;
      for (const key of INTEREST_ROOT_FIELDS) interest[key] = interest[key].map(root => rootIndex.get(root));
      for (const key of CAPABILITY_ROOT_FIELDS) capability[key] = capability[key].map(root => rootIndex.get(root));
      topics.push({ topic: topic.topic, contact: topic.contact, interest, capability });
    }
    if (topics.length) packed.push({ actor_id: actor.actor_id, topics });
  }
  return packed;
}

function unpackCacheActors(cache, development, selected) {
  const cachedActors = new Map(cache.actors.map(actor => [actor.actor_id, actor]));
  const rootAt = index => development.records[index]?.root_outcome_id;
  return selected.map(actor => ({ ...actor, topics: Object.keys(TOPICS).map(topic => {
    const packed = cachedActors.get(actor.actor_id)?.topics.find(entry => entry.topic === topic);
    if (!packed) return publicTopic(topic, interestView([]), capabilityView([]), { count: 0, source_record_ids: [], days: [] });
    const { interest, capability, contact } = structuredClone(packed);
    for (const key of INTEREST_ROOT_FIELDS) interest[key] = interest[key].map(rootAt).filter(Boolean);
    for (const key of CAPABILITY_ROOT_FIELDS) capability[key] = capability[key].map(rootAt).filter(Boolean);
    interest.summary = interestSummary(interest.status); capability.summary = capabilitySummary(capability.status);
    return publicTopic(topic, interest, capability, contact);
  }) }));
}

function sourceTimeRange(development, at) {
  const limit = dateMs(at), times = [...(development.records ?? []), ...(development.contacts ?? [])]
    .map(record => dateMs(record.at)).filter(value => value !== null);
  const past = times.filter(value => value <= limit), future = times.filter(value => value > limit);
  return { max_settled_at: past.length ? new Date(Math.max(...past)).toISOString() : '1970-01-01T00:00:00.000Z',
    next_future_at: future.length ? new Date(Math.min(...future)).toISOString() : null };
}

export function developmentFacetsReadModel(w, { actorId = null, at = w?.clock?.synced_at } = {}) {
  const development = w?.memory?.development;
  const registered = people(w), selected = actorId ? registered.filter(person => person.actor_id === actorId) : registered;
  if (cacheMatches(development, registered, at)) {
    const cache = development.facets.cache;
    return { schema: DEVELOPMENT_FACETS_VERSION, enabled: true, installed_at: development.facets.installed_at,
      revision: development.facets.revision,
      actors: unpackCacheActors(cache, development, selected),
      coverage: structuredClone(cache.coverage) };
  }
  const records = uniqueRecords(development, at);
  const actors = selected.map(person => ({ ...person, topics: Object.keys(TOPICS).map(topic => {
    const actual = records.filter(record => record.actor_ids?.includes(person.actor_id) && actualTopic(record) === topic);
    const interest = interestView(actual), capability = capabilityView(actual);
    return publicTopic(topic, interest, capability, contactView(development, person.actor_id, topic, at));
  }) }));
  return { schema: DEVELOPMENT_FACETS_VERSION, enabled: Boolean(development),
    installed_at: development?.facets?.installed_at ?? null, revision: development?.facets?.revision ?? 0, actors,
    coverage: { scope: 'retained_unique_root_outcomes', source_revision: development?.revision ?? 0,
      roots: records.length, registered_actors: registered.length,
      practice_roots: records.filter(record => record.effect?.practice === true && activityTopic(record.activity_id)).length,
      unknown_motivation_roots: records.filter(record => actualTopic(record) && motivation(record) === 'unknown').length,
      counts_are_lifetime_totals: false, historical_motivation_backfilled: false,
      interest_daily_limit: 2, interest_bonus_limit: 6,
      limitations: ['保留的共同结果根可形成多种读模，每个侧面只计一次。', '完成配方不等于喜欢，条件失败不等于能力不足。', '这些是规则证据摘要，不是模型内心、技能质量或角色解锁。'] } };
}

export function syncDevelopmentFacets(w, at) {
  const development = w?.memory?.development;
  if (!development || dateMs(at) === null) return { enabled: false, changed: false };
  const installed = !development.facets;
  development.facets ??= { schema: DEVELOPMENT_FACETS_VERSION, installed_at: at, revision: 0, cache: null };
  const facets = development.facets, actorSignature = JSON.stringify(people(w));
  // Source mutations increment the common ledger revision. Advancing the clock
  // without a new settled result must not create writes on every world tick.
  if (!installed && cacheMatches(development, people(w), at)) {
    return { enabled: true, installed: false, changed: false, revision: facets.revision };
  }
  const view = developmentFacetsReadModel(w, { at });
  facets.cache = { format: CACHE_FORMAT, source_revision: development.revision ?? 0, actor_signature: actorSignature,
    ...sourceTimeRange(development, at), actors: packCacheActors(view.actors, development), coverage: view.coverage };
  facets.revision += 1;
  return { enabled: true, installed, changed: true, revision: facets.revision };
}
