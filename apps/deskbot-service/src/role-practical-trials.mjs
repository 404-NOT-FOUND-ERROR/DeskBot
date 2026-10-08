import { createHash } from 'node:crypto';
import { ACTIVITIES } from './living-resources.mjs';
import { activitySteps } from './life-planning.mjs';
import { activeWorldTask, controlWorldTask, localWorldDate } from './realtime-world.mjs';
import { ROLE_WISH_DIRECTIONS } from './role-wishes.mjs';

export const PRACTICAL_ROLE_TRIAL_SCHEMA = 'deskbot.practical-role-trials.v1';
export const PRACTICAL_ROLE_TRIAL_ITEM_SCHEMA = 'deskbot.practical-role-trial.v1';
const CONDITION = new Set(['resource', 'condition', 'route', 'coordination']);
const DEFINITIONS = Object.freeze({
  wetland_frog: [{ id: 'nursery', label: '在苗圃实际照料', activities: ['tend-bed'] }, { id: 'waterside', label: '在水岸实际汲水', activities: ['collect-water'] }],
  workshop_maker: [{ id: 'craft', label: '做一只育苗托盘', activities: ['craft-tray'] },
    { id: 'repair', label: '修缮一处实际磨损的设施', activities: ['repair-bench', 'repair-frame', 'repair-rack', 'repair-stove', 'stitch-canopy', 'repair-pump'] }],
  chef: [{ id: 'cook', label: '实际做苔芽餐', activities: ['cook-moss'] }, { id: 'stew', label: '实际煮林间光果餐', activities: ['cook-grove-stew'] }],
  explorer: [{ id: 'scout', label: '沿旧路实际观察十步', activities: ['scout-route'] }],
});
const clean = value => typeof value === 'string' && value.trim() && value.length <= 500 ? value.trim() : null;
const validAt = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unique = values => [...new Set(values.filter(Boolean))].sort();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = at => localWorldDate(at, 'Asia/Shanghai')?.date ?? null;
const person = (world, actorId) => world?.protagonist?.character_id === actorId ? world.protagonist : world?.npcs?.find(npc => npc.npc_id === actorId) ?? null;
const variantFor = trial => DEFINITIONS[trial.direction_id]?.find(variant => variant.id === trial.variant_id);
const trials = world => Object.values(world?.practical_role_trials?.trials ?? {});
const alive = trial => ['running', 'blocked', 'paused'].includes(trial.status);
const issue = (code, label, classification = 'condition') => ({ code, label, classification });

export class PracticalRoleTrialError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; }
}
const fail = (code, message, status = 409) => { throw new PracticalRoleTrialError(code, message, status); };
function requireTime(world, at) {
  if (!validAt(at) || world?.clock?.mode !== 'real_time') fail('practical_trial_real_time_required', '实际试做需要有效的现实时间。', 400);
  if (Date.parse(at) < Date.parse(world.clock.synced_at)) fail('practical_trial_time_conflict', '先核对已经经过的时间，再继续试做。');
}
function bump(world, trial, at) { trial.updated_at = at; trial.revision = (trial.revision ?? 0) + 1; world.practical_role_trials.revision++; }
function history(trial, at, operation, eventId, details = {}) {
  trial.history.push({ at, operation, event_id: clean(eventId), ...details }); trial.history = trial.history.slice(-32);
}
function targetLocation(world, activityId) {
  const recipe = ACTIVITIES.find(activity => activity.activity_id === activityId);
  const object = world?.map_catalog?.objects?.find(item => item.object_id === recipe?.target);
  return world?.map_catalog?.areas?.find(area => area.area_id === object?.area_id)?.location_id ?? null;
}

/** The same small closed link is archived with tasks and canonical memory facts. */
export function safePracticalTrialMetadata(value) {
  if (!value || !DEFINITIONS[value.direction_id] || ROLE_WISH_DIRECTIONS.find(direction => direction.direction_id === value.direction_id)?.axis !== value.axis
    || !['primary', 'support'].includes(value.step_role) || !DEFINITIONS[value.direction_id].some(variant => variant.activities.includes(value.primary_activity_id))) return null;
  const trialId = clean(value.trial_id), proposalId = clean(value.proposal_id), attemptId = clean(value.attempt_id);
  if (!trialId || !proposalId || !attemptId) return null;
  return { trial_id: trialId, proposal_id: proposalId, direction_id: value.direction_id, axis: value.axis,
    attempt_id: attemptId, step_role: value.step_role, primary_activity_id: value.primary_activity_id };
}

export function startPracticalTrial(world, { proposalId, actorId, directionId, wishBasis, at, eventId, variant = null } = {}) {
  requireTime(world, at);
  if (!clean(proposalId) || !person(world, actorId)) fail('practical_trial_actor_unknown', '这份愿望需要对应已经住在世界里的个体。', 400);
  const definition = ROLE_WISH_DIRECTIONS.find(direction => direction.direction_id === directionId);
  if (!definition || !DEFINITIONS[directionId]) fail('practical_trial_direction_unavailable', '这个方向还没有可以真实执行的试做活动。');
  const trialId = `practical-role-trial:${proposalId}:v1`, existing = world.practical_role_trials?.trials?.[trialId];
  if (existing) {
    if (existing.actor_id !== actorId || existing.direction_id !== directionId) fail('practical_trial_identity_conflict', '这份编号已经对应另一个实际愿望，不能改写原有记录。');
    return { trial_id: trialId, duplicate: true, trial: publicTrial(world, existing, at) };
  }
  if (trials(world).some(trial => trial.actor_id === actorId && alive(trial))) fail('practical_trial_actor_busy', '先处理这个个体现有的实际试做，再安排下一份。');
  const chosen = DEFINITIONS[directionId].find(item => item.id === (variant ?? DEFINITIONS[directionId][0].id));
  if (!chosen) fail('practical_trial_variant_unknown', '请从这个方向已经设计的试做方式中选择。', 400);
  if (!Array.isArray(wishBasis?.root_outcome_ids)) fail('practical_trial_wish_basis_invalid', '原愿望需要已经核对的实际经历依据。', 400);
  const requestedRoots = unique(wishBasis.root_outcome_ids.map(clean)).slice(0, 32);
  const canonical = new Map((world.memory?.development?.records ?? []).map(record => [record.root_outcome_id, record]));
  if (!requestedRoots.length || requestedRoots.some(root => !canonical.get(root)?.actor_ids?.includes(actorId)
    || !validAt(canonical.get(root)?.at) || Date.parse(canonical.get(root).at) > Date.parse(at))) fail('practical_trial_wish_basis_invalid', '原愿望的实际经历依据需要先核对，不能补造新的经历。');
  world.practical_role_trials ??= { schema: PRACTICAL_ROLE_TRIAL_SCHEMA, revision: 0, trials: {} };
  const trial = { schema: PRACTICAL_ROLE_TRIAL_ITEM_SCHEMA, trial_id: trialId, proposal_id: proposalId, actor_id: actorId,
    direction_id: directionId, axis: definition.axis, status: 'running', variant_id: chosen.id, started_at: at, updated_at: at,
    revision: 0, start_event_id: clean(eventId), frozen_wish_root_ids: requestedRoots,
    attempt_sequence: 0, attempts: [], outcomes: [], history: [], blockers: [], review_reason: null, pause_origin: null,
    ended_at: null, exited_at: null, exit_event_id: null };
  world.practical_role_trials.trials[trialId] = trial;
  history(trial, at, 'start', eventId, { variant_id: chosen.id }); bump(world, trial, at);
  settlePracticalTrials(world, at);
  return { trial_id: trialId, duplicate: false, trial: publicTrial(world, trial, at) };
}

function cancelOwnedWork(world, trial, at) {
  const current = activeWorldTask(world, trial.actor_id);
  if (current?.role_trial?.trial_id === trial.trial_id) controlWorldTask(world, { task_id: current.task_id, operation: 'cancel' }, at);
  const state = world.autonomy?.actors?.[trial.actor_id];
  if (state?.plan?.role_trial?.trial_id === trial.trial_id) {
    state.plan = null; state.next_decision_at = at;
  }
}
export function controlPracticalTrial(world, { trialId, operation, at, eventId, variant = null } = {}) {
  requireTime(world, at);
  const trial = world.practical_role_trials?.trials?.[trialId];
  if (!trial) fail('practical_trial_not_found', '没有这份实际试做记录。', 404);
  if (trial.accepted_stage_id) fail('practical_trial_stage_bound', '这份试做已绑定采用的角色阶段，旧结果不能再调整、退出或重新使用；请在角色阶段上回退。');
  const action = operation === 'withdraw' ? 'exit' : operation;
  if (!['pause', 'resume', 'adjust', 'exit'].includes(action)) fail('practical_trial_operation_invalid', '可以暂停、恢复、调整或退出试做。', 400);
  if (trial.status === 'exited') {
    if (action === 'exit') return { trial_id: trialId, duplicate: true, trial: publicTrial(world, trial, at) };
    fail('practical_trial_ended', '这份试做已经结束，保留实际结果，不从旧编号重新开始。');
  }
  if (action === 'resume' && trial.status !== 'paused') fail('practical_trial_not_paused', '只有暂停的试做可以恢复。');
  if (action === 'pause' && trial.status === 'paused' && trial.pause_origin === 'owner') return { trial_id: trialId, duplicate: true, trial: publicTrial(world, trial, at) };
  if (action === 'pause' && trial.status === 'review') fail('practical_trial_review_ready', '这份试做已进入回顾，可以调整方式或退出。');
  if (action === 'adjust') {
    if (!['paused', 'review'].includes(trial.status)) fail('practical_trial_pause_before_adjust', '先暂停当前试做，再调整实际方式。');
    if (!DEFINITIONS[trial.direction_id].some(item => item.id === variant)) fail('practical_trial_variant_unknown', '只能调整到这个方向已有的实际试做方式。', 400);
    if (trials(world).some(other => other.trial_id !== trialId && other.actor_id === trial.actor_id && alive(other))) fail('practical_trial_actor_busy', '这个个体正在处理另一份试做，先处理已有安排。');
  }
  if (['pause', 'adjust', 'exit'].includes(action)) cancelOwnedWork(world, trial, at);
  if (action === 'resume') {
    const current = activeWorldTask(world, trial.actor_id);
    if (current?.role_trial?.trial_id === trial.trial_id && current.status === 'paused') controlWorldTask(world, { task_id: current.task_id, operation: 'resume' }, at);
  }
  trial.status = action === 'exit' ? 'exited' : action === 'pause' ? 'paused' : 'running';
  trial.pause_origin = action === 'pause' ? 'owner' : null;
  trial.blockers = [];
  if (action === 'adjust') {
    trial.variant_id = variant;
    // The past outcomes remain canonical facts. A new variant requires fresh
    // actual results from that variant before it reaches a new review.
    trial.review_from = at; trial.review_reason = null;
  }
  if (action === 'exit') { trial.ended_at = at; trial.exited_at = at; trial.exit_event_id = clean(eventId); }
  history(trial, at, action, eventId, action === 'adjust' ? { variant_id: variant } : {}); bump(world, trial, at);
  settlePracticalTrials(world, at);
  return { trial_id: trialId, duplicate: false, trial: publicTrial(world, trial, at) };
}

function blockersFor(world, trial, at, { ignorePlan = false } = {}) {
  const state = world.autonomy?.actors?.[trial.actor_id], current = activeWorldTask(world, trial.actor_id);
  if (current?.role_trial?.trial_id === trial.trial_id) return current.status === 'paused' ? [issue('task_paused', '实际任务被暂停，先恢复或退出。', 'coordination')] : [];
  if (current) return [issue('actor_busy', '先完成正在做的普通生活事务。', 'coordination')];
  if (!ignorePlan && state?.plan && !state.plan.role_trial && ['planned', 'executing'].includes(state.plan.status)) return [issue('ordinary_plan_pending', '先继续已有的普通生活安排。', 'coordination')];
  if (world.living?.recovery?.pending) return [issue('world_recovery_pending', '先核对离线期间实际经过的时间。')];
  if (!state || state.paused) return [issue('autonomy_paused', '个体的自行安排目前暂停。', 'coordination')];
  const minute = localWorldDate(at, 'Asia/Shanghai')?.minute_of_day;
  if (!Number.isFinite(state.energy) || !Number.isFinite(state.appetite) || !Number.isFinite(minute)
    || state.energy < .55 || state.appetite > .6 || minute >= 1380 || minute < 360) return [issue('needs_first', '先吃饭或休息，留有余力后再继续试做。')];
  if (trial.attempts.some(attempt => attempt.day === date(at))) return [issue('daily_attempt_used', '今天已有一次实际试做，继续生活，下一日再看。')];
  return [];
}
function buildCandidate(world, trial, at) {
  if (!world.living || !world.map_catalog || !person(world, trial.actor_id)) return { available: false };
  let lastError = null;
  for (const activityId of variantFor(trial)?.activities ?? []) {
    try {
      const steps = activitySteps(world, trial.actor_id, activityId);
      const primary = steps.findLastIndex(step => step.kind === 'activity' && step.activity_id === activityId);
      if (primary < 0) continue;
      const attemptId = `${trial.trial_id}:attempt:${trial.attempt_sequence + 1}`;
      return { goal: `role-trial:${trial.trial_id}:${trial.attempt_sequence + 1}`, title: variantFor(trial).label,
        reason: '先把基本需要和原有安排留好余地，再实际试一小次这份愿望。', score: 34, available: true,
        steps: steps.map((step, index) => ({ ...step, role_trial_primary: index === primary })),
        discretionary_practice: true,
        development_topic: trial.direction_id === 'wetland_frog' ? 'care' : trial.direction_id === 'chef' ? 'cook' : trial.direction_id === 'explorer' ? 'explore' : trial.variant_id === 'repair' ? 'repair' : 'craft',
        role_trial: { trial_id: trial.trial_id, proposal_id: trial.proposal_id, direction_id: trial.direction_id, axis: trial.axis,
          attempt_id: attemptId, primary_activity_id: activityId } };
    } catch (error) { if (!error.code) throw error; lastError = error; }
  }
  return { available: false, blocked_reason: lastError?.message ?? '当前没有可执行的对应活动。' };
}
export function practicalTrialCandidates(world, state, at) {
  const trial = trials(world).find(item => item.actor_id === state.actor_id && ['running', 'blocked'].includes(item.status));
  if (!trial || blockersFor(world, trial, at).length) return [];
  const candidate = buildCandidate(world, trial, at);
  return candidate.available ? [candidate] : [];
}
/** Stamp only after the original task engine actually admitted the real task. */
export function recordPracticalTrialTask(world, task, at) {
  const link = safePracticalTrialMetadata(task.role_trial), trial = link && world.practical_role_trials?.trials?.[link.trial_id];
  if (!trial || trial.actor_id !== task.actor_id || task.origin !== 'autonomous_life' || !alive(trial)
    || !validAt(at) || Date.parse(at) < Date.parse(trial.started_at) || link.direction_id !== trial.direction_id || link.proposal_id !== trial.proposal_id) fail('practical_trial_task_mismatch', '试做关联已经变化，先保留原有实际记录。');
  if (trial.admitted_tasks?.some(item => item.task_id === task.task_id)) return;
  if (link.attempt_id !== `${trial.trial_id}:attempt:${trial.attempt_sequence + 1}`) fail('practical_trial_attempt_mismatch', '试做安排已变化，重新看当前实际条件。');
  trial.admitted_tasks ??= [];
  trial.admitted_tasks.push({ task_id: task.task_id, attempt_id: link.attempt_id, step_role: link.step_role, variant_id: trial.variant_id,
    primary_activity_id: link.primary_activity_id, started_at: at });
  trial.admitted_tasks = trial.admitted_tasks.slice(-128);
  if (link.step_role !== 'primary') { bump(world, trial, at); return; }
  if (task.activity_id !== link.primary_activity_id || !variantFor(trial).activities.includes(task.activity_id)) fail('practical_trial_activity_mismatch', '实际任务需要使用当前方式的已登记配方。');
  if (trial.attempts.some(attempt => attempt.attempt_id === link.attempt_id)) return;
  if (trial.attempts.some(attempt => attempt.day === date(at))) fail('practical_trial_daily_limit', '今天已经开始过一次实际试做，下一日再看。');
  trial.attempt_sequence++;
  trial.attempts.push({ attempt_id: link.attempt_id, task_id: task.task_id, activity_id: task.activity_id, variant_id: trial.variant_id, day: date(at), started_at: at });
  trial.attempts = trial.attempts.slice(-64); bump(world, trial, at);
}
/** Do not let a multi-step trial plan outrun hunger, rest, or a user decision. */
export function practicalTrialPlanMayContinue(world, state, at) {
  const link = state.plan?.role_trial, trial = link && world.practical_role_trials?.trials?.[link.trial_id];
  if (!link) return true;
  if (!trial || !['running', 'blocked'].includes(trial.status)) return false;
  const next = state.plan.steps[state.plan.index];
  // The daily quota applies when the primary activity begins, while support
  // steps for an already admitted attempt may finish without new credit.
  const blocking = blockersFor(world, trial, at, { ignorePlan: true }).filter(blocker => blocker.code !== 'daily_attempt_used');
  if (blocking.length) return false;
  return !next?.role_trial_primary || !trial.attempts.some(attempt => attempt.day === date(at));
}
function resultsFor(world, trial, at) {
  const limit = Date.parse(at), roots = new Map();
  for (const record of world.memory?.development?.records ?? []) {
    const link = safePracticalTrialMetadata(record.source?.role_trial);
    if (!link || link.trial_id !== trial.trial_id || link.proposal_id !== trial.proposal_id || link.direction_id !== trial.direction_id
      || link.axis !== trial.axis || !record.actor_ids?.includes(trial.actor_id) || !validAt(record.at)
      || Date.parse(record.at) < Date.parse(trial.started_at) || Date.parse(record.at) > limit
      || !['completed', 'failed', 'cancelled'].includes(record.outcome) || !record.root_outcome_id?.startsWith('task:')) continue;
    const attempt = trial.attempts.find(item => item.attempt_id === link.attempt_id);
    const primary = link.step_role === 'primary';
    const admission = (trial.admitted_tasks ?? []).find(item => `task:${item.task_id}` === record.root_outcome_id && item.attempt_id === link.attempt_id && item.step_role === link.step_role);
    if (!admission || admission.primary_activity_id !== link.primary_activity_id || Date.parse(record.at) < Date.parse(admission.started_at)) continue;
    if (primary && (!attempt || `task:${attempt.task_id}` !== record.root_outcome_id || record.activity_id !== attempt.activity_id
      || record.activity_id !== link.primary_activity_id || record.effect?.practice !== true || targetLocation(world, record.activity_id) !== record.location_id)) continue;
    if (!roots.has(record.root_outcome_id)) roots.set(record.root_outcome_id, {
      root_outcome_id: record.root_outcome_id, at: record.at, outcome: record.outcome, activity_id: record.activity_id ?? null,
      location_id: record.location_id ?? null, step_role: link.step_role, attempt_id: link.attempt_id,
      classification: record.outcome === 'cancelled' ? 'cancelled' : record.failure?.classification ?? null,
      failure_code: clean(record.failure?.code), variant_id: admission.variant_id ?? attempt?.variant_id ?? null });
  }
  // Keep settled links after ordinary task/episode retention has moved on. They
  // are references to committed common roots, not additional outcome effects.
  for (const result of trial.outcomes ?? []) if (validAt(result.at) && Date.parse(result.at) <= limit && !roots.has(result.root_outcome_id)) roots.set(result.root_outcome_id, structuredClone(result));
  return [...roots.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.root_outcome_id.localeCompare(b.root_outcome_id)).slice(-128);
}
function progressFor(trial, outcomes) {
  const primary = outcomes.filter(outcome => outcome.step_role === 'primary');
  const success = primary.filter(outcome => outcome.outcome === 'completed');
  return { successful_primary: success.length,
    condition_failures: primary.filter(outcome => outcome.outcome === 'failed' && CONDITION.has(outcome.classification)).length,
    performance_failures: primary.filter(outcome => outcome.outcome === 'failed' && outcome.classification === 'performance').length,
    unknown_failures: primary.filter(outcome => outcome.outcome === 'failed' && !CONDITION.has(outcome.classification) && outcome.classification !== 'performance').length,
    cancelled: primary.filter(outcome => outcome.outcome === 'cancelled').length,
    primary_days: unique(success.map(outcome => date(outcome.at))), root_outcome_ids: primary.map(outcome => outcome.root_outcome_id).slice(-32),
    support_roots: outcomes.filter(outcome => outcome.step_role === 'support').map(outcome => outcome.root_outcome_id).slice(-32), started_attempts: trial.attempts.length };
}
function reviewFor(trial, outcomes) {
  const recent = outcomes.filter(outcome => outcome.step_role === 'primary' && outcome.variant_id === trial.variant_id && (!trial.review_from || outcome.at > trial.review_from));
  const success = recent.filter(outcome => outcome.outcome === 'completed');
  const failure = recent.filter(outcome => outcome.outcome === 'failed' && !CONDITION.has(outcome.classification));
  const reason = success.length >= 2 && unique(success.map(outcome => date(outcome.at))).length >= 2 ? 'repeated_actual_success'
    : failure.length >= 2 ? 'execution_difficulties' : null;
  return { ready: Boolean(reason), reason, basis: 'canonical_unique_task_results',
    summary: reason === 'repeated_actual_success' ? '这个方式已经跨两个上海日实际做成两次，可以回顾是否继续；还没有证明作品质量、职业资格或喜欢它。'
      : reason === 'execution_difficulties' ? '这个方式已有两次执行不足或原因未明的实际失败，先回顾与调整；不能据此判断讨厌这个方向。'
        : '继续观察实际结果；条件困难、取消、准备步骤和聊天都不能替代对应的试做成果。',
    quality_proven: false, qualification_proven: false, preference_proven: false, changes_appearance: false };
}
export function settlePracticalTrials(world, at) {
  if (!world.practical_role_trials || !validAt(at)) return { enabled: false, changed: false };
  let changed = false;
  for (const trial of trials(world)) {
    const before = JSON.stringify({ status: trial.status, outcomes: trial.outcomes, blockers: trial.blockers, review_reason: trial.review_reason, pause_origin: trial.pause_origin });
    trial.outcomes = resultsFor(world, trial, at);
    const current = activeWorldTask(world, trial.actor_id);
    if (trial.status !== 'exited' && !trial.accepted_stage_id) {
      // Repair a retained generic task pause. Keeping a paused task reserved
      // would freeze hunger/rest and contradict the trial's pause semantics.
      if (current?.role_trial?.trial_id === trial.trial_id && current.status === 'paused') {
        cancelOwnedWork(world, trial, at); trial.status = 'paused'; trial.pause_origin = 'owner';
        history(trial, at, 'task_pause_released', null);
      }
      else if (trial.status === 'paused' && trial.pause_origin === 'task_control' && (!current || current.status === 'running' && current.role_trial?.trial_id === trial.trial_id)) { trial.status = 'running'; trial.pause_origin = null; }
      const review = reviewFor(trial, trial.outcomes);
      trial.review_reason = review.reason;
      if (review.ready && trial.status !== 'paused') trial.status = 'review';
      if (['running', 'blocked'].includes(trial.status)) {
        trial.blockers = blockersFor(world, trial, at);
        if (!trial.blockers.length && !current && !buildCandidate(world, trial, at).available) trial.blockers = [issue('activity_conditions_unavailable', '路线、材料、设施或协作条件暂不支持这个方式。')];
        trial.status = trial.blockers.length ? 'blocked' : 'running';
      } else trial.blockers = trial.status === 'paused' ? [issue('trial_paused', '这份试做已暂停，普通生活继续。', 'coordination')] : [];
    }
    const after = JSON.stringify({ status: trial.status, outcomes: trial.outcomes, blockers: trial.blockers, review_reason: trial.review_reason, pause_origin: trial.pause_origin });
    if (before !== after) { bump(world, trial, at); changed = true; }
  }
  return { enabled: true, changed, revision: world.practical_role_trials.revision };
}
function publicTrial(world, trial, at) {
  at = validAt(at) ? at : world.clock?.synced_at ?? trial.updated_at;
  const outcomes = resultsFor(world, trial, at);
  const active = activeWorldTask(world, trial.actor_id), owned = active?.role_trial?.trial_id === trial.trial_id ? active : null;
  const plan = world.autonomy?.actors?.[trial.actor_id]?.plan, step = plan?.role_trial?.trial_id === trial.trial_id ? plan.steps[plan.index] : null;
  const review = reviewFor(trial, outcomes);
  const blockers = ['running', 'blocked'].includes(trial.status) ? blockersFor(world, trial, at) : structuredClone(trial.blockers ?? []);
  if (['running', 'blocked'].includes(trial.status) && !blockers.length && !owned && !buildCandidate(world, trial, at).available) blockers.push(issue('activity_conditions_unavailable', '路线、材料、设施或协作条件暂不支持这个方式。'));
  const status = trial.status === 'exited' || trial.status === 'paused' ? trial.status : review.ready ? 'review' : blockers.length ? 'blocked' : 'running';
  return { schema: PRACTICAL_ROLE_TRIAL_ITEM_SCHEMA, trial_id: trial.trial_id, proposal_id: trial.proposal_id, actor_id: trial.actor_id,
    direction_id: trial.direction_id, axis: trial.axis, status, variant_id: trial.variant_id, variant_label: variantFor(trial)?.label ?? trial.variant_id,
    variant_choices: DEFINITIONS[trial.direction_id].map(({ id, label }) => ({ id, label })),
    allowed_actions: trial.accepted_stage_id || status === 'exited' ? [] : status === 'paused' ? ['resume', 'adjust', 'exit'] : status === 'review' ? ['adjust', 'exit'] : ['pause', 'exit'],
    accepted_stage_id: trial.accepted_stage_id ?? null, accepted_at: trial.accepted_at ?? null,
    started_at: trial.started_at, updated_at: trial.updated_at, ended_at: trial.ended_at, exited_at: trial.exited_at, exit_event_id: trial.exit_event_id,
    active_task: owned ? { task_id: owned.task_id, title: owned.title, activity_id: owned.activity_id ?? null, status: owned.status,
      due_at: owned.due_at, remaining_ms: owned.remaining_ms, step_role: owned.role_trial.step_role } : null,
    current_step: step ? { kind: step.kind, activity_id: step.activity_id ?? null, location_id: step.location_id ?? null, step_role: step.role_trial_primary ? 'primary' : 'support' } : null,
    outcomes: outcomes.slice(-32), progress: progressFor(trial, outcomes), review, blockers,
    next_step: trial.accepted_stage_id ? '这份试做已绑定角色阶段，保留实际成果；后续回退在角色阶段上处理。' : status === 'review' ? '结合这次实际结果回顾，决定继续生活、调整方式或退出；此处不会改变形象。'
      : status === 'exited' ? '本次试做已经结束，保留实际经历与资源后果。' : status === 'paused' ? '普通生活继续；恢复后重新核对实际条件。'
        : status === 'blocked' ? blockers[0]?.label ?? '先继续眼前的生活，再看条件。' : owned ? '等待实际任务到期，再核验材料、地点与环境。' : '留有余力时，自行安排下一次真实活动。',
    frozen_wish_root_ids: [...trial.frozen_wish_root_ids], history: structuredClone(trial.history), fingerprint: digest({ status, variant: trial.variant_id, outcomes, blockers, active_task: owned?.task_id ?? null }) };
}
export function practicalTrialReadModel(world, { proposalId = null, actorId = null, at = world?.clock?.synced_at } = {}) {
  const selected = trials(world).filter(trial => (!proposalId || trial.proposal_id === proposalId) && (!actorId || trial.actor_id === actorId));
  if (proposalId) return selected[0] ? publicTrial(world, selected[0], at) : null;
  return practicalTrialsReadModel(world, { actorId, at });
}
export function practicalTrialsReadModel(world, { actorId = null, at = world?.clock?.synced_at } = {}) {
  return { schema: PRACTICAL_ROLE_TRIAL_SCHEMA, enabled: Boolean(world?.practical_role_trials), revision: world?.practical_role_trials?.revision ?? 0,
    trials: trials(world).filter(trial => !actorId || trial.actor_id === actorId).map(trial => publicTrial(world, trial, at)) };
}
