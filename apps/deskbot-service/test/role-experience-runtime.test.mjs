import test from 'node:test';
import assert from 'node:assert/strict';
import { roleDirectionOverlay } from '../src/role-proposals.mjs';
import { applyRoleTrialExpressionIntent, createExpressionIntent } from '../src/expression-intent.mjs';

test('role proposal overlays are projected from the experience package', () => {
  const overlay = roleDirectionOverlay('chef');
  assert.equal(overlay.package_id, 'chef-v1');
  assert.match(overlay.speech, /食材|饭桌|烹饪|信息/);
});

test('the same package supplies screen and TTS projections', () => {
  const intent = applyRoleTrialExpressionIntent(createExpressionIntent({ expression: 'neutral' }), [{ proposal_id: 'p', direction_id: 'chef', label: '灶边厨师', trial: { status: 'active' } }]);
  assert.equal(intent.role_trial.package_id, 'chef-v1');
  assert.equal(intent.consumers.screen.motif, 'steam_swirl');
  assert.equal(intent.consumers.tts.profile_id, 'miaowu-gentle-v1');
});

