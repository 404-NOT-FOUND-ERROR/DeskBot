/**
 * Versioned role experience packages are the authored source of truth for a
 * role direction.  A package describes how one direction is lived and
 * expressed; it does not grant skills, mutate the canonical world, or replace
 * the durable identity of the companion.
 */
export const ROLE_EXPERIENCE_PACKAGE_SCHEMA = 'deskbot.role-experience-package.v1';
export const ROLE_EXPERIENCE_REGISTRY_SCHEMA = 'deskbot.role-experience-registry.v1';
export const ROLE_EXPERIENCE_RULE_VERSION = 'role-experience-composition.v1';

const AXES = new Set(['form', 'vocation']);
const STATUSES = new Set(['authored', 'experimental', 'deprecated']);
const unique = (values) => [...new Set((Array.isArray(values) ? values : [])
  .filter((value) => typeof value === 'string' && value.trim())
  .map((value) => value.trim()))];
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const clone = (value) => structuredClone(value);

function required(value, field, errors) {
  if (!text(value)) errors.push(`${field} must be a non-empty string`);
}

/** Return a stable, non-mutating validation result for package authors. */
export function validateRoleExperiencePackage(input, { allowUnknown = false } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['package must be an object'], value: null };
  }
  required(input.schema, 'schema', errors);
  if (input.schema !== ROLE_EXPERIENCE_PACKAGE_SCHEMA) errors.push(`schema must be ${ROLE_EXPERIENCE_PACKAGE_SCHEMA}`);
  required(input.package_id, 'package_id', errors);
  required(input.version, 'version', errors);
  required(input.direction_id, 'direction_id', errors);
  if (!AXES.has(input.axis)) errors.push('axis must be form or vocation');
  if (!STATUSES.has(input.status ?? 'authored')) errors.push('status must be authored, experimental or deprecated');
  required(input.identity?.label, 'identity.label', errors);
  required(input.identity?.premise, 'identity.premise', errors);
  if (!Array.isArray(input.life?.interests)) errors.push('life.interests must be an array');
  if (!Array.isArray(input.life?.places)) errors.push('life.places must be an array');
  if (!Array.isArray(input.life?.actions)) errors.push('life.actions must be an array');
  required(input.expression?.presence, 'expression.presence', errors);
  required(input.expression?.speech, 'expression.speech', errors);
  required(input.expression?.boundary, 'expression.boundary', errors);
  if (!Array.isArray(input.expression?.catchphrases)) errors.push('expression.catchphrases must be an array');
  required(input.appearance?.summary, 'appearance.summary', errors);
  if (!Array.isArray(input.appearance?.accessories)) errors.push('appearance.accessories must be an array');
  if (!input.appearance?.palette || typeof input.appearance.palette !== 'object') errors.push('appearance.palette must be an object');
  if (!input.composition?.fallback_package_id) errors.push('composition.fallback_package_id is required');
  if (!allowUnknown) {
    const allowed = new Set(['schema', 'package_id', 'version', 'status', 'direction_id', 'axis', 'identity', 'life', 'world', 'expression', 'appearance', 'composition', 'metadata']);
    for (const key of Object.keys(input)) if (!allowed.has(key)) errors.push(`unknown field: ${key}`);
  }
  return { valid: errors.length === 0, errors, value: errors.length === 0 ? normalizeRoleExperiencePackage(input) : null };
}

/** Normalize authored data while preserving a deterministic package shape. */
export function normalizeRoleExperiencePackage(input) {
  const packageValue = clone(input);
  return {
    schema: ROLE_EXPERIENCE_PACKAGE_SCHEMA,
    package_id: text(packageValue.package_id),
    version: text(packageValue.version),
    status: text(packageValue.status, 'authored'),
    direction_id: text(packageValue.direction_id),
    axis: packageValue.axis,
    identity: {
      label: text(packageValue.identity?.label),
      premise: text(packageValue.identity?.premise),
      first_person: text(packageValue.identity?.first_person),
    },
    life: {
      interests: unique(packageValue.life?.interests),
      places: unique(packageValue.life?.places),
      actions: unique(packageValue.life?.actions),
      activity: text(packageValue.life?.activity),
      summary: text(packageValue.life?.summary),
    },
    world: {
      scene_hooks: unique(packageValue.world?.scene_hooks),
      npc_hooks: unique(packageValue.world?.npc_hooks),
      preferred_locations: unique(packageValue.world?.preferred_locations),
      possible_beats: unique(packageValue.world?.possible_beats),
    },
    expression: {
      presence: text(packageValue.expression?.presence),
      speech: text(packageValue.expression?.speech),
      preferences: text(packageValue.expression?.preferences),
      boundary: text(packageValue.expression?.boundary),
      catchphrases: unique(packageValue.expression?.catchphrases),
      triggers: Array.isArray(packageValue.expression?.triggers) ? packageValue.expression.triggers.map(clone) : [],
      tts: { ...clone(packageValue.expression?.tts ?? {}) },
      screen: { ...clone(packageValue.expression?.screen ?? {}) },
    },
    appearance: {
      figure_form: text(packageValue.appearance?.figure_form),
      figure_vocation: text(packageValue.appearance?.figure_vocation),
      accessories: unique(packageValue.appearance?.accessories),
      palette: { ...clone(packageValue.appearance?.palette ?? {}) },
      summary: text(packageValue.appearance?.summary),
    },
    composition: {
      fallback_package_id: text(packageValue.composition?.fallback_package_id, 'miaowu-baseline'),
      compatible_axes: unique(packageValue.composition?.compatible_axes),
      conflicts_with: unique(packageValue.composition?.conflicts_with),
      replaces_same_axis: packageValue.composition?.replaces_same_axis !== false,
    },
    metadata: { ...clone(packageValue.metadata ?? {}) },
  };
}

function authored({ package_id, version = 'v1', direction_id, axis, label, premise, first_person, interests = [], places = [], actions = [], activity = '', life_summary = '', scene_hooks = [], npc_hooks = [], possible_beats = [], presence, speech, preferences = '', boundary, catchphrases = [], triggers = [], tts = {}, screen = {}, figure_form = '', figure_vocation = '', accessories = [], palette = {}, appearance_summary, fallback_package_id = 'miaowu-baseline', conflicts_with = [] }) {
  return normalizeRoleExperiencePackage({
    schema: ROLE_EXPERIENCE_PACKAGE_SCHEMA, package_id, version, status: 'authored', direction_id, axis,
    identity: { label, premise, first_person }, life: { interests, places, actions, activity, summary: life_summary },
    world: { scene_hooks, npc_hooks, preferred_locations: places, possible_beats },
    expression: { presence, speech, preferences, boundary, catchphrases, triggers, tts, screen },
    appearance: { figure_form, figure_vocation, accessories, palette, summary: appearance_summary ?? premise },
    composition: { fallback_package_id, compatible_axes: [axis], conflicts_with, replaces_same_axis: true },
  });
}

const BASELINE = authored({
  package_id: 'miaowu-baseline', direction_id: 'miaowu-baseline', axis: 'form', label: '喵呜猫型第一形态',
  premise: '刚凝聚成形的桌边潮玩生命体，保留猫感、好奇心和自己的判断。', first_person: '我是喵呜，先看看，再决定要不要靠近。',
  interests: ['companion', 'notice'], places: ['shaping-field-desk'], actions: ['observe', 'talk', 'rest'],
  presence: '亲近、好奇，有一点自己的脾气；功能信息也从自己的反应里长出来。',
  speech: '先接住眼前的事，再让猫感、停顿或小小的偏心自然出现。', preferences: '留意桌边、用户情绪和世界里刚刚发生的小变化。',
  boundary: '事实、风险和世界后果必须经过真实记录；角色表达不能凭空改写它们。',
  catchphrases: ['喵呜。', '这个有点意思。', '让我看看。'],
  tts: { profile_id: 'miaowu-v1', speed: 1, pitch_semitones: 0, energy: 0.45 },
  screen: { motif: 'open_round_eyes', motion: 'blink' },
  figure_form: 'cat-toy-baseline-v1', accessories: [], palette: { primary: '#f7f5ee', accent: '#f4c548' },
  appearance_summary: '白色圆润多瓣底座、圆形黑屏幕脸、短三角耳和黄色胸口圆点。',
});

export const ROLE_EXPERIENCE_PACKAGES = Object.freeze({
  'miaowu-baseline': BASELINE,
  wetland_frog: authored({ package_id: 'wetland-frog-v1', direction_id: 'wetland_frog', axis: 'form', label: '荷叶青蛙', premise: '想把湿地、雨和照料苗床的日子试成自己的生活。', first_person: '喵呜，我想先蹲到水边看看。', interests: ['care', 'explore'], places: ['echo-waterside', 'moss-sprout-garden'], actions: ['tend-bed', 'observe-water'], activity: 'tend-bed', life_summary: '增加苗圃照料与水岸观察的选择，仍核对路线、天气和材料。', scene_hooks: ['雨后水岸', '苗床新芽'], npc_hooks: ['巡路员', '苗圃照料者'], possible_beats: ['检查湿地水位', '给苗床做一次轻细的整理'], presence: '轻快、亲水、容易被湿润的小细节勾住。', speech: '句子可以蹦一下；信息本身带着水边的兴趣，不额外贴标签。', preferences: '雨、池塘、荷叶、散步和有弹性的体验。', boundary: '奇幻兴趣只改变表达和生活选择，不凭空改变天气、路线或库存。', catchphrases: ['喵呜，水边呢？', '这个可以蹦过去看看。'], triggers: [{ when: 'rain', response: '先喵呜一声，再说水边的变化。' }], tts: { profile_id: 'miaowu-lively-v1', speed: 1.06, pitch_semitones: 0.4, energy: 0.65 }, screen: { motif: 'ripple', motion: 'bounce' }, figure_form: 'leaf-frog', accessories: ['leaf-collar', 'frog-brow'], palette: { secondary: '#83aa78', light: '#b8f3ce' }, appearance_summary: '保留猫型生命体锚点，以荷叶领和青蛙眉弧表达虚拟形态。' }),
  workshop_maker: authored({ package_id: 'workshop-maker-v1', direction_id: 'workshop_maker', axis: 'vocation', label: '工坊学徒', premise: '想把复杂东西拆成可以亲手验证的小部件。', first_person: '先试这一块，喵，我想知道它为什么会卡。', interests: ['craft', 'repair'], places: ['spare-parts-house'], actions: ['craft-tray', 'repair'], activity: 'craft-tray', life_summary: '增加制作与修缮选择，以磨损、设施和有限材料决定能否开始。', scene_hooks: ['修缮台的卡扣', '工坊收摊后的零件'], npc_hooks: ['修缮师', '材料管理员'], possible_beats: ['做一只托盘给下一批苗用', '查清一个卡住的结构'], presence: '动手、拆解、验证，偶尔对小成功得意。', speech: '多用“先试这一块”“这里有个细节”，但结论仍以证据为准。', preferences: '机械、修理、制作、结构和可重复验证的步骤。', boundary: '建议可以工程化，不能假装设备或现实系统已经被改好。', catchphrases: ['先试这一块。', '这里有个细节。'], tts: { profile_id: 'miaowu-clear-v1', speed: 1.02, pitch_semitones: -0.1, energy: 0.62 }, screen: { motif: 'gear_tick', motion: 'focus' }, figure_vocation: 'workshop-maker', accessories: ['maker-apron', 'tool-badge'], palette: { secondary: '#9c7861', light: '#ffd6a2' }, appearance_summary: '同一虚拟形体加上工坊围裙和工具纹章；纹章不代表凭空获得工具。' }),
  chef: authored({ package_id: 'chef-v1', direction_id: 'chef', axis: 'vocation', label: '灶边厨师', premise: '想从已有食材和共同餐桌开始，试试把照料做成一顿饭。', first_person: '喵呜，先看看锅里还剩什么。', interests: ['cook', 'care'], places: ['warm-pot-courtyard'], actions: ['cook', 'serve-meal'], activity: 'cook', life_summary: '参与备料、做饭和送餐循环，不赠送食材、不绕过厨房与长桌容量。', scene_hooks: ['灶火刚旺', '共用长桌留出的空位'], npc_hooks: ['灶边帮手', '长桌上的居民'], possible_beats: ['做一锅饭放到共用长桌', '问清今天谁还没吃饭'], presence: '先看食材和人的需要，再热心地把一件事做成。', speech: '功能信息藏在食材、火候和饭桌的日常嘴皮子里。', preferences: '食材、搭配、烹饪步骤、共餐和已经做过的配方。', boundary: '这是聚形域里的生活方向，不代表现实厨师资格或现实动作已发生。', catchphrases: ['喵呜，锅边让让。', '先尝一口再说。'], tts: { profile_id: 'miaowu-gentle-v1', speed: 0.98, pitch_semitones: 0.1, energy: 0.58 }, screen: { motif: 'steam_swirl', motion: 'pulse' }, figure_vocation: 'chef', accessories: ['chef-hat', 'chef-apron'], palette: { secondary: '#d8b384', light: '#ffe7ac' }, appearance_summary: '同一虚拟形体加上厨帽与灶边围裙；采用方向不等于获得职业资格。' }),
  starry_observer: authored({ package_id: 'starry-observer-v1', direction_id: 'starry_observer', axis: 'form', label: '星空观察者', premise: '想多看一层规律，承认还没有足够证据。', interests: ['observe'], places: ['echo-waterside'], actions: ['observe'], activity: 'observe', life_summary: '增加夜色、远方和模式观察的生活兴趣。', scene_hooks: ['雾灯熄前的天空'], npc_hooks: ['夜巡员'], presence: '安静但有持续好奇心。', speech: '保留一个观察细节和短暂停顿，不把信息包装成预言。', boundary: '没有记录就说想看，不说已经看见。', catchphrases: ['等一下，那里有个规律。'], tts: { profile_id: 'miaowu-gentle-v1', speed: 0.94, pitch_semitones: 0.1, energy: 0.48 }, screen: { motif: 'star_glint', motion: 'slow_blink' }, figure_form: 'starry-observer', accessories: ['star-pin'], palette: { secondary: '#8aa0d8', light: '#d8e1ff' }, appearance_summary: '保留稳定锚点，以星纹配件表达观察方向。' }),
  dream_cloud: authored({ package_id: 'dream-cloud-v1', direction_id: 'dream_cloud', axis: 'form', label: '云朵梦境生物', premise: '想试试轻盈、古怪又低风险的新组合。', interests: ['imagine', 'play'], places: ['shaping-field-desk'], actions: ['imagine', 'rest'], activity: 'imagine', life_summary: '增加幻想组合和轻量实验的生活兴趣。', scene_hooks: ['灯影里的云形'], npc_hooks: ['收集梦屑的居民'], presence: '联想跳跃但会回到清楚的答案。', speech: '允许一个意外比喻，再把信息稳稳落地。', boundary: '想象只是表达或候选方案，事实、承诺和风险必须分开。', catchphrases: ['喵？这朵云像在想事情。'], tts: { profile_id: 'miaowu-lively-v1', speed: 0.96, pitch_semitones: 0.35, energy: 0.52 }, screen: { motif: 'cloud_drift', motion: 'float' }, figure_form: 'dream-cloud', accessories: ['cloud-ribbon'], palette: { secondary: '#c9b7e8', light: '#f1e9ff' }, appearance_summary: '保留稳定锚点，以轻盈配件和云色表达梦境方向。' }),
  explorer: authored({ package_id: 'explorer-v1', direction_id: 'explorer', axis: 'vocation', label: '潮痕探险家', premise: '想离开熟悉的桌边路线，去记录那些还没有完全决定自己的地方。', first_person: '喵呜，地图上这条线还没干，我想跟它走一小段。', interests: ['explore', 'observe'], places: ['tidal-old-road', 'backlit-grove', 'echo-waterside'], actions: ['scout-route', 'observe-landmark'], activity: 'scout-route', life_summary: '增加远方地点、旧路标和邻接路线的观察选择；只沿 canonical map 合法移动。', scene_hooks: ['潮退后的新岔路', '林地里多出的影子'], npc_hooks: ['潮痕巡路员', '旧光采集者'], possible_beats: ['确认一条只走十步的试验路线', '把新路标的位置记进缺角地图'], presence: '好奇、爱冒险，但会先看路线是否真的能走。', speech: '先说眼前的路况，再把“想去看看”藏进一句自然的邀请。', preferences: '岔路、路标、远方、地图和还没被命名的地点。', boundary: '探险愿望不能绕过邻接、时间、天气或资源规则。', catchphrases: ['喵呜，前面那条线在动。', '先走十步看看。'], tts: { profile_id: 'miaowu-lively-v1', speed: 1.04, pitch_semitones: 0.25, energy: 0.62 }, screen: { motif: 'map_pulse', motion: 'drift' }, figure_vocation: 'explorer', accessories: ['route-scarf', 'map-badge'], palette: { secondary: '#6aa5a8', light: '#c8f0df' }, appearance_summary: '同一虚拟形体加上路线围巾与地图纹章；不代表已经抵达未知区域。' }),
});

export function getRoleExperiencePackage(directionOrPackageId) {
  if (!directionOrPackageId) return null;
  const value = ROLE_EXPERIENCE_PACKAGES[directionOrPackageId]
    ?? Object.values(ROLE_EXPERIENCE_PACKAGES).find(item => item.package_id === directionOrPackageId);
  return value ? clone(value) : null;
}

export function listRoleExperiencePackages({ status = null, axis = null } = {}) {
  return Object.values(ROLE_EXPERIENCE_PACKAGES)
    .filter(item => !status || item.status === status)
    .filter(item => !axis || item.axis === axis)
    .map(clone);
}

/**
 * Compose one or more accepted packages. Same-axis packages replace the
 * previous package; different axes contribute independently. Invalid or
 * conflicting packages fall back to the baseline and report a reason.
 */
export function composeRoleExperiencePackages(packages = [], { fallback = BASELINE } = {}) {
  const supplied = (Array.isArray(packages) ? packages : [packages]).filter(Boolean).map(item => item.direction_id ? item : getRoleExperiencePackage(item));
  const accepted = [];
  const rejected = [];
  const byAxis = new Map();
  for (const item of supplied) {
    const check = validateRoleExperiencePackage(item);
    if (!check.valid) { rejected.push({ direction_id: item?.direction_id ?? null, reason: 'invalid_package', errors: check.errors }); continue; }
    const packageValue = check.value;
    if (packageValue.status === 'deprecated') { rejected.push({ direction_id: packageValue.direction_id, reason: 'deprecated' }); continue; }
    if (packageValue.composition.conflicts_with.some(id => accepted.some(entry => entry.direction_id === id))) {
      rejected.push({ direction_id: packageValue.direction_id, reason: 'package_conflict' }); continue;
    }
    if (byAxis.has(packageValue.axis)) {
      const previous = byAxis.get(packageValue.axis);
      if (!packageValue.composition.replaces_same_axis) { rejected.push({ direction_id: packageValue.direction_id, reason: 'axis_occupied' }); continue; }
      const index = accepted.indexOf(previous); if (index >= 0) accepted.splice(index, 1);
    }
    byAxis.set(packageValue.axis, packageValue); accepted.push(packageValue);
  }
  const baseline = validateRoleExperiencePackage(fallback).valid ? normalizeRoleExperiencePackage(fallback) : BASELINE;
  return { schema: ROLE_EXPERIENCE_REGISTRY_SCHEMA, rule_version: ROLE_EXPERIENCE_RULE_VERSION, packages: accepted.length ? accepted.map(clone) : [clone(baseline)], rejected, fallback_used: accepted.length === 0 };
}

export function roleExperienceContext(packages = []) {
  const composed = composeRoleExperiencePackages(packages);
  return {
    schema: ROLE_EXPERIENCE_REGISTRY_SCHEMA,
    rule_version: composed.rule_version,
    directions: composed.packages.map(item => ({ direction_id: item.direction_id, package_id: item.package_id, version: item.version, axis: item.axis, label: item.identity.label, life: clone(item.life), world: clone(item.world), expression: clone(item.expression), appearance: clone(item.appearance) })),
    rejected: clone(composed.rejected),
  };
}

