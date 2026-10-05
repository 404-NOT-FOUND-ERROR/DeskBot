import { installLivedMemory, syncLivedMemory, memoryReadModel } from './lived-memory.mjs';
import { applyLifeChoice } from './autonomous-life.mjs';
import { WorldMapError, loadWorldMapContent, installWorldMapContent, upgradeAuthoredScene, setPassageAccess, worldHopAccess, findWorldPath, passageFor, presentationRouteFor } from './world-map-content.mjs';
import { getWorldEnvironment } from './world-environment.mjs';
import { installRefraction, refractInput, refractionReadModel } from './input-refraction.mjs';
import { installResidentLife } from './resident-life.mjs';
import { installResidentProjects, projectReadModel } from './resident-projects.mjs';
import { respondSocialInvitation, socialReadModel, SocialLifeError } from './social-life.mjs';
import { advanceAutonomousLife, controlAutonomy, autonomyReadModel, AutonomousLifeError } from './autonomous-life.mjs';
import { LivingResourceError, installLivingResources, installResourceRenewal, advanceLivingResources, setLivingWeatherWindow, transferLivingResource, livingObjectReadModel, livingReadModel } from './living-resources.mjs';
import { createHash } from 'node:crypto';
import { RealTimeWorldError, activeWorldTask, applyRealTimeClock, localWorldDate, startTravelTask, startActivityTask, controlWorldTask, advanceWorldTask } from './realtime-world.mjs';

import {
  DEFAULT_CHARACTER_DISPLAY_NAME,
  DEFAULT_CHARACTER_DISPLAY_NAME_STATUS,
  DEFAULT_CHARACTER_ID,
  DEFAULT_LOCATION_ID,
  DEFAULT_LOCATION_NAME,
  DEFAULT_SETTLEMENT,
  DEFAULT_WORLD_LOCATIONS,
  LEGACY_CHARACTER_IDS,
  LEGACY_LOCATION_IDS,
  WORLD_SETTING,
  canonicalCharacterId,
  canonicalLocationId,
  characterIdsEqual,
  createInitialShapingField,
  createInitialCharacterAppearance,
  createInitialCharacterProfile,
  createWorldSettingMetadata,
  SHAPING_FIELD_DEFINITIONS,
} from './world-definition.mjs';

const DEFAULT_WORLD_ID = 'deskbot-small-world';
const MAX_NPCS = 3;
const MAX_PENDING_ITEMS = 20;
const MAX_CONTEXT_ITEMS = 20;
const PREFERENCE_STABLE_OBSERVATIONS = 3;
const MINUTES_PER_DAY = 24 * 60;
const WALL_CLOCK_NAMESPACE = 'canonical-world.wall-clock';
const WALL_CLOCK_SCHEMA = 'deskbot.world-wall-clock.v0.1';
const WALL_CLOCK_DEFAULT_CATCH_UP_MINUTES = 120;
const WORLD_RULE_VERSION = 'canonical-world-rules-v0.4';

const PRESENTATION_SPACE = 'jev-town-map-v1';

const MULTISOURCE_LAYERS = Object.freeze([
  {
    layer: 'world_line',
    path: '/world_line',
    purpose: '虚拟世界线、主线弧段与 NPC 行动',
    source_kinds: ['world_engine', 'service'],
  },
  {
    layer: 'external_context',
    path: '/external_context',
    purpose: '外部网络新闻与大事件的可引用上下文',
    source_kinds: ['external_provider', 'service'],
  },
  {
    layer: 'weather',
    path: '/weather',
    purpose: '天气观测快照；按 observed_at 拒绝旧样本覆盖新样本',
    source_kinds: ['external_provider', 'device', 'service'],
  },
  {
    layer: 'calendar',
    path: '/calendar',
    purpose: '日历、季节与逻辑时间的顺序约束',
    source_kinds: ['world_engine', 'external_provider', 'service'],
  },
  {
    layer: 'user_profile',
    path: '/user_profile',
    purpose: '用户习惯与偏好观察；重复一致后才形成稳定偏好',
    source_kinds: ['user', 'service'],
  },
  {
    layer: 'device_context',
    path: '/device_context',
    purpose: '设备、传感器与固件运行上下文',
    source_kinds: ['device', 'service'],
  },
  {
    layer: 'interaction',
    path: '/interaction',
    purpose: '用户回合计数与最近相关事件',
    source_kinds: ['user', 'service'],
  },
]);

const SUPPORTED_WORLD_ACTIONS = Object.freeze([
  { action:'install_input_refraction',layer:'world_line',required:[],optional:[],description:'安装有限的现实输入参考，不回填历史；消息只提供候选，实际任务仍须核验' },
  { action:'install_lived_memory',layer:'world_line',required:[],optional:['planner_enabled'],description:'从实际记录安装生活记忆与缓慢兴趣' },
  { action:'claim_life_choice',layer:'world_line',required:['actor_id','request_id'],optional:[],description:'服务端核验可行候选并领取有限思考额度' },
  { action:'resolve_life_choice',layer:'world_line',required:['actor_id','request_id'],optional:['text','model','error'],description:'服务端验证模型选择，保留理解与执行边界' },
  { action: 'sync_real_time', layer: 'calendar', required: [], optional: ['time_zone'], description: '服务端同步现实时间，生产默认 Asia/Shanghai、1:1' },
  { action: 'start_activity', layer: 'world_line', required: ['task_id'], optional: ['activity_id', 'kind', 'title', 'duration_seconds', 'actor_id'], description: '作者生活活动使用固定耗时、材料预留和核验后果；旧活动仅保留经历' },
  { action: 'advance_living_world', layer: 'world_line', required: ['until'], optional: ['force'], description: '服务端按真实经过时间补算环境，最多七天一批，保留恢复游标' },
  { action: 'transfer_resource', layer: 'world_line', required: ['object_id', 'resource', 'count', 'operation'], optional: ['actor_id'], description: '同地点从有限库存取放物品，不凭空生成材料' },
  { action: 'control_task', layer: 'world_line', required: ['task_id', 'operation'], optional: [], description: '暂停、继续或取消未完成任务' },
  { action: 'advance_task', layer: 'world_line', required: ['task_id', 'expected_task_revision'], optional: [], description: '服务端核验到期任务并原子提交结果' },
  { action: 'advance_time', layer: 'calendar', required: ['minutes'], optional: [], description: '推进连续世界逻辑时间' },
  { action: 'activate_event', layer: 'world_line', required: ['event.event_id', 'event.title'], optional: ['event.summary', 'event.daily_consequence', 'event.opportunity', 'event.unresolved_hook', 'event.source'], description: '创建唯一进行中的世界事件及其可生活切片' },
  { action: 'resolve_active_event', layer: 'world_line', required: [], optional: ['event_id', 'outcome'], description: '结束当前进行中的世界事件' },
  { action: 'enqueue_pending_item', layer: 'world_line', required: ['item.item_id', 'item.summary'], optional: ['item.kind', 'item.source'], description: '按 FIFO 加入待处理事项' },
  { action: 'dequeue_pending_item', layer: 'world_line', required: [], optional: ['item_id'], description: '按 FIFO 取出待处理事项' },
  { action: 'upsert_npc', layer: 'world_line', required: ['npc.npc_id', 'npc.display_name'], optional: ['npc.role', 'npc.location_id', 'npc.status'], description: '新增或更新 NPC；容量以当前 canonical_fields.npcs.maximum 为准' },
  { action: 'install_resident_life', layer: 'world_line', required: [], optional: [], description: '安装居民作者目录及社会生活，保留已有身份与经历' },
  { action: 'respond_social_invitation', layer: 'world_line', required: ['invitation_id', 'operation'], optional: [], description: '喵呜回应自己的邀请：join、decline 或 withdraw' },
  { action: 'move_protagonist', layer: 'world_line', required: ['location_id'], optional: ['reason','destination_location_id'], description: '沿合法通路开始持久旅行，抵达时再次验证；研究模式保留模拟旅行' },
  { action: 'admit_map_content', layer: 'world_line', required: ['content','expected_world_revision'], optional: [], description: '校验完整候选目录后追加地点、区域和对象，保留已有身份和归属' },
  { action: 'set_passage_access', layer: 'world_line', required: ['passage_id','status','reason','expected_passage_revision'], optional: [], description: '由世界规则封闭或重开通路，保留原因和版本；外部观测不能直接执行' },
  { action: 'set_life_scene', layer: 'world_line', required: ['scene.scene_id', 'scene.location_id', 'scene.title'], optional: ['scene.content_version', 'scene.narration', 'scene.sensory_cue', 'scene.opportunity', 'scene.participants', 'scene.source_factors', 'scene.continuity', 'scene.started_at', 'scene.expires_at', 'scene.arc_id', 'scene.cause_event_ids', 'scene.cause_experience_ids', 'scene.branch_key', 'scene.resolution_state'], description: '由世界生活引擎切换当前可回放 Scene' },
  { action: 'continue_life_scene', layer: 'world_line', required: ['scene_id', 'slot_key', 'expires_at'], optional: ['source_factors', 'continuity'], description: '同一生活事件跨时间槽继续，不重复制造新 Scene' },
  { action: 'npc_interaction', layer: 'world_line', required: ['interaction_id', 'npc_id', 'intent', 'response'], optional: ['idea', 'occurred_at', 'experience', 'role_direction'], description: '记录同地点 NPC 对白名单互动、共同经历与有限关系变化' },
  { action: 'apply_world_line_event', layer: 'world_line', required: ['event.event_id', 'event.title'], optional: ['event.summary', 'event.daily_consequence', 'event.opportunity', 'event.unresolved_hook', 'event.arc_id', 'event.status', 'event.outcome', 'event.source', 'event.occurred_at'], description: '记录世界线事件、当前弧段、结果及其可生活切片' },
  { action: 'update_weather', layer: 'weather', required: ['snapshot'], optional: ['snapshot.location', 'snapshot.condition', 'snapshot.temperature_c', 'snapshot.humidity', 'snapshot.wind_mps', 'snapshot.observed_at', 'snapshot.provider'], description: '写入天气观测，旧观测只留审计记录' },
  { action: 'record_external_context', layer: 'external_context', required: ['item.item_id', 'item.title'], optional: ['item.summary', 'item.category', 'item.url', 'item.published_at', 'item.observed_at', 'item.provider'], description: '写入外部新闻或网络事件' },
  { action: 'advance_calendar', layer: 'calendar', required: [], optional: ['date', 'timezone', 'season', 'solar_term', 'holiday', 'observed_at'], description: '推进日历，日期不可倒退' },
  { action: 'observe_user_preference', layer: 'user_profile', required: ['preference_key', 'value'], optional: [], description: '记录一次用户偏好观察，连续 3 次一致后 stable' },
  { action: 'record_device_context', layer: 'device_context', required: ['device_id'], optional: ['status', 'metrics', 'state', 'observed_at'], description: '写入设备或传感器上下文' },
  { action: 'npc_action', layer: 'world_line', required: ['npc_id', 'action_name'], optional: ['location_id', 'status', 'occurred_at'], description: '更新已有 NPC 的行动；位置变化只能沿相邻路线' },
]);

function clone(value) {
  return structuredClone(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function diffValues(before, after, path = '') {
  if (valuesEqual(before, after)) return [];

  const beforeObject = before && typeof before === 'object';
  const afterObject = after && typeof after === 'object';
  if (!beforeObject || !afterObject || Array.isArray(before) || Array.isArray(after)) {
    return [{
      field_path: path || '/',
      old_value: clone(before),
      new_value: clone(after),
    }];
  }

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap((key) => diffValues(
    before[key],
    after[key],
    `${path}/${key}`,
  ));
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PersistentWorldError(400, 'invalid_world_mutation', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PersistentWorldError(400, 'invalid_world_mutation', `${field} must be an object`);
  }
  return value;
}

function optionalText(value, field, fallback = null) {
  if (value === undefined || value === null) return fallback;
  return requireText(value, field);
}

function boundedInteger(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new PersistentWorldError(
      400,
      'invalid_world_mutation',
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function boundedNumber(value, field, minimum, maximum, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new PersistentWorldError(
      400,
      'invalid_world_mutation',
      `${field} must be a number between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function optionalDateTime(value, field, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new PersistentWorldError(400, 'invalid_world_mutation', `${field} must be an ISO date-time string`);
  }
  return value;
}

function optionalObject(value, field, fallback = null) {
  if (value === undefined || value === null) return fallback;
  return requireObject(value, field);
}

function requirePreferenceValue(value, field) {
  if (value === null || !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new PersistentWorldError(400, 'invalid_world_mutation', `${field} must be a string, number, or boolean`);
  }
  if (typeof value === 'string' && value.trim() === '') {
    throw new PersistentWorldError(400, 'invalid_world_mutation', `${field} must not be empty`);
  }
  return value;
}

function appendBounded(values, value, limit = MAX_CONTEXT_ITEMS) {
  return [...values, value].slice(-limit);
}

function appendUniqueWorldLineEvent(values, value, limit = MAX_CONTEXT_ITEMS) {
  const eventId = value?.event_id;
  const withoutDuplicate = typeof eventId === 'string'
    ? values.filter((item) => item?.event_id !== eventId)
    : values;
  return [...withoutDuplicate, value].slice(-limit);
}

function createMultisourceState() {
  return {
    world_line: {
      schema: 'foundry.world-line.v0.1',
      current_arc: null,
      latest_event: null,
      recent_events: [],
    },
    weather: {
      schema: 'foundry.weather-context.v0.1',
      status: 'unknown',
      snapshot: null,
    },
    external_context: {
      schema: 'foundry.external-context.v0.1',
      items: [],
    },
    calendar: {
      schema: 'foundry.calendar-context.v0.1',
      date: null,
      timezone: null,
      season: null,
      solar_term: null,
      holiday: null,
      observed_at: null,
    },
    user_profile: {
      schema: 'foundry.user-profile.v0.1',
      preference_policy: {
        min_consistent_observations: PREFERENCE_STABLE_OBSERVATIONS,
      },
      preferences: {},
    },
    device_context: {
      schema: 'foundry.device-context.v0.1',
      devices: {},
      recent_events: [],
    },
  };
}

function createInitialLifeState() {
  return {
    schema: 'deskbot.world-life-state.v0.3',
    current_scene: null,
    recent_scenes: [],
    recent_experiences: [],
  };
}

function createDefaultWorld(now) {
  const timestamp = now().toISOString();
  return {
    schema: 'foundry.canonical-world.v0.2',
    world_id: DEFAULT_WORLD_ID,
    name: WORLD_SETTING.display_name,
    setting: createWorldSettingMetadata(),
    settlement: clone(DEFAULT_SETTLEMENT),
    setting_migration: null,
    world_revision: 0,
    created_at: timestamp,
    updated_at: timestamp,
    logical_time: {
      schema: 'foundry.logical-time.v0.1',
      day: 1,
      minute_of_day: 8 * 60,
      tick: 0,
    },
    protagonist: {
      character_id: DEFAULT_CHARACTER_ID,
      character_id_aliases: [...LEGACY_CHARACTER_IDS],
      display_name: DEFAULT_CHARACTER_DISPLAY_NAME,
      display_name_status: DEFAULT_CHARACTER_DISPLAY_NAME_STATUS,
      location_id: DEFAULT_LOCATION_ID,
      travel_state: {
        status: 'idle',
        from_location_id: null,
        to_location_id: null,
        event_id: null,
        reason: null,
        arrived_at: null,
      },
      appearance: createInitialCharacterAppearance(timestamp),
      character_profile: createInitialCharacterProfile(),
    },
    locations: clone(DEFAULT_WORLD_LOCATIONS),
    npcs: [],
    life: createInitialLifeState(),
    active_event: null,
    pending_items: [],
    shaping_field: createInitialShapingField(timestamp),
    ...createMultisourceState(),
    interaction: {
      user_turn_count: 0,
      last_user_event_id: null,
      last_correlation_id: null,
    },
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim() !== '').map((value) => value.trim()))];
}

const LEGACY_DISPLAY_NAMES = new Set(['Ember', 'DeskBot', '构造组记录者', '聚形域造物', '喵伴']);

function mergeCharacterProfile(existingProfile) {
  const baseline = createInitialCharacterProfile();
  if (!existingProfile || typeof existingProfile !== 'object' || Array.isArray(existingProfile)) {
    return baseline;
  }
  // A role-expression revision is canonical. Preserve identity and form, but
  // replace v1 presentation fields when migrating an existing world to v2.
  const alreadyCurrent = existingProfile.version === baseline.version;
  return {
    ...baseline,
    ...existingProfile,
    schema: baseline.schema,
    version: baseline.version,
    continuity_identity: { ...baseline.continuity_identity, ...existingProfile.continuity_identity },
    current_role: { ...baseline.current_role, ...existingProfile.current_role },
    current_form: { ...baseline.current_form, ...existingProfile.current_form },
    relationship: { ...baseline.relationship, ...existingProfile.relationship },
    temperament: alreadyCurrent && Array.isArray(existingProfile.temperament)
      ? existingProfile.temperament
      : baseline.temperament,
    speech_style: alreadyCurrent
      ? { ...baseline.speech_style, ...existingProfile.speech_style }
      : baseline.speech_style,
    catchphrases: alreadyCurrent && Array.isArray(existingProfile.catchphrases)
      ? existingProfile.catchphrases
      : baseline.catchphrases,
    trigger_rules: alreadyCurrent && Array.isArray(existingProfile.trigger_rules)
      ? existingProfile.trigger_rules
      : baseline.trigger_rules,
    response_modes: alreadyCurrent && Array.isArray(existingProfile.response_modes)
      ? existingProfile.response_modes
      : baseline.response_modes,
    disagreement_style: alreadyCurrent && typeof existingProfile.disagreement_style === 'string'
      ? existingProfile.disagreement_style
      : baseline.disagreement_style,
    memory_callback_style: alreadyCurrent && typeof existingProfile.memory_callback_style === 'string'
      ? existingProfile.memory_callback_style
      : baseline.memory_callback_style,
    tts_profile: { ...baseline.tts_profile, ...existingProfile.tts_profile },
    expression_profile: { ...baseline.expression_profile, ...existingProfile.expression_profile },
    evolution_preferences: { ...baseline.evolution_preferences, ...existingProfile.evolution_preferences },
    roleplay_contract: alreadyCurrent
      ? { ...baseline.roleplay_contract, ...existingProfile.roleplay_contract }
      : baseline.roleplay_contract,
  };
}

function migrateWorldToCurrentSetting(world, now) {
  const next = clone(world);
  let changed = false;
  let multisourceChanged = false;
  const timestamp = now().toISOString();
  const wasCurrentSetting = next.setting?.setting_id === WORLD_SETTING.setting_id
    && next.setting?.version === WORLD_SETTING.version;

  if (!next.setting || next.setting.setting_id !== WORLD_SETTING.setting_id || next.setting.version !== WORLD_SETTING.version) {
    next.setting = createWorldSettingMetadata();
    changed = true;
  }
  if (next.name !== WORLD_SETTING.display_name) {
    next.name = WORLD_SETTING.display_name;
    changed = true;
  }
  const mergedSettlement = next.settlement && typeof next.settlement === 'object' && !Array.isArray(next.settlement)
    ? { ...clone(DEFAULT_SETTLEMENT), ...next.settlement, setting_id: DEFAULT_SETTLEMENT.setting_id }
    : clone(DEFAULT_SETTLEMENT);
  if (!valuesEqual(next.settlement, mergedSettlement)) {
    next.settlement = mergedSettlement;
    changed = true;
  }

  if (!next.protagonist || typeof next.protagonist !== 'object' || Array.isArray(next.protagonist)) {
    next.protagonist = {
      character_id: DEFAULT_CHARACTER_ID,
      character_id_aliases: [...LEGACY_CHARACTER_IDS],
      display_name: DEFAULT_CHARACTER_DISPLAY_NAME,
      display_name_status: DEFAULT_CHARACTER_DISPLAY_NAME_STATUS,
      location_id: DEFAULT_LOCATION_ID,
      travel_state: {
        status: 'idle',
        from_location_id: null,
        to_location_id: null,
        event_id: null,
        reason: null,
        arrived_at: null,
      },
      appearance: createInitialCharacterAppearance(timestamp),
      character_profile: createInitialCharacterProfile(),
    };
    changed = true;
  } else {
    const previousCharacterId = next.protagonist.character_id;
    const canonicalId = canonicalCharacterId(previousCharacterId) || DEFAULT_CHARACTER_ID;
    const aliases = uniqueStrings([
      ...(Array.isArray(next.protagonist.character_id_aliases) ? next.protagonist.character_id_aliases : []),
      ...LEGACY_CHARACTER_IDS,
      ...(previousCharacterId && previousCharacterId !== canonicalId ? [previousCharacterId] : []),
    ]).filter((value) => value !== canonicalId);
    if (next.protagonist.character_id !== canonicalId) {
      next.protagonist.character_id = canonicalId;
      changed = true;
    }
    if (JSON.stringify(next.protagonist.character_id_aliases ?? []) !== JSON.stringify(aliases)) {
      next.protagonist.character_id_aliases = aliases;
      changed = true;
    }
    if (!next.protagonist.display_name || LEGACY_DISPLAY_NAMES.has(next.protagonist.display_name)) {
      next.protagonist.display_name = DEFAULT_CHARACTER_DISPLAY_NAME;
      changed = true;
    }
    if (next.protagonist.display_name_status !== DEFAULT_CHARACTER_DISPLAY_NAME_STATUS) {
      next.protagonist.display_name_status = DEFAULT_CHARACTER_DISPLAY_NAME_STATUS;
      changed = true;
    }
    const mergedCharacterProfile = mergeCharacterProfile(next.protagonist.character_profile);
    if (!valuesEqual(next.protagonist.character_profile, mergedCharacterProfile)) {
      next.protagonist.character_profile = mergedCharacterProfile;
      changed = true;
    }
    const canonicalProtagonistLocation = canonicalLocationId(next.protagonist.location_id) || DEFAULT_LOCATION_ID;
    if (next.protagonist.location_id !== canonicalProtagonistLocation) {
      next.protagonist.location_id = canonicalProtagonistLocation;
      changed = true;
    }
    const baselineTravelState = {
      status: 'idle',
      from_location_id: null,
      to_location_id: null,
      event_id: null,
      reason: null,
      arrived_at: null,
    };
    const existingTravelState = next.protagonist.travel_state;
    const mergedTravelState = existingTravelState && typeof existingTravelState === 'object' && !Array.isArray(existingTravelState)
      ? { ...baselineTravelState, ...existingTravelState }
      : baselineTravelState;
    if (!valuesEqual(existingTravelState, mergedTravelState)) {
      next.protagonist.travel_state = mergedTravelState;
      changed = true;
    }
    if (!next.protagonist.appearance || typeof next.protagonist.appearance !== 'object' || Array.isArray(next.protagonist.appearance)) {
      next.protagonist.appearance = createInitialCharacterAppearance(timestamp);
      changed = true;
    } else if (next.protagonist.appearance.version === 'appearance-baseline-v0.1') {
      const previousGenerationLayer = next.protagonist.appearance.generation_layer;
      next.protagonist.appearance = createInitialCharacterAppearance(timestamp);
      if (previousGenerationLayer && typeof previousGenerationLayer === 'object' && !Array.isArray(previousGenerationLayer)) {
        next.protagonist.appearance.generation_layer = previousGenerationLayer;
      }
      changed = true;
    }
    if (next.protagonist.appearance.model_label === '喵伴出厂造型') {
      next.protagonist.appearance.model_label = createInitialCharacterAppearance(timestamp).model_label;
      changed = true;
    }
  }

  const defaultLocations = clone(DEFAULT_WORLD_LOCATIONS);
  const defaultLocationsById = new Map(defaultLocations.map((location) => [location.location_id, location]));
  const existingLocations = Array.isArray(next.locations) ? next.locations : [];
  const locations = existingLocations.map((location) => {
    const migrated = { ...location };
    const canonicalId = canonicalLocationId(location.location_id) || location.location_id;
    if (canonicalId && migrated.location_id !== canonicalId) {
      migrated.location_id = canonicalId;
      migrated.location_id_aliases = uniqueStrings([
        ...(Array.isArray(migrated.location_id_aliases) ? migrated.location_id_aliases : []),
        location.location_id,
      ]).filter((value) => value !== canonicalId);
    }
    const definition = defaultLocationsById.get(canonicalId);
    if (definition) {
      Object.assign(migrated, { ...definition, ...migrated, neighbors: [...new Set([...(migrated.neighbors ?? []), ...definition.neighbors])], presentation: definition.presentation });
    }
    if (canonicalId === DEFAULT_LOCATION_ID) {
      migrated.location_id_aliases = uniqueStrings([
        ...(Array.isArray(migrated.location_id_aliases) ? migrated.location_id_aliases : []),
        ...LEGACY_LOCATION_IDS,
      ]).filter((value) => value !== canonicalId);
    }
    return migrated;
  });
  for (const definition of defaultLocations) {
    if (!locations.some((location) => location.location_id === definition.location_id)) {
      locations.push(definition);
    }
  }

  const lifeDefault = createInitialLifeState();
  const existingLife = next.life;
  const mergedLife = existingLife && typeof existingLife === 'object' && !Array.isArray(existingLife)
    ? {
        ...lifeDefault,
        ...existingLife,
        schema: lifeDefault.schema,
        recent_scenes: Array.isArray(existingLife.recent_scenes) ? existingLife.recent_scenes.slice(-12) : [],
        recent_experiences: Array.isArray(existingLife.recent_experiences) ? existingLife.recent_experiences.slice(-20) : [],
      }
    : lifeDefault;
  if (!valuesEqual(existingLife, mergedLife)) {
    next.life = mergedLife;
    changed = true;
  }
  if (JSON.stringify(next.locations ?? []) !== JSON.stringify(locations)) {
    next.locations = locations;
    changed = true;
    const migrations = Array.isArray(next.schema_migrations) ? next.schema_migrations : [];
    if (!migrations.some((migration) => migration.id === 'canonical-world-map-p1')) {
      next.schema_migrations = [...migrations, {
        id: 'canonical-world-map-p1',
        applied_at: timestamp,
      }];
    }
  }

  if (!next.map_catalog) {
    const originalIds = new Set(existingLocations.map(place => canonicalLocationId(place.location_id)));
    installWorldMapContent(next, loadWorldMapContent(), timestamp);
    const beforeRevision = next.world_revision;
    next.world_revision += 1;
    next.schema_migrations = [...(next.schema_migrations ?? []), {
      id: 'companion-living-map-v1', applied_at: timestamp,
      before_revision: beforeRevision, after_revision: next.world_revision,
      content_id: next.map_catalog.content_id, version: next.map_catalog.version,
      added_location_ids: next.map_catalog.locations.filter(place => !originalIds.has(place.location_id)).map(place => place.location_id),
      preserved_location_ids: [...originalIds],
    }];
    changed = true;
  }

  if (upgradeAuthoredScene(next, timestamp)) changed = true;
  if (installLivingResources(next, timestamp)) {
    changed = true; next.world_revision += 1;
    next.schema_migrations=[...(next.schema_migrations??[]),{id:'morrowmere-living-resources-v1',applied_at:timestamp,scope:'additive_resources',preserved_existing_tasks:true}];
  }
  if (installResourceRenewal(next, timestamp)) {
    changed = true; next.world_revision += 1;
    next.schema_migrations=[...(next.schema_migrations??[]),{id:'morrowmere-resource-renewal-v1',applied_at:timestamp,scope:'additive_spring_source',preserved_existing_tasks:true,preserved_existing_stocks:true}];
  }
  if (installResidentProjects(next, timestamp)) {
    changed = true; next.world_revision += 1;
    next.schema_migrations=[...(next.schema_migrations??[]),{id:'morrowmere-resident-projects-v1',applied_at:timestamp,scope:'additive_resident_projects',preserved_existing_tasks:true,preserved_existing_stocks:true,past_events_created:0}];
  }

  const initialField = createInitialShapingField(
    typeof next.shaping_field?.shaping_time === 'string' ? next.shaping_field.shaping_time : timestamp,
  );
  if (!next.shaping_field || typeof next.shaping_field !== 'object' || Array.isArray(next.shaping_field)) {
    next.shaping_field = initialField;
    changed = true;
  } else {
    const mergedField = {
      ...initialField,
      ...next.shaping_field,
      schema: initialField.schema,
      version: initialField.version,
      field_definitions: initialField.field_definitions,
    };
    if (JSON.stringify(next.shaping_field) !== JSON.stringify(mergedField)) {
      next.shaping_field = mergedField;
      changed = true;
    }
  }

  const multisourceDefaults = createMultisourceState();
  for (const [key, fallback] of Object.entries(multisourceDefaults)) {
    const existing = next[key];
    const merged = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...fallback, ...existing }
      : fallback;
    if (!valuesEqual(existing, merged)) {
      next[key] = merged;
      changed = true;
      multisourceChanged = true;
    }
  }
  if (next.schema !== 'foundry.canonical-world.v0.2') {
    next.schema = 'foundry.canonical-world.v0.2';
    changed = true;
    multisourceChanged = true;
  }

  if (multisourceChanged) {
    const migrations = Array.isArray(next.schema_migrations) ? next.schema_migrations : [];
    if (!migrations.some((migration) => migration.id === 'canonical-world-multisource-v0.2')) {
      next.schema_migrations = [...migrations, {
        id: 'canonical-world-multisource-v0.2',
        applied_at: timestamp,
      }];
    }
  }

  if (changed) {
    if (!wasCurrentSetting) {
      next.setting_migration = {
        id: 'world-setting-shaping-field-v2.1',
        from: 'legacy-deskbot-world',
        to: WORLD_SETTING.setting_id,
        applied_at: timestamp,
        preserved_character_ids: uniqueStrings([
          ...(Array.isArray(next.protagonist.character_id_aliases) ? next.protagonist.character_id_aliases : []),
          ...LEGACY_CHARACTER_IDS,
        ]),
      };
    }
    next.updated_at = timestamp;
  }

  return { world: next, changed };
}

function turnKeyFor(event) {
  const correlationId = typeof event.correlation_id === 'string' && event.correlation_id.trim() !== ''
    ? event.correlation_id.trim()
    : event.event_id;
  return `${canonicalCharacterId(event.character_id) ?? 'unbound'}:${correlationId}`;
}

function isVoiceTransportEvent(event) {
  return event.type === 'voice.asr.partial'
    || event.type === 'voice.asr.final'
    || event.type === 'voice.partial'
    || event.type === 'voice.final'
    || event.type === 'conversation.input.partial'
    || event.type === 'conversation.input.final'
    || event.payload?.stage === 'partial'
    || event.payload?.stage === 'final';
}

function ensureWorldTarget(event, world) {
  const requestedWorldId = event.world_id ?? event.payload?.world_id ?? world.world_id;
  if (requestedWorldId !== world.world_id) {
    throw new PersistentWorldError(404, 'world_not_found', `world ${requestedWorldId} does not exist`);
  }
  if (event.character_id && !characterIdsEqual(event.character_id, world.protagonist.character_id)) {
    throw new PersistentWorldError(
      409,
      'world_character_conflict',
      `world ${world.world_id} belongs to protagonist ${world.protagonist.character_id}`,
    );
  }
}

function normalizeActiveEvent(value) {
  const event = requireObject(value, 'payload.event');
  return {
    event_id: requireText(event.event_id, 'payload.event.event_id'),
    title: requireText(event.title, 'payload.event.title'),
    summary: optionalText(event.summary, 'payload.event.summary', ''),
    daily_consequence: optionalText(event.daily_consequence, 'payload.event.daily_consequence', null),
    opportunity: optionalText(event.opportunity, 'payload.event.opportunity', null),
    unresolved_hook: optionalText(event.unresolved_hook, 'payload.event.unresolved_hook', null),
    arc_id: optionalText(event.arc_id ?? event.arc, 'payload.event.arc_id', null),
    source: optionalText(event.source, 'payload.event.source', 'world.mutation'),
    blocks_travel: event.blocks_travel === true,
  };
}

function normalizePendingItem(value) {
  const item = requireObject(value, 'payload.item');
  return {
    item_id: requireText(item.item_id, 'payload.item.item_id'),
    kind: optionalText(item.kind, 'payload.item.kind', 'task'),
    summary: requireText(item.summary, 'payload.item.summary'),
    source: optionalText(item.source, 'payload.item.source', 'world.mutation'),
  };
}

function normalizeNpc(value, world, existing = null) {
  const npc = requireObject(value, 'payload.npc');
  const requestedLocationId = optionalText(
    npc.location_id,
    'payload.npc.location_id',
    world.protagonist.location_id,
  );
  const locationId = canonicalLocationId(requestedLocationId);
  if (!world.locations.some((location) => location.location_id === locationId)) {
    throw new PersistentWorldError(400, 'invalid_world_mutation', `unknown NPC location ${locationId}`);
  }
  return {
    ...existing,
    npc_id: requireText(npc.npc_id, 'payload.npc.npc_id'),
    display_name: requireText(npc.display_name, 'payload.npc.display_name'),
    role: optionalText(npc.role, 'payload.npc.role', existing?.role ?? 'visitor'),
    location_id: locationId,
    status: optionalText(npc.status, 'payload.npc.status', existing?.status ?? 'present'),
    bio: optionalText(npc.bio, 'payload.npc.bio', existing?.bio ?? null),
    temperament: optionalText(npc.temperament, 'payload.npc.temperament', existing?.temperament ?? null),
    speech_style: optionalText(npc.speech_style, 'payload.npc.speech_style', existing?.speech_style ?? null),
    accent: optionalText(npc.accent, 'payload.npc.accent', existing?.accent ?? null),
    relationship: existing?.relationship && typeof existing.relationship === 'object'
      ? clone(existing.relationship)
      : { familiarity: 0, trust: 0, encounters: 0 },
    last_action: existing?.last_action ?? null,
    last_action_at: existing?.last_action_at ?? null,
    last_response: existing?.last_response ?? null,
    last_interaction: existing?.last_interaction ? clone(existing.last_interaction) : null,
    recent_interactions: Array.isArray(existing?.recent_interactions) ? clone(existing.recent_interactions.slice(-10)) : [],
  };
}

function normalizeLifeScene(value, world) {
  const scene = requireObject(value, 'payload.scene');
  const locationId = canonicalLocationId(requireText(scene.location_id, 'payload.scene.location_id'));
  if (!world.locations.some((location) => location.location_id === locationId)) {
    throw new PersistentWorldError(400, 'invalid_world_mutation', `unknown Scene location ${locationId}`);
  }
  const participants = Array.isArray(scene.participants)
    ? uniqueStrings(scene.participants.map((value) => requireText(value, 'payload.scene.participants[]')))
    : [];
  for (const npcId of participants) {
    const npc = world.npcs.find((item) => item.npc_id === npcId);
    if (!npc || npc.location_id !== locationId) {
      throw new PersistentWorldError(409, 'scene_participant_not_present', `NPC ${npcId} is not present at ${locationId}`);
    }
  }
  return {
    scene_id: requireText(scene.scene_id, 'payload.scene.scene_id'),
    content_version: optionalText(scene.content_version, 'payload.scene.content_version', null),
    template_id: optionalText(scene.template_id, 'payload.scene.template_id', null),
    slot_key: optionalText(scene.slot_key, 'payload.scene.slot_key', null),
    location_id: locationId,
    title: requireText(scene.title, 'payload.scene.title'),
    narration: optionalText(scene.narration, 'payload.scene.narration', ''),
    sensory_cue: optionalText(scene.sensory_cue, 'payload.scene.sensory_cue', null),
    opportunity: optionalText(scene.opportunity, 'payload.scene.opportunity', null),
    time_band: optionalText(scene.time_band, 'payload.scene.time_band', null),
    participants,
    source_factors: optionalObject(scene.source_factors, 'payload.scene.source_factors', {}),
    continuity: optionalObject(scene.continuity, 'payload.scene.continuity', null),
    arc_id: optionalText(scene.arc_id, 'payload.scene.arc_id', null),
    cause_event_ids: Array.isArray(scene.cause_event_ids)
      ? uniqueStrings(scene.cause_event_ids.map((item) => requireText(item, 'payload.scene.cause_event_ids[]'))).slice(0, 8)
      : [],
    cause_experience_ids: Array.isArray(scene.cause_experience_ids)
      ? uniqueStrings(scene.cause_experience_ids.map((item) => requireText(item, 'payload.scene.cause_experience_ids[]'))).slice(0, 8)
      : [],
    branch_key: optionalText(scene.branch_key, 'payload.scene.branch_key', null),
    resolution_state: optionalText(scene.resolution_state, 'payload.scene.resolution_state', null),
    started_at: optionalDateTime(scene.started_at, 'payload.scene.started_at', null),
    expires_at: optionalDateTime(scene.expires_at, 'payload.scene.expires_at', null),
    continuation_count: 0,
    status: 'active',
  };
}

function normalizeRoleDirection(value) {
  if (value === undefined || value === null) return null;
  const direction = requireObject(value, 'payload.role_direction');
  const cues = Array.isArray(direction.cues)
    ? uniqueStrings(direction.cues.map((cue) => requireText(cue, 'payload.role_direction.cues[]'))).slice(0, 12)
    : [];
  if (cues.length < 2) {
    throw new PersistentWorldError(400, 'invalid_world_mutation', 'payload.role_direction.cues needs at least two cues');
  }
  return {
    direction_id: requireText(direction.direction_id, 'payload.role_direction.direction_id'),
    label: requireText(direction.label, 'payload.role_direction.label'),
    life: requireText(direction.life, 'payload.role_direction.life'),
    cues,
  };
}

function normalizeLifeExperience(value, context) {
  if (value === undefined || value === null) return null;
  const experience = requireObject(value, 'payload.experience');
  return {
    experience_id: requireText(experience.experience_id, 'payload.experience.experience_id'),
    kind: optionalText(experience.kind, 'payload.experience.kind', 'npc_interaction'),
    npc_id: context.npc_id,
    npc_name: optionalText(experience.npc_name, 'payload.experience.npc_name', null),
    scene_id: optionalText(experience.scene_id, 'payload.experience.scene_id', null),
    location_id: context.location_id,
    intent: context.intent,
    summary: requireText(experience.summary, 'payload.experience.summary'),
    occurred_at: optionalDateTime(experience.occurred_at, 'payload.experience.occurred_at', context.occurred_at),
    role_direction: context.role_direction,
  };
}

function normalizeWorldLineEvent(value) {
  const item = requireObject(value, 'payload.event');
  const eventId = requireText(item.event_id, 'payload.event.event_id');
  return {
    event_id: eventId,
    title: requireText(item.title, 'payload.event.title'),
    summary: optionalText(item.summary, 'payload.event.summary', ''),
    daily_consequence: optionalText(item.daily_consequence, 'payload.event.daily_consequence', null),
    opportunity: optionalText(item.opportunity, 'payload.event.opportunity', null),
    unresolved_hook: optionalText(item.unresolved_hook, 'payload.event.unresolved_hook', null),
    arc_id: optionalText(item.arc_id ?? item.arc, 'payload.event.arc_id', null),
    status: optionalText(item.status, 'payload.event.status', 'active'),
    outcome: optionalText(item.outcome, 'payload.event.outcome', null),
    source: optionalText(item.source, 'payload.event.source', 'world-engine'),
    occurred_at: optionalDateTime(item.occurred_at, 'payload.event.occurred_at', null),
  };
}

function normalizeWeatherSnapshot(payload) {
  const snapshot = requireObject(payload.snapshot ?? payload.weather, 'payload.snapshot');
  return {
    location: optionalText(snapshot.location, 'payload.snapshot.location', null),
    condition: optionalText(snapshot.condition, 'payload.snapshot.condition', null),
    temperature_c: boundedNumber(snapshot.temperature_c, 'payload.snapshot.temperature_c', -90, 70),
    humidity: boundedNumber(snapshot.humidity, 'payload.snapshot.humidity', 0, 1),
    wind_mps: boundedNumber(snapshot.wind_mps, 'payload.snapshot.wind_mps', 0, 150),
    observed_at: optionalDateTime(
      snapshot.observed_at ?? payload.observed_at,
      'payload.snapshot.observed_at',
      null,
    ),
    provider: optionalText(snapshot.provider ?? payload.provider, 'payload.snapshot.provider', null),
  };
}

function normalizeExternalContext(payload) {
  const item = requireObject(payload.item ?? payload.context, 'payload.item');
  return {
    item_id: requireText(item.item_id ?? item.id ?? payload.item_id, 'payload.item.item_id'),
    title: requireText(item.title, 'payload.item.title'),
    summary: optionalText(item.summary, 'payload.item.summary', ''),
    category: optionalText(item.category, 'payload.item.category', 'news'),
    url: optionalText(item.url, 'payload.item.url', null),
    published_at: optionalDateTime(item.published_at, 'payload.item.published_at', null),
    observed_at: optionalDateTime(item.observed_at ?? payload.observed_at, 'payload.item.observed_at', null),
    provider: optionalText(item.provider ?? payload.provider, 'payload.item.provider', null),
  };
}

function normalizeCalendar(payload, current) {
  const date = optionalDateTime(payload.date, 'payload.date', current.date);
  if (date && current.date && Date.parse(date) < Date.parse(current.date)) {
    throw new PersistentWorldError(409, 'calendar_time_conflict', 'calendar date cannot move backwards');
  }
  return {
    date,
    timezone: optionalText(payload.timezone, 'payload.timezone', current.timezone),
    season: optionalText(payload.season, 'payload.season', current.season),
    solar_term: optionalText(payload.solar_term, 'payload.solar_term', current.solar_term),
    holiday: optionalText(payload.holiday, 'payload.holiday', current.holiday),
    observed_at: optionalDateTime(payload.observed_at, 'payload.observed_at', null),
  };
}

function normalizePreferenceKey(value) {
  const key = requireText(value, 'payload.preference_key');
  if (key.length > 120 || key.startsWith('/') || key.includes('..')) {
    throw new PersistentWorldError(400, 'invalid_world_mutation', 'payload.preference_key must be a bounded key');
  }
  return key;
}

function normalizeDeviceContext(payload) {
  const deviceId = requireText(payload.device_id ?? payload.device?.device_id, 'payload.device_id');
  const device = payload.device && typeof payload.device === 'object' && !Array.isArray(payload.device)
    ? payload.device
    : payload;
  return {
    device_id: deviceId,
    status: optionalText(device.status, 'payload.status', 'observed'),
    metrics: optionalObject(device.metrics, 'payload.metrics', null),
    state: optionalObject(device.state, 'payload.state', null),
    observed_at: optionalDateTime(device.observed_at ?? payload.observed_at, 'payload.observed_at', null),
  };
}

function applyWorldLineEvent(next, payload) {
  const item = normalizeWorldLineEvent(payload.event ?? payload.world_event);
  next.world_line.latest_event = item;
  next.world_line.recent_events = appendUniqueWorldLineEvent(next.world_line.recent_events, item);
  if (item.arc_id !== null) next.world_line.current_arc = item.arc_id;
  return { action: 'apply_world_line_event', details: { event: clone(item) } };
}

function applyWeatherUpdate(next, payload, event) {
  const snapshot = normalizeWeatherSnapshot(payload);
  const previousObservedAt = next.weather.snapshot?.observed_at ?? null;
  if (previousObservedAt && snapshot.observed_at && Date.parse(snapshot.observed_at) < Date.parse(previousObservedAt)) {
    return {
      action: 'update_weather',
      details: { accepted: false, reason: 'stale_observation', observed_at: snapshot.observed_at, previous_observed_at: previousObservedAt },
    };
  }
  next.weather.status = snapshot.condition ?? 'observed';
  next.weather.snapshot = snapshot;
  next.weather.provenance = event?.provenance ? clone(event.provenance) : null;
  return { action: 'update_weather', details: { accepted: true, snapshot: clone(snapshot) } };
}

function applyExternalContext(next, payload) {
  const item = normalizeExternalContext(payload);
  const existing = next.external_context.items.findIndex((entry) => entry.item_id === item.item_id);
  if (existing >= 0) next.external_context.items[existing] = item;
  else next.external_context.items = appendBounded(next.external_context.items, item);
  return { action: 'record_external_context', details: { item: clone(item), operation: existing >= 0 ? 'replace' : 'append' } };
}

function applyCalendarAdvance(next, payload) {
  const calendar = normalizeCalendar(payload, next.calendar);
  next.calendar = { ...next.calendar, ...calendar };
  return { action: 'advance_calendar', details: { calendar: clone(calendar) } };
}

function applyPreferenceObservation(next, payload, event) {
  const key = normalizePreferenceKey(payload.preference_key ?? payload.key);
  const value = requirePreferenceValue(payload.value, 'payload.value');
  const current = next.user_profile.preferences[key] ?? {
    value: null,
    observations: 0,
    stable: false,
    history: [],
  };
  const sameValue = current.observations > 0 && valuesEqual(current.value, value);
  const observations = sameValue ? current.observations + 1 : 1;
  const record = {
    value: clone(value),
    observations,
    stable: observations >= PREFERENCE_STABLE_OBSERVATIONS,
    first_observed_at: sameValue ? current.first_observed_at : (event.observed_at ?? event.occurred_at ?? null),
    last_observed_at: event.observed_at ?? event.occurred_at ?? null,
    history: appendBounded([
      ...(Array.isArray(current.history) ? current.history : []),
      { value: clone(value), observed_at: event.observed_at ?? event.occurred_at ?? null },
    ], PREFERENCE_STABLE_OBSERVATIONS),
  };
  next.user_profile.preferences[key] = record;
  return {
    action: 'observe_user_preference',
    details: { preference_key: key, value: clone(value), observations, stable: record.stable },
  };
}

function applyDeviceContext(next, payload) {
  const item = normalizeDeviceContext(payload);
  next.device_context.devices[item.device_id] = item;
  next.device_context.recent_events = appendBounded(next.device_context.recent_events, item);
  return { action: 'record_device_context', details: { device: clone(item) } };
}

function applyNpcAction(next, payload, event, at) {
  const npcId = requireText(payload.npc_id, 'payload.npc_id');
  const index = next.npcs.findIndex((npc) => npc.npc_id === npcId);
  if (index === -1) {
    throw new PersistentWorldError(409, 'npc_not_found', `NPC ${npcId} does not exist`);
  }
  const npc = { ...next.npcs[index] };
  const actionName = requireText(payload.action_name ?? payload.npc_action ?? payload.command, 'payload.action_name');
  if (next.clock?.mode === 'real_time' && activeWorldTask(next, npcId)) {
    throw new PersistentWorldError(409, 'actor_busy', 'NPC has an unfinished task');
  }
  if (payload.location_id !== undefined) {
    const locationId = canonicalLocationId(requireText(payload.location_id, 'payload.location_id'));
    if (!next.locations.some((location) => location.location_id === locationId)) {
      throw new PersistentWorldError(400, 'invalid_world_mutation', `unknown NPC location ${locationId}`);
    }
    if (locationId !== npc.location_id) {
      const origin = next.locations.find((location) => location.location_id === npc.location_id);
      const neighbors = Array.isArray(origin?.neighbors) ? origin.neighbors.map(canonicalLocationId) : [];
      if (!neighbors.includes(locationId)) {
        throw new PersistentWorldError(409, 'npc_location_not_reachable', `${locationId} is not adjacent to ${npc.location_id}`);
      }
      const access = worldHopAccess(next, npc.location_id, locationId);
      if (!access.allowed) throw new PersistentWorldError(409, access.code, access.reason);
    }
    if (next.clock?.mode === 'real_time' && locationId !== npc.location_id) {
      const details = startTravelTask(next, { eventId: event.event_id, at, actorId: npcId, locationId,
        destinationId: payload.destination_location_id ?? locationId, reason: actionName, arrivalStatus: payload.status ?? npc.status });
      return { action: 'npc_action', details: { ...details, npc_id: npcId, action_name: actionName } };
    }
    npc.location_id = locationId;
  }
  if (payload.status !== undefined) npc.status = optionalText(payload.status, 'payload.status', npc.status);
  npc.last_action = actionName;
  npc.last_action_at = optionalDateTime(payload.occurred_at, 'payload.occurred_at', null);
  next.npcs[index] = npc;
  return { action: 'npc_action', details: { npc_id: npcId, action_name: actionName, npc: clone(npc) } };
}

function applyLifeScene(next, payload) {
  const scene = normalizeLifeScene(payload.scene, next);
  const previous = next.life?.current_scene ?? null;
  next.life ??= createInitialLifeState();
  if (previous && previous.scene_id !== scene.scene_id) {
    next.life.recent_scenes = appendBounded(
      Array.isArray(next.life.recent_scenes) ? next.life.recent_scenes : [],
      { ...previous, status: 'ended', ended_at: scene.started_at },
      12,
    );
  }
  next.life.current_scene = scene;
  return { action: 'set_life_scene', details: { scene: clone(scene), previous_scene_id: previous?.scene_id ?? null } };
}

function applyLifeSceneContinuation(next, payload) {
  next.life ??= createInitialLifeState();
  const current = next.life.current_scene;
  const sceneId = requireText(payload.scene_id, 'payload.scene_id');
  if (!current || current.scene_id !== sceneId) {
    throw new PersistentWorldError(409, 'life_scene_not_current', `Scene ${sceneId} is not current`);
  }
  current.slot_key = requireText(payload.slot_key, 'payload.slot_key');
  current.expires_at = optionalDateTime(payload.expires_at, 'payload.expires_at', current.expires_at);
  current.source_factors = optionalObject(payload.source_factors, 'payload.source_factors', current.source_factors ?? {});
  current.continuity = optionalObject(payload.continuity, 'payload.continuity', current.continuity ?? null);
  current.continuation_count = Math.max(0, Number(current.continuation_count) || 0) + 1;
  return { action: 'continue_life_scene', details: { scene_id: sceneId, slot_key: current.slot_key, continuation_count: current.continuation_count } };
}

function applyNpcInteraction(next, payload) {
  const interactionId = requireText(payload.interaction_id, 'payload.interaction_id');
  const npcId = requireText(payload.npc_id, 'payload.npc_id');
  const intent = requireText(payload.intent, 'payload.intent');
  if (!['observe', 'greet', 'chat', 'suggest', 'help', 'invite'].includes(intent)) {
    throw new PersistentWorldError(400, 'invalid_npc_interaction', `unsupported NPC intent ${intent}`);
  }
  const index = next.npcs.findIndex((npc) => npc.npc_id === npcId);
  if (index === -1) throw new PersistentWorldError(404, 'npc_not_found', `NPC ${npcId} does not exist`);
  const npc = { ...next.npcs[index] };
  if (activeWorldTask(next)?.kind === 'travel' || activeWorldTask(next, npcId)?.kind === 'travel') {
    throw new PersistentWorldError(409, 'actor_travelling', 'Travelling actors cannot have a local encounter');
  }
  if (npc.location_id !== next.protagonist.location_id) {
    throw new PersistentWorldError(409, 'npc_not_present', `NPC ${npcId} is not at the protagonist location`);
  }
  const familiarityGain = { observe: 1, greet: 2, chat: 2, suggest: 3, help: 4, invite: 3 }[intent];
  const trustGain = { observe: 0, greet: 1, chat: 1, suggest: 1, help: 2, invite: 1 }[intent];
  const relationship = npc.relationship && typeof npc.relationship === 'object' ? npc.relationship : {};
  npc.relationship = {
    familiarity: Math.min(100, Math.max(0, Number(relationship.familiarity) || 0) + familiarityGain),
    trust: Math.min(100, Math.max(0, Number(relationship.trust) || 0) + trustGain),
    encounters: Math.max(0, Number(relationship.encounters) || 0) + 1,
  };
  const interaction = {
    interaction_id: interactionId,
    intent,
    idea: optionalText(payload.idea, 'payload.idea', null),
    response: requireText(payload.response, 'payload.response'),
    occurred_at: optionalDateTime(payload.occurred_at, 'payload.occurred_at', null),
  };
  const roleDirection = normalizeRoleDirection(payload.role_direction);
  const experience = normalizeLifeExperience(payload.experience, {
    npc_id: npcId,
    location_id: npc.location_id,
    intent,
    occurred_at: interaction.occurred_at,
    role_direction: roleDirection,
  });
  npc.last_action = `respond_${intent}`;
  npc.last_action_at = interaction.occurred_at;
  npc.last_response = interaction.response;
  npc.last_interaction = interaction;
  npc.recent_interactions = appendBounded([...(Array.isArray(npc.recent_interactions) ? npc.recent_interactions : [])], interaction, 10);
  next.npcs[index] = npc;
  next.life ??= createInitialLifeState();
  if (experience) {
    next.life.recent_experiences = appendBounded(
      Array.isArray(next.life.recent_experiences) ? next.life.recent_experiences : [],
      experience,
      20,
    );
  }
  return { action: 'npc_interaction', details: { npc_id: npcId, intent, relationship: clone(npc.relationship), interaction: clone(interaction), experience: clone(experience) } };
}

export function previewWorldMutations(world, payloads) {
  let projected = clone(world);
  // Plan validation projects eventual locations; it never creates real tasks.
  delete projected.clock;
  projected.tasks = [];
  for (const payload of payloads) projected = applyExplicitMutation(projected, { payload }).next;
  return projected;
}

function applyExplicitMutation(world, event, at = world.clock?.synced_at ?? event.occurred_at) {
  const payload = requireObject(event.payload, 'payload');
  const action = requireText(payload.action, 'payload.action');
  const next = clone(world);
  let details;

  switch (action) {
    case 'install_input_refraction':
      details=installRefraction(next,at);break;
    case 'install_resident_life':
      details=installResidentLife(next,at);
      installResidentProjects(next,at);break;
    case 'respond_social_invitation':
      details=respondSocialInvitation(next,at,payload.invitation_id,payload.operation);break;
    case 'install_lived_memory':
      details=installLivedMemory(next,at,{plannerEnabled:payload.planner_enabled===true});break;
    case 'claim_life_choice':
    case 'resolve_life_choice':
      details=applyLifeChoice(next,at,payload);break;
    case 'advance_autonomous_life':
      details = advanceAutonomousLife(next, at, { eventId: event.event_id, reservedActors: payload.reserved_actors ?? [] });
      break;
    case 'control_autonomy':
      details = controlAutonomy(next, at, payload.operation);
      break;
    case 'sync_real_time':
      details = applyRealTimeClock(next, at, payload.time_zone);
      break;
    case 'advance_living_world':
      if (Date.parse(payload.until) > Date.parse(at)) throw new PersistentWorldError(409, 'living_future_forbidden', 'Cannot advance living resources past server time');
      details = advanceLivingResources(next, payload.until, { force: payload.force === true });
      break;
    case 'transfer_resource':
      advanceLivingResources(next, at, { force: true });
      details = transferLivingResource(next, payload, at);
      break;
    case 'start_activity':
      advanceLivingResources(next, at, { force: true });
      details = startActivityTask(next, payload, { eventId: event.event_id, at });
      break;
    case 'control_task':
      advanceLivingResources(next, at, { force: true });
      details = controlWorldTask(next, payload, at);
      break;
    case 'advance_task':
      details = advanceWorldTask(next, payload, at);
      break;
    case 'advance_time': {
      if (next.clock?.mode === 'real_time') throw new PersistentWorldError(409, 'real_time_clock_locked', 'Real-time worlds cannot fast-forward');
      const minutes = boundedInteger(payload.minutes, 'payload.minutes', 1, 7 * MINUTES_PER_DAY);
      const totalMinutes = next.logical_time.minute_of_day + minutes;
      next.logical_time.day += Math.floor(totalMinutes / MINUTES_PER_DAY);
      next.logical_time.minute_of_day = totalMinutes % MINUTES_PER_DAY;
      details = { minutes };
      break;
    }
    case 'activate_event': {
      if (next.active_event !== null) {
        throw new PersistentWorldError(409, 'active_event_conflict', 'an active event already exists');
      }
      next.active_event = normalizeActiveEvent(payload.event);
      details = { active_event: clone(next.active_event) };
      break;
    }
    case 'resolve_active_event': {
      if (next.active_event === null) {
        throw new PersistentWorldError(409, 'active_event_missing', 'there is no active event to resolve');
      }
      const expectedId = optionalText(payload.event_id, 'payload.event_id', next.active_event.event_id);
      if (expectedId !== next.active_event.event_id) {
        throw new PersistentWorldError(409, 'active_event_conflict', `active event is ${next.active_event.event_id}`);
      }
      const resolvedEvent = clone(next.active_event);
      const outcome = optionalText(payload.outcome, 'payload.outcome', null);
      next.active_event = null;
      const worldLineEvent = {
        ...resolvedEvent,
        status: 'resolved',
        outcome,
        occurred_at: event.occurred_at ?? null,
      };
      next.world_line.latest_event = worldLineEvent;
      next.world_line.recent_events = appendUniqueWorldLineEvent(next.world_line.recent_events, worldLineEvent);
      if (worldLineEvent.arc_id !== null && worldLineEvent.arc_id !== undefined) next.world_line.current_arc = worldLineEvent.arc_id;
      details = {
        resolved_event: resolvedEvent,
        outcome,
      };
      break;
    }
    case 'enqueue_pending_item': {
      if (next.pending_items.length >= MAX_PENDING_ITEMS) {
        throw new PersistentWorldError(409, 'pending_queue_full', `pending_items is limited to ${MAX_PENDING_ITEMS}`);
      }
      const item = normalizePendingItem(payload.item);
      if (next.pending_items.some((existing) => existing.item_id === item.item_id)) {
        throw new PersistentWorldError(409, 'pending_item_conflict', `pending item ${item.item_id} already exists`);
      }
      next.pending_items.push(item);
      details = { pending_item: clone(item) };
      break;
    }
    case 'dequeue_pending_item': {
      if (next.pending_items.length === 0) {
        throw new PersistentWorldError(409, 'pending_queue_empty', 'pending_items is empty');
      }
      const expectedId = optionalText(payload.item_id, 'payload.item_id', next.pending_items[0].item_id);
      if (expectedId !== next.pending_items[0].item_id) {
        throw new PersistentWorldError(
          409,
          'pending_item_order_conflict',
          `the queue head is ${next.pending_items[0].item_id}`,
        );
      }
      const [item] = next.pending_items.splice(0, 1);
      details = { pending_item: item };
      break;
    }
    case 'upsert_npc': {
      const requestedNpc = requireObject(payload.npc, 'payload.npc');
      const requestedNpcId = requireText(requestedNpc.npc_id, 'payload.npc.npc_id');
      const existingIndex = next.npcs.findIndex((existing) => existing.npc_id === requestedNpcId);
      const npc = normalizeNpc(requestedNpc, next, existingIndex >= 0 ? next.npcs[existingIndex] : null);
      if (next.clock?.mode === 'real_time' && existingIndex >= 0 && npc.location_id !== next.npcs[existingIndex].location_id) {
        throw new PersistentWorldError(409, 'npc_travel_required', 'Existing NPCs must use timed travel');
      }
      if (existingIndex === -1 && next.npcs.length >= (next.resident_life ? 24 : MAX_NPCS)) {
        throw new PersistentWorldError(409, 'npc_limit_reached', `this world supports at most ${MAX_NPCS} NPCs`);
      }
      if (existingIndex === -1) next.npcs.push(npc);
      else next.npcs[existingIndex] = npc;
      details = { npc: clone(npc), operation: existingIndex === -1 ? 'insert' : 'replace' };
      break;
    }
    case 'admit_map_content':
      if (!Number.isSafeInteger(payload.expected_world_revision) || payload.expected_world_revision !== world.world_revision) throw new PersistentWorldError(409, 'map_revision_conflict', 'Map expansion requires the current world revision');
      details = installWorldMapContent(next, payload.content, at, { expansion: true });
      break;
    case 'set_passage_access':
      details = setPassageAccess(next, payload, event.event_id, at);
      break;
    case 'move_protagonist': {
      if (next.clock?.mode === 'real_time') {
        details = startTravelTask(next, { eventId: event.event_id, at, locationId: payload.location_id,
          destinationId: payload.destination_location_id ?? payload.location_id, reason: payload.reason });
        break;
      }
      const locationId = canonicalLocationId(requireText(payload.location_id, 'payload.location_id'));
      const destination = next.locations.find((location) => location.location_id === locationId);
      if (!destination) {
        throw new PersistentWorldError(400, 'invalid_world_mutation', `unknown location ${locationId}`);
      }
      const previousLocationId = next.protagonist.location_id;
      if (previousLocationId === locationId) {
        throw new PersistentWorldError(409, 'already_at_location', `protagonist is already at ${locationId}`);
      }
      const origin = next.locations.find((location) => location.location_id === previousLocationId);
      const neighbors = Array.isArray(origin?.neighbors) ? origin.neighbors.map(canonicalLocationId) : [];
      if (!neighbors.includes(locationId)) {
        throw new PersistentWorldError(409, 'location_not_reachable', `${locationId} is not adjacent to ${previousLocationId}`);
      }
      const access = worldHopAccess(next, previousLocationId, locationId);
      if (!access.allowed) throw new PersistentWorldError(409, access.code, access.reason);
      const travelCost = Number.isInteger(destination.travel_cost) && destination.travel_cost > 0
        ? destination.travel_cost
        : 10;
      next.protagonist.location_id = locationId;
      const totalMinutes = next.logical_time.minute_of_day + travelCost;
      next.logical_time.day += Math.floor(totalMinutes / MINUTES_PER_DAY);
      next.logical_time.minute_of_day = totalMinutes % MINUTES_PER_DAY;
      next.protagonist.travel_state = {
        status: 'arrived',
        from_location_id: previousLocationId,
        to_location_id: locationId,
        event_id: event.event_id ?? null,
        reason: optionalText(payload.reason, 'payload.reason', null),
        arrived_at: event.occurred_at ?? null,
        travel_cost_minutes: travelCost,
      };
      details = {
        from: previousLocationId,
        to: locationId,
        reason: next.protagonist.travel_state.reason,
        travel_cost_minutes: travelCost,
        arrival_text: destination.arrival_text || null,
      };
      break;
    }
    case 'set_life_scene':
      details = applyLifeScene(next, payload).details;
      break;
    case 'continue_life_scene':
      details = applyLifeSceneContinuation(next, payload).details;
      break;
    case 'apply_world_line_event':
      details = applyWorldLineEvent(next, payload).details;
      break;
    case 'update_weather':
      details = applyWeatherUpdate(next, payload, event).details;
      if (details.accepted) { advanceLivingResources(next, at, { force: true }); setLivingWeatherWindow(next, event, at); }
      break;
    case 'record_external_context':
      details = applyExternalContext(next, payload).details;
      break;
    case 'advance_calendar':
      if (next.clock?.mode === 'real_time' && ((payload.date && payload.date !== next.calendar.date)
        || (payload.timezone && payload.timezone !== next.clock.time_zone))) {
        throw new PersistentWorldError(409, 'real_time_clock_locked', 'Calendar date and timezone follow the real clock');
      }
      details = applyCalendarAdvance(next, payload).details;
      break;
    case 'observe_user_preference':
      details = applyPreferenceObservation(next, payload, event).details;
      break;
    case 'record_device_context':
      details = applyDeviceContext(next, payload).details;
      break;
    case 'npc_action':
      details = applyNpcAction(next, payload, event, at).details;
      break;
    case 'npc_interaction':
      details = applyNpcInteraction(next, payload).details;
      break;
    default:
      throw new PersistentWorldError(400, 'unsupported_world_action', `unsupported world mutation action ${action}`);
  }

  return { action, details, next };
}

function applyUserTurn(world, event) {
  const next = clone(world);
  next.interaction.user_turn_count += 1;
  next.interaction.last_user_event_id = event.event_id;
  next.interaction.last_correlation_id = event.correlation_id ?? event.event_id;
  return {
    action: 'record_user_turn',
    details: {
      character_id: canonicalCharacterId(event.character_id),
      correlation_id: event.correlation_id ?? event.event_id,
    },
    next,
  };
}

function finalizeWorld(next, now) {
  next.world_revision += 1;
  next.logical_time.tick += 1;
  next.updated_at = now().toISOString();
  return next;
}

export class PersistentWorldError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'PersistentWorldError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createPersistentWorld({ now = () => new Date(), persistence = null, timeMode = 'simulation', timeZone = 'Asia/Shanghai' } = {}) {
  if (!['simulation', 'realtime'].includes(timeMode)) throw new TypeError('timeMode must be simulation or realtime');
  localWorldDate(now().toISOString(), timeZone);
  const storedWorlds = persistence?.list('canonical-world.states') ?? [];
  const worlds = new Map();
  for (const storedWorld of storedWorlds) {
    const migrated = migrateWorldToCurrentSetting(storedWorld, now);
    worlds.set(migrated.world.world_id, migrated.world);
    if (migrated.changed) persistence?.put('canonical-world.states', migrated.world.world_id, migrated.world);
  }
  if (!worlds.has(DEFAULT_WORLD_ID)) {
    const initial = createDefaultWorld(now);
    installWorldMapContent(initial, loadWorldMapContent(), initial.created_at);
    installLivingResources(initial, initial.created_at);
    worlds.set(initial.world_id, initial);
    persistence?.put('canonical-world.states', initial.world_id, initial);
  }

  const storedMutations = persistence?.list('canonical-world.mutations') ?? [];
  const mutationsByEvent = new Map(storedMutations.map((mutation) => [mutation.event_id, mutation]));
  const mutationsById = new Map(storedMutations.map((mutation) => [mutation.mutation_id, mutation]));
  const countedTurns = new Map(
    (persistence?.list('canonical-world.turns') ?? []).map((turn) => [turn.turn_key, turn]),
  );
  let wallClockMarker = persistence?.get?.(WALL_CLOCK_NAMESPACE, DEFAULT_WORLD_ID) ?? null;
  let nextSequence = storedMutations.reduce(
    (highest, mutation) => Math.max(highest, mutation.sequence ?? 0),
    0,
  ) + 1;

  function get(worldId = DEFAULT_WORLD_ID) {
    const world = worlds.get(worldId);
    return world ? clone(world) : null;
  }

  function listMutations({ worldId = DEFAULT_WORLD_ID, afterSequence = 0, limit = 50, eventId = null } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    const parsedAfter = Math.max(Number.parseInt(afterSequence, 10) || 0, 0);
    return storedMutations
      .filter((mutation) => mutation.world_id === worldId
        && mutation.sequence > parsedAfter
        && (eventId === null || mutation.event_id === eventId))
      .slice(0, boundedLimit)
      .map(clone);
  }

  function persistCommit(world, mutation, countedTurn = null) {
    const operation = () => {
      persistence?.put('canonical-world.states', world.world_id, world);
      if (persistence?.insert) {
        persistence.insert('canonical-world.mutations', mutation.mutation_id, mutation);
      } else {
        persistence?.put('canonical-world.mutations', mutation.mutation_id, mutation);
      }
      if (countedTurn) {
        persistence?.put('canonical-world.turns', countedTurn.turn_key, countedTurn);
      }
    };
    if (persistence?.transaction) persistence.transaction(operation);
    else operation();
  }

  function persistWallClockMarker(marker) {
    const operation = () => persistence.put(WALL_CLOCK_NAMESPACE, DEFAULT_WORLD_ID, marker);
    if (persistence?.transaction) persistence.transaction(operation);
    else operation();
    wallClockMarker = clone(marker);
  }

  function syncWallClock({ maxCatchUpMinutes = WALL_CLOCK_DEFAULT_CATCH_UP_MINUTES } = {}) {
    const snapshot = get();
    if (timeMode === 'realtime' || snapshot.clock?.mode === 'real_time') {
      const at = now().toISOString();
      const local = localWorldDate(at, snapshot.clock?.time_zone ?? timeZone);
      if (snapshot.clock?.mode === 'real_time' && at < snapshot.clock.synced_at) return { enabled: true, clock_moved_backwards: true };
      if (snapshot.clock?.local_date === local.date && snapshot.logical_time.minute_of_day === local.minute_of_day) return { enabled: true, advanced: false };
      const result = ingest({ event_id: `real-clock:${at}`, type: 'world.mutation', source: 'world-real-clock', character_id: DEFAULT_CHARACTER_ID,
        occurred_at: at, payload: { action: 'sync_real_time', time_zone: timeZone } });
      return { enabled: true, advanced: result.applied, clock: result.world.clock };
    }
    if (!persistence?.get || !persistence?.put) {
      return { enabled: false, reason: 'persistence_required' };
    }
    if (!Number.isInteger(maxCatchUpMinutes) || maxCatchUpMinutes < 1 || maxCatchUpMinutes > 7 * MINUTES_PER_DAY) {
      throw new TypeError(`maxCatchUpMinutes must be an integer between 1 and ${7 * MINUTES_PER_DAY}`);
    }

    const currentTime = now();
    const currentMs = currentTime instanceof Date ? currentTime.getTime() : Date.parse(currentTime);
    if (!Number.isFinite(currentMs)) throw new TypeError('now() must return a valid date');
    const currentIso = new Date(currentMs).toISOString();
    let marker = persistence.get(WALL_CLOCK_NAMESPACE, DEFAULT_WORLD_ID) ?? wallClockMarker;

    if (!marker) {
      marker = {
        schema: WALL_CLOCK_SCHEMA,
        world_id: DEFAULT_WORLD_ID,
        last_wall_at: currentIso,
        last_sync_at: currentIso,
        pending: null,
      };
      persistWallClockMarker(marker);
      return {
        enabled: true,
        anchored: true,
        advanced_minutes: 0,
        pending_minutes: 0,
        remainder_ms: 0,
        marker: clone(marker),
      };
    }

    const lastWallMs = Date.parse(marker.last_wall_at);
    if (marker.schema !== WALL_CLOCK_SCHEMA
      || marker.world_id !== DEFAULT_WORLD_ID
      || !Number.isFinite(lastWallMs)) {
      throw new PersistentWorldError(500, 'invalid_world_clock_marker', 'persisted world clock marker is invalid');
    }

    let pending = marker.pending ?? null;
    const recoveredPendingStep = Boolean(pending);
    if (!pending) {
      const elapsedMs = currentMs - lastWallMs;
      if (elapsedMs < 0) {
        return {
          enabled: true,
          anchored: false,
          clock_moved_backwards: true,
          advanced_minutes: 0,
          pending_minutes: 0,
          remainder_ms: 0,
          marker: clone(marker),
        };
      }
      const wholeMinutes = Math.floor(elapsedMs / 60_000);
      const minutes = Math.min(wholeMinutes, maxCatchUpMinutes);
      if (minutes < 1) {
        return {
          enabled: true,
          anchored: false,
          advanced_minutes: 0,
          pending_minutes: 0,
          remainder_ms: elapsedMs,
          marker: clone(marker),
        };
      }
      const toMs = lastWallMs + minutes * 60_000;
      const from = new Date(lastWallMs).toISOString();
      const to = new Date(toMs).toISOString();
      pending = {
        event_id: `world-clock:${DEFAULT_WORLD_ID}:${lastWallMs}:${toMs}`,
        from,
        to,
        minutes,
      };
      marker = { ...marker, pending };
      persistWallClockMarker(marker);
    }

    if (!pending || typeof pending.event_id !== 'string'
      || !Number.isInteger(pending.minutes) || pending.minutes < 1
      || !Number.isFinite(Date.parse(pending.from)) || !Number.isFinite(Date.parse(pending.to))
      || pending.from !== marker.last_wall_at
      || Date.parse(pending.to) - Date.parse(pending.from) !== pending.minutes * 60_000
      || pending.event_id !== `world-clock:${DEFAULT_WORLD_ID}:${Date.parse(pending.from)}:${Date.parse(pending.to)}`) {
      throw new PersistentWorldError(500, 'invalid_world_clock_marker', 'persisted pending world clock step is invalid');
    }

    const result = ingest({
      event_id: pending.event_id,
      type: 'world.mutation',
      source: 'world-wall-clock',
      source_kind: 'world_engine',
      layer: 'calendar',
      character_id: DEFAULT_CHARACTER_ID,
      correlation_id: pending.event_id,
      occurred_at: pending.to,
      observed_at: pending.to,
      payload: {
        action: 'advance_time',
        minutes: pending.minutes,
        clock_start_at: pending.from,
        clock_end_at: pending.to,
      },
    });
    if (!result.applied && !result.duplicate) {
      throw new PersistentWorldError(500, 'world_clock_step_rejected', 'world clock step was not applied');
    }

    const completed = {
      schema: WALL_CLOCK_SCHEMA,
      world_id: DEFAULT_WORLD_ID,
      last_wall_at: pending.to,
      last_sync_at: currentIso,
      pending: null,
    };
    persistWallClockMarker(completed);
    const remainingMs = Math.max(0, currentMs - Date.parse(completed.last_wall_at));
    return {
      enabled: true,
      anchored: false,
      recovered_pending_step: recoveredPendingStep,
      event_id: pending.event_id,
      duplicate: Boolean(result.duplicate),
      advanced_minutes: result.duplicate ? 0 : pending.minutes,
      segment_minutes: pending.minutes,
      pending_minutes: Math.floor(remainingMs / 60_000),
      remainder_ms: remainingMs % 60_000,
      logical_time: clone(result.world.logical_time),
      marker: clone(completed),
    };
  }

  function ingest(event, adapter = {}) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new PersistentWorldError(400, 'invalid_world_event', 'event must be an object');
    }
    const eventId = requireText(event.event_id, 'event.event_id');
    const eventType = requireText(event.type, 'event.type');
    const world = worlds.get(DEFAULT_WORLD_ID);
    const eventFingerprint = fingerprint(event);
    const existingMutation = mutationsByEvent.get(eventId);
    if (existingMutation) {
      if (existingMutation.event_fingerprint !== eventFingerprint) {
        throw new PersistentWorldError(409, 'world_event_conflict', `event ${eventId} already mutated the world differently`);
      }
      return {
        applied: false,
        duplicate: true,
        reason: 'event_already_applied',
        mutation: clone(existingMutation),
        world: get(),
      };
    }

    if (eventType === 'conversation.reply' || event.payload?.role === 'assistant') {
      return { applied: false, duplicate: false, reason: 'assistant_output_is_read_only', mutation: null, world: get() };
    }
    if (isVoiceTransportEvent(event)) {
      return { applied: false, duplicate: false, reason: 'voice_transport_stage_is_not_a_user_turn', mutation: null, world: get() };
    }

    let projection;
    let countedTurn = null;
    if (eventType === 'conversation.input') {
      if (!characterIdsEqual(event.character_id, world.protagonist.character_id)) {
        return { applied: false, duplicate: false, reason: 'character_outside_default_world', mutation: null, world: get() };
      }
      const turnKey = turnKeyFor(event);
      const existingTurn = countedTurns.get(turnKey);
      if (existingTurn) {
        const existingTurnMutation = mutationsById.get(existingTurn.mutation_id);
        return {
          applied: false,
          duplicate: true,
          reason: 'correlation_already_counted',
          mutation: existingTurnMutation ? clone(existingTurnMutation) : null,
          world: get(),
        };
      }
      projection = applyUserTurn(world, event);
      countedTurn = {
        schema: 'foundry.world-turn-index.v0.1',
        turn_key: turnKey,
        event_id: eventId,
        correlation_id: event.correlation_id ?? eventId,
        mutation_id: `mutation-${eventId}`,
      };
    } else if (eventType === 'world.mutation') {
      ensureWorldTarget(event, world);
      try { projection = applyExplicitMutation(world, event, now().toISOString()); }
      catch (error) {
        if (error instanceof RealTimeWorldError || error instanceof WorldMapError || error instanceof LivingResourceError || error instanceof AutonomousLifeError || error instanceof SocialLifeError) throw new PersistentWorldError(error.statusCode, error.code, error.message);
        throw error;
      }
    } else {
      if (!world.refraction) return { applied: false, duplicate: false, reason: 'event_does_not_mutate_canonical_world', mutation: null, world: get() };
      const next=clone(world),details=refractInput(next,event,now().toISOString(),adapter);
      if(!details.accepted)return {applied:false,duplicate:details.reason==='origin_already_considered',reason:details.reason,mutation:null,world:get()};
      projection={next,action:'refract_input',details};
    }

    if(projection.details?.accepted!==false && eventType==='conversation.input')refractInput(projection.next,event,now().toISOString(),adapter);
    if(projection.details?.accepted!==false && eventType==='world.mutation' && event.payload?.action==='update_weather')refractInput(projection.next,event,now().toISOString(),adapter);

    const beforeRevision = world.world_revision;
    const beforeLogicalTime = clone(world.logical_time);
    // A rejected observation remains in the append-only ledger for audit, but
    // does not advance canonical revision/tick or overwrite the accepted
    // projection (for example, a stale weather sample).
    const observationAccepted = projection.details?.accepted !== false;
    if(observationAccepted)syncLivedMemory(projection.next,now().toISOString());
    const next = observationAccepted ? finalizeWorld(projection.next, now) : clone(world);
    const changes = diffValues(world, next).filter((change) => change.field_path !== '/updated_at');
    for (const change of changes) {
      change.source_layer = 'L3';
      change.layer = 'world';
    }
    const mutation = {
      schema: 'foundry.world-mutation-record.v0.1',
      mutation_id: `mutation-${eventId}`,
      sequence: nextSequence,
      world_id: next.world_id,
      event_id: eventId,
      event_type: eventType,
      event_source: event.source ?? null,
      source_kind: event.source_kind ?? null,
      confidence: event.confidence ?? null,
      observed_at: event.observed_at ?? null,
      provider: event.provider ?? null,
      provenance: event.provenance ?? null,
      event_fingerprint: eventFingerprint,
      correlation_id: event.correlation_id ?? null,
      action: projection.action,
      details: projection.details,
      observation: {
        accepted: observationAccepted,
        reason: observationAccepted ? null : (projection.details?.reason ?? 'rejected_by_world_rule'),
      },
      applied: observationAccepted,
      rule_version: WORLD_RULE_VERSION,
      changes,
      source_layer: 'L3',
      layer: 'world',
      trigger_event_id: eventId,
      time: {
        occurred_at: event.occurred_at ?? null,
        committed_at: now().toISOString(),
      },
      before_revision: beforeRevision,
      after_revision: next.world_revision,
      logical_time_before: beforeLogicalTime,
      logical_time_after: clone(next.logical_time),
      occurred_at: event.occurred_at ?? null,
      committed_at: now().toISOString(),
    };

    persistCommit(next, mutation, countedTurn);
    worlds.set(next.world_id, next);
    storedMutations.push(mutation);
    mutationsByEvent.set(eventId, mutation);
    mutationsById.set(mutation.mutation_id, mutation);
    if (countedTurn) countedTurns.set(countedTurn.turn_key, countedTurn);
    nextSequence += 1;

    return {
      applied: true,
      duplicate: false,
      reason: null,
      mutation: clone(mutation),
      world: clone(next),
    };
  }

  function syncTasks({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new TypeError('task limit must be 1 to 1000');
    const at = now().toISOString();
    const world = get();
    if (world.clock?.mode !== 'real_time') return { processed: 0, enabled: false };
    if (at < world.clock.synced_at) return { processed: 0, enabled: true, clock_moved_backwards: true };
    let processed = 0;
    while (processed < limit) {
      const task = (get().tasks ?? []).filter(task => task.status === 'running' && task.due_at <= at)
        .sort((a, b) => a.due_at.localeCompare(b.due_at) || a.task_id.localeCompare(b.task_id))[0];
      if (!task) break;
      // Complete tasks in deadline order, with the environment at that deadline.
      // Never put a late effect behind an already advanced resource cursor.
      syncEnvironment(task.due_at, true);
      if (get().living?.simulated_until < task.due_at) break;
      ingest({ event_id: `task-due:${task.task_id}:${task.revision}:${task.due_at}`, type: 'world.mutation', source: 'world-task-runner',
        character_id: DEFAULT_CHARACTER_ID, occurred_at: task.due_at, payload: { action: 'advance_task', task_id: task.task_id, expected_task_revision: task.revision } });
      processed += 1;
    }
    const pendingDue = (get().tasks ?? []).filter(task => task.status === 'running' && task.due_at <= at).length;
    if (!pendingDue) syncEnvironment(at);
    return { enabled: true, processed, pending_due: pendingDue, environment_pending: get().living?.recovery.pending ?? false };
  }

  function syncEnvironment(until, force = false) {
    const cursor = get().living?.simulated_until;
    if (!cursor || Date.parse(until) <= Date.parse(cursor) || (!force && Date.parse(until) - Date.parse(cursor) < 60_000)) return;
    ingest({ event_id: `living:${cursor}:${until}`, type: 'world.mutation', source: 'world-living-rules', source_kind: 'world_engine',
      character_id: DEFAULT_CHARACTER_ID, occurred_at: until, payload: { action: 'advance_living_world', until, force } });
  }

  if (timeMode === 'realtime' || get().clock?.mode === 'real_time') syncWallClock();
  return {
    get,
    ingest,
    listMutations,
    syncWallClock,
    syncTasks,
  };
}

// Derived read model for map clients. It never becomes a second source of
// truth: every value is rebuilt from the canonical snapshot on each request.
export function getWorldMap(world, { characterId = DEFAULT_CHARACTER_ID } = {}) {
  if (!world || typeof world !== 'object') return null;
  const protagonist = world.protagonist || {};
  const currentLocationId = canonicalLocationId(protagonist.location_id);
  const activeEvent = world.active_event || null;
  const locations = (Array.isArray(world.locations) ? world.locations : []).map((location) => {
    const npcs = (Array.isArray(world.npcs) ? world.npcs : [])
      .filter((npc) => canonicalLocationId(npc.location_id) === location.location_id && activeWorldTask(world, npc.npc_id)?.kind !== 'travel')
      .map((npc) => ({ npc_id: npc.npc_id, display_name: npc.display_name, role: npc.role, status: npc.status }));
    return {
      location_id: location.location_id,
      settlement_id: location.settlement_id || DEFAULT_SETTLEMENT.settlement_id,
      region_id: location.region_id || null,
      location_kind: location.location_kind || null,
      world_role: location.world_role || null,
      lore_keys: clone(location.lore_keys ?? []),
      name: location.name,
      description: location.description,
      x: Number.isFinite(location.x) ? location.x : null,
      y: Number.isFinite(location.y) ? location.y : null,
      neighbors: Array.isArray(location.neighbors) ? location.neighbors.map(canonicalLocationId).filter(Boolean) : [],
      travel_cost: Number.isInteger(location.travel_cost) ? location.travel_cost : null,
      visibility: location.visibility || 'visible',
      current: location.location_id === currentLocationId,
      reachable: false,
      current_event_summary: activeEvent?.daily_consequence || activeEvent?.summary || null,
      npc_summary: npcs,
      arrival_text: location.arrival_text || null,
      presentation: clone(location.presentation ?? null),
      areas: (world.map_catalog?.areas ?? []).filter(area => area.location_id === location.location_id).map(area => ({
        ...clone(area), objects: (world.map_catalog?.objects ?? []).filter(object => object.area_id === area.area_id).map(object => livingObjectReadModel(world, object)),
      })),
      scene_preview: location.scene ? {
        toy_zone: location.scene.toy_zone ?? null,
        prop_icon: location.scene.prop_icon ?? null,
        material: location.scene.material ?? null,
        signature_props: clone(location.scene.signature_props ?? []),
        anchor: location.scene.anchor ?? null,
        sensory_cues: clone(location.scene.sensory_cues ?? []),
        possible_beats: clone(location.scene.possible_beats ?? []),
      } : null,
    };
  });
  const locationById = new Map(locations.map((location) => [location.location_id, location]));
  const routes = [];
  for (const location of locations) {
    for (const neighborId of location.neighbors) {
      const neighbor = locationById.get(neighborId);
      if (!neighbor || location.location_id >= neighbor.location_id) continue;
      const from = location.location_id === currentLocationId;
      const to = neighbor.location_id === currentLocationId;
      const access = worldHopAccess(world, from ? currentLocationId : to ? currentLocationId : location.location_id, from ? neighbor.location_id : to ? location.location_id : neighbor.location_id);
      const passage = passageFor(world,location.location_id,neighbor.location_id);
      routes.push({
        passage_id: passage?.passage_id ?? null,
        from_location_id: location.location_id, to_location_id: neighbor.location_id,
        travel_cost_minutes: from ? (neighbor.travel_cost ?? 10) : to ? (location.travel_cost ?? 10) : null,
        reachable: access.allowed && (from || to), open: access.allowed,
        blocked_reason: access.reason,
        state: clone(passage ? world.passage_states?.[passage.passage_id] ?? null : null),
      });
    }
  }
  for (const location of locations) {
    const reachable = location.location_id !== currentLocationId
      && routes.some((route) => route.reachable && (route.from_location_id === location.location_id || route.to_location_id === location.location_id));
    location.reachable = reachable;
  }
  return {
    schema: 'deskbot.world-map.v0.1',
    world_id: world.world_id,
    world_revision: world.world_revision,
    logical_time: clone(world.logical_time),
    clock: clone(world.clock ?? { mode: 'simulation' }),
    environment: getWorldEnvironment(world),
    living: livingReadModel(world),
    autonomy: autonomyReadModel(world),
    memory: memoryReadModel(world),
    social: socialReadModel(world),
    refraction: refractionReadModel(world),
    resident_life: clone(world.resident_life ?? null),
    projects: projectReadModel(world),
    tasks: clone(world.tasks ?? []),
    protagonist: {
      character_id: characterId,
      location_id: currentLocationId,
      travel_state: clone(protagonist.travel_state || { status: 'idle' }),
    },
    world_setting: clone(world.setting || WORLD_SETTING),
    settlement: clone(world.settlement || DEFAULT_SETTLEMENT),
    content: world.map_catalog ? { content_id: world.map_catalog.content_id, version: world.map_catalog.version, objects_have_simulated_state: Boolean(world.living) } : null,
    regions: clone(world.map_catalog?.regions ?? []),
    areas: clone(world.map_catalog?.areas ?? []),
    objects: (world.map_catalog?.objects ?? []).map(object => livingObjectReadModel(world, object)),
    locations,
    paths: routes,
    npcs: clone(Array.isArray(world.npcs) ? world.npcs : []),
    active_event: activeEvent ? clone(activeEvent) : null,
  };
}

// Read-only route projection for map clients.  The world still authorizes only
// one adjacent move at a time; this helper merely tells a client which legal
// hops would be needed to reach a farther location.  It deliberately rebuilds
// from the canonical snapshot so a caller must re-plan after every mutation.
export function getWorldRoute(world, { destinationLocationId, characterId = DEFAULT_CHARACTER_ID } = {}) {
  if (!world || typeof world !== 'object') return null;
  const protagonist = world.protagonist || {};
  const currentLocationId = canonicalLocationId(protagonist.location_id);
  const destinationId = canonicalLocationId(destinationLocationId);
  const locations = Array.isArray(world.locations) ? world.locations : [];
  const byId = new Map(locations.map((location) => [location.location_id, location]));
  const origin = byId.get(currentLocationId);
  const destination = byId.get(destinationId);
  if (!origin || !destination) return null;

  const activeEvent = world.active_event || null;
  const blocked = activeEvent?.blocks_travel === true;
  const blockedReason = blocked ? `事件阻断：${activeEvent.title || activeEvent.event_id}` : null;
  if (currentLocationId === destinationId) {
    return {
      schema: 'deskbot.world-route.v0.1',
      world_id: world.world_id,
      world_revision: world.world_revision,
      character_id: characterId,
      current_location_id: currentLocationId,
      destination_location_id: destinationId,
      found: true,
      blocked,
      blocked_reason: blockedReason,
      locations: [{ location_id: currentLocationId, name: origin.name }],
      steps: [],
      total_cost_minutes: 0,
    };
  }

  const travelCostTo = location => Number.isInteger(location?.travel_cost) && location.travel_cost > 0 ? location.travel_cost : 10;
  // Global event blocking retains the geographic preview for compatibility;
  // individually closed passages are excluded from actual path planning.
  const path = findWorldPath(world,currentLocationId,destinationId,{ ignoreGlobalEvent: true });
  if (!path) {
    return {
      schema: 'deskbot.world-route.v0.1',
      world_id: world.world_id,
      world_revision: world.world_revision,
      character_id: characterId,
      current_location_id: currentLocationId,
      destination_location_id: destinationId,
      found: false,
      blocked,
      blocked_reason: blockedReason,
      locations: [],
      steps: [],
      total_cost_minutes: 0,
    };
  }

  const pathLocations = path.map((locationId) => ({ location_id: locationId, name: byId.get(locationId)?.name ?? locationId }));
  const steps = path.slice(1).map((toLocationId, index) => {
    const fromLocationId = path[index];
    const to = byId.get(toLocationId);
    const travelCost = travelCostTo(to);
    const presentationPoints = presentationRouteFor(world, fromLocationId, toLocationId);
    return {
      index,
      from_location_id: fromLocationId,
      from_name: byId.get(fromLocationId)?.name ?? fromLocationId,
      to_location_id: toLocationId,
      to_name: to?.name ?? toLocationId,
      travel_cost_minutes: travelCost,
      ...(presentationPoints ? {
        presentation_space: PRESENTATION_SPACE,
        presentation_points: presentationPoints,
      } : {}),
    };
  });
  return {
    schema: 'deskbot.world-route.v0.1',
    world_id: world.world_id,
    world_revision: world.world_revision,
    character_id: characterId,
    current_location_id: currentLocationId,
    destination_location_id: destinationId,
    found: true,
    blocked,
    blocked_reason: blockedReason,
    locations: pathLocations,
    steps,
    total_cost_minutes: steps.reduce((total, step) => total + step.travel_cost_minutes, 0),
  };
}

export function getWorldSchema(world = null) {
  return {
    schema: 'foundry.canonical-world-schema.v0.1',
    world_schema: 'foundry.canonical-world.v0.2',
    world_id: DEFAULT_WORLD_ID,
    setting: createWorldSettingMetadata(),
    canonical_fields: {
      world_id: { type: 'string', immutable: true },
      world_revision: { type: 'integer', minimum: 0, writer: 'accepted world mutation' },
      clock: { type: 'object', schema: 'deskbot.real-time-clock.v1', rate: 1, writer: 'server clock' },
      tasks: { type: 'array', item: 'deskbot.world-task.v1', maximum_active: 100, retained_terminal: 100 },
      map_catalog: { type: 'object', schema: 'deskbot.world-map-content.v1', levels: ['region','location','area','object'], writer: 'validated additive content' },
      passage_states: { type: 'object', status: ['open','closed'], writer: 'validated world action', revisions: true },
      logical_time: { type: 'object', fields: { day: { type: 'integer', minimum: 1 }, minute_of_day: { type: 'integer', minimum: 0, maximum: MINUTES_PER_DAY - 1 }, tick: { type: 'integer', minimum: 0 } } },
      protagonist: { type: 'object', fields: { character_id: { type: 'string' }, display_name: { type: 'string' }, location_id: { type: 'string' }, travel_state: { type: 'object' }, appearance: { type: 'object', schema: 'deskbot.character-appearance.v0.2' } } },
      settlement: { type: 'object', schema: DEFAULT_SETTLEMENT.schema, immutable: true },
      locations: { type: 'array', item: 'location', maximum: null, fields: ['location_id', 'settlement_id', 'region_id', 'location_kind', 'world_role', 'lore_keys', 'name', 'description', 'x', 'y', 'neighbors', 'travel_cost', 'visibility', 'scene'] },
      npcs: { type: 'array', item: 'npc', maximum: world?.resident_life ? 24 : MAX_NPCS },
      life: { type: 'object', schema: 'deskbot.world-life-state.v0.3', fields: ['current_scene', 'recent_scenes', 'recent_experiences'] },
      active_event: { type: ['object', 'null'] },
      pending_items: { type: 'array', maximum: MAX_PENDING_ITEMS },
      shaping_field: { type: 'object', fields: clone(SHAPING_FIELD_DEFINITIONS) },
      world_line: { type: 'object', path: '/world_line' },
      external_context: { type: 'object', path: '/external_context' },
      weather: { type: 'object', path: '/weather' },
      calendar: { type: 'object', path: '/calendar' },
      user_profile: { type: 'object', path: '/user_profile' },
      device_context: { type: 'object', path: '/device_context' },
      interaction: { type: 'object', path: '/interaction' },
      memory: {type:['object','null'],schema:'deskbot.lived-memory.v1',path:'/memory',maximum_episodes:1024,writer:'canonical task outcomes and bounded model interpretations'},
      refraction: {type:['object','null'],schema:'deskbot.input-refraction.v1',path:'/refraction',maximum_records:96},
    },
    input_layers: clone(MULTISOURCE_LAYERS),
    supported_mutations: clone(SUPPORTED_WORLD_ACTIONS),
    invariants: [
      { id: 'event-id-idempotency', description: '同一 event_id 只能应用一次；不同内容复用返回冲突' },
      { id: 'calendar-monotonic', description: 'calendar.date 不可倒退' },
      { id: 'weather-freshness', description: '较旧 observed_at 不覆盖当前 weather.snapshot，但会进入 mutation ledger' },
      { id: 'preference-stability', description: `同一 preference_key 连续 ${PREFERENCE_STABLE_OBSERVATIONS} 次一致观察后 stable=true` },
      { id: 'npc-bound', description: `当前阶段容量 ${world?.resident_life ? 24 : MAX_NPCS} 位居民，位置必须是已知 location_id；安装目录可继续扩展` },
      { id: 'travel-adjacency', description: '主角沿开放相邻通路开始旅行，现实时间到期后核验抵达；研究模式单独模拟' },
      { id: 'npc-travel-adjacency', description: 'NPC 位置变化只能沿 location.neighbors 移动；用户对话不能直接移动 NPC' },
      { id: 'transport-read-only', description: 'ASR partial/final、assistant reply 与 TTS 传输事件不改变 canonical world' },
    ],
    metadata_fields: {
      event: ['event_id', 'type', 'source', 'occurred_at', 'character_id', 'correlation_id', 'layer', 'source_kind', 'confidence', 'observed_at', 'provider', 'provenance', 'payload'],
      mutation: ['mutation_id', 'sequence', 'event_id', 'event_type', 'event_source', 'source_kind', 'confidence', 'observed_at', 'provider', 'provenance', 'rule_version', 'before_revision', 'after_revision', 'changes', 'observation'],
    },
  };
}

export { DEFAULT_WORLD_ID, MAX_NPCS, MAX_PENDING_ITEMS };
