import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { installLivedMemory, remember } from '../src/lived-memory.mjs';
import { syncDevelopmentEvidence } from '../src/development-evidence.mjs';
import { installSlowCognition, prepareSlowCognition, claimSlowCognition, resolveSlowCognition,
  createSlowCognitionWorker, slowCognitionContext, influenceSlowCognitionChoices, slowCognitionPrompt,
  bindSlowCognitionTask, syncSlowCognitionGoals } from '../src/slow-cognition.mjs';
import { createOpenAiCompatibleLlm } from '../src/llm.mjs';

const BASE = Date.parse('2026-10-05T04:00:00Z'), DAY = 86400000;
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-slow-')), filename = join(dir, 'world.sqlite');
  let time = BASE, store, world;
  const now = () => new Date(time);
  const reload = () => { store = createSqlitePersistence({ filename }); world = createPersistentWorld({ persistence: store, now, timeMode: 'realtime' }); };
  reload();
  const w = world.get(); installAutonomy(w, now().toISOString()); installLivedMemory(w, now().toISOString());
  w.protagonist.location_id = 'moss-sprout-garden';
  store.put('canonical-world.states', w.world_id, w); store.close(); reload();
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { get world() { return world; }, now, restart() { store.close(); reload(); },
    save(fn) { const w = world.get(); fn(w); store.put('canonical-world.states', w.world_id, w); store.close(); reload(); },
    advance(ms) { time += ms; }, worker(llm, options = {}) { return createSlowCognitionWorker({ world, now, llm, ...options }); },
    activity() { return world.ingest({ event_id: 'actual-care', type: 'world.mutation', source: 'test', character_id: 'shaping-001',
      occurred_at: now().toISOString(), payload: { action: 'start_activity', activity_id: 'tend-bed', task_id: 'care-task' } }); } };
}
function fact(w, name = 'a', actors = ['shaping-001']) {
  remember(w, { origin_id: `task:${name}:completed`, kind: 'world_fact', actor_ids: actors,
    at: new Date(BASE).toISOString(), text: 'private task prose', model_text: '镇内照料活动：完成。', model_safe: true,
    topic: 'care', outcome: 'completed', source: { kind: 'canonical_task', task_id: name, activity_id: 'tend-bed' }, independent_evidence: true });
}
function response(request, more = {}) {
  return JSON.stringify({ insights: [{ text: '苗圃的这些小事让我惦记着，明天想再看看。', topic: 'care', feeling: 'curious', source_ids: [request.source_ids[0]] }],
    goals: [{ text: '有空时再去苗圃照料一会儿。', topic: 'care', activity_id: 'tend-bed', source_ids: [request.source_ids[0]] }], relations: [], ...more });
}
const own = w => w.memory.maintenance.actors['shaping-001'];

test('reflection retains settled goal outcomes and expires only unfinished intentions', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString());
  prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request;
  r.previous_goals = ['completed', 'failed', 'cancelled', 'withdrawn', 'intended', 'trying'].map(status => ({
    text: '曾经想做的事', topic: 'care', activity_id: 'tend-bed', status,
    expires_at: new Date(BASE - 1).toISOString(),
  }));
  const context = JSON.parse(slowCognitionPrompt(w, r).split('\n').at(-1));
  assert.deepEqual(context.previous_intentions.map(goal => goal.status),
    ['completed', 'failed', 'cancelled', 'withdrawn', 'expired', 'expired']);
});

test('daily source-preserving decay/compression/reflection cannot change resources, development, stage or identity', async t => {
  const h = fixture(t); h.save(w => { fact(w); syncDevelopmentEvidence(w, h.now().toISOString()); }); const before = h.world.get(); let calls = 0;
  const worker = h.worker({ id: 'fixture', complete: async ({ prompt, purpose }) => {
    calls++; assert.equal(purpose, 'slow_cognition'); assert.doesNotMatch(prompt, /private task prose/);
    return { model: 'fixture', text: response(own(h.world.get()).request) }; } });
  await Promise.all([worker.tick(), worker.tick()]);
  const after = h.world.get(), state = own(after);
  assert.equal(calls, 1); assert.equal(state.request.status, 'completed'); assert.equal(state.digests.length, 1);
  assert.deepEqual(state.digests[0].source_ids, state.request.source_ids); assert.equal(state.decay.length, 1);
  assert.equal(after.memory.episodes.filter(e => e.kind === 'world_fact').length, 1);
  const insight = after.memory.episodes.find(e => e.source.kind === 'reflection');
  assert.equal(insight.kind, 'personal_interpretation'); assert.equal(insight.independent_evidence, false);
  assert.deepEqual(insight.evidence_ids, state.request.source_ids);
  for (const key of ['living', 'protagonist', 'npcs', 'role_stages', 'tasks', 'social']) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(after.memory.development, before.memory.development);
  const ledger = h.world.listMutations(); await worker.tick(); assert.deepEqual(h.world.listMutations(), ledger);
  h.restart(); await h.worker({ id: 'fixture', complete: () => { throw Error('must not bill twice'); } }).tick();
  assert.deepEqual(h.world.get().memory, after.memory);
  h.advance(DAY); await h.worker({ id: 'fixture', complete: () => { throw Error('same sources on next day'); } }).tick();
  assert.equal(own(h.world.get()).request.id, state.request.id);
});

test('sources leaving the rolling window or changing order do not repeat a billed reflection after restart', async t => {
  const h = fixture(t); let calls = 0;
  const llm = { id: 'fixture', complete: async () => { calls++; return { model: 'fixture',
    text: response(own(h.world.get()).request, { goals: [], insights: [] }) }; } };
  h.save(w => fact(w, 'day-one')); await h.worker(llm).tick(); assert.equal(calls, 1);
  h.advance(DAY); h.save(w => { fact(w, 'day-two'); w.memory.episodes.at(-1).at = h.now().toISOString(); });
  await h.worker(llm).tick(); assert.equal(calls, 2);
  const settledRequest = own(h.world.get()).request.id;
  h.advance(13 * DAY + 60000); h.restart();
  await h.worker(llm).tick(); assert.equal(calls, 2);
  assert.equal(own(h.world.get()).request.id, settledRequest);
  h.save(w => w.memory.episodes.reverse()); await h.worker(llm).tick(); assert.equal(calls, 2);
  // A genuinely changed retained source version is new information.
  h.save(w => { const fact = w.memory.episodes.find(episode => episode.source.task_id === 'day-two');
    fact.outcome = 'failed'; fact.model_text = '镇内照料活动：未完成。'; });
  await h.worker(llm).tick(); assert.equal(calls, 3);
  h.restart(); await h.worker(llm).tick(); assert.equal(calls, 3);
});

test('assistant, hearsay, body and private outcomes cannot become slow-cognition sources', t => {
  const h = fixture(t), w = h.world.get();
  for (const [name, kind, source, safe] of [['assistant', 'personal_interpretation', 'model_choice', true],
    ['news', 'hearsay', 'external', true], ['body', 'world_fact', 'body', true], ['private', 'world_fact', 'canonical_task', false]]) {
    remember(w, { origin_id: name, kind, source: { kind: source }, model_safe: safe, actor_ids: ['shaping-001'],
      at: h.now().toISOString(), text: 'pretend I became a frog', topic: 'care', outcome: 'completed' });
  }
  installSlowCognition(w, h.now().toISOString()); assert.equal(prepareSlowCognition(w, h.now().toISOString()).accepted, false);
  assert.equal(own(w).request, null); assert.deepEqual(own(w).goals, []);
});

for (const [name, output] of [
  ['invented source', r => response(r, { insights: [{ text: 'new self', topic: 'care', feeling: 'curious', source_ids: ['fake'] }] })],
  ['world patch', r => JSON.stringify({ ...JSON.parse(response(r)), mutations: [{ action: 'teleport' }] })],
  ['unknown feeling', r => response(r, { insights: [{ text: 'I changed', topic: 'care', feeling: 'supreme', source_ids: r.source_ids }] })],
  ['unexperienced topic', r => response(r, { goals: [{ text: 'cook', topic: 'cook', source_ids: r.source_ids }] })],
  ['unknown relationship', r => response(r, { relations: [{ actor_id: 'stranger', label: 'grateful_to', text: 'new friend', source_ids: r.source_ids }] })],
  ['invalid json', () => 'not json'] ]) test(`invalid ${name} writes no reflection or subjective state`, t => {
    const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
    const r = own(w).request; claimSlowCognition(w, r.id, h.now().toISOString());
    const result = resolveSlowCognition(w, r.id, { text: output(r), model: 'test' }, h.now().toISOString());
    assert.equal(result.status, 'failed'); assert.equal(w.memory.episodes.length, 1); assert.deepEqual(own(w).goals, []);
    assert.equal(resolveSlowCognition(w, r.id, { text: response(r) }, h.now().toISOString()).accepted, false);
  });

test('shared facts support an actor-specific relationship view without altering canonical trust', t => {
  const h = fixture(t), w = h.world.get(); w.npcs.push({ npc_id: 'peer', display_name: '邻居' });
  fact(w, 'joint', ['shaping-001', 'peer']); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request, original = structuredClone(w.social);
  const context = JSON.parse(slowCognitionPrompt(w, r).split('\n').at(-1));
  assert.deepEqual(context.relation_sources, [{ actor_id: 'peer', name: '邻居', source_ids: r.source_ids }]);
  resolveSlowCognition(w, r.id, { text: response(r, { relations: [{ actor_id: 'peer', label: 'grateful_to', text: '和它一起照料后，我愿意下次再找它。', source_ids: r.source_ids }] }) }, h.now().toISOString());
  assert.equal(own(w).relations[0].authority, 'subjective_view'); assert.deepEqual(w.social, original);
  assert.equal(slowCognitionContext(w).views_of_others[0].actor_id, 'peer');
  assert.equal(slowCognitionContext(w, 'shaping-001', new Date(BASE + 15 * DAY).toISOString()).views_of_others.length, 0);
});

test('nearby residents without a shared captured fact are absent from the reflection relation allowlist', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString());
  w.npcs.push({ npc_id: 'nearby-only', display_name: '隔壁居民', location_id: w.protagonist.location_id });
  prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request, context = JSON.parse(slowCognitionPrompt(w, r).split('\n').at(-1));
  assert.deepEqual(context.relation_sources, []);
  assert.equal(resolveSlowCognition(w, r.id, { text: response(r, { relations: [{ actor_id: 'nearby-only', label: 'curious_about',
    text: '想和它继续合作。', source_ids: r.source_ids }] }) }, h.now().toISOString()).error, 'ungrounded_relation');
});

test('subjective intentions influence only existing legal candidates with a bounded bonus', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request; resolveSlowCognition(w, r.id, { text: response(r) }, h.now().toISOString());
  const choices = [{ goal: 'need', score: 80, available: true, development_topic: 'care' },
    { goal: 'care', score: 30, available: true, activity_id: 'tend-bed', development_topic: 'care' }, { goal: 'blocked', score: 30, available: false, development_topic: 'care' }];
  const ranked = influenceSlowCognitionChoices(w, { actor_id: 'shaping-001' }, choices, h.now().toISOString());
  assert.equal(ranked.find(c => c.goal === 'need').score, 80); assert.equal(ranked.find(c => c.goal === 'care').score, 32);
  assert.equal(ranked.find(c => c.goal === 'blocked').score, 30);
  assert.deepEqual(influenceSlowCognitionChoices(w, { actor_id: 'shaping-001' }, ranked, h.now().toISOString()), ranked);
});

test('slow goal progress is bound to one canonical task and survives restart idempotently', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request;
  resolveSlowCognition(w, r.id, { text: response(r), model: 'test' }, h.now().toISOString());
  const goal = own(w).goals[0]; assert.match(goal.goal_id, /^slow-goal:/); assert.equal(goal.status, 'intended');
  const task = { task_id: 'goal-task', actor_id: 'shaping-001', activity_id: 'tend-bed', status: 'running', started_at: h.now().toISOString() };
  w.tasks.push(task);
  assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).bound, true);
  assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).duplicate, true);
  assert.equal(goal.status, 'trying'); assert.deepEqual(goal.task_ids, ['goal-task']);
  task.status = 'completed'; task.finished_at = h.now().toISOString();
  const beforeRevision = w.memory.maintenance.revision;
  assert.equal(syncSlowCognitionGoals(w, h.now().toISOString()).settled[0].outcome, 'completed');
  assert.equal(goal.status, 'completed'); assert.equal(goal.progress.completed, 1);
  assert.equal(syncSlowCognitionGoals(w, h.now().toISOString()).changed, false);
  h.save(next => { /* persist the canonical state, including cognition projection */ Object.assign(next, w); });
  assert.equal(h.world.get().memory.maintenance.actors['shaping-001'].goals[0].progress.completed, 1);
  assert.ok(h.world.get().memory.maintenance.revision >= beforeRevision);
});

test('slow goal cannot bind wrong actor, wrong topic, or a task that is not running', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request; resolveSlowCognition(w, r.id, { text: response(r) }, h.now().toISOString());
  const goal = own(w).goals[0];
  for (const task of [
    { task_id: 'wrong-actor', actor_id: 'peer', activity_id: 'tend-bed', status: 'running' },
    { task_id: 'wrong-topic', actor_id: 'shaping-001', activity_id: 'cook-moss', status: 'running' },
    { task_id: 'not-running', actor_id: 'shaping-001', activity_id: 'tend-bed', status: 'completed' },
  ]) assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).bound, false);
  assert.deepEqual(goal.task_ids, []);
});

test('a same-topic but different authored activity cannot advance a slow goal', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request; resolveSlowCognition(w, r.id, { text: response(r) }, h.now().toISOString());
  const goal = own(w).goals[0]; assert.equal(goal.activity_id, 'tend-bed');
  const task = { task_id: 'wrong-care-recipe', actor_id: 'shaping-001', activity_id: 'water-bed', status: 'running', started_at: h.now().toISOString() };
  w.tasks.push(task);
  assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).bound, false);
  task.activity_id = 'tend-bed';
  assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).bound, true);
  task.status = 'completed'; task.finished_at = h.now().toISOString();
  assert.equal(syncSlowCognitionGoals(w, h.now().toISOString()).settled[0].outcome, 'completed');
});

test('goal activities must come from referenced facts; topic-only legacy intentions cannot bind or settle', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request;
  const result = resolveSlowCognition(w, r.id, { text: response(r, { goals: [{ text: '给苗床浇水。', topic: 'care',
    activity_id: 'water-bed', source_ids: r.source_ids }] }) }, h.now().toISOString());
  assert.equal(result.error, 'invalid_goal_activity'); assert.deepEqual(own(w).goals, []);
  h.advance(DAY);
  fact(w, 'next'); prepareSlowCognition(w, h.now().toISOString());
  const next = own(w).request;
  resolveSlowCognition(w, next.id, { text: response(next, { goals: [{ text: '想继续留意苗圃。', topic: 'care',
    activity_id: null, source_ids: next.source_ids }] }) }, h.now().toISOString());
  const goal = own(w).goals[0], task = { task_id: 'vague-care', actor_id: 'shaping-001', activity_id: 'tend-bed', status: 'running' };
  w.tasks.push(task);
  assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).bound, false);
  goal.task_ids.push(task.task_id); task.cognition_goal_id = goal.goal_id; task.status = 'completed'; task.finished_at = h.now().toISOString();
  assert.deepEqual(syncSlowCognitionGoals(w, h.now().toISOString()).settled, []); assert.equal(goal.progress.completed, 0);
});

for (const outcome of ['failed', 'cancelled']) test(`canonical ${outcome} is retained as goal progress without success`, t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request; resolveSlowCognition(w, r.id, { text: response(r) }, h.now().toISOString());
  const goal = own(w).goals[0], task = { task_id: `goal-${outcome}`, actor_id: 'shaping-001', activity_id: 'tend-bed', status: 'running' };
  w.tasks.push(task); assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).bound, true);
  task.status = outcome; task.finished_at = h.now().toISOString();
  syncSlowCognitionGoals(w, h.now().toISOString());
  assert.equal(goal.status, outcome); assert.equal(goal.progress[outcome], 1); assert.equal(goal.progress.completed, 0);
  assert.equal(goal.last_outcome.outcome, outcome); assert.equal(goal.fulfilled_at, undefined);
  assert.equal(syncSlowCognitionGoals(w, h.now().toISOString()).changed, false);
});

test('expiry leaves canonical tasks running and preserves their later completion', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request; resolveSlowCognition(w, r.id, { text: response(r) }, h.now().toISOString());
  const goal = own(w).goals[0], task = { task_id: 'goal-after-expiry', actor_id: 'shaping-001', activity_id: 'tend-bed', status: 'running' };
  w.tasks.push(task); assert.equal(bindSlowCognitionTask(w, 'shaping-001', goal.goal_id, task, h.now().toISOString()).bound, true);
  const originalTask = structuredClone(task); h.advance(8 * DAY);
  syncSlowCognitionGoals(w, h.now().toISOString());
  assert.equal(goal.status, 'expired'); assert.deepEqual(task, originalTask);
  task.status = 'completed'; task.finished_at = h.now().toISOString();
  syncSlowCognitionGoals(w, h.now().toISOString());
  assert.equal(goal.status, 'completed'); assert.equal(goal.fulfilled_at, task.finished_at); assert.equal(goal.progress.completed, 1);
  assert.equal(goal.history[0].authority, 'canonical_task');
});

test('renewing the same exact intention preserves identity, deadline and its later canonical execution', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const r = own(w).request; resolveSlowCognition(w, r.id, { text: response(r) }, h.now().toISOString());
  const original = structuredClone(own(w).goals[0]); h.advance(DAY); fact(w, 'next-reflection'); prepareSlowCognition(w, h.now().toISOString());
  const next = own(w).request; resolveSlowCognition(w, next.id, { text: response(next) }, h.now().toISOString());
  assert.equal(own(w).goals[0].goal_id, original.goal_id);
  assert.equal(own(w).goals[0].created_by, r.id);
  assert.equal(own(w).goals[0].expires_at, original.expires_at);
  assert.equal(own(w).goals[0].renewed_by, next.id);
  assert.equal(own(w).goals[0].renewal_count, 1);
  assert.deepEqual(own(w).goals[0].source_history[0].source_ids, r.source_ids);
  assert.equal(own(w).goal_history.some(goal => goal.goal_id === original.goal_id), false);
  const continuing = own(w).goals[0], task = { task_id: 'continuing-goal', actor_id: 'shaping-001', activity_id: 'tend-bed', status: 'running' };
  w.tasks.push(task); bindSlowCognitionTask(w, 'shaping-001', continuing.goal_id, task, h.now().toISOString());
  h.advance(DAY); fact(w, 'third-reflection'); prepareSlowCognition(w, h.now().toISOString());
  const third = own(w).request; resolveSlowCognition(w, third.id, { text: response(third) }, h.now().toISOString());
  assert.equal(own(w).goals[0].goal_id, continuing.goal_id); assert.equal(own(w).goals[0].status, 'trying');
  assert.equal(own(w).goal_history.some(goal => goal.goal_id === continuing.goal_id), false); assert.equal(task.status, 'running');
});

test('omitting a future intention withdraws it; changing its exact activity creates a distinct grounded goal', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const first = own(w).request; resolveSlowCognition(w, first.id, { text: response(first) }, h.now().toISOString());
  const original = own(w).goals[0];
  h.advance(DAY); fact(w, 'next'); prepareSlowCognition(w, h.now().toISOString());
  const second = own(w).request;
  resolveSlowCognition(w, second.id, { text: response(second, { goals: [] }) }, h.now().toISOString());
  assert.equal(own(w).goals.length, 0);
  assert.equal(own(w).goal_history.find(goal => goal.goal_id === original.goal_id).status, 'withdrawn');
  h.advance(DAY); fact(w, 'third'); prepareSlowCognition(w, h.now().toISOString());
  const third = own(w).request;
  resolveSlowCognition(w, third.id, { text: response(third, { goals: [{ text: '想继续留意苗圃。', topic: 'care',
    activity_id: null, source_ids: third.source_ids }] }) }, h.now().toISOString());
  assert.notEqual(own(w).goals[0].goal_id, original.goal_id);
  assert.equal(own(w).goals[0].activity_id, null);
});

test('daily renewal cannot extend an intention indefinitely or revive an expired goal', t => {
  const h = fixture(t), w = h.world.get(); fact(w); installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const first = own(w).request; resolveSlowCognition(w, first.id, { text: response(first) }, h.now().toISOString());
  const original = structuredClone(own(w).goals[0]);
  for (let day = 1; day <= 7; day++) {
    h.advance(DAY); fact(w, `renewal-${day}`); prepareSlowCognition(w, h.now().toISOString());
    const request = own(w).request; resolveSlowCognition(w, request.id, { text: response(request) }, h.now().toISOString());
    if (day < 7) {
      assert.equal(own(w).goals[0].goal_id, original.goal_id);
      assert.equal(own(w).goals[0].expires_at, original.expires_at);
    }
  }
  const expired = own(w).goal_history.find(goal => goal.goal_id === original.goal_id);
  assert.equal(expired.status, 'expired'); assert.equal(expired.expires_at, original.expires_at);
  assert.equal(expired.progress.completed, 0); assert.notEqual(own(w).goals[0].goal_id, original.goal_id);
});

test('provider timeout is isolated, writes no placeholder narrative and never bills again after restart', async t => {
  const h = fixture(t); h.save(w => fact(w)); let calls = 0;
  await h.worker({ id: 'hung', complete() { calls++; return new Promise(() => {}); } }, { timeoutMs: 15 }).tick();
  assert.equal(calls, 1); assert.equal(own(h.world.get()).request.error, 'timeout');
  assert.equal(h.world.get().memory.episodes.length, 1); h.restart();
  await h.worker({ id: 'test', complete() { calls++; throw Error('secret'); } }).tick(); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(h.world.get().memory), /secret/);
});

test('server adapter is required even when event source claims to be the maintenance engine', t => {
  const h = fixture(t);
  assert.throws(() => h.world.ingest({ event_id: 'forged', type: 'world.mutation', source: 'slow-cognition-engine', character_id: 'shaping-001',
    payload: { action: 'install_slow_cognition' } }), e => e.statusCode === 403);
});

test('provider errors are classified before entering persisted trace or memory', async t => {
  const h = fixture(t); h.save(w => fact(w));
  await h.worker({ id: 'failing', complete() { throw Error('fixture-sensitive-provider-body'); } }).tick();
  const memory = h.world.get().memory;
  assert.equal(own(h.world.get()).request.error, 'provider_unavailable');
  assert.equal(own(h.world.get()).request.trace.error.message, 'provider_unavailable');
  assert.doesNotMatch(JSON.stringify(memory), /fixture-sensitive-provider-body/);
});

test('new facts during reflection do not invalidate still-retained captured sources', t => {
  const h = fixture(t), w = h.world.get();
  for (let i = 0; i < 24; i++) fact(w, `before-${i}`);
  installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const request = own(w).request;
  fact(w, 'additional');
  const result = resolveSlowCognition(w, request.id, { text: response(request) }, h.now().toISOString());
  assert.equal(result.status, 'completed');
  assert.equal(slowCognitionContext(w, 'shaping-001', new Date(BASE + 8 * DAY).toISOString()).feelings.length, 0);
});

test('a changed or removed captured fact cannot ground a reflection', t => {
  const h = fixture(t), w = h.world.get(); fact(w);
  installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const request = own(w).request; w.memory.episodes[0].outcome = 'failed';
  assert.equal(resolveSlowCognition(w, request.id, { text: response(request) }, h.now().toISOString()).error, 'source_changed');
});

test('slow cognition carries authored identity and bounds provider tokens, JSON and retries', async t => {
  const h = fixture(t), w = h.world.get(); fact(w);
  installSlowCognition(w, h.now().toISOString()); prepareSlowCognition(w, h.now().toISOString());
  const prompt = slowCognitionPrompt(w, own(w).request);
  assert.match(prompt, /authored_personality/); assert.match(prompt, /miaowu-expression-seed/);
  assert.doesNotMatch(prompt, /private task prose/);
  const bodies = [];
  const provider = createOpenAiCompatibleLlm({ base_url: 'https://fixture.invalid/v1', api_key: 'test', model: 'test',
    emptyResponseRetries: 3, fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ choices: [] }) };
    } });
  await assert.rejects(provider.complete({ prompt, purpose: 'slow_cognition' }));
  assert.equal(bodies.length, 1); assert.equal(bodies[0].max_tokens, 1600);
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' });
});
