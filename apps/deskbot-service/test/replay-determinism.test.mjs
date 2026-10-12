import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { roleStageHttpFixture } from './support/role-stage-http-fixture.mjs';
import { OWNER } from './support/role-wish-fixture.mjs';
import { roleStageReadModel } from '../src/role-stages.mjs';
import {
  appendReplayEvent,
  canonicalDigest,
  captureReplayCheckpoint,
  createReplayTape,
  replayTape,
  ReplayContractError,
} from '../src/replay-tape.mjs';

const CHARACTER_ID = 'shaping-001';
const AT = new Date('2026-10-11T12:00:00.000Z');
const RULES = {
  canonical_world: 'canonical-world-rules-v0.4',
  world_candidates: 'world-candidates.v0.1',
  role_evolution: 'role-evolution-rules.v0.8',
};
const NAMESPACES = [
  'canonical-world.states',
  'canonical-world.mutations',
  'canonical-world.turns',
  'input.events',
  'evidence.records',
  'state.characters',
  'state.results',
  'role.evolution-candidates',
  'role.evolution-runs',
  'role.evolution-cooldowns',
  'role.evidence',
  'role.pulls',
  'role.proposals',
  'role.proposal-decisions',
  'world.candidates',
  'world.candidate-decisions',
];

function fakeLlm() {
  return {
    id: 'replay-fake-llm-v1',
    status: () => ({ configured: true, provider: 'replay-fake', model: 'replay-fake-v1' }),
    async complete() {
      return { provider: 'replay-fake', model: 'replay-fake-v1', text: '喵呜，先把这一刻记下来。', trace: { fixture: true } };
    },
  };
}

function createRuntime(filename) {
  let clock = new Date(AT);
  const now = () => new Date(clock);
  const persistence = createSqlitePersistence({ filename, now });
  const server = createDeskBotServer({
    now,
    persistence,
    now,
    setClock({ received_at }) { clock = new Date(received_at); },
    llm: fakeLlm(),
    websocket: false,
    worldLifeEnabled: false,
    autonomousLifeEnabled: false,
    residentLifeEnabled: false,
    livedMemoryEnabled: false,
  });
  let closed = false;
  return {
    server,
    persistence,
    ingest: server.ingestNonChatEvent,
    worldSnapshot: () => server.persistentWorld.get(),
    listMutations: options => server.persistentWorld.listMutations(options),
    close() { if (!closed) { closed = true; persistence.close(); } },
  };
}

function tapeFixture() {
  let tape = createReplayTape({
    tapeId: 'm6-replay-fixture-v1',
    seed: { world_id: 'deskbot-small-world', initial_revision: 0, fixture: 'canonical-default' },
    ruleVersions: RULES,
    clock: { mode: 'simulation', time_zone: 'Asia/Shanghai', now: AT.toISOString() },
  });
  const events = [
    {
      event_id: 'replay-weather-001', type: 'weather.observation', source: 'replay-weather',
      source_kind: 'external_provider', layer: 'weather', character_id: CHARACTER_ID,
      provider: 'replay-provider', occurred_at: AT.toISOString(), observed_at: AT.toISOString(),
      payload: { snapshot: { location: '雾灯镇', condition: '薄雨', temperature_c: 19, observed_at: AT.toISOString(), provider: 'replay-provider' } },
    },
    {
      event_id: 'replay-chat-001', type: 'conversation.input', source: 'replay-dialogue',
      source_kind: 'user', layer: 'interaction', character_id: CHARACTER_ID,
      correlation_id: 'replay-correlation-001', occurred_at: AT.toISOString(), observed_at: AT.toISOString(),
      payload: { role: 'user', text: '今天雾灯镇下了一点雨。' },
    },
    {
      event_id: 'replay-world-time-001', type: 'world.mutation', source: 'replay-clock',
      source_kind: 'world_engine', layer: 'calendar', character_id: CHARACTER_ID,
      occurred_at: AT.toISOString(), observed_at: AT.toISOString(),
      payload: { action: 'advance_time', minutes: 15 },
    },
  ];
  for (const event of events) tape = appendReplayEvent(tape, event, { adapter: {},
    postActions: event.event_id === 'replay-weather-001' ? [{ kind: 'accept_world_candidate', source_event_id: event.event_id }] : [] });
  return tape;
}

function runnerOptions(tape) {
  return {
    tape,
    expectedRuleVersions: RULES,
    checkpointNamespaces: NAMESPACES,
  };
}

test('fresh independent SQLite runs produce the same canonical replay digest', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-replay-fresh-'));
  const tape = tapeFixture();
  const first = createRuntime(join(directory, 'first.sqlite'));
  const second = createRuntime(join(directory, 'second.sqlite'));
  t.after(() => { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); });

  const a = await replayTape({ ...runnerOptions(tape), runtime: first, mode: 'fresh' });
  const b = await replayTape({ ...runnerOptions(tape), runtime: second, mode: 'fresh' });
  assert.equal(a.checkpoint.digest, b.checkpoint.digest);
  assert.deepEqual(a.results.map(item => [item.event_id, item.mutation_id, item.after_revision]), b.results.map(item => [item.event_id, item.mutation_id, item.after_revision]));
  assert.equal(a.checkpoint.world_revision, b.checkpoint.world_revision);
  assert.deepEqual(first.server.persistentWorld.listMutations().map(item => item.mutation_id), second.server.persistentWorld.listMutations().map(item => item.mutation_id));
  assert.equal(first.server.worldCandidates.list({ status: 'accepted' }).length, 1);
});

test('restart continuation equals a fresh complete run', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-replay-restart-'));
  const tape = tapeFixture();
  const continuedPath = join(directory, 'continued.sqlite');
  const fullPath = join(directory, 'full.sqlite');
  const first = createRuntime(continuedPath);
  const prefix = await replayTape({ ...runnerOptions(tape), runtime: first, fromIndex: 0, toIndex: 1, mode: 'fresh' });
  first.close();
  const resumed = createRuntime(continuedPath);
  const tail = await replayTape({ ...runnerOptions(tape), runtime: resumed, fromIndex: 1, toIndex: tape.events.length, mode: 'restart', checkpoint: prefix.checkpoint });
  const full = createRuntime(fullPath);
  t.after(() => { first.close(); resumed.close(); full.close(); rmSync(directory, { recursive: true, force: true }); });
  const complete = await replayTape({ ...runnerOptions(tape), runtime: full, mode: 'fresh' });
  assert.equal(tail.checkpoint.digest, complete.checkpoint.digest);
  assert.equal(canonicalDigest(resumed.server.persistentWorld.listMutations()), canonicalDigest(full.server.persistentWorld.listMutations()));
  assert.equal(canonicalDigest(resumed.server.worldCandidates.list({ limit: 20 })), canonicalDigest(full.server.worldCandidates.list({ limit: 20 })));
  resumed.close(); full.close();
});

test('duplicate delivery is a no-op and conflicting identity is rejected', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-replay-duplicate-'));
  const tape = tapeFixture();
  const runtime = createRuntime(join(directory, 'duplicate.sqlite'));
  t.after(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  await replayTape({ ...runnerOptions(tape), runtime, mode: 'fresh' });
  const before = captureReplayCheckpoint({ tape, runtime, namespaces: NAMESPACES });
  const duplicate = await replayTape({ tape, runtime, mode: 'duplicate', expectedRuleVersions: RULES, checkpointNamespaces: NAMESPACES });
  const after = duplicate.checkpoint;
  assert.equal(after.digest, before.digest);
  assert.ok(duplicate.results.every(item => item.duplicate === true));
  assert.throws(() => appendReplayEvent(tape, { ...tape.events[0].event, payload: { snapshot: { condition: '改写事实' } } }), error => error instanceof ReplayContractError && error.code === 'replay_event_conflict');
});

test('candidate preview leaves canonical world unchanged and incompatible rules fail before ingress', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-replay-preview-'));
  const tape = tapeFixture();
  const runtime = createRuntime(join(directory, 'preview.sqlite'));
  t.after(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const previewTape = { ...tape, events: tape.events.map(item => ({ ...item, post_actions: [] })) };
  await replayTape({ tape: previewTape, runtime, fromIndex: 0, toIndex: 1, mode: 'fresh', expectedRuleVersions: RULES, checkpointNamespaces: NAMESPACES });
  const candidate = runtime.server.worldCandidates.list({ status: 'pending' })[0];
  assert.ok(candidate);
  const before = captureReplayCheckpoint({ tape, runtime, namespaces: ['canonical-world.states', 'canonical-world.mutations'] });
  const preview = runtime.server.worldCandidates.preview(candidate.candidate_id);
  const after = captureReplayCheckpoint({ tape, runtime, namespaces: ['canonical-world.states', 'canonical-world.mutations'] });
  assert.equal(preview.world_revision, before.world_revision);
  assert.equal(after.world_revision, before.world_revision);
  assert.deepEqual(after.projection.world, before.projection.world);
  assert.deepEqual(after.projection.mutations, before.projection.mutations);
  await assert.rejects(() => replayTape({ tape, runtime, expectedRuleVersions: { canonical_world: 'wrong-rule' } }), error => error instanceof ReplayContractError && error.code === 'replay_rule_version_mismatch');
  assert.equal(runtime.worldSnapshot().world_revision, before.world_revision);
});

test('checkpoint records role-evolution and candidate namespaces without treating prose as canonical state', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-replay-contract-'));
  const tape = tapeFixture();
  const runtime = createRuntime(join(directory, 'contract.sqlite'));
  t.after(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const result = await replayTape({ ...runnerOptions(tape), runtime, mode: 'fresh' });
  assert.equal(result.checkpoint.schema, 'deskbot.replay-checkpoint.v1');
  assert.equal(typeof result.checkpoint.seed_hash, 'string');
  assert.ok(result.checkpoint.namespace_digests['role.evolution-runs']);
  assert.ok(result.checkpoint.namespace_digests['world.candidates']);
  assert.equal(result.checkpoint.projection.world.world_revision, result.checkpoint.world_revision);
  // The fixture has no model chat turn. This assertion makes explicit that
  // replay equality is about canonical state, not generated assistant prose.
  assert.equal(result.checkpoint.projection.records['chat.turns'] ?? undefined, undefined);
  assert.equal(canonicalDigest(result.checkpoint.projection.world), canonicalDigest(runtime.worldSnapshot()));
});

test('tape rejects implicit IDs, output events, changed seed, identity/index and clock tampering before any write', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-replay-negative-'));
  const runtime = createRuntime(join(directory, 'negative.sqlite'));
  t.after(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
  const tape = tapeFixture(), base = tape.events[1].event;
  const before = captureReplayCheckpoint({ tape, runtime, namespaces: NAMESPACES });
  assert.throws(() => appendReplayEvent(tape, { ...base, event_id: undefined }), error => error.code === 'invalid_replay_contract');
  assert.throws(() => appendReplayEvent(tape, { ...base, event_id: 'output', type: 'conversation.reply', payload: { role: 'assistant', text: '我已经改好了世界' } }), error => error.code === 'replay_read_only_event');
  assert.throws(() => appendReplayEvent(tape, { ...base, event_id: 'device-output', type: 'device.action.completed' }), error => error.code === 'replay_read_only_event');
  assert.throws(() => appendReplayEvent(tape, { ...base, event_id: 'adapter-spoof' }, { adapter: { bodyInternal: true } }), error => error.code === 'invalid_replay_adapter');
  assert.throws(() => appendReplayEvent(tape, { ...base, event_id: 'clock-invalid' }, { receivedAt: 'not-a-date' }), error => error.code === 'invalid_replay_contract');
  const mutations = [
    { ...tape, seed: { ...tape.seed, fixture: 'different' } },
    { ...tape, rule_version: 'wrong-tape-rules' },
    { ...tape, events: tape.events.map((item, index) => index ? item : { ...item, event_id: 'different-identity' }) },
    { ...tape, events: tape.events.map((item, index) => index ? item : { ...item, index: 9 }) },
    { ...tape, events: tape.events.map((item, index) => index ? item : { ...item, logical_at: undefined }) },
  ];
  for (const changed of mutations) await assert.rejects(() => replayTape({ tape: changed, runtime, expectedRuleVersions: RULES }), error => error instanceof ReplayContractError);
  assert.equal(captureReplayCheckpoint({ tape, runtime, namespaces: NAMESPACES }).digest, before.digest);
});

test('a canonical practical stage survives restart and duplicate acceptance through the tape ingress', async t => {
  // This existing domain fixture obtains two primary results from real timed
  // recipes through ordinary autonomy. Prior readiness records are authored
  // fixture roots; this test does not claim that one replay invented them.
  const h = await roleStageHttpFixture(t), reviewed = await h.actualReview();
  const proposal = reviewed.proposal, preview = await h.preview(proposal.proposal_id);
  assert.equal(preview.eligible, true);
  let tape = createReplayTape({ tapeId: 'm6-real-practical-stage', seed: { world: h.world.get() }, ruleVersions: RULES,
    clock: { mode: 'real_time', time_zone: 'Asia/Shanghai', now: h.now().toISOString() } });
  tape = appendReplayEvent(tape, {
    event_id: 'm6-practical-stage-adopt', type: 'world.mutation', source: 'role-stage-engine', source_kind: 'world_engine',
    character_id: OWNER, occurred_at: h.now().toISOString(), observed_at: h.now().toISOString(),
    payload: { action: 'accept_role_stage', proposal_id: proposal.proposal_id, actor_id: OWNER,
      direction_id: proposal.direction_id, wish_basis: proposal.wish_basis, preview_fingerprint: preview.preview_fingerprint },
  }, { adapter: { roleStageInternal: true }, logicalAt: h.now().toISOString(), receivedAt: h.now().toISOString() });
  const runtime = () => ({ server: h.server, persistence: h.persistence, ingest: h.server.ingestNonChatEvent,
    worldSnapshot: () => h.world.get(), listMutations: options => h.world.listMutations(options) });
  const result = await replayTape({ tape, runtime: runtime(), expectedRuleVersions: RULES, checkpointNamespaces: NAMESPACES });
  assert.equal(roleStageReadModel(h.world.get(), { proposalId: proposal.proposal_id }).status, 'accepted');
  assert.equal(h.world.get().role_stages.actors[OWNER].versions.length, 1);
  const revision = result.checkpoint.world_revision, mutationIds = h.world.listMutations({ limit: 200 }).map(item => item.mutation_id);
  await h.restart();
  const restoredStage = roleStageReadModel(h.world.get(), { proposalId: proposal.proposal_id });
  assert.equal(restoredStage.status, 'accepted'); assert.equal(h.roles.get(proposal.proposal_id).status, 'accepted');
  const duplicate = await replayTape({ tape, runtime: runtime(), mode: 'duplicate', expectedRuleVersions: RULES, checkpointNamespaces: NAMESPACES });
  assert.equal(duplicate.results[0].duplicate, true);
  assert.equal(duplicate.checkpoint.world_revision, revision);
  assert.deepEqual(h.world.listMutations({ limit: 200 }).map(item => item.mutation_id), mutationIds);
  assert.equal(h.world.get().role_stages.actors[OWNER].versions.length, 1);
});
