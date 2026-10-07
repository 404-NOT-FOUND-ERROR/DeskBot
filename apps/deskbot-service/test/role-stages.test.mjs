import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentWorld, getWorldMap } from '../src/persistent-world.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { installLivedMemory, syncLivedMemory } from '../src/lived-memory.mjs';
import { advanceAutonomousLife } from '../src/autonomous-life.mjs';
import { advanceLivingResources } from '../src/living-resources.mjs';
import { activeWorldTask, applyRealTimeClock, startActivityTask, advanceWorldTask } from '../src/realtime-world.mjs';
import { startPracticalTrial, controlPracticalTrial, settlePracticalTrials, practicalTrialReadModel } from '../src/role-practical-trials.mjs';
import { roleStagePreview, acceptRoleStage, rollbackRoleStage, roleStageReadModel, roleStagesReadModel,
  roleStageLifeProfile, roleStageCandidates } from '../src/role-stages.mjs';

const OWNER = 'shaping-001', BASE = '2026-10-09T04:00:00.000Z', M = 60_000;
// Arrange finite resources/needs explicitly; all new primary outcomes below
// come from original task admission, route, duration and completion engines.
function fixture() {
  const w = createPersistentWorld({ now: () => new Date(BASE), timeMode: 'realtime' }).get();
  installAutonomy(w, BASE); installLivedMemory(w, BASE);
  for (const state of Object.values(w.autonomy.actors)) state.paused = state.actor_id !== OWNER;
  w.protagonist.location_id = 'moss-sprout-garden';
  let time = Date.parse(BASE), proposal = null;
  const now = () => new Date(time).toISOString();
  function advance(ms) {
    const target = time + ms;
    for (let task; (task = w.tasks.filter(t => t.status === 'running' && Date.parse(t.due_at) <= target).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0]);) {
      advanceLivingResources(w, task.due_at, { force: true });
      advanceWorldTask(w, { task_id: task.task_id, expected_task_revision: task.revision }, task.due_at);
    }
    time = target; advanceLivingResources(w, now(), { force: true }); applyRealTimeClock(w, now()); syncLivedMemory(w, now()); settlePracticalTrials(w, now());
  }
  startActivityTask(w, { actor_id: OWNER, activity_id: 'tend-bed', task_id: 'prior-real-care' }, { eventId: 'prior-real-care', at: now() }); advance(12 * M);
  const h = { w, now, advance, state: () => w.autonomy.actors[OWNER], proposal: () => proposal,
    arrange(direction = 'wetland_frog') {
      const state = this.state(); assert.equal(activeWorldTask(w, OWNER), null);
      Object.assign(state, { energy: .88, appetite: .15, updated_at: now(), plan: null, next_decision_at: now(), cooldowns: {} });
      Object.assign(w.living.objects['garden-bed'], { health: .98, moisture: .58, growth: .2, quantity: 10 });
      Object.assign(w.living.objects['seedling-rack'].stock, { trays: direction === 'workshop_maker' ? 0 : 3, moss: 6, water: 12 });
      Object.assign(w.living.objects['parts-drawers'].stock, { wood: 9, fasteners: 15 });
      w.living.objects['shared-table'].stock.rations = direction === 'chef' ? 8 : 12;
      w.living.objects['trial-stove'].stock.water = 6;
      w.protagonist.location_id = direction === 'workshop_maker' ? 'spare-parts-house' : direction === 'chef' ? 'warm-pot-courtyard' : 'moss-sprout-garden';
    },
    start(direction = 'wetland_frog', suffix = direction) {
      this.arrange(direction);
      proposal = { origin: 'lived_wish', status: 'prepared', user_choice: 'try', proposal_id: `real-stage-wish:${suffix}`,
        character_id: OWNER, direction_id: direction, axis: direction === 'wetland_frog' ? 'form' : 'vocation', wish_basis: { root_outcome_ids: ['task:prior-real-care'] } };
      startPracticalTrial(w, { proposalId: proposal.proposal_id, actorId: OWNER, directionId: direction, wishBasis: proposal.wish_basis, at: now(), eventId: `start:${suffix}` });
    },
    tick() { return advanceAutonomousLife(w, now(), { eventId: `life:${now()}` }); },
    untilPrimary() {
      for (let i = 0; i < 400; i++) { const task = activeWorldTask(w, OWNER); if (task?.role_trial?.step_role === 'primary') return task; this.tick(); this.advance(M); }
      assert.fail('Expected primary trial work via original autonomous choices');
    },
    success() { const task = this.untilPrimary(); this.advance(Date.parse(task.due_at) - Date.parse(now())); return task; },
    complete(direction = 'wetland_frog', suffix) {
      this.start(direction, suffix); this.success(); this.advance(24 * 60 * M); this.arrange(direction); settlePracticalTrials(w, now()); this.success();
      assert.equal(practicalTrialReadModel(w, { proposalId: proposal.proposal_id }).review.reason, 'repeated_actual_success');
    },
    preview(more = {}) { return roleStagePreview(w, { proposal: { ...proposal, ...more }, at: now() }); },
    accept(more = {}) { return acceptRoleStage(w, { proposalId: proposal.proposal_id, actorId: OWNER, directionId: proposal.direction_id,
      wishBasis: proposal.wish_basis, at: now(), eventId: `accept:${proposal.proposal_id}`, previewFingerprint: this.preview().preview_fingerprint, ...more }); },
  }; return h;
}

test('empty and prepared previews are pure and never invent an adopted stage or completion', () => {
  const h = fixture(), baseline = structuredClone(h.w);
  assert.equal(roleStagesReadModel(h.w).enabled, false); assert.deepEqual(h.w, baseline);
  h.start(); const before = structuredClone(h.w), view = h.preview();
  assert.equal(view.eligible, false); assert.ok(view.barriers.some(b => b.id === 'actual_two_day_success_required'));
  assert.equal(view.appearance_preview.form.figure_form, 'leaf-frog'); assert.equal(view.physical_shell_changed, false);
  assert.equal(view.life_changes.basis, 'rule_based_choice'); assert.equal(view.preference_proven, false);
  assert.deepEqual(h.w, before); assert.throws(() => h.accept(), { code: 'role_stage_not_ready' }); assert.deepEqual(h.w, before);
});

test('two actually admitted cross-day primary results plus matching saved preparation permit one adoption', () => {
  const h = fixture(); h.complete();
  const before = structuredClone(h.w), preview = h.preview(); assert.equal(preview.eligible, true);
  assert.equal(preview.basis.primary_root_ids.length, 2); assert.equal(preview.basis.primary_days.length, 2);
  h.w.autonomy.actors[OWNER].energy = .7; assert.equal(h.preview().preview_fingerprint, preview.preview_fingerprint);
  const result = h.accept(), view = roleStageReadModel(h.w, { proposalId: h.proposal().proposal_id });
  assert.equal(view.current, true); assert.deepEqual(view.allowed_actions, ['rollback']); assert.equal(view.status, 'accepted');
  assert.deepEqual(h.w.living, before.living); assert.deepEqual(h.w.tasks, before.tasks); assert.deepEqual(h.w.memory, before.memory);
  assert.deepEqual(h.w.protagonist.profile, before.protagonist.profile); assert.equal(h.w.protagonist.character_id, before.protagonist.character_id);
  assert.deepEqual(h.w.role_stages.actors[OWNER].baseline_appearance, before.protagonist.appearance);
  assert.equal(h.w.protagonist.appearance.role_stage.form.direction_id, 'wetland_frog'); assert.equal(h.w.protagonist.appearance.role_stage.physical_shell_changed, false);
  const trial = practicalTrialReadModel(h.w, { proposalId: h.proposal().proposal_id });
  assert.equal(trial.accepted_stage_id, result.stage_id); assert.deepEqual(trial.allowed_actions, []); assert.equal(trial.status, 'review');
  for (const operation of ['pause', 'resume', 'adjust', 'exit']) assert.throws(() => controlPracticalTrial(h.w,
    { trialId: trial.trial_id, operation, at: h.now(), eventId: operation, variant: 'waterside' }), { code: 'practical_trial_stage_bound' });
  const accepted = structuredClone(h.w); assert.equal(h.accept().duplicate, true); settlePracticalTrials(h.w, h.now());
  roleStagesReadModel(h.w); h.preview(); assert.deepEqual(h.w, accepted);
});

test('chat, support roots, failures, altered identity and invalid frozen basis cannot replace actual current-method success', () => {
  const h = fixture(); h.start(); const trial = Object.values(h.w.practical_role_trials.trials)[0];
  trial.status = 'review'; trial.review_reason = 'repeated_actual_success';
  trial.outcomes = [1, 2].map(i => ({ root_outcome_id: `task:invented-${i}`, at: new Date(Date.parse(h.now()) - i * 86400000).toISOString(),
    step_role: 'primary', outcome: 'completed', variant_id: trial.variant_id, activity_id: 'tend-bed', attempt_id: `invented-${i}` }));
  assert.equal(h.preview().eligible, false); assert.throws(() => h.accept(), { code: 'role_stage_not_ready' });
  const actual = fixture(); actual.complete();
  for (const changed of [{ user_choice: 'later' }, { status: 'proposed' }, { origin: 'legacy' }, { axis: 'vocation' },
    { character_id: 'pot-cook-001' }, { wish_basis: { root_outcome_ids: ['task:wrong-root'] } }]) assert.equal(actual.preview(changed).eligible, false);
  const t = Object.values(actual.w.practical_role_trials.trials)[0]; t.review_from = actual.now();
  assert.equal(actual.preview().eligible, false); assert.throws(() => actual.accept(), { code: 'role_stage_not_ready' });
});

test('rollback changes only the current axis layer and future choices, keeping actual stock, tasks and roots', () => {
  const h = fixture(); h.complete(); const original = structuredClone(h.w.protagonist.appearance);
  const accepted = h.accept(), stock = structuredClone(h.w.living), roots = structuredClone(h.w.memory);
  const profile = { interests: ['explore'], places: ['shaping-field-desk'], rest: 'shaping-field-desk', quiet: '待一会儿' };
  assert.ok(roleStageLifeProfile(h.w, OWNER, profile).places.includes('echo-waterside'));
  assert.ok(roleStageCandidates(h.w, h.state(), h.now()).some(choice => choice.role_stage.stage_id === accepted.stage_id));
  const result = rollbackRoleStage(h.w, { stageId: accepted.stage_id, at: h.now(), eventId: 'owner-rollback' });
  assert.equal(result.stage.status, 'rolled_back'); assert.equal(result.stage.current, false); assert.equal(result.restored_stage_id, null);
  assert.deepEqual(h.w.protagonist.appearance, { ...original, updated_at: h.now() });
  assert.deepEqual(h.w.living, stock); assert.deepEqual(h.w.memory, roots); assert.deepEqual(roleStageLifeProfile(h.w, OWNER, profile), profile);
  assert.deepEqual(roleStageCandidates(h.w, h.state(), h.now()), []);
  assert.throws(() => h.accept(), { code: 'role_stage_trial_consumed' });
  const before = structuredClone(h.w); assert.equal(rollbackRoleStage(h.w, { stageId: accepted.stage_id, at: h.now(), eventId: 'retry' }).duplicate, true); assert.deepEqual(h.w, before);
});

test('same identity can combine frog with maker then chef; rollback restores maker without erasing the form', () => {
  const h = fixture(); h.complete(); const frog = h.accept();
  h.advance(24 * 60 * M); h.complete('workshop_maker'); const maker = h.accept();
  const makerLook = structuredClone(h.w.protagonist.appearance.role_stage);
  assert.equal(makerLook.form.stage_id, frog.stage_id); assert.equal(makerLook.vocation.stage_id, maker.stage_id);
  h.advance(24 * 60 * M); h.complete('chef'); const preview = h.preview();
  assert.equal(preview.appearance_preview.form.stage_id, frog.stage_id); assert.equal(preview.appearance_preview.vocation.figure_vocation, 'chef');
  const chef = h.accept(), stock = structuredClone(h.w.living), tasks = structuredClone(h.w.tasks), memory = structuredClone(h.w.memory);
  assert.equal(roleStagesReadModel(h.w).current.vocation.predecessor_stage_id, maker.stage_id);
  assert.throws(() => rollbackRoleStage(h.w, { stageId: maker.stage_id, at: h.now(), eventId: 'stale' }), { code: 'role_stage_not_current' });
  rollbackRoleStage(h.w, { stageId: chef.stage_id, at: h.now(), eventId: 'chef-back' });
  assert.deepEqual(h.w.protagonist.appearance.role_stage, makerLook); assert.deepEqual(h.w.living, stock); assert.deepEqual(h.w.tasks, tasks); assert.deepEqual(h.w.memory, memory);
  assert.equal(roleStagesReadModel(h.w).history.length, 3);
  rollbackRoleStage(h.w, { stageId: frog.stage_id, at: h.now(), eventId: 'frog-back' });
  assert.equal(h.w.protagonist.appearance.role_stage.form, null); assert.equal(h.w.protagonist.appearance.role_stage.vocation.stage_id, maker.stage_id);
});

test('preview is stale only when related actual review or either current axis changes', () => {
  const h = fixture(); h.complete(); const preview = h.preview();
  h.advance(M); assert.equal(h.preview().preview_fingerprint, preview.preview_fingerprint);
  assert.throws(() => h.accept({ previewFingerprint: 'arbitrary' }), { code: 'role_stage_preview_stale' });
  const before = structuredClone(h.w); h.preview(); assert.deepEqual(h.w, before);
  const trial = Object.values(h.w.practical_role_trials.trials)[0]; trial.variant_id = 'waterside';
  assert.notEqual(h.preview().preview_fingerprint, preview.preview_fingerprint); assert.equal(h.preview().eligible, false);
});

test('adopted life options stay bounded by needs and current trials; ordinary hunger and held tasks win', () => {
  const h = fixture(); h.complete(); h.accept(); h.state().plan = null; h.state().next_decision_at = h.now();
  h.state().appetite = .85; h.tick(); assert.equal(h.state().plan.goal, 'meal'); assert.equal(activeWorldTask(h.w, OWNER).role_stage, undefined);
  const ordinary = structuredClone(activeWorldTask(h.w, OWNER));
  rollbackRoleStage(h.w, { stageId: roleStagesReadModel(h.w).current.form.stage_id, at: h.now(), eventId: 'while-eating' });
  assert.deepEqual(activeWorldTask(h.w, OWNER), ordinary);
  const other = fixture(); other.complete(); other.accept(); other.state().energy = .2;
  assert.deepEqual(roleStageCandidates(other.w, other.state(), other.now()), []);
  other.state().energy = .9; other.w.living.objects['seedling-rack'].stock.water = 0;
  const before = structuredClone(other.w.living); assert.deepEqual(roleStageCandidates(other.w, other.state(), other.now()), []); assert.deepEqual(other.w.living, before);
});

test('adoption changes the actual next bounded choice and its original recipe spends water once', () => {
  const h = fixture(); h.complete(); const stage = h.accept();
  const stock = h.w.living.objects['seedling-rack'].stock.water, common = h.w.memory.development.records.length;
  h.tick(); const task = activeWorldTask(h.w, OWNER);
  assert.equal(h.state().plan.role_stage.stage_id, stage.stage_id);
  assert.equal(task.role_stage.stage_id, stage.stage_id); assert.equal(task.role_stage.basis, 'rule_based_choice');
  assert.equal(task.activity_id, 'tend-bed'); assert.equal(task.status, 'running');
  assert.equal(h.w.living.objects['seedling-rack'].stock.water, stock - 1);
  assert.equal(h.w.memory.development.records.length, common);
  // Rollback leaves already reserved water and current ordinary work in place.
  rollbackRoleStage(h.w, { stageId: stage.stage_id, at: h.now(), eventId: 'rollback-during-adopted-work' });
  assert.equal(activeWorldTask(h.w, OWNER).task_id, task.task_id);
  h.advance(Date.parse(task.due_at) - Date.parse(h.now()));
  assert.equal(h.w.tasks.find(item => item.task_id === task.task_id).status, 'completed');
  assert.equal(h.w.memory.development.records.filter(item => item.root_outcome_id === `task:${task.task_id}`).length, 1);
  assert.equal(h.w.living.objects['seedling-rack'].stock.water, stock - 1);
  assert.equal(roleStagesReadModel(h.w).current.form, null);
});

test('adopted maker delivers existing real trial trays through the original route and transfer without producing extra items', () => {
  const h = fixture(); h.complete('workshop_maker'); const stage = h.accept();
  const bag = h.w.living.inventories[OWNER].stock, rack = h.w.living.objects['seedling-rack'].stock;
  assert.ok(bag.trays >= 2); const totalTrays = bag.trays + rack.trays;
  const completedCrafts = h.w.tasks.filter(task => task.activity_id === 'craft-tray').length;
  const parts = structuredClone(h.w.living.objects['parts-drawers'].stock);
  h.tick(); assert.equal(h.state().plan.role_stage.stage_id, stage.stage_id); assert.match(h.state().plan.goal, /:store-trays$/);
  assert.equal(activeWorldTask(h.w, OWNER).kind, 'travel'); assert.equal(h.w.protagonist.location_id, 'spare-parts-house');
  for (let i = 0; i < 40 && h.w.living.inventories[OWNER].stock.trays > 0; i++) {
    const task = activeWorldTask(h.w, OWNER); h.advance(task ? Math.max(M, Date.parse(task.due_at) - Date.parse(h.now())) : M); h.tick();
  }
  assert.equal(h.w.protagonist.location_id, 'moss-sprout-garden');
  assert.equal(h.w.living.inventories[OWNER].stock.trays, 0); assert.equal(h.w.living.objects['seedling-rack'].stock.trays, totalTrays);
  assert.deepEqual(h.w.living.objects['parts-drawers'].stock, parts);
  assert.equal(h.w.tasks.filter(task => task.activity_id === 'craft-tray').length, completedCrafts, 'delivery adds no fabrication');
});

test('an adopted maker new-tray plan actually makes then carries its finite output to the shared nursery', () => {
  const h = fixture(); h.complete('workshop_maker'); const stage = h.accept();
  // A separate finite starting layout represents the nursery needing a tray.
  // This edits setup only; new fabrication and delivery use original engines.
  h.w.living.inventories[OWNER].stock.trays = 0; h.w.living.objects['seedling-rack'].stock.trays = 0;
  Object.assign(h.state(), { plan: null, next_decision_at: h.now(), cooldowns: {}, energy: .88, appetite: .15, updated_at: h.now() });
  const parts = structuredClone(h.w.living.objects['parts-drawers'].stock), count = h.w.tasks.filter(task => task.activity_id === 'craft-tray').length;
  h.tick(); const craft = activeWorldTask(h.w, OWNER);
  assert.equal(craft.activity_id, 'craft-tray'); assert.equal(craft.role_stage.stage_id, stage.stage_id);
  assert.equal(h.w.living.inventories[OWNER].stock.trays, 0); assert.equal(craft.status, 'running');
  h.advance(Date.parse(craft.due_at) - Date.parse(h.now()));
  assert.equal(h.w.living.inventories[OWNER].stock.trays, 1); h.tick(); assert.equal(activeWorldTask(h.w, OWNER).kind, 'travel');
  for (let i = 0; i < 40 && h.w.living.objects['seedling-rack'].stock.trays < 1; i++) {
    const task = activeWorldTask(h.w, OWNER); h.advance(task ? Math.max(M, Date.parse(task.due_at) - Date.parse(h.now())) : M); h.tick();
  }
  assert.equal(h.w.protagonist.location_id, 'moss-sprout-garden');
  assert.equal(h.w.living.inventories[OWNER].stock.trays, 0); assert.equal(h.w.living.objects['seedling-rack'].stock.trays, 1);
  assert.equal(h.w.living.objects['parts-drawers'].stock.wood, parts.wood - 1);
  assert.equal(h.w.living.objects['parts-drawers'].stock.fasteners, parts.fasteners - 1);
  assert.equal(h.w.tasks.filter(task => task.activity_id === 'craft-tray').length, count + 1);
  assert.equal(h.w.memory.development.records.filter(record => record.root_outcome_id === `task:${craft.task_id}`).length, 1);
});

test('map figure, stage card and rollback read the same canonical visual layer without exposing the private baseline archive', () => {
  const h = fixture(); h.complete(); const stage = h.accept(), before = structuredClone(h.w);
  const map = getWorldMap(h.w), stages = roleStagesReadModel(h.w);
  assert.deepEqual(map.protagonist.appearance.role_stage, stages.appearance);
  assert.equal(map.protagonist.appearance.role_stage.form.stage_id, stage.stage_id);
  assert.deepEqual(Object.keys(map.protagonist.appearance).sort(), ['role_stage', 'schema']);
  assert.equal(map.protagonist.appearance.baseline_appearance, undefined);
  assert.deepEqual(h.w, before);
  rollbackRoleStage(h.w, { stageId: stage.stage_id, at: h.now(), eventId: 'map-back' });
  const after = getWorldMap(h.w); assert.equal(after.protagonist.appearance.role_stage, undefined);
  assert.equal(roleStagesReadModel(h.w).appearance.form, null);
});

test('canonical stage bindings survive common-result retention and world restart without repeating acceptance', () => {
  const h = fixture(); h.complete(); const stage = h.accept();
  h.w.tasks = []; h.w.memory.development.records = []; h.w.memory.episodes = [];
  const holder = { value: structuredClone(h.w) };
  const persistence = { list: namespace => namespace === 'canonical-world.states' ? [structuredClone(holder.value)] : [],
    put: (namespace, _key, value) => { if (namespace === 'canonical-world.states') holder.value = structuredClone(value); } };
  // A state round trip itself must preserve the original consumed trial and
  // the stage versions; no new outcomes are admitted from retained counters.
  const reloaded = createPersistentWorld({ now: () => new Date(h.now()), timeMode: 'realtime', persistence }).get();
  assert.equal(roleStagesReadModel(reloaded).current.form.stage_id, stage.stage_id);
  assert.equal(practicalTrialReadModel(reloaded, { proposalId: h.proposal().proposal_id }).accepted_stage_id, stage.stage_id);
  assert.deepEqual(roleStageReadModel(reloaded, { proposalId: h.proposal().proposal_id }).primary_root_ids, stage.stage.primary_root_ids);
});

test('world mutations require the server adapter as well as the trusted source, and failed previews commit nothing', () => {
  const h = fixture(); h.complete();
  const states = new Map([['canonical-world.states', new Map([[h.w.world_id, structuredClone(h.w)]])]]);
  const persistence = { list: namespace => [...(states.get(namespace)?.values() ?? [])].map(value => structuredClone(value)),
    get: (namespace, key) => structuredClone(states.get(namespace)?.get(key)),
    put: (namespace, key, value) => { if (!states.has(namespace)) states.set(namespace, new Map()); states.get(namespace).set(key, structuredClone(value)); } };
  const world = createPersistentWorld({ now: () => new Date(h.now()), timeMode: 'realtime', persistence });
  const proposal = h.proposal(), preview = roleStagePreview(world.get(), { proposal, at: h.now() });
  const event = { event_id: 'world-stage-adopt', type: 'world.mutation', source: 'role-stage-engine', character_id: OWNER, occurred_at: h.now(),
    payload: { action: 'accept_role_stage', proposal_id: proposal.proposal_id, actor_id: OWNER, direction_id: proposal.direction_id,
      wish_basis: proposal.wish_basis, preview_fingerprint: preview.preview_fingerprint } };
  const before = world.get();
  assert.throws(() => world.ingest(event), { code: 'role_stage_requires_server_adapter', statusCode: 403 });
  assert.throws(() => world.ingest({ ...event, source: 'user' }, { roleStageInternal: true }), { code: 'role_stage_requires_server_adapter' });
  assert.deepEqual(world.get(), before); assert.equal(world.listMutations().length, 0);
  assert.throws(() => world.ingest({ ...event, payload: { ...event.payload, preview_fingerprint: 'old' } }, { roleStageInternal: true }), { code: 'role_stage_preview_stale' });
  assert.deepEqual(world.get(), before); assert.equal(world.listMutations().length, 0);
  const result = world.ingest(event, { roleStageInternal: true }); assert.equal(result.applied, true);
  assert.equal(result.mutation.details.stage.status, 'accepted'); assert.equal(world.listMutations().length, 1);
  assert.equal(world.ingest(event, { roleStageInternal: true }).duplicate, true); assert.equal(world.listMutations().length, 1);
  const stageId = result.mutation.details.stage_id;
  const rollback = { ...event, event_id: 'world-stage-back', payload: { action: 'rollback_role_stage', stage_id: stageId } };
  assert.throws(() => world.ingest(rollback), { code: 'role_stage_requires_server_adapter' });
  world.ingest(rollback, { roleStageInternal: true });
  assert.equal(roleStageReadModel(world.get(), { proposalId: proposal.proposal_id }).status, 'rolled_back');
  assert.equal(world.get().protagonist.appearance.role_stage, undefined);
});
