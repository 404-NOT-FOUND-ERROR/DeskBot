import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createStateEngine } from '../src/state-engine.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');

test('emotion analysis is deterministic and produces an explainable signal', () => {
  const engine = createStateEngine({ now: () => fixedTime });
  const result = engine.ingest({
    event_id: 'evt-state-001',
    type: 'conversation.input',
    source: 'deskbot-web',
    character_id: 'ember-001',
    payload: { role: 'user', text: '我今天有点累，也有点难过' },
  });

  assert.equal(result.analysis.analyzer, 'lexicon-v0.1');
  assert.equal(result.state.character_id, 'shaping-001');
  assert.equal(result.analysis.label, 'sadness');
  assert.deepEqual(result.analysis.cues, ['难过', '累']);
  assert.equal(result.state.state_revision, 1);
  assert.equal(result.state.interaction.expression, 'concerned');
  assert.match(result.context, /\[DESKBOT_STATE\]/);
  assert.equal(result.outputs[0].type, 'render.expression');
});

test('state keeps adjustment signal separate from the base layer', () => {
  const engine = createStateEngine({ now: () => fixedTime });
  const result = engine.ingest({
    event_id: 'evt-state-002',
    type: 'conversation.input',
    source: 'dialogue',
    character_id: 'ember-001',
    payload: { role: 'user', text: '太棒了，我很期待。' },
  });

  assert.equal(result.analysis.label, 'joy');
  assert.equal(result.state.caps.rule_version, 'caps-prototype.v0.1');
  assert.notDeepEqual(result.state.caps.base_layer, result.state.caps.adjustment_layer);
  assert.equal(result.state.interaction.tts_style, 'lively');
});

test('assistant replies plan outputs without feeding back into CAPS state', () => {
  const engine = createStateEngine({ now: () => new Date('2026-08-21T00:00:00.000Z') });
  const input = engine.ingest({
    event_id: 'evt-user-sad',
    type: 'conversation.input',
    source: 'dialogue',
    character_id: 'ember-001',
    payload: { role: 'user', text: '今天有点累' },
  });
  const reply = engine.ingest({
    event_id: 'evt-assistant-reply',
    type: 'conversation.reply',
    source: 'deskbot-llm',
    character_id: 'ember-001',
    payload: { role: 'assistant', text: '那就慢一点，我会陪着你。' },
  });

  assert.equal(reply.state.state_revision, input.state.state_revision);
  assert.equal(reply.state.last_event_id, input.state.last_event_id);
  assert.deepEqual(reply.outputs.map((output) => output.type), ['render.expression', 'speak']);
});

test('assistant emotion metadata remains audit-only and cannot update short state', () => {
  const engine = createStateEngine({ now: () => fixedTime });
  const input = engine.ingest({
    event_id: 'evt-user-neutral',
    type: 'conversation.input',
    source: 'deskbot-web',
    character_id: 'ember-001',
    payload: { role: 'user', text: '你好' },
  });
  const reply = engine.ingest({
    event_id: 'evt-assistant-labelled',
    type: 'conversation.reply',
    source: 'deskbot-llm',
    character_id: 'ember-001',
    payload: {
      role: 'assistant',
      text: '我会陪你。',
      emotion_signal: { label: 'anger', valence: -0.75, arousal: 0.9, confidence: 1 },
    },
  });

  assert.equal(reply.state.state_revision, input.state.state_revision);
  assert.equal(reply.state.interaction.expression, input.state.interaction.expression);
});
