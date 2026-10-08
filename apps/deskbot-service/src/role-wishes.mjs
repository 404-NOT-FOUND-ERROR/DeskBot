import { createHash } from 'node:crypto';
import { activityTopic, DEVELOPMENT_FACETS_VERSION } from './development-facets.mjs';
import { ACTIVITIES, livingReadModel } from './living-resources.mjs';
import { findWorldPath } from './world-map-content.mjs';

export const ROLE_WISH_SCHEMA = 'deskbot.role-wishes.v1';
const DAY = 86_400_000, WINDOW_DAYS = 14, MAX_ROOT_REFS = 32;
const RECIPES = new Map(ACTIVITIES.map(recipe => [recipe.activity_id, recipe]));
const COOKING = ['cook-moss', 'cook-grove-stew', 'soup-cook-trial', 'soup-confirm-recipe', 'cook-leaf-soup'];
const SOURCE_RANK = { canonical_task: 3, canonical_commitment: 3, resident_project: 2, legacy_memory_fact: 1 };
const CONDITION_FAILURES = new Set(['resource', 'condition', 'route', 'coordination']);
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const clean = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const unique = values => [...new Set(values.filter(Boolean))].sort();
const milliseconds = value => Number.isFinite(Date.parse(value ?? '')) ? Date.parse(value) : null;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const localDay = at => DAY_FORMAT.format(new Date(at));
const context = record => `${record.activity_id ?? 'observe'}:${record.location_id}`;

// These authored correspondences connect the existing common ledger to a
// possible form or vocation. They are prerequisites to proposing a wish, never
// a skill level, role certificate, transformation, or separate reward account.
export const ROLE_WISH_DIRECTIONS = Object.freeze([
  Object.freeze({ direction_id: 'wetland_frog', label: '荷叶青蛙', axis: 'form', topics: ['care', 'explore'],
    locations: ['moss-sprout-garden', 'echo-waterside'], practice_topics: ['care'], minimum_practice: 2,
    reason_theme: '苗圃和水岸', wish_text: '试试荷叶青蛙的形态' }),
  Object.freeze({ direction_id: 'workshop_maker', label: '工坊学徒', axis: 'vocation', topics: ['craft', 'repair'],
    locations: ['spare-parts-house', 'echo-waterside', 'moss-sprout-garden', 'whisper-market', 'warm-pot-courtyard'],
    practice_topics: ['craft', 'repair'], minimum_practice: 2, reason_theme: '制作与修缮', wish_text: '当一段时间的工坊学徒' }),
  Object.freeze({ direction_id: 'starry_observer', label: '星空观察者', axis: 'form', topics: [], locations: [], practice_topics: [], minimum_practice: 2,
    reason_theme: '观星', wish_text: '试试星空观察者的形态' }),
  Object.freeze({ direction_id: 'dream_cloud', label: '云朵梦境生物', axis: 'form', topics: [], locations: [], practice_topics: [], minimum_practice: 2,
    reason_theme: '梦境', wish_text: '试试云朵梦境生物的形态' }),
  Object.freeze({ direction_id: 'chef', label: '厨师方向', axis: 'vocation', topics: ['cook'], locations: ['warm-pot-courtyard'],
    practice_topics: ['cook'], practice_activities: COOKING, minimum_practice: 3, reason_theme: '灶边做饭', wish_text: '试着当一个会帮忙做饭的厨师' }),
  Object.freeze({ direction_id: 'explorer', label: '潮痕探险家', axis: 'vocation', topics: ['explore'], locations: ['tidal-old-road', 'backlit-grove', 'echo-waterside'],
    practice_topics: ['explore'], minimum_practice: 2, reason_theme: '远方路线', wish_text: '试着当一段时间的潮痕探险家' }),
]);

function actor(world, actorId) {
  return world?.protagonist?.character_id === actorId ? world.protagonist : world?.npcs?.find(person => person.npc_id === actorId) ?? null;
}
function activityLocation(world, recipe) {
  const object = world?.map_catalog?.objects?.find(item => item.object_id === recipe.target);
  return world?.map_catalog?.areas?.find(area => area.area_id === object?.area_id)?.location_id ?? null;
}
function actualTopic(record) {
  if (record.source?.task_kind === 'travel' || record.source?.life_action === 'rest') return null;
  const topic = activityTopic(record.activity_id);
  if (topic && record.effect?.practice === true) return topic;
  return !record.activity_id && record.source?.life_action === 'observe' ? clean(record.topic) : null;
}
function motivation(record) {
  if (record.causes?.trigger === 'invited' || record.causes?.motivation?.kind === 'invited') return 'invited';
  return ['need', 'self_continuation'].includes(record.causes?.motivation?.kind) ? record.causes.motivation.kind : 'unknown';
}
function canonicalRecords(world, actorId, from, until) {
  const records = new Map();
  for (const record of world?.memory?.development?.records ?? []) {
    const root = clean(record.root_outcome_id), settled = milliseconds(record.at);
    if (!root || settled === null || settled < from || settled > until
      || !['completed', 'failed', 'cancelled'].includes(record.outcome) || !Object.hasOwn(SOURCE_RANK, record.source?.kind)) continue;
    const prior = records.get(root);
    if (!prior || SOURCE_RANK[record.source.kind] > SOURCE_RANK[prior.source?.kind]) records.set(root, record);
  }
  return [...records.values()].filter(record => record.actor_ids?.includes(actorId))
    .sort((a, b) => milliseconds(a.at) - milliseconds(b.at) || a.root_outcome_id.localeCompare(b.root_outcome_id));
}
function mappedRecord(world, direction, record, knownLocations) {
  if (!knownLocations.has(record.location_id) || !direction.locations.includes(record.location_id) || !direction.topics.includes(actualTopic(record))) return false;
  if (!record.activity_id) return record.source?.life_action === 'observe';
  const recipe = RECIPES.get(record.activity_id);
  // A retained task must match the authored recipe's actual place. A broad
  // topic or arbitrary old location must not silently acquire a new meaning.
  return Boolean(recipe && record.effect?.practice === true && activityLocation(world, recipe) === record.location_id);
}
function matchesPractice(direction, record) {
  return record.effect?.practice === true && direction.practice_topics.includes(activityTopic(record.activity_id))
    && (!direction.practice_activities || direction.practice_activities.includes(record.activity_id));
}
function dailyRepresentatives(active) {
  const days = new Map(), selected = [];
  for (const record of active) {
    const day = localDay(record.at);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(record);
  }
  // Repeated observation cannot occupy both daily slots before a later real
  // practice occurs. Keep the first root and a different actual context when
  // present; otherwise a second same-context root. Still at most two per date.
  for (const records of days.values()) {
    selected.push(records[0]);
    const next = records.slice(1).find(record => context(record) !== context(records[0])) ?? records[1];
    if (next) selected.push(next);
  }
  return selected;
}
function references(records, maximum = MAX_ROOT_REFS) { return records.slice(-maximum).map(record => record.root_outcome_id); }
function evidenceFor(direction, records) {
  const complete = records.filter(record => record.outcome === 'completed');
  const active = complete.filter(record => motivation(record) === 'self_continuation');
  const threshold = dailyRepresentatives(active);
  const practice = records.filter(record => matchesPractice(direction, record));
  const success = practice.filter(record => record.outcome === 'completed');
  const invited = success.filter(record => motivation(record) === 'invited');
  const condition = practice.filter(record => record.outcome === 'failed' && CONDITION_FAILURES.has(record.failure?.classification));
  const performance = practice.filter(record => record.outcome === 'failed' && record.failure?.classification === 'performance');
  const unknown = practice.filter(record => record.outcome === 'failed' && !CONDITION_FAILURES.has(record.failure?.classification) && record.failure?.classification !== 'performance');
  const cancelled = practice.filter(record => record.outcome === 'cancelled');
  // Threshold references and the newest outcomes are prioritised, and the
  // public array stays bounded. Counts use all retained canonical roots.
  const ids = new Set(references(records, 4));
  for (const root of references(threshold, 28)) ids.add(root);
  for (const record of [...success, ...records].reverse()) {
    if (ids.size >= MAX_ROOT_REFS) break;
    ids.add(record.root_outcome_id);
  }
  const referenced = records.filter(record => ids.has(record.root_outcome_id));
  const activeDays = unique(threshold.map(record => localDay(record.at)));
  return {
    scope: 'direction_mapped_canonical_roots_in_window',
    root_outcome_ids: [...ids],
    root_outcomes: referenced.map(record => ({ root_outcome_id: record.root_outcome_id, at: record.at })),
    latest_actual_outcome_at: records.at(-1)?.at ?? null,
    latest_root_outcome_ids: references(records, 4),
    active_roots: references(threshold, 28), threshold_root_ids: references(threshold, 28),
    active_days: activeDays, active_contexts: unique(threshold.map(context)),
    practice_success_roots: references(success), practice_days: unique(success.map(record => localDay(record.at))),
    invited_practice_roots: references(invited),
    obligation_roots: references(complete.filter(record => motivation(record) === 'need')),
    unknown_motivation_roots: references(complete.filter(record => motivation(record) === 'unknown')),
    condition_failure_roots: references(condition), performance_failure_roots: references(performance), unknown_failure_roots: references(unknown), cancelled_roots: references(cancelled),
    counts: { roots: records.length, active: active.length, active_threshold_roots: threshold.length, active_days: activeDays.length,
      active_contexts: unique(threshold.map(context)).length, practice_successes: success.length, practice_days: unique(success.map(record => localDay(record.at))).length,
      invited_practice: invited.length, condition_failures: condition.length, performance_failures: performance.length, unknown_failures: unknown.length, cancellations: cancelled.length },
    daily_limit: 2, daily_representation: 'first_then_different_actual_context', root_reference_limit: MAX_ROOT_REFS,
    counts_scope: 'retained_unique_roots_in_14_day_window', historical_import_included: true,
  };
}

function circumstance(world, direction, actorId, at) {
  const person = actor(world, actorId), state = world?.autonomy?.actors?.[actorId];
  const energy = typeof state?.energy === 'number' && Number.isFinite(state.energy) ? state.energy : null;
  const appetite = typeof state?.appetite === 'number' && Number.isFinite(state.appetite) ? state.appetite : null;
  const needsKnown = energy !== null && appetite !== null;
  const busy = (world?.tasks ?? []).some(task => task.actor_id === actorId && ['running', 'paused'].includes(task.status));
  const recipes = ACTIVITIES.filter(recipe => direction.practice_topics.includes(activityTopic(recipe.activity_id))
    && (!direction.practice_activities || direction.practice_activities.includes(recipe.activity_id))
    && direction.locations.includes(activityLocation(world, recipe)));
  const available = [];
  if (person && world?.living?.objects && world?.living?.inventories && world?.living?.recovery && world?.map_catalog?.areas && world?.map_catalog?.objects && world?.locations) {
    const locations = unique(recipes.map(recipe => activityLocation(world, recipe)));
    for (const locationId of locations) {
      if (!findWorldPath(world, person.location_id, locationId)) continue;
      // Eligibility is a pure existing read model. Only the projected actor's
      // location changes, so walking there is checked without starting a task,
      // reserving materials, changing grants, or creating inventory.
      const moved = { ...person, location_id: locationId };
      const projection = { ...world, clock: { ...world.clock, synced_at: at },
        protagonist: actorId === world.protagonist.character_id ? moved : world.protagonist,
        npcs: actorId === world.protagonist.character_id ? world.npcs ?? [] : (world.npcs ?? []).map(npc => npc.npc_id === actorId ? moved : npc) };
      const living = livingReadModel(projection, actorId, { at });
      for (const recipe of living?.activities ?? []) if (recipe.available && recipes.some(candidate => candidate.activity_id === recipe.activity_id))
        available.push({ activity_id: recipe.activity_id, location_id: locationId });
    }
  }
  return { needs_known: needsKnown, energy, appetite, needs_ready: needsKnown && energy >= .55 && appetite <= .6,
    actor_available: Boolean(person && !state?.paused && !busy),
    practice_available: available.length > 0, available_practices: available.slice(0, 8),
    eligibility_basis: 'existing_living_recipe_eligibility_and_world_path', stocks_assumed_or_minted: false };
}
function check(id, label, passed, actual, required, scope = 'evidence') { return { id, label, passed, actual, required, scope }; }
function directionRead(world, direction, records, actorId, at, enabled, knownLocations) {
  const mapped = records.filter(record => mappedRecord(world, direction, record, knownLocations));
  const basis = evidenceFor(direction, mapped), current = circumstance(world, direction, actorId, at);
  const checks = [
    check('facets_installed', '共同经历的兴趣与能力读模尚未安装', enabled, enabled, true),
    check('authored_practice', '这个方向还没有对应的实际活动', direction.practice_topics.length > 0, direction.practice_topics.length > 0, true),
    check('active_roots', '还需至少三次可确认的主动继续', basis.counts.active_threshold_roots >= 3, basis.counts.active_threshold_roots, 3),
    check('active_days', '主动继续尚未跨过三个上海日', basis.active_days.length >= 3, basis.active_days.length, 3),
    check('active_contexts', '主动继续还需两种已知的活动与地点情境', basis.active_contexts.length >= 2, basis.active_contexts.length, 2),
    check('practice_successes', `还需实际做成至少 ${direction.minimum_practice} 次对应配方`, basis.counts.practice_successes >= direction.minimum_practice, basis.counts.practice_successes, direction.minimum_practice),
    check('practice_days', '对应配方还需跨两个上海日做成', basis.practice_days.length >= 2, basis.practice_days.length, 2),
    check('current_needs_known', '当前体力与进食需要尚不明确', current.needs_known, current.needs_known, true, 'circumstance'),
    check('current_needs', '先照顾体力与进食需要，再讨论新方向', current.needs_ready, { energy: current.energy, appetite: current.appetite }, { minimum_energy: .55, maximum_appetite: .6 }, 'circumstance'),
    check('actor_available', '正在做的事或暂停安排需要先处理', current.actor_available, current.actor_available, true, 'circumstance'),
    check('practice_available', '路线、材料、设施或协作条件暂不支持继续尝试', current.practice_available, current.practice_available, true, 'circumstance'),
  ];
  const barriers = checks.filter(item => !item.passed).map(({ id, label, scope }) => ({ id, label, scope }));
  const eligible = barriers.length === 0;
  const authoredReason = !direction.practice_topics.length ? `${direction.reason_theme}还没有对应的实际活动，普通观察或对白不能当作这方面的经历。`
    : eligible ? `过去 ${WINDOW_DAYS} 天，我在${direction.reason_theme}主动继续了 ${basis.active_days.length} 个上海日，有 ${basis.active_contexts.length} 种实际情境；也跨日做成了 ${basis.counts.practice_successes} 次对应配方。我想${direction.wish_text}，但这些记录还不说明技能或形态已经成熟。`
      : `过去 ${WINDOW_DAYS} 天，${direction.reason_theme}有 ${basis.active_days.length} 个上海日的主动继续、${basis.active_contexts.length} 种情境和 ${basis.counts.practice_successes} 次对应配方完成。${barriers.find(item => item.scope === 'evidence' && item.id !== 'facets_installed')?.label ?? barriers[0]?.label ?? '还需要继续观察'}。条件困难不表示不喜欢，也不直接说明不会做。`;
  const result = { direction_id: direction.direction_id, label: direction.label, axis: direction.axis,
    readiness: { eligible, barriers, checks }, basis, current_circumstance: current, authored_reason: authoredReason,
    next_step: eligible ? '先表达想尝试的愿望，再安排实际试做；表达愿望不会改变外观或获得职业资格。'
      : barriers.some(item => item.scope === 'evidence') ? '继续原有生活，等对应的主动经历与实际练习满足条件。' : '保留已有经历，先处理眼前需要与可执行条件。' };
  return { ...result, fingerprint: digest({ direction_id: direction.direction_id, axis: direction.axis, enabled, basis,
    current_circumstance: { needs_known: current.needs_known, needs_ready: current.needs_ready,
      actor_available: current.actor_available, practice_available: current.practice_available, available_practices: current.available_practices },
    checks: checks.map(({ id, passed, actual, required, scope }) => ({ id, passed, scope,
      ...(scope === 'evidence' ? { actual, required } : {}) })) }) };
}

/** Pure bounded gate over existing facts. No installation, XP, stock or task writes. */
export function roleWishReadModel(world, { actorId = world?.protagonist?.character_id ?? 'shaping-001', at = world?.clock?.synced_at ?? world?.updated_at } = {}) {
  const until = milliseconds(at), from = until === null ? null : until - WINDOW_DAYS * DAY;
  const installed = world?.memory?.development?.facets;
  const enabled = installed?.schema === DEVELOPMENT_FACETS_VERSION && milliseconds(installed.installed_at) !== null
    && until !== null && milliseconds(installed.installed_at) <= until && Boolean(actor(world, actorId));
  const records = until === null ? [] : canonicalRecords(world, actorId, from, until);
  const knownLocations = new Set((world?.locations ?? world?.map_catalog?.locations ?? []).map(place => place.location_id));
  const directions = ROLE_WISH_DIRECTIONS.map(direction => directionRead(world, direction, records, actorId, at, enabled, knownLocations));
  return { schema: ROLE_WISH_SCHEMA, enabled, character_id: actorId, at: until === null ? null : new Date(until).toISOString(),
    evidence_revision: world?.memory?.development?.revision ?? 0,
    window: { days: WINDOW_DAYS, from: from === null ? null : new Date(from).toISOString(), until: until === null ? null : new Date(until).toISOString(), time_zone: 'Asia/Shanghai' },
    fingerprint: digest({ enabled, character_id: actorId, directions: directions.map(direction => ({ direction_id: direction.direction_id, fingerprint: direction.fingerprint })) }),
    directions, interpretation: { readiness_is_self_wish: false, eligibility_is_role_unlock: false, invited_practice_is_independent_interest: false,
      failure_is_dislike: false, quality_or_professional_qualification_proven: false, automatic_appearance_changes: false,
      evidence_basis: 'same_canonical_root_outcomes', window_is_real_elapsed_time: true } };
}
