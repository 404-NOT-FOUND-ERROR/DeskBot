import { createServer } from 'node:http';
import { createSharedLife } from './shared-life.mjs';
import { createNpcGoals } from './npc-goals.mjs';

import { createInputStore, InputError, normalizeChat, normalizeEvent } from './input-store.mjs';
import { createStateEngine } from './state-engine.mjs';
import { createWorldContext } from './world-context.mjs';
import { createFakeLlm, LlmProviderError } from './llm.mjs';
import { createChatOrchestrator } from './chat-orchestrator.mjs';
import { createEvidenceLedger } from './evidence-ledger.mjs';
import { createOutputRouter, OutputRouterError } from './output-router.mjs';
import { createDeviceRegistry, DeviceRegistryError } from './device-registry.mjs';
import { createPersistentWorld, getWorldSchema, PersistentWorldError } from './persistent-world.mjs';
import { createAudioArtifactStore, AudioArtifactError } from './audio-artifacts.mjs';
import { createVoiceIngress, VoiceIngressError } from './voice-ingress.mjs';
import { VoiceSidecarError } from './voice-sidecar-client.mjs';
import { createWebSocketBridge } from './websocket-bridge.mjs';
import { createContextSourceRegistry } from './context-sources.mjs';
import { createInteractionPolicy } from './interaction-policy.mjs';
import { WeatherConnectorError } from './weather-connector.mjs';
import { computeFantasyPull } from './fantasy-pull.mjs';
import { createRoleProposalStore, RoleProposalError } from './role-proposals.mjs';
import { listStoryPackages, previewStoryPackage, installStoryPackage } from './story-packages.mjs';
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
    world_mutation: stateResult?.world_mutation ?? null,
    interaction_decision: stateResult?.interaction_decision ?? null,
  });
}

export function createDeskBotServer({
  now = () => new Date(),
  persistence = null,
  inputStore = createInputStore({ now, persistence }),
  stateEngine = createStateEngine({ now, persistence }),
  worldContext = createWorldContext({ now, persistence }),
  evidenceLedger = createEvidenceLedger({ now, persistence }),
  outputRouter = createOutputRouter({ now, persistence }),
  deviceRegistry = createDeviceRegistry({ now, persistence }),
  persistentWorld = createPersistentWorld({ now, persistence }),
  weatherConnector = null,
  contextSources = createContextSourceRegistry({ now, weatherConnector }),
  interactionPolicy = createInteractionPolicy({ now, persistence }),
  roleProposalStore = null,
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
} = {}) {
  const roles = roleProposalStore ?? createRoleProposalStore({ now, persistence });
  let npcGoals;
  const sharedLife = createSharedLife({ now, persistence, worldSnapshot: () => persistentWorld.get(), ingest: event => ingestNonChatEvent(event), npcReserved: id => npcGoals?.reserved(id) ?? false });
  npcGoals = createNpcGoals({ now, persistence, worldSnapshot: () => persistentWorld.get(), ingest: event => ingestNonChatEvent(event),
    reserved: id => sharedLife.plans().some(p => !p.cancelled_at && p.steps.some(s => ['pending', 'failed'].includes(s.status) && (s.payload.npc?.npc_id ?? s.payload.npc_id) === id)) });
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
    relationshipMemories: (characterId, query) => sharedLife.retrieve(characterId, query),
    conversationHistoryAfter: (characterId) => sharedLife.historyAfter(characterId),
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
        const ingested = ingestNonChatEvent(weather.event);
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

  function ingestNonChatEvent(eventInput) {
    const event = normalizeEvent(eventInput, { now });
    const result = inputStore.save(event);
    let worldMutation;
    try {
      worldMutation = persistentWorld.ingest(result.event);
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
    return {
      event: result.event,
      duplicate: result.duplicate || worldMutation.duplicate,
      worldMutation,
      interactionDecision,
      stateResult,
      evidence: evidenceResult?.evidence ?? null,
      outputRoute,
    };
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
    if (url.pathname === '/api/life/npc-goals') {
      if (request.method === 'GET') { sendJson(response, 200, { goals: npcGoals.list() }); return; }
      if (request.method === 'POST') {
        readJson(request).then(body => sendJson(response, 200, body.operation ? npcGoals.control(body.id, body.operation) : npcGoals.add(body)))
          .catch(error => sendJson(response, error instanceof InputError || error instanceof PersistentWorldError ? error.statusCode : 500,
            { error: error.code ?? 'internal_error', message: error instanceof InputError || error instanceof PersistentWorldError ? error.message : 'Internal error' }));
        return;
      }
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
          const result = ingestNonChatEvent(event);
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

    if (request.method === 'GET' && url.pathname === '/api/roles/pulls') {
      const characterId = url.searchParams.get('character_id') ?? null;
      sendJson(response, 200, {
        schema: 'deskbot.fantasy-pull-list.v0.2',
        rule_version: 'fantasy-pull.v0.2',
        character_id: characterId,
        pulls: rolePulls({ characterId, limit: url.searchParams.get('limit') ?? 200 }),
      });
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
      sendJson(response, 200, getWorldSchema());
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
        .then((body) => outputRouter.ack({ ...body, command_id: commandId }))
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
              sendJson(response, turn.duplicate ? 200 : 202, {
                accepted: true,
                duplicate: turn.duplicate,
                turn,
                event: turn.input_event,
                analysis: turn.analysis,
                state: turn.state,
                canonical_world: turn.canonical_world,
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
            : normalizeEvent(body, { now });
          const result = inputStore.save(event);
          let worldMutation;
          try {
            worldMutation = persistentWorld.ingest(result.event);
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
          });
        })
        .catch((error) => {
          const expected = error instanceof InputError
            || error instanceof OutputRouterError
            || error instanceof PersistentWorldError
            || error instanceof DeviceRegistryError
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
  server.once('listening', () => {
    sharedLife.tick();
    npcGoals.tick();
    const timer = setInterval(() => { sharedLife.tick(); npcGoals.tick(); }, 60_000);
    timer.unref();
    server.once('close', () => clearInterval(timer));
  });
  return server;
}
