import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoleProposal, createRoleProposalStore } from '../src/role-proposals.mjs';

test('candidate becomes an explicit reversible role proposal', () => {
  const proposal = createRoleProposal({ status: 'candidate', direction_id: 'wetland_frog', label: '荷叶青蛙', life: '潮湿的生活', fantasy_pull: 0.8, evidence_ids: ['evidence-a'] }, { now: new Date('2026-09-14T00:00:00Z') });
  assert.equal(proposal.status, 'proposed');
  assert.deepEqual(proposal.user_choices, ['try', 'later', 'reject']);
  assert.match(proposal.prompt_hint, /荷叶青蛙/);
});

test('observing pull cannot produce a proposal', () => {
  assert.equal(createRoleProposal({ status: 'observing', direction_id: 'wetland_frog' }), null);
});

test('proposal choice is persisted and never silently becomes an accepted shell', () => {
  const writes = [];
  const store = createRoleProposalStore({ persistence: { list: () => [], put: (...args) => writes.push(args) }, now: () => new Date('2026-09-14T00:00:00Z') });
  const proposal = store.propose({ status: 'candidate', direction_id: 'starry_observer', label: '星空观察者', life: '观测星空', fantasy_pull: 0.9, evidence_ids: ['e1', 'e2', 'e3'] });
  const result = store.choose(proposal.proposal_id, 'try', { reason: '用户愿意先试一段' });
  assert.equal(result.proposal.status, 'trying');
  assert.equal(result.decision.choice, 'try');
  assert.notEqual(result.proposal.status, 'accepted');
  assert.ok(writes.length >= 2);
});

test('trying proposal has bounded, idempotent observations and explicit completion', () => {
  const writes = [];
  const store = createRoleProposalStore({ persistence: { list: () => [], put: (...args) => writes.push(args) }, now: () => new Date('2026-09-14T00:00:00.000Z') });
  const proposal = store.propose({ status: 'candidate', direction_id: 'wetland_frog', label: '荷叶青蛙', life: '潮湿生活', fantasy_pull: 0.8, evidence_ids: ['e1', 'e2', 'e3'] });
  store.choose(proposal.proposal_id, 'try');
  const started = store.startTrial(proposal.proposal_id, { windowTurns: 2 });
  assert.equal(started.trial.status, 'active');
  store.recordTrialObservation(proposal.proposal_id, { eventId: 'evt-1', signal: 'positive', evidenceId: 'ev-1' });
  const duplicate = store.recordTrialObservation(proposal.proposal_id, { eventId: 'evt-1', signal: 'negative', evidenceId: 'ev-2' });
  assert.equal(duplicate.trial.turns_observed, 1);
  const completed = store.recordTrialObservation(proposal.proposal_id, { eventId: 'evt-2', signal: 'neutral', evidenceId: 'ev-3' });
  assert.equal(completed.trial.status, 'completed');
  assert.equal(completed.status, 'trying');
  const accepted = store.completeTrial(proposal.proposal_id, { decision: 'accepted', reason: '试行后确认' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.trial.status, 'completed');
  assert.equal(accepted.stage_history.at(-1).to, 'accepted');
  assert.ok(writes.some(([, id]) => id === proposal.proposal_id));
});

test('only trying proposals can start or record a trial', () => {
  const store = createRoleProposalStore({ now: () => new Date('2026-09-14T00:00:00.000Z') });
  const proposal = store.propose({ status: 'candidate', direction_id: 'dream_cloud', label: '云朵梦境生物', life: '梦境生活', fantasy_pull: 0.8, evidence_ids: ['e1', 'e2', 'e3'] });
  assert.throws(() => store.startTrial(proposal.proposal_id), /only trying/);
  assert.throws(() => store.recordTrialObservation(proposal.proposal_id, { eventId: 'evt-1' }), /trial is not active/);
});

test('completed trial cannot silently restart and archive is idempotent', () => {
  const store = createRoleProposalStore({ now: () => new Date('2026-09-14T00:00:00.000Z') });
  const proposal = store.propose({ status: 'candidate', direction_id: 'workshop_maker', label: '工坊学徒', life: '工坊生活', fantasy_pull: 0.8, evidence_ids: ['e1', 'e2', 'e3'] });
  store.choose(proposal.proposal_id, 'try');
  store.startTrial(proposal.proposal_id, { windowTurns: 1 });
  store.recordTrialObservation(proposal.proposal_id, { eventId: 'evt-1', signal: 'neutral' });
  assert.throws(() => store.startTrial(proposal.proposal_id), /window is complete/);
  const archived = store.archive(proposal.proposal_id, { reason: '测试归档' });
  assert.equal(store.archive(proposal.proposal_id).archived_at, archived.archived_at);
});

test('proposal and trial history reload from durable namespaces', () => {
  const records = new Map();
  const persistence = {
    list(namespace) {
      return [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value));
    },
    put(namespace, id, value) {
      records.set(`${namespace}:${id}`, structuredClone(value));
    },
  };
  const first = createRoleProposalStore({ persistence, now: () => new Date('2026-09-14T00:00:00.000Z') });
  const proposal = first.propose({ status: 'candidate', direction_id: 'starry_observer', label: '星空观察者', life: '观测星空', fantasy_pull: 0.8, evidence_ids: ['e1', 'e2', 'e3'] });
  first.choose(proposal.proposal_id, 'try');
  first.startTrial(proposal.proposal_id, { windowTurns: 3 });
  first.recordTrialObservation(proposal.proposal_id, { eventId: 'evt-persist-1', signal: 'positive', evidenceId: 'ev-persist-1' });
  const second = createRoleProposalStore({ persistence, now: () => new Date('2026-09-15T00:00:00.000Z') });
  const restored = second.get(proposal.proposal_id);
  assert.equal(restored.status, 'trying');
  assert.equal(restored.trial.positive_feedback, 1);
  assert.equal(restored.trial.evidence_ids[0], 'ev-persist-1');
  assert.equal(second.decisions({ proposalId: proposal.proposal_id }).length, 1);
});

test('active trial exposes a direction-specific expression overlay', () => {
  const store = createRoleProposalStore({ now: () => new Date('2026-09-14T00:00:00.000Z') });
  const proposal = store.propose({ status: 'candidate', direction_id: 'wetland_frog', label: '荷叶青蛙', life: '潮湿生活', fantasy_pull: 0.8, evidence_ids: ['e1', 'e2', 'e3'] }, { characterId: 'shaping-001' });
  store.choose(proposal.proposal_id, 'try');
  store.startTrial(proposal.proposal_id, { windowTurns: 2 });
  const [trial] = store.activeTrials({ characterId: 'shaping-001' });
  assert.equal(trial.direction_id, 'wetland_frog');
  assert.match(trial.overlay.presence, /亲水/);
  assert.equal(trial.trial.status, 'active');
});

test('accepted role becomes a durable role-state without changing the shell', () => {
  const store = createRoleProposalStore({ now: () => new Date('2026-09-14T00:00:00.000Z') });
  const proposal = store.propose({ status: 'candidate', direction_id: 'wetland_frog', label: '荷叶青蛙', life: '潮湿生活', fantasy_pull: 0.8, evidence_ids: ['e1', 'e2', 'e3'] }, { characterId: 'shaping-001' });
  store.choose(proposal.proposal_id, 'try');
  store.startTrial(proposal.proposal_id, { windowTurns: 1 });
  store.recordTrialObservation(proposal.proposal_id, { eventId: 'evt-role-state-1', signal: 'positive', evidenceId: 'ev-role-state-1' });
  store.completeTrial(proposal.proposal_id, { decision: 'accepted', reason: '想把这段生活留下来' });
  const [stage] = store.currentStages({ characterId: 'shaping-001' });
  assert.equal(stage.schema, 'deskbot.role-state.v1');
  assert.equal(stage.direction_id, 'wetland_frog');
  assert.match(stage.overlay.presence, /亲水/);
  assert.match(stage.stage_id, /wetland_frog/);
});

test('one character cannot run two role trials at once', () => {
  const store = createRoleProposalStore({ now: () => new Date('2026-09-14T00:00:00.000Z') });
  const first = store.propose({ status: 'candidate', direction_id: 'wetland_frog', label: '荷叶青蛙', life: '潮湿生活', fantasy_pull: 0.8, evidence_ids: ['e1', 'e2', 'e3'] }, { characterId: 'shaping-001' });
  const second = store.propose({ status: 'candidate', direction_id: 'starry_observer', label: '星空观察者', life: '观测星空', fantasy_pull: 0.8, evidence_ids: ['e4', 'e5', 'e6'] }, { characterId: 'shaping-001' });
  store.choose(first.proposal_id, 'try');
  store.startTrial(first.proposal_id);
  store.choose(second.proposal_id, 'try');
  assert.throws(() => store.startTrial(second.proposal_id), /active trial/);
});
