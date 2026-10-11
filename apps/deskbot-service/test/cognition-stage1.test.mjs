import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCognitionStage1, validateAdoption, validateMemory, prepareCognitionDatabase, STAGE1_SCHEMA } from '../src/cognition-stage1.mjs';
import { createCognitionBridge } from '../src/cognition-bridge.mjs';
import { createCognitionBroker } from '../src/cognition-broker.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { validateContract } from '../src/cognition-contracts.mjs';

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-cognition-'));
  t.stage1Closers=[];
  t.after(async () => {for(const close of t.stage1Closers) await close();rmSync(directory, { recursive: true, force: true, maxRetries:3 });});
  return join(directory, 'isolated.sqlite');
}
async function labFor(t, options = {}) {
  const lab = createCognitionStage1({ filename: temporary(t), ...options });
  t.stage1Closers.push(() => lab.close()); return lab;
}
function proposalFor(context) {
  return { schema: 'deskbot.cognition.proposal.v1', scope: 'isolated_mock', request_id: context.request_id, actor_id: context.actor_id, context_digest: context.context_digest,
    expected_actor_version: context.actor_version, interpretation: '暂时还不知道原因。', goal: '先观察。', intent: { primitive: 'observe', object_id: context.known_objects[0].object_id, expected_object_version: context.known_objects[0].version },
    source_event_ids: [context.visible_events[0].event_id], generated_at: context.created_at, provider_mode: 'mock' };
}

test('actual Python handoff: three bounded views, proposals and atomic personal memories', async t => {
  const lab = await labFor(t);
  const contexts = ['shaping-001', 'wetland-grower-001', 'lamp-keeper-001'].map(id => lab.buildContext(id, 'views'));
  assert.deepEqual(contexts.map(c => c.visible_events.length), [1, 2, 1]);
  assert.ok(!JSON.stringify(contexts[0]).includes('private:wetland-grower-001'));
  const run = await lab.run({ run_id: 'roundtrip' });
  assert.equal(run.status, 'completed');
  const report = lab.status(); assert.equal(report.memories.length, 3); assert.equal(report.index_count, 3);
  assert.equal(new Set(report.memories.map(m => m.root_id)).size, 1);
  assert.equal(new Set(report.memories.map(m => m.memory_group_id)).size, 3);
  assert.equal(new Set(report.requests.map(r => r.proposal.goal)).size, 3);
  assert.ok(report.actors.every(a => a.practice === 0 && a.adopted_role === null && a.version === 1));
  assert.ok(report.broker.calls.every(c => c.usage_source === 'mock_no_billing' && c.actual_cost === 0));
  assert.equal(report.broker.calls.filter(c => c.purpose === 'cognition').length, 3);
  assert.equal(report.broker.calls.filter(c => c.purpose === 'embedding').length, 3);
});

test('duplicate concurrent request and replay after reopening cannot recommit or recall', async t => {
  const filename = temporary(t); let lab = createCognitionStage1({ filename });
  const [first, second] = await Promise.all([lab.run({ run_id: 'same' }), lab.run({ run_id: 'same' })]);
  assert.deepEqual(first, second); await lab.close();
  lab = createCognitionStage1({ filename }); t.stage1Closers.push(() => lab.close());
  const calls = lab.status().broker.calls.length;
  assert.deepEqual(await lab.run({ run_id: 'same' }), first);
  assert.equal(lab.status().memories.length, 3); assert.equal(lab.status().broker.calls.length, calls);
});

test('adoption rejects foreign identities, invisible sources, invented targets and stale relevant conditions', async t => {
  const lab = await labFor(t), context = lab.buildContext('shaping-001', 'validation'), proposal = proposalFor(context);
  const state = { actor: lab.store.get('actors', context.actor_id), objects: lab.store.list('objects') };
  assert.doesNotThrow(() => validateAdoption(context, proposal, { ...state, global_revision: 999999 }));
  for (const [patch, code] of [
    [{ actor_id: 'lamp-keeper-001' }, 'session_mismatch'],
    [{ source_event_ids: ['private:someone'] }, 'invisible_source'],
    [{ intent: { ...proposal.intent, object_id: 'invisible-object' } }, 'unknown_action_target'],
    [{ expected_actor_version: 100 }, 'actor_version_changed'],
    [{ inventory_delta: 12 }, 'invalid_contract'],
  ]) assert.throws(() => validateAdoption(context, { ...proposal, ...patch }, state), { code });
  assert.throws(() => validateAdoption(context, proposal, { ...state, objects: state.objects.map(o => ({ ...o, version: 10 })) }), { code: 'object_version_changed' });
  assert.throws(() => validateAdoption(context, proposal, { ...state, now: () => new Date(Date.parse(context.expires_at) + 1) }), { code: 'context_expired' });
});

test('late relevant state change rejects only affected adoption; no invented memory or practice', async t => {
  const lab = await labFor(t, { beforeCommit: ({ context, store }) => {
    if (context.actor_id === 'shaping-001') { const actor = store.get('actors', context.actor_id); store.put('actors', actor.actor_id, { ...actor, version: actor.version + 1 }); }
  } });
  await lab.run({ run_id: 'late-change' });
  const report = lab.status();
  assert.equal(report.requests.find(r => r.actor_id === 'shaping-001').error_code, 'actor_version_changed');
  assert.equal(report.memories.length, 2); assert.ok(report.actors.every(a => a.practice === 0));
});

test('Node rejects fabricated facts and foreign shared roots in Python memory output', async t => {
  const lab = await labFor(t); await lab.run({ run_id: 'memory-check' });
  const { context, proposal, result, memory } = lab.status().requests[0];
  assert.throws(() => validateMemory(context, proposal, result, { ...memory, facts: ['已经掌握厨师技能。'] }), { code: 'invented_memory_fact' });
  assert.throws(() => validateMemory(context, proposal, result, { ...memory, root_id: 'old-world-root' }), { code: 'memory_root_mismatch' });
  assert.throws(() => validateMemory(context, proposal, result, { ...memory, practice_delta: 1 }), { code: 'invalid_contract' });
});

test('derived index can be removed and rebuilt; raw memory stays byte-identical', async t => {
  const lab = await labFor(t); await lab.run({ run_id: 'index' });
  const raw = JSON.stringify(lab.status().memories);
  for (const record of lab.store.list('indexes')) lab.store.remove('indexes', record.memory_id);
  const rebuilt = await lab.rebuildIndex(); assert.equal(rebuilt.rebuilt, 3); assert.equal(rebuilt.semantic, false);
  assert.equal(JSON.stringify(lab.status().memories), raw);
});

test('restart marks unfinished sessions and reservations interrupted; no automatic commit or billing retry', async t => {
  const filename = temporary(t), store = createSqlitePersistence({ filename });
  store.put('meta', 'schema', { version: STAGE1_SCHEMA });
  store.put('runs', 'crash', { run_id: 'crash', status: 'running' });
  store.put('requests', 'crash:shaping-001', { request_id: 'crash:shaping-001', status: 'result', result: { root_id: 'untouched-root' } });
  store.put('calls', 'pending', { call_id: 'pending', status: 'calling', actual_cost: null }); store.close();
  const lab = createCognitionStage1({ filename }); t.stage1Closers.push(() => lab.close());
  assert.equal((await lab.run({ run_id: 'crash' })).status, 'interrupted');
  assert.equal(lab.status().requests[0].status, 'interrupted');
  assert.equal(lab.status().broker.calls[0].status, 'interrupted');
  assert.equal(lab.status().memories.length, 0); assert.equal(lab.status().requests[0].result.root_id, 'untouched-root');
});

test('actual process termination before authoritative commit recovers without fabricated memory or duplicate call', async t => {
  const filename=temporary(t), marker=join(dirnameOf(filename),'crash-ready');
  const child=spawn(process.execPath,[fileURLToPath(new URL('../../../scripts/cognition-stage1-crash-fixture.mjs',import.meta.url)),filename,marker],{windowsHide:true,stdio:'ignore'});
  const exit=once(child,'exit');
  t.stage1Closers.push(async()=>{if(child.exitCode===null && child.signalCode===null)child.kill();await exit;});
  const deadline=Date.now()+8000;
  while(!existsSync(marker)&&Date.now()<deadline&&child.exitCode===null)await new Promise(r=>setTimeout(r,30));
  assert.ok(existsSync(marker),'child did not reach the pre-commit barrier');
  child.kill();await exit;
  const lab=createCognitionStage1({filename});t.stage1Closers.push(()=>lab.close());
  assert.equal(lab.status().memories.length,0);
  assert.equal((await lab.run({run_id:'actual-crash'})).status,'interrupted');
  const before=lab.status().broker.calls.length;
  await lab.run({run_id:'actual-crash'});assert.equal(lab.status().broker.calls.length,before);
  assert.ok(lab.status().requests.every(r=>r.status==='interrupted'));
});

test('old isolated save is backed up before version migration and can restore without rewriting old facts', async t => {
  const filename = temporary(t), store = createSqlitePersistence({ filename });
  store.put('meta', 'schema', { version: 'deskbot.cognition.stage1.v0' });
  const oldMemory = { memory_id: 'old-memory', actor_id: 'shaping-001', root_id: 'old-root', interpretation: null, unknown_motivation: true };
  store.put('memories', oldMemory.memory_id, oldMemory); store.close();
  const lab = createCognitionStage1({ filename });
  const backup = lab.status().backup; assert.ok(backup); assert.deepEqual(lab.status().memories[0], oldMemory); await lab.close();
  const restored = join(dirnameOf(filename), 'restored.sqlite'); copyFileSync(backup, restored);
  const copy = createSqlitePersistence({ filename: restored });
  assert.equal(copy.get('meta', 'schema').version, 'deskbot.cognition.stage1.v0');
  assert.deepEqual(copy.get('memories', 'old-memory'), oldMemory); copy.close();
  const reopened = createCognitionStage1({ filename }); assert.equal(reopened.status().backup, backup); await reopened.close();
});
function dirnameOf(filename) { return join(filename, '..'); }

test('formal save path is rejected before modification', t => {
  const filename = temporary(t), store = createSqlitePersistence({ filename });
  store.put('canonical-world.states', 'world', { root: 'old-shared-root', adopted_role: 'existing', motivation: null }); store.close();
  const original = readFileSync(filename);
  assert.throws(() => prepareCognitionDatabase(filename), { code: 'not_a_lab_save' });
  assert.deepEqual(readFileSync(filename), original);
});

test('priority queue reserves before execution, prioritizes dialogue, deduplicates, refuses paid mode and caps calls', async t => {
  const store = createSqlitePersistence({ filename: temporary(t) });t.stage1Closers.push(() => store.close());
  const broker = createCognitionBroker({ store, maxCalls: 3 });
  let release; const gate = new Promise(resolve => { release = resolve; }), order = [];
  const first = broker.complete({ callId: 'first', payload: {}, execute: async () => { order.push('first'); await gate; return 'first'; } });
  const background = broker.complete({ callId: 'background', payload: {}, execute: () => { order.push('background'); return 'background'; } });
  const dialogue = broker.complete({ callId: 'dialogue', purpose: 'user_dialogue', payload: {}, execute: () => { order.push('dialogue'); return 'dialogue'; } });
  assert.equal(store.get('calls', 'background').status, 'reserved');
  assert.throws(() => broker.complete({ callId: 'fourth', payload: {}, execute: () => 'bad' }), { code: 'mock_call_budget_exhausted' });
  await assert.rejects(broker.complete({ callId: 'paid', mode: 'real', payload: {}, execute: () => 'bad' }), { code: 'paid_provider_disabled' });
  release();await Promise.all([first,background,dialogue]);assert.deepEqual(order,['first','dialogue','background']);
  assert.equal(await broker.complete({callId:'dialogue',purpose:'user_dialogue',payload:{},execute:()=>assert.fail('duplicate executed')}),'dialogue');
  assert.throws(()=>broker.complete({callId:'dialogue',payload:{different:true},execute:()=>null}),{code:'call_id_conflict'});broker.close();
});

test('missing Python is an explicit failure and does not invent results', async t => {
  const bridge = createCognitionBridge({ python: 'definitely-no-python-here', timeoutMs: 500 });
  const lab = await labFor(t, { bridge });await lab.run({ run_id: 'missing-python' });
  assert.equal(lab.status().memories.length, 0);assert.ok(lab.status().requests.every(r=>r.status==='rejected'));
  assert.equal(lab.status().broker.calls.length, 0);
});

test('strict contract rejects arbitrary world mutations and invalid timestamp/numeric types', async t => {
  const lab=await labFor(t), context=lab.buildContext('shaping-001','strict');
  assert.throws(()=>validateContract('context',{...context,inventory:100}),{code:'invalid_contract'});
  assert.throws(()=>validateContract('context',{...context,actor_version:true}),{code:'invalid_contract'});
  assert.throws(()=>validateContract('context',{...context,created_at:'2026-10-09'}),{code:'invalid_contract'});
});
