import { normalizeEvent } from './input-store.mjs';
import { createPersistentWorld } from './persistent-world.mjs';

const FIXTURE_TIME = '2026-09-04T08:00:00.000Z';
const SCENARIO_VERSION = 'v0.1';

const INPUT_DOMAINS = Object.freeze({
  world_line: Object.freeze(['story_beat', 'npc_arrival', 'npc_action', 'world_state_change']),
  external_context: Object.freeze(['news', 'major_event', 'public_notice']),
  weather: Object.freeze(['current_observation', 'forecast', 'alert']),
  user_profile: Object.freeze(['habit', 'preference', 'interest']),
  device_context: Object.freeze(['presence', 'touch', 'motion', 'accessory', 'runtime', 'environment_sensor']),
});

const SCENARIOS = Object.freeze([
  Object.freeze({
    scenario_id: 'world-line-echo',
    title: '世界线：光域回响',
    dominant_layer: 'world_line',
    domain: 'story_beat',
    description: '只让虚拟世界内部的一段剧情事实进入世界。',
    expected_path_prefixes: ['/world_line/'],
    events: Object.freeze([
      Object.freeze({
        event_id: 'fixture-world-line-001',
        source_kind: 'world_engine',
        payload: Object.freeze({
          action: 'apply_world_line_event',
          event: Object.freeze({
            event_id: 'line-echo-001',
            title: '桌面边缘出现一圈缓慢回响的光粒',
            summary: '回响只属于聚形域内部世界线，不代表外界新闻。',
            arc_id: 'first-resonance',
            status: 'active',
            source: 'scenario-fixture',
            occurred_at: FIXTURE_TIME,
          }),
        }),
      }),
    ]),
  }),
  Object.freeze({
    scenario_id: 'external-news-signal',
    title: '外界：城市公共事件',
    dominant_layer: 'external_context',
    domain: 'major_event',
    description: '注入一条明确标为合成夹具的外部公共事件，不访问真实新闻源。',
    expected_path_prefixes: ['/external_context/'],
    events: Object.freeze([
      Object.freeze({
        event_id: 'fixture-external-001',
        source_kind: 'external_provider',
        payload: Object.freeze({
          action: 'record_external_context',
          item: Object.freeze({
            item_id: 'synthetic-city-event-001',
            title: '城市夜间公共照明进入节能时段',
            summary: '研究夹具，用来验证外界事件与虚拟世界线分账。',
            category: 'major_event',
            published_at: FIXTURE_TIME,
            observed_at: FIXTURE_TIME,
            provider: 'scenario-fixture',
          }),
        }),
      }),
    ]),
  }),
  Object.freeze({
    scenario_id: 'weather-rain-arrival',
    title: '天气：降雨到来',
    dominant_layer: 'weather',
    domain: 'current_observation',
    description: '写入一份带观测时间的天气快照。',
    expected_path_prefixes: ['/weather/'],
    events: Object.freeze([
      Object.freeze({
        event_id: 'fixture-weather-001',
        source_kind: 'external_provider',
        payload: Object.freeze({
          action: 'update_weather',
          snapshot: Object.freeze({
            location: '上海',
            condition: 'rain',
            temperature_c: 21,
            humidity: 0.82,
            wind_mps: 2.6,
            observed_at: FIXTURE_TIME,
            provider: 'scenario-fixture',
          }),
        }),
      }),
    ]),
  }),
  Object.freeze({
    scenario_id: 'user-interest-night-sky',
    title: '用户：星空兴趣稳定',
    dominant_layer: 'user_profile',
    domain: 'interest',
    description: '连续三次一致观察后，兴趣才成为稳定偏好。',
    expected_path_prefixes: ['/user_profile/'],
    events: Object.freeze([1, 2, 3].map((index) => Object.freeze({
      event_id: `fixture-interest-00${index}`,
      source_kind: 'user',
      payload: Object.freeze({
        action: 'observe_user_preference',
        preference_key: 'interests.night_sky',
        value: 'high',
      }),
    }))),
  }),
  Object.freeze({
    scenario_id: 'device-presence-near',
    title: '设备：用户靠近桌面',
    dominant_layer: 'device_context',
    domain: 'presence',
    description: '模拟设备提供的近距离在场信息，不假装已经过真机验证。',
    expected_path_prefixes: ['/device_context/'],
    events: Object.freeze([
      Object.freeze({
        event_id: 'fixture-device-001',
        source_kind: 'device',
        payload: Object.freeze({
          action: 'record_device_context',
          device_id: 'deskbot-fixture-001',
          status: 'online',
          metrics: Object.freeze({ presence_distance_cm: 42 }),
          state: Object.freeze({ presence: 'near', posture: 'idle' }),
          observed_at: FIXTURE_TIME,
        }),
      }),
    ]),
  }),
]);

function clone(value) {
  return structuredClone(value);
}

function createFixtureEvent(scenario, event) {
  return normalizeEvent({
    schema: 'foundry.event.v0.1',
    event_id: event.event_id,
    type: 'world.mutation',
    source: 'research-scenario-runner',
    occurred_at: FIXTURE_TIME,
    observed_at: FIXTURE_TIME,
    character_id: 'shaping-001',
    layer: scenario.dominant_layer,
    source_kind: event.source_kind,
    confidence: 1,
    provider: 'scenario-fixture',
    provenance: {
      evidence_status: 'synthetic',
      scenario_id: scenario.scenario_id,
      scenario_version: SCENARIO_VERSION,
    },
    payload: clone(event.payload),
  }, { now: () => new Date(FIXTURE_TIME) });
}

function createProbeDraft(scenario, steps, finalWorld) {
  const eventContributions = steps.map((step) => ({
    event_id: step.event_id,
    input_layer: step.input_layer,
    accepted: step.accepted,
    changed_field_paths: [...step.changed_field_paths],
    changed_field_count: step.changed_field_paths.length,
    profile_distance: null,
    contribution_share: null,
    measurement_status: 'pending_l1b_probe',
  }));

  return {
    schema: 'foundry.l1b-probe-record.v0.1',
    probe_id: `probe-${scenario.scenario_id}-${SCENARIO_VERSION}`,
    status: 'awaiting_probe_measurement',
    character_id: finalWorld.protagonist.character_id,
    recorded_at: FIXTURE_TIME,
    shell_epoch: finalWorld.shaping_field.shell_epoch,
    situation: {
      scenario_id: scenario.scenario_id,
      scenario_version: SCENARIO_VERSION,
      dominant_layer: scenario.dominant_layer,
      domain: scenario.domain,
      event_ids: steps.map((step) => step.event_id),
    },
    profile: {
      dimension_schema: null,
      vector: null,
      model_id: null,
      model_version: null,
    },
    attribution: {
      method: 'ledger-path-delta-v0.1',
      interpretation: 'structural_trace_only_not_profile_distance',
      total_profile_distance: null,
      event_contributions: eventContributions,
    },
  };
}

export class ResearchScenarioError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'ResearchScenarioError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function getResearchScenarioCatalog() {
  return {
    schema: 'foundry.research-scenario-catalog.v0.1',
    scenario_version: SCENARIO_VERSION,
    execution_mode: 'isolated_in_memory',
    fixture_time: FIXTURE_TIME,
    input_domains: clone(INPUT_DOMAINS),
    l1b_probe_contract: {
      schema: 'foundry.l1b-probe-record.v0.1',
      required_fields: ['probe_id', 'status', 'character_id', 'recorded_at', 'shell_epoch', 'situation', 'profile', 'attribution'],
      measurement_policy: 'profile vectors and distance contributions remain null until a real fixed probe is run',
      attribution_fields: ['event_id', 'input_layer', 'accepted', 'changed_field_paths', 'changed_field_count', 'profile_distance', 'contribution_share', 'measurement_status'],
    },
    scenarios: SCENARIOS.map(({ events, ...scenario }) => ({
      ...clone(scenario),
      event_count: events.length,
      evidence_status: 'synthetic',
    })),
  };
}

export function runResearchScenario(scenarioId) {
  const scenario = SCENARIOS.find((item) => item.scenario_id === scenarioId);
  if (!scenario) {
    throw new ResearchScenarioError(404, 'research_scenario_not_found', `unknown research scenario ${scenarioId}`);
  }

  const world = createPersistentWorld({ now: () => new Date(FIXTURE_TIME) });
  const initialWorld = world.get();
  const steps = scenario.events.map((fixture) => {
    const event = createFixtureEvent(scenario, fixture);
    const result = world.ingest(event);
    return {
      event_id: event.event_id,
      input_layer: event.layer,
      domain: scenario.domain,
      source_kind: event.source_kind,
      provider: event.provider,
      accepted: result.mutation?.observation?.accepted !== false,
      applied: result.applied,
      before_revision: result.mutation?.before_revision ?? null,
      after_revision: result.mutation?.after_revision ?? null,
      changed_field_paths: (result.mutation?.changes ?? []).map((change) => change.field_path),
    };
  });
  const finalWorld = world.get();
  const mutations = world.listMutations({ limit: 200 });
  const expectedPathsObserved = scenario.expected_path_prefixes.every((prefix) => (
    steps.some((step) => step.changed_field_paths.some((path) => path.startsWith(prefix)))
  ));
  const allAccepted = steps.every((step) => step.accepted && step.applied);

  return {
    schema: 'foundry.research-scenario-report.v0.1',
    run_id: `${scenario.scenario_id}@${SCENARIO_VERSION}`,
    scenario: {
      scenario_id: scenario.scenario_id,
      scenario_version: SCENARIO_VERSION,
      title: scenario.title,
      description: scenario.description,
      dominant_layer: scenario.dominant_layer,
      domain: scenario.domain,
      evidence_status: 'synthetic',
    },
    execution: {
      mode: 'isolated_in_memory',
      mutates_live_world: false,
      started_at: FIXTURE_TIME,
      completed_at: FIXTURE_TIME,
    },
    validation: {
      passed: allAccepted && expectedPathsObserved,
      all_events_accepted: allAccepted,
      expected_paths_observed: expectedPathsObserved,
    },
    revisions: {
      before: initialWorld.world_revision,
      after: finalWorld.world_revision,
    },
    steps,
    mutations,
    l1b_probe: createProbeDraft(scenario, steps, finalWorld),
    final_projection: {
      world_line: finalWorld.world_line,
      external_context: finalWorld.external_context,
      weather: finalWorld.weather,
      user_profile: finalWorld.user_profile,
      device_context: finalWorld.device_context,
    },
  };
}

