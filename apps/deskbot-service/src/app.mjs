import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CHARACTER_ID } from './world-definition.mjs';
import { activeWorldTask, worldTaskReadModel } from './realtime-world.mjs';
import { createSharedLife } from './shared-life.mjs';
import { createSharedLifeReports } from './shared-life-reports.mjs';
import { createNpcGoals } from './npc-goals.mjs';
import { createWorldLife } from './world-life.mjs';
import { RESIDENT_VERSION } from './resident-life.mjs';
import { socialReadModel } from './social-life.mjs';
import { REFRACTION_VERSION, LIFE_SUGGESTIONS, refractionReadModel } from './input-refraction.mjs';
import { BODY_PERCEPTION_VERSION, bodyReadModel } from './body-perception.mjs';
import { createAutonomousLife } from './autonomous-life.mjs';
import { getCompanionWorldContract } from './companion-world-contract.mjs';

import { createInputStore, InputError, normalizeChat, normalizeEvent } from './input-store.mjs';
import { createStateEngine } from './state-engine.mjs';
import { createWorldContext } from './world-context.mjs';
import { MEMORY_VERSION, memoryReadModel } from './lived-memory.mjs';
import { DEVELOPMENT_VERSION, developmentReadModel } from './development-evidence.mjs';
import { createLifeChoiceWorker } from './life-choice.mjs';
import { createFakeLlm, LlmProviderError } from './llm.mjs';
import { createChatOrchestrator } from './chat-orchestrator.mjs';
import { createEvidenceLedger } from './evidence-ledger.mjs';
import { createOutputRouter, OutputRouterError } from './output-router.mjs';
import { createDeviceRegistry, DeviceRegistryError } from './device-registry.mjs';
import { createPersistentWorld, getWorldMap, getWorldRoute, getWorldSchema, PersistentWorldError } from './persistent-world.mjs';
import { createAudioArtifactStore, AudioArtifactError } from './audio-artifacts.mjs';
import { createVoiceIngress, VoiceIngressError } from './voice-ingress.mjs';
import { VoiceSidecarError } from './voice-sidecar-client.mjs';
import { createWebSocketBridge } from './websocket-bridge.mjs';
import { createContextSourceRegistry } from './context-sources.mjs';
import { createInteractionPolicy, InteractionPolicyError } from './interaction-policy.mjs';
import { WeatherConnectorError } from './weather-connector.mjs';
import { createInputRuntime } from './input-runtime.mjs';
import { computeFantasyPull } from './fantasy-pull.mjs';
import { createRoleProposalStore, RoleProposalError } from './role-proposals.mjs';
import { createRoleEvolution } from './role-evolution.mjs';
import { createWorldCandidateStore, WorldCandidateError } from './world-candidates.mjs';
import { listStoryPackages, previewStoryPackage, installStoryPackage } from './story-packages.mjs';
import { listContentPackages } from './content-packages.mjs';
import {
  getResearchScenarioCatalog,
  ResearchScenarioError,
  runResearchScenario,
} from './research-scenarios.mjs';
import {
  createL1bProbeStore,
  getL1bProbeCatalog,
  L1bProbeError,
} from './l1b-probes.mjs';
import {
  createResearchSessionStore,
  getResearchSessionContract,
  ResearchSessionError,
} from './research-sessions.mjs';

const SERVICE_VERSION = '0.1.0';

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(payload);
}

function sendBinary(response, statusCode, buffer, {
  contentType = 'application/octet-stream',
  headers = {},
} = {}) {
  response.writeHead(statusCode, {
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
    'content-length': buffer.byteLength,
    'content-type': contentType,
    ...headers,
  });
  response.end(buffer);
}

async function readJson(request, maxBytes = 1024 * 1024, { allowEmpty = false } = {}) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new InputError(413, 'payload_too_large', `request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }

  if (size === 0) {
    if (allowEmpty) return {};
    throw new InputError(400, 'invalid_json', 'request body must be a JSON object');
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('body must be an object');
    }
    return body;
  } catch (error) {
    if (error instanceof InputError) {
      throw error;
    }
    throw new InputError(400, 'invalid_json', 'request body must be valid JSON');
  }
}

function sendInputAccepted(response, event, duplicate, stateResult) {
  sendJson(response, duplicate ? 200 : 202, {
    schema: 'foundry.input-accepted.v0.1',
    accepted: true,
    duplicate,
    event,
    pipeline: {
      stages: ['input', 'state-engine', 'output-router'],
      current: 'state-engine',
      next: 'output-router',
      state_revision: stateResult?.state?.state_revision ?? event.role_revision,
      outputs: stateResult?.outputs ?? [],
    },
    analysis: stateResult?.analysis ?? null,
    state: stateResult?.state ?? null,
    context: stateResult?.context ?? null,
    matched_conditions: stateResult?.matched_conditions ?? [],
    evidence: stateResult?.evidence ?? null,
    device: stateResult?.device ?? null,
    output_route: stateResult?.output_route ?? null,
    role_evolution: stateResult?.roleEvolution ?? null,
    world_candidate: stateResult?.worldCandidate ?? null,
    world_mutation: stateResult?.world_mutation ?? null,
    interaction_decision: stateResult?.interaction_decision ?? null,
  });
}

export function createDeskBotServer({
  now = () => new Date(),
  persistence = null,
  timeMode = 'simulation',
  timeZone = 'Asia/Shanghai',
  inputStore = createInputStore({ now, persistence }),
  stateEngine = createStateEngine({ now, persistence }),
  worldContext = createWorldContext({ now, persistence }),
  evidenceLedger = createEvidenceLedger({ now, persistence }),
  outputRouter = createOutputRouter({ now, persistence }),
  deviceRegistry = createDeviceRegistry({ now, persistence }),
  persistentWorld = createPersistentWorld({ now, persistence, timeMode, timeZone }),
  weatherConnector = null,
  refractionSources = [],
  inputRuntime: configuredInputRuntime = null,
  inputRuntimeIntervalMs = 5 * 60 * 1000,
  contextSources = createContextSourceRegistry({ now, weatherConnector }),
  interactionPolicy = createInteractionPolicy({ now, persistence }),
  roleProposalStore = null,
  worldCandidateStore = null,
  fantasyPullEngine = computeFantasyPull,
  l1bProbeStore = createL1bProbeStore({ now, persistence }),
  researchSessions = null,
  audioArtifacts = createAudioArtifactStore({ now, persistence }),
  voiceClient = null,
  ttsFormat = { codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 },
  llm = createFakeLlm(),
  chatOrchestrator,
  voiceIngress,
  websocket = true,
  websocketPath = '/ws',
  worldLifeEnabled = false,
  autonomousLifeEnabled = false,
  residentLifeEnabled = false,
  livedMemoryEnabled = false,
  bodyPerceptionEnabled = residentLifeEnabled,
  bodyDeviceProfiles = [],
} = {}) {
  const bodyProfiles = new Map(bodyDeviceProfiles.map(profile => [profile.device_id, structuredClone(profile)]));
  function bodyContextForPeer(peer) {
    const registered=deviceRegistry.get(peer.deviceId),profile=bodyProfiles.get(peer.deviceId);
    const allowed=profile && profile.character_id===DEFAULT_CHARACTER_ID && (profile.commissioned===true || profile.simulated===true);
    const capabilities=Object.fromEntries(Object.entries(peer.capabilities??{}).map(([key,value])=>[key,
      value===true && (!profile?.capabilities || profile.capabilities[key]===true)]));
    return {attestedKind:peer.characterId===DEFAULT_CHARACTER_ID && allowed?'device':null,
      sourceLabel:profile?.simulated===true?'隔离模拟设备上报':allowed?'已调试设备协议上报':'设备协议上报 · 待实机调试',
      device:registered?{...registered,character_id:peer.characterId,capabilities}:null,connected:peer.ready===true && !peer.ws.closed,
      deviceStatus:peer.phase==='idle'?'idle':'busy',session_id:peer.id,
      simulated:profile?.simulated===true,hardwareVerified:allowed && profile?.commissioned===true && profile.simulated!==true,
      supportedCommandTypes:allowed?['render.expression','orientation.base_yaw']:[],
      shellCalibration:allowed?profile.shellCalibration:null,shellCatalog:allowed?profile.shellCatalog:[]};
  }
  const roles = roleProposalStore ?? createRoleProposalStore({ now, persistence });
  const roleEvolution = createRoleEvolution({
    now,
    persistence,
    inputStore,
    roles,
    computeFantasyPull: fantasyPullEngine,
    worldSnapshot: () => persistentWorld.get(),
  });
  const worldCandidates = worldCandidateStore ?? createWorldCandidateStore({
    now,
    persistence,
    worldSnapshot: () => persistentWorld.get(),
    ingest: event => ingestNonChatEvent(event),
    listMutations: options => persistentWorld.listMutations(options),
  });
  let npcGoals;
  const sharedLife = createSharedLife({ now, persistence, worldSnapshot: () => persistentWorld.get(), ingest: event => ingestNonChatEvent(event), npcReserved: id => npcGoals?.reserved(id) ?? false });
  const sharedLifeReports = createSharedLifeReports({
    now,
    persistence,
    worldSnapshot: () => persistentWorld.get(),
    listMutations: options => persistentWorld.listMutations(options),
  });
  npcGoals = createNpcGoals({ now, persistence, worldSnapshot: () => persistentWorld.get(), ingest: event => ingestNonChatEvent(event),
    reserved: id => Boolean(activeWorldTask(persistentWorld.get(), id)) || sharedLife.plans().some(p => !p.cancelled_at && p.steps.some(s => ['pending', 'waiting', 'failed'].includes(s.status) && (s.payload.npc?.npc_id ?? s.payload.npc_id) === id)) });
  const worldLife = createWorldLife({
    now,
    worldSnapshot: () => persistentWorld.get(),
    ingest: event => ingestNonChatEvent(event),
    listMutations: options => persistentWorld.listMutations(options),
    npcGoals,
    persistence,
    roleStages: (characterId) => roles.currentStages({ characterId }),
    llm,
    enabled: worldLifeEnabled,
  });
  const reservedForLife=() => persistentWorld.get().npcs.filter(n => npcGoals.reserved(n.npc_id) || sharedLife.plans().some(p => !p.cancelled_at && p.steps.some(s => ['pending','waiting','failed'].includes(s.status) && (s.payload.npc?.npc_id ?? s.payload.npc_id) === n.npc_id))).map(n => n.npc_id);
  const autonomousLife = createAutonomousLife({ world: persistentWorld, now, enabled: autonomousLifeEnabled,reserved:reservedForLife });
  let lifeChoiceWorker;
  function tickAutonomousLife(options) {
    try { const result=autonomousLife.tick(options);void lifeChoiceWorker?.tick().catch(()=>{});return result; }
    catch (error) { console.error(`[autonomous-life] ${error.message}`); return { error: error.code ?? 'life_tick_failed' }; }
  }
  lifeChoiceWorker=createLifeChoiceWorker({world:persistentWorld,llm,now,
    reserved:reservedForLife,
    wake:id=>autonomousLife.tick({wakeId:id})});
  const orchestrator = chatOrchestrator ?? createChatOrchestrator({
    inputStore,
    stateEngine,
    worldContext,
    evidenceLedger,
    outputRouter,
    persistentWorld,
    contextSources,
    interactionPolicy,
    llm,
    voiceClient,
    ttsFormat,
    audioArtifacts,
    activeRoleTrials: (characterId) => roles.activeTrials({ characterId }),
    currentRoleStages: (characterId) => roles.currentStages({ characterId }),
    relationshipMemories: (characterId, query) => sharedLife.retrieve(characterId, query),
    branchExperiences: (query, worldSnapshot) => sharedLife.retrieveExperiences(query, worldSnapshot),
    conversationHistoryAfter: (characterId) => sharedLife.historyAfter(characterId),
    continuityContext: (characterId) => sharedLifeReports.promptContinuity({ characterId }),
    recordRoleTrialObservation: ({ characterId, eventId, evidenceId, signal }) => {
      return roles.activeTrials({ characterId }).map((trial) => {
        const result = roles.recordTrialObservation(trial.proposal_id, { eventId, evidenceId, signal });
        return {
          proposal_id: trial.proposal_id,
          direction_id: trial.direction_id,
          status: result.trial?.status ?? null,
          turns_observed: result.trial?.turns_observed ?? null,
        };
      });
    },
    refreshWeather: weatherConnector
      ? async ({ force = false } = {}) => {
        const weather = await weatherConnector.refresh({ force });
        const ingested = ingestWeatherEvent(weather.event);
        return { ...weather, ingested };
      }
      : null,
    refreshWeatherForecast: weatherConnector?.forecast
      ? async ({ force = false, kinds = 'all' } = {}) => weatherConnector.forecast({ force, kinds })
      : null,
    now,
    persistence,
  });
  const ingress = voiceIngress ?? createVoiceIngress({
    now,
    inputStore,
    persistentWorld,
    stateEngine,
    evidenceLedger,
    orchestrator,
  });
  const sessionStore = researchSessions ?? createResearchSessionStore({
    now,
    persistence,
    turnResolver: (turnId) => orchestrator.get(turnId),
    probeResolver: (observationId) => l1bProbeStore.get(observationId),
  });
  function rolePulls({ characterId = null, limit = 200 } = {}) {
    const events = inputStore.list({ limit })
      .filter((event) => !characterId || event.character_id === characterId || event.character_id === null);
    return fantasyPullEngine(events, { now: now() });
  }

  function sendRoleError(response, error) {
    const expected = error instanceof InputError || error instanceof RoleProposalError || error instanceof TypeError;
    sendJson(response, expected ? (error.statusCode ?? 400) : 500, {
      error: expected ? (error.code ?? 'invalid_role_request') : 'internal_error',
      message: expected ? error.message : 'role proposal operation failed',
    });
  }

  function sendWorldCandidateError(response, error) {
    const expected = error instanceof WorldCandidateError || error instanceof InputError || error instanceof TypeError;
    sendJson(response, expected ? (error.statusCode ?? 400) : 500, {
      error: expected ? (error.code ?? 'invalid_world_candidate_request') : 'internal_error',
      message: expected ? error.message : 'world candidate operation failed',
    });
  }

  function requiredRoleText(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new InputError(400, 'invalid_role_request', `${field} must be a non-empty string`);
    }
    return value.trim();
  }

  function optionalRoleText(value, field) {
    if (value === undefined || value === null) return null;
    return requiredRoleText(value, field);
  }

  function sendResearchSessionError(response, error) {
    const expected = error instanceof ResearchSessionError;
    sendJson(response, expected ? error.statusCode : 500, {
      error: expected ? error.code : 'internal_error',
      message: expected ? error.message : 'research session operation failed',
    });
  }

  function ingestNonChatEvent(eventInput, adapter = {}) {
    if (eventInput.type === 'world.mutation' && ['update_weather', 'start_activity', 'control_task', 'transfer_resource'].includes(eventInput.payload?.action)) {
      persistentWorld.syncWallClock?.();
      const recovery = persistentWorld.syncTasks?.();
      if (recovery?.pending_due || recovery?.environment_pending) throw new PersistentWorldError(409, 'world_catching_up', '世界正在补算之前的事务，请稍后再试。');
    }
    const event = normalizeEvent(eventInput, { now });
    const result = inputStore.save(event);
    let worldMutation;
    try {
      worldMutation = persistentWorld.ingest(result.event,adapter);
    } catch (error) {
      if (!result.duplicate) inputStore.remove?.(result.event.event_id);
      throw error;
    }
    const correlationAlreadyCounted = worldMutation.reason === 'correlation_already_counted';
    const matchedConditions = result.duplicate || correlationAlreadyCounted ? [] : worldContext.observe(event);
    const interactionDecision = interactionPolicy.evaluate({
      event: result.event,
      worldSnapshot: worldMutation.world,
      worldConditions: matchedConditions,
      runtimeContext: contextSources.snapshot(),
    });
    const stateResult = stateEngine.getResult(result.event.event_id)
      ?? (worldMutation.reason === 'correlation_already_counted' && result.event.type === 'conversation.input'
        ? stateEngine.snapshot(result.event.character_id ?? 'unbound')
        : stateEngine.ingest(result.event));
    const evidenceResult = correlationAlreadyCounted ? null : evidenceLedger.record({
      event: result.event,
      analysis: stateResult.analysis,
      worldMatches: matchedConditions,
    });
    const outputRoute = outputRouter.enqueue({
      source_event: result.event,
      output_plan: stateResult.outputs,
    });
    const bodyObservation = worldMutation.mutation?.details?.body;
    let bodyOutputRoute = null;
    if (bodyObservation?.accepted && bodyObservation.output_plan?.length) {
      bodyOutputRoute = outputRouter.enqueue({source_event:bodyObservation.source_event,output_plan:bodyObservation.output_plan});
      const linked=persistentWorld.get().body?.turns.find(turn=>turn.turn_id===bodyObservation.turn_id)?.commands.length;
      if(!linked)persistentWorld.ingest({event_id:`body-link:${bodyObservation.turn_id}`,type:'body.commands.linked',source:'body-output-router',
        character_id:DEFAULT_CHARACTER_ID,occurred_at:bodyObservation.turn.received_at,
        payload:{turn_id:bodyObservation.turn_id,commands:bodyOutputRoute.commands.map(command=>({...command,status:'queued',acknowledgment:null}))}},
      {...adapter,bodyInternal:true,commandAttested:true});
    }
    const roleEvolutionResult = result.duplicate
      ? null
      : roleEvolution.observeEvent(result.event);
    const worldCandidateResult = worldCandidates.observe(result.event, { world: worldMutation.world });
    return {
      event: result.event,
      duplicate: result.duplicate || worldMutation.duplicate,
      worldMutation,
      interactionDecision,
      stateResult,
      evidence: evidenceResult?.evidence ?? null,
      outputRoute,
      bodyOutputRoute,
      roleEvolution: roleEvolutionResult,
      worldCandidate: worldCandidateResult,
    };
  }

  function ingestWeatherEvent(event) {
    const adapter={attestedKind:'provider',sourceLabel:'上海天气 · Open-Meteo'};
    const result=ingestNonChatEvent(event,adapter);
    // A newly installed reference layer must also receive the connector's
    // still-valid cached observation. Reuse its origin, not a new weather fact.
    if(result.duplicate && persistentWorld.get().refraction) {
      const reference={...event,event_id:`weather-reference:${event.event_id}`,type:'weather.observation',
        observed_at:event.payload?.snapshot?.observed_at??event.observed_at,
        provenance:{...event.provenance,origin_event_id:event.provenance?.origin_event_id??event.correlation_id??event.event_id}};
      const saved=inputStore.save(normalizeEvent(reference,{now}));
      try { persistentWorld.ingest(saved.event,adapter); }
      catch(error){if(!saved.duplicate)inputStore.remove?.(saved.event.event_id);throw error;}
    }
    return result;
  }

  function assertPublicEventWorldMutation(event) {
    if (event.type !== 'world.mutation') return;
    throw new InputError(403, 'world_mutation_requires_review', 'canonical world mutations are server-owned; submit an observation for review or use a validated world action endpoint');
  }

  function normalizePublicEvent(body) {
    const previous = typeof body.event_id === 'string' ? inputStore.get(body.event_id) : null;
    const receivedAt = previous?.occurred_at ?? now().toISOString();
    return normalizeEvent({
      ...body,
      schema: 'foundry.event.v0.1',
      source: 'untrusted_observation',
      occurred_at: receivedAt,
      observed_at: receivedAt,
      layer: 'unclassified',
      source_kind: 'unknown',
      confidence: null,
      provider: null,
      provenance: null,
    }, { now: () => new Date(receivedAt) });
  }

  const inputRuntime = configuredInputRuntime ?? createInputRuntime({
    now,
    persistence,
    intervalMs: inputRuntimeIntervalMs,
  });
  const sourceAdapters=new Map(refractionSources.map(s=>{
    if(!s||!['provider','agent'].includes(s.kind)||typeof s.sourceId!=='string'||typeof s.displayName!=='string')throw new TypeError('Refraction sources require a server-owned sourceId, displayName and provider/agent kind');
    return [s.sourceId,{attestedKind:s.kind,sourceLabel:s.displayName,sourceUrl:s.sourceUrl??null}];
  }));
  function ingestRefractionSource(sourceId, event) {
    const adapter = sourceAdapters.get(sourceId);
    if (!adapter) throw new InputError(403, 'source_not_configured', '该消息源尚未在服务端配置。');
    const permitted = adapter.attestedKind === 'agent' ? /^(agent\.|npc\.message$)/ : /^(news\.|external\.)/;
    if (!permitted.test(event?.type ?? '')) throw new InputError(400, 'source_category_mismatch', '消息类型与接入口不一致。');
    let sourceUrl = adapter.sourceUrl;
    try {
      const item = new URL(event.payload?.source_url), configured = new URL(adapter.sourceUrl);
      if (item.protocol === 'https:' && item.hostname === configured.hostname && !item.username && !item.password) sourceUrl = item.href;
    } catch { /* Preserve the server's configured source link. */ }
    return ingestNonChatEvent({ ...event, source: `refraction-source:${sourceId}`, character_id: DEFAULT_CHARACTER_ID }, { ...adapter, sourceUrl });
  }
  for (const source of refractionSources.filter(s => typeof s.refresh === 'function')) {
    inputRuntime.registerSource({ sourceId: source.sourceId, displayName: source.displayName, kind: 'external_provider',
      enabled: source.enabled !== false, ttlMs: source.ttlMs, provider: source.sourceId,
      provenance: { connector: source.sourceId, source_url: source.sourceUrl, mutation: 'attributed_reference' },
      refresh: async options => {
        const result = await source.refresh(options);
        for (const event of result.events ?? []) {
          ingestRefractionSource(source.sourceId, event);
          source.acknowledge?.(event.event_id);
        }
        return result;
      } });
  }
  function inputReadModel(world = persistentWorld.get()) {
    const view = refractionReadModel(world, { now: now() });
    if (!view) return view;
    const connections = inputRuntime.status().sources.filter(s => sourceAdapters.has(s.source_id));
    if (connections.length) view.source_status = view.source_status.filter(s => s.id !== 'external');
    for (const s of connections) view.source_status.push({ id: s.source_id, name: s.display_name,
      status: s.enabled ? s.status === 'error' ? 'error' : s.freshness === 'fresh' ? 'fresh' : s.freshness === 'stale' ? 'stale' : 'unavailable' : 'disabled',
      last_success_at: s.last_success_at, next_attempt_at: s.next_attempt_at, ttl_ms: s.ttl_ms, error_code: s.last_error?.code ?? null });
    if (llm.status) {
      const model = llm.status();
      view.source_status.unshift({ id: 'model', name: `${model.model} · ${persistentWorld.get().memory?.planner.enabled?'对话与生活选择':'对话'}`, status: model.status });
    }
    return view;
  }
  if (weatherConnector?.refresh) {
    const weatherStatus = weatherConnector.status?.() ?? {};
    inputRuntime.registerSource({
      sourceId: 'weather',
      displayName: '天气实时观测',
      kind: 'external_provider',
      enabled: weatherStatus.enabled === true && weatherStatus.configured === true,
      ttlMs: weatherStatus.ttl_ms,
      provider: weatherStatus.provider,
      provenance: { connector: 'weather', layer: 'weather', mutation: 'update_weather' },
      refresh: ({ force = false } = {}) => weatherConnector.refresh({ force }),
      ingest: (event) => ingestWeatherEvent(event),
    });
    if (weatherConnector.forecast) {
      const forecastLabels = {
        minutely: '天气小实时预报缓存',
        hourly: '天气小时预报缓存',
        daily: '天气每日预报缓存',
      };
      for (const kind of ['minutely', 'hourly', 'daily']) {
        const kindStatus = weatherStatus.forecast?.[kind] ?? {};
        inputRuntime.registerSource({
          sourceId: `weather_forecast_${kind}`,
          displayName: forecastLabels[kind],
          kind: 'external_provider',
          enabled: weatherStatus.enabled === true && weatherStatus.configured === true,
          ttlMs: kindStatus.ttl_ms ?? inputRuntimeIntervalMs,
          provider: weatherStatus.provider,
          provenance: { connector: 'weather', layer: `weather_forecast.${kind}`, mutation: 'cache_only' },
          refresh: async ({ force = false } = {}) => {
            const result = await weatherConnector.forecast({ kinds: [kind], force });
            const refreshedStatus = weatherConnector.forecastStatus?.()[kind] ?? {};
            return {
              ...result,
              // Track this forecast kind rather than the current-weather connector clock.
              connector: {
                provider: result.connector?.provider ?? weatherStatus.provider,
                last_success_at: refreshedStatus.last_success_at ?? null,
                ttl_ms: refreshedStatus.ttl_ms ?? kindStatus.ttl_ms ?? inputRuntimeIntervalMs,
              },
            };
          },
        });
      }
    }
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/life/story-packages') {
      if (request.method === 'GET') { sendJson(response, 200, { schema: 'deskbot.story-package-list.v0.1', packages: listStoryPackages() }); return; }
      if (request.method === 'POST') {
        readJson(request).then(body => {
          const options = { now: now(), plans: sharedLife.plans(), world: persistentWorld.get() };
          const result = body.operation === 'preview'
            ? previewStoryPackage(body.package_id, options)
            : body.operation === 'install' ? installStoryPackage(body.package_id, { ...options, schedule: sharedLife.schedule })
              : (() => { throw new InputError(400, 'invalid_story_package_operation', 'Use preview or install'); })();
          sendJson(response, 200, result);
        }).catch(error => sendJson(response, error instanceof InputError || error instanceof PersistentWorldError ? error.statusCode : 500,
          { error: error.code ?? 'internal_error', message: error.message ?? 'Story package failed' }));
        return;
      }
    }
    if (url.pathname === '/api/life/content-packages' && request.method === 'GET') {
      try {
        sendJson(response, 200, { schema: 'deskbot.content-package-list.v0.1', packages: listContentPackages() });
      } catch (error) {
        sendJson(response, error instanceof InputError ? error.statusCode : 500, {
          error: error.code ?? 'content_package_error',
          message: error.message ?? 'Content package failed',
        });
      }
      return;
    }
    if (url.pathname === '/api/world/contract' && request.method === 'GET') {
      sendJson(response, 200, getCompanionWorldContract(persistentWorld.get()));
      return;
    }
    if (url.pathname === '/api/life/npc-goals') {
      if (request.method === 'GET') { sendJson(response, 200, { goals: npcGoals.list() }); return; }
      if (request.method === 'POST') {
        readJson(request).then(body => sendJson(response, 200, body.operation ? npcGoals.control(body.id, body.operation) : npcGoals.add(body)))
          .catch(error => sendJson(response, error instanceof InputError || error instanceof PersistentWorldError ? error.statusCode : 500,
            { error: error.code ?? 'internal_error', message: error instanceof InputError || error instanceof PersistentWorldError ? error.message : 'Internal error' }));
        return;
      }
    }
    if(url.pathname==='/api/life/body' && request.method==='GET') {
      const devices=(deviceBridge?.peers?.()??[]).filter(peer=>peer.character_id===DEFAULT_CHARACTER_ID).map(peer=>{
        const profile=bodyProfiles.get(peer.device_id),device=deviceRegistry.get(peer.device_id);
        return {device_id:peer.device_id,connected:peer.ready,transport:'websocket',simulated:profile?.simulated===true,
          hardware_verified:profile?.character_id===DEFAULT_CHARACTER_ID && profile.commissioned===true && profile.simulated!==true,
          capabilities:device?.capabilities??{},last_seen_at:device?.last_seen_at??null};
      });
      sendJson(response,200,{...(bodyReadModel(persistentWorld.get(),now().toISOString())??{enabled:false}),
        connection:{devices,hardware_verified:devices.some(device=>device.connected&&device.hardware_verified)}});return;
    }
    if(url.pathname==='/api/life/inputs') {
      if(request.method==='GET'){sendJson(response,200,inputReadModel());return;}
      if(request.method==='POST'){readJson(request).then(body=>{
        if(!persistentWorld.get().refraction)throw new InputError(409,'refraction_not_installed','现实输入参考尚未启用。');
        if(!Object.hasOwn(LIFE_SUGGESTIONS,body.suggestion))throw new InputError(400,'invalid_life_suggestion','请选择一个具体的生活建议。');
        const id=body.event_id??`life-suggestion-${randomUUID()}`;
        const result=ingestNonChatEvent({event_id:id,type:'user.preference.life',source:'life-suggestion-interface',character_id:DEFAULT_CHARACTER_ID,occurred_at:inputStore.get(id)?.occurred_at??now().toISOString(),payload:{suggestion:body.suggestion,text:LIFE_SUGGESTIONS[body.suggestion].title}},{attestedKind:'user',sourceLabel:'用户建议'});
        sendJson(response,result.duplicate?200:202,{accepted:true,duplicate:result.duplicate,inputs:refractionReadModel(persistentWorld.get(),{now:now()}),world_revision:result.worldMutation.world.world_revision});
      }).catch(error=>sendJson(response,error.statusCode??400,{error:error.code??'invalid_life_suggestion',message:error.message}));return;}
    }
    if(url.pathname==='/api/life/social') {
      if(request.method==='GET'){sendJson(response,200,socialReadModel(persistentWorld.get()));return;}
      if(request.method==='POST'){readJson(request).then(body=>{
        if(!['join','decline','withdraw'].includes(body.operation)||typeof body.invitation_id!=='string')throw new InputError(400,'invalid_social_response','请选择具体约定与参加、不参加或退出。');
        const id=body.event_id??`social-response-${randomUUID()}`;
        const result=ingestNonChatEvent({event_id:id,type:'world.mutation',source:'social-life-control',source_kind:'world_engine',character_id:DEFAULT_CHARACTER_ID,occurred_at:inputStore.get(id)?.occurred_at??now().toISOString(),payload:{action:'respond_social_invitation',invitation_id:body.invitation_id,operation:body.operation}});
        sendJson(response,200,{accepted:true,social:socialReadModel(persistentWorld.get()),world_revision:result.worldMutation.world.world_revision});
      }).catch(error=>sendJson(response,error.statusCode??500,{error:error.code??'internal_error',message:error.message}));return;}
    }
    if (url.pathname === '/api/life/autonomy') {
      if (request.method === 'GET') { sendJson(response, 200, autonomousLife.snapshot()); return; }
      if (request.method === 'POST') {
        readJson(request).then(body => {
          if (!['pause','resume'].includes(body.operation)) throw new InputError(400,'invalid_autonomy_operation','Use pause or resume');
          const controlId=body.event_id??`life-control-${randomUUID()}`;
          const result=ingestNonChatEvent({event_id:controlId,type:'world.mutation',source:'world-life-control',source_kind:'world_engine',character_id:DEFAULT_CHARACTER_ID,occurred_at:inputStore.get(controlId)?.occurred_at??now().toISOString(),payload:{action:'control_autonomy',operation:body.operation}});
          sendJson(response,200,{accepted:true,autonomy:autonomousLife.snapshot(),world_revision:result.worldMutation.world.world_revision});
        }).catch(error=>sendJson(response,error.statusCode??500,{error:error.code??'internal_error',message:error.message}));
        return;
      }
    }
    if (url.pathname === '/api/life/npc-agents' && request.method === 'GET') {
      const limit = Number(url.searchParams.get('limit') ?? 24);
      const npcId = url.searchParams.get('npc_id') || null;
      sendJson(response, 200, {
        schema: 'deskbot.npc-agent-decision-list.v0.1',
        decisions: worldLife.npcAgentLoop.list({ npcId, limit }),
      });
      return;
    }
    if (url.pathname === '/api/life/world') {
      if (request.method === 'GET') {
        sendJson(response, 200, worldLife.snapshot());
        return;
      }
    }
    if (url.pathname === '/api/life/world/replay' && request.method === 'POST') {
      readJson(request)
        .then(body => worldLife.replay(body))
        .then(result => sendJson(response, 200, result))
        .catch(error => sendJson(response, error instanceof InputError || error instanceof PersistentWorldError ? error.statusCode : 500, {
          error: error.code ?? 'internal_error',
          message: error instanceof InputError || error instanceof PersistentWorldError ? error.message : 'World life replay failed',
        }));
      return;
    }
    if (url.pathname === '/api/life/experiences' && request.method === 'GET') {
      sendJson(response, 200, { experiences: sharedLife.retrieveExperiences(url.searchParams.get('query') ?? '') });
      return;
    }
    if (url.pathname === '/api/life/npc-interactions' && request.method === 'POST') {
      readJson(request)
        .then((body) => worldLife.interactWithAgent(body))
        .then((result) => sendJson(response, 200, result))
        .catch((error) => sendJson(response, error instanceof InputError || error instanceof PersistentWorldError ? error.statusCode : 500,
          { error: error.code ?? 'internal_error', message: error instanceof InputError || error instanceof PersistentWorldError ? error.message : 'NPC interaction failed' }));
      return;
    }
    if (url.pathname === '/api/life/commitments') {
      if (request.method === 'GET') {
        sendJson(response, 200, { commitments: sharedLifeReports.listCommitments({
          characterId: url.searchParams.get('character_id'),
          status: url.searchParams.get('status'),
        }) });
        return;
      }
      if (request.method === 'POST') {
        readJson(request)
          .then(body => body.operation === 'resolve' || body.operation === 'cancel'
            ? sharedLifeReports.updateCommitment(body)
            : sharedLifeReports.createCommitment(body))
          .then(result => sendJson(response, 200, result))
          .catch(error => sendJson(response, error instanceof InputError ? error.statusCode : 500, {
            error: error instanceof InputError ? error.code : 'internal_error',
            message: error instanceof InputError ? error.message : 'Commitment operation failed',
          }));
        return;
      }
    }
    if (url.pathname === '/api/life/relationship-trends' && request.method === 'GET') {
      sendJson(response, 200, { trends: sharedLifeReports.relationshipTrends({
        npcId: url.searchParams.get('npc_id'),
        day: url.searchParams.get('day'),
      }) });
      return;
    }
    if (url.pathname === '/api/life/daily-summary') {
      if (request.method === 'GET') {
        const summary = sharedLifeReports.getDailySummary({
          day: url.searchParams.get('day'),
          characterId: url.searchParams.get('character_id') ?? undefined,
          materialize: url.searchParams.get('materialize') === 'true',
        });
        sendJson(response, 200, { summary });
        return;
      }
      if (request.method === 'POST') {
        readJson(request)
          .then(body => body.operation === 'preview'
            ? sharedLifeReports.previewDailySummary(body)
            : sharedLifeReports.materializeDailySummary(body))
          .then(summary => sendJson(response, 200, { summary }))
          .catch(error => sendJson(response, error instanceof InputError ? error.statusCode : 500, {
            error: error instanceof InputError ? error.code : 'internal_error',
            message: error instanceof InputError ? error.message : 'Daily summary operation failed',
          }));
        return;
      }
    }
    if (url.pathname === '/api/life/daily-summaries' && request.method === 'GET') {
      sendJson(response, 200, { summaries: sharedLifeReports.listDailySummaries({ characterId: url.searchParams.get('character_id') }) });
      return;
    }
    if (url.pathname === '/api/life/continuity' && request.method === 'GET') {
      sendJson(response, 200, sharedLifeReports.promptContinuity({
        day: url.searchParams.get('day'),
        characterId: url.searchParams.get('character_id') ?? undefined,
      }));
      return;
    }
    if (url.pathname === '/api/life/memories' || url.pathname === '/api/life/plans') {
      const isMemory = url.pathname.endsWith('/memories');
      if (request.method === 'GET') {
        sendJson(response, 200, isMemory
          ? { memories: sharedLife.recall(url.searchParams.get('character_id') ?? undefined, Infinity) }
          : { plans: sharedLife.plans() });
        return;
      }
      if (request.method === 'POST') {
        readJson(request).then(body => {
          const result = isMemory
            ? body.operation === 'forget'
              ? { removed: sharedLife.forget(body.id) } : sharedLife.remember(body)
            : body.operation === 'cancel' ? sharedLife.cancel(body.id) : sharedLife.schedule(body);
          sendJson(response, 200, result);
        }).catch(error => sendJson(response, error instanceof InputError ? error.statusCode : 500,
          { error: error instanceof InputError ? error.code : 'internal_error', message: error instanceof InputError ? error.message : 'Internal error' }));
        return;
      }
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-origin': '*',
      });
      response.end();
      return;
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, {
        schema: 'foundry.health.v0.1',
        service: 'deskbot-service',
        status: 'ok',
        version: SERVICE_VERSION,
        time: now().toISOString(),
      });
      return;
    }

    if (url.pathname === '/api/life/memory' && request.method==='GET') {sendJson(response,200,memoryReadModel(persistentWorld.get()));return;}
    if (url.pathname === '/api/life/development' && request.method==='GET') {
      sendJson(response,200,developmentReadModel(persistentWorld.get(),{actorId:url.searchParams.get('actor_id')??undefined,limit:url.searchParams.get('limit')??48}));return;
    }
    if (request.method === 'GET' && url.pathname === '/api/model/status') {
      sendJson(response, 200, { ...(llm.status?.() ?? { provider: llm.id, configured: llm.id !== 'fake-llm-v0.1', status: llm.id === 'fake-llm-v0.1' ? 'test_provider' : 'configured', role: 'dialogue_only', high_level_decisions: 'bounded_rules' }), ...(persistentWorld.get().memory?.planner.enabled?{role:'dialogue_and_life_choice',high_level_decisions:'bounded_model_choice_v1'}:{}) });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/voice/health') {
      if (!voiceClient) {
        sendJson(response, 503, {
          schema: 'foundry.voice-health.v0.1',
          status: 'unavailable',
          error: 'voice_sidecar_not_configured',
        });
        return;
      }
      voiceClient.health()
        .then((body) => sendJson(response, 200, body))
        .catch((error) => {
          const expected = error instanceof VoiceSidecarError;
          sendJson(response, expected ? (error.statusCode ?? 503) : 503, {
            schema: 'foundry.voice-error.v0.1',
            error: {
              code: expected ? error.code : 'transport_error',
              message: expected ? error.message : 'voice sidecar health check failed',
              retryable: expected ? error.retryable : true,
            },
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/voice/capabilities') {
      if (!voiceClient) {
        sendJson(response, 503, {
          schema: 'foundry.voice-capabilities.v0.1',
          error: 'voice_sidecar_not_configured',
        });
        return;
      }
      voiceClient.capabilities()
        .then((body) => sendJson(response, 200, body))
        .catch((error) => {
          const expected = error instanceof VoiceSidecarError;
          sendJson(response, expected ? (error.statusCode ?? 503) : 503, {
            schema: 'foundry.voice-error.v0.1',
            error: {
              code: expected ? error.code : 'transport_error',
              message: expected ? error.message : 'voice sidecar capabilities check failed',
              retryable: expected ? error.retryable : true,
            },
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/audio') {
      sendJson(response, 200, {
        schema: 'foundry.audio-artifact-list.v0.1',
        artifacts: audioArtifacts.list({ limit: url.searchParams.get('limit') ?? 50 }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
      const audioId = decodeURIComponent(url.pathname.slice('/api/audio/'.length));
      const artifact = audioArtifacts.read(audioId);
      if (!artifact) {
        sendJson(response, 404, { error: 'audio_not_found', message: `audio ${audioId} does not exist` });
        return;
      }
      const contentType = artifact.content_type
        ?? (artifact.format.codec === 'wav'
          ? 'audio/wav'
          : artifact.format.codec === 'opus'
            ? 'audio/ogg; codecs=opus'
            : 'application/octet-stream');
      sendBinary(response, 200, artifact.buffer, {
        contentType,
        headers: {
          'x-audio-id': artifact.audio_id,
          'x-audio-codec': artifact.format.codec,
          'x-audio-sample-rate-hz': String(artifact.format.sample_rate_hz),
          'x-audio-channels': String(artifact.format.channels),
          'x-audio-sha256': artifact.sha256,
          ...(artifact.content_type === null ? {} : { 'x-audio-content-type': artifact.content_type }),
          ...(artifact.duration_ms === null ? {} : { 'x-audio-duration-ms': String(artifact.duration_ms) }),
        },
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/voice/asr') {
      readJson(request, 20 * 1024 * 1024)
        .then((body) => ingress.ingest(body))
        .then((result) => sendJson(response, result.duplicate ? 200 : 202, result))
        .catch((error) => {
          const expected = error instanceof VoiceIngressError || error instanceof InputError;
          sendJson(response, expected ? error.statusCode : 500, {
            schema: 'foundry.voice-error.v0.1',
            error: {
              code: expected ? error.code : 'internal_error',
              message: expected ? error.message : 'voice ASR ingest failed',
              retryable: false,
            },
          });
        });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/voice/transcribe') {
      if (!voiceClient) {
        sendJson(response, 503, {
          schema: 'foundry.voice-error.v0.1',
          error: { code: 'voice_sidecar_not_configured', message: 'voice sidecar is not configured', retryable: false },
        });
        return;
      }
      readJson(request, 20 * 1024 * 1024)
        .then(async (body) => {
          const sidecarResult = await voiceClient.transcribe(body);
          const resultList = Array.isArray(sidecarResult.results) ? sidecarResult.results : null;
          // An explicit empty result list means the recognizer observed no
          // segment. Do not manufacture a voice event from the normalized
          // envelope; only fall back to the envelope when it carries an
          // actual top-level stage or transcript field.
          const rawSidecar = sidecarResult.raw
            && typeof sidecarResult.raw === 'object'
            && !Array.isArray(sidecarResult.raw)
            ? sidecarResult.raw
            : sidecarResult;
          const hasTopLevelResult = [
            'stage',
            'raw_utterance',
            'raw_text',
            'clean_utterance',
            'cleaned_text',
            'text',
          ].some((field) => Object.prototype.hasOwnProperty.call(rawSidecar, field))
            || rawSidecar.is_final === true
            || rawSidecar.final === true
            || rawSidecar.partial === true;
          const resultItems = resultList === null
            ? (hasTopLevelResult ? [sidecarResult] : [])
            : resultList.length > 0
              ? resultList
              : hasTopLevelResult
                ? [sidecarResult]
                : [];
          const ingested = [];
          for (const item of resultItems) {
            ingested.push(await ingress.ingest({
              ...body,
              ...sidecarResult,
              ...item,
              character_id: body.character_id,
              device_id: body.device_id,
              shell_id: body.shell_id,
              role_revision: body.role_revision,
              correlation_id: sidecarResult.correlation_id ?? body.correlation_id,
              utterance_id: sidecarResult.utterance_id ?? body.utterance_id,
              request_id: sidecarResult.request_id ?? body.request_id,
            }));
          }
          return { schema: 'foundry.voice-transcription.v0.1', accepted: true, sidecar: sidecarResult, ingested };
        })
        .then((result) => sendJson(response, result.ingested.some((item) => item.duplicate) ? 200 : 202, result))
        .catch((error) => {
          const expected = error instanceof VoiceSidecarError || error instanceof VoiceIngressError || error instanceof InputError;
          sendJson(response, expected ? (error.statusCode ?? 400) : 500, {
            schema: 'foundry.voice-error.v0.1',
            error: {
              code: expected ? error.code : 'internal_error',
              message: expected ? error.message : 'voice transcription failed',
              retryable: expected ? error.retryable === true : false,
              ...(expected && error.correlationId ? { correlation_id: error.correlationId } : {}),
              ...(expected && error.requestId ? { request_id: error.requestId } : {}),
            },
          });
        });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/voice/tts') {
      if (!voiceClient) {
        sendJson(response, 503, {
          schema: 'foundry.voice-error.v0.1',
          error: { code: 'voice_sidecar_not_configured', message: 'voice sidecar is not configured', retryable: false },
        });
        return;
      }
      readJson(request, 2 * 1024 * 1024)
        .then(async (body) => {
          const tts = await voiceClient.synthesize(body);
          const stored = audioArtifacts.put({
            ...tts.audio,
            audio_id: tts.audio.audio_id ?? tts.request_id,
            correlation_id: tts.correlation_id,
            request_id: tts.request_id,
            profile: tts.profile,
          });
          const { data_base64: ignoredData, ...audio } = stored.artifact;
          return {
            schema: 'foundry.voice-tts.v0.1',
            accepted: true,
            duplicate: stored.duplicate,
            request_id: tts.request_id,
            correlation_id: tts.correlation_id,
            profile: tts.profile,
            audio: { ...audio, audio_ref: `/api/audio/${encodeURIComponent(audio.audio_id)}` },
          };
        })
        .then((result) => sendJson(response, result.duplicate ? 200 : 202, result))
        .catch((error) => {
          const expected = error instanceof VoiceSidecarError || error instanceof AudioArtifactError;
          sendJson(response, expected ? (error.statusCode ?? 400) : 500, {
            schema: 'foundry.voice-error.v0.1',
            error: {
              code: expected ? error.code : 'internal_error',
              message: expected ? error.message : 'voice TTS failed',
              retryable: expected ? error.retryable === true : false,
            },
          });
        });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/voice/cancel') {
      if (!voiceClient) {
        sendJson(response, 503, {
          schema: 'foundry.voice-error.v0.1',
          error: { code: 'voice_sidecar_not_configured', message: 'voice sidecar is not configured', retryable: false },
        });
        return;
      }
      readJson(request)
        .then((body) => voiceClient.cancel(body))
        .then((result) => sendJson(response, 200, result))
        .catch((error) => {
          const expected = error instanceof VoiceSidecarError;
          sendJson(response, expected ? (error.statusCode ?? 400) : 500, {
            schema: 'foundry.voice-error.v0.1',
            error: { code: expected ? error.code : 'internal_error', message: expected ? error.message : 'voice cancel failed', retryable: expected ? error.retryable === true : false },
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/events') {
      sendJson(response, 200, {
        schema: 'foundry.event-list.v0.1',
        events: inputStore.list({
          limit: url.searchParams.get('limit') ?? 50,
          layer: url.searchParams.get('layer') ?? undefined,
          sourceKind: url.searchParams.get('source_kind') ?? undefined,
          type: url.searchParams.get('type') ?? undefined,
        }),
      });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/api/context' || url.pathname === '/api/connections')) {
      sendJson(response, 200, contextSources.snapshot());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/input-runtime') {
      sendJson(response, 200, inputRuntime.status());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/connectors/weather') {
      sendJson(response, 200, weatherConnector?.status?.() ?? {
        schema: 'foundry.weather-connector-status.v0.1',
        source_id: 'weather',
        enabled: false,
        configured: false,
        status: 'not_configured',
        connection: 'not_configured',
        provider: null,
        endpoint: null,
        location: null,
        coordinates: null,
        timezone: null,
        last_attempt_at: null,
        last_success_at: null,
        freshness: 'unavailable',
        last_error: null,
        credential_policy: '天气 connector 尚未配置。',
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/connectors/weather/refresh') {
      if (!weatherConnector?.refresh) {
        sendJson(response, 503, {
          schema: 'foundry.weather-connector-error.v0.1',
          error: { code: 'weather_connector_not_configured', message: '天气 connector 未配置', retryable: false },
        });
        return;
      }
      readJson(request, 64 * 1024, { allowEmpty: true })
        .then((body) => weatherConnector.refresh({ force: body.force === true }))
        .then(({ connector, event, snapshot, cached }) => {
          const result = ingestWeatherEvent(event);
          sendJson(response, result.duplicate ? 200 : 202, {
            schema: 'foundry.weather-refresh-accepted.v0.1',
            accepted: true,
            duplicate: result.duplicate,
            cached: cached === true,
            connector,
            snapshot,
            event: result.event,
            world_mutation: result.worldMutation,
            interaction_decision: result.interactionDecision,
            evidence: result.evidence,
          });
        })
        .catch((error) => {
          const expected = error instanceof WeatherConnectorError || error instanceof InputError;
          sendJson(response, expected ? (error.statusCode ?? 502) : 500, {
            schema: 'foundry.weather-connector-error.v0.1',
            error: {
              code: expected ? error.code : 'weather_connector_internal_error',
              message: expected ? error.message : '天气 connector 刷新失败',
              retryable: expected ? error.retryable === true : false,
            },
            connector: weatherConnector.status?.() ?? null,
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/connectors/weather/forecast') {
      const forecast = weatherConnector?.forecastSnapshot?.() ?? {};
      sendJson(response, 200, {
        schema: 'foundry.weather-forecast-status.v0.1',
        connector: weatherConnector?.status?.() ?? null,
        forecast,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/connectors/weather/forecast/refresh') {
      if (!weatherConnector?.forecast) {
        sendJson(response, 503, {
          schema: 'foundry.weather-connector-error.v0.1',
          error: { code: 'weather_connector_not_configured', message: '天气 connector 未配置', retryable: false },
        });
        return;
      }
      readJson(request, 64 * 1024, { allowEmpty: true })
        .then((body) => weatherConnector.forecast({ force: body.force === true, kinds: body.kinds ?? body.kind ?? 'all' }))
        .then((result) => {
          const allCached = Object.values(result.cached ?? {}).every((value) => value === true);
          sendJson(response, allCached ? 200 : 202, {
            schema: 'foundry.weather-forecast-accepted.v0.1',
            accepted: true,
            ...result,
          });
        })
        .catch((error) => {
          const expected = error instanceof WeatherConnectorError || error instanceof InputError;
          sendJson(response, expected ? (error.statusCode ?? 502) : 500, {
            schema: 'foundry.weather-connector-error.v0.1',
            error: {
              code: expected ? error.code : 'weather_forecast_internal_error',
              message: expected ? error.message : '天气预报刷新失败',
              retryable: expected ? error.retryable === true : false,
            },
            connector: weatherConnector.status?.() ?? null,
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/interaction/decisions') {
      sendJson(response, 200, {
        schema: 'foundry.interaction-decision-list.v0.1',
        policy_version: interactionPolicy.policyVersion,
        decisions: interactionPolicy.list({
          characterId: url.searchParams.get('character_id') ?? null,
          route: url.searchParams.get('route') ?? null,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    if (url.pathname === '/api/interaction/candidates') {
      if (request.method === 'GET') {
        const characterId = url.searchParams.get('character_id') ?? null;
        sendJson(response, 200, {
          schema: 'foundry.interaction-candidate-list.v0.1',
          policy_version: interactionPolicy.policyVersion,
          character_id: characterId,
          candidates: interactionPolicy.listCandidates({
            characterId,
            status: url.searchParams.get('status') ?? null,
            route: url.searchParams.get('route') ?? 'proactive_candidate',
            limit: url.searchParams.get('limit') ?? 50,
          }),
          settings: interactionPolicy.getSettings(characterId),
        });
        return;
      }
    }

    const candidateActionMatch = url.pathname.match(/^\/api\/interaction\/candidates\/([^/]+)$/);
    if (request.method === 'POST' && candidateActionMatch) {
      const eventId = decodeURIComponent(candidateActionMatch[1]);
      readJson(request, 64 * 1024)
        .then((body) => {
          const candidate = interactionPolicy.resolveCandidate(eventId, {
            characterId: body.character_id ?? null,
            action: body.action,
            deferredUntil: body.deferred_until ?? null,
            reason: body.reason ?? null,
          });
          sendJson(response, 200, {
            schema: 'foundry.interaction-candidate-action.v0.1',
            accepted: true,
            candidate,
          });
        })
        .catch((error) => {
          const expected = error instanceof InputError || error instanceof InteractionPolicyError;
          sendJson(response, expected ? (error.statusCode ?? 400) : 500, {
            error: expected ? error.code : 'interaction_candidate_action_failed',
            message: expected ? error.message : 'interaction candidate action failed',
          });
        });
      return;
    }

    if (url.pathname === '/api/interaction/settings') {
      if (request.method === 'GET') {
        const characterId = url.searchParams.get('character_id') ?? null;
        sendJson(response, 200, {
          schema: 'foundry.interaction-settings-response.v0.1',
          settings: interactionPolicy.getSettings(characterId),
        });
        return;
      }
      if (request.method === 'POST' || request.method === 'PUT') {
        readJson(request, 64 * 1024)
          .then((body) => {
            if (body.character_id === undefined && body.characterId === undefined) {
              throw new InputError(400, 'character_id_required', 'character_id is required');
            }
            const settings = interactionPolicy.updateSettings({
              characterId: body.character_id ?? body.characterId,
              proactiveEnabled: body.proactive_enabled ?? body.proactiveEnabled,
              quietUntil: body.quiet_until === undefined ? body.quietUntil : body.quiet_until,
            });
            sendJson(response, 200, {
              schema: 'foundry.interaction-settings-response.v0.1',
              accepted: true,
              settings,
            });
          })
          .catch((error) => {
            const expected = error instanceof InputError || error instanceof InteractionPolicyError;
            sendJson(response, expected ? (error.statusCode ?? 400) : 500, {
              error: expected ? error.code : 'interaction_settings_update_failed',
              message: expected ? error.message : 'interaction settings update failed',
            });
          });
        return;
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/roles/pulls') {
      const characterId = url.searchParams.get('character_id') ?? null;
      sendJson(response, 200, {
        schema: 'deskbot.fantasy-pull-list.v0.2',
        rule_version: 'fantasy-pull.v0.3',
        character_id: characterId,
        pulls: rolePulls({ characterId, limit: url.searchParams.get('limit') ?? 200 }),
      });
      return;
    }

    if (request.method === 'GET' && ['/api/roles/evolution', '/api/role-evolution/status'].includes(url.pathname)) {
      const characterId = url.searchParams.get('character_id') ?? null;
      const snapshot = roleEvolution.snapshot({ characterId, limit: url.searchParams.get('limit') ?? 50 });
      sendJson(response, 200, {
        accepted: true,
        character_id: characterId,
        ...snapshot,
        proposals: roles.list({ characterId, limit: url.searchParams.get('limit') ?? 50 }),
        active_trials: roles.activeTrials({ characterId, limit: url.searchParams.get('limit') ?? 20 }),
        current_stages: roles.currentStages({ characterId, limit: 10 }),
        ...(url.pathname === '/api/role-evolution/status'
          ? { schema: 'deskbot.role-evolution-status.v0.1', snapshot_schema: snapshot.schema }
          : {}),
      });
      return;
    }

    if (request.method === 'POST' && ['/api/roles/evolution/sync', '/api/role-evolution/run'].includes(url.pathname)) {
      readJson(request, 64 * 1024, { allowEmpty: true })
        .then((body) => roleEvolution.sync({
          characterId: body.character_id ?? body.characterId ?? undefined,
          limit: body.limit ?? 200,
        }))
        .then((result) => sendJson(response, result.duplicate ? 200 : 201, {
          accepted: true,
          ...result,
          ...(url.pathname === '/api/role-evolution/run'
            ? { schema: 'deskbot.role-evolution-run-response.v0.1', run_schema: result.schema }
            : {}),
        }))
        .catch((error) => sendRoleError(response, error));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/roles/proposals') {
      sendJson(response, 200, {
        schema: 'deskbot.role-direction-proposal-list.v0.1',
        proposals: roles.list({
          characterId: url.searchParams.get('character_id') ?? null,
          status: url.searchParams.get('status') ?? null,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/roles/trials') {
      sendJson(response, 200, {
        schema: 'deskbot.role-direction-trial-list.v0.1',
        character_id: url.searchParams.get('character_id') ?? null,
        trials: roles.activeTrials({
          characterId: url.searchParams.get('character_id') ?? null,
          limit: url.searchParams.get('limit') ?? 10,
        }),
      });
      return;
    }

    const roleProposalMatch = url.pathname.match(/^\/api\/roles\/proposals\/([^/]+)$/);
    if (request.method === 'GET' && roleProposalMatch) {
      const proposal = roles.get(decodeURIComponent(roleProposalMatch[1]));
      if (!proposal) {
        sendJson(response, 404, { error: 'role_proposal_not_found', message: 'role proposal not found' });
      } else {
        sendJson(response, 200, { schema: 'deskbot.role-direction-proposal-response.v0.1', proposal, decisions: roles.decisions({ proposalId: proposal.proposal_id }) });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/roles/proposals') {
      readJson(request)
        .then((body) => {
          const characterId = requiredRoleText(body.character_id, 'character_id');
          const directionId = requiredRoleText(body.direction_id, 'direction_id');
          const requestedProposalId = optionalRoleText(body.proposal_id, 'proposal_id');
          const pulls = rolePulls({ characterId });
          const pull = directionId
            ? pulls.find((item) => item.direction_id === directionId)
            : pulls.find((item) => item.status === 'candidate');
          if (!pull || pull.status !== 'candidate') {
            throw new RoleProposalError(409, 'role_direction_not_candidate', 'direction must currently be a candidate');
          }
          const existing = requestedProposalId
            ? roles.get(requestedProposalId)
            : roles.list({ characterId }).reverse().find((item) => item.direction_id === directionId
              && ['proposed', 'deferred', 'trying'].includes(item.status));
          if (existing) return { duplicate: true, proposal: existing };
          const proposal = roles.propose(pull, { proposalId: requestedProposalId, characterId });
          return { duplicate: Boolean(existing), proposal };
        })
        .then((result) => sendJson(response, result.duplicate ? 200 : 201, { schema: 'deskbot.role-proposal-accepted.v0.1', accepted: true, ...result }))
        .catch((error) => sendRoleError(response, error));
      return;
    }

    const roleActionMatch = url.pathname.match(/^\/api\/roles\/proposals\/([^/]+)\/(choose|trial\/start|trial\/observations|trial\/complete|archive)$/);
    if (request.method === 'POST' && roleActionMatch) {
      const proposalId = decodeURIComponent(roleActionMatch[1]);
      const action = roleActionMatch[2];
      readJson(request, 64 * 1024, { allowEmpty: action === 'trial/start' || action === 'archive' })
        .then((body) => {
          const reason = optionalRoleText(body.reason, 'reason');
          if (action === 'choose') return roles.choose(proposalId, body.choice, { reason });
          if (action === 'trial/start') {
            const rawWindow = body.window_turns ?? body.windowTurns ?? 5;
            const windowTurns = typeof rawWindow === 'string' && /^\d+$/.test(rawWindow.trim()) ? Number(rawWindow) : rawWindow;
            return roles.startTrial(proposalId, { windowTurns });
          }
          if (action === 'trial/observations') return roles.recordTrialObservation(proposalId, { eventId: requiredRoleText(body.event_id ?? body.eventId, 'event_id'), signal: body.signal ?? 'neutral', evidenceId: optionalRoleText(body.evidence_id ?? body.evidenceId, 'evidence_id') });
          if (action === 'trial/complete') return roles.completeTrial(proposalId, { decision: body.decision ?? 'deferred', reason });
          return roles.archive(proposalId, { reason });
        })
        .then((result) => {
          if (!result) {
            sendJson(response, 404, { error: 'role_proposal_not_found', message: 'role proposal not found' });
            return;
          }
          sendJson(response, 202, { schema: 'deskbot.role-proposal-action-accepted.v0.1', accepted: true, proposal: result.proposal ?? result, ...(result.decision ? { decision: result.decision } : {}) });
        })
        .catch((error) => sendRoleError(response, error));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/world/schema') {
      sendJson(response, 200, getWorldSchema(persistentWorld.get()));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/world/candidates') {
      sendJson(response, 200, {
        schema: 'deskbot.world-candidate-list.v0.1',
        candidates: worldCandidates.list({
          worldId: url.searchParams.get('world_id') ?? null,
          characterId: url.searchParams.get('character_id') ?? null,
          status: url.searchParams.get('status') ?? null,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    const worldCandidateMatch = url.pathname.match(/^\/api\/world\/candidates\/([^/]+)$/);
    if (request.method === 'GET' && worldCandidateMatch) {
      const candidate = worldCandidates.get(decodeURIComponent(worldCandidateMatch[1]));
      if (!candidate) {
        sendJson(response, 404, { error: 'world_candidate_not_found', message: 'world candidate not found' });
      } else {
        sendJson(response, 200, { schema: 'deskbot.world-candidate-response.v0.1', candidate });
      }
      return;
    }

    const worldCandidateActionMatch = url.pathname.match(/^\/api\/world\/candidates\/([^/]+)\/(preview|accept|dismiss)$/);
    if (request.method === 'POST' && worldCandidateActionMatch) {
      const candidateId = decodeURIComponent(worldCandidateActionMatch[1]);
      const action = worldCandidateActionMatch[2];
      readJson(request, 64 * 1024, { allowEmpty: true })
        .then((body) => {
          if (action === 'preview') return worldCandidates.preview(candidateId);
          if (action === 'accept') return worldCandidates.accept(candidateId, {
            expectedWorldRevision: body.expected_world_revision ?? body.expectedWorldRevision,
          });
          return worldCandidates.dismiss(candidateId, { reason: body.reason ?? null });
        })
        .then((result) => sendJson(response, result.duplicate ? 200 : (action === 'accept' ? 202 : 200), {
          schema: `deskbot.world-candidate-${action}-response.v0.1`,
          accepted: action !== 'dismiss' || result.candidate?.status === 'dismissed',
          ...result,
        }))
        .catch((error) => sendWorldCandidateError(response, error));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/research/scenarios') {
      sendJson(response, 200, getResearchScenarioCatalog());
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/research/scenarios/run') {
      readJson(request)
        .then((body) => runResearchScenario(body.scenario_id))
        .then((report) => sendJson(response, 200, report))
        .catch((error) => {
          const expected = error instanceof InputError || error instanceof ResearchScenarioError;
          sendJson(response, expected ? error.statusCode : 500, {
            error: expected ? error.code : 'internal_error',
            message: expected ? error.message : 'research scenario failed',
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/research/probes') {
      const catalog = getL1bProbeCatalog();
      sendJson(response, 200, {
        ...catalog,
        observation_count: l1bProbeStore.size(),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/research/probe-observations') {
      sendJson(response, 200, {
        schema: 'foundry.l1b-probe-observation-list.v0.1',
        probe_version: getL1bProbeCatalog().probe_version,
        observations: l1bProbeStore.list({
          characterId: url.searchParams.get('character_id') ?? null,
          limit: url.searchParams.get('limit') ?? 100,
        }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/research/session-contract') {
      sendJson(response, 200, getResearchSessionContract());
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/research/sessions') {
      sendJson(response, 200, {
        schema: 'foundry.research-session-list.v0.1',
        session_version: getResearchSessionContract().session_version,
        sessions: sessionStore.list({
          characterId: url.searchParams.get('character_id') ?? null,
          status: url.searchParams.get('status') ?? null,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    const sessionMatch = url.pathname.match(/^\/api\/research\/sessions\/([^/]+)$/);
    if (request.method === 'GET' && sessionMatch) {
      const session = sessionStore.get(decodeURIComponent(sessionMatch[1]));
      if (!session) {
        sendJson(response, 404, { error: 'research_session_not_found', message: 'research session not found' });
      } else {
        sendJson(response, 200, { schema: 'foundry.research-session.v0.1', session });
      }
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/research/sessions') {
      readJson(request)
        .then((body) => sessionStore.start(body))
        .then((result) => sendJson(response, result.duplicate ? 200 : 201, {
          schema: 'foundry.research-session-accepted.v0.1',
          accepted: true,
          ...result,
        }))
        .catch((error) => sendResearchSessionError(response, error));
      return;
    }

    const sessionActionMatch = url.pathname.match(/^\/api\/research\/sessions\/([^/]+)\/(turns|probes|notes|complete)$/);
    if (request.method === 'POST' && sessionActionMatch) {
      const sessionId = decodeURIComponent(sessionActionMatch[1]);
      const action = sessionActionMatch[2];
      readJson(request)
        .then((body) => {
          if (action === 'turns') return sessionStore.attachTurn(sessionId, body);
          if (action === 'probes') return sessionStore.attachProbe(sessionId, body);
          if (action === 'notes') return sessionStore.addNote(sessionId, body);
          return sessionStore.complete(sessionId, body);
        })
        .then((result) => sendJson(response, result.duplicate ? 200 : 202, {
          schema: 'foundry.research-session-accepted.v0.1',
          accepted: true,
          ...result,
        }))
        .catch((error) => sendResearchSessionError(response, error));
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/research/probe-observations') {
      readJson(request)
        .then((body) => l1bProbeStore.record(body))
        .then((result) => sendJson(response, result.duplicate ? 200 : 201, {
          schema: 'foundry.l1b-probe-observation-accepted.v0.1',
          accepted: true,
          duplicate: result.duplicate,
          observation: result.observation,
        }))
        .catch((error) => {
          const expected = error instanceof InputError || error instanceof L1bProbeError;
          sendJson(response, expected ? error.statusCode : 500, {
            error: expected ? error.code : 'internal_error',
            message: expected ? error.message : 'l1b probe observation failed',
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/evidence') {
      sendJson(response, 200, {
        schema: 'foundry.evidence-list.v0.1',
        evidence: evidenceLedger.list({
          characterId: url.searchParams.get('character_id') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/world/matches') {
      sendJson(response, 200, {
        schema: 'foundry.world-match-list.v0.1',
        matches: worldContext.matches({
          characterId: url.searchParams.get('character_id') ?? undefined,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/api/world' || url.pathname === '/api/world/state')) {
      const worldId = url.searchParams.get('world_id') ?? undefined;
      const world = persistentWorld.get(worldId);
      if (!world) {
        sendJson(response, 404, { error: 'world_not_found', message: `world ${worldId} does not exist` });
        return;
      }
      sendJson(response, 200, {
        schema: 'foundry.canonical-world-response.v0.1',
        world,
      });
      return;
    }

    // The map is a read model derived from canonical world state. Travel is
    // intentionally funneled through the normal world.mutation ingestion path
    // so adjacency, event blocking, time costs, and idempotency stay server-owned.
    if (request.method === 'GET' && url.pathname === '/api/world/map') {
      const worldId = url.searchParams.get('world_id') ?? undefined;
      const world = persistentWorld.get(worldId);
      if (!world) {
        sendJson(response, 404, { error: 'world_not_found', message: `world ${worldId} does not exist` });
        return;
      }
      const map = getWorldMap(world, {
        characterId: url.searchParams.get('character_id') ?? world.protagonist?.character_id,
      });
      if (map.refraction) map.refraction = inputReadModel(world);
      sendJson(response, 200, map);
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/world/route') {
      const worldId = url.searchParams.get('world_id') ?? undefined;
      const world = persistentWorld.get(worldId);
      if (!world) {
        sendJson(response, 404, { error: 'world_not_found', message: `world ${worldId} does not exist` });
        return;
      }
      const destinationLocationId = url.searchParams.get('destination_location_id');
      if (typeof destinationLocationId !== 'string' || destinationLocationId.trim() === '') {
        sendJson(response, 400, { error: 'invalid_route_request', message: 'destination_location_id is required' });
        return;
      }
      const characterId = url.searchParams.get('character_id') ?? world.protagonist?.character_id;
      const route = getWorldRoute(world, { destinationLocationId, characterId });
      if (!route) {
        sendJson(response, 404, { error: 'route_location_not_found', message: 'origin or destination is not present in this world' });
        return;
      }
      sendJson(response, 200, {
        schema: 'deskbot.world-route-response.v0.1',
        world_revision: world.world_revision,
        route,
        map: getWorldMap(world, { characterId }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/world/tasks') {
      sendJson(response, 200, { schema: 'deskbot.world-task-list.v1', clock: persistentWorld.get().clock ?? { mode: 'simulation' },
        tasks: worldTaskReadModel(persistentWorld.get(), now().toISOString()) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/world/resources/transfer') {
      readJson(request, 64 * 1024).then(body => {
        const eventId = body.event_id ?? `transfer-${randomUUID()}`, existing = inputStore.get(eventId);
        const result = ingestNonChatEvent({ event_id: eventId, type: 'world.mutation', source: 'deskbot-resource-interface', character_id: DEFAULT_CHARACTER_ID,
          occurred_at: existing?.occurred_at ?? now().toISOString(), payload: { action: 'transfer_resource', actor_id: DEFAULT_CHARACTER_ID,
            object_id: body.object_id, resource: body.resource, count: body.count, operation: body.operation } });
        sendJson(response, result.duplicate ? 200 : 202, { accepted: true, duplicate: result.duplicate, world_mutation: result.worldMutation });
      }).catch(error => sendJson(response, error instanceof InputError || error instanceof PersistentWorldError ? error.statusCode : 500,
        { error: error.code ?? 'internal_error', message: error.message ?? 'resource transfer failed' }));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/world/tasks') {
      readJson(request, 64 * 1024).then(body => {
        const eventId = body.event_id ?? `activity-${randomUUID()}`;
        const existing = inputStore.get(eventId);
        // Whitelist domain fields; clients cannot inject completion effects or deadlines.
        const payload = body.operation
          ? { action: 'control_task', task_id: body.task_id, operation: body.operation }
          : { action: 'start_activity', task_id: body.task_id ?? `activity-${eventId}`, kind: body.kind,
            title: body.title, duration_seconds: body.duration_seconds, activity_id: body.activity_id,
            actor_id: DEFAULT_CHARACTER_ID };
        const result = ingestNonChatEvent({ event_id: eventId, type: 'world.mutation', source: 'deskbot-task-interface',
          character_id: DEFAULT_CHARACTER_ID, occurred_at: existing?.occurred_at ?? now().toISOString(), payload });
        sendJson(response, result.duplicate ? 200 : 202, { accepted: result.worldMutation.applied || result.duplicate,
          duplicate: result.duplicate, world_mutation: result.worldMutation, tasks: worldTaskReadModel(persistentWorld.get(), now().toISOString()) });
      }).catch(error => {
        const expected = error instanceof InputError || error instanceof PersistentWorldError;
        sendJson(response, expected ? error.statusCode : 500, { error: expected ? error.code : 'internal_error', message: expected ? error.message : 'task request failed' });
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/world/travel') {
      readJson(request, 64 * 1024)
        .then((body) => {
          const locationId = body.location_id ?? body.destination_location_id;
          if (typeof locationId !== 'string' || locationId.trim() === '') {
            throw new InputError(400, 'invalid_travel_request', 'location_id is required');
          }
          const eventId = typeof body.event_id === 'string' && body.event_id.trim() !== ''
            ? body.event_id.trim()
            : `travel-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const existing = inputStore.get(eventId);
          if (!existing && body.expected_world_revision !== undefined) {
            if (!Number.isInteger(body.expected_world_revision) || body.expected_world_revision < 0) {
              throw new InputError(400, 'invalid_travel_request', 'expected_world_revision must be a non-negative integer');
            }
            const latestWorld = persistentWorld.get();
            if (latestWorld.world_revision !== body.expected_world_revision) {
              throw new PersistentWorldError(409, 'world_revision_changed', 'world changed after route planning; re-plan before travel');
            }
            if (typeof body.expected_from_location_id === 'string'
              && latestWorld.protagonist?.location_id !== body.expected_from_location_id) {
              throw new PersistentWorldError(409, 'world_location_changed', 'current location changed after route planning; re-plan before travel');
            }
          }
          const event = {
            event_id: eventId,
            type: 'world.mutation',
            source: body.source ?? 'deskbot-web',
            character_id: body.character_id ?? 'shaping-001',
            correlation_id: body.correlation_id ?? eventId,
            occurred_at: body.occurred_at ?? existing?.occurred_at ?? now().toISOString(),
            source_kind: body.source_kind ?? 'user',
            confidence: body.confidence,
            provider: body.provider,
            provenance: {
              interface: 'deskbot-web',
              action: 'travel',
              ...(body.provenance && typeof body.provenance === 'object' ? body.provenance : {}),
            },
            payload: {
              action: 'move_protagonist',
              location_id: locationId.trim(),
              ...(body.destination_location_id !== undefined ? { destination_location_id: body.destination_location_id } : {}),
              ...(body.reason !== undefined ? { reason: body.reason } : {}),
            },
          };
          const result = ingestNonChatEvent(event);
          worldLife.tick({ force: true });
          const refreshedWorld = persistentWorld.get();
          sendJson(response, result.duplicate ? 200 : (result.worldMutation.applied ? 202 : 409), {
            schema: 'deskbot.world-travel-response.v0.1',
            accepted: result.worldMutation.applied || result.duplicate,
            duplicate: result.duplicate,
            event: result.event,
            world_mutation: { ...result.worldMutation, world: refreshedWorld },
            map: getWorldMap(refreshedWorld, { characterId: event.character_id }),
          });
        })
        .catch((error) => {
          const expected = error instanceof InputError || error instanceof PersistentWorldError;
          sendJson(response, expected ? error.statusCode : 500, {
            error: expected ? error.code : 'internal_error',
            message: expected ? error.message : 'travel request failed',
          });
        });
      return;
    }

    if (request.method === 'GET' && (url.pathname === '/api/world/mutations' || url.pathname === '/api/world/ledger')) {
      sendJson(response, 200, {
        schema: 'foundry.world-mutation-list.v0.1',
        mutations: persistentWorld.listMutations({
          worldId: url.searchParams.get('world_id') ?? undefined,
          afterSequence: url.searchParams.get('after_sequence') ?? 0,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/outbox') {
      sendJson(response, 200, {
        schema: 'foundry.device-command-list.v0.1',
        commands: outputRouter.listQueued({
          target: url.searchParams.get('target') ?? null,
          device_id: url.searchParams.get('device_id') ?? null,
          limit: url.searchParams.get('limit') ?? 50,
        }),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/devices') {
      sendJson(response, 200, {
        schema: 'foundry.device-list.v0.1',
        devices: deviceRegistry.list(),
      });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/devices/')) {
      const deviceId = decodeURIComponent(url.pathname.slice('/api/devices/'.length));
      const device = deviceRegistry.get(deviceId);
      if (!device) {
        sendJson(response, 404, { error: 'device_not_found', message: `device ${deviceId} does not exist` });
        return;
      }
      sendJson(response, 200, { schema: 'foundry.device-hello.v0.1', device });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/devices/hello') {
      readJson(request)
        .then((body) => deviceRegistry.register(body))
        .then((result) => sendJson(response, result.duplicate ? 200 : 201, {
          schema: 'foundry.device-hello-accepted.v0.1',
          accepted: true,
          duplicate: result.duplicate,
          device: result.device,
        }))
        .catch((error) => {
          const statusCode = error instanceof InputError || error instanceof DeviceRegistryError ? error.statusCode : 500;
          sendJson(response, statusCode, {
            error: error instanceof InputError || error instanceof DeviceRegistryError ? error.code : 'internal_error',
            message: error.message,
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/outbox/')) {
      const commandId = decodeURIComponent(url.pathname.slice('/api/outbox/'.length));
      const command = outputRouter.get(commandId);
      if (!command) {
        sendJson(response, 404, {
          error: 'command_not_found',
          message: `command ${commandId} does not exist`,
        });
        return;
      }
      sendJson(response, 200, {
        schema: 'foundry.device-command.v0.1',
        command,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname.startsWith('/api/outbox/') && url.pathname.endsWith('/ack')) {
      const commandId = decodeURIComponent(url.pathname.slice('/api/outbox/'.length, -'/ack'.length));
      readJson(request)
        .then((body) => {
          if(outputRouter.get(commandId)?.source_event_id?.startsWith('body-perception:')) {
            throw new OutputRouterError(403,'body_ack_requires_device_bridge','身体动作回执必须来自绑定设备的 WebSocket 连接。');
          }
          return outputRouter.ack({ ...body, command_id: commandId });
        })
        .then((result) => sendJson(response, 200, {
          schema: 'foundry.device-command-ack.v0.1',
          accepted: true,
          duplicate: result.duplicate,
          command: result.command,
        }))
        .catch((error) => {
          const statusCode = error instanceof InputError || error instanceof OutputRouterError || error instanceof DeviceRegistryError ? error.statusCode : 500;
          sendJson(response, statusCode, {
            error: error instanceof InputError || error instanceof OutputRouterError || error instanceof DeviceRegistryError ? error.code : 'internal_error',
            message: error.message,
          });
        });
      return;
    }

    if (request.method === 'GET' && url.pathname.startsWith('/api/state/')) {
      const characterId = decodeURIComponent(url.pathname.slice('/api/state/'.length));
      if (!characterId) {
        sendJson(response, 400, { error: 'invalid_input', message: 'character_id is required' });
        return;
      }
      const state = stateEngine.get(characterId);
      sendJson(response, 200, {
        schema: 'foundry.state-context.v0.1',
        character_id: characterId,
        state,
        context: stateEngine.context(characterId),
      });
      return;
    }

    if (request.method === 'POST' && (url.pathname === '/api/event' || url.pathname === '/api/chat')) {
      readJson(request)
        .then((body) => {
          if (url.pathname === '/api/chat' && (body.role ?? 'user') === 'user') {
            return orchestrator.run(body).then((turn) => {
              const roleEvolutionResult = turn.duplicate
                ? null
                : roleEvolution.observeEvent(turn.input_event);
              sendJson(response, turn.duplicate ? 200 : 202, {
                accepted: true,
                duplicate: turn.duplicate,
                turn,
                event: turn.input_event,
                analysis: turn.analysis,
                state: turn.state,
                canonical_world: turn.canonical_world,
                role_evolution: roleEvolutionResult,
                context: turn.state ? stateEngine.context(turn.state.character_id) : null,
                pipeline: {
                  stages: ['input', 'world-context', 'state-engine', 'prompt-composer', 'llm', 'output-router'],
                  current: 'output-router',
                  next: 'device-outbox',
                  state_revision: turn.state?.state_revision ?? null,
                  outputs: turn.output_plan,
                },
              });
            });
          }

          const event = url.pathname === '/api/chat'
            ? normalizeChat(body, { now })
            : normalizePublicEvent(body);
          if (url.pathname === '/api/event') assertPublicEventWorldMutation(event);
          const result = inputStore.save(event);
          let worldMutation;
          try {
            worldMutation = persistentWorld.ingest(result.event,url.pathname==='/api/chat'?{attestedKind:'user',sourceLabel:'用户对话'}:{});
          } catch (error) {
            if (!result.duplicate) inputStore.remove?.(result.event.event_id);
            throw error;
          }
          const correlationAlreadyCounted = worldMutation.reason === 'correlation_already_counted';
          const matchedConditions = result.duplicate || correlationAlreadyCounted ? [] : worldContext.observe(event);
          const interactionDecision = interactionPolicy.evaluate({
            event: result.event,
            worldSnapshot: worldMutation.world,
            worldConditions: matchedConditions,
            runtimeContext: contextSources.snapshot(),
          });
          const stateResult = stateEngine.getResult(result.event.event_id)
            ?? (worldMutation.reason === 'correlation_already_counted' && result.event.type === 'conversation.input'
              ? stateEngine.snapshot(result.event.character_id ?? 'unbound')
              : stateEngine.ingest(result.event));
          const deviceResult = result.event.type === 'device.hello' && !result.duplicate
            ? deviceRegistry.register({
              ...(result.event.payload?.hello ?? result.event.payload),
              device_id: result.event.device_id ?? result.event.payload?.device_id,
              character_id: result.event.character_id ?? result.event.payload?.character_id,
              shell_id: result.event.shell_id ?? result.event.payload?.shell_id,
            })
            : null;
          const evidenceResult = correlationAlreadyCounted ? null : evidenceLedger.record({
            event: result.event,
            analysis: stateResult.analysis,
            worldMatches: matchedConditions,
          });
          const outputRoute = outputRouter.enqueue({
            source_event: result.event,
            output_plan: stateResult.outputs,
          });
          const roleEvolutionResult = result.duplicate
            ? null
            : roleEvolution.observeEvent(result.event);
          const worldCandidateResult = worldCandidates.observe(result.event, { world: worldMutation.world });
          sendInputAccepted(response, result.event, result.duplicate || worldMutation.duplicate, {
            ...stateResult,
            outputs: stateResult.outputs,
            analysis: stateResult.analysis,
            matched_conditions: matchedConditions,
            evidence: evidenceResult?.evidence ?? null,
            output_route: outputRoute,
            device: deviceResult?.device ?? null,
            world_mutation: worldMutation,
            interaction_decision: interactionDecision,
            roleEvolution: roleEvolutionResult,
            worldCandidate: worldCandidateResult,
          });
        })
        .catch((error) => {
          const expected = error instanceof InputError
            || error instanceof OutputRouterError
            || error instanceof PersistentWorldError
            || error instanceof DeviceRegistryError
            || error instanceof WorldCandidateError
            || error instanceof LlmProviderError;
          const statusCode = expected ? (error.statusCode ?? 500) : 500;
          sendJson(response, statusCode, {
            error: expected ? error.code : 'internal_error',
            message: expected ? error.message : 'chat request failed',
            ...(expected && error instanceof LlmProviderError
              ? {
                retryable: error.retryable === true,
                provider_status: Number.isInteger(error.status) ? error.status : null,
              }
              : {}),
          });
        });
      return;
    }

    sendJson(response, 404, { error: 'not_found', path: url.pathname });
  });

  // The HTTP API and the device bridge share the same domain services.  The
  // bridge remains a transport adapter: device events enter the existing
  // input/world pipeline, while raw audio is handed to the configured voice
  // sidecar and then to the same VoiceIngress path used by HTTP callers.
  const deviceBridge = websocket === false
    ? null
    : createWebSocketBridge({
      server,
      path: websocketPath,
      now,
      deviceRegistry,
      outputRouter,
      audioArtifacts,
      inputStore,
      stateEngine,
      persistentWorld,
      evidenceLedger,
      onEvent: ({event,peer}) => ingestNonChatEvent({...event,character_id:peer.characterId??event.character_id},bodyContextForPeer(peer)),
      onCommandSent: ({command,peer}) => {
        if(!command.source_event_id?.startsWith('body-perception:'))return;
        const linked=persistentWorld.get().body?.turns.flatMap(turn=>turn.commands).find(row=>row.command_id===command.command_id);
        if(!linked || linked.status!=='queued')return;
        persistentWorld.ingest({event_id:`body-dispatch:${command.command_id}`,type:'body.command.dispatched',source:'device-bridge',
          character_id:DEFAULT_CHARACTER_ID,occurred_at:now().toISOString(),payload:{command}},
        {...bodyContextForPeer(peer),bodyInternal:true,commandAttested:true});
      },
      onCommandAck: ({ack,result,peer}) => {
        if(!result.command?.source_event_id?.startsWith('body-perception:'))return;
        const receipt=result.command.acknowledgment;
        const stableAck={command_id:result.command.command_id,device_id:receipt.device_id,status:receipt.status,
          occurred_at:receipt.occurred_at,correlation_id:receipt.correlation_id,...(receipt.error?{error:receipt.error}:{})};
        persistentWorld.ingest({event_id:`body-ack:${ack.command_id}:${ack.status}`,type:'body.command.acknowledged',source:'device-bridge',
          character_id:DEFAULT_CHARACTER_ID,occurred_at:receipt.occurred_at,payload:{ack:stableAck}},
        {...bodyContextForPeer(peer),bodyInternal:true,routerAccepted:true,command:result.command});
      },
      onCommandFailure: ({result}) => {
        const command=result.command;
        if(!command?.source_event_id?.startsWith('body-perception:'))return;
        persistentWorld.ingest({event_id:`body-failed:${command.command_id}`,type:'body.command.failed',source:'device-bridge',
          character_id:DEFAULT_CHARACTER_ID,occurred_at:command.acknowledgment.occurred_at,payload:{command}},
        {bodyInternal:true,commandAttested:true});
      },
      onAudioStream: voiceClient
        ? async (stream) => {
          const sidecar = await voiceClient.transcribe({
            request_id: `asr-${stream.utterance_id}`,
            correlation_id: stream.correlation_id,
            utterance_id: stream.utterance_id,
            stream_id: stream.stream_id,
            character_id: stream.character_id,
            device_id: stream.device_id,
            shell_id: stream.shell_id,
            role_revision: stream.role_revision,
            audio_b64: stream.data.toString('base64'),
            format: stream.format,
            stage: 'final',
          });
          const resultList = Array.isArray(sidecar.results) && sidecar.results.length > 0
            ? sidecar.results
            : [sidecar];
          let ingestedCount = 0;
          let finalCount = 0;
          for (const item of resultList) {
            const result = await ingress.ingest({
              ...item,
              ...stream,
              data: undefined,
              audio_b64: undefined,
              correlation_id: sidecar.correlation_id ?? stream.correlation_id,
              utterance_id: sidecar.utterance_id ?? stream.utterance_id,
              stream_id: sidecar.stream_id ?? stream.stream_id,
              request_id: sidecar.request_id ?? `asr-${stream.utterance_id}`,
            });
            ingestedCount += 1;
            if (result.asr?.stage === 'final') finalCount += 1;
          }
          // Do not return transcript or audio bytes to the device receipt.
          return { ingested_count: ingestedCount, final_count: finalCount };
        }
        : null,
    });
  server.websocketBridge = deviceBridge;
  server.sharedLife = sharedLife;
  server.sharedLifeReports = sharedLifeReports;
  server.worldLife = worldLife;
  server.autonomousLife = autonomousLife;
  server.lifeChoiceWorker=lifeChoiceWorker;
  server.inputRuntime = inputRuntime;
  server.roleEvolution = roleEvolution;
  server.worldCandidates = worldCandidates;
  // Test/in-process adapters use the same canonical path as trusted
  // connectors without weakening the public /api/event boundary.
  server.ingestNonChatEvent = ingestNonChatEvent;
  server.ingestRefractionSource = ingestRefractionSource;
  server.persistentWorld = persistentWorld;
  server.interactionPolicy = interactionPolicy;
  server.once('listening', () => {
    try {
      persistentWorld.syncWallClock?.();
      persistentWorld.syncTasks?.();
    } catch (error) {
      console.error(`[world-clock] startup catch-up failed: ${error.message}`);
    }
    sharedLife.tick();
    npcGoals.tick();
    if (autonomousLifeEnabled) worldLife.seedNpcs();
    if(residentLifeEnabled && persistentWorld.get().resident_life?.version!==RESIDENT_VERSION) {
      ingestNonChatEvent({event_id:`resident-install:${RESIDENT_VERSION}`,type:'world.mutation',source:'resident-life-engine',source_kind:'world_engine',character_id:DEFAULT_CHARACTER_ID,occurred_at:now().toISOString(),payload:{action:'install_resident_life'}});
    }
    if(!livedMemoryEnabled)tickAutonomousLife();
    if(residentLifeEnabled && !persistentWorld.get().refraction) {
      ingestNonChatEvent({event_id:`refraction-install:${REFRACTION_VERSION}`,type:'world.mutation',source:'input-refraction-engine',source_kind:'world_engine',character_id:DEFAULT_CHARACTER_ID,occurred_at:now().toISOString(),payload:{action:'install_input_refraction'}});
    }
    if(livedMemoryEnabled && persistentWorld.get().memory?.schema!==MEMORY_VERSION) {
      ingestNonChatEvent({event_id:`memory-install:${MEMORY_VERSION}`,type:'world.mutation',source:'lived-memory-engine',source_kind:'world_engine',character_id:DEFAULT_CHARACTER_ID,occurred_at:now().toISOString(),payload:{action:'install_lived_memory',planner_enabled:true}});
    }
    if(livedMemoryEnabled && persistentWorld.get().memory && !persistentWorld.get().memory.development) {
      ingestNonChatEvent({event_id:`development-install:${DEVELOPMENT_VERSION}`,type:'world.mutation',source:'lived-memory-engine',
        source_kind:'world_engine',character_id:DEFAULT_CHARACTER_ID,occurred_at:now().toISOString(),payload:{action:'install_development_evidence'}});
    }
    if(bodyPerceptionEnabled && !persistentWorld.get().body) {
      ingestNonChatEvent({event_id:`body-install:${BODY_PERCEPTION_VERSION}`,type:'world.mutation',source:'body-perception-engine',
        character_id:DEFAULT_CHARACTER_ID,occurred_at:now().toISOString(),payload:{action:'install_body_perception'}});
    }
    if(livedMemoryEnabled)tickAutonomousLife();
    void lifeChoiceWorker.tick().catch(()=>{});
    worldLife.tick();
    try {
      roleEvolution.syncAll();
    } catch (error) {
      console.error(`[role-evolution] startup sync failed: ${error.message}`);
    }
    inputRuntime.start();
    const externalIds = refractionSources.filter(s => s.enabled !== false && typeof s.refresh === 'function').map(s => s.sourceId);
    if (externalIds.length) void inputRuntime.tick({ sourceIds: externalIds });
    if(residentLifeEnabled && weatherConnector?.status?.().enabled===true && weatherConnector.status().configured===true) {
      // InputRuntime may correctly skip a still-fresh persisted source. Ask
      // the connector for its cache so installation can adopt that reference.
      void weatherConnector.refresh({force:false}).then(({event})=>ingestWeatherEvent(event))
        .catch(error=>console.error(`[input-refraction] current weather unavailable: ${error.message}`));
    }
    const timer = setInterval(() => {
      try {
        persistentWorld.syncWallClock?.();
        persistentWorld.syncTasks?.();
      } catch (error) {
        console.error(`[world-clock] scheduled catch-up failed: ${error.message}`);
      }
      sharedLife.tick();
      npcGoals.tick();
      tickAutonomousLife();
      worldLife.tick();
      try {
        roleEvolution.syncAll();
      } catch (error) {
        console.error(`[role-evolution] scheduled sync failed: ${error.message}`);
      }
    }, 60_000);
    timer.unref();
    const taskTimer = setInterval(() => {
      try {
        persistentWorld.syncWallClock?.();
        const result = persistentWorld.syncTasks?.();
        if (result?.processed) { sharedLife.tick(); npcGoals.tick(); tickAutonomousLife(); worldLife.tick(); }
      }
      catch (error) { console.error(`[world-tasks] scheduled reconciliation failed: ${error.message}`); }
    }, timeMode === 'realtime' || persistentWorld.get().clock?.mode === 'real_time' ? 1000 : 60_000);
    taskTimer.unref();
    server.once('close', () => {
      clearInterval(timer);
      clearInterval(taskTimer);
      inputRuntime.stop();lifeChoiceWorker.stop();
    });
  });
  return server;
}
