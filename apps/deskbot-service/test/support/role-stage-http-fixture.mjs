import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDeskBotServer } from '../../src/app.mjs';
import { createPersistentWorld } from '../../src/persistent-world.mjs';
import { createSqlitePersistence } from '../../src/persistence.mjs';
import { installResidentLife } from '../../src/resident-life.mjs';
import { installLivedMemory } from '../../src/lived-memory.mjs';
import { createRoleProposalStore } from '../../src/role-proposals.mjs';
import { createAutonomousLife } from '../../src/autonomous-life.mjs';
import { practicalTrialReadModel } from '../../src/role-practical-trials.mjs';
import { findWorldPath } from '../../src/world-map-content.mjs';
import { OWNER, WISH_AT, readyWishWorld } from './role-wish-fixture.mjs';
import { listenOnFetchSafePort, closeTestServer } from './fetch-safe-server.mjs';

export const stageSavedNamespaces = ['canonical-world.states', 'canonical-world.mutations', 'input.events', 'role.proposals',
  'role.proposal-decisions', 'role.evolution-runs', 'role.evolution-candidates'];
export const stageSaved = persistence => stageSavedNamespaces.map(namespace => [namespace, persistence.list(namespace)]);

// Prior wish prerequisites are explicit recorded-root unit fixtures. New
// trial successes are timed original recipes admitted by ordinary autonomy;
// no completed result or acceptance is inserted into this fixture.
export async function roleStageHttpFixture(t, { seedWorld = null, seedProposals = [], developmentRecords = null, at = seedWorld?.clock?.synced_at ?? WISH_AT } = {}) {
  mkdirSync(new URL('../../../../tmp/', import.meta.url), { recursive: true });
  const filename = fileURLToPath(new URL(`../../../../tmp/stage-http-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`, import.meta.url));
  let time = Date.parse(at), persistence, world, roles, server, baseUrl;
  const now = () => new Date(time);
  async function open({ seed = false } = {}) {
    persistence = createSqlitePersistence({ filename, now });
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    if (seed) {
      const state = seedWorld ? structuredClone(seedWorld) : world.get();
      if (!seedWorld) { installResidentLife(state, WISH_AT);
      installLivedMemory(state, '2026-10-06T00:00:00.000Z', { plannerEnabled: false });
      state.memory.development.records = developmentRecords ?? readyWishWorld({ chef: true }).memory.development.records;
      for (const actor of Object.values(state.autonomy.actors)) Object.assign(actor, { paused: true, energy: .8, appetite: .1 });
      state.autonomy.actors[OWNER].paused = false;
      state.protagonist.location_id = 'moss-sprout-garden';
      Object.assign(state.living.objects['garden-bed'], { health: .98, moisture: .55, growth: .3 });
      Object.assign(state.living.objects['seedling-rack'].stock, { trays: 2, seeds: 8, water: 12 });
      state.living.objects['shared-table'].stock.rations = 8;
      state.living.objects['trial-stove'].stock.water = 6;
      state.living.inventories[OWNER] = { stock: { moss: 5, light_fruit: 4 }, capacity: 24 };
      }
      persistence.put('canonical-world.states', state.world_id, state);
      for (const proposal of seedProposals) persistence.put('role.proposals', proposal.proposal_id, proposal);
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
    advance(ms) { time += ms; for (let guard = 0; guard < 1000 && Date.parse(world.get().clock.synced_at) < time; guard++) world.syncWallClock({ maxCatchUpMinutes: 120 }); world.syncTasks(); },
    elapse(ms) { time += ms; },
    tick() { return createAutonomousLife({ world, now, enabled: true }).tick(); },
    async arrange(edit) { const state = world.get(); edit(state); persistence.put('canonical-world.states', state.world_id, state); await this.restart(); },
    async post(path, body = {}) { const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; },
    async get(path) { const response = await fetch(`${baseUrl}${path}`); return { status: response.status, body: await response.json() }; },
    proposal(direction = 'wetland_frog') { return roles.list().find(item => item.origin === 'lived_wish' && item.direction_id === direction); },
    async prepare(direction = 'wetland_frog') {
      let proposal = this.proposal(direction);
      if (!proposal) { const made = await this.post('/api/roles/proposals', { character_id: OWNER, direction_id: direction }); assert.ok([201, 200].includes(made.status), JSON.stringify(made)); proposal = made.body.proposal; }
      const result = await this.post(`/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}/choose`, { choice: 'try' });
      assert.equal(result.status, 202, JSON.stringify({ result, readiness: server.roleEvolution.wishView().directions.find(item => item.direction_id === direction)?.readiness })); return result.body.proposal;
    },
    trialAction(id, operation, body = {}) { return this.post(`/api/roles/proposals/${encodeURIComponent(id)}/practical-trial/${operation}`, body); },
    stageAction(id, operation, body) { return this.post(`/api/roles/proposals/${encodeURIComponent(id)}/stage/${operation}`, body); },
    async preview(id) { const result = await this.get(`/api/roles/proposals/${encodeURIComponent(id)}/stage/preview`); assert.equal(result.status, 200); return result.body.preview; },
    view(id) { return practicalTrialReadModel(world.get(), { proposalId: id, actorId: OWNER, at: now().toISOString() }); },
    untilPrimary() {
      for (let i = 0; i < 180; i++) {
        const current = world.get().tasks.find(task => task.actor_id === OWNER && task.status === 'running');
        if (current?.role_trial?.step_role === 'primary') return current;
        this.tick(); this.advance(60_000);
      }
      assert.fail('Expected actual primary role recipe through ordinary autonomy');
    },
    async actualTravel(locationId) {
      if (world.get().protagonist.location_id !== locationId) {
        const path = findWorldPath(world.get(), world.get().protagonist.location_id, locationId); assert.ok(path?.[1]);
        const travel = await this.post('/api/world/travel', { event_id: `stage-test-travel:${locationId}:${now().toISOString()}`, location_id: path[1], destination_location_id: locationId });
        assert.equal(travel.status, 202, JSON.stringify(travel));
        for (let i = 0; i < 40; i++) {
          const current = world.get().tasks.find(task => task.actor_id === OWNER && task.status === 'running');
          if (!current) break;
          this.advance(Date.parse(current.due_at) - now().getTime());
        }
        assert.equal(world.get().protagonist.location_id, locationId);
      }
    },
    async actualActivity(activityId, locationId) {
      await this.actualTravel(locationId);
      const result = await this.post('/api/world/tasks', { event_id: `stage-test-activity:${activityId}:${now().toISOString()}`, activity_id: activityId });
      assert.equal(result.status, 202, JSON.stringify(result));
      const task = world.get().tasks.find(item => item.actor_id === OWNER && item.status === 'running');
      assert.equal(task.activity_id, activityId); this.advance(Date.parse(task.due_at) - now().getTime());
      assert.equal(world.get().tasks.find(item => item.task_id === task.task_id).status, 'completed'); return task;
    },
    async actualReview(direction = 'wetland_frog', { variant } = {}) {
      const proposal = await this.prepare(direction), started = await this.trialAction(proposal.proposal_id, 'start', variant ? { variant } : {});
      assert.equal(started.status, 202, JSON.stringify(started));
      if (direction === 'chef') { await this.actualTravel('warm-pot-courtyard'); await this.arrange(state => {
        Object.assign(state.autonomy.actors[OWNER], { energy: .85, appetite: .1, updated_at: now().toISOString(), next_decision_at: now().toISOString(), plan: null }); }); }
      const first = this.untilPrimary(); this.advance(Date.parse(first.due_at) - now().getTime());
      assert.equal(this.view(proposal.proposal_id).progress.successful_primary, 1);
      this.advance(24 * 3600_000);
      // Conditions for the next opportunity are deliberately arranged. They
      // do not credit a task, refill its reserved resources or prove liking.
      await this.arrange(state => {
        Object.assign(state.autonomy.actors[OWNER], { energy: .85, appetite: .1, updated_at: now().toISOString(), next_decision_at: now().toISOString(), plan: null });
        Object.assign(state.living.objects['garden-bed'], { health: .98, moisture: .55, growth: .3 });
      });
      const second = this.untilPrimary(); this.advance(Date.parse(second.due_at) - now().getTime());
      assert.equal(this.view(proposal.proposal_id).review.reason, 'repeated_actual_success');
      return { proposal, first, second };
    },
  };
  return h;
}
