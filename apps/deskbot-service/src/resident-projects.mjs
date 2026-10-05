// Authored projects execute through the same finite inventories and real-time
// tasks as ordinary life. Text, plans and elapsed time are never completion proof.
export const RESIDENT_PROJECT_VERSION = 'morrowmere-resident-projects-v1';
const HOUR = 3_600_000;
const copy = value => structuredClone(value);
const clamp = value => Math.max(0, Math.min(1, value));
const owner = 'owner', helper = 'helper';
const DEFINITIONS = {
  'floating-seedbed': { owner_id: 'wetland-grower-001', name: '随水位起伏的小浮圃',
    stages: ['survey', 'plant', 'inspect', 'accept'], helpers: ['spare-mender-001'] },
  'small-water-pump': { owner_id: 'spare-mender-001', name: '旧件小水泵',
    stages: ['survey', 'assemble', 'install', 'trial', 'accept'], helpers: ['wetland-grower-001'] },
  'leaf-signature-soup': { owner_id: 'pot-cook-001', name: '可重复做出的叶芽汤',
    stages: ['ratio', 'cook', 'serve', 'taste', 'confirm'], helpers: ['wetland-grower-001', 'market-trader-001'] },
};
const input = (container, resource, count) => ({ container, resource, count });
const recipe = (activity_id, title, kind, target, seconds, project_id, project_stage, project_role, inputs = [], output = null, extra = {}) =>
  ({ activity_id, title, kind, target, seconds, project_id, project_stage, project_role, inputs, ...(output ? { output } : {}), ...extra });
export const PROJECT_ACTIVITIES = Object.freeze([
  recipe('seedbed-survey', '勘查小浮圃的水位与落点', 'care', 'floating-frame', 900, 'floating-seedbed', 'survey', owner),
  recipe('seedbed-plant', '搭起小浮圃并种下试苗', 'craft', 'floating-frame', 1200, 'floating-seedbed', 'plant', owner,
    [input('bag', 'wood', 1), input('bag', 'fasteners', 1), input('bag', 'seeds', 2), input('bag', 'water', 2)]),
  recipe('seedbed-inspect', '独立检查试苗的存活与浮框', 'care', 'floating-frame', 600, 'floating-seedbed', 'inspect', helper),
  recipe('seedbed-accept', '核对记录并验收小浮圃', 'care', 'floating-frame', 600, 'floating-seedbed', 'accept', owner),
  recipe('seedbed-care', '给小浮圃的试苗补水照料', 'care', 'floating-frame', 600, 'floating-seedbed', 'care', 'resident',
    [input('bag', 'water', 1)], null, { project_auxiliary: true }),
  recipe('harvest-float-bed', '收获小浮圃的苔芽', 'care', 'floating-frame', 900, 'floating-seedbed', 'harvest', 'resident', [], null, { project_auxiliary: true, project_functional: true }),
  recipe('sow-float-bed', '给小浮圃重新播种', 'care', 'floating-frame', 900, 'floating-seedbed', 'sow', 'resident',
    [input('bag', 'seeds', 2), input('bag', 'water', 2)], null, { project_auxiliary: true, project_functional: true }),
  recipe('pump-survey', '清点小泵的旧件与接口', 'craft', 'repair-bench', 600, 'small-water-pump', 'survey', owner),
  recipe('pump-assemble', '组装旧件小水泵', 'craft', 'repair-bench', 1800, 'small-water-pump', 'assemble', owner,
    [input('bag', 'wood', 1), input('bag', 'fasteners', 2)], { container: 'bag', resource: 'pump_kit', count: 1 }),
  recipe('pump-install', '把小泵带到水岸安装', 'craft', 'floating-frame', 900, 'small-water-pump', 'install', owner,
    [input('bag', 'pump_kit', 1)]),
  recipe('pump-trial', '替扣扣实际试用小泵取水', 'care', 'floating-frame', 600, 'small-water-pump', 'trial', helper,
    [input('floating-frame', 'raw_water', 2)], { container: 'bag', resource: 'water', count: 2 }),
  recipe('pump-accept', '复查试用记录并验收小泵', 'craft', 'floating-frame', 600, 'small-water-pump', 'accept', owner),
  recipe('pump-water', '用小泵汲水净滤', 'care', 'floating-frame', 300, 'small-water-pump', 'use', 'resident',
    [input('floating-frame', 'raw_water', 4)], { container: 'bag', resource: 'water', count: 4 }, { project_auxiliary: true, project_functional: true }),
  recipe('repair-pump', '维护旧件小水泵', 'craft', 'floating-frame', 900, 'small-water-pump', 'repair', 'resident',
    [input('bag', 'fasteners', 1)], null, { project_auxiliary: true }),
  recipe('soup-record-ratio', '记下叶芽汤的试做配比', 'care', 'trial-stove', 600, 'leaf-signature-soup', 'ratio', owner),
  recipe('soup-cook-trial', '按配比煮一批叶芽试汤', 'craft', 'trial-stove', 1200, 'leaf-signature-soup', 'cook', owner,
    [input('bag', 'moss', 2), input('trial-stove', 'water', 1)], { container: 'bag', resource: 'trial_soup', count: 2 }),
  recipe('soup-serve-trial', '把试汤带到长桌分成两碗', 'care', 'shared-table', 300, 'leaf-signature-soup', 'serve', owner,
    [input('bag', 'trial_soup', 2)], { container: 'shared-table', resource: 'trial_soup', count: 2 }),
  recipe('soup-taste-trial', '喝一碗试汤并留下实际反馈', 'care', 'shared-table', 600, 'leaf-signature-soup', 'taste', helper,
    [input('shared-table', 'trial_soup', 1)]),
  recipe('soup-confirm-recipe', '隔时重做并保存叶芽汤配方', 'craft', 'trial-stove', 1200, 'leaf-signature-soup', 'confirm', owner,
    [input('bag', 'moss', 2), input('trial-stove', 'water', 1)], { container: 'bag', resource: 'rations', count: 3 }),
  recipe('cook-leaf-soup', '按保存的配方做叶芽汤', 'craft', 'trial-stove', 1200, 'leaf-signature-soup', 'repeat', 'resident',
    [input('bag', 'moss', 2), input('trial-stove', 'water', 1)], { container: 'bag', resource: 'rations', count: 3 }, { project_auxiliary: true, project_functional: true }),
]);
const project = (world, id) => world.resident_projects?.projects?.[id];
const resident = (world, id) => world.npcs?.find(n => n.npc_id === id) ?? (world.protagonist?.character_id === id ? world.protagonist : null);
const assets = world => world.living?.objects?.['floating-frame']?.project_assets;
const seedbed = world => assets(world)?.floating_seedbed;
const pump = world => assets(world)?.small_water_pump;
const stove = world => world.living?.objects?.['trial-stove'];
const table = world => world.living?.objects?.['shared-table'];
const cookedBatch = world => stove(world)?.project_batches?.['leaf-signature-soup'];
const servedBatch = world => table(world)?.project_batches?.['leaf-signature-soup'];
const milliseconds = at => Date.parse(at ?? '');
const nextAt = (at, hours) => new Date(milliseconds(at) + hours * HOUR).toISOString();
const registered = (world, task) => world.tasks?.some(t => t === task);
const isProjection = (world, task) => task.project_projection === true && !world.tasks?.some(t => t.task_id === task.task_id);
const cropGood = world => seedbed(world)?.quantity > 0 && seedbed(world)?.health >= .6;
const safeWater = world => {
  const frame = world.living?.objects?.['floating-frame'];
  return frame?.water_level >= .15 && frame.water_level <= .88 && frame.condition >= .4;
};
function targetLocation(world, target) {
  const definition = world.map_catalog?.objects?.find(o => o.object_id === target);
  return world.map_catalog?.areas?.find(a => a.area_id === definition?.area_id)?.location_id ?? null;
}
function bump(world) { world.resident_projects.revision += 1; }
function reflect(world, p) {
  const npc = resident(world, p.owner_id);
  if (npc?.project?.project_id === p.project_id) npc.project = { ...npc.project, status: p.status,
    progress: { stage_id: p.stage_id, attempt: p.attempt, ready_at: p.ready_at, completed_at: p.completed_at, last_outcome: copy(p.last_outcome) } };
}
export function installResidentProjects(world, at) {
  if (world.resident_projects?.version === RESIDENT_PROJECT_VERSION || !world.resident_life || !world.living || world.clock?.mode !== 'real_time') return false;
  if (!['floating-frame', 'repair-bench', 'trial-stove', 'shared-table'].every(id => world.living.objects[id]) ||
    !Object.values(DEFINITIONS).every(d => resident(world, d.owner_id) && d.helpers.every(id => resident(world, id)))) return false;
  const projects = {};
  for (const [project_id, d] of Object.entries(DEFINITIONS)) {
    const authored = resident(world, d.owner_id)?.project;
    projects[project_id] = { project_id, owner_id: d.owner_id, name: d.name, goal: authored?.goal ?? d.name,
      status: 'active', attempt: 1, stage_id: d.stages[0], stage_started_at: at, ready_at: null, completed_at: null,
      last_outcome: null, retry_count: 0, evidence: [], history: [], scheduling: {} };
  }
  world.resident_projects = { schema: 'deskbot.resident-projects.v1', version: RESIDENT_PROJECT_VERSION, installed_at: at,
    revision: 0, projects, migration: { additive: true, existing_tasks_and_resources_preserved: true, historical_completion_created: false } };
  // This is an empty inventory slot, not an installation gift or trial meal.
  table(world).stock.trial_soup ??= 0;
  for (const p of Object.values(projects)) reflect(world, p);
  return true;
}
function waitReason(at, ready, message) {
  return milliseconds(at) < milliseconds(ready) ? `${message}，最早 ${ready} 可以开始。` : null;
}
// Only readiness and authorship are checked here. Normal living eligibility also
// verifies actual location, stock, target contention, output space and recovery.
export function projectActivityReason(world, r, actorId, at, { task = null, completion = false } = {}) {
  if (!r.project_id) return null;
  const p = project(world, r.project_id), d = DEFINITIONS[r.project_id];
  if (!p || !d || !resident(world, actorId)) return '这个居民项目还没有正式安装。';
  if (r.project_role === owner && actorId !== d.owner_id) return '这一步由项目本人负责。';
  if (r.project_role === helper && !d.helpers.includes(actorId)) return '这一步需要约定的另一位居民亲自完成。';
  if (r.activity_id === 'seedbed-care' && p.status !== 'completed' && actorId !== p.owner_id) return '试种期间由苔团负责照料自己的试苗。';
  if (r.activity_id === 'repair-pump' && p.status !== 'completed' && actorId !== p.owner_id) return '验收前由扣扣负责维护自己的试机。';
  if (r.project_functional && p.status !== 'completed') return '项目尚未实际验收，成果暂时不能投入日常使用。';
  if (!r.project_auxiliary && (p.status === 'completed' || p.stage_id !== r.project_stage)) return '当前项目阶段不接受这项活动。';
  if (completion && (!task || (!registered(world, task) && !isProjection(world, task)) || task.project_id !== p.project_id ||
    task.project_stage_id !== r.project_stage || (!r.project_auxiliary && task.project_attempt !== p.attempt) || task.project_version !== RESIDENT_PROJECT_VERSION)) return '项目阶段或执行记录已经变化，不能把这次活动当作项目成果。';
  if (r.target === 'floating-frame' && !safeWater(world) && r.activity_id !== 'repair-pump') return '水位或浮框状态不适合这一步，先等水位恢复或修缮浮框。';
  if (['pump-survey', 'pump-assemble', 'soup-cook-trial', 'soup-confirm-recipe', 'cook-leaf-soup'].includes(r.activity_id) && world.living.objects[r.target].condition < .4) return '工作设施已经损坏，需要先修缮。';
  if (r.activity_id === 'seedbed-plant' && !p.evidence.some(e => e.activity_id === 'seedbed-survey')) return '需要先有实际完成的水位勘查记录。';
  if (['seedbed-inspect', 'seedbed-accept'].includes(r.activity_id)) {
    if (!cropGood(world)) return '试苗的存活情况不足，需要继续照料，枯死后重新补种。';
    const waiting = waitReason(at, nextAt(seedbed(world).installed_at, 12), '试苗还需要经历至少 12 小时的真实环境');
    if (waiting) return waiting;
    if (r.activity_id === 'seedbed-accept' && !p.evidence.some(e => e.activity_id === 'seedbed-inspect' && e.at >= seedbed(world).installed_at)) return '还缺另一位居民亲自检查试苗的记录。';
  }
  if (r.activity_id === 'seedbed-care' && (!seedbed(world)?.quantity || seedbed(world).health <= 0)) return '浮圃没有活苗，需要先实际种下试苗。';
  if (r.activity_id === 'harvest-float-bed') {
    const bed = seedbed(world);
    if (!bed?.quantity || bed.health < .35 || bed.growth < .85) return '浮圃的苔芽尚未成熟，或苗况不足以收获。';
    const count = Math.max(1, Math.floor(bed.quantity * bed.health)), bag = world.living.inventories[actorId];
    const held = (world.tasks ?? []).flatMap(t => t.reservation?.status === 'held' ? t.reservation.inputs : []).filter(i => i.container === `bag:${actorId}` && i.resource === 'moss').reduce((a, i) => a + i.count, 0);
    if ((bag?.stock?.moss ?? 0) + held + count > (bag?.capacity ?? 24)) return '随身袋装不下浮圃的这次收获。';
  }
  if (r.activity_id === 'sow-float-bed' && seedbed(world)?.quantity > 0 && seedbed(world).health > .08) return '浮圃里还有活苗，先照料或收获。';
  if (r.activity_id === 'pump-install' && !p.evidence.some(e => e.activity_id === 'pump-assemble')) return '还没有实际组装完成的小泵。';
  if (['pump-trial', 'pump-accept', 'pump-water', 'repair-pump'].includes(r.activity_id) && !pump(world)) return '水岸还没有安装小泵。';
  if (['pump-trial', 'pump-accept', 'pump-water'].includes(r.activity_id) && pump(world).condition < .4) return '小泵已经损坏，需要实际维护。';
  if (r.activity_id === 'repair-pump' && pump(world).condition > .9) return '小泵状况良好，暂时无需维护。';
  if (r.activity_id === 'pump-accept') {
    const waiting = waitReason(at, nextAt(pump(world).installed_at, 6), '安装后需要留出至少 6 小时观察');
    if (waiting) return waiting;
    if (!p.evidence.some(e => e.activity_id === 'pump-trial' && e.actor_id !== p.owner_id && e.at >= pump(world).installed_at)) return '还缺苔团实际取到清水的试用记录。';
  }
  if (r.activity_id === 'soup-cook-trial' && !stove(world).project_drafts?.['leaf-signature-soup']) return '还没有实际记录配比。';
  if (r.activity_id === 'soup-serve-trial') {
    const batch = cookedBatch(world);
    if (!batch || batch.status !== 'carried' || batch.carrier_id !== actorId || milliseconds(at) >= milliseconds(batch.expires_at)) return '这批试汤已过期或没有由本人带来，需要重新试做。';
    if (completion && task.project_batch_id !== batch.batch_id) return '这次携带的试汤批次已经变化。';
  }
  if (r.activity_id === 'soup-taste-trial') {
    const batch = servedBatch(world);
    if (!batch || batch.status === 'expired' || milliseconds(at) >= milliseconds(batch.expires_at) || batch.remaining_portions < 1) return '长桌没有这批新鲜试汤，需要重新试做并送来。';
    if (batch.feedback.some(f => f.actor_id === actorId)) return '你已经尝过这一批，另一份需要另一位居民亲自尝。';
    if (completion && task.project_batch_id !== batch.batch_id) return '这次试吃的批次已经变化，不能混用反馈。';
  }
  if (r.activity_id === 'soup-confirm-recipe') {
    const batch = servedBatch(world);
    if (!batch || new Set(batch.feedback.filter(f => f.verdict === 'acceptable').map(f => f.actor_id)).size < 2) return '还缺两位不同居民完成试吃后的可用反馈。';
    const waiting = waitReason(at, nextAt(batch.prepared_at, 6), '第一批试汤后需要隔至少 6 小时再实际重做');
    if (waiting) return waiting;
    if (stove(world).condition < .55) return '灶况还不稳定，需要先修缮再复做确认。';
  }
  if (r.activity_id === 'cook-leaf-soup' && !stove(world).recipe_book?.['leaf-signature-soup']) return '灶边还没有正式验收保存的叶芽汤配方。';
  return null;
}
export function projectActivityBinding(world, r) {
  if (!r.project_id) return {};
  const p = project(world, r.project_id);
  const batch = r.activity_id === 'soup-serve-trial' ? cookedBatch(world) : r.activity_id === 'soup-taste-trial' ? servedBatch(world) : null;
  return { project_id: p.project_id, project_stage_id: r.project_stage, project_attempt: p.attempt, project_version: RESIDENT_PROJECT_VERSION,
    ...(batch ? { project_batch_id: batch.batch_id } : {}) };
}
export function projectActivityVisible(world, r, actorId) {
  if (!r.project_id) return true;
  const p = project(world, r.project_id), d = DEFINITIONS[r.project_id];
  if (!p || !resident(world, actorId)) return false;
  if (r.project_role === owner) return actorId === p.owner_id;
  if (r.project_role === helper) return d.helpers.includes(actorId);
  return p.status === 'completed' || actorId === p.owner_id;
}
function assetSlot(world, target) { return world.living.objects[target].project_assets ??= {}; }
function actorBag(world, id) { return world.living.inventories[id] ??= { stock: {}, capacity: 24 }; }
// Effects run only after all normal reservation and project checks have passed.
// Internal planner projections may model these effects on a clone, never settle.
export function applyProjectActivityEffect(world, r, task, at) {
  if (!r.project_id) return null;
  const p = project(world, r.project_id), stock_changes = [], details = {};
  switch (r.activity_id) {
    case 'seedbed-survey': Object.assign(details, { water_level: world.living.objects['floating-frame'].water_level, condition: world.living.objects['floating-frame'].condition }); break;
    case 'seedbed-plant':
      assetSlot(world, 'floating-frame').floating_seedbed = { project_id: p.project_id, status: 'prototype', installed_at: at, accepted_at: null,
        quantity: 6, health: .9, moisture: .58, growth: .04, last_cared_at: at, last_inspected_at: null, harvest_count: seedbed(world)?.harvest_count ?? 0 };
      details.planted_quantity = 6; break;
    case 'seedbed-care': {
      const bed = seedbed(world); bed.moisture = clamp(bed.moisture + .24); bed.health = clamp(bed.health + .06); bed.last_cared_at = at;
      Object.assign(details, { health: bed.health, moisture: bed.moisture }); break;
    }
    case 'seedbed-inspect': seedbed(world).last_inspected_at = at; Object.assign(details, { quantity: seedbed(world).quantity, health: seedbed(world).health, observed_hours: (milliseconds(at) - milliseconds(seedbed(world).installed_at)) / HOUR }); break;
    case 'seedbed-accept': seedbed(world).accepted_at = at; seedbed(world).status = seedbed(world).growth >= .85 ? 'ready' : 'growing'; details.asset = 'floating_seedbed'; break;
    case 'harvest-float-bed': {
      const bed = seedbed(world), count = Math.max(1, Math.floor(bed.quantity * bed.health)), bag = actorBag(world, task.actor_id);
      bag.stock.moss = (bag.stock.moss ?? 0) + count;
      stock_changes.push({ container: `bag:${task.actor_id}`, resource: 'moss', count });
      Object.assign(bed, { quantity: 0, growth: 0, status: 'empty', harvest_count: (bed.harvest_count ?? 0) + 1 }); details.harvested = count; break;
    }
    case 'sow-float-bed': Object.assign(seedbed(world), { quantity: 6, health: .9, moisture: .58, growth: .04, status: 'growing', last_cared_at: at }); details.planted_quantity = 6; break;
    case 'pump-survey': details.bench_condition = world.living.objects['repair-bench'].condition; break;
    case 'pump-assemble': assetSlot(world, 'repair-bench').small_water_pump = { project_id: p.project_id, status: 'assembled', assembled_at: at, carrier_id: task.actor_id }; details.asset = 'pump_kit'; break;
    case 'pump-install':
      assetSlot(world, 'floating-frame').small_water_pump = { project_id: p.project_id, status: 'installed_trial', installed_at: at, accepted_at: null, condition: .92, last_used_at: null, use_count: 0 };
      if (world.living.objects['repair-bench'].project_assets?.small_water_pump) world.living.objects['repair-bench'].project_assets.small_water_pump.status = 'moved';
      details.asset = 'small_water_pump'; break;
    case 'pump-trial': case 'pump-water': pump(world).last_used_at = at; pump(world).use_count += 1; pump(world).condition = clamp(pump(world).condition - .04); Object.assign(details, { actual_clean_water: r.output.count, pump_condition: pump(world).condition }); break;
    case 'pump-accept': pump(world).accepted_at = at; pump(world).status = 'ready'; details.asset = 'small_water_pump'; break;
    case 'repair-pump': pump(world).condition = clamp(pump(world).condition + .35); pump(world).status = pump(world).accepted_at ? 'ready' : 'installed_trial'; details.pump_condition = pump(world).condition; break;
    case 'soup-record-ratio':
      (stove(world).project_drafts ??= {})['leaf-signature-soup'] = { project_id: p.project_id, recorded_at: at, inputs: [{ resource: 'moss', count: 2 }, { resource: 'water', count: 1 }], yield_count: 3 };
      details.ratio = '鲜苔芽 2 份 + 清水 1 份'; break;
    case 'soup-cook-trial': {
      const old = cookedBatch(world);
      if (old?.status === 'expired' && old.carrier_id === task.actor_id) {
        const bag = actorBag(world, task.actor_id), discarded = Math.min(bag.stock.trial_soup ?? 0, old.remaining_portions);
        bag.stock.trial_soup = (bag.stock.trial_soup ?? 0) - discarded; details.discarded_expired_portions = discarded;
      }
      (stove(world).project_batches ??= {})['leaf-signature-soup'] = { project_id: p.project_id, batch_id: `leaf-soup:${task.task_id}`, status: 'carried', prepared_at: at, served_at: null,
        expires_at: nextAt(at, 24), carrier_id: task.actor_id, quality: stove(world).condition, feedback: [], remaining_portions: 2 };
      Object.assign(details, { batch_id: cookedBatch(world).batch_id, quality: cookedBatch(world).quality }); break;
    }
    case 'soup-serve-trial': {
      const old = servedBatch(world);
      if (old?.status === 'expired') {
        const discarded = Math.min(table(world).stock.trial_soup ?? 0, old.remaining_portions);
        table(world).stock.trial_soup -= discarded; details.discarded_expired_portions = discarded;
      }
      const batch = cookedBatch(world);
      (table(world).project_batches ??= {})['leaf-signature-soup'] = { ...copy(batch), status: 'awaiting_taste', served_at: at };
      batch.status = 'served'; batch.remaining_portions = 0; details.batch_id = batch.batch_id; break;
    }
    case 'soup-taste-trial': {
      const batch = servedBatch(world), verdict = batch.quality >= .55 ? 'acceptable' : 'needs_adjustment';
      const feedback = { actor_id: task.actor_id, at, task_id: task.task_id, batch_id: batch.batch_id, verdict,
        text: verdict === 'acceptable' ? '亲自喝完这一碗，配比与成汤状态稳定，可以隔时复做验证。' : '亲自喝完这一碗，灶况不稳定，需要调整后重新试做。' };
      batch.feedback.push(feedback); batch.remaining_portions -= 1; if (batch.remaining_portions === 0) batch.status = 'tasted';
      const life = world.autonomy?.actors?.[task.actor_id]; if (life) life.appetite = clamp(life.appetite - .2);
      details.feedback = copy(feedback); break;
    }
    case 'soup-confirm-recipe':
      (stove(world).recipe_book ??= {})['leaf-signature-soup'] = { project_id: p.project_id, name: '叶芽汤', accepted_at: at,
        inputs: [{ resource: 'moss', count: 2 }, { resource: 'water', count: 1 }], yield_count: 3,
        feedback: copy(servedBatch(world).feedback), repeated_by_task_id: task.task_id };
      details.recipe_id = 'leaf-signature-soup'; break;
    case 'cook-leaf-soup': details.recipe_id = 'leaf-signature-soup'; break;
  }
  return { project_id: p.project_id, stage_id: r.project_stage, attempt: task.project_attempt,
    version: RESIDENT_PROJECT_VERSION, actor_id: task.actor_id, activity_id: r.activity_id, at, details, stock_changes };
}
function currentRecipe(p) { return PROJECT_ACTIVITIES.find(r => r.project_id === p.project_id && !r.project_auxiliary && r.project_stage === p.stage_id); }
function readyAt(world, p) {
  if (p.project_id === 'floating-seedbed' && ['inspect', 'accept'].includes(p.stage_id) && seedbed(world)) return nextAt(seedbed(world).installed_at, 12);
  if (p.project_id === 'small-water-pump' && p.stage_id === 'accept' && pump(world)) return nextAt(pump(world).installed_at, 6);
  if (p.project_id === 'leaf-signature-soup' && p.stage_id === 'confirm' && servedBatch(world)) return nextAt(servedBatch(world).prepared_at, 6);
  return null;
}
function record(world, p, entry) {
  entry.outcome ??= entry.kind === 'cancelled' ? 'cancelled' : entry.success ? 'completed' : 'failed';
  entry.location_id ??= resident(world, entry.actor_id)?.location_id ?? null;
  p.last_outcome = entry; p.history.push(copy(entry)); p.history = p.history.slice(-120); bump(world); reflect(world, p);
}
function nextStage(world, p, at) {
  const stages = DEFINITIONS[p.project_id].stages, index = stages.indexOf(p.stage_id);
  if (index === stages.length - 1) { p.status = 'completed'; p.completed_at = at; p.ready_at = null; }
  else { p.stage_id = stages[index + 1]; p.stage_started_at = at; p.status = 'active'; p.ready_at = readyAt(world, p); }
}
// Called at the terminal task hook, before task retention can remove the proof.
export function settleProjectTask(world, task, at) {
  if (!task.project_id || !['completed', 'failed', 'cancelled'].includes(task.status) || task.project_settled_at || !registered(world, task)) return false;
  const p = project(world, task.project_id), r = PROJECT_ACTIVITIES.find(r => r.activity_id === task.activity_id);
  if (!p || !r || r.project_id !== p.project_id || task.project_version !== RESIDENT_PROJECT_VERSION || p.history.some(h => h.task_id === task.task_id) || p.evidence.some(e => e.task_id === task.task_id)) return false;
  task.project_settled_at = at;
  const current = task.project_attempt === p.attempt && (r.project_auxiliary || p.stage_id === r.project_stage);
  const result = task.completion?.result?.project_result;
  const success = task.status === 'completed' && (current || r.project_auxiliary) && result?.version === RESIDENT_PROJECT_VERSION && result.project_id === p.project_id &&
    result.stage_id === task.project_stage_id && result.attempt === task.project_attempt && result.actor_id === task.actor_id && result.activity_id === task.activity_id;
  const stage = task.project_stage_id, eventAt = result?.at ?? task.completion?.due_at ?? task.finished_at ?? at;
  if (success) {
    p.evidence.push({ at: eventAt, task_id: task.task_id, activity_id: task.activity_id, actor_id: task.actor_id, stage_id: stage,
      attempt: task.project_attempt, text: `${resident(world, task.actor_id)?.display_name ?? '居民'}实际完成了${r.title}。`, details: copy(result.details) });
    if (!r.project_auxiliary) {
      if (r.activity_id === 'soup-taste-trial') {
        const batch = servedBatch(world);
        if (batch.feedback.length >= 2) {
          if (batch.feedback.every(f => f.verdict === 'acceptable')) nextStage(world, p, eventAt);
          else { batch.status = 'expired'; p.stage_id = 'cook'; p.status = 'setback'; p.retry_count += 1; p.ready_at = null; }
        } else p.status = 'active';
      } else nextStage(world, p, eventAt);
    }
    if (!r.project_auxiliary) p.attempt += 1;
    record(world, p, { at: eventAt, text: p.status === 'completed' && !r.project_auxiliary ? `${p.name}已通过实际验收，成果可以继续使用。` : p.status === 'setback' ? '试吃记录说明灶况不稳定，真实消耗的材料与反馈保留，需要调整后重做。' : `${r.title}完成了。`,
      success: true, kind: r.project_auxiliary ? 'maintenance' : p.status === 'completed' ? 'project_completed' : p.status === 'setback' ? 'setback' : 'stage_completed',
      task_id: task.task_id, activity_id: task.activity_id, actor_id: task.actor_id, stage_id: stage, attempt: task.project_attempt, outcome: task.status, location_id: task.location_id });
  } else {
    if (!r.project_auxiliary && current) { p.status = 'setback'; p.attempt += 1; }
    p.retry_count += 1;
    if (current && !r.project_auxiliary && p.project_id === 'floating-seedbed' && ['inspect', 'accept'].includes(p.stage_id) && seedbed(world)?.quantity === 0) { p.stage_id = 'plant'; p.ready_at = null; }
    record(world, p, { at: eventAt, text: `${r.title}没能完成，既有阶段记录保留；预留材料按事务规则归还。`, success: false,
      kind: task.status === 'cancelled' ? 'cancelled' : 'setback', reason: task.failure_reason ?? (task.status === 'cancelled' ? '居民取消了这次安排。' : '项目完成证据不一致。'),
      task_id: task.task_id, activity_id: task.activity_id, actor_id: task.actor_id, stage_id: stage, attempt: task.project_attempt, outcome: task.status, location_id: task.location_id });
  }
  return true;
}
export function settleResidentProjects(world, at) {
  if (!world.resident_projects) return false;
  let changed = false;
  for (const task of world.tasks ?? []) if (settleProjectTask(world, task, at)) changed = true;
  const grower = project(world, 'floating-seedbed');
  if (grower && grower.status !== 'completed' && ['inspect', 'accept'].includes(grower.stage_id) && seedbed(world)?.status === 'dead') {
    grower.status = 'setback'; grower.stage_id = 'plant'; grower.ready_at = null; grower.retry_count += 1; grower.attempt += 1;
    record(world, grower, { at, text: '试苗在实际环境里枯死了，已用材料与检查记录保留，下一次必须重新备料补种。', success: false, kind: 'setback', reason: '浮圃试苗已经死亡。', task_id: null, actor_id: grower.owner_id, stage_id: 'plant', attempt: grower.attempt - 1 });
    changed = true;
  }
  const p = project(world, 'leaf-signature-soup');
  if (p && p.status !== 'completed' && ['serve', 'taste'].includes(p.stage_id)) {
    const batch = p.stage_id === 'serve' ? cookedBatch(world) : servedBatch(world);
    if (batch && batch.status !== 'expired' && milliseconds(at) >= milliseconds(batch.expires_at)) {
      batch.status = 'expired'; p.status = 'setback'; p.stage_id = 'cook'; p.ready_at = null; p.retry_count += 1; p.attempt += 1;
      record(world, p, { at, text: '这批试汤超过 24 小时还没有完成试吃，保留消耗与已有反馈，下一批需要重新做并带来。', success: false, kind: 'setback', reason: '试汤批次过期。', task_id: null, activity_id: null, actor_id: p.owner_id, stage_id: 'cook', attempt: p.attempt - 1 });
      changed = true;
    }
  }
  return changed;
}
export function projectCandidates(world, actorId, at) {
  if (!world.resident_projects) return [];
  const result = [];
  for (const p of Object.values(world.resident_projects.projects)) {
    if (p.status === 'completed') {
      if (actorId !== p.owner_id) continue;
      let r = null;
      if (p.project_id === 'floating-seedbed') {
        const bed = seedbed(world);
        if (bed && (!bed.quantity || bed.health <= .08)) r = PROJECT_ACTIVITIES.find(a => a.activity_id === 'sow-float-bed');
        else if (bed?.growth >= .85 && bed.health >= .35) r = PROJECT_ACTIVITIES.find(a => a.activity_id === 'harvest-float-bed');
        else if (bed?.quantity > 0 && (bed.moisture < .4 || bed.health < .65)) r = PROJECT_ACTIVITIES.find(a => a.activity_id === 'seedbed-care');
      } else if (p.project_id === 'small-water-pump' && pump(world)?.condition < .55) r = PROJECT_ACTIVITIES.find(a => a.activity_id === 'repair-pump');
      if (r) {
        const blocked_reason = projectActivityReason(world, r, actorId, at);
        result.push({ goal: `project:${p.project_id}:${r.project_stage}`, title: r.title, reason: '验收后的成果也需要实际维护和使用，先处理眼前这一项。', score: 42,
          activity_id: r.activity_id, project_id: p.project_id, project_stage_id: r.project_stage, available: !blocked_reason, blocked_reason });
      }
      continue;
    }
    const r = currentRecipe(p); if (!r) continue;
    const d = DEFINITIONS[p.project_id];
    if (p.project_id === 'floating-seedbed' && actorId === p.owner_id && seedbed(world)?.quantity > 0 && (seedbed(world).moisture < .4 || seedbed(world).health < .65)) {
      const care = PROJECT_ACTIVITIES.find(a => a.activity_id === 'seedbed-care'), blocked_reason = projectActivityReason(world, care, actorId, at);
      result.push({ goal: `project:${p.project_id}:care`, title: care.title, reason: '继续验收之前，先照料已经实际种下的试苗。', score: 44,
        activity_id: care.activity_id, project_id: p.project_id, project_stage_id: care.project_stage, available: !blocked_reason, blocked_reason });
    }
    if (p.project_id === 'small-water-pump' && actorId === p.owner_id && pump(world)?.condition < .55) {
      const maintenance = PROJECT_ACTIVITIES.find(a => a.activity_id === 'repair-pump'), blocked_reason = projectActivityReason(world, maintenance, actorId, at);
      result.push({ goal: `project:${p.project_id}:repair`, title: maintenance.title, reason: '已经安装的试机需要维护，修好后继续原来的验收阶段。', score: 44,
        activity_id: maintenance.activity_id, project_id: p.project_id, project_stage_id: maintenance.project_stage, available: !blocked_reason, blocked_reason });
    }
    if ((r.project_role === owner && actorId !== p.owner_id) || (r.project_role === helper && !d.helpers.includes(actorId))) {
      continue;
    }
    const blocked_reason = projectActivityReason(world, r, actorId, at);
    result.push({ goal: `project:${p.project_id}:${p.stage_id}`, title: r.title, reason: r.project_role === helper ? '有人需要另一位居民亲自完成独立试用或检查，记录真实结果。' : '接着做自己的长期事务，先落实眼前这一步。',
      score: r.project_role === helper ? 46 : 42, activity_id: r.activity_id, project_id: p.project_id, project_stage_id: p.stage_id, available: !blocked_reason, blocked_reason, ready_at: readyAt(world, p) });
  }
  return result;
}
export function updateProjectScheduling(world, actorId, at, choices) {
  if (!world.resident_projects) return false;
  let changed = false;
  for (const p of Object.values(world.resident_projects.projects)) {
    const choice = choices.find(c => c.project_id === p.project_id);
    if (!choice) { if (p.scheduling?.[actorId]) { delete p.scheduling[actorId]; changed = true; } continue; }
    const scheduling = { actor_id: actorId, stage_id: choice.project_stage_id ?? p.stage_id, activity_id: choice.activity_id,
      available: choice.available, blocked_reason: choice.blocked_reason ?? null, checked_at: at };
    if (JSON.stringify(p.scheduling?.[actorId]) !== JSON.stringify(scheduling)) { (p.scheduling ??= {})[actorId] = scheduling; changed = true; }
  }
  if (changed) bump(world);
  return changed;
}
export function projectReadModel(world, at = world.clock?.synced_at) {
  if (!world.resident_projects) return null;
  const state = world.resident_projects;
  return { schema: state.schema, version: state.version, installed_at: state.installed_at, revision: state.revision,
    projects: Object.values(state.projects).map(p => {
      const r = currentRecipe(p), eligibleActors = r?.project_role === helper ? DEFINITIONS[p.project_id].helpers.filter(id => r.activity_id !== 'soup-taste-trial' || !servedBatch(world)?.feedback?.some(f => f.actor_id === id)) : [p.owner_id];
      const schedule = Object.values(p.scheduling ?? {}).filter(s => s.stage_id === p.stage_id && eligibleActors.includes(s.actor_id));
      const reason = r ? projectActivityReason(world, r, r.project_role === owner ? p.owner_id : DEFINITIONS[p.project_id].helpers.find(id => !servedBatch(world)?.feedback?.some(f => f.actor_id === id)) ?? DEFINITIONS[p.project_id].helpers[0], at) : null;
      return { ...copy(p), actor_id: p.owner_id, stage_title: p.status === 'completed' ? '已实际验收' : r?.title ?? p.stage_id,
        target_object_id: r?.target ?? null, location_id: r ? targetLocation(world, r.target) : null, ready_at: p.status === 'completed' ? null : readyAt(world, p),
        blocked_reason: p.status === 'completed' ? null : reason ?? (schedule.some(s => s.available) ? null : schedule.find(s => !s.available)?.blocked_reason ?? null),
        progress: { completed_stages: [...new Set(p.evidence.filter(e => !PROJECT_ACTIVITIES.find(a => a.activity_id === e.activity_id)?.project_auxiliary).map(e => e.stage_id))], total_stages: DEFINITIONS[p.project_id].stages.length } };
    }) };
}
export function advanceProjectAssets(world, start, end, { daylight, rain, evaporation }) {
  const bed = seedbed(world);
  if (bed) {
    const hours = Math.max(0, end - Math.max(start, milliseconds(bed.installed_at))) / HOUR;
    if (bed.quantity > 0) {
      bed.moisture = clamp(bed.moisture + hours * (rain * 1.2 - evaporation * .6 + (.62 - bed.moisture) * .05));
      const stressed = !safeWater(world) || bed.moisture < .18 || bed.moisture > .91;
      bed.health = clamp(bed.health + hours * (stressed ? -.05 : .002));
      bed.growth = clamp(bed.growth + hours * (daylight ? .018 : .006) * bed.health * (stressed ? .05 : 1));
      if (bed.health <= .001) { bed.dead_quantity = bed.quantity; bed.quantity = 0; bed.growth = 0; bed.status = 'dead'; }
      else if (bed.accepted_at) bed.status = bed.growth >= .85 ? 'ready' : 'growing';
    }
  }
  const device = pump(world);
  if (device) {
    const hours = Math.max(0, end - Math.max(start, milliseconds(device.installed_at))) / HOUR;
    device.condition = clamp(device.condition - hours * .006 / 24);
    if (device.condition < .4) device.status = 'broken';
  }
}
