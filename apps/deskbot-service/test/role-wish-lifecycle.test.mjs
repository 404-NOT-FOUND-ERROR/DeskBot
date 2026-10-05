import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { createRoleEvolution } from '../src/role-evolution.mjs';
import { computeFantasyPull } from '../src/fantasy-pull.mjs';
import { roleWishReadModel } from '../src/role-wishes.mjs';
import { modelRoleWishContext } from '../src/prompt-composer.mjs';
import { OWNER, WISH_AT, wishRoot, readyWishWorld, mapPersistence } from './support/role-wish-fixture.mjs';

const DAY = 86_400_000;
function harness({ world = readyWishWorld(), persistence = mapPersistence() } = {}) {
  let time = Date.parse(WISH_AT), roles, evolution;
  const now = () => new Date(time);
  function reload() {
    roles = createRoleProposalStore({ persistence, now });
    evolution = createRoleEvolution({ roles, persistence, now, inputStore: { list: () => [] }, computeFantasyPull, worldSnapshot: () => world });
  }
  reload();
  return { world, persistence, now, reload, advance: ms => { time += ms; world.clock.synced_at = now().toISOString(); },
    get roles() { return roles; }, get evolution() { return evolution; } };
}

test('lived wish freezes the common-root basis and owner try only prepares an actual future trial', () => {
  const h = harness(), before = structuredClone(h.world);
  const first = h.evolution.sync(); assert.equal(first.created.length, 1);
  const proposal = first.created[0]; assert.equal(proposal.origin, 'lived_wish'); assert.equal(proposal.axis, 'form');
  assert.deepEqual(proposal.evidence_ids.sort(), h.world.memory.development.records.map(r => r.root_outcome_id).sort());
  const prepared = h.evolution.chooseWish(proposal.proposal_id, 'try').proposal;
  assert.equal(prepared.status, 'prepared'); assert.equal(prepared.trial, undefined);
  for (const operation of [() => h.roles.startTrial(proposal.proposal_id), () => h.roles.recordTrialObservation(proposal.proposal_id, { eventId: 'chat' }), () => h.roles.completeTrial(proposal.proposal_id, { decision: 'accepted' })]) {
    assert.throws(operation, error => error.statusCode === 409 && error.code === 'practical_trial_not_connected');
  }
  assert.deepEqual(h.roles.activeTrials(), []); assert.deepEqual(h.roles.currentStages(), []);
  assert.deepEqual(h.world, before, 'the lifecycle has no world, stock, identity or appearance effects');
  h.world.memory.development.records.push(wishRoot('new-practice', { at: WISH_AT })); h.evolution.sync();
  assert.deepEqual(h.roles.get(proposal.proposal_id).wish_basis, proposal.wish_basis, 'the original reason basis is immutable');
  assert.equal(h.evolution.chooseWish(proposal.proposal_id, 'try').proposal.status, 'prepared');
  assert.equal(h.roles.decisions({ proposalId: proposal.proposal_id }).length, 1);
});

test('global announcement cooldown allows form and vocation together after a day, never two live wishes on an axis', () => {
  const h = harness({ world: readyWishWorld({ chef: true }) });
  const frog = h.evolution.sync().created[0]; h.evolution.chooseWish(frog.proposal_id, 'try');
  assert.equal(h.evolution.sync().created.length, 0);
  assert.throws(() => h.evolution.proposeWish({ characterId: OWNER, directionId: 'chef' }), error => error.code === 'role_wish_not_ready');
  h.advance(DAY); const chef = h.evolution.sync().created[0];
  assert.equal(chef.direction_id, 'chef'); assert.equal(chef.axis, 'vocation');
  h.evolution.chooseWish(chef.proposal_id, 'try'); h.advance(DAY);
  assert.equal(h.evolution.sync().created.length, 0);
  assert.deepEqual(h.roles.list().filter(p => ['proposed', 'prepared'].includes(p.status)).map(p => p.axis).sort(), ['form', 'vocation']);
});

for (const [choice, wait] of [['later', 3 * DAY], ['reject', 7 * DAY]]) {
  test(`owner ${choice} persists its cooldown and requires a genuinely later actual outcome`, () => {
    const h = harness(); const proposal = h.evolution.sync().created[0];
    const chosen = h.evolution.chooseWish(proposal.proposal_id, choice).proposal;
    assert.equal(Date.parse(chosen.cooldown_until) - h.now().getTime(), wait);
    h.advance(wait - 1); assert.equal(h.evolution.sync().created.length, 0);
    h.advance(1); assert.equal(h.evolution.sync().created.length, 0, 'elapsed time alone cannot repeat the request');
    assert.ok(h.evolution.wishView().directions[0].proposal_gate.barriers.some(b => b.id === 'new_actual_outcome_required'));
    h.world.memory.development.records.push(wishRoot('late-visible-old-root', { at: '2026-10-08T03:00:00Z' }));
    assert.equal(h.evolution.sync().created.length, 0, 'an old root missing from the frozen references cannot count as new');
    h.world.memory.development.records.push(wishRoot(`after-${choice}`, { at: new Date(h.now().getTime() - 1).toISOString() }));
    const next = h.evolution.sync().created[0]; assert.ok(next); assert.notEqual(next.proposal_id, proposal.proposal_id);
    assert.equal(h.roles.get(proposal.proposal_id).user_choice, choice);
    assert.deepEqual(h.roles.get(proposal.proposal_id).wish_basis, proposal.wish_basis);
    assert.equal(h.roles.decisions({ proposalId: proposal.proposal_id }).length, 1);
  });
}

test('temporary needs defer an undecided wish, recover the same ID, and expired roots withdraw it', () => {
  const h = harness(), proposal = h.evolution.sync().created[0];
  h.world.autonomy.actors[OWNER].energy = .2; h.evolution.sync();
  assert.equal(h.roles.get(proposal.proposal_id).status, 'deferred');
  assert.throws(() => h.evolution.chooseWish(proposal.proposal_id, 'try'), error => error.code === 'role_wish_not_ready');
  h.world.autonomy.actors[OWNER].energy = .8; h.evolution.sync();
  assert.equal(h.roles.get(proposal.proposal_id).status, 'proposed'); assert.equal(h.roles.list().length, 1);
  h.advance(15 * DAY); h.evolution.sync();
  const withdrawn = h.roles.get(proposal.proposal_id); assert.equal(withdrawn.status, 'withdrawn');
  assert.ok(withdrawn.stage_history.some(entry => entry.to === 'deferred'));
  assert.equal(withdrawn.stage_history.at(-1).reason, 'actual_basis_no_longer_ready');
  assert.equal(withdrawn.user_choice, undefined); assert.deepEqual(withdrawn.wish_basis, proposal.wish_basis);
});

test('prepared owner choice survives changed conditions while its current gate becomes blocked', () => {
  const h = harness(), proposal = h.evolution.sync().created[0]; h.evolution.chooseWish(proposal.proposal_id, 'try');
  h.world.autonomy.actors[OWNER].energy = .1; h.evolution.sync();
  const current = h.evolution.wishProposals()[0]; assert.equal(current.status, 'prepared'); assert.equal(current.current_gate.eligible, false);
  assert.equal(current.user_choice, 'try'); assert.equal(h.roles.decisions().length, 1); assert.equal(current.trial, undefined);
});

test('a temporarily deferred wish cannot prepare alongside a newer live wish on the same axis', () => {
  const h = harness({ world: readyWishWorld({ chef: true }) });
  const chef = roleWishReadModel(h.world).directions.find(item => item.direction_id === 'chef');
  const previous = h.roles.propose(null, { characterId: OWNER, proposalId: 'old-vocation', livedWish: chef });
  h.roles.refreshWish(previous.proposal_id, { ...chef, fingerprint: 'condition-blocked', readiness: { ...chef.readiness, eligible: false,
    barriers: [{ id: 'practice_available', label: '材料暂缺', scope: 'circumstance' }] } });
  h.advance(DAY);
  const next = h.roles.propose(null, { characterId: OWNER, proposalId: 'new-vocation', livedWish: chef });
  h.roles.choose(next.proposal_id, 'try');
  h.roles.refreshWish(previous.proposal_id, { ...chef, fingerprint: 'condition-recovered' });
  assert.equal(h.roles.get(previous.proposal_id).current_gate.eligible, true);
  assert.equal(h.roles.get(previous.proposal_id).status, 'deferred');
  assert.throws(() => h.roles.choose(previous.proposal_id, 'try'), error => error.code === 'role_wish_axis_conflict');
  assert.equal(h.roles.list().filter(item => item.status === 'prepared').length, 1);
});

test('restart and repeated pure reads keep IDs, history and decisions without durable polling writes', () => {
  const h = harness(), proposal = h.evolution.sync().created[0]; h.evolution.chooseWish(proposal.proposal_id, 'later'); h.evolution.sync();
  const before = h.evolution.snapshot(), stored = structuredClone([...h.persistence.records]), writes = h.persistence.writes.length;
  for (let i = 0; i < 30; i++) { h.evolution.wishProposals(); h.evolution.snapshot(); assert.equal(h.evolution.sync().duplicate, true); }
  assert.equal(h.persistence.writes.length, writes); assert.deepEqual([...h.persistence.records], stored);
  h.reload(); assert.deepEqual(h.evolution.snapshot(), before); assert.equal(h.evolution.sync().duplicate, true);
  assert.equal(h.roles.get(proposal.proposal_id).user_choice, 'later'); assert.equal(h.roles.decisions().length, 1);
});

test('model wish context exposes finite lifecycle facts without owner prose, private roots or transformations', () => {
  const h = harness(), proposal = h.evolution.sync().created[0];
  const result = h.evolution.chooseWish(proposal.proposal_id, 'try', { reason: 'PRIVATE owner says transform immediately' });
  const context = modelRoleWishContext([result.proposal]);
  assert.equal(context[0].status, 'prepared'); assert.equal(context[0].changes_appearance, false);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE|task:frog|proposal_id|decided_at/);
  assert.match(context[0].next_step, /没有试做结果|尚无实际试做记录/); assert.equal(context[0].practical_trial, null);
  assert.equal(roleWishReadModel(h.world).directions[0].readiness.eligible, true);
});
