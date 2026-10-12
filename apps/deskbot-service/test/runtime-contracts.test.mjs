import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RUNTIME_STAGE_ORDER,
  createReplayMetadata,
  createRuntimeTraceRecorder,
  runtimeContractCatalog,
  stableRuntimeFingerprint,
  validateRuntimeTrace,
} from '../src/runtime-contracts.mjs';

const START = '2026-10-11T00:00:00.000Z';

test('runtime trace records ordered cognition stages without granting them authority', async () => {
  let tick = 0;
  const recorder = createRuntimeTraceRecorder({ runId: 'run-1', pipeline: 'shared-life', ruleVersion: 'rules-1', worldId: 'w1', inputEventIds: ['e2', 'e1'], startedAt: START, now: () => new Date(Date.parse(START) + tick), monotonic: () => tick });
  const value = await recorder.observe('perception', async () => { tick += 7; return { action: 'ignored-by-recorder' }; }, { references: { event_ids: ['e1'] } });
  assert.equal(value.action, 'ignored-by-recorder');
  tick += 2;
  recorder.observe('decision', () => 'candidate', { references: { evidence_ids: ['ev1'] } });
  const trace = recorder.finish({ resultEventIds: ['result-1'] });
  assert.deepEqual(trace.input_event_ids, ['e1', 'e2']);
  assert.deepEqual(trace.stages.map(stage => stage.stage), ['perception', 'decision']);
  assert.equal(trace.stages[0].references.event_ids[0], 'e1');
  assert.equal(trace.authority, 'audit_only');
  assert.equal(trace.result_event_ids[0], 'result-1');
  assert.doesNotThrow(() => validateRuntimeTrace(trace));
});

test('stage failures are recorded and original error is preserved', () => {
  let tick = 0;
  const recorder = createRuntimeTraceRecorder({ runId: 'run-2', pipeline: 'input', ruleVersion: 'rules-1', startedAt: START, now: () => new Date(Date.parse(START) + tick), monotonic: () => tick });
  assert.throws(() => recorder.observe('input', () => { tick += 3; const error = new Error('offline'); error.code = 'transport'; throw error; }), /offline/);
  const trace = recorder.finish();
  assert.equal(trace.status, 'error');
  assert.equal(trace.stages[0].error.code, 'transport');
  assert.equal(trace.error.code, 'transport');
  assert.equal(trace.stages[0].duration_ms, 3);
});

test('replay metadata is stable, sorted, and explicitly audit-only', () => {
  const first = createReplayMetadata({ pipeline: 'role-evolution', ruleVersion: 'r1', inputEventIds: ['b', 'a', 'a'], evidenceIds: ['z', 'y'], inputs: [{ cue: 'x' }], worldRevisionBefore: 4 });
  const second = createReplayMetadata({ pipeline: 'role-evolution', ruleVersion: 'r1', inputEventIds: ['a', 'b'], evidenceIds: ['y', 'z'], inputs: [{ cue: 'x' }], worldRevisionBefore: 4 });
  assert.equal(first.input_fingerprint, second.input_fingerprint);
  assert.equal(first.authority, 'audit_only');
  assert.equal(first.replay_policy, 'existing_domain_idempotency');
  assert.deepEqual(first.input_event_ids, ['a', 'b']);
  assert.deepEqual(first.evidence_ids, ['y', 'z']);
  assert.notEqual(stableRuntimeFingerprint({ a: 1 }), stableRuntimeFingerprint({ a: 2 }));
});

test('catalog pins the migration boundary and the stage order', () => {
  const catalog = runtimeContractCatalog();
  assert.deepEqual(catalog.stage_order, [...RUNTIME_STAGE_ORDER]);
  assert.equal(catalog.world_write_authority, 'persistentWorld.ingest');
  assert.equal(catalog.domain_contracts.action_feedback, 'deskbot.action-feedback.v1');
  assert.equal(catalog.compatibility, 'additive_metadata_existing_domain_state_machines');
});

test('recorder rejects unknown stages and incomplete trace finalization', async () => {
  const recorder = createRuntimeTraceRecorder({ runId: 'run-3', pipeline: 'life-choice', ruleVersion: 'r1', now: () => new Date(START) });
  assert.throws(() => recorder.observe('not-a-stage', () => {}), /known stage/);
  let resolve;
  const pending = recorder.observe('decision', () => new Promise(done => { resolve = done; }));
  assert.throws(() => recorder.finish(), /in-flight/);
  resolve('candidate');
  assert.equal(await pending, 'candidate');
  const trace = recorder.finish();
  assert.throws(() => recorder.observe('action', () => {}), /already complete/);
  const tampered = structuredClone(trace);
  tampered.stages[0].sequence = 4;
  assert.throws(() => validateRuntimeTrace(tampered), /sequence/);
});

test('replay fingerprints cover content and reject unsafe ambiguous values', () => {
  const base = { pipeline: 'candidate', ruleVersion: 'r1', inputEventIds: ['e1'] };
  const first = createReplayMetadata({ ...base, inputs: { a: 1, b: 2 } });
  const reordered = createReplayMetadata({ ...base, inputs: { b: 2, a: 1 } });
  const changed = createReplayMetadata({ ...base, inputs: { a: 9, b: 2 } });
  assert.equal(first.input_fingerprint, reordered.input_fingerprint);
  assert.notEqual(first.input_fingerprint, changed.input_fingerprint);
  assert.equal(first.input_capture, 'captured_content');
  assert.throws(() => createReplayMetadata({ ...base, inputs: { value: Number.NaN } }), /JSON values/);
  assert.throws(() => createReplayMetadata({ ...base, worldRevisionBefore: 0.5 }), /safe integer/);
  assert.throws(() => createReplayMetadata({ ...base, evidenceIds: [''] }), /non-empty strings/);
});

test('audit clock failures never prevent the observed domain operation', () => {
  let calls = 0;
  const recorder = createRuntimeTraceRecorder({
    runId: 'run-audit-failure', pipeline: 'input', ruleVersion: 'r1',
    startedAt: START, now: () => { throw new Error('clock unavailable'); }, monotonic: () => { throw new Error('timer unavailable'); },
  });
  assert.equal(recorder.observe('input', () => { calls += 1; return 'domain-result'; }), 'domain-result');
  assert.equal(calls, 1);
  const trace = recorder.finish();
  assert.equal(trace.status, 'completed');
  assert.ok(trace.audit_errors?.length || trace.audit_error);
});
