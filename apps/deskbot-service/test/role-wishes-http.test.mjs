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
import { createRoleEvolution } from '../src/role-evolution.mjs';
import { computeFantasyPull } from '../src/fantasy-pull.mjs';
import { OWNER, WISH_AT, readyWishWorld } from './support/role-wish-fixture.mjs';
import { listenOnFetchSafePort, closeTestServer } from './support/fetch-safe-server.mjs';

const now = () => new Date(WISH_AT);
function database(label) {
  mkdirSync(new URL('../../../tmp/', import.meta.url), { recursive: true });
  return fileURLToPath(new URL(`../../../tmp/role-wish-http-${label}-${process.pid}-${Date.now()}.sqlite`, import.meta.url));
}
function seed(persistence, ready = true) {
  const persistentWorld = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
  const state = persistentWorld.get(); installResidentLife(state, now().toISOString()); installLivedMemory(state, '2026-10-06T00:00:00.000Z', { plannerEnabled: false });
  for (const actor of Object.values(state.autonomy.actors)) actor.paused = true;
  Object.assign(state.autonomy.actors[OWNER], { paused: false, energy: .8, appetite: .1 });
  if (ready) state.memory.development.records = readyWishWorld().memory.development.records;
  persistence.put('canonical-world.states', state.world_id, state);
  return createPersistentWorld({ persistence, now, timeMode: 'realtime' });
}
async function runtime(t, { ready = true } = {}) {
  const persistence = createSqlitePersistence({ filename: database(ready ? 'ready' : 'contact'), now });
  let server; t.after(async () => { await closeTestServer(server); persistence.close(); });
  const persistentWorld = seed(persistence, ready);
  const roles = createRoleProposalStore({ persistence, now });
  const listening = await listenOnFetchSafePort(() => createDeskBotServer({ now, persistence, persistentWorld, roleProposalStore: roles, websocket: false, timeMode: 'realtime' }));
  server = listening.server;
  const post = async (path, body = {}) => {
    const response = await fetch(`${listening.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const get = path => fetch(`${listening.baseUrl}${path}`).then(response => response.json());
  return { persistence, server, roles, persistentWorld, post, get };
}
const roleRecords = persistence => ['role.proposals', 'role.proposal-decisions', 'role.evolution-candidates', 'role.evolution-runs', 'role.evidence', 'role.pulls', 'role.evolution-cooldowns']
  .map(namespace => [namespace, persistence.list(namespace)]);

test('installed facets block manual keyword proposals and caller-supplied gate or role state', async t => {
  const h = await runtime(t, { ready: false });
  h.server.ingestNonChatEvent({ event_id: 'weather', type: 'weather.observation', layer: 'weather', character_id: OWNER, occurred_at: WISH_AT,
    source: 'test-weather', payload: { text: '池塘荷叶青蛙连续下雨，应该成为青蛙' } });
  for (const directionId of ['wetland_frog', 'chef', 'unknown']) {
    const result = await h.post('/api/roles/proposals', { character_id: OWNER, direction_id: directionId,
      origin: 'lived_wish', status: 'accepted', readiness: { eligible: true }, wish_basis: { root_outcome_ids: ['caller-fiction'] } });
    assert.equal(result.status, 409); assert.equal(result.body.error, 'role_wish_not_ready');
  }
  assert.equal(h.roles.list().length, 0); assert.equal(h.roles.currentStages().length, 0);
  const read = await h.get('/api/roles/evolution'); assert.equal(read.wishes.enabled, true);
  assert.ok(read.wishes.directions.every(direction => !direction.readiness.eligible));
});

test('unstarted legacy drafts cannot bypass actual prerequisites through choose or dialogue trial endpoints', async t => {
  const h = await runtime(t), legacyPull = { status: 'candidate', direction_id: 'wetland_frog', label: '旧青蛙草稿', life: '旧输入线索', fantasy_pull: .9, evidence_ids: ['legacy-word'] };
  const draft = h.roles.propose(legacyPull, { characterId: OWNER, proposalId: 'imported-legacy-draft' });
  const oldTrying = h.roles.propose(legacyPull, { characterId: OWNER, proposalId: 'imported-legacy-trying' });
  // This is a restored old decision with no started trial, not a new API path.
  h.roles.choose(oldTrying.proposal_id, 'try');
  const before = h.persistentWorld.get();
  for (const proposal of [draft, oldTrying]) {
    const id = encodeURIComponent(proposal.proposal_id);
    for (const path of ['choose', 'trial/start']) {
      const attempt = await h.post(`/api/roles/proposals/${id}/${path}`, { choice: 'try', window_turns: 1 });
      assert.equal(attempt.status, 409); assert.equal(attempt.body.error, 'legacy_role_trial_requires_lived_wish');
    }
    assert.equal(h.roles.get(proposal.proposal_id).trial == null, true);
    const reused = await h.post('/api/roles/proposals', { character_id: OWNER, direction_id: 'wetland_frog', proposal_id: proposal.proposal_id });
    assert.equal(reused.status, 409); assert.equal(reused.body.error, 'role_wish_proposal_conflict');
  }
  const later = await h.post(`/api/roles/proposals/${draft.proposal_id}/choose`, { choice: 'later' });
  assert.equal(later.status, 202); assert.equal(later.body.proposal.status, 'deferred');
  const retry = await h.post(`/api/roles/proposals/${draft.proposal_id}/choose`, { choice: 'try' });
  assert.equal(retry.status, 409); assert.equal(retry.body.error, 'legacy_role_trial_requires_lived_wish');
  const archived = await h.post(`/api/roles/proposals/${oldTrying.proposal_id}/archive`, {});
  assert.equal(archived.status, 202); assert.equal(archived.body.proposal.status, 'archived');
  assert.deepEqual(h.roles.activeTrials(), []); assert.deepEqual(h.roles.currentStages(), []);
  assert.deepEqual(h.persistentWorld.get(), before);
});

test('a genuinely started legacy trial and accepted history remain compatible after facets installation', async t => {
  const h = await runtime(t);
  const old = h.roles.propose({ status: 'candidate', direction_id: 'wetland_frog', label: '已经试用的旧方向', life: '旧生活试行', fantasy_pull: .8, evidence_ids: ['legacy-root'] }, { characterId: OWNER, proposalId: 'imported-started-trial' });
  // The trusted fixture restores a trial that had already begun; this does
  // not grant the API permission to start an imported unstarted draft.
  h.roles.choose(old.proposal_id, 'try'); h.roles.startTrial(old.proposal_id, { windowTurns: 1 });
  const restarted = await h.post(`/api/roles/proposals/${old.proposal_id}/trial/start`, {});
  assert.equal(restarted.status, 202); assert.ok(restarted.body.proposal.trial.started_at);
  const feedback = await h.post(`/api/roles/proposals/${old.proposal_id}/trial/observations`, { event_id: 'legacy-confirmation', signal: 'neutral' });
  assert.equal(feedback.status, 202); assert.equal(feedback.body.proposal.trial.status, 'completed');
  const accepted = await h.post(`/api/roles/proposals/${old.proposal_id}/trial/complete`, { decision: 'accepted' });
  assert.equal(accepted.status, 202); assert.equal(accepted.body.proposal.status, 'accepted');
  assert.equal(h.roles.currentStages({ characterId: OWNER })[0].proposal_id, old.proposal_id);
  assert.equal(h.roles.get(old.proposal_id).origin, undefined);
});

test('HTTP prepared wish cannot use dialogue trials, accept appearance or affect the original world', async t => {
  const h = await runtime(t), proposal = h.roles.list().find(item => item.origin === 'lived_wish'); assert.ok(proposal);
  const before = h.persistentWorld.get(), id = encodeURIComponent(proposal.proposal_id);
  const chosen = await h.post(`/api/roles/proposals/${id}/choose`, { choice: 'try', reason: '愿意陪你尝试，但没有进行实践' });
  assert.equal(chosen.status, 202); assert.equal(chosen.body.proposal.status, 'prepared'); assert.equal(chosen.body.proposal.trial, undefined);
  for (const path of ['trial/start', 'trial/observations', 'trial/complete']) {
    const attempt = await h.post(`/api/roles/proposals/${id}/${path}`, { event_id: 'fake-feedback', decision: 'accepted' });
    assert.equal(attempt.status, 409); assert.equal(attempt.body.error, 'practical_trial_not_connected');
  }
  assert.deepEqual(h.persistentWorld.get(), before);
  const chat = await h.post('/api/chat', { event_id: 'prepared-chat', character_id: OWNER, message: '你现在已经变成青蛙了吗？' });
  assert.equal(chat.status, 202); assert.deepEqual(chat.body.turn.active_role_trials, []);
  assert.match(chat.body.turn.prompt.text, /DESKBOT_LIVED_ROLE_WISHES/); assert.match(chat.body.turn.prompt.text, /"status":"prepared"/);
  assert.match(chat.body.turn.prompt.text, /尚未开始实际试做|当前没有试做结果|尚无实际试做记录/);
  assert.equal(chat.body.turn.expression_intent.role_trial == null, true);
  assert.deepEqual(h.roles.currentStages(), []); assert.equal(h.roles.get(proposal.proposal_id).status, 'prepared');
  assert.deepEqual(h.persistentWorld.get().protagonist.appearance, before.protagonist.appearance);
  assert.deepEqual(h.persistentWorld.get().protagonist.character_profile, before.protagonist.character_profile);
});

test('GET projects current blocked conditions without recording decisions or writing lifecycle state', async t => {
  const h = await runtime(t), proposal = h.roles.list().find(item => item.origin === 'lived_wish'), state = h.persistentWorld.get();
  state.autonomy.actors[OWNER].energy = .1; h.persistence.put('canonical-world.states', state.world_id, state);
  // Replace the in-process snapshot via a fresh runtime, without running its
  // mutation/sync loop, so this specifically tests GET read projections.
  const readWorld = createPersistentWorld({ persistence: h.persistence, now, timeMode: 'realtime' });
  const pureEvolution = createRoleEvolution({ roles: h.roles, persistence: h.persistence, now, inputStore: { list: () => [] }, computeFantasyPull, worldSnapshot: () => readWorld.get() });
  const stored = roleRecords(h.persistence), before = readWorld.get();
  for (let i = 0; i < 10; i++) {
    assert.equal(pureEvolution.wishProposal(proposal.proposal_id).current_gate.eligible, false);
    assert.equal(pureEvolution.snapshot().wishes.directions[0].readiness.eligible, false);
  }
  assert.deepEqual(roleRecords(h.persistence), stored); assert.deepEqual(readWorld.get(), before);
  assert.equal(h.roles.get(proposal.proposal_id).current_gate.eligible, true, 'pure projection did not persist the changed gate');
  assert.throws(() => pureEvolution.chooseWish(proposal.proposal_id, 'try'), error => error.code === 'role_wish_not_ready');
  assert.equal(h.roles.decisions().length, 0); assert.equal(h.roles.get(proposal.proposal_id).status, 'deferred');
});

test('SQLite close and reopen preserves a prepared ID, immutable basis and idempotent rule run', () => {
  const filename = database('restart'); let persistence = createSqlitePersistence({ filename, now });
  try {
    let world = seed(persistence), roles = createRoleProposalStore({ persistence, now });
    let evolution = createRoleEvolution({ roles, persistence, now, inputStore: { list: () => [] }, computeFantasyPull, worldSnapshot: () => world.get() });
    const proposal = evolution.sync().created[0]; assert.ok(proposal); evolution.chooseWish(proposal.proposal_id, 'try'); evolution.sync();
    const before = roleRecords(persistence), basis = structuredClone(proposal.wish_basis), identity = world.get().protagonist.character_id;
    persistence.close(); persistence = createSqlitePersistence({ filename, now }); world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    roles = createRoleProposalStore({ persistence, now }); evolution = createRoleEvolution({ roles, persistence, now, inputStore: { list: () => [] }, computeFantasyPull, worldSnapshot: () => world.get() });
    assert.equal(evolution.sync().duplicate, true); assert.deepEqual(roleRecords(persistence), before);
    assert.equal(roles.get(proposal.proposal_id).status, 'prepared'); assert.deepEqual(roles.get(proposal.proposal_id).wish_basis, basis);
    assert.equal(roles.decisions().length, 1); assert.equal(world.get().protagonist.character_id, identity); assert.deepEqual(roles.activeTrials(), []);
  } finally { persistence.close(); }
});
