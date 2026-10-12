import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionFeedbackReceipt } from '../src/action-feedback.mjs';

const at = '2026-10-12T00:00:00.000Z';

test('receipt distinguishes planning, execution and canonical completion', () => {
  const planned = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-1', kind: 'decided', at });
  assert.equal(planned.status, 'planned');
  assert.equal(planned.attempted, false);
  assert.equal(planned.authority, 'audit_only');
  assert.equal(planned.basis, 'life_planner');

  const started = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-1', taskId: 't-1', eventId: 'e-1', kind: 'started', taskStatus: 'running', at, locationId: 'moss-sprout-garden' });
  assert.equal(started.status, 'running');
  assert.equal(started.outcome, 'in_progress');
  assert.equal(started.authority, 'audit_only');
  assert.equal(started.basis, 'canonical_task');

  const completed = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-1', taskId: 't-1', eventId: 'e-2', kind: 'completed', taskStatus: 'completed', at });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.outcome, 'success');
  assert.equal(completed.occurred, true);
});

test('failure and cancellation never masquerade as success', () => {
  const failure = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-2', taskId: 't-2', kind: 'replan', taskStatus: 'failed', failureReason: '路线发生变化', at });
  assert.equal(failure.outcome, 'failure');
  assert.equal(failure.execution, 'settled_failure');
  assert.equal(failure.occurred, true);
  assert.equal(failure.failure_reason, '路线发生变化');
  const cancelled = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-3', taskId: 't-3', kind: 'cancelled', taskStatus: 'cancelled', at });
  assert.equal(cancelled.outcome, 'cancelled');
  assert.equal(cancelled.execution, 'settled_cancelled');
  assert.equal(cancelled.occurred, false);
  const noTask = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-4', kind: 'replan', failureReason: '没有路', at });
  assert.equal(noTask.execution, 'not_executed');
  assert.equal(noTask.attempted, false);
  assert.equal(noTask.occurred, false);
});

test('canonical task status wins over a misleading feedback kind or prose', () => {
  const failed = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-5', taskId: 't-5', kind: 'completed', taskStatus: 'failed', at, failureReason: 'canonical failure' });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.outcome, 'failure');
  assert.equal(failed.execution, 'settled_failure');
  const running = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-6', taskId: 't-6', kind: 'completed', taskStatus: 'running', at });
  assert.equal(running.status, 'running');
  assert.equal(running.outcome, 'in_progress');
  assert.equal(running.execution, 'started');
  const missing = createActionFeedbackReceipt({ actorId: 'shaping-001', planId: 'p-7', taskId: 'missing', kind: 'completed', taskStatus: null, at });
  assert.equal(missing.status, null);
  assert.equal(missing.outcome, 'unknown');
  assert.equal(missing.occurred, false);
});

test('the same receipt inputs have a stable identity and survive JSON restore', () => {
  const input = { actorId: 'shaping-001', planId: 'p-8', taskId: 't-8', eventId: 'e-8', causeEventId: 'start-8', kind: 'completed', taskStatus: 'completed', at };
  const first = createActionFeedbackReceipt(input);
  assert.deepEqual(createActionFeedbackReceipt(input), first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first);
  assert.equal(first.cause_event_id, 'start-8');
});

test('invalid kind and timestamp are rejected', () => {
  assert.throws(() => createActionFeedbackReceipt({ actorId: 'a', kind: 'unknown', at }), /unsupported/);
  assert.throws(() => createActionFeedbackReceipt({ actorId: 'a', kind: 'started', at: 'never' }), /timestamp/);
});
