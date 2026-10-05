import { readFileSync } from 'node:fs';
import { DEFAULT_CHARACTER_ID, DEFAULT_WORLD_LOCATIONS } from './world-definition.mjs';

const CONTENT_ROOT = new URL('../../../world-content/companion-world/', import.meta.url);
const POLICY_IDS = ['clock', 'weather', 'body', 'dialogue', 'external', 'world', 'agent', 'audit'];
const ATTESTATIONS = new Set(['clock', 'provider', 'device', 'user', 'world_engine', 'agent']);
const SCOPES = new Set(['environment', 'task_progress', 'world_opportunity', 'attention', 'body_awareness', 'relationship_observation', 'belief', 'goal_proposal', 'experience']);

export class CompanionContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CompanionContractError';
    this.code = 'companion_contract_invalid';
  }
}

function requireCondition(condition, message) {
  if (!condition) throw new CompanionContractError(message);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function texts(value, field, minimum = 1) {
  requireCondition(Array.isArray(value) && value.length >= minimum && value.every(isText), `${field} requires ${minimum} or more non-empty strings`);
}

// This validates the next development contract. It deliberately does not seed
// residents, advance a clock, or grant world mutation authority.
export function validateCompanionWorldContract(rules, catalog) {
  requireCondition(rules?.schema === 'deskbot.companion-world-rules.v1', 'unsupported rules schema');
  requireCondition(catalog?.schema === 'deskbot.resident-design.v1', 'unsupported resident schema');
  requireCondition(isText(rules.version) && catalog.version === rules.version, 'rules and resident versions must agree');
  requireCondition(rules.status === 'contract_only' && catalog.status === 'authored_not_installed', 'step one content must be marked as not installed');
  requireCondition(rules.character_id === DEFAULT_CHARACTER_ID, 'the continuous character identity must be preserved');
  requireCondition(rules.time?.rate === 1, 'world time must run at real-time rate one');
  try {
    new Intl.DateTimeFormat('en', { timeZone: rules.time.time_zone });
  } catch {
    throw new CompanionContractError('time zone must be a supported IANA zone');
  }
  requireCondition(rules.time?.time_zone && rules.time.storage === 'UTC' && rules.time.day_boundary === 'local_midnight', 'world days require local midnight and UTC storage');
  requireCondition(rules.time.travel === 'elapsed_duration' && rules.time.offline === 'reconcile_elapsed_time' && rules.time.page_refresh_advances_time === false, 'travel, recovery, and page reads must preserve the real-time contract');
  requireCondition(rules.body?.camera === false && rules.body.locomotion === false && rules.body.yaw_degrees_of_freedom === 1, 'body capability must match the stationary one-axis device');
  texts(rules.body.sensors, 'body.sensors', 4);
  requireCondition(new Set(rules.body.sensors).size === 4 && ['head_touch', 'screen_touch', 'magnetic_shell_detection', 'microphone_direction'].every(sensor => rules.body.sensors.includes(sensor)), 'body sensor set must match the device design');
  requireCondition(rules.body.microphone_direction_identifies_person === false && rules.body.shell_detection_changes_identity === false, 'sensor readings must not redefine identity');
  requireCondition(rules.identity?.persistent_across_forms === true && rules.identity.single_input_rewrites_identity === false && rules.identity.autonomous_reversible_trials === true, 'growth must preserve identity and permit autonomous reversible trials');
  requireCondition(rules.memory?.self_generated_text_is_independent_evidence === false && rules.memory.duplicate_origin_is_independent_evidence === false, 'self output and repeated origins must not amplify growth');
  requireCondition(JSON.stringify(rules.memory.kinds) === JSON.stringify(['world_fact', 'personal_interpretation', 'hearsay']), 'facts, interpretations, and hearsay must remain distinguishable');
  requireCondition(JSON.stringify(rules.map?.levels) === JSON.stringify(['region', 'location', 'area', 'object']), 'map must support regions, locations, areas, and objects');
  requireCondition(rules.population?.hard_limit === null, 'the design must not retain a three-resident hard limit');
  requireCondition(Number.isSafeInteger(rules.population.initial_authored_count) && rules.population.initial_authored_count > 3 && Number.isSafeInteger(rules.population.next_scale_target) && rules.population.next_scale_target >= rules.population.initial_authored_count, 'population targets must support staged expansion');
  requireCondition(Array.isArray(rules.input_policies) && rules.input_policies.length === POLICY_IDS.length, 'all input policy families must be declared');
  const policies = new Map();
  for (const policy of rules.input_policies) {
    requireCondition(POLICY_IDS.includes(policy.id) && !policies.has(policy.id), 'input policy IDs must be known and unique');
    requireCondition(policy.required_attestation === null || ATTESTATIONS.has(policy.required_attestation), 'unknown source attestation');
    requireCondition(policy.max_age_seconds === null || (Number.isFinite(policy.max_age_seconds) && policy.max_age_seconds > 0), 'freshness windows must be positive or null');
    requireCondition(Array.isArray(policy.may_inform) && policy.may_inform.every(scope => SCOPES.has(scope)), 'unknown input influence scope');
    requireCondition(isText(policy.rule), 'input policies require a written rule');
    policies.set(policy.id, policy);
  }
  requireCondition(POLICY_IDS.every(id => policies.has(id)) && policies.get('audit').may_inform.length === 0, 'audit events cannot carry influence');
  const expectedAttestations = { clock: 'clock', weather: 'provider', body: 'device', dialogue: 'user', external: 'provider', world: 'world_engine', agent: 'agent', audit: null };
  requireCondition(POLICY_IDS.every(id => policies.get(id).required_attestation === expectedAttestations[id]), 'input families require the correct server attestation');
  requireCondition(catalog.settlement_id === 'morrowmere', 'residents must belong to the existing settlement');
  requireCondition(Array.isArray(catalog.residents) && catalog.residents.length === rules.population.initial_authored_count, 'resident count must match the authored target');
  const ids = new Set();
  const projectIds = new Set();
  const locations = new Set(DEFAULT_WORLD_LOCATIONS.map(location => location.location_id));
  for (const resident of catalog.residents) {
    for (const field of ['npc_id', 'display_name', 'role', 'home_location_id', 'home_area', 'appearance', 'temperament']) {
      requireCondition(isText(resident[field]), `resident ${field} is required`);
    }
    requireCondition(!ids.has(resident.npc_id), `duplicate resident ${resident.npc_id}`);
    requireCondition(locations.has(resident.home_location_id), `unknown home location for ${resident.npc_id}`);
    ids.add(resident.npc_id);
    texts(resident.desires, `${resident.npc_id}.desires`, 2);
    texts(resident.flaws, `${resident.npc_id}.flaws`);
    texts(resident.likes, `${resident.npc_id}.likes`);
    texts(resident.aversions, `${resident.npc_id}.aversions`);
    texts(resident.daily_life, `${resident.npc_id}.daily_life`, 3);
    requireCondition(isText(resident.speech?.rhythm) && isText(resident.speech.example), 'residents require distinct speech examples');
    const project = resident.project;
    requireCondition(project && ['project_id', 'goal', 'success_consequence', 'failure_consequence'].every(field => isText(project[field])), 'projects require a goal and success/failure consequences');
    requireCondition(!projectIds.has(project.project_id), `duplicate project ${project.project_id}`);
    projectIds.add(project.project_id);
    texts(project.steps, `${resident.npc_id}.project.steps`, 3);
    texts(project.supporting_npc_ids, `${resident.npc_id}.project.supporting_npc_ids`);
    requireCondition(Array.isArray(resident.relationships) && resident.relationships.length >= 2, 'residents require two or more authored relationships');
  }
  for (const resident of catalog.residents) {
    const relationIds = new Set();
    for (const relation of resident.relationships) {
      requireCondition(ids.has(relation.npc_id) && relation.npc_id !== resident.npc_id && !relationIds.has(relation.npc_id), `invalid relationship for ${resident.npc_id}`);
      requireCondition(isText(relation.connection) && isText(relation.tension), 'relationships require connection and tension');
      relationIds.add(relation.npc_id);
    }
    requireCondition(new Set(resident.project.supporting_npc_ids).size === resident.project.supporting_npc_ids.length && resident.project.supporting_npc_ids.every(id => ids.has(id) && id !== resident.npc_id), `project has an invalid supporting resident for ${resident.npc_id}`);
  }
  // Everyone belongs to one connected social network, including residents
  // introduced later. Authored links are possibilities, not past experiences.
  const neighbors = new Map([...ids].map(id => [id, new Set()]));
  for (const resident of catalog.residents) {
    for (const id of [...resident.relationships.map(relation => relation.npc_id), ...resident.project.supporting_npc_ids]) {
      neighbors.get(resident.npc_id).add(id);
      neighbors.get(id).add(resident.npc_id);
    }
  }
  const reached = new Set();
  const pending = [catalog.residents[0].npc_id];
  while (pending.length) {
    const id = pending.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    pending.push(...neighbors.get(id));
  }
  requireCondition(reached.size === ids.size, 'resident social network must be connected');
  return structuredClone({ rules, catalog });
}

const authored = validateCompanionWorldContract(
  JSON.parse(readFileSync(new URL('rules.v1.json', CONTENT_ROOT), 'utf8')),
  JSON.parse(readFileSync(new URL('residents.v1.json', CONTENT_ROOT), 'utf8')),
);

export function loadCompanionWorldContract() {
  return structuredClone(authored);
}

function familyOf(event) {
  const type = event?.type ?? '';
  if (event?.payload?.role === 'assistant' || ['partial', 'final'].includes(event?.payload?.stage)
    || type.startsWith('voice.') || ['conversation.input.partial', 'conversation.input.final', 'conversation.reply', 'device.hello', 'device.action.completed'].includes(type)) return 'audit';
  if (type === 'world.time' || type.startsWith('calendar.')) return 'clock';
  if (type.startsWith('weather.')) return 'weather';
  if (type.startsWith('sensor.') || ['device.touch', 'device.head.touch', 'device.screen.touch', 'shell.install.detected'].includes(type)) return 'body';
  if (type === 'conversation.input' || type.startsWith('user.preference')) return 'dialogue';
  if (type.startsWith('news.') || type.startsWith('external.')) return 'external';
  if (type.startsWith('agent.') || type === 'npc.message') return 'agent';
  if (['world.mutation', 'world.action.executed', 'npc.action.executed'].includes(type)) return 'world';
  return 'audit';
}

// attestedKind is supplied by a trusted SERVER adapter, never copied from an
// event's source/source_kind/provenance/confidence. This is a classification
// helper used by the bounded refraction layer, not a mutation permission check.
export function classifyCompanionInput(event, { attestedKind = null, now = new Date() } = {}) {
  const category = familyOf(event);
  const policy = authored.rules.input_policies.find(item => item.id === category);
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new TypeError('now must be a valid date');
  const observedMs = Date.parse(event?.observed_at ?? event?.occurred_at ?? '');
  const ageSeconds = Number.isFinite(observedMs) ? (nowMs - observedMs) / 1000 : null;
  const freshness = ageSeconds === null ? 'unknown' : ageSeconds < -60 ? 'future'
    : policy.max_age_seconds !== null && ageSeconds > policy.max_age_seconds ? 'stale' : 'fresh';
  const attested = category !== 'audit' && attestedKind === policy.required_attestation;
  const usable = attested && freshness === 'fresh';
  return {
    schema: 'deskbot.input-influence-assessment.v1',
    rules_version: authored.rules.version,
    category,
    attested,
    freshness,
    age_seconds: ageSeconds,
    may_inform: usable ? [...policy.may_inform] : [],
    historical_record_only: attested && freshness === 'stale',
    // Correct interpretation and world revision must still be validated by
    // a domain action. Even an attested source cannot write identity directly.
    direct_state_writes: [],
    direct_identity_change: false,
    effect_status: usable ? 'requires_validated_refraction_rule' : 'audit_only',
    origin_id: event?.provenance?.origin_event_id ?? event?.correlation_id ?? event?.event_id ?? null,
    independent_evidence: false,
    rule: policy.rule,
  };
}

export function getCompanionWorldContract(world = {}) {
  return {
    schema: 'deskbot.companion-world-contract.v1',
    ...loadCompanionWorldContract(),
    adoption: {
      status: world.clock?.mode === 'real_time' ? 'partially_implemented' : 'contract_only',
      rules_enforced_by_runtime: false,
      real_time_tasks: world.clock?.mode === 'real_time',
      extensible_map: Boolean(world.map_catalog),
      variable_passages: Boolean(world.passage_states),
      object_catalog: Boolean(world.map_catalog?.objects.length),
      resident_catalog_installed: Boolean(world.resident_life),
      active_npc_ids: (world.npcs ?? []).map(npc => npc.npc_id),
      active_location_count: (world.locations ?? []).length,
      world_revision: world.world_revision ?? null,
        input_refraction: Boolean(world.refraction),
        lived_memory: Boolean(world.memory),
        model_life_choices: Boolean(world.memory?.planner.enabled),
        pending_steps: [...(world.clock?.mode === 'real_time' ? [] : ['real_time_tasks']), ...(world.map_catalog ? [] : ['extensible_map']), ...(world.living?[]:['persistent_objects']), ...(world.autonomy?[]:['autonomous_life']), ...(world.resident_life?[]:['resident_installation']), ...(world.refraction?[]:['refraction']), ...(world.memory?[]:['memory_and_growth']), 'device_expression', 'form_and_shell'],
    },
  };
}
