import { createHash } from 'node:crypto';
import { practicalTrialReadModel } from './role-practical-trials.mjs';
import { localWorldDate, activeWorldTask } from './realtime-world.mjs';
import { activitySteps, cookAndStoreSteps, depositSteps } from './life-planning.mjs';
import { findWorldPath } from './world-map-content.mjs';
import { getRoleExperiencePackage } from './role-experience-packages.mjs';

export const ROLE_STAGES_SCHEMA = 'deskbot.role-stages.v1';
export const ROLE_STAGE_SCHEMA = 'deskbot.role-stage.v1';
export const ROLE_STAGE_PREVIEW_SCHEMA = 'deskbot.role-stage-preview.v1';
const APPEARANCE_SCHEMA = 'deskbot.role-stage-appearance.v1';
const DESIGN_VERSION = 'authored-role-stage-options.v1';
const AXES = ['form', 'vocation'];
const clean = value => typeof value === 'string' && value.trim() && value.length <= 500 ? value.trim() : null;
const validAt = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const unique = values => [...new Set(values.filter(Boolean))].sort();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = at => localWorldDate(at, 'Asia/Shanghai')?.date ?? null;
const person = (world, id) => world?.protagonist?.character_id === id ? world.protagonist : world?.npcs?.find(npc => npc.npc_id === id) ?? null;
const definitions = Object.freeze({
  wetland_frog: { axis: 'form', label: '荷叶青蛙', interests: ['care', 'explore'], places: ['echo-waterside', 'moss-sprout-garden'],
    activity: 'tend-bed', topic: 'care', title: '给苗床做一次轻细的整理', figure_form: 'leaf-frog',
    accessories: ['leaf-collar', 'frog-brow'], palette: { secondary: '#83aa78', light: '#b8f3ce' },
    summary: '保留种子眼、梨形体、胸口光核与光粒，以荷叶领与青蛙眉弧表达虚拟形态。',
    life: '空闲时增加苗圃照料与水岸观察的选择，仍核对真实路线、天气和材料。' },
  workshop_maker: { axis: 'vocation', label: '工坊学徒', interests: ['craft', 'repair'], places: ['spare-parts-house'],
    activity: 'craft-tray', topic: 'craft', title: '做一只托盘给下一批苗用', figure_vocation: 'workshop-maker',
    accessories: ['maker-apron', 'tool-badge'], palette: { secondary: '#9c7861', light: '#ffd6a2' },
    summary: '同一虚拟形体加上工坊围裙和工具纹章；纹章不代表凭空获得工具。',
    life: '增加实际制作与修缮的生活选项，以需要、设施磨损和有限材料决定能否开始。' },
  chef: { axis: 'vocation', label: '灶边厨师', interests: ['cook'], places: ['warm-pot-courtyard'],
    activity: 'cook', topic: 'cook', title: '做一锅饭放到共用长桌', figure_vocation: 'chef',
    accessories: ['chef-hat', 'chef-apron'], palette: { secondary: '#d8b384', light: '#ffe7ac' },
    summary: '同一虚拟形体加上厨帽与灶边围裙；采用厨师方向不等于获得职业资格。',
    life: '参与原有采集、备料、做饭和送餐循环；不赠送食材，不绕过厨房与长桌容量。' },
});

export class RoleStageError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; }
}
const fail = (code, message, statusCode) => { throw new RoleStageError(code, message, statusCode); };
function requireTime(world, at) {
  if (!validAt(at) || world?.clock?.mode !== 'real_time') fail('role_stage_real_time_required', '角色阶段需要有效的现实时间。', 400);
  if (Date.parse(at) < Date.parse(world.clock.synced_at)) fail('role_stage_time_conflict', '先核对已经经过的现实时间，再处理角色阶段。');
}
function actorArchive(world, actorId) { return world?.role_stages?.actors?.[actorId] ?? null; }
function versions(world, actorId) { return actorArchive(world, actorId)?.versions ?? []; }
function currentStage(world, actorId, axis) {
  const archive = actorArchive(world, actorId), id = archive?.axis_current?.[axis];
  return archive?.versions?.find(stage => stage.stage_id === id && stage.actor_id === actorId && stage.axis === axis
    && stage.status === 'accepted' && definitions[stage.direction_id]?.axis === axis) ?? null;
}
function appearancePart(stage, directionId = stage?.direction_id) {
  const design = definitions[directionId]; if (!design) return null;
  const packageValue = getRoleExperiencePackage(directionId);
  return { direction_id: directionId, stage_id: stage?.stage_id ?? null, label: design.label,
    package_id: packageValue?.package_id ?? null, package_version: packageValue?.version ?? null,
    ...(design.axis === 'form' ? { figure_form: packageValue?.appearance.figure_form || design.figure_form } : { figure_vocation: packageValue?.appearance.figure_vocation || design.figure_vocation }),
    accessories: [...(packageValue?.appearance.accessories ?? design.accessories)], palette: { ...(packageValue?.appearance.palette ?? {}), ...design.palette } };
}
export function roleStageAppearance(world, actorId, replacing = null) {
  const selected = { form: currentStage(world, actorId, 'form'), vocation: currentStage(world, actorId, 'vocation') };
  const projection = { schema: APPEARANCE_SCHEMA,
    form: appearancePart(selected.form), vocation: appearancePart(selected.vocation),
    anchors: ['seed-eyes', 'pear-shell', 'chest-pearl', 'stubby-feet', 'light-grains'],
    identity_anchor: { virtual: ['seed-eyes', 'pear-shell', 'chest-pearl', 'stubby-feet', 'light-grains'],
      physical: ['round-black-screen', 'short-triangular-ear-pair', 'rounded-multi-lobe-base', 'yellow-chest-dot'] },
    physical_shell_changed: false };
  if (replacing && definitions[replacing.direction_id]) projection[definitions[replacing.direction_id].axis] = appearancePart(replacing);
  return projection;
}
function stageProjection(world, stage) {
  const current = currentStage(world, stage.actor_id, stage.axis)?.stage_id === stage.stage_id;
  return { schema: ROLE_STAGE_SCHEMA, stage_id: stage.stage_id, proposal_id: stage.proposal_id, trial_id: stage.trial_id,
    actor_id: stage.actor_id, direction_id: stage.direction_id, axis: stage.axis, label: definitions[stage.direction_id]?.label ?? stage.direction_id,
    status: stage.status, current, allowed_actions: current ? ['rollback'] : [], accepted_at: stage.accepted_at,
    rolled_back_at: stage.rolled_back_at, accept_event_id: stage.accept_event_id, rollback_event_id: stage.rollback_event_id,
    predecessor_stage_id: stage.predecessor_stage_id, primary_root_ids: [...stage.primary_root_ids], primary_days: [...stage.primary_days],
    frozen_wish_root_ids: [...stage.frozen_wish_root_ids], life_changes: lifeChanges(definitions[stage.direction_id]),
    qualification_proven: false, preference_proven: false, physical_shell_changed: false };
}
function lifeChanges(design) {
  return design ? { basis: 'rule_based_choice', summary: design.life, added_interests: [...design.interests],
    added_places: [...design.places], actual_activity: design.activity, resource_grants: false, task_preemption: false,
    preference_proven: false, qualification_proven: false } : null;
}
export function roleStageReadModel(world, { proposalId = null, actorId = world?.protagonist?.character_id } = {}) {
  const stage = versions(world, actorId).findLast(item => !proposalId || item.proposal_id === proposalId);
  return stage ? stageProjection(world, stage) : null;
}
export function roleStagesReadModel(world, { actorId = world?.protagonist?.character_id } = {}) {
  const archive = actorArchive(world, actorId);
  return { schema: ROLE_STAGES_SCHEMA, available: world?.clock?.mode === 'real_time', enabled: Boolean(archive), actor_id: actorId,
    revision: world?.role_stages?.revision ?? 0,
    current: Object.fromEntries(AXES.map(axis => { const stage = currentStage(world, actorId, axis); return [axis, stage ? stageProjection(world, stage) : null]; })),
    history: versions(world, actorId).map(stage => stageProjection(world, stage)),
    appearance: roleStageAppearance(world, actorId), events: structuredClone(archive?.history ?? []),
    identity_changed: false, physical_shell_changed: false };
}
function actualBasis(world, proposal, at) {
  const actorId = proposal?.character_id, trial = practicalTrialReadModel(world, { actorId, proposalId: proposal?.proposal_id, at });
  const stored = trial && world.practical_role_trials?.trials?.[trial.trial_id];
  const requested = unique((proposal?.wish_basis?.root_outcome_ids ?? []).map(clean));
  const identity = trial && stored && trial.actor_id === actorId && trial.direction_id === proposal.direction_id
    && trial.axis === proposal.axis && definitions[trial.direction_id]?.axis === trial.axis
    && requested.length && JSON.stringify(requested) === JSON.stringify(unique(stored.frozen_wish_root_ids ?? []));
  const roots = identity ? trial.outcomes.filter(outcome => {
    const admission = stored.admitted_tasks?.find(item => `task:${item.task_id}` === outcome.root_outcome_id && item.attempt_id === outcome.attempt_id);
    const attempt = stored.attempts?.find(item => item.attempt_id === outcome.attempt_id);
    return outcome.step_role === 'primary' && outcome.outcome === 'completed' && outcome.variant_id === stored.variant_id
      && (!stored.review_from || Date.parse(outcome.at) > Date.parse(stored.review_from)) && validAt(outcome.at) && Date.parse(outcome.at) <= Date.parse(at)
      && admission?.step_role === 'primary' && admission.variant_id === stored.variant_id && attempt?.variant_id === stored.variant_id
      && `task:${attempt.task_id}` === outcome.root_outcome_id && admission.primary_activity_id === outcome.activity_id
      && attempt.activity_id === outcome.activity_id && Date.parse(outcome.at) >= Date.parse(admission.started_at);
  }) : [];
  return { trial, stored, identity: Boolean(identity), roots, primary_root_ids: unique(roots.map(item => item.root_outcome_id)),
    primary_days: unique(roots.map(item => day(item.at))), frozen_wish_root_ids: requested };
}
export function roleStagePreview(world, { proposal, at = world?.clock?.synced_at } = {}) {
  const actorId = proposal?.character_id ?? world?.protagonist?.character_id, directionId = proposal?.direction_id;
  const design = definitions[directionId], basis = actualBasis(world, proposal, at), prior = roleStageReadModel(world, { actorId, proposalId: proposal?.proposal_id });
  const barriers = [], barrier = (id, label) => barriers.push({ id, label });
  if (!validAt(at) || world?.clock?.mode !== 'real_time') barrier('real_time_required', '先连接现实时间与原有生活。');
  if (!person(world, actorId) || actorId !== world?.protagonist?.character_id) barrier('actor_unavailable', '这一阶段仅接入桌边持续个体。');
  if (!design || design.axis !== proposal?.axis) barrier('direction_unavailable', '这个方向尚未制作可采用的阶段。');
  if (proposal?.origin !== 'lived_wish' || proposal?.status !== 'prepared' || proposal?.user_choice !== 'try') barrier('saved_preparation_required', '先保存主人同意试做的原愿望。');
  if (!basis.identity) barrier('trial_basis_mismatch', '试做与原愿望的实际依据尚未一致。');
  if (basis.trial?.status !== 'review' || basis.trial?.review?.reason !== 'repeated_actual_success'
    || basis.primary_root_ids.length < 2 || basis.primary_days.length < 2) barrier('actual_two_day_success_required', '需要当前试做方式跨两个上海日实际完成两次主要活动。');
  if (basis.stored?.accepted_stage_id || prior) barrier('trial_already_consumed', '这份试做已经绑定阶段，旧结果不能重复采用。');
  if (currentStage(world, actorId, design?.axis)?.direction_id === directionId) barrier('direction_already_current', '这个方向已经是当前阶段，继续现有生活即可。');
  const before = roleStageAppearance(world, actorId), after = design ? roleStageAppearance(world, actorId, { direction_id: directionId }) : before;
  const current = roleStagesReadModel(world, { actorId }).current;
  const fingerprint = digest({ version: DESIGN_VERSION, actor_id: actorId, proposal_id: proposal?.proposal_id ?? null, direction_id: directionId ?? null,
    axis: proposal?.axis ?? null, current: AXES.map(axis => [axis, current[axis]?.stage_id ?? null]), trial_id: basis.trial?.trial_id ?? null,
    trial_status: basis.trial?.status ?? null, accepted_stage_id: basis.stored?.accepted_stage_id ?? null,
    variant: basis.trial?.variant_id ?? null, review_from: basis.stored?.review_from ?? null,
    roots: basis.roots.map(item => [item.root_outcome_id, item.at, item.activity_id]), frozen: basis.frozen_wish_root_ids });
  return { schema: ROLE_STAGE_PREVIEW_SCHEMA, proposal_id: proposal?.proposal_id ?? null, actor_id: actorId, direction_id: directionId ?? null,
    axis: design?.axis ?? proposal?.axis ?? null, eligible: barriers.length === 0, barriers, preview_fingerprint: fingerprint,
    current, stage: prior, appearance_before: before, appearance_preview: after,
    options: design ? [{ direction_id: directionId, axis: design.axis, label: design.label, summary: design.summary, appearance: after }] : [],
    life_changes: lifeChanges(design), basis: { kind: 'canonical_unique_task_results', trial_id: basis.trial?.trial_id ?? null,
      variant_id: basis.trial?.variant_id ?? null, primary_root_ids: basis.primary_root_ids, primary_days: basis.primary_days,
      frozen_wish_root_ids: basis.frozen_wish_root_ids }, reversible: true, changes_identity: false,
    physical_shell_changed: false, qualification_proven: false, preference_proven: false };
}
function applyAppearance(world, actorId, at) {
  const own = person(world, actorId), appearance = roleStageAppearance(world, actorId);
  if (appearance.form || appearance.vocation) own.appearance.role_stage = appearance;
  else delete own.appearance.role_stage;
  // Original palette, geometry, generation measurements and physical-shell
  // observations remain independent. Only this authored virtual layer changes.
  own.appearance.updated_at = at;
}
function note(world, archive, at, operation, stageId, eventId) {
  archive.history.push({ at, operation, stage_id: stageId, event_id: clean(eventId) });
  archive.history = archive.history.slice(-64); world.role_stages.revision++;
}
export function acceptRoleStage(world, { proposalId, actorId, directionId, wishBasis, previewFingerprint, at, eventId } = {}) {
  requireTime(world, at);
  const previous = versions(world, actorId).find(stage => stage.proposal_id === proposalId);
  if (previous) {
    if (previous.direction_id !== directionId || previous.actor_id !== actorId) fail('role_stage_identity_conflict', '这个阶段编号已经对应原来的个体与方向。');
    if (previous.status !== 'accepted' || currentStage(world, actorId, previous.axis)?.stage_id !== previous.stage_id) fail('role_stage_trial_consumed', '这份试做已经采用过，回退后不能重复使用旧结果。');
    return { stage_id: previous.stage_id, duplicate: true, stage: stageProjection(world, previous) };
  }
  const proposal = { proposal_id: proposalId, character_id: actorId, direction_id: directionId, axis: definitions[directionId]?.axis,
    origin: 'lived_wish', status: 'prepared', user_choice: 'try', wish_basis: wishBasis };
  const preview = roleStagePreview(world, { proposal, at });
  if (!preview.eligible) fail('role_stage_not_ready', preview.barriers[0]?.label ?? '先完成这份愿望的实际试做。');
  if (previewFingerprint !== preview.preview_fingerprint) fail('role_stage_preview_stale', '预览依据或当前阶段已经变化，请重新查看后再采用。');
  const trial = world.practical_role_trials.trials[preview.basis.trial_id];
  if (activeWorldTask(world, actorId)?.role_trial?.trial_id === trial.trial_id) fail('role_stage_trial_task_pending', '先等这份试做当前的实际任务结束。');
  world.role_stages ??= { schema: ROLE_STAGES_SCHEMA, revision: 0, actors: {} };
  const own = person(world, actorId);
  world.role_stages.actors[actorId] ??= { actor_id: actorId, baseline_appearance: structuredClone(own.appearance),
    axis_current: { form: null, vocation: null }, versions: [], history: [] };
  const archive = world.role_stages.actors[actorId];
  const stage = { schema: ROLE_STAGE_SCHEMA, stage_id: `role-stage:${digest({ actorId, proposalId, trialId: trial.trial_id }).slice(0, 24)}`,
    proposal_id: proposalId, trial_id: trial.trial_id, actor_id: actorId, direction_id: directionId, axis: definitions[directionId].axis,
    status: 'accepted', accepted_at: at, rolled_back_at: null, accept_event_id: clean(eventId), rollback_event_id: null,
    predecessor_stage_id: archive.axis_current[definitions[directionId].axis], primary_root_ids: [...preview.basis.primary_root_ids],
    primary_days: [...preview.basis.primary_days], frozen_wish_root_ids: [...preview.basis.frozen_wish_root_ids], design_version: DESIGN_VERSION };
  archive.versions.push(stage); archive.axis_current[stage.axis] = stage.stage_id;
  trial.accepted_stage_id = stage.stage_id; trial.accepted_at = at; trial.accept_event_id = clean(eventId);
  trial.revision++; trial.updated_at = at; world.practical_role_trials.revision++;
  const state = world.autonomy?.actors?.[actorId];
  if (state?.plan?.role_trial?.trial_id === trial.trial_id) { state.plan = null; state.next_decision_at = at; }
  applyAppearance(world, actorId, at); note(world, archive, at, 'accept', stage.stage_id, eventId);
  return { stage_id: stage.stage_id, duplicate: false, stage: stageProjection(world, stage) };
}
export function rollbackRoleStage(world, { stageId, at, eventId } = {}) {
  requireTime(world, at);
  const archive = Object.values(world?.role_stages?.actors ?? {}).find(item => item.versions?.some(stage => stage.stage_id === stageId));
  const stage = archive?.versions?.find(item => item.stage_id === stageId);
  if (!stage) fail('role_stage_not_found', '没有这份可回看的角色阶段。', 404);
  if (stage.status === 'rolled_back') return { stage_id: stageId, duplicate: true, stage: stageProjection(world, stage) };
  if (archive.axis_current[stage.axis] !== stageId) fail('role_stage_not_current', '只能回退这一轴的当前阶段，请先查看现有形象。');
  const predecessor = stage.predecessor_stage_id ? archive.versions.find(item => item.stage_id === stage.predecessor_stage_id
    && item.axis === stage.axis && item.status === 'accepted') : null;
  archive.axis_current[stage.axis] = predecessor?.stage_id ?? null; stage.status = 'rolled_back';
  stage.rolled_back_at = at; stage.rollback_event_id = clean(eventId);
  applyAppearance(world, stage.actor_id, at); note(world, archive, at, 'rollback', stageId, eventId);
  return { stage_id: stageId, duplicate: false, stage: stageProjection(world, stage), restored_stage_id: predecessor?.stage_id ?? null };
}

/** Authored role choice, not a measured emotional preference or a skill grant. */
export function roleStageLifeProfile(world, actorId, baseline) {
  const active = AXES.map(axis => currentStage(world, actorId, axis)).filter(Boolean);
  if (!active.length) return baseline;
  return { ...baseline, interests: unique([...baseline.interests, ...active.flatMap(stage => getRoleExperiencePackage(stage.direction_id)?.life.interests ?? definitions[stage.direction_id].interests)]),
    places: unique([...baseline.places, ...active.flatMap(stage => getRoleExperiencePackage(stage.direction_id)?.life.places ?? definitions[stage.direction_id].places)]) };
}
export function roleStageCandidates(world, state, at) {
  const minute = localWorldDate(at, 'Asia/Shanghai')?.minute_of_day;
  if (!world.living || !state || !validAt(at) || state.energy < .55 || state.appetite > .5 || minute < 360 || minute >= 1380
    || Object.values(world.practical_role_trials?.trials ?? {}).some(trial => trial.actor_id === state.actor_id && ['running', 'blocked'].includes(trial.status))) return [];
  const choices = [];
  for (const axis of AXES) {
    const stage = currentStage(world, state.actor_id, axis); if (!stage) continue;
    const packageValue = getRoleExperiencePackage(stage.direction_id);
    const baseDesign = definitions[stage.direction_id];
    const design = packageValue ? { ...baseDesign, interests: packageValue.life.interests, places: packageValue.life.places,
      activity: packageValue.life.activity || baseDesign.activity, topic: packageValue.life.interests[0] || baseDesign.topic,
      title: packageValue.life.actions[0] || baseDesign.title, label: packageValue.identity.label } : baseDesign;
    const goal = `role-stage:${stage.stage_id}:${design.activity}`;
    const objects = world.living.objects, inventory = world.living.inventories?.[state.actor_id]?.stock ?? {};
    const link = { stage_id: stage.stage_id, direction_id: stage.direction_id, axis: stage.axis, basis: 'rule_based_choice' };
    // Real trial products can already be in the bag when the stage is adopted.
    // Carry those to the common rack before making more; no product is gifted.
    if (stage.direction_id === 'workshop_maker' && (inventory.trays ?? 0) > 0) {
      const depositGoal = `role-stage:${stage.stage_id}:store-trays`;
      if (!(Date.parse(state.cooldowns?.[depositGoal] ?? '') > Date.parse(at))) {
        try { choices.push({ goal: depositGoal, title: '把已做好的托盘送回育苗架', reason: '托盘已经在随身袋里，先送到苗圃，让下一次育苗能真正取用。',
          score: 38, available: true, steps: depositSteps(world, state.actor_id, 'seedling-rack', 'trays'), development_topic: 'craft',
          discretionary_practice: true, role_stage: { ...link, package_id: packageValue?.package_id ?? null } }); }
        catch (error) { if (!error.code) throw error; }
      }
      continue;
    }
    if (Date.parse(state.cooldowns?.[goal] ?? '') > Date.parse(at)) continue;
    // Finite practice leaves food, fresh water and workshop parts for normal
    // needs. The original planner and task engine still verify every step.
    if (stage.direction_id === 'wetland_frog' && (!(objects['garden-bed']?.quantity > 0)
      || objects['garden-bed'].moisture < .32 || objects['garden-bed'].moisture > .72 || (objects['seedling-rack']?.stock.water ?? 0) < 6)) continue;
    if (stage.direction_id === 'workshop_maker' && ((objects['seedling-rack']?.stock.trays ?? 0) + (inventory.trays ?? 0) >= 2
      || (objects['parts-drawers']?.stock.wood ?? 0) < 3 || (objects['parts-drawers']?.stock.fasteners ?? 0) < 5)) continue;
    if (stage.direction_id === 'chef' && ((objects['shared-table']?.stock.rations ?? 0) >= 10 || (objects['trial-stove']?.stock.water ?? 0) < 3)) continue;
    try {
      const steps = design.activity === 'cook' ? cookAndStoreSteps(world, state.actor_id) : activitySteps(world, state.actor_id, design.activity);
      if (stage.direction_id === 'workshop_maker') {
        const location = objectId => world.map_catalog?.areas?.find(area => area.area_id === world.map_catalog.objects.find(object => object.object_id === objectId)?.area_id)?.location_id;
        const nursery = location('seedling-rack'), bench = location('repair-bench');
        if (!nursery || !bench || !findWorldPath(world, bench, nursery)) continue;
        steps.push({ kind: 'travel', location_id: nursery }, { kind: 'transfer', object_id: 'seedling-rack', resource: 'trays', count: 1, operation: 'store' });
      }
      choices.push({ goal, title: design.title, reason: `采用${design.label}方向后，留有余力时想把对应生活继续做实。`,
        score: 36, available: true, steps, development_topic: design.topic, discretionary_practice: true,
        role_stage: { ...link, package_id: packageValue?.package_id ?? null } });
    } catch (error) { if (!error.code) throw error; }
  }
  return choices;
}
