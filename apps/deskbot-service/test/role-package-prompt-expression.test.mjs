import test from 'node:test';
import assert from 'node:assert/strict';
import { modelRoleStageContext } from '../src/prompt-composer.mjs';

test('accepted stage prompt context carries package-owned speech cues', () => {
  const world = {
    protagonist: { character_id: 'shaping-001' },
    role_stages: { schema: 'deskbot.role-stages.v1', actors: { 'shaping-001': { axis_current: { form: null, vocation: 'stage-chef' }, versions: [{ stage_id: 'stage-chef', actor_id: 'shaping-001', proposal_id: 'p', trial_id: 't', direction_id: 'chef', axis: 'vocation', status: 'accepted', accepted_at: '2026-10-01T00:00:00.000Z', primary_root_ids: [], primary_days: [], frozen_wish_root_ids: [] }] } } },
  };
  const context = modelRoleStageContext(world);
  assert.equal(context[0].package_id, 'chef-v1');
  assert.ok(context[0].catchphrases.includes('喵呜，锅边让让。'));
});

