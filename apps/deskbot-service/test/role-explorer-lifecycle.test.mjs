import test from 'node:test';
import assert from 'node:assert/strict';
import { roleStageHttpFixture } from './support/role-stage-http-fixture.mjs';
import { wishRoot, OWNER } from './support/role-wish-fixture.mjs';
import { composePrompt } from '../src/prompt-composer.mjs';
import { roleStageCandidates } from '../src/role-stages.mjs';

function explorerWishRoots() {
  return [
    wishRoot('explore-a', { at: '2026-10-06T05:00:00.000Z', location: 'tidal-old-road', topic: 'explore', observe: true }),
    wishRoot('explore-b', { at: '2026-10-07T05:00:00.000Z', location: 'echo-waterside', topic: 'explore', observe: true }),
    wishRoot('explore-c', { at: '2026-10-08T05:00:00.000Z', location: 'tidal-old-road', topic: 'explore', observe: true }),
    wishRoot('explore-practice-a', { at: '2026-10-06T05:30:00.000Z', activity: 'scout-route', location: 'echo-waterside', topic: 'explore' }),
    wishRoot('explore-practice-b', { at: '2026-10-07T05:30:00.000Z', activity: 'scout-route', location: 'echo-waterside', topic: 'explore' }),
  ];
}

test('explorer completes the real trial-to-stage lifecycle and recovers after restart', async t => {
  const h = await roleStageHttpFixture(t, { developmentRecords: explorerWishRoots() });
  const readiness = await h.get('/api/roles/evolution');
  const direction = readiness.body.wishes.directions.find(item => item.direction_id === 'explorer');
  assert.equal(direction.readiness.eligible, true, JSON.stringify(direction.readiness.barriers));

  const proposal = await h.prepare('explorer');
  assert.equal(proposal.direction_id, 'explorer');
  assert.equal(proposal.user_choice, 'try');

  await h.arrange(state => {
    state.protagonist.location_id = 'echo-waterside';
    Object.assign(state.autonomy.actors[OWNER], { energy: .85, appetite: .1, paused: false,
      updated_at: h.now().toISOString(), next_decision_at: h.now().toISOString(), plan: null });
  });
  const started = await h.trialAction(proposal.proposal_id, 'start');
  assert.equal(started.status, 202, JSON.stringify(started));
  assert.equal(started.body.practical_trial.direction_id, 'explorer');

  const first = h.untilPrimary();
  assert.equal(first.activity_id, 'scout-route');
  h.advance(Date.parse(first.due_at) - h.now().getTime());
  assert.equal(h.view(proposal.proposal_id).progress.successful_primary, 1);

  h.advance(24 * 3600_000);
  await h.arrange(state => {
    state.protagonist.location_id = 'echo-waterside';
    Object.assign(state.autonomy.actors[OWNER], { energy: .85, appetite: .1, paused: false,
      updated_at: h.now().toISOString(), next_decision_at: h.now().toISOString(), plan: null });
  });
  const second = h.untilPrimary();
  assert.equal(second.activity_id, 'scout-route');
  h.advance(Date.parse(second.due_at) - h.now().getTime());
  assert.equal(h.view(proposal.proposal_id).review.reason, 'repeated_actual_success');

  const preview = await h.preview(proposal.proposal_id);
  const originalAppearance = structuredClone(h.world.get().protagonist.appearance);
  assert.equal(preview.eligible, true, JSON.stringify(preview.barriers));
  assert.equal(preview.appearance_preview.vocation.direction_id, 'explorer');
  assert.equal(preview.physical_shell_changed, false);
  const accepted = await h.stageAction(proposal.proposal_id, 'accept', {
    event_id: 'owner-adopt-explorer', preview_fingerprint: preview.preview_fingerprint,
  });
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  assert.equal(accepted.body.role_stages.current.vocation.direction_id, 'explorer');
  assert.equal(accepted.body.proposal.status, 'accepted');
  assert.equal(h.world.get().protagonist.appearance.role_stage.vocation.figure_vocation, 'explorer');
  assert.deepEqual(h.world.get().protagonist.appearance.role_stage.vocation.accessories, ['route-scarf', 'map-badge']);
  assert.deepEqual(h.world.get().protagonist.appearance.geometry, originalAppearance.geometry);

  const adopted = h.world.get();
  const prompt = composePrompt({ worldSnapshot: adopted, roleWishes: h.server.roleEvolution.wishProposals(),
    userText: '帮我看看这段代码。', stateContext: '当前状态稳定。' });
  assert.equal(prompt.role_experience_context.current[0].package_id, 'explorer-v1');
  assert.equal(prompt.role_experience_context.active_trials.length, 0);
  assert.match(prompt.prompt, /先走十步看看/);
  const choices = roleStageCandidates(adopted, { ...adopted.autonomy.actors[OWNER], energy: .85, appetite: .1 }, h.now().toISOString());
  assert.ok(choices.some(item => item.role_stage.direction_id === 'explorer'
    && item.steps.some(step => step.activity_id === 'scout-route')));
  assert.equal(choices.find(item => item.role_stage.direction_id === 'explorer').title, '沿着旧路观察十步');

  const durableRevision = h.world.get().role_stages.revision;
  await h.restart();
  assert.equal(h.world.get().role_stages.revision, durableRevision);
  assert.equal(h.server.roleEvolution.currentStages().find(item => item.direction_id === 'explorer').direction_id, 'explorer');
  assert.equal(h.roles.get(proposal.proposal_id).status, 'accepted');
  assert.equal(h.view(proposal.proposal_id).accepted_stage_id != null, true);
  const replay = await h.stageAction(proposal.proposal_id, 'accept', {
    event_id: 'owner-adopt-explorer', preview_fingerprint: preview.preview_fingerprint,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(h.world.get().role_stages.revision, durableRevision);
});
