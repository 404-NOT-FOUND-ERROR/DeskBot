import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDeskBotServer } from '../src/app.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { installResidentLife } from '../src/resident-life.mjs';
import { installLivedMemory } from '../src/lived-memory.mjs';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { createAutonomousLife } from '../src/autonomous-life.mjs';
import { practicalTrialReadModel } from '../src/role-practical-trials.mjs';
import { OWNER, WISH_AT, readyWishWorld, wishRoot } from './support/role-wish-fixture.mjs';
import { listenOnFetchSafePort, closeTestServer } from './support/fetch-safe-server.mjs';

const namespaces = ['canonical-world.states', 'canonical-world.mutations', 'input.events', 'role.proposals', 'role.proposal-decisions', 'role.evolution-runs', 'role.evolution-candidates'];
const saved = persistence => namespaces.map(namespace => [namespace, persistence.list(namespace)]);
async function runtime(t) {
  mkdirSync(new URL('../../../tmp/', import.meta.url), { recursive: true });
  const filename = fileURLToPath(new URL(`../../../tmp/practical-http-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`, import.meta.url));
  let time = Date.parse(WISH_AT), persistence, world, roles, server, baseUrl;
  const now = () => new Date(time);
  async function open({ seed = false } = {}) {
    persistence = createSqlitePersistence({ filename, now });
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    if (seed) {
      const state = world.get(); installResidentLife(state, WISH_AT);
      installLivedMemory(state, '2026-10-06T00:00:00.000Z', { plannerEnabled: false });
      // These explicit canonical fixture roots test the API gates. Actual
      // role-trial results below come from original timed recipe execution.
      state.memory.development.records = readyWishWorld().memory.development.records;
      for (const actor of Object.values(state.autonomy.actors)) Object.assign(actor, { paused: true, energy: .8, appetite: .1 });
      state.autonomy.actors[OWNER].paused = false;
      state.protagonist.location_id = 'moss-sprout-garden';
      Object.assign(state.living.objects['garden-bed'], { health: .8, moisture: .55, growth: .3 });
      Object.assign(state.living.objects['seedling-rack'].stock, { trays: 2, seeds: 8, water: 12 });
      state.living.objects['shared-table'].stock.rations = 8;
      state.living.objects['trial-stove'].stock.water = 6;
      persistence.put('canonical-world.states', state.world_id, state);
      world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    }
    roles = createRoleProposalStore({ persistence, now });
    const listening = await listenOnFetchSafePort(() => createDeskBotServer({ now, persistence, persistentWorld: world,
      roleProposalStore: roles, websocket: false, timeMode: 'realtime' }));
    server = listening.server; baseUrl = listening.baseUrl;
  }
  await open({ seed: true });
  t.after(async () => { await closeTestServer(server); persistence.close(); });
  const h = {
    get server() { return server; }, get world() { return world; }, get roles() { return roles; }, get persistence() { return persistence; }, now,
    async restart() { await closeTestServer(server); persistence.close(); await open(); },
    advance(ms) { time += ms; world.syncWallClock(); world.syncTasks(); },
    elapseForRecovery(ms) { time += ms; },
    tick() { return createAutonomousLife({ world, now, enabled: true }).tick(); },
    async post(path, body = {}) { const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; },
    async get(path) { const response = await fetch(`${baseUrl}${path}`); return { status: response.status, body: await response.json() }; },
    proposal() { return roles.list().find(item => item.origin === 'lived_wish'); },
    async prepare() { const proposal = this.proposal(); assert.ok(proposal); const result = await this.post(`/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}/choose`, { choice: 'try' }); assert.equal(result.status, 202); return result.body.proposal; },
    action(id, operation, body) { return this.post(`/api/roles/proposals/${encodeURIComponent(id)}/practical-trial/${operation}`, body); },
  };
  return h;
}

test('prepared read projection discovers the pipeline without installing a trial or writing GET state', async t => {
  const h = await runtime(t), proposal = await h.prepare(), before = saved(h.persistence), world = h.world.get();
  for (let index = 0; index < 5; index++) {
    const detail = await h.get(`/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}`);
    assert.equal(detail.status, 200); assert.equal(detail.body.proposal.practical_trial_available, true);
    assert.equal(detail.body.proposal.practical_trial_connected, false); assert.equal(detail.body.proposal.practical_trial, null);
    const evolution = await h.get('/api/roles/evolution'); assert.equal(evolution.body.practical_trials.available, true);
  }
  assert.deepEqual(saved(h.persistence), before); assert.deepEqual(h.world.get(), world);
  assert.equal(h.world.get().practical_role_trials, undefined);
});

test('only a prepared saved wish can start, and public sources cannot forge execution, roots or effects', async t => {
  const h = await runtime(t), proposal = h.proposal(), id = proposal.proposal_id;
  const original = h.world.get();
  const early = await h.action(id, 'start'); assert.equal(early.status, 409); assert.equal(early.body.error, 'practical_trial_requires_prepared_wish');
  await h.prepare();
  for (const body of [{ activity_id: 'cook-moss' }, { root_outcome_ids: ['fiction'] }, { duration: 1 }, { status: 'review' }, { effects: { water: 100 } }, { actor_id: 'another-person' }]) {
    const response = await h.action(id, 'start', body); assert.equal(response.status, 400); assert.equal(response.body.error, 'invalid_practical_trial_request');
  }
  const forged = { event_id: 'forged-role-trial', type: 'world.mutation', source: 'role-practical-trial-engine', character_id: OWNER, occurred_at: WISH_AT,
    payload: { action: 'start_role_practical_trial', proposal_id: id, actor_id: OWNER, direction_id: 'wetland_frog', wish_basis: proposal.wish_basis } };
  const publicResult = await h.post('/api/event', forged); assert.equal(publicResult.status, 403);
  assert.throws(() => h.server.ingestNonChatEvent(forged), error => error.statusCode === 403 && error.code === 'practical_trial_requires_server_adapter');
  assert.deepEqual(h.world.get(), original); assert.equal(h.persistence.list('input.events').some(item => item.event.event_id === forged.event_id), false);
  assert.equal(h.roles.currentStages().length, 0);
});

test('start creates one canonical queued trial and immutable prepared wish; retries cannot reserve twice or change the variant', async t => {
  const h = await runtime(t), proposal = await h.prepare(), before = h.world.get(), basis = structuredClone(proposal.wish_basis);
  const started = await h.action(proposal.proposal_id, 'start'); assert.equal(started.status, 202);
  assert.equal(started.body.proposal.status, 'prepared'); assert.equal(started.body.proposal.practical_trial_connected, true);
  assert.equal(started.body.proposal.practical_trial_available, false); assert.equal(started.body.practical_trial.active_task, null);
  assert.deepEqual(started.body.practical_trial.progress.root_outcome_ids, []);
  const canonical = h.world.get(); assert.equal(Object.keys(canonical.practical_role_trials.trials).length, 1);
  assert.deepEqual(canonical.tasks, before.tasks); assert.deepEqual(canonical.living, before.living);
  assert.deepEqual(canonical.protagonist.appearance, before.protagonist.appearance); assert.deepEqual(h.roles.get(proposal.proposal_id).wish_basis, basis);
  const durable = saved(h.persistence), replay = await h.action(proposal.proposal_id, 'start');
  assert.equal(replay.status, 200); assert.equal(replay.body.duplicate, true); assert.deepEqual(h.world.get(), canonical); assert.deepEqual(saved(h.persistence), durable);
  const conflict = await h.action(proposal.proposal_id, 'start', { variant: 'waterside' }); assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'event_id_conflict');
  assert.deepEqual(h.world.get(), canonical); assert.equal(h.roles.get(proposal.proposal_id).trial, undefined);
  for (const oldPath of ['trial/start', 'trial/observations', 'trial/complete']) {
    const old = await h.post(`/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}/${oldPath}`, { event_id: 'fake-feedback', decision: 'accepted' });
    assert.equal(old.status, 409); assert.equal(old.body.error, 'practical_trial_not_connected');
  }
  assert.deepEqual(h.roles.currentStages(), []);
});

test('controls require pause before adjust, cannot orphan execution through archive, and exit preserves try with new-root cooldown', async t => {
  const h = await runtime(t), proposal = await h.prepare(); await h.action(proposal.proposal_id, 'start');
  const running = await h.action(proposal.proposal_id, 'adjust', { event_id: 'adjust-running', variant: 'waterside' });
  assert.equal(running.status, 409); assert.equal(running.body.error, 'practical_trial_pause_before_adjust');
  const archived = await h.post(`/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}/archive`);
  assert.equal(archived.status, 409); assert.equal(archived.body.error, 'practical_trial_requires_exit');
  const paused = await h.action(proposal.proposal_id, 'pause', { event_id: 'owner-pause' }); assert.equal(paused.status, 202); assert.equal(paused.body.practical_trial.status, 'paused');
  const pausedSnapshot = h.world.get(), duplicate = await h.action(proposal.proposal_id, 'pause', { event_id: 'owner-pause' });
  assert.equal(duplicate.status, 200); assert.deepEqual(h.world.get(), pausedSnapshot);
  const adjusted = await h.action(proposal.proposal_id, 'adjust', { event_id: 'owner-adjust', variant: 'waterside' });
  assert.equal(adjusted.status, 202); assert.equal(adjusted.body.practical_trial.variant_id, 'waterside');
  h.advance(120_000);
  const exited = await h.action(proposal.proposal_id, 'exit', { event_id: 'owner-exit', reason: '先做其他小事' }); assert.equal(exited.status, 202);
  assert.equal(exited.body.practical_trial.status, 'exited'); assert.equal(exited.body.proposal.status, 'withdrawn'); assert.equal(exited.body.proposal.user_choice, 'try');
  assert.deepEqual(exited.body.proposal.wish_basis, proposal.wish_basis);
  assert.equal(exited.body.proposal.cooldown_until, '2026-10-12T04:02:00.000Z');
  assert.equal(exited.body.proposal.withdrawal_reason, '先做其他小事');
  const after = saved(h.persistence), retry = await h.action(proposal.proposal_id, 'exit', { event_id: 'owner-exit', reason: '先做其他小事' }); assert.equal(retry.status, 200); assert.deepEqual(saved(h.persistence), after);
  assert.equal(h.roles.decisions({ proposalId: proposal.proposal_id }).length, 2);
  const direction = h.server.roleEvolution.wishView().directions.find(item => item.direction_id === 'wetland_frog');
  assert.equal(direction.proposal_gate.needs_new_actual_root, true); assert.ok(direction.proposal_gate.barriers.some(item => item.id === 'new_actual_outcome_required'));
  // The pure scheduling fixture distinguishes an outcome after original try
  // from one after exit. It does not write either fixture into the world.
  const withDatedRoot = at => ({ ...direction, basis: { ...direction.basis,
    root_outcome_ids: [...direction.basis.root_outcome_ids, 'task:counterexample-date'],
    root_outcomes: [...direction.basis.root_outcomes, { root_outcome_id: 'task:counterexample-date', at }] } });
  assert.equal(h.roles.wishGate(withDatedRoot('2026-10-09T04:01:00.000Z'), { characterId: OWNER, at: '2026-10-12T04:03:00.000Z' }).eligible, false);
  assert.equal(h.roles.wishGate(withDatedRoot('2026-10-09T04:02:01.000Z'), { characterId: OWNER, at: '2026-10-12T04:03:00.000Z' }).eligible, true);
  const resume = await h.action(proposal.proposal_id, 'resume', { event_id: 'resume-exited' }); assert.equal(resume.status, 409); assert.equal(resume.body.error, 'practical_trial_ended');
});

test('original life scheduling starts a real tagged recipe; ordinary task controls cannot freeze it and trial pause refunds once', async t => {
  const h = await runtime(t), proposal = await h.prepare(); await h.action(proposal.proposal_id, 'start'); h.tick();
  const state = h.world.get(), task = state.tasks.find(item => item.actor_id === OWNER && item.status === 'running');
  assert.ok(task?.role_trial, 'a ready authored candidate enters the original autonomous-life scheduler');
  assert.equal(task.activity_id, 'tend-bed'); assert.equal(task.role_trial.proposal_id, proposal.proposal_id);
  assert.equal(state.living.objects['seedling-rack'].stock.water, 11);
  for (const operation of ['pause', 'resume', 'cancel']) {
    const response = await h.post('/api/world/tasks', { event_id: `ordinary-${operation}-trial`, task_id: task.task_id, operation });
    assert.equal(response.status, 409); assert.equal(response.body.error, 'practical_trial_requires_trial_controls');
    assert.deepEqual(h.world.get(), state);
    assert.throws(() => h.world.ingest({ event_id: `internal-${operation}-trial`, type: 'world.mutation', source: 'ordinary-task-control',
      character_id: OWNER, occurred_at: WISH_AT, payload: { action: 'control_task', task_id: task.task_id, operation } }), error => error.code === 'practical_trial_requires_trial_controls');
  }
  const cancelled = await h.action(proposal.proposal_id, 'pause', { event_id: 'trial-pause-refund' }); assert.equal(cancelled.status, 202);
  assert.equal(h.world.get().tasks.find(item => item.task_id === task.task_id).status, 'cancelled');
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 12);
  const replay = await h.action(proposal.proposal_id, 'pause', { event_id: 'trial-pause-refund' }); assert.equal(replay.status, 200);
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 12);
  assert.equal(replay.body.practical_trial.progress.successful_primary, 0); assert.equal(replay.body.practical_trial.progress.cancelled, 1);
  h.advance(60_000); h.tick(); assert.ok(h.world.get().tasks.some(item => item.actor_id === OWNER && item.status === 'running' && !item.role_trial), 'ordinary life can continue after trial pause releases the actor');
});

test('SQLite restart preserves a real task deadline and same start event; elapsed time settles only the actual root', async t => {
  const h = await runtime(t), proposal = await h.prepare(); await h.action(proposal.proposal_id, 'start'); h.tick();
  const task = h.world.get().tasks.find(item => item.actor_id === OWNER && item.status === 'running'); assert.ok(task?.role_trial);
  const basis = structuredClone(proposal.wish_basis), oldTaskId = task.task_id, oldDeadline = task.due_at;
  await h.restart();
  const duplicate = await h.action(proposal.proposal_id, 'start'); assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.practical_trial.active_task.task_id, oldTaskId); assert.equal(duplicate.body.practical_trial.active_task.due_at, oldDeadline);
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water, 11);
  h.advance(Date.parse(oldDeadline) - h.now().getTime());
  const read = await h.get(`/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}`);
  assert.equal(read.body.proposal.practical_trial.progress.successful_primary, 1);
  assert.deepEqual(read.body.proposal.practical_trial.progress.root_outcome_ids, [`task:${oldTaskId}`]);
  assert.equal(read.body.proposal.practical_trial.review.ready, false); assert.equal(read.body.proposal.status, 'prepared');
  assert.deepEqual(h.roles.get(proposal.proposal_id).wish_basis, basis); assert.deepEqual(h.roles.currentStages(), []);
  const settled = h.world.get(); h.world.syncTasks(); assert.deepEqual(h.world.get(), settled);
});

test('queued trial waits for an existing ordinary task and owner pause never cancels another plan', async t => {
  const h = await runtime(t), proposal = await h.prepare();
  const ordinary = await h.post('/api/world/tasks', { event_id: 'ordinary-work-first', task_id: 'ordinary-work-first', kind: 'care', title: '正在整理眼前的小事', duration_seconds: 600 });
  assert.equal(ordinary.status, 202);
  const current = h.world.get().tasks.find(item => item.task_id === 'ordinary-work-first');
  const started = await h.action(proposal.proposal_id, 'start'); assert.equal(started.status, 202); assert.equal(started.body.practical_trial.status, 'blocked');
  assert.ok(started.body.practical_trial.blockers.some(item => item.code === 'actor_busy'));
  assert.deepEqual(h.world.get().tasks.find(item => item.task_id === current.task_id), current);
  const paused = await h.action(proposal.proposal_id, 'pause', { event_id: 'pause-while-ordinary' }); assert.equal(paused.status, 202);
  assert.deepEqual(h.world.get().tasks.find(item => item.task_id === current.task_id), current);
  const exited = await h.action(proposal.proposal_id, 'exit', { event_id: 'exit-while-ordinary' }); assert.equal(exited.status, 202);
  assert.deepEqual(h.world.get().tasks.find(item => item.task_id === current.task_id), current);
});

test('normal sync repairs an exit committed before owner lifecycle write, without replacing the original choice', async t => {
  const h = await runtime(t), proposal = await h.prepare(); await h.action(proposal.proposal_id, 'start');
  const trial = practicalTrialReadModel(h.world.get(), { proposalId: proposal.proposal_id });
  h.world.ingest({ event_id: 'crash-window-exit', type: 'world.mutation', source: 'role-practical-trial-engine', source_kind: 'world_engine',
    character_id: OWNER, occurred_at: WISH_AT, payload: { action: 'control_role_practical_trial', trial_id: trial.trial_id, operation: 'exit' } }, { rolePracticalInternal: true });
  assert.equal(h.roles.get(proposal.proposal_id).status, 'prepared');
  // An exit is canonical already. A fresh pure GET must not perform repair.
  const read = h.server.roleEvolution.wishProposal(proposal.proposal_id); assert.equal(read.practical_trial.status, 'exited'); assert.equal(h.roles.get(proposal.proposal_id).status, 'prepared');
  await h.restart(); assert.equal(h.roles.get(proposal.proposal_id).status, 'withdrawn');
  assert.equal(h.roles.get(proposal.proposal_id).user_choice, 'try'); assert.equal(h.roles.get(proposal.proposal_id).practical_trial_exit_event_id, 'crash-window-exit');
  const before = saved(h.persistence); h.server.roleEvolution.syncAll(); assert.deepEqual(saved(h.persistence), before);
  const direction = h.server.roleEvolution.wishView().directions.find(item => item.direction_id === 'wetland_frog');
  const fresh = { ...direction, basis: { ...direction.basis, root_outcome_ids: [...direction.basis.root_outcome_ids, 'task:new-after-exit'],
    root_outcomes: [...direction.basis.root_outcomes, { root_outcome_id: 'task:new-after-exit', at: '2026-10-12T04:00:01.000Z' }] } };
  assert.equal(h.roles.wishGate(fresh, { characterId: OWNER, at: '2026-10-12T04:01:00.000Z' }).eligible, true);
  assert.equal(h.roles.wishGate(direction, { characterId: OWNER, at: '2026-10-12T04:01:00.000Z' }).eligible, false);
});

test('delayed SQLite exit repair preserves post-exit evidence and the original cooldown deadline', async t => {
  const h = await runtime(t), proposal = await h.prepare(); await h.action(proposal.proposal_id, 'start');
  const trial = practicalTrialReadModel(h.world.get(), { proposalId: proposal.proposal_id });
  h.world.ingest({ event_id: 'delayed-crash-exit', type: 'world.mutation', source: 'role-practical-trial-engine', source_kind: 'world_engine',
    character_id: OWNER, occurred_at: WISH_AT, payload: { action: 'control_role_practical_trial', trial_id: trial.trial_id, operation: 'exit' } }, { rolePracticalInternal: true });
  const postExitId = 'task:actual-life-after-exit', state = h.world.get();
  // This recorded-root unit fixture represents ordinary life between a
  // canonical exit and delayed recovery; it is not a public forged task.
  state.memory.development.records.push(wishRoot('actual-life-after-exit', { at: '2026-10-10T04:00:00.000Z', activity: 'tend-bed' }));
  h.persistence.put('canonical-world.states', state.world_id, state);
  // Also reproduce a later cached direction refresh. Neither the latest
  // cache nor recovery-time roots may replace the decision-time baseline.
  const cached = h.roles.get(proposal.proposal_id); cached.current_root_outcome_ids.push(postExitId);
  h.persistence.put('role.proposals', proposal.proposal_id, cached);
  h.elapseForRecovery(4 * 24 * 3600_000); await h.restart();
  const repaired = h.roles.get(proposal.proposal_id);
  assert.equal(repaired.practical_trial_exited_at, WISH_AT); assert.equal(repaired.cooldown_until, '2026-10-12T04:00:00.000Z');
  assert.equal(repaired.reconsider_after_roots.includes(postExitId), false);
  assert.equal(repaired.user_choice, 'try'); assert.deepEqual(repaired.wish_basis, proposal.wish_basis);
  const renewed = h.roles.list().find(item => item.origin === 'lived_wish' && item.proposal_id !== proposal.proposal_id);
  assert.ok(renewed, 'startup may express a new wish after the original cooldown and genuinely later evidence');
  assert.ok(renewed.wish_basis.root_outcome_ids.includes(postExitId));
  const direction = h.server.roleEvolution.wishView().directions.find(item => item.direction_id === 'wetland_frog');
  // The scheduling policy is isolated from offline hunger/energy: actual
  // present-day readiness remains independently visible and must pass too.
  const policy = h.roles.wishGate({ ...direction, readiness: { eligible: true, barriers: [], checks: [] } },
    { characterId: OWNER, at: h.now(), excludeProposalId: renewed.proposal_id });
  assert.equal(policy.eligible, true, JSON.stringify(policy)); assert.ok(policy.new_actual_root_ids.includes(postExitId)); assert.equal(policy.cooldown_until, null);
  const before = saved(h.persistence); h.server.roleEvolution.syncAll(); assert.deepEqual(saved(h.persistence), before);
});
