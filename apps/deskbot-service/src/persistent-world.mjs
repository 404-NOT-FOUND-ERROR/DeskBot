import { createHash } from 'node:crypto';

import {
  DEFAULT_CHARACTER_DISPLAY_NAME,
  DEFAULT_CHARACTER_DISPLAY_NAME_STATUS,
  DEFAULT_CHARACTER_ID,
  DEFAULT_LOCATION_ID,
  DEFAULT_LOCATION_NAME,
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
const WORLD_RULE_VERSION = 'canonical-world-rules-v0.4';

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
  { action: 'advance_time', layer: 'calendar', required: ['minutes'], optional: [], description: '推进连续世界逻辑时间' },
  { action: 'activate_event', layer: 'world_line', required: ['event.event_id', 'event.title'], optional: ['event.summary', 'event.daily_consequence', 'event.opportunity', 'event.unresolved_hook', 'event.source'], description: '创建唯一进行中的世界事件及其可生活切片' },
  { action: 'resolve_active_event', layer: 'world_line', required: [], optional: ['event_id', 'outcome'], description: '结束当前进行中的世界事件' },
  { action: 'enqueue_pending_item', layer: 'world_line', required: ['item.item_id', 'item.summary'], optional: ['item.kind', 'item.source'], description: '按 FIFO 加入待处理事项' },
  { action: 'dequeue_pending_item', layer: 'world_line', required: [], optional: ['item_id'], description: '按 FIFO 取出待处理事项' },
  { action: 'upsert_npc', layer: 'world_line', required: ['npc.npc_id', 'npc.display_name'], optional: ['npc.role', 'npc.location_id', 'npc.status'], description: '新增或更新 NPC，最多 3 个' },
  { action: 'move_protagonist', layer: 'world_line', required: ['location_id'], optional: ['reason'], description: '沿可见且未被阻断的相邻路线移动主角，并推进旅行时间' },
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
      Object.assign(migrated, definition);
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

function applyWeatherUpdate(next, payload) {
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

function applyNpcAction(next, payload) {
  const npcId = requireText(payload.npc_id, 'payload.npc_id');
  const index = next.npcs.findIndex((npc) => npc.npc_id === npcId);
  if (index === -1) {
    throw new PersistentWorldError(409, 'npc_not_found', `NPC ${npcId} does not exist`);
  }
  const npc = { ...next.npcs[index] };
  const actionName = requireText(payload.action_name ?? payload.npc_action ?? payload.command, 'payload.action_name');
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
  if (!['observe', 'greet', 'suggest', 'help', 'invite'].includes(intent)) {
    throw new PersistentWorldError(400, 'invalid_npc_interaction', `unsupported NPC intent ${intent}`);
  }
  const index = next.npcs.findIndex((npc) => npc.npc_id === npcId);
  if (index === -1) throw new PersistentWorldError(404, 'npc_not_found', `NPC ${npcId} does not exist`);
  const npc = { ...next.npcs[index] };
  if (npc.location_id !== next.protagonist.location_id) {
    throw new PersistentWorldError(409, 'npc_not_present', `NPC ${npcId} is not at the protagonist location`);
  }
  const familiarityGain = { observe: 1, greet: 2, suggest: 3, help: 4, invite: 3 }[intent];
  const trustGain = { observe: 0, greet: 1, suggest: 1, help: 2, invite: 1 }[intent];
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
  for (const payload of payloads) projected = applyExplicitMutation(projected, { payload }).next;
  return projected;
}

function applyExplicitMutation(world, event) {
  const payload = requireObject(event.payload, 'payload');
  const action = requireText(payload.action, 'payload.action');
  const next = clone(world);
  let details;

  switch (action) {
    case 'advance_time': {
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
      if (existingIndex === -1 && next.npcs.length >= MAX_NPCS) {
        throw new PersistentWorldError(409, 'npc_limit_reached', `this world supports at most ${MAX_NPCS} NPCs`);
      }
      if (existingIndex === -1) next.npcs.push(npc);
      else next.npcs[existingIndex] = npc;
      details = { npc: clone(npc), operation: existingIndex === -1 ? 'insert' : 'replace' };
      break;
    }
    case 'move_protagonist': {
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
      if (next.active_event?.blocks_travel === true) {
        throw new PersistentWorldError(409, 'travel_blocked', `active event ${next.active_event.event_id} blocks travel`);
      }
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
      details = applyWeatherUpdate(next, payload).details;
      break;
    case 'record_external_context':
      details = applyExternalContext(next, payload).details;
      break;
    case 'advance_calendar':
      details = applyCalendarAdvance(next, payload).details;
      break;
    case 'observe_user_preference':
      details = applyPreferenceObservation(next, payload, event).details;
      break;
    case 'record_device_context':
      details = applyDeviceContext(next, payload).details;
      break;
    case 'npc_action':
      details = applyNpcAction(next, payload).details;
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

export function createPersistentWorld({ now = () => new Date(), persistence = null } = {}) {
  const storedWorlds = persistence?.list('canonical-world.states') ?? [];
  const worlds = new Map();
  for (const storedWorld of storedWorlds) {
    const migrated = migrateWorldToCurrentSetting(storedWorld, now);
    worlds.set(migrated.world.world_id, migrated.world);
    if (migrated.changed) persistence?.put('canonical-world.states', migrated.world.world_id, migrated.world);
  }
  if (!worlds.has(DEFAULT_WORLD_ID)) {
    const initial = createDefaultWorld(now);
    worlds.set(initial.world_id, initial);
    persistence?.put('canonical-world.states', initial.world_id, initial);
  }

  const storedMutations = persistence?.list('canonical-world.mutations') ?? [];
  const mutationsByEvent = new Map(storedMutations.map((mutation) => [mutation.event_id, mutation]));
  const mutationsById = new Map(storedMutations.map((mutation) => [mutation.mutation_id, mutation]));
  const countedTurns = new Map(
    (persistence?.list('canonical-world.turns') ?? []).map((turn) => [turn.turn_key, turn]),
  );
  let nextSequence = storedMutations.reduce(
    (highest, mutation) => Math.max(highest, mutation.sequence ?? 0),
    0,
  ) + 1;

  function get(worldId = DEFAULT_WORLD_ID) {
    const world = worlds.get(worldId);
    return world ? clone(world) : null;
  }

  function listMutations({ worldId = DEFAULT_WORLD_ID, afterSequence = 0, limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    const parsedAfter = Math.max(Number.parseInt(afterSequence, 10) || 0, 0);
    return storedMutations
      .filter((mutation) => mutation.world_id === worldId && mutation.sequence > parsedAfter)
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

  function ingest(event) {
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
      projection = applyExplicitMutation(world, event);
    } else {
      return { applied: false, duplicate: false, reason: 'event_does_not_mutate_canonical_world', mutation: null, world: get() };
    }

    const beforeRevision = world.world_revision;
    const beforeLogicalTime = clone(world.logical_time);
    // A rejected observation remains in the append-only ledger for audit, but
    // does not advance canonical revision/tick or overwrite the accepted
    // projection (for example, a stale weather sample).
    const observationAccepted = projection.details?.accepted !== false;
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

  return {
    get,
    ingest,
    listMutations,
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
      .filter((npc) => canonicalLocationId(npc.location_id) === location.location_id)
      .map((npc) => ({ npc_id: npc.npc_id, display_name: npc.display_name, role: npc.role, status: npc.status }));
    return {
      location_id: location.location_id,
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
      scene_preview: location.scene ? {
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
      routes.push({
        from_location_id: location.location_id,
        to_location_id: neighbor.location_id,
        travel_cost_minutes: from
          ? (neighbor.travel_cost ?? 10)
          : to ? (location.travel_cost ?? 10) : null,
        reachable: !activeEvent?.blocks_travel && (from || to),
        blocked_reason: activeEvent?.blocks_travel ? `事件阻断：${activeEvent.title}` : null,
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
    protagonist: {
      character_id: characterId,
      location_id: currentLocationId,
      travel_state: clone(protagonist.travel_state || { status: 'idle' }),
    },
    locations,
    paths: routes,
    npcs: clone(Array.isArray(world.npcs) ? world.npcs : []),
    active_event: activeEvent ? clone(activeEvent) : null,
  };
}

export function getWorldSchema() {
  return {
    schema: 'foundry.canonical-world-schema.v0.1',
    world_schema: 'foundry.canonical-world.v0.2',
    world_id: DEFAULT_WORLD_ID,
    setting: createWorldSettingMetadata(),
    canonical_fields: {
      world_id: { type: 'string', immutable: true },
      world_revision: { type: 'integer', minimum: 0, writer: 'accepted world mutation' },
      logical_time: { type: 'object', fields: { day: { type: 'integer', minimum: 1 }, minute_of_day: { type: 'integer', minimum: 0, maximum: MINUTES_PER_DAY - 1 }, tick: { type: 'integer', minimum: 0 } } },
      protagonist: { type: 'object', fields: { character_id: { type: 'string' }, display_name: { type: 'string' }, location_id: { type: 'string' }, travel_state: { type: 'object' }, appearance: { type: 'object', schema: 'deskbot.character-appearance.v0.2' } } },
      locations: { type: 'array', item: 'location', maximum: null, fields: ['location_id', 'name', 'description', 'x', 'y', 'neighbors', 'travel_cost', 'visibility', 'scene'] },
      npcs: { type: 'array', item: 'npc', maximum: MAX_NPCS },
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
    },
    input_layers: clone(MULTISOURCE_LAYERS),
    supported_mutations: clone(SUPPORTED_WORLD_ACTIONS),
    invariants: [
      { id: 'event-id-idempotency', description: '同一 event_id 只能应用一次；不同内容复用返回冲突' },
      { id: 'calendar-monotonic', description: 'calendar.date 不可倒退' },
      { id: 'weather-freshness', description: '较旧 observed_at 不覆盖当前 weather.snapshot，但会进入 mutation ledger' },
      { id: 'preference-stability', description: `同一 preference_key 连续 ${PREFERENCE_STABLE_OBSERVATIONS} 次一致观察后 stable=true` },
      { id: 'npc-bound', description: `canonical world 最多 ${MAX_NPCS} 个 NPC，位置必须是已知 location_id` },
      { id: 'travel-adjacency', description: '主角只能沿 location.neighbors 移动；旅行由 move_protagonist mutation 记录并推进逻辑时间' },
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
