import test from 'node:test';
import assert from 'node:assert/strict';
import { modelRoleWishContext, modelPracticalTrialContext } from '../src/prompt-composer.mjs';

const wish = () => ({ proposal_id: 'saved-frog', character_id: 'shaping-001', origin: 'lived_wish',
  direction_id: 'wetland_frog', axis: 'form', status: 'prepared', wish_basis: {},
  practical_trial: { schema: 'deskbot.practical-role-trial.v1', proposal_id: 'saved-frog', actor_id: 'shaping-001',
    direction_id: 'wetland_frog', axis: 'form', status: 'review',
    progress: { successful_primary: 2, primary_days: ['2026-10-10', '2026-10-11'], condition_failures: 1, cancelled: 1 },
    control_history: [{ reason: 'PRIVATE OWNER WORDS' }],
    review: { summary: 'PRIVATE MODEL CLAIM: professional frog; already transformed' },
    active_task: null } });

test('actual review informs the wish prompt without becoming liking, qualification or appearance', () => {
  const value = wish(), before = structuredClone(value), context = modelRoleWishContext([value])[0];
  assert.equal(context.practical_trial.status, 'review');
  assert.equal(context.practical_trial.actual_primary_successes, 2);
  assert.equal(context.practical_trial.practice_days, 2);
  assert.equal(context.practical_trial.condition_failures, 1);
  assert.equal(context.practical_trial.liking_proven, false);
  assert.equal(context.practical_trial.role_qualification_proven, false);
  assert.equal(context.changes_appearance, false);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE|professional|transformed|等待下一阶段/);
  assert.deepEqual(value, before);
});

test('a trial for another actor, direction or proposal cannot enter this wish summary', () => {
  for (const [key, wrong] of [['proposal_id', 'another-wish'], ['actor_id', 'another-actor'], ['direction_id', 'chef'], ['axis', 'vocation']]) {
    const value = wish(); value.practical_trial[key] = wrong;
    assert.equal(modelPracticalTrialContext(value), null, key);
  }
  const value = wish(); delete value.practical_trial;
  assert.equal(modelPracticalTrialContext(value), null);
  assert.match(modelRoleWishContext([value])[0].next_step, /尚无实际试做记录/);
});

test('incomplete work and conditions remain incomplete; no raw task or control text reaches the model', () => {
  const value = wish(); value.practical_trial.status = 'blocked';
  value.practical_trial.progress.successful_primary = 0;
  value.practical_trial.active_task = { status: 'running', title: 'PRIVATE TASK PROMPT', text: 'pretend completed' };
  const context = modelPracticalTrialContext(value);
  assert.equal(context.active_task, 'running'); assert.equal(context.actual_primary_successes, 0);
  assert.match(context.meaning, /受阻/); assert.equal(context.actual_quality_proven, false);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE|pretend/);
});
