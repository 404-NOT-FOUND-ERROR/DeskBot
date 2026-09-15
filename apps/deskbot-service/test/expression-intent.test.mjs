import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyRoleTrialExpressionIntent, createExpressionIntent, normalizeExpressionIntent } from '../src/expression-intent.mjs';

test('expression intent is one versioned contract for text, screen and TTS', () => {
  const intent = createExpressionIntent({ expression: 'happy', evidenceRefs: ['evt-1', 'evt-1'] });
  assert.equal(intent.schema, 'deskbot.expression-intent.v1');
  assert.equal(intent.mode, 'playful');
  assert.equal(intent.expression, 'happy');
  assert.deepEqual(intent.evidence_refs, ['evt-1']);
  assert.equal(intent.consumers.screen.expression, intent.expression);
  assert.equal(intent.consumers.tts.profile_id, 'miaowu-lively-v1');
  assert.equal(intent.consumers.tts.interruptibility, 'barge_in');
});

test('expression intent normalization clamps intensity and keeps unknown input bounded', () => {
  const intent = normalizeExpressionIntent({ expression: 'unknown', intensity: 4, mode: 'custom' }, { evidenceRefs: ['evt-2'] });
  assert.equal(intent.expression, 'neutral');
  assert.equal(intent.intensity, 1);
  assert.equal(intent.mode, 'custom');
  assert.deepEqual(intent.evidence_refs, ['evt-2']);
});

test('active role trial shares its expression overlay across text, screen and TTS', () => {
  const intent = applyRoleTrialExpressionIntent(
    createExpressionIntent({ expression: 'neutral' }),
    [{ proposal_id: 'p-frog', direction_id: 'wetland_frog', label: '荷叶青蛙', trial: { status: 'active' } }],
  );
  assert.equal(intent.role_trial.direction_id, 'wetland_frog');
  assert.equal(intent.role_trial.applied, true);
  assert.equal(intent.pace, 'springy');
  assert.equal(intent.prosody, 'light_bouncy');
  assert.equal(intent.consumers.text.role_trial_direction, 'wetland_frog');
  assert.equal(intent.consumers.screen.motif, 'ripple');
  assert.equal(intent.consumers.tts.role_trial_direction, 'wetland_frog');
});

test('role trial expression yields to concerned and boundary states', () => {
  const intent = applyRoleTrialExpressionIntent(
    createExpressionIntent({ expression: 'concerned' }),
    [{ proposal_id: 'p-frog', direction_id: 'wetland_frog', label: '荷叶青蛙', trial: { status: 'active' } }],
  );
  assert.equal(intent.role_trial.applied, false);
  assert.equal(intent.expression, 'concerned');
  assert.equal(intent.consumers.screen.motif, undefined);
});
