// Server-owned rules for the first continuing nursery/workshop/kitchen loop.
// Quantities describe this fictional world, not measurements of real Shanghai.
import { PROJECT_ACTIVITIES, projectActivityReason, projectActivityBinding, projectActivityVisible, applyProjectActivityEffect, advanceProjectAssets } from './resident-projects.mjs';
export const LIVING_RULE_VERSION = 'morrowmere-living-resources-v1';
export const RESOURCE_RENEWAL_VERSION = 'morrowmere-resource-renewal-v1';
export const SPRING_UNITS_PER_HOUR = .75;
export const COMMUNITY_SUPPLY_VERSION = 'morrowmere-community-supply-v1';
export const LIGHT_FRUIT_UNITS_PER_HOUR = .5;
export const LIGHT_FRUIT_CAPACITY = 12;
export const SPRING_LEVEL_EQUILIBRIUM = .46;
export const SPRING_LEVEL_RECOVERY_PER_HOUR = .08;
const MINUTE = 60_000;
const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const copy = value => structuredClone(value);
export class LivingResourceError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; }
}
const fail = (code, message, status) => { throw new LivingResourceError(code, message, status); };
export const RESOURCES = Object.freeze({ raw_water: '泉水原水', water: '清水', seeds: '苔芽种子', moss: '鲜苔芽', light_fruit: '林间光果', wood: '木料', cloth: '布料', fasteners: '紧固件', frame_kit: '浮框修补包', trays: '育苗托盘', rations: '日常饭食', pump_kit: '旧件小泵套件', trial_soup: '叶芽试汤' });
const INITIAL = {
  'floating-frame': { kind: 'waterside', water_level: .46, condition: .67, stock: { raw_water: 12 }, capacity: 24 },
  'garden-bed': { kind: 'plant_bed', moisture: .58, health: .88, growth: .25, quantity: 10 },
  'seedling-rack': { kind: 'nursery_store', condition: .94, stock: { water: 12, seeds: 8, moss: 0, trays: 0 }, capacity: 24 },
  'repair-bench': { kind: 'facility', condition: .94 },
  'parts-drawers': { kind: 'store', stock: { wood: 8, cloth: 6, fasteners: 12, frame_kit: 0 }, capacity: 32 },
  'market-canopy': { kind: 'facility', condition: .76 },
  'trial-stove': { kind: 'facility', condition: .92, stock: { water: 8 }, capacity: 24 },
  'shared-table': { kind: 'store', stock: { rations: 3 }, capacity: 24 },
};
// Recipes fix targets, time, inputs and outputs. Client titles/effects cannot mint stock.
export const ACTIVITIES = Object.freeze([
  { activity_id: 'scout-route', title: '沿旧路观察十步', kind: 'care', target: 'floating-frame', seconds: 900, inputs: [] },
  { activity_id: 'water-bed', title: '给苗床浇水', kind: 'care', target: 'garden-bed', seconds: 300, inputs: [{ container: 'seedling-rack', resource: 'water', count: 3 }] },
  { activity_id: 'drain-bed', title: '疏通苗床排水', kind: 'care', target: 'garden-bed', seconds: 600, inputs: [] },
  { activity_id: 'tend-bed', title: '整理和照料苗木', kind: 'care', target: 'garden-bed', seconds: 720, inputs: [{ container: 'seedling-rack', resource: 'water', count: 1 }] },
  { activity_id: 'harvest-bed', title: '收获成熟苔芽', kind: 'care', target: 'garden-bed', seconds: 900, inputs: [] },
  { activity_id: 'sow-bed', title: '重新播种苔芽', kind: 'care', target: 'garden-bed', seconds: 600, inputs: [{ container: 'seedling-rack', resource: 'seeds', count: 2 }] },
  { activity_id: 'craft-tray', title: '制作育苗托盘', kind: 'craft', target: 'repair-bench', seconds: 1200, inputs: [{ container: 'parts-drawers', resource: 'wood', count: 1 }, { container: 'parts-drawers', resource: 'fasteners', count: 1 }], output: { container: 'bag', resource: 'trays', count: 1 } },
  { activity_id: 'craft-frame-kit', title: '制作浮框修补包', kind: 'craft', target: 'repair-bench', seconds: 1500, inputs: [{ container: 'parts-drawers', resource: 'wood', count: 2 }, { container: 'parts-drawers', resource: 'fasteners', count: 3 }], output: { container: 'bag', resource: 'frame_kit', count: 1 } },
  { activity_id: 'repair-frame', title: '修补水岸浮框', kind: 'craft', target: 'floating-frame', seconds: 1200, inputs: [{ container: 'bag', resource: 'frame_kit', count: 1 }] },
  { activity_id: 'repair-bench', title: '修缮工作台', kind: 'craft', target: 'repair-bench', seconds: 900, inputs: [{ container: 'parts-drawers', resource: 'wood', count: 1 }, { container: 'parts-drawers', resource: 'fasteners', count: 2 }] },
  { activity_id: 'repair-rack', title: '修缮育苗架', kind: 'craft', target: 'seedling-rack', seconds: 900, inputs: [{ container: 'bag', resource: 'wood', count: 1 }, { container: 'bag', resource: 'fasteners', count: 2 }] },
  { activity_id: 'repair-stove', title: '修缮试菜灶', kind: 'craft', target: 'trial-stove', seconds: 900, inputs: [{ container: 'bag', resource: 'fasteners', count: 2 }] },
  { activity_id: 'stitch-canopy', title: '缝补交换摊雨棚', kind: 'craft', target: 'market-canopy', seconds: 1080, inputs: [{ container: 'bag', resource: 'cloth', count: 2 }, { container: 'bag', resource: 'fasteners', count: 1 }] },
  { activity_id: 'cook-moss', title: '试做苔芽餐', kind: 'craft', target: 'trial-stove', seconds: 1200, inputs: [{ container: 'bag', resource: 'moss', count: 2 }, { container: 'trial-stove', resource: 'water', count: 1 }], output: { container: 'bag', resource: 'rations', count: 2 } },
  { activity_id: 'gather-light-fruit', title: '在林缘采集两份光果', kind: 'care', target: 'light-fruit-bough', seconds: 600, inputs: [{ container: 'light-fruit-bough', resource: 'light_fruit', count: 2 }], output: { container: 'bag', resource: 'light_fruit', count: 2 } },
  { activity_id: 'cook-grove-stew', title: '煮一锅林间光果餐', kind: 'craft', target: 'trial-stove', seconds: 1200, inputs: [{ container: 'bag', resource: 'light_fruit', count: 2 }, { container: 'trial-stove', resource: 'water', count: 1 }], output: { container: 'bag', resource: 'rations', count: 3 } },
  { activity_id: 'share-meal', title: '在长桌吃一份饭', kind: 'care', target: 'shared-table', seconds: 600, inputs: [{ container: 'shared-table', resource: 'rations', count: 1 }] },
  { activity_id: 'collect-water', title: '在泉眼汲水净滤', kind: 'care', target: 'floating-frame', seconds: 600, inputs: [{ container: 'floating-frame', resource: 'raw_water', count: 4 }], output: { container: 'bag', resource: 'water', count: 4 } },
  { activity_id: 'save-seeds', title: '从苔芽中留种', kind: 'care', target: 'seedling-rack', seconds: 1200, inputs: [{ container: 'bag', resource: 'moss', count: 2 }], output: { container: 'bag', resource: 'seeds', count: 2 } },
  ...PROJECT_ACTIVITIES,
]);
function definition(world, objectId) {
  const object = world.map_catalog?.objects?.find(o => o.object_id === objectId);
  const area = world.map_catalog?.areas?.find(a => a.area_id === object?.area_id);
  return object && area ? { ...object, location_id: area.location_id, access: area.access } : null;
}
function person(world, actorId) {
  const actor = world.protagonist.character_id === actorId ? world.protagonist : world.npcs.find(n => n.npc_id === actorId);
  if (!actor) fail('activity_actor_unknown', '这个居民尚未住进世界。', 404);
  return actor;
}
function bag(world, actorId) { return world.living.inventories[actorId] ??= { stock: {}, capacity: 24 }; }
function container(world, id, actorId) { return id === 'bag' ? bag(world, actorId) : world.living.objects[id]; }
function countIn(world, id, actorId, resource) { return (id === 'bag' ? world.living.inventories[actorId] : world.living.objects[id])?.stock?.[resource] ?? 0; }
function note(world, at, text, details = {}) {
  world.living.recent_changes.push({ at, text, ...details });
  world.living.recent_changes = world.living.recent_changes.slice(-30);
}
export function installLivingResources(world, at) {
  if (world.living) return false;
  const admitted = new Set(world.map_catalog?.objects?.map(o => o.object_id) ?? []);
  const objects = Object.fromEntries(Object.entries(INITIAL).filter(([id]) => admitted.has(id)).map(([id, value]) => [id, { ...copy(value), object_id: id, updated_at: at }]));
  world.living = { schema: 'deskbot.living-resources.v1', rule_version: LIVING_RULE_VERSION, installed_at: at, simulated_until: at,
    revision: 0, objects, inventories: {}, recent_changes: [], weather_window: null,
    recovery: { pending: false, target_at: at },
    usage_grants: { 'parts-drawers': { subject: 'registered_residents', purpose: '镇内共用备料' }, 'trial-stove': { subject: 'registered_residents', purpose: '共用试菜灶' } },
    migration: { id: LIVING_RULE_VERSION, initial_state: 'authored_starting_resources', legacy_task_effects_preserved: true } };
  note(world, at, '苗圃、水岸和生活设施开始记录日常变化。', { kind: 'installation' });
  if (world.weather?.provenance) setLivingWeatherWindow(world, { event_id: 'installed-current-weather', source_kind: 'external_provider', provenance: world.weather.provenance }, at);
  installResourceRenewal(world, at);
  return true;
}
// Add only the new spring source. Existing clean water, seeds, reservations and
// simulation cursors survive; keeping LIVING_RULE_VERSION preserves old tasks.
export function installResourceRenewal(world, at) {
  const living = world.living, spring = living?.objects?.['floating-frame'];
  if (!spring || living.resource_renewal?.id === RESOURCE_RENEWAL_VERSION) return false;
  spring.stock ??= {};
  if (!Object.hasOwn(spring.stock, 'raw_water')) spring.stock.raw_water = 12;
  if (!Number.isFinite(spring.capacity)) spring.capacity = 24;
  living.resource_renewal = { id: RESOURCE_RENEWAL_VERSION, installed_at: at,
    source_object_id: 'floating-frame', source_kind: 'authored_world_physics',
    resource: 'raw_water', units_per_hour: SPRING_UNITS_PER_HOUR,
    description: '聚形域泉眼按作者设定每小时补充 0.75 份原水，与现实天气观测无关。',
    preserved_existing_stocks_and_tasks: true };
  living.revision += 1;
  note(world, at, '泉眼开始缓慢补充原水；居民可以汲水净滤，也可以从收获的苔芽中留种。', { kind: 'resource_renewal_installation', migration_id: RESOURCE_RENEWAL_VERSION });
  return true;
}
// Add a renewable, finite ecological source without granting meals or importing
// growth from time before this rule existed. Existing crops and reservations stay.
export function installCommunitySupply(world, at) {
  const living = world.living;
  if (!living || living.community_supply?.id === COMMUNITY_SUPPLY_VERSION || !world.map_catalog?.objects?.some(o => o.object_id === 'light-fruit-bough')) return false;
  living.objects['light-fruit-bough'] ??= { object_id: 'light-fruit-bough', kind: 'ecological_source', stock: { light_fruit: 0 }, capacity: LIGHT_FRUIT_CAPACITY, updated_at: at };
  if (living.objects['seedling-rack']?.stock) living.objects['seedling-rack'].stock.light_fruit ??= 0;
  living.community_supply = { id: COMMUNITY_SUPPLY_VERSION, installed_at: at, source_kind: 'authored_world_physics',
    fruit_source_object_id: 'light-fruit-bough', fruit_resource: 'light_fruit', fruit_units_per_hour: LIGHT_FRUIT_UNITS_PER_HOUR,
    fruit_capacity: LIGHT_FRUIT_CAPACITY, spring_equilibrium_level: SPRING_LEVEL_EQUILIBRIUM, spring_recovery_per_hour: SPRING_LEVEL_RECOVERY_PER_HOUR,
    description: '林缘光果每小时凝聚 0.5 份，最多留存 12 份；采集、搬运和煮饭仍需实际完成。泉眼回流缓慢稳定水位。这些是聚形域规则，不是上海观测。',
    preserved_existing_stocks_and_tasks: true, starting_fruit_stock: 'empty' };
  living.revision += 1;
  note(world, at, '林缘开始记录光果的凝聚与采集；泉眼回流开始缓慢稳定水位，现有食材和饭份保持原数。', { kind: 'community_supply_installation', migration_id: COMMUNITY_SUPPLY_VERSION });
  return true;
}
function localMinute(world, milliseconds) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: world.clock?.time_zone ?? 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(milliseconds).map(p => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
// Only the server's configured, non-injected current-weather connector can fold
// a bounded observation window into resources. A late sample is never backfilled.
export function setLivingWeatherWindow(world, event, at) {
  if (!world.living) return;
  const provenance = event.provenance;
  const snapshot = world.weather?.snapshot;
  const observed = Date.parse(snapshot?.observed_at ?? '');
  const expiry = Date.parse(provenance?.expires_at ?? '');
  const fetched = Date.parse(provenance?.fetched_at ?? '');
  const current = Date.parse(at);
  const trusted = provenance?.connector === 'weather' && provenance.manually_injected === false && event.source_kind === 'external_provider'
    && Number.isFinite(observed) && Number.isFinite(expiry) && Number.isFinite(fetched) && observed <= current + MINUTE && fetched <= current + MINUTE && expiry > current;
  if (!trusted) { world.living.weather_window = null; return; }
  const end = Math.min(expiry, fetched + 30 * MINUTE, observed + 45 * MINUTE);
  if (end <= current) { world.living.weather_window = null; return; }
  const condition = snapshot.condition ?? '';
  const rain = /雨|rain|drizzle|storm/i.test(condition) && !/雪|snow/i.test(condition);
  world.living.weather_window = { event_id: event.event_id, from: at, until: new Date(end).toISOString(), provider: snapshot.provider, condition,
    rain_rate: rain ? /大|强|heavy|storm/i.test(condition) ? .20 : /中|moderate/i.test(condition) ? .12 : .06 : 0,
    wind_mps: snapshot.wind_mps ?? 0, temperature_c: snapshot.temperature_c ?? 20, humidity: snapshot.humidity ?? .6 };
}
function step(world, start, end, daylight) {
  const hours = (end - start) / 3_600_000;
  const l = world.living, weather = l.weather_window;
  const fresh = weather && start >= Date.parse(weather.from) && start < Date.parse(weather.until);
  const rain = fresh ? weather.rain_rate : 0;
  // Unknown weather keeps the town's ordinary evaporation. It invents no rain/wind.
  const evaporation = fresh ? .009 + (1 - weather.humidity) * .016 + Math.max(0, weather.temperature_c - 20) * .0008 : .014;
  const water = l.objects['floating-frame'];
  if (water) {
    const supplyInstalled = Date.parse(l.community_supply?.installed_at ?? '');
    const inflowHours = Number.isFinite(supplyInstalled) ? Math.max(0, end - Math.max(start, supplyInstalled)) / 3_600_000 : 0;
    const springInflow = inflowHours * SPRING_LEVEL_RECOVERY_PER_HOUR * (SPRING_LEVEL_EQUILIBRIUM - water.water_level);
    water.water_level = clamp(water.water_level + hours * (rain - evaporation * .4 - Math.max(0, water.water_level - .65) * .16) + springInflow);
    if (water.stock && Object.hasOwn(water.stock, 'raw_water')) {
      // A fictional spring is an authored source, never a weather measurement.
      // A migration must not produce supplies for time before it was installed.
      const installed = Date.parse(l.resource_renewal?.installed_at ?? l.installed_at);
      const springHours = Math.max(0, end - Math.max(start, installed)) / 3_600_000;
      const availableCapacity = Math.max(0, water.capacity - heldCount(world, 'floating-frame', 'raw_water'));
      water.stock.raw_water = clamp(water.stock.raw_water + springHours * SPRING_UNITS_PER_HOUR, 0, availableCapacity);
    }
  }
  const fruit = l.objects['light-fruit-bough'];
  if (fruit?.stock && l.community_supply?.id === COMMUNITY_SUPPLY_VERSION) {
    const installed = Date.parse(l.community_supply.installed_at);
    const growingHours = Math.max(0, end - Math.max(start, installed)) / 3_600_000;
    const availableCapacity = Math.max(0, fruit.capacity - heldCount(world, 'light-fruit-bough', 'light_fruit'));
    fruit.stock.light_fruit = clamp((fruit.stock.light_fruit ?? 0) + growingHours * LIGHT_FRUIT_UNITS_PER_HOUR, 0, availableCapacity);
  }
  const bed = l.objects['garden-bed'];
  if (bed) {
    bed.moisture = clamp(bed.moisture + hours * (rain * 1.25 - evaporation * (daylight ? 1 : .55) - Math.max(0, bed.moisture - .72) * .12));
    if (bed.quantity > 0) {
      const stressed = bed.moisture < .18 || bed.moisture > .91;
      bed.health = clamp(bed.health + hours * (stressed ? -.04 : bed.moisture > .28 && bed.moisture < .85 ? .003 : -.007));
      bed.growth = clamp(bed.growth + hours * (daylight ? 1 : .35) * bed.health * (stressed ? .05 : .0208));
      if (bed.health <= .001) { bed.dead_quantity = bed.quantity; bed.quantity = 0; bed.growth = 0; }
    }
  }
  const rack = l.objects['seedling-rack'];
  if (rack?.stock) rack.stock.water = clamp(rack.stock.water + rain * hours * 8, 0, rack.capacity - heldCount(world, 'seedling-rack', 'water'));
  advanceProjectAssets(world, start, end, { daylight, rain, evaporation });
  for (const id of ['floating-frame', 'seedling-rack', 'repair-bench', 'market-canopy', 'trial-stove']) {
    const item = l.objects[id]; if (!item) continue;
    const exposed = ['floating-frame', 'market-canopy'].includes(id);
    const storm = fresh && exposed ? Math.max(0, weather.wind_mps - 8) * .0015 + rain * .022 : 0;
    item.condition = clamp(item.condition - hours * ((exposed ? .008 : .002) / 24 + storm));
  }
}
function bands(objects) {
  const bed = objects['garden-bed'], water = objects['floating-frame'];
  return { water: water ? water.water_level > .8 ? '水位偏高' : water.water_level < .2 ? '水位偏低' : '水位平稳' : null,
    plants: bed ? bed.quantity === 0 ? '苗床空置' : bed.health < .35 ? '苗木衰弱' : bed.moisture < .18 ? '苗床缺水' : bed.moisture > .91 ? '苗床积水' : bed.growth >= .85 ? '苔芽可以收获' : '苔芽还在生长' : null,
    canopy: objects['market-canopy']?.condition < .4 ? '雨棚需要修缮' : '雨棚可用' };
}
export function advanceLivingResources(world, at, { force = false, maxMinutes = 10080 } = {}) {
  const l = world.living;
  if (!l || world.clock?.mode !== 'real_time') return { accepted: false, reason: 'living_real_time_required' };
  const end = Date.parse(at), start = Date.parse(l.simulated_until);
  if (!Number.isFinite(end) || end <= start || (!force && end - start < MINUTE)) return { accepted: false, reason: 'no_elapsed_living_time' };
  const stop = Math.min(end, start + maxMinutes * MINUTE), before = bands(l.objects);
  // Advance at most seven days per commit; retain the exact cursor for subsequent
  // ticks. The real clock stays 1:1 even during bounded offline recovery.
  let cursor = start, daylight = false, lastHour = '';
  while (cursor < stop) {
    const hourKey = Math.floor(cursor / 3_600_000);
    if (hourKey !== lastHour) { lastHour = hourKey; const minute = localMinute(world, cursor); daylight = minute >= 360 && minute < 1080; }
    let boundary = Math.min(stop, cursor + MINUTE);
    const observedFrom = Date.parse(l.weather_window?.from ?? '');
    if (observedFrom > cursor && observedFrom < boundary) boundary = observedFrom;
    const expiry = Date.parse(l.weather_window?.until ?? '');
    if (expiry > cursor && expiry < boundary) boundary = expiry;
    step(world, cursor, boundary, daylight); cursor = boundary;
  }
  l.simulated_until = new Date(stop).toISOString(); l.revision += 1;
  l.recovery = { pending: stop < end, target_at: at };
  for (const object of Object.values(l.objects)) object.updated_at = l.simulated_until;
  const after = bands(l.objects);
  for (const key of Object.keys(after)) if (after[key] && before[key] !== after[key]) note(world, l.simulated_until, after[key], { kind: 'environment', rule_version: LIVING_RULE_VERSION });
  return { accepted: true, from: new Date(start).toISOString(), until: l.simulated_until, recovered: end - start > 5 * MINUTE, pending: stop < end, weather_event_id: l.weather_window?.event_id ?? null };
}
function activityBlocker(world, recipe, actorId, { completion = false, taskId = null, task = null, at = world.clock?.synced_at } = {}) {
  const blocked = (code, classification, reason) => ({code, classification, reason});
  if (!world.living || world.clock?.mode !== 'real_time') return blocked('living_not_enabled', 'condition', '生活资源规则尚未启用。');
  const actor = person(world, actorId), target = definition(world, recipe.target), state = world.living.objects[recipe.target];
  if (!target || !state) return blocked('facility_missing', 'condition', '这个设施还没有安装。');
  if (actor.location_id !== target.location_id) return blocked('activity_location_changed', 'route', '需要先到这个地点。');
  if (!canUse(world, target, actorId)) return blocked('permission_required', 'coordination', '需要住户同意。');
  if ((world.tasks ?? []).some(t => ['running', 'paused'].includes(t.status) && t.task_id !== taskId && (t.actor_id === actorId || t.target_object_id === recipe.target))) return blocked('facility_busy', 'coordination', '有人正在使用这个设施，或还有未完成的活动。');
  if (!completion && world.living.recovery.pending) return blocked('world_recovery_pending', 'condition', '世界正在补算此前经过的时间。');
  const projectReason = projectActivityReason(world, recipe, actorId, at, { completion, task });
  if (projectReason) return blocked('project_conditions_changed', 'condition', projectReason);
  const bed = world.living.objects['garden-bed'];
  if (recipe.activity_id === 'harvest-bed' && (!bed || bed.quantity === 0 || bed.growth < .85 || bed.health < .35)) return blocked('crop_not_harvestable', 'condition', '苔芽还未成熟，或苗况不适合收获。');
  if (recipe.activity_id === 'sow-bed' && bed?.quantity > 0 && bed.health > .08) return blocked('crop_present', 'condition', '苗床还有活苗，先照料或收获。');
  if (['water-bed', 'tend-bed', 'drain-bed'].includes(recipe.activity_id) && !bed?.quantity) return blocked('crop_absent', 'condition', '苗床空着，需要重新播种。');
  if (recipe.activity_id === 'water-bed' && bed?.moisture > .82) return blocked('crop_already_wet', 'condition', '苗床已经很湿，不宜再浇水。');
  if (recipe.activity_id === 'drain-bed' && bed?.moisture < .72) return blocked('crop_not_waterlogged', 'condition', '苗床现在没有积水。');
  if (recipe.activity_id === 'repair-frame' && state.water_level > .88) return blocked('water_level_high', 'condition', '水位过高，暂时无法安全修补浮框。');
  if (recipe.activity_id === 'collect-water') {
    if (state.water_level < .15) return blocked('water_level_low', 'condition', '水位过低，暂时无法汲水。');
    if (state.water_level > .88) return blocked('water_level_high', 'condition', '水位过高，暂时无法安全汲水。');
    if (state.condition < .4) return blocked('facility_damaged', 'condition', '浮框已经损坏，需要先修缮再汲水。');
  }
  if (['craft-tray', 'craft-frame-kit', 'cook-moss', 'cook-grove-stew'].includes(recipe.activity_id) && state.condition < .4) return blocked('facility_damaged', 'condition', '设施已经损坏，需要先修缮。');
  if (['repair-frame', 'repair-bench', 'repair-rack', 'repair-stove', 'stitch-canopy'].includes(recipe.activity_id) && state.condition > .9) return blocked('facility_healthy', 'condition', '设施状况良好，暂时无需修缮。');
  if (!completion) for (const input of recipe.inputs) if (countIn(world, input.container, actorId, input.resource) < input.count) return blocked('material_shortage', 'resource', `缺少${RESOURCES[input.resource]}，需要 ${input.count} 份${input.container === 'bag' ? '随身携带' : ''}。`);
  if (recipe.output) {
    const destination = recipe.output.container === 'bag' ? world.living.inventories[actorId] : world.living.objects[recipe.output.container];
    if ((destination?.stock?.[recipe.output.resource] ?? 0) + heldCount(world, recipe.output.container === 'bag' ? `bag:${actorId}` : recipe.output.container, recipe.output.resource) + recipe.output.count > (destination?.capacity ?? 24)) return blocked('output_storage_full', 'resource', '产物没有足够的存放空间。');
  }
  return null;
}
function eligibility(world, recipe, actorId, options) { return activityBlocker(world, recipe, actorId, options)?.reason ?? null; }
export function prepareLivingActivity(world, activityId, actorId, at) {
  const recipe = ACTIVITIES.find(a => a.activity_id === activityId);
  if (!recipe) fail('activity_unknown', '没有这项生活活动。', 400);
  const reason = eligibility(world, recipe, actorId, { at });
  if (reason) fail('activity_unavailable', reason);
  const projectBinding = projectActivityBinding(world, recipe);
  const reserved = recipe.inputs.map(input => ({ ...input, container: input.container === 'bag' ? `bag:${actorId}` : input.container }));
  for (const input of recipe.inputs) container(world, input.container, actorId).stock[input.resource] -= input.count;
  world.living.revision += 1;
  note(world, at, `${person(world, actorId).display_name ?? '居民'}开始${recipe.title}。`, { kind: 'activity_started', activity_id: activityId, actor_id: actorId });
  return { activity_id: activityId, target_object_id: recipe.target, title: recipe.title, kind: recipe.kind, duration_seconds: recipe.seconds,
    completion_effect: LIVING_RULE_VERSION, reservation: { status: 'held', inputs: reserved }, ...projectBinding };
}
export function releaseLivingReservation(world, task, at) {
  if (task.reservation?.status !== 'held') return;
  for (const input of task.reservation.inputs) {
    const storage = input.container.startsWith('bag:') ? bag(world, input.container.slice(4)) : world.living.objects[input.container];
    // Held material counts toward capacity, so refunds cannot overflow.
    storage.stock[input.resource] = (storage.stock[input.resource] ?? 0) + input.count;
  }
  task.reservation.status = 'returned'; world.living.revision += 1;
  note(world, at, `${task.title}未完成，预留材料已归还。`, { kind: 'activity_returned', task_id: task.task_id });
}
export function completeLivingActivity(world, task, at) {
  const recipe = ACTIVITIES.find(a => a.activity_id === task.activity_id);
  if (!recipe || task.completion_effect !== LIVING_RULE_VERSION || task.reservation?.status !== 'held') fail('activity_rules_changed', '这项活动的规则或材料预留不一致。');
  const blocker = activityBlocker(world, recipe, task.actor_id, { completion: true, taskId: task.task_id, task, at });
  if (blocker) return { success: false, ...blocker };
  const target = world.living.objects[recipe.target], before = copy(target), bed = world.living.objects['garden-bed'];
  const changes = [];
  switch (recipe.activity_id) {
    case 'water-bed': target.moisture = clamp(target.moisture + .24); target.health = clamp(target.health + .02); break;
    case 'drain-bed': target.moisture = .62; target.health = clamp(target.health + .03); break;
    case 'tend-bed': target.health = clamp(target.health + .12); break;
    case 'sow-bed': Object.assign(target, { quantity: 10, dead_quantity: 0, health: .9, growth: .04, moisture: Math.max(.45, target.moisture) }); break;
    case 'harvest-bed': {
      const yieldCount = Math.max(1, Math.floor(bed.quantity * bed.health));
      const stock = bag(world, task.actor_id);
      if ((stock.stock.moss ?? 0) + heldCount(world, `bag:${task.actor_id}`, 'moss') + yieldCount > stock.capacity) return { success: false, code: 'harvest_storage_full', classification: 'resource', reason: '随身袋装不下这次收获。' };
      stock.stock.moss = (stock.stock.moss ?? 0) + yieldCount;
      changes.push({ container: `bag:${task.actor_id}`, resource: 'moss', count: yieldCount });
      target.quantity = 0; target.dead_quantity = 0; target.growth = 0; break;
    }
    case 'repair-frame': case 'repair-bench': case 'repair-rack': case 'repair-stove': case 'stitch-canopy': target.condition = clamp(target.condition + .35); break;
  }
  const projectResult = applyProjectActivityEffect(world, recipe, task, at);
  if (projectResult) changes.push(...projectResult.stock_changes);
  if (recipe.output) {
    const storage = container(world, recipe.output.container, task.actor_id);
    storage.stock[recipe.output.resource] = (storage.stock[recipe.output.resource] ?? 0) + recipe.output.count;
    changes.push({ ...recipe.output, container: recipe.output.container === 'bag' ? `bag:${task.actor_id}` : recipe.output.container });
  }
  target.updated_at = at; task.reservation.status = 'consumed'; world.living.revision += 1;
  const text = recipe.activity_id === 'harvest-bed' ? `收获了 ${changes[0].count} 份鲜苔芽，苗床等待下一次播种。` : recipe.activity_id === 'share-meal' ? '在长桌吃完一份饭。' : `${recipe.title}完成了。`;
  note(world, at, text, { kind: 'activity_completed', task_id: task.task_id, actor_id: task.actor_id });
  return { success: true, text, before, after: copy(target), stock_changes: changes, ...(projectResult ? { project_result: projectResult } : {}) };
}
function heldCount(world, storageId, resource) {
  return (world.tasks ?? []).filter(t => t.reservation?.status === 'held').flatMap(t => t.reservation.inputs).filter(input => input.container === storageId && input.resource === resource).reduce((sum, input) => sum + input.count, 0);
}
function canUse(world, object, actorId) {
  return object.access === 'public' || (world.living?.usage_grants?.[object.object_id]?.subject === 'registered_residents'
    && (world.protagonist.character_id === actorId || world.npcs.some(n => n.npc_id === actorId)));
}
export function transferLivingResource(world, payload, at) {
  const actorId = payload.actor_id ?? world.protagonist.character_id;
  const actor = person(world, actorId), object = definition(world, payload.object_id), storage = world.living?.objects[payload.object_id];
  if (!object || !storage?.stock || !canUse(world, object, actorId)) fail('resource_store_unknown', '这里没有可以使用的公共库存。', 404);
  if (storage.kind === 'ecological_source') fail('resource_source_requires_gathering', '光果仍长在林缘枝上，需要实际完成采集活动后才能携带。');
  if (actor.location_id !== object.location_id || (world.tasks ?? []).some(t => t.actor_id === actorId && ['running', 'paused'].includes(t.status))) fail('resource_actor_unavailable', '先到达这个地点并完成当前活动。');
  if (!Object.hasOwn(storage.stock, payload.resource) || !Object.hasOwn(RESOURCES, payload.resource)) fail('resource_unknown', '这里不存放这种物品。', 400);
  if (!Number.isSafeInteger(payload.count) || payload.count < 1 || payload.count > 24 || !['take', 'store'].includes(payload.operation)) fail('invalid_resource_transfer', '每次取放 1 到 24 份物品。', 400);
  const carried = bag(world, actorId), take = payload.operation === 'take';
  const from = take ? storage : carried, to = take ? carried : storage;
  const toId = take ? `bag:${actorId}` : payload.object_id;
  if ((from.stock[payload.resource] ?? 0) < payload.count) fail('resource_insufficient', '可用库存不足。');
  if ((to.stock[payload.resource] ?? 0) + heldCount(world, toId, payload.resource) + payload.count > to.capacity) fail('resource_capacity', '没有足够的存放空间。');
  from.stock[payload.resource] -= payload.count; to.stock[payload.resource] = (to.stock[payload.resource] ?? 0) + payload.count;
  world.living.revision += 1; storage.updated_at = at;
  const text = `${take ? '取出' : '存入'} ${payload.count} 份${RESOURCES[payload.resource]}。`;
  note(world, at, text, { kind: 'resource_transfer', actor_id: actorId, object_id: payload.object_id });
  return { text, operation: payload.operation, object_id: payload.object_id, resource: payload.resource, count: payload.count };
}
export function livingObjectReadModel(world, object) {
  const state = world.living?.objects[object.object_id];
  return { ...copy(object), ...(state ? { state_scope: 'persistent_living', state: copy(state), status_text: objectStatus(state), resource_names: RESOURCES } : {}) };
}
function objectStatus(state) {
  const percent = x => Math.round(x * 100);
  if (state.kind === 'ecological_source') return `已凝聚光果 ${Math.round((state.stock.light_fruit ?? 0) * 10) / 10}/${state.capacity} 份 · 每小时凝聚 ${LIGHT_FRUIT_UNITS_PER_HOUR} 份`;
  if (state.kind === 'plant_bed') return state.quantity ? `土壤湿润 ${percent(state.moisture)}% · 苗况 ${percent(state.health)}% · 生长 ${percent(state.growth)}%${state.growth >= .85 ? ' · 可收获' : ''}` : state.dead_quantity ? '留下了枯苗，重新播种时需要清理' : '苗床空着，等待播种';
  if (state.kind === 'waterside') return `水位 ${percent(state.water_level)}% · 浮框完好 ${percent(state.condition)}%${state.stock && Object.hasOwn(state.stock, 'raw_water') ? ` · 原水 ${Math.round(state.stock.raw_water * 10) / 10}/${state.capacity} 份` : ''}`;
  return typeof state.condition === 'number' ? `完好 ${percent(state.condition)}%` : '有限库存';
}
export function livingReadModel(world, actorId = world.protagonist.character_id, { at = world.clock?.synced_at } = {}) {
  if (!world.living) return null;
  return { schema: world.living.schema, rule_version: LIVING_RULE_VERSION, simulated_until: world.living.simulated_until,
    revision: world.living.revision, recovery: copy(world.living.recovery), resource_names: RESOURCES,
    resource_renewal: copy(world.living.resource_renewal ?? null),
    community_supply: copy(world.living.community_supply ?? null),
    inventory: copy(world.living.inventories[actorId] ?? { stock: {}, capacity: 24 }), recent_changes: copy(world.living.recent_changes.slice(-8)),
    activities: ACTIVITIES.filter(recipe => projectActivityVisible(world, recipe, actorId)).map(recipe => {
      const reason = eligibility(world, recipe, actorId, { at });
      return { activity_id: recipe.activity_id, title: recipe.title, kind: recipe.kind, target_object_id: recipe.target,
        location_id: definition(world, recipe.target)?.location_id ?? null, duration_seconds: recipe.seconds,
        inputs: recipe.inputs.map(input => ({ resource: input.resource, name: RESOURCES[input.resource], count: input.count, from: input.container === 'bag' ? '随身袋' : definition(world, input.container)?.name ?? input.container })),
        ...(recipe.project_id ? { project_id: recipe.project_id, project_stage_id: recipe.project_stage } : {}),
        ...(recipe.output ? { output: { resource: recipe.output.resource, name: RESOURCES[recipe.output.resource], count: recipe.output.count, to: recipe.output.container === 'bag' ? '随身袋' : definition(world, recipe.output.container)?.name ?? recipe.output.container } } : {}),
        available: !reason, unavailable_reason: reason };
    }) };
}
