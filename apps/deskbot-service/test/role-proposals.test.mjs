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
