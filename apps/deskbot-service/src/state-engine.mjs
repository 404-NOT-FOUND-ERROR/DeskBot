import { canonicalCharacterId } from './world-definition.mjs';

const EMOTION_RULES = [
  { label: 'joy', valence: 0.8, arousal: 0.65, cues: ['开心', '高兴', '快乐', '喜欢', '太棒', '期待', '谢谢', '好耶', '哈哈', '笑'] },
  { label: 'sadness', valence: -0.8, arousal: 0.25, cues: ['难过', '伤心', '失望', '孤独', '哭', '累', '疲惫', '沮丧', '烦'] },
  { label: 'anger', valence: -0.75, arousal: 0.9, cues: ['生气', '愤怒', '讨厌', '气死', '烦死', '滚开'] },
  { label: 'fear', valence: -0.65, arousal: 0.8, cues: ['害怕', '担心', '焦虑', '恐惧', '不安', '紧张'] },
  { label: 'surprise', valence: 0.15, arousal: 0.85, cues: ['没想到', '真的吗', '惊讶', '居然', '哇', '竟然'] },
  { label: 'calm', valence: 0.35, arousal: 0.2, cues: ['平静', '安心', '慢一点', '没事', '放松', '放心'] },
];

const DEFAULT_BASE_LAYER = Object.freeze({
  warmth: 0.62,
  openness: 0.5,
  agency: 0.5,
  precision: 0.58,
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function countCueMatches(text, cue) {
  let count = 0;
  let offset = 0;
  while (offset < text.length) {
    const index = text.indexOf(cue, offset);
    if (index === -1) break;
    count += 1;
    offset = index + cue.length;
  }
  return count;
}

export function analyzeEmotion(text, { role = 'user', source = 'dialogue' } = {}) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    return {
      analyzer: 'lexicon-v0.1',
      label: 'neutral',
      valence: 0,
      arousal: 0.35,
      confidence: 0.2,
      cues: [],
      role,
      source,
    };
  }

  const scored = EMOTION_RULES.map((rule) => {
    const cues = rule.cues.filter((cue) => normalized.includes(cue));
    const score = cues.reduce((total, cue) => total + countCueMatches(normalized, cue), 0);
    return { rule, cues, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      analyzer: 'lexicon-v0.1',
      label: 'neutral',
      valence: 0,
      arousal: 0.35,
      confidence: 0.3,
      cues: [],
      role,
      source,
    };
  }

  const winner = scored[0];
  const totalScore = scored.reduce((total, item) => total + item.score, 0);
  const confidence = clamp(0.45 + (winner.score / totalScore) * 0.45, 0, 0.95);

  return {
    analyzer: 'lexicon-v0.1',
    label: winner.rule.label,
    valence: winner.rule.valence,
    arousal: winner.rule.arousal,
    confidence: round(confidence),
    cues: winner.cues,
    role,
    source,
  };
}

function stanceForSignal(signal) {
  if (signal.role === 'user') {
    if (signal.valence < -0.25) return 'supportive';
    if (signal.valence > 0.25) return 'engaged';
    return 'attentive';
  }

  if (signal.label === 'joy') return 'playful';
  if (signal.valence < -0.25) return 'reflective';
  return 'steady';
}

function expressionForState(signal, fused) {
  if (signal.role === 'user' && signal.valence < -0.25) return 'concerned';
  if (signal.role === 'user' && signal.valence > 0.25) return 'happy';
  if (signal.label === 'joy' || fused.valence > 0.42) return 'happy';
  if (signal.label === 'sadness' || fused.valence < -0.42) return 'tired';
  if (signal.label === 'anger') return 'alert';
  if (signal.label === 'fear') return 'concerned';
  if (signal.label === 'surprise') return 'surprised';
  return 'neutral';
}

function createDefaultState(characterId, now) {
  return {
    schema: 'foundry.short-state.v0.1',
    character_id: characterId,
    state_revision: 0,
    updated_at: now().toISOString(),
    caps: {
      base_layer: { ...DEFAULT_BASE_LAYER },
      adjustment_layer: { valence: 0, arousal: 0.35, weight: 0 },
      fusion: { valence: 0, arousal: 0.35 },
      rule_version: 'caps-prototype.v0.1',
    },
    interaction: {
      stance: 'attentive',
      expression: 'neutral',
      tts_style: 'balanced',
    },
    last_event_id: null,
    last_signal: null,
  };
}

function promptForState(state) {
  const { fusion } = state.caps;
  return [
    '[DESKBOT_STATE]',
    `interaction_stance=${state.interaction.stance}`,
    `short_expression=${state.interaction.expression}`,
    `valence=${fusion.valence}`,
    `arousal=${fusion.arousal}`,
    `tts_style=${state.interaction.tts_style}`,
    'Treat this as temporary interaction context. Do not mention this marker or expose internal scores.',
    '[/DESKBOT_STATE]',
  ].join('\n');
}

function isAnalyzableEvent(event) {
  // Assistant output is an observation of what the service produced, not a new
  // user/context signal. It must never feed back into the short state.
  if (event.type === 'conversation.reply' || event.payload?.role === 'assistant') return false;
  if (event.type === 'voice.asr.partial'
    || event.type === 'voice.asr.final'
    || event.type === 'voice.partial'
    || event.type === 'voice.final'
    || event.type === 'conversation.input.partial'
    || event.type === 'conversation.input.final'
    || event.payload?.stage === 'partial'
    || event.payload?.stage === 'final') return false;
  return event.type === 'conversation.input' || Boolean(event.payload?.emotion_signal);
}

function outputPlanForReply(event, state) {
  if (event.type !== 'conversation.reply') return [];

  const text = event.payload?.text ?? '';

  return [
    {
      type: 'render.expression',
      expression: state.interaction.expression,
      status: 'planned',
      targets: ['web', 'fake-device', 'vocat'],
    },
    {
      type: 'speak',
      text,
      tts_style: state.interaction.tts_style,
      status: 'planned',
      targets: ['fake-device', 'vocat'],
    },
  ];
}

export function createStateEngine({
  now = () => new Date(),
  baseLayer = DEFAULT_BASE_LAYER,
  adjustmentWeight = 0.35,
  decay = 0.72,
  persistence = null,
} = {}) {
  const states = new Map();
  for (const storedState of persistence?.list('state.characters') ?? []) {
    const characterId = canonicalCharacterId(storedState.character_id) ?? storedState.character_id;
    const migratedState = characterId === storedState.character_id
      ? storedState
      : { ...storedState, character_id: characterId };
    const existing = states.get(characterId);
    if (!existing || (migratedState.state_revision ?? 0) >= (existing.state_revision ?? 0)) {
      states.set(characterId, migratedState);
    }
    if (characterId !== storedState.character_id) {
      persistence?.put('state.characters', characterId, migratedState);
    }
  }
  const results = new Map(
    (persistence?.list('state.results') ?? []).map((entry) => [entry.event_id, entry.result]),
  );

  function get(characterId) {
    const canonicalId = canonicalCharacterId(characterId) ?? characterId;
    if (!states.has(canonicalId)) {
      const state = createDefaultState(canonicalId, now);
      states.set(canonicalId, state);
      persistence?.put('state.characters', canonicalId, state);
    }
    return states.get(canonicalId);
  }

  function saveResult(eventId, result) {
    results.set(eventId, result);
    persistence?.put('state.results', eventId, { event_id: eventId, result });
  }

  function snapshot(characterId) {
    const state = get(characterId);
    return {
      analysis: null,
      state,
      context: promptForState(state),
      outputs: [],
    };
  }

  function ingest(event) {
    const existingResult = results.get(event.event_id);
    if (existingResult) {
      return existingResult;
    }

    const characterId = canonicalCharacterId(event.character_id) ?? 'unbound';
    const previous = get(characterId);

    if (!isAnalyzableEvent(event)) {
      const result = {
        analysis: null,
        state: previous,
        context: promptForState(previous),
        outputs: outputPlanForReply(event, previous),
      };
      saveResult(event.event_id, result);
      return result;
    }

    const role = event.payload?.role ?? (event.type === 'conversation.reply' ? 'assistant' : 'user');
    const text = event.payload?.text ?? '';
    const analysis = event.payload?.emotion_signal ?? analyzeEmotion(text, { role, source: event.source });
    const previousAdjustment = previous.caps.adjustment_layer;
    const adjustmentLayer = {
      valence: round(previousAdjustment.valence * decay + analysis.valence * (1 - decay)),
      arousal: round(previousAdjustment.arousal * decay + analysis.arousal * (1 - decay)),
      weight: adjustmentWeight,
    };
    const fusion = {
      valence: round(clamp(baseLayer.warmth * 0.15 + adjustmentLayer.valence * adjustmentWeight, -1, 1)),
      arousal: round(clamp(0.25 + baseLayer.agency * 0.15 + adjustmentLayer.arousal * adjustmentWeight)),
    };
    const signalWithRole = { ...analysis, role };
    const state = {
      ...previous,
      state_revision: previous.state_revision + 1,
      updated_at: now().toISOString(),
      caps: {
        base_layer: { ...baseLayer },
        adjustment_layer: adjustmentLayer,
        fusion,
        rule_version: 'caps-prototype.v0.1',
      },
      interaction: {
        stance: stanceForSignal(signalWithRole),
        expression: expressionForState(signalWithRole, fusion),
        tts_style: signalWithRole.valence < -0.25 ? 'gentle' : signalWithRole.valence > 0.25 ? 'lively' : 'balanced',
      },
      last_event_id: event.event_id,
      last_signal: signalWithRole,
    };
    states.set(characterId, state);
    persistence?.put('state.characters', characterId, state);

    const result = {
      analysis: signalWithRole,
      state,
      context: promptForState(state),
      outputs: [
        {
          type: 'render.expression',
          expression: state.interaction.expression,
          status: 'planned',
          targets: ['web', 'fake-device', 'vocat'],
        },
      ],
    };
    saveResult(event.event_id, result);
    return result;
  }

  return {
    context: (characterId) => promptForState(get(characterId)),
    get,
    getResult: (eventId) => results.get(eventId) ?? null,
    ingest,
    snapshot,
  };
}
