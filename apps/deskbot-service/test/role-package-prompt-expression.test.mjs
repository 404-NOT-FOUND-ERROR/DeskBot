import test from 'node:test';
import assert from 'node:assert/strict';
import { composePrompt, modelRoleExperienceContext, modelRoleStageContext } from '../src/prompt-composer.mjs';

test('accepted stage prompt context carries package-owned speech cues', () => {
  const world = {
    protagonist: { character_id: 'shaping-001' },
    role_stages: { schema: 'deskbot.role-stages.v1', actors: { 'shaping-001': { axis_current: { form: null, vocation: 'stage-chef' }, versions: [{ stage_id: 'stage-chef', actor_id: 'shaping-001', proposal_id: 'p', trial_id: 't', direction_id: 'chef', axis: 'vocation', status: 'accepted', accepted_at: '2026-10-01T00:00:00.000Z', primary_root_ids: [], primary_days: [], frozen_wish_root_ids: [] }] } } },
  };
  const context = modelRoleStageContext(world);
  assert.equal(context[0].package_id, 'chef-v1');
  assert.ok(context[0].catchphrases.includes('喵呜，锅边让让。'));
});

test('baseline package expression is present during ordinary chat, not only role/world questions', () => {
  const result = composePrompt({
    worldSnapshot: { protagonist: { character_id: 'shaping-001', character_profile: {} } },
    stateContext: '当前状态稳定。',
    userText: '帮我看看这段代码。',
  });
  assert.equal(result.role_experience_context.current[0].package_id, 'miaowu-baseline');
  assert.ok(result.role_experience_context.current[0].catchphrases.includes('喵呜。'));
  assert.match(result.prompt, /\[DESKBOT_ROLE_EXPERIENCE\]/);
  assert.match(result.prompt, /功能信息也从自己的反应里长出来/);
});

test('accepted packages and active trials share one prompt projection without mutating package data', () => {
  const context = modelRoleExperienceContext({
    currentRoleStages: [{ direction_id: 'chef', current: true, status: 'accepted' }],
    activeRoleTrials: [{ direction_id: 'explorer', trial: { status: 'active' } }],
  });
  assert.equal(context.current[0].package_id, 'chef-v1');
  assert.equal(context.active_trials[0].package_id, 'explorer-v1');
  assert.ok(context.current[0].catchphrases.includes('喵呜，锅边让让。'));
  assert.ok(context.active_trials[0].speech.includes('路况'));
});

test('canonical current stages win over stale caller stages and practical trials supply provisional expression', () => {
  const world = {
    protagonist: { character_id: 'shaping-001' },
    role_stages: { schema: 'deskbot.role-stages.v1', actors: { 'shaping-001': { axis_current: { form: null, vocation: null }, versions: [] } } },
  };
  const context = modelRoleExperienceContext({
    worldSnapshot: world,
    currentRoleStages: [{ direction_id: 'chef', current: true, status: 'accepted' }],
    roleWishes: [{ origin: 'lived_wish', character_id: 'shaping-001', proposal_id: 'p-explore', direction_id: 'explorer', axis: 'vocation', status: 'prepared',
      practical_trial: { schema: 'deskbot.practical-role-trial.v1', proposal_id: 'p-explore', actor_id: 'shaping-001', direction_id: 'explorer', axis: 'vocation', status: 'running', progress: {} } }],
  });
  assert.equal(context.current[0].package_id, 'miaowu-baseline');
  assert.equal(context.active_trials[0].package_id, 'explorer-v1');
  assert.equal(context.active_trials[0].status, 'running');
});

test('fallback caller stages require accepted status or the legacy accepted role-state contract', () => {
  for (const status of ['proposed', 'trying', 'prepared', 'deferred', 'rolled_back', 'withdrawn']) {
    const context = modelRoleExperienceContext({ currentRoleStages: [{ direction_id: 'chef', current: true, status }] });
    assert.equal(context.current[0].package_id, 'miaowu-baseline');
  }
  const unknown = modelRoleExperienceContext({ currentRoleStages: [{ direction_id: 'chef' }] });
  assert.equal(unknown.current[0].package_id, 'miaowu-baseline');
  const legacy = modelRoleExperienceContext({ currentRoleStages: [{ schema: 'deskbot.role-state.v1', direction_id: 'chef' }] });
  assert.equal(legacy.current[0].package_id, 'chef-v1');
});

