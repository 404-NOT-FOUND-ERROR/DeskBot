import test from 'node:test';
import assert from 'node:assert/strict';

import { roleStageHttpFixture } from './support/role-stage-http-fixture.mjs';

test('role stage accept and rollback replay through the original domain entry', async t => {
  const h = await roleStageHttpFixture(t);
  const { proposal } = await h.actualReview('wetland_frog');
  const preview = await h.preview(proposal.proposal_id);
  const accepted = await h.stageAction(proposal.proposal_id, 'accept', {
    event_id: 'route-stage-accept-001', preview_fingerprint: preview.preview_fingerprint,
  });
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  const revision = h.world.get().world_revision;
  const currentStage = accepted.body.role_stage.stage_id;

  const acceptReplay = await h.server.replayRoute('role.stage.accept', {
    proposal_id: proposal.proposal_id,
    event_id: 'route-stage-accept-001',
    preview_fingerprint: preview.preview_fingerprint,
  });
  assert.equal(acceptReplay.duplicate, true);
  assert.equal(h.world.get().world_revision, revision);

  const rollback = await h.stageAction(proposal.proposal_id, 'rollback', {
    event_id: 'route-stage-rollback-001', stage_id: currentStage,
  });
  assert.equal(rollback.status, 202, JSON.stringify(rollback));
  const rollbackRevision = h.world.get().world_revision;
  const rollbackReplay = await h.server.replayRoute('role.stage.rollback', {
    proposal_id: proposal.proposal_id,
    event_id: 'route-stage-rollback-001', stage_id: currentStage,
  });
  assert.equal(rollbackReplay.duplicate, true);
  assert.equal(h.world.get().world_revision, rollbackRevision);
});
