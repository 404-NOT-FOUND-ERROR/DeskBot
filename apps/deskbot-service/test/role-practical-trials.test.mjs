import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { installLivedMemory, syncLivedMemory } from '../src/lived-memory.mjs';
import { syncDevelopmentEvidence } from '../src/development-evidence.mjs';
import { advanceAutonomousLife } from '../src/autonomous-life.mjs';
import { advanceLivingResources } from '../src/living-resources.mjs';
import { activeWorldTask, applyRealTimeClock, startActivityTask, advanceWorldTask, controlWorldTask } from '../src/realtime-world.mjs';
import { startPracticalTrial, controlPracticalTrial, settlePracticalTrials, practicalTrialCandidates,
  practicalTrialReadModel, practicalTrialsReadModel, safePracticalTrialMetadata } from '../src/role-practical-trials.mjs';

const OWNER = 'shaping-001', BASE = '2026-10-09T04:00:00.000Z', M = 60_000;
// Resource/need values are explicitly arranged test conditions. Every new trial
// outcome below comes from the original route, reservation and recipe engine.
function fixture({ direction = 'wetland_frog', variant, location = 'moss-sprout-garden', start = true } = {}) {
  const w = createPersistentWorld({ now: () => new Date(BASE), timeMode: 'realtime' }).get();
  installAutonomy(w, BASE); installLivedMemory(w, BASE);
  for (const state of Object.values(w.autonomy.actors)) state.paused = state.actor_id !== OWNER;
  w.protagonist.location_id = 'moss-sprout-garden';
  startActivityTask(w, { actor_id: OWNER, activity_id: 'tend-bed', task_id: 'prior-real-care' }, { eventId: 'prior-real-care', at: BASE });
  let time = Date.parse(BASE);
  function advance(ms) {
    const target = time + ms;
    for (let task; (task = w.tasks.filter(t => t.status === 'running' && Date.parse(t.due_at) <= target).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0]); ) {
      advanceLivingResources(w, task.due_at, { force: true });
      advanceWorldTask(w, { task_id: task.task_id, expected_task_revision: task.revision }, task.due_at);
    }
    time = target; advanceLivingResources(w, now(), { force: true }); applyRealTimeClock(w, now()); syncLivedMemory(w, now()); settlePracticalTrials(w, now());
  }
  const now = () => new Date(time).toISOString();
  advance(12 * M);
  w.protagonist.location_id = location;
  const state = w.autonomy.actors[OWNER];
  Object.assign(state, { energy: .88, appetite: .15, updated_at: now(), next_decision_at: now() });
  Object.assign(w.living.objects['garden-bed'], { health: .98, moisture: .58, growth: .2, quantity: 10 });
  Object.assign(w.living.objects['seedling-rack'].stock, { trays: 3, moss: 6, water: 12 });
  w.living.objects['shared-table'].stock.rations = 12;
  const basis = { root_outcome_ids: ['task:prior-real-care'] };
  let trialId = null;
  const h = { w, state: () => w.autonomy.actors[OWNER], now, advance, basis,
    start(options = {}) { const result = startPracticalTrial(w, { proposalId: 'real-life-wish', actorId: OWNER, directionId: direction, wishBasis: basis, at: now(), eventId: 'owner-start', variant, ...options }); trialId = result.trial_id; return result; },
    view() { return practicalTrialReadModel(w, { proposalId: 'real-life-wish', actorId: OWNER, at: now() }); },
    control(operation, more = {}) { return controlPracticalTrial(w, { trialId, operation, at: now(), eventId: `owner-${operation}:${now()}`, ...more }); },
    tick() { return advanceAutonomousLife(w, now(), { eventId: `life:${now()}` }); },
    run(minutes) { for (let i = 0; i < minutes; i++) { this.advance(M); this.tick(); } },
    untilPrimary() { for (let i = 0; i < 160; i++) { const current = activeWorldTask(w, OWNER); if (current?.role_trial?.step_role === 'primary') return current; this.tick(); this.advance(M); } assert.fail('Expected an actual primary task through ordinary autonomy'); },
  };
  if (start) h.start();
  return h;
}

test('starting queues a trial, reads are pure, and the real recipe gives exactly one common root', () => {
  const h = fixture();
  assert.equal(activeWorldTask(h.w, OWNER), null);
  assert.equal(h.view().progress.successful_primary, 0);
  const before = structuredClone(h.w); h.view(); practicalTrialsReadModel(h.w); practicalTrialCandidates(h.w, h.state(), h.now());
  assert.deepEqual(h.w, before);
  const task = h.untilPrimary();
  assert.equal(task.activity_id, 'tend-bed'); assert.equal(task.duration_ms, 12 * M);
  assert.equal(task.life_motivation.kind, 'self_continuation');
  assert.equal(h.w.living.objects['seedling-rack'].stock.water, 11);
  h.advance(Date.parse(task.due_at) - Date.parse(h.now()));
  const view = h.view(), root = `task:${task.task_id}`;
  assert.equal(view.progress.successful_primary, 1); assert.deepEqual(view.progress.root_outcome_ids, [root]);
  assert.equal(h.w.memory.development.records.filter(record => record.root_outcome_id === root).length, 1);
  assert.equal(h.w.memory.episodes.filter(episode => episode.root_outcome_id === root).length, 1);
  assert.equal(view.review.ready, false); assert.equal(view.review.preference_proven, false); assert.equal(view.review.changes_appearance, false);
  assert.equal(h.w.protagonist.appearance?.current_form?.id, before.protagonist.appearance?.current_form?.id);
  assert.deepEqual(h.start(), { trial_id: view.trial_id, duplicate: true, trial: h.view() });
  const settled = structuredClone(h.w); settlePracticalTrials(h.w, h.now()); assert.deepEqual(h.w, settled);
});

test('two actual successes on different Shanghai days reach review; the same day cannot grind more primary work', () => {
  const h = fixture(); const first = h.untilPrimary(); h.advance(Date.parse(first.due_at) - Date.parse(h.now()));
  h.tick(); assert.equal(h.view().blockers[0].code, 'daily_attempt_used');
  assert.deepEqual(practicalTrialCandidates(h.w, h.state(), h.now()), []);
  h.advance(24 * 60 * M);
  // A controlled next-day need/bed arrangement makes the opportunity explicit;
  // it does not claim naturally emergent interest or accelerate the world clock.
  Object.assign(h.state(), { energy: .85, appetite: .2, updated_at: h.now(), plan: null, next_decision_at: h.now() });
  Object.assign(h.w.living.objects['garden-bed'], { health: .98, moisture: .58, growth: .2, quantity: 10 });
  settlePracticalTrials(h.w, h.now());
  const second = h.untilPrimary(); h.advance(Date.parse(second.due_at) - Date.parse(h.now()));
  const view = h.view(); assert.equal(view.status, 'review'); assert.equal(view.progress.successful_primary, 2); assert.equal(view.progress.primary_days.length, 2);
  assert.equal(view.review.reason, 'repeated_actual_success'); assert.deepEqual(view.allowed_actions, ['adjust', 'exit']);
  assert.equal(practicalTrialCandidates(h.w, h.state(), h.now()).length, 0);
  // Continue the same finite method: accumulated facts survive, but they cannot
  // immediately satisfy a second review phase without new actual work.
  h.control('adjust', { variant: 'nursery' });
  assert.equal(h.view().progress.successful_primary, 2); assert.equal(h.view().review.ready, false);
  assert.equal(h.view().blockers[0].code, 'daily_attempt_used');
});

test('pause refunds only the owned task once, frees ordinary meals and prevents a same-day primary restart', () => {
  const h = fixture(); const task = h.untilPrimary(); const stock = h.w.living.objects['seedling-rack'].stock.water;
  assert.throws(() => h.control('adjust', { variant: 'waterside' }), { code: 'practical_trial_pause_before_adjust', statusCode: 409 });
  assert.deepEqual(h.view().allowed_actions, ['pause', 'exit']);
  h.control('pause'); syncLivedMemory(h.w, h.now()); settlePracticalTrials(h.w, h.now());
  assert.equal(h.w.tasks.find(t => t.task_id === task.task_id).status, 'cancelled');
  assert.equal(h.w.living.objects['seedling-rack'].stock.water, stock + 1); assert.equal(h.state().plan, null);
  const paused = structuredClone(h.w); h.control('pause'); assert.deepEqual(h.w, paused);
  assert.equal(h.view().progress.cancelled, 1); assert.equal(h.view().progress.successful_primary, 0);
  h.state().appetite = .8; h.tick();
  assert.equal(h.state().plan.goal, 'meal'); assert.equal(activeWorldTask(h.w, OWNER).role_trial, undefined);
  const meal = activeWorldTask(h.w, OWNER); h.advance(Date.parse(meal.due_at) - Date.parse(h.now()));
  // Ordinary travel may be the first step; follow the actual remaining meal.
  h.run(90); assert.ok(h.w.tasks.some(t => t.activity_id === 'share-meal' && t.status === 'completed'));
  assert.ok(h.state().appetite < .3); assert.equal(h.view().status, 'paused');
  h.control('resume'); assert.ok(h.view().blockers.some(b => b.code === 'daily_attempt_used' || b.code === 'actor_busy' || b.code === 'ordinary_plan_pending'));
  assert.equal(h.view().progress.successful_primary, 0);
});

test('retained generic task pause is repaired into release/refund and ordinary life really continues', () => {
  const h = fixture(); const task = h.untilPrimary();
  controlWorldTask(h.w, { task_id: task.task_id, operation: 'pause' }, h.now());
  assert.equal(activeWorldTask(h.w, OWNER).status, 'paused');
  settlePracticalTrials(h.w, h.now()); syncLivedMemory(h.w, h.now()); settlePracticalTrials(h.w, h.now());
  assert.equal(activeWorldTask(h.w, OWNER), null); assert.equal(h.view().status, 'paused');
  assert.equal(h.w.living.objects['seedling-rack'].stock.water, 12);
  h.state().appetite = .8; h.tick(); h.run(90);
  assert.ok(h.w.tasks.some(t => t.activity_id === 'share-meal' && t.status === 'completed'));
  assert.equal(h.view().progress.cancelled, 1); assert.equal(h.view().review.ready, false);
});

test('start never preempts ordinary work and pause or exit cannot cancel unrelated tasks', () => {
  const h = fixture({ start: false });
  startActivityTask(h.w, { actor_id: OWNER, kind: 'care', title: '已有的普通事务', task_id: 'ordinary', duration_seconds: 600 }, { eventId: 'ordinary', at: h.now() });
  h.start(); assert.equal(h.view().status, 'blocked'); assert.equal(h.view().blockers[0].code, 'actor_busy');
  assert.equal(activeWorldTask(h.w, OWNER).task_id, 'ordinary'); h.control('pause');
  assert.equal(activeWorldTask(h.w, OWNER).task_id, 'ordinary'); h.control('exit');
  assert.equal(activeWorldTask(h.w, OWNER).task_id, 'ordinary'); assert.equal(h.view().status, 'exited');
  assert.equal(h.view().exit_event_id, `owner-exit:${h.now()}`); assert.equal(h.view().ended_at, h.now());
});

test('hunger and night win over trial opportunities; no inventory or routes are invented', () => {
  const h = fixture(); h.state().appetite = .85; assert.deepEqual(practicalTrialCandidates(h.w, h.state(), h.now()), []);
  h.tick(); assert.equal(h.state().plan.goal, 'meal');
  h.control('pause'); // Ordinary work is preserved, then finished through real time.
  h.run(40); h.control('resume');
  h.advance(12 * 60 * M); h.state().plan = null; h.state().next_decision_at = h.now();
  assert.ok(h.view().blockers.some(b => b.code === 'needs_first'));
  h.tick(); assert.equal(h.state().plan.goal, 'rest');
  const missing = fixture({ direction: 'workshop_maker', location: 'spare-parts-house' });
  missing.w.living.objects['parts-drawers'].stock.wood = 0; missing.w.living.objects['parts-drawers'].stock.fasteners = 0;
  const before = structuredClone(missing.w.living); assert.equal(practicalTrialCandidates(missing.w, missing.state(), missing.now()).length, 0);
  assert.deepEqual(missing.w.living, before); assert.ok(missing.view().blockers.some(b => b.code === 'activity_conditions_unavailable'));
  const closed = fixture({ location: 'shaping-field-desk' });
  for (const passage of closed.w.map_catalog.passages) closed.w.passage_states[passage.passage_id] = { status: 'closed', reason: 'controlled closure' };
  const state = structuredClone(closed.w); assert.equal(practicalTrialCandidates(closed.w, closed.state(), closed.now()).length, 0);
  assert.deepEqual(closed.w, state); assert.equal(closed.view().progress.successful_primary, 0);
});

test('a failed actual crop condition refunds materials and is neither performance nor dislike', () => {
  const h = fixture(); const task = h.untilPrimary(); h.w.living.objects['garden-bed'].quantity = 0;
  h.advance(Date.parse(task.due_at) - Date.parse(h.now()));
  assert.equal(h.w.tasks.find(t => t.task_id === task.task_id).status, 'failed'); assert.equal(h.w.living.objects['seedling-rack'].stock.water, 12);
  const view = h.view(); assert.equal(view.progress.condition_failures, 1); assert.equal(view.progress.performance_failures, 0); assert.equal(view.progress.unknown_failures, 0);
  assert.equal(view.review.ready, false); assert.equal(view.review.preference_proven, false); assert.equal(view.outcomes[0].classification, 'condition');
});

test('actual support work is archived but never becomes primary success or a review', () => {
  const h = fixture({ direction: 'workshop_maker', variant: 'repair', location: 'spare-parts-house' });
  h.w.living.objects['floating-frame'].condition = .6;
  h.tick(); assert.equal(h.state().plan.role_trial.trial_id, h.view().trial_id);
  const first = activeWorldTask(h.w, OWNER); assert.equal(first.activity_id, 'craft-frame-kit'); assert.equal(first.role_trial.step_role, 'support');
  h.advance(Date.parse(first.due_at) - Date.parse(h.now()));
  assert.equal(h.view().progress.successful_primary, 0); assert.deepEqual(h.view().progress.support_roots, [`task:${first.task_id}`]);
  assert.equal(h.view().progress.started_attempts, 0); assert.equal(h.view().review.ready, false);
  assert.equal(h.w.living.objects['parts-drawers'].stock.wood, 6);
  const primary = h.untilPrimary(); assert.equal(primary.activity_id, 'repair-frame');
  h.advance(Date.parse(primary.due_at) - Date.parse(h.now())); assert.equal(h.view().progress.successful_primary, 1);
  assert.equal(h.w.living.inventories[OWNER].stock.frame_kit, 0);
});

test('chef uses the real chosen recipe and existing food; adjustment keeps facts but begins a fresh review window', () => {
  const h = fixture({ direction: 'chef', location: 'warm-pot-courtyard' });
  const first = h.untilPrimary(); assert.equal(first.activity_id, 'cook-moss');
  h.advance(Date.parse(first.due_at) - Date.parse(h.now()));
  assert.equal(h.view().axis, 'vocation'); assert.equal(h.view().progress.successful_primary, 1); assert.equal(h.w.living.inventories[OWNER].stock.rations, 2);
  h.control('pause'); h.control('adjust', { variant: 'stew' });
  assert.equal(h.view().variant_id, 'stew'); assert.equal(h.view().progress.successful_primary, 1); assert.equal(h.view().review.ready, false);
  assert.throws(() => h.control('adjust', { variant: 'invented' }), { code: 'practical_trial_pause_before_adjust' });
  h.control('pause'); assert.throws(() => h.control('adjust', { variant: 'invented' }), { code: 'practical_trial_variant_unknown' });
});

test('canonical trial links survive task pruning, archive rebuilding and serialization without double credit', () => {
  const h = fixture(); const task = h.untilPrimary(); h.advance(Date.parse(task.due_at) - Date.parse(h.now()));
  const root = `task:${task.task_id}`, before = h.view();
  assert.ok(h.w.memory.episodes.find(episode => episode.root_outcome_id === root).source.role_trial);
  h.w.tasks = h.w.tasks.filter(t => t.task_id !== task.task_id);
  h.w.memory.development.records = h.w.memory.development.records.filter(record => record.root_outcome_id !== root);
  syncDevelopmentEvidence(h.w, h.now()); assert.equal(h.w.memory.development.records.find(record => record.root_outcome_id === root).source.role_trial.trial_id, before.trial_id);
  settlePracticalTrials(h.w, h.now());
  const restart = JSON.parse(JSON.stringify(h.w)); syncLivedMemory(restart, h.now()); settlePracticalTrials(restart, h.now());
  assert.equal(practicalTrialReadModel(restart, { proposalId: 'real-life-wish', at: h.now() }).progress.successful_primary, 1);
  assert.equal(restart.memory.development.records.filter(record => record.root_outcome_id === root).length, 1);
  assert.equal(restart.protagonist.character_id, OWNER);
  const steady = structuredClone(restart); settlePracticalTrials(restart, h.now()); assert.deepEqual(restart, steady);
});

test('unknown worlds, unknown directions, other actors and future/forged result roots cannot qualify', () => {
  const old = { protagonist: { character_id: OWNER }, tasks: [] }, before = structuredClone(old);
  assert.equal(practicalTrialReadModel(old, { proposalId: 'missing' }), null); assert.equal(practicalTrialsReadModel(old).enabled, false); assert.deepEqual(old, before);
  const h = fixture({ start: false });
  assert.throws(() => h.start({ directionId: 'starry_tinkerer' }), { code: 'practical_trial_direction_unavailable' });
  assert.throws(() => h.start({ actorId: 'outside' }), { code: 'practical_trial_actor_unknown' });
  assert.throws(() => h.start({ wishBasis: { root_outcome_ids: ['task:future'] } }), { code: 'practical_trial_wish_basis_invalid' });
  assert.equal(safePracticalTrialMetadata({ direction_id: 'wetland_frog', axis: 'vocation', step_role: 'primary', primary_activity_id: 'cook-moss' }), null);
  h.start(); const task = h.untilPrimary(); h.advance(Date.parse(task.due_at) - Date.parse(h.now()));
  const raw = h.w.practical_role_trials.trials[h.view().trial_id], original = h.w.memory.development.records.find(record => record.root_outcome_id === `task:${task.task_id}`);
  raw.outcomes = [];
  h.w.memory.development.records.push({ ...structuredClone(original), root_outcome_id: 'task:forged-unadmitted' },
    { ...structuredClone(original), actor_ids: ['outside'], root_outcome_id: 'task:other-actor' },
    { ...structuredClone(original), at: '2030-01-01T00:00:00.000Z', root_outcome_id: 'task:future' });
  settlePracticalTrials(h.w, h.now()); assert.equal(h.view().progress.successful_primary, 1); assert.equal(h.view().outcomes.length, 1);
  assert.equal(practicalTrialReadModel(h.w, { proposalId: 'real-life-wish', actorId: 'outside', at: h.now() }), null);
  assert.throws(() => h.start({ directionId: 'chef' }), { code: 'practical_trial_identity_conflict' });
});

test('unknown retained failure classification leads to cautious review, without inferred performance or preference', () => {
  const h = fixture();
  for (let day = 0; day < 2; day++) {
    if (day) {
      h.advance(24 * 60 * M); Object.assign(h.state(), { energy: .85, appetite: .2, updated_at: h.now(), plan: null, next_decision_at: h.now() });
      Object.assign(h.w.living.objects['garden-bed'], { quantity: 10, health: .98, moisture: .58, growth: .2 });
    }
    const task = h.untilPrimary(); h.w.living.objects['garden-bed'].quantity = 0;
    h.advance(Date.parse(task.due_at) - Date.parse(h.now()));
    // Restore a legacy serialization which kept the real failed task/root but
    // lost the classifier. This checks migration ambiguity, not a new outcome.
    delete h.w.tasks.find(t => t.task_id === task.task_id).failure_classification;
    delete h.w.memory.episodes.find(e => e.root_outcome_id === `task:${task.task_id}`).source.failure_classification;
    h.w.memory.development.records = h.w.memory.development.records.filter(r => r.root_outcome_id !== `task:${task.task_id}`);
    h.w.practical_role_trials.trials[h.view().trial_id].outcomes = h.w.practical_role_trials.trials[h.view().trial_id].outcomes.filter(r => r.root_outcome_id !== `task:${task.task_id}`);
    syncDevelopmentEvidence(h.w, h.now()); settlePracticalTrials(h.w, h.now());
  }
  const view = h.view(); assert.equal(view.progress.unknown_failures, 2); assert.equal(view.progress.performance_failures, 0);
  assert.equal(view.status, 'review'); assert.equal(view.review.reason, 'execution_difficulties');
  assert.equal(view.review.preference_proven, false); assert.equal(view.review.qualification_proven, false); assert.equal(view.review.quality_proven, false);
});

test('trial settlement does not write timestamps or revisions on ordinary seconds when facts and gates are unchanged', () => {
  const h = fixture(); settlePracticalTrials(h.w, h.now()); const before = structuredClone(h.w.practical_role_trials);
  const fingerprint = h.view().fingerprint;
  settlePracticalTrials(h.w, new Date(Date.parse(h.now()) + 1000).toISOString());
  settlePracticalTrials(h.w, new Date(Date.parse(h.now()) + 2000).toISOString());
  assert.deepEqual(h.w.practical_role_trials, before);
  assert.equal(practicalTrialReadModel(h.w, { proposalId: 'real-life-wish', at: new Date(Date.parse(h.now()) + 2000).toISOString() }).fingerprint, fingerprint);
});
