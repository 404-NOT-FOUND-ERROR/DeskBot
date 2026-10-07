import assert from 'node:assert/strict';
import test from 'node:test';
import { roleStageHttpFixture, stageSaved } from './support/role-stage-http-fixture.mjs';
import { OWNER, wishRoot } from './support/role-wish-fixture.mjs';
import { roleStageReadModel } from '../src/role-stages.mjs';

test('stage previews are pure; a prepared wish and an unfinished trial cannot be accepted or forged', async t => {
  const h = await roleStageHttpFixture(t), proposal = await h.prepare(), id = proposal.proposal_id;
  const before = stageSaved(h.persistence), original = h.world.get();
  for (let i = 0; i < 4; i++) {
    const preview = await h.preview(id); assert.equal(preview.eligible, false);
    assert.ok(preview.barriers.some(item => item.id === 'actual_two_day_success_required'));
    const list = await h.get('/api/roles/evolution'); assert.equal(list.body.role_stages.enabled, false);
    assert.deepEqual(list.body.role_stages.current, { form: null, vocation: null });
  }
  assert.deepEqual(stageSaved(h.persistence), before); assert.deepEqual(h.world.get(), original);
  const preview = await h.preview(id);
  const unfinished = await h.stageAction(id, 'accept', { preview_fingerprint: preview.preview_fingerprint });
  assert.equal(unfinished.status, 409); assert.equal(unfinished.body.error, 'role_stage_not_ready');
  for (const body of [{ appearance: { form: 'frog' } }, { skill: 'master' }, { root_outcome_ids: ['fiction'] }, { actor_id: 'another' }]) {
    const result = await h.stageAction(id, 'accept', { preview_fingerprint: preview.preview_fingerprint, ...body });
    assert.equal(result.status, 400); assert.equal(result.body.error, 'invalid_role_stage_request');
  }
  const forged = { event_id: 'forged-role-stage', type: 'world.mutation', source: 'role-stage-engine', character_id: OWNER,
    occurred_at: h.now().toISOString(), payload: { action: 'accept_role_stage', proposal_id: id, actor_id: OWNER,
      direction_id: 'wetland_frog', wish_basis: proposal.wish_basis, preview_fingerprint: preview.preview_fingerprint } };
  const external = await h.post('/api/event', forged); assert.equal(external.status, 403);
  assert.throws(() => h.server.ingestNonChatEvent(forged), error => error.statusCode === 403 && error.code === 'role_stage_requires_server_adapter');
  assert.deepEqual(h.world.get(), original); assert.equal(h.roles.get(id).status, 'prepared');
  assert.equal(h.persistence.list('input.events').some(item => item.event.event_id === forged.event_id), false);
});

test('two real cross-day results permit one accepted canonical form, with pure preview and idempotent retries', async t => {
  const h = await roleStageHttpFixture(t), { proposal, first, second } = await h.actualReview(), id = proposal.proposal_id;
  const preview = await h.preview(id), before = h.world.get(), durable = stageSaved(h.persistence);
  assert.equal(preview.eligible, true, JSON.stringify(preview.barriers));
  assert.deepEqual(preview.basis.primary_root_ids.sort(), [`task:${first.task_id}`, `task:${second.task_id}`].sort());
  assert.equal(preview.basis.primary_days.length, 2); assert.equal(preview.qualification_proven, false); assert.equal(preview.preference_proven, false);
  for (let i = 0; i < 4; i++) assert.equal((await h.preview(id)).preview_fingerprint, preview.preview_fingerprint);
  assert.deepEqual(stageSaved(h.persistence), durable); assert.deepEqual(h.world.get(), before);
  const stale = await h.stageAction(id, 'accept', { preview_fingerprint: 'an-old-preview' });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'role_stage_preview_stale'); assert.deepEqual(h.world.get(), before);
  const body = { event_id: 'owner-adopt-frog', preview_fingerprint: preview.preview_fingerprint, reason: '一起试这段生活' };
  const accepted = await h.stageAction(id, 'accept', body); assert.equal(accepted.status, 202, JSON.stringify(accepted));
  assert.equal(accepted.body.proposal.status, 'accepted'); assert.equal(accepted.body.role_stage.current, true);
  assert.equal(accepted.body.role_stages.current.form.direction_id, 'wetland_frog'); assert.equal(accepted.body.role_stages.current.vocation, null);
  const state = h.world.get(); assert.equal(state.role_stages.actors[OWNER].versions.length, 1);
  assert.deepEqual(state.tasks, before.tasks); assert.deepEqual(state.living, before.living); assert.deepEqual(state.memory, before.memory);
  assert.deepEqual(state.protagonist.appearance.geometry, before.protagonist.appearance.geometry);
  assert.deepEqual(h.roles.get(id).wish_basis, proposal.wish_basis); assert.equal(h.roles.get(id).user_choice, 'try');
  assert.equal(accepted.body.proposal.practical_trial.allowed_actions.length, 0);
  const saved = stageSaved(h.persistence), retry = await h.stageAction(id, 'accept', body);
  assert.equal(retry.status, 200); assert.equal(retry.body.duplicate, true); assert.deepEqual(stageSaved(h.persistence), saved); assert.deepEqual(h.world.get(), state);
  const conflict = await h.stageAction(id, 'accept', { ...body, reason: 'another owner request' });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'event_id_conflict'); assert.deepEqual(h.world.get(), state);
  for (const operation of ['pause', 'adjust', 'exit']) {
    const result = await h.trialAction(id, operation, { event_id: `after-accept-${operation}`, ...(operation === 'adjust' ? { variant: 'waterside' } : {}) });
    assert.equal(result.status, 409); assert.equal(result.body.error, 'role_trial_closed_by_stage');
  }
  const archived = await h.post(`/api/roles/proposals/${encodeURIComponent(id)}/archive`); assert.equal(archived.status, 409); assert.equal(archived.body.error, 'role_stage_requires_rollback');
  const gate = h.server.roleEvolution.wishView().directions.find(item => item.direction_id === 'wetland_frog').proposal_gate;
  assert.ok(gate.barriers.some(item => item.id === 'direction_already_current'));
  const repeated = await h.post('/api/roles/proposals', { character_id: OWNER, direction_id: 'wetland_frog' }); assert.equal(repeated.status, 409);
  await h.restart(); assert.equal(h.server.roleEvolution.currentStages().filter(stage => stage.origin === 'canonical_role_stage').length, 1);
  assert.equal(h.world.get().role_stages.actors[OWNER].versions.length, 1);
});

test('rollback requires the current stage ID and retains actual roots and material consequences without reopening the trial', async t => {
  const h = await roleStageHttpFixture(t), { proposal } = await h.actualReview(), id = proposal.proposal_id;
  const preview = await h.preview(id), adopted = await h.stageAction(id, 'accept', { event_id: 'accept-before-rollback', preview_fingerprint: preview.preview_fingerprint });
  assert.equal(adopted.status, 202); const stageId = adopted.body.role_stage.stage_id, before = h.world.get();
  const wrong = await h.stageAction(id, 'rollback', { stage_id: 'another-stage', event_id: 'wrong-rollback' });
  assert.equal(wrong.status, 409); assert.equal(wrong.body.error, 'role_stage_not_current'); assert.deepEqual(h.world.get(), before);
  const body = { stage_id: stageId, event_id: 'owner-rollback-frog', reason: '先回到原来的样子' };
  const rollback = await h.stageAction(id, 'rollback', body); assert.equal(rollback.status, 202, JSON.stringify(rollback));
  assert.equal(rollback.body.role_stage.status, 'rolled_back'); assert.equal(rollback.body.role_stage.current, false);
  assert.deepEqual(rollback.body.role_stages.current, { form: null, vocation: null }); assert.equal(rollback.body.proposal.status, 'withdrawn');
  const state = h.world.get(); assert.deepEqual(state.tasks, before.tasks); assert.deepEqual(state.living, before.living); assert.deepEqual(state.memory, before.memory);
  assert.equal(state.protagonist.appearance.role_stage, undefined); assert.deepEqual(h.roles.get(id).wish_basis, proposal.wish_basis);
  assert.equal(h.roles.get(id).user_choice, 'try'); assert.equal(h.roles.decisions({ proposalId: id }).length, 3);
  const saved = stageSaved(h.persistence), duplicate = await h.stageAction(id, 'rollback', body); assert.equal(duplicate.status, 200); assert.deepEqual(stageSaved(h.persistence), saved);
  const reused = await h.stageAction(id, 'accept', { event_id: 'reuse-old-successes', preview_fingerprint: (await h.preview(id)).preview_fingerprint });
  assert.equal(reused.status, 409); assert.equal(reused.body.error, 'role_stage_requires_prepared_wish');
  const adjusted = await h.trialAction(id, 'adjust', { event_id: 'adjust-consumed', variant: 'waterside' }); assert.equal(adjusted.status, 409);
  const gate = h.server.roleEvolution.wishView().directions.find(item => item.direction_id === 'wetland_frog').proposal_gate;
  assert.equal(gate.needs_new_actual_root, true); assert.ok(gate.barriers.some(item => item.id === 'new_actual_outcome_required'));
  await h.restart(); assert.deepEqual(h.server.roleEvolution.snapshot().role_stages.current, { form: null, vocation: null });
  assert.equal(h.roles.get(id).role_stage_rollback_event_id, body.event_id); assert.equal(h.roles.decisions({ proposalId: id }).length, 3);
});

test('canonical acceptance and rollback crash windows repair only decision history, and delayed rollback keeps later life new', async t => {
  const h = await roleStageHttpFixture(t), { proposal } = await h.actualReview(), id = proposal.proposal_id;
  const preview = await h.preview(id);
  h.world.ingest({ event_id: 'crash-adopt', type: 'world.mutation', source: 'role-stage-engine', source_kind: 'world_engine',
    character_id: OWNER, occurred_at: h.now().toISOString(), payload: { action: 'accept_role_stage', proposal_id: id,
      actor_id: OWNER, direction_id: proposal.direction_id, wish_basis: proposal.wish_basis, preview_fingerprint: preview.preview_fingerprint } }, { roleStageInternal: true });
  assert.equal(h.roles.get(id).status, 'prepared');
  const beforeRead = stageSaved(h.persistence), projected = await h.get(`/api/roles/proposals/${encodeURIComponent(id)}`);
  assert.equal(projected.body.proposal.role_stage.current, true); assert.deepEqual(stageSaved(h.persistence), beforeRead);
  await h.restart(); assert.equal(h.roles.get(id).status, 'accepted'); assert.equal(h.roles.get(id).role_stage_accept_event_id, 'crash-adopt');
  const stageId = roleStageReadModel(h.world.get(), { proposalId: id }).stage_id, rolledAt = h.now().toISOString();
  h.world.ingest({ event_id: 'crash-rollback', type: 'world.mutation', source: 'role-stage-engine', character_id: OWNER,
    occurred_at: rolledAt, payload: { action: 'rollback_role_stage', stage_id: stageId } }, { roleStageInternal: true });
  assert.equal(h.roles.get(id).status, 'accepted');
  const laterRoot = 'task:life-after-rollback';
  await h.arrange(state => { state.memory.development.records.push(wishRoot('life-after-rollback', { at: new Date(Date.parse(rolledAt) + 60_000).toISOString(), activity: 'tend-bed' })); });
  const repaired = h.roles.get(id); assert.equal(repaired.status, 'withdrawn'); assert.equal(repaired.role_stage_rolled_back_at, rolledAt);
  assert.equal(repaired.reconsider_after_roots.includes(laterRoot), false); assert.equal(h.roles.decisions({ proposalId: id }).length, 3);
  const durable = stageSaved(h.persistence); h.server.roleEvolution.syncAll(); assert.deepEqual(stageSaved(h.persistence), durable);
});

test('accepted legacy history is retained but cannot become a new canonical stage from chat feedback', async t => {
  const h = await roleStageHttpFixture(t), original = h.world.get();
  const legacy = h.roles.propose({ status: 'candidate', direction_id: 'starry_observer', label: '旧星空阶段', life: 'old', fantasy_pull: 'old', evidence_ids: ['old'], sources: ['conversation'] }, { characterId: OWNER, proposalId: 'old-accepted-history' });
  h.roles.choose(legacy.proposal_id, 'try'); h.roles.startTrial(legacy.proposal_id, { windowTurns: 1 });
  h.roles.recordTrialObservation(legacy.proposal_id, { eventId: 'old-chat-feedback', signal: 'positive' }); h.roles.completeTrial(legacy.proposal_id, { decision: 'accepted' });
  const old = structuredClone(h.roles.get(legacy.proposal_id));
  const result = await h.stageAction(legacy.proposal_id, 'accept', { preview_fingerprint: (await h.preview(legacy.proposal_id)).preview_fingerprint });
  assert.equal(result.status, 409); assert.equal(result.body.error, 'role_stage_requires_lived_wish'); assert.deepEqual(h.roles.get(legacy.proposal_id), old);
  assert.deepEqual(h.world.get(), original); assert.equal(h.world.get().role_stages, undefined);
  await h.restart(); assert.deepEqual(h.roles.get(legacy.proposal_id), old); assert.ok(h.roles.currentStages().some(stage => stage.proposal_id === legacy.proposal_id));
  assert.ok(h.server.roleEvolution.currentStages().some(stage => stage.proposal_id === legacy.proposal_id));
  await h.arrange(state => { state.role_stages = { schema: 'deskbot.role-stages.v1', revision: 0, actors: {} }; });
  assert.deepEqual(h.server.roleEvolution.currentStages(), []); assert.deepEqual(h.roles.get(legacy.proposal_id), old);
  assert.ok(h.roles.currentStages().some(stage => stage.proposal_id === legacy.proposal_id), 'legacy acceptance stays in its original historical record');
});

test('a real vocation composes with the form; stale previews cannot erase another axis and rollback leaves it intact', async t => {
  const h = await roleStageHttpFixture(t), frog = await h.actualReview(), frogId = frog.proposal.proposal_id;
  const earlierFormPreview = await h.preview(frogId);
  // Perishable ingredients from the initial arrangement have spoiled. Obtain
  // the next meal's ingredients by real travel and gathering, never refilling.
  await h.actualActivity('gather-light-fruit', 'backlit-grove');
  const chef = await h.actualReview('chef', { variant: 'stew' }), chefId = chef.proposal.proposal_id, chefPreview = await h.preview(chefId);
  assert.equal(chefPreview.eligible, true, JSON.stringify(chefPreview.barriers));
  const adoptedChef = await h.stageAction(chefId, 'accept', { event_id: 'owner-adopt-chef', preview_fingerprint: chefPreview.preview_fingerprint });
  assert.equal(adoptedChef.status, 202, JSON.stringify(adoptedChef));
  const staleFrog = await h.stageAction(frogId, 'accept', { event_id: 'stale-form-would-drop-chef', preview_fingerprint: earlierFormPreview.preview_fingerprint });
  assert.equal(staleFrog.status, 409); assert.equal(staleFrog.body.error, 'role_stage_preview_stale');
  const formPreview = await h.preview(frogId); assert.equal(formPreview.eligible, true);
  assert.equal(formPreview.appearance_preview.vocation.direction_id, 'chef');
  const adoptedFrog = await h.stageAction(frogId, 'accept', { event_id: 'fresh-form-with-chef', preview_fingerprint: formPreview.preview_fingerprint });
  assert.equal(adoptedFrog.status, 202);
  assert.equal(adoptedFrog.body.role_stages.current.form.direction_id, 'wetland_frog'); assert.equal(adoptedFrog.body.role_stages.current.vocation.direction_id, 'chef');
  const canonical = h.world.get(), chefStageId = adoptedChef.body.role_stage.stage_id;
  assert.equal(canonical.protagonist.appearance.role_stage.form.direction_id, 'wetland_frog'); assert.equal(canonical.protagonist.appearance.role_stage.vocation.direction_id, 'chef');
  const reverted = await h.stageAction(frogId, 'rollback', { event_id: 'rollback-form-keep-chef', stage_id: adoptedFrog.body.role_stage.stage_id });
  assert.equal(reverted.status, 202); assert.equal(reverted.body.role_stages.current.form, null); assert.equal(reverted.body.role_stages.current.vocation.stage_id, chefStageId);
  const afterRollback = h.world.get(), crossover = await h.stageAction(chefId, 'rollback', { event_id: 'rollback-form-keep-chef', stage_id: adoptedFrog.body.role_stage.stage_id });
  assert.equal(crossover.status, 409); assert.equal(crossover.body.error, 'role_stage_not_current'); assert.deepEqual(h.world.get(), afterRollback);
  assert.equal(h.world.get().protagonist.appearance.role_stage.vocation.direction_id, 'chef'); assert.deepEqual(h.world.get().living, canonical.living); assert.deepEqual(h.world.get().memory, canonical.memory);
  await h.restart(); assert.equal(h.server.roleEvolution.snapshot().role_stages.current.vocation.stage_id, chefStageId);
  assert.equal(h.roles.get(chefId).status, 'accepted'); assert.equal(h.roles.get(frogId).status, 'withdrawn');
});

test('a durable stage survives an interrupted owner decision transaction; same-event retry repairs one acceptance', async t => {
  const h = await roleStageHttpFixture(t), { proposal } = await h.actualReview(), id = proposal.proposal_id, preview = await h.preview(id);
  const before = h.world.get(), body = { event_id: 'accept-interrupted-owner-write', preview_fingerprint: preview.preview_fingerprint };
  const put = h.persistence.put.bind(h.persistence); let fail = true;
  h.persistence.put = (namespace, key, value) => {
    if (fail && namespace === 'role.proposals' && key === id && value.status === 'accepted') throw new Error('controlled interruption after canonical stage commit');
    return put(namespace, key, value);
  };
  const interrupted = await h.stageAction(id, 'accept', body); assert.equal(interrupted.status, 500);
  assert.equal(h.world.get().role_stages.actors[OWNER].versions.length, 1); assert.equal(h.roles.get(id).status, 'prepared');
  assert.equal(h.roles.decisions({ proposalId: id }).filter(item => item.choice === 'accept_role_stage').length, 0);
  assert.equal(h.persistence.list('role.proposal-decisions').filter(item => item.proposal_id === id && item.choice === 'accept_role_stage').length, 0);
  fail = false;
  const retry = await h.stageAction(id, 'accept', body); assert.equal(retry.status, 200, JSON.stringify(retry)); assert.equal(retry.body.duplicate, true);
  assert.equal(h.roles.get(id).status, 'accepted'); assert.equal(h.roles.decisions({ proposalId: id }).filter(item => item.choice === 'accept_role_stage').length, 1);
  assert.equal(h.world.get().role_stages.actors[OWNER].versions.length, 1); assert.deepEqual(h.world.get().living, before.living); assert.deepEqual(h.world.get().memory, before.memory);
  await h.restart(); assert.equal(h.roles.decisions({ proposalId: id }).filter(item => item.choice === 'accept_role_stage').length, 1);
});
