import { createHash } from 'node:crypto';

import { normalizeChat } from './input-store.mjs';
import { composePrompt } from './prompt-composer.mjs';
import { DEFAULT_TTS_PROFILE, canonicalCharacterId } from './world-definition.mjs';
import { applyRoleTrialExpressionIntent, normalizeExpressionIntent } from './expression-intent.mjs';

const DEFAULT_TTS_FORMAT = Object.freeze({ codec: 'pcm_s16le', sample_rate_hz: 16_000, channels: 1 });

function isExplicitWeatherRefreshRequest(text) {
  if (typeof text !== 'string') return false;
  return /天气|气温|温度|下雨|降雨/u.test(text)
    && /最新|实时|刷新|更新|刚刚|现在/u.test(text);
}

function weatherForecastKindForRequest(text) {
  if (typeof text !== 'string' || !/天气|气温|温度|下雨|降雨|预报/u.test(text)) return null;
  if (/分钟|短临|短时|小实时|接下来\s*[一两]?个?小时|未来\s*[一两]?个?小时/u.test(text)) return 'minutely';
  if (/小时/u.test(text)) return 'hourly';
  if (/每日|每天|明天|后天|未来\s*\d*\s*天|一周|七天|预报/u.test(text)) return 'daily';
  return null;
}

function stableStreamId(eventId) {
  const hex = createHash('sha256')
    .update(`deskbot-audio-stream\0${eventId}`)
    .digest('hex')
    .slice(0, 32)
    .split('');
  // Mark the derived value as a conventional UUID v5/variant while keeping
  // the mapping deterministic for replay and idempotent retries.
  hex[12] = '5';
  hex[16] = '8';
  const compact = hex.join('');
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function createChatOrchestrator({
  inputStore,
  stateEngine,
  worldContext,
  evidenceLedger = null,
  llm,
  outputRouter = null,
  persistentWorld = null,
  contextSources = null,
  interactionPolicy = null,
  voiceClient = null,
  audioArtifacts = null,
  ttsProfile = DEFAULT_TTS_PROFILE,
  ttsFormat = DEFAULT_TTS_FORMAT,
  voiceRequired = false,
  now = () => new Date(),
  persistence = null,
  refreshWeather = null,
  refreshWeatherForecast = null,
  activeRoleTrials = null,
  relationshipMemories = null,
  branchExperiences = null,
  conversationHistoryAfter = null,
  recordRoleTrialObservation = null,
}) {
  const turns = new Map(
    (persistence?.list('chat.turns') ?? []).map((turn) => [turn.turn_id, turn]),
  );
  const pending = new Map();
  const pendingCorrelations = new Map();
  const correlations = new Map(
    (persistence?.list('chat.correlations') ?? []).map((record) => [record.correlation_key, record.turn_id]),
  );

  for (const turn of turns.values()) {
    const correlationId = turn.input_event?.correlation_id;
    if (typeof correlationId === 'string' && correlationId.trim() !== '') {
      correlations.set(`${canonicalCharacterId(turn.input_event.character_id) ?? 'unbound'}:${correlationId.trim()}`, turn.turn_id);
    }
  }

  function correlationKeyFor(event) {
    if (typeof event.correlation_id !== 'string' || event.correlation_id.trim() === '') return null;
    return `${canonicalCharacterId(event.character_id) ?? 'unbound'}:${event.correlation_id.trim()}`;
  }

  function recentConversationFor(characterId, limit = 4) {
    const canonicalId = canonicalCharacterId(characterId) ?? 'unbound';
    const boundary = conversationHistoryAfter?.(characterId);
    const entries = [];
    for (const turn of turns.values()) {
      const turnCharacterId = canonicalCharacterId(turn.input_event?.character_id) ?? 'unbound';
      if (turnCharacterId !== canonicalId) continue;
      // Exclude entire old turns, including assistant paraphrases of removed notes.
      if (boundary && !(Date.parse(turn.input_event?.occurred_at) > Date.parse(boundary))) continue;
      const inputText = turn.input_event?.payload?.text;
      const replyText = turn.reply_event?.payload?.text ?? turn.reply;
      if (typeof inputText === 'string' && inputText.trim() !== '') {
        entries.push({
          role: 'user',
          text: inputText.trim(),
          occurred_at: turn.input_event?.occurred_at ?? turn.turn_id,
        });
      }
      if (typeof replyText === 'string' && replyText.trim() !== '') {
        entries.push({
          role: 'assistant',
          text: replyText.trim(),
          occurred_at: turn.reply_event?.occurred_at ?? turn.turn_id,
        });
      }
    }
    return entries
      .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)))
      .slice(-(Math.max(1, limit) * 2))
      .map((entry) => ({ ...entry, text: entry.text.slice(0, 800) }));
  }

  function outputPlanWithAudio(outputPlan, voice) {
    if (!voice || !Array.isArray(outputPlan)) return outputPlan;
    return outputPlan.map((output) => {
      if (output.type !== 'speak') return output;
      const {
        type: ignoredType,
        text: ignoredText,
        tts_style: ignoredTtsStyle,
        expression_intent: expressionIntent,
        status: ignoredStatus,
        payload: existingPayload,
        ...routeFields
      } = output;
      return {
        ...routeFields,
        type: 'audio.play',
        payload: {
          ...(existingPayload ?? {}),
          ...(expressionIntent ? { expression_intent: expressionIntent } : {}),
          audio_id: voice.audio_id,
          audio_ref: voice.audio_ref,
          stream_id: voice.stream_id,
          format: voice.format,
          profile: voice.profile,
          duration_ms: voice.duration_ms,
          byte_count: voice.byte_count,
          sha256: voice.sha256,
          encoding: voice.encoding,
          content_type: voice.content_type,
        },
      };
    });
  }

  function outputPlanWithExpressionIntent(outputPlan, expressionIntent) {
    if (!Array.isArray(outputPlan)) return outputPlan;
    return outputPlan.map((output) => ['render.expression', 'speak'].includes(output.type)
      ? { ...output, expression_intent: expressionIntent }
      : output);
  }

  async function execute(userEvent) {
    const canonicalProjection = persistentWorld?.ingest(userEvent) ?? null;
    const correlationAlreadyCounted = canonicalProjection?.reason === 'correlation_already_counted';
    const matchedByInput = correlationAlreadyCounted ? [] : worldContext.observe(userEvent);
    const stateResult = correlationAlreadyCounted
      ? stateEngine.snapshot(userEvent.character_id)
      : stateEngine.ingest(userEvent);
    const worldConditions = worldContext.active(userEvent.character_id);
    let weatherRefreshResult = null;
    let weatherRefreshError = null;
    let weatherForecastResult = null;
    let weatherForecastError = null;
    const forecastKind = weatherForecastKindForRequest(userEvent.payload.text);
    if (!correlationAlreadyCounted && refreshWeatherForecast && forecastKind) {
      try {
        weatherForecastResult = await refreshWeatherForecast({
          force: isExplicitWeatherRefreshRequest(userEvent.payload.text),
          kinds: [forecastKind],
          userEvent,
        });
      } catch (error) {
        weatherForecastError = {
          code: error.code ?? 'weather_forecast_failed',
          message: error.message ?? '天气预报刷新失败',
          retryable: error.retryable === true,
        };
      }
    } else if (!correlationAlreadyCounted && refreshWeather && isExplicitWeatherRefreshRequest(userEvent.payload.text)) {
      try {
        weatherRefreshResult = await refreshWeather({ force: true, userEvent });
      } catch (error) {
        weatherRefreshError = {
          code: error.code ?? 'weather_refresh_failed',
          message: error.message ?? '天气刷新失败',
          retryable: error.retryable === true,
        };
      }
    }
    const currentWorldSnapshot = () => persistentWorld?.get() ?? canonicalProjection?.world ?? null;
    const inputEvidence = correlationAlreadyCounted ? null : evidenceLedger?.record({
      event: userEvent,
      analysis: stateResult.analysis,
      worldMatches: matchedByInput,
    });
    const runtimeContext = contextSources?.snapshot() ?? null;
    const interactionDecision = interactionPolicy?.evaluate({
      event: userEvent,
      worldSnapshot: currentWorldSnapshot(),
      worldConditions,
      runtimeContext,
    }) ?? null;
    const proactiveCandidates = interactionPolicy?.forPrompt({
      characterId: userEvent.character_id,
      excludeEventId: userEvent.event_id,
    }) ?? [];
    const recentConversation = recentConversationFor(userEvent.character_id);
    const roleTrials = activeRoleTrials?.(userEvent.character_id) ?? [];
    const expressionIntent = applyRoleTrialExpressionIntent(
      normalizeExpressionIntent(stateResult.state?.interaction?.expression_intent, {
        evidenceRefs: stateResult.state?.last_event_id ? [stateResult.state.last_event_id] : [],
      }),
      roleTrials,
    );
    const runtimePromptContext = {
      ...(runtimeContext ?? {}),
      weather_request: weatherRefreshResult
        ? { status: 'refreshed', cached: weatherRefreshResult.cached === true }
        : weatherForecastResult
          ? { status: 'forecast_refreshed', kind: forecastKind, cached: weatherForecastResult.cached?.[forecastKind] === true }
        : weatherRefreshError
          ? { status: 'error', code: weatherRefreshError.code, retryable: weatherRefreshError.retryable }
          : weatherForecastError
            ? { status: 'forecast_error', kind: forecastKind, code: weatherForecastError.code, retryable: weatherForecastError.retryable }
          : { status: 'not_requested' },
    };
    const composed = composePrompt({
      stateContext: stateResult.context,
      worldConditions,
      worldSnapshot: currentWorldSnapshot(),
      runtimeContext: runtimePromptContext,
      interactionDecision,
      proactiveCandidates,
      recentConversation,
      relationshipMemories: relationshipMemories?.(userEvent.character_id, userEvent.payload.text) ?? [],
      branchExperiences: branchExperiences?.(userEvent.payload.text, currentWorldSnapshot()) ?? [],
      activeRoleTrials: roleTrials,
      userText: userEvent.payload.text,
    });
    // Runtime sources inform the character's reply. They must not replace the
    // character with a collection of hard-coded question-and-answer handlers.
    const completion = await llm.complete({
      userText: userEvent.payload.text,
      prompt: composed.prompt,
      state: stateResult.state,
      worldConditions,
      worldSnapshot: currentWorldSnapshot(),
    });

    let voice = null;
    let voiceError = null;
    if (voiceClient) {
      try {
        // The firmware bridge carries stream IDs as UUID bytes. Derive the ID
        // from the immutable event ID so crash/retry replay remains stable;
        // a sidecar-friendly prefix must never reach the device wire.
        const requestedStreamId = stableStreamId(userEvent.event_id);
        const tts = await voiceClient.synthesize({
          request_id: `tts-${userEvent.event_id}`,
          correlation_id: userEvent.correlation_id ?? userEvent.event_id,
          stream_id: requestedStreamId,
          text: completion.text,
          profile_id: ttsProfile,
          profile: {
            profile_id: ttsProfile,
            ...(expressionIntent.consumers?.tts ?? {}),
          },
          expression_intent: expressionIntent,
          format: ttsFormat,
        });
        if (!audioArtifacts) {
          throw new Error('audio artifact store is required when voiceClient is configured');
        }
        const stored = audioArtifacts.put({
          ...tts.audio,
          audio_id: tts.audio.audio_id ?? tts.request_id ?? `audio-${userEvent.event_id}`,
          correlation_id: tts.correlation_id,
          request_id: tts.request_id,
          profile: tts.profile,
        });
        const artifact = stored.artifact;
        // The request-side ID is canonical. A sidecar may echo a friendly or
        // independently generated ID, but accepting that value would make a
        // retry produce a different output command fingerprint.
        const returnedStreamId = requestedStreamId;
        voice = {
          audio_id: artifact.audio_id,
          audio_ref: `/api/audio/${encodeURIComponent(artifact.audio_id)}`,
          stream_id: returnedStreamId,
          format: artifact.format,
          profile: artifact.profile,
          duration_ms: artifact.duration_ms,
          byte_count: artifact.byte_count,
          sha256: artifact.sha256,
          encoding: artifact.encoding,
          content_type: artifact.content_type ?? null,
          duplicate: stored.duplicate,
          expression_intent: expressionIntent,
        };
      } catch (error) {
        voiceError = {
          code: error.code ?? 'tts_failed',
          message: error.message ?? 'voice synthesis failed',
          retryable: error.retryable === true,
        };
        if (voiceRequired) throw error;
      }
    }

    const replyEvent = normalizeChat({
      event_id: `reply-${userEvent.event_id}`,
      character_id: userEvent.character_id,
      device_id: userEvent.device_id,
      shell_id: userEvent.shell_id,
      role: 'assistant',
      source: 'deskbot-llm',
      correlation_id: userEvent.correlation_id ?? userEvent.event_id,
      role_revision: userEvent.role_revision,
      message: completion.text,
      metadata: {
        provider: completion.provider,
        model: completion.model,
        prompt_id: composed.prompt_id,
        ...(voice ? {
          tts: {
            audio_id: voice.audio_id,
            audio_ref: voice.audio_ref,
            stream_id: voice.stream_id,
            format: voice.format,
            profile: voice.profile,
            duration_ms: voice.duration_ms,
            byte_count: voice.byte_count,
            sha256: voice.sha256,
            content_type: voice.content_type,
            expression_intent: voice.expression_intent,
          },
        } : {}),
        ...(voiceError ? { tts_error: voiceError } : {}),
      },
    }, { now });
    const replyInteractionDecision = interactionPolicy?.evaluate({
      event: replyEvent,
      worldSnapshot: currentWorldSnapshot(),
      worldConditions,
      runtimeContext,
    }) ?? null;
    inputStore.save(replyEvent);
    persistentWorld?.ingest(replyEvent);
    const replyResult = stateEngine.ingest(replyEvent);
    const trialAwareOutputPlan = outputPlanWithExpressionIntent(replyResult.outputs, expressionIntent);
    const effectiveOutputPlan = outputPlanWithAudio(trialAwareOutputPlan, voice);
    const replyEvidence = evidenceLedger?.record({
      event: replyEvent,
      worldMatches: [],
    });
    const outputRoute = outputRouter?.enqueue({
      source_event: replyEvent,
      output_plan: effectiveOutputPlan,
    }) ?? null;
    // Count only a turn that reached its output route. Explicit positive or
    // negative feedback remains a separate action; the LLM cannot grade its
    // own performance.
    const trialObservations = recordRoleTrialObservation?.({
      characterId: userEvent.character_id,
      eventId: userEvent.event_id,
      evidenceId: inputEvidence?.evidence?.evidence_id ?? `evidence-${userEvent.event_id}`,
      signal: 'neutral',
    }) ?? [];

    const turn = {
      schema: 'foundry.chat-turn.v0.1',
      turn_id: userEvent.event_id,
      input_event: userEvent,
      matched_conditions: worldConditions,
      analysis: stateResult.analysis,
      evidence: {
        input: inputEvidence?.evidence ?? null,
        reply: replyEvidence?.evidence ?? null,
      },
      state: stateResult.state,
      canonical_world: {
        mutation_applied: canonicalProjection?.applied ?? false,
        duplicate: canonicalProjection?.duplicate ?? false,
        reason: canonicalProjection?.reason ?? null,
        mutation: canonicalProjection?.mutation ?? null,
        snapshot: currentWorldSnapshot(),
      },
      runtime_context: runtimeContext,
      interaction_decision: interactionDecision,
      proactive_candidates: proactiveCandidates,
      active_role_trials: composed.active_role_trials ?? [],
      trial_observations: trialObservations,
      expression_intent: expressionIntent,
      weather_refresh: weatherRefreshResult
        ? { status: 'refreshed', cached: weatherRefreshResult.cached === true, snapshot: weatherRefreshResult.snapshot ?? null }
        : weatherForecastResult
          ? { status: 'forecast_refreshed', kind: forecastKind, cached: weatherForecastResult.cached?.[forecastKind] === true, forecast: weatherForecastResult.forecast?.[forecastKind] ?? null }
        : weatherRefreshError
          ? { status: 'error', code: weatherRefreshError.code, retryable: weatherRefreshError.retryable }
          : weatherForecastError
            ? { status: 'forecast_error', kind: forecastKind, code: weatherForecastError.code, retryable: weatherForecastError.retryable }
          : { status: 'not_requested' },
      reply_interaction_decision: replyInteractionDecision,
      prompt: {
        id: composed.prompt_id,
        world_conditions: composed.world_conditions,
        text: composed.prompt,
      },
      reply_event: replyEvent,
      reply: completion.text,
      provider: completion.provider,
      output_plan: effectiveOutputPlan,
      planned_output_plan: replyResult.outputs,
      output_route: outputRoute,
      voice,
      voice_error: voiceError,
      trace: completion.trace,
    };
    turns.set(userEvent.event_id, turn);
    persistence?.put('chat.turns', userEvent.event_id, turn);
    const correlationKey = correlationKeyFor(userEvent);
    if (correlationKey) {
      correlations.set(correlationKey, userEvent.event_id);
      persistence?.put('chat.correlations', correlationKey, {
        schema: 'foundry.chat-correlation.v0.1',
        correlation_key: correlationKey,
        correlation_id: userEvent.correlation_id,
        turn_id: userEvent.event_id,
      });
    }
    return turn;
  }

  async function run(input) {
    const userEvent = normalizeChat({
      ...input,
      role: 'user',
      source: input.source ?? 'deskbot-chat',
    }, { now });
    inputStore.save(userEvent);

    const cached = turns.get(userEvent.event_id);
    if (cached) return { ...cached, duplicate: true };

    const correlationKey = correlationKeyFor(userEvent);
    const correlatedTurnId = correlationKey ? correlations.get(correlationKey) : null;
    if (correlatedTurnId && turns.has(correlatedTurnId)) {
      return {
        ...turns.get(correlatedTurnId),
        duplicate: true,
        duplicate_reason: 'correlation_already_completed',
      };
    }

    const inFlight = pending.get(userEvent.event_id);
    if (inFlight) return { ...(await inFlight), duplicate: true };

    const correlatedInFlight = correlationKey ? pendingCorrelations.get(correlationKey) : null;
    if (correlatedInFlight) {
      return {
        ...(await correlatedInFlight),
        duplicate: true,
        duplicate_reason: 'correlation_already_in_flight',
      };
    }

    const task = execute(userEvent);
    pending.set(userEvent.event_id, task);
    if (correlationKey) pendingCorrelations.set(correlationKey, task);
    try {
      return { ...(await task), duplicate: false };
    } finally {
      pending.delete(userEvent.event_id);
      if (correlationKey) pendingCorrelations.delete(correlationKey);
    }
  }

  return {
    get: (turnId) => turns.get(turnId) ?? null,
    run,
  };
}
