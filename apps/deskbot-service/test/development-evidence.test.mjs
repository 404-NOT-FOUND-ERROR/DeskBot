import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVELOPMENT_VERSION, syncDevelopmentEvidence, developmentReadModel } from '../src/development-evidence.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { installLivedMemory, syncLivedMemory, memoryReadModel, retrieveModelMemory } from '../src/lived-memory.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { LIVING_RULE_VERSION } from '../src/living-resources.mjs';

const OWN = 'shaping-001', GROWER = 'wetland-grower-001';
const START = '2026-10-05T04:00:00.000Z', END = '2026-10-05T05:00:00.000Z';
function world() {
  return { protagonist: { character_id: OWN, display_name: '喵呜' }, npcs: [{ npc_id: GROWER, display_name: '苔团' }],
    clock: { mode: 'real_time', time_zone: 'Asia/Shanghai', synced_at: END }, tasks: [],
    memory: { schema: 'deskbot.lived-memory.v1', installed_at: START, episodes: [], seen: [], actors: { [OWN]: { actor_id: OWN, interests: {} } }, revision: 0,
      planner: { enabled: false, requests: {}, attempts: [], recent: [] } }, social: { commitments: [], recent: [] } };
}
function task(id = 'actual-care', more = {}) {
  return { task_id: id, actor_id: OWN, status: 'completed', kind: 'care', activity_id: 'tend-bed', life_goal: 'tend',
    location_id: 'moss-sprout-garden', started_at: START, finished_at: END, completion_effect: LIVING_RULE_VERSION,
    origin: 'autonomous_life', life_source_ids: [], life_plan_id: `plan:${id}`, cause_event_id: `start:${id}`,
    life_decision: { source: 'rules', reason: '模型或用户的私人说明不能出现在证据读模' },
    completion: { due_at: END, effect: LIVING_RULE_VERSION, result: { success: true } }, ...more };
}
function episode(id = 'old-fact', more = {}) {
  return { id: `memory:${id}`, origin_id: id, kind: 'world_fact', actor_ids: [OWN], at: END, text: '旧存档中的私人任务说明', topic: 'care', outcome: 'completed',
    source: { kind: 'canonical_task', task_id: 'actual-care', activity_id: 'tend-bed' }, independent_evidence: true, model_safe: true, model_text: '镇内照料：完成。', ...more };
}

test('installation is additive and never rewrites interest scores, identity, tasks or the model-safe projection', () => {
  const w = world(); w.tasks = [task()]; w.memory.episodes = [episode()];
  w.memory.actors[OWN].interests.care = { stage: 'trying', bonus: 6, successes: 5, setbacks: 0, days: ['2026-10-03', '2026-10-04', '2026-10-05'] };
  const before = structuredClone({ actors: w.memory.actors, tasks: w.tasks, protagonist: w.protagonist, model: retrieveModelMemory(w) });
  const sync = syncDevelopmentEvidence(w, END), view = developmentReadModel(w);
  assert.equal(sync.installed, true); assert.equal(view.schema, DEVELOPMENT_VERSION); assert.equal(view.counts.roots, 1); assert.equal(view.counts.practice, 1);
  assert.equal(view.recent[0].historical_import, true); assert.equal(w.memory.episodes[0].root_outcome_id, 'task:actual-care');
  assert.deepEqual(w.memory.actors, before.actors); assert.deepEqual(w.tasks, before.tasks); assert.deepEqual(w.protagonist, before.protagonist);
  assert.deepEqual(retrieveModelMemory(w), before.model);
});

test('an owner suggestion followed by a real recipe is practice even though the old interest exclusion remains', () => {
  const w = world(); syncDevelopmentEvidence(w, START);
  w.refraction = { records: [{ id: 'owner-suggestion', origin_id: 'owner-event', category: 'dialogue', attested: true,
    text: 'PRIVATE OWNER INPUT', source_label: '私人姓名', source_url: 'private-url' }] };
  w.tasks = [task('owner-care', { life_goal: 'input:tend', life_source_ids: ['owner-suggestion'], life_decision: { source: 'model', model: 'test-model',
    request_id: 'choice:1', memory_ids: ['memory:actual-old'], reason: 'PRIVATE MODEL REASON' } })];
  syncDevelopmentEvidence(w, END);
  const view = developmentReadModel(w), r = view.recent[0], topic = view.actors[0].topics.care;
  assert.equal(r.historical_import, false); assert.equal(r.effect.practice, true); assert.equal(r.effect.legacy_interest_eligible, false);
  assert.equal(r.topic, 'care'); assert.equal(r.causes.trigger, 'invited'); assert.equal(r.causes.sources[0].category, 'user'); assert.equal(r.causes.sources[0].attested, true);
  assert.deepEqual(r.causes.source_event_ids, ['owner-event', 'start:owner-care']); assert.equal(topic.invited, 1); assert.equal(topic.completed, 1);
  assert.equal(r.title, '整理和照料苗木'); assert.doesNotMatch(JSON.stringify(view), /PRIVATE|私人姓名|private-url/);
  assert.deepEqual(w.memory.actors[OWN].interests, {});
});

test('task, project history and multiple memories share one terminal root after the task has been pruned', () => {
  const w = world(); w.tasks = [task('career-stage', { activity_id: 'seedbed-survey', life_goal: 'project:floating-seedbed:survey', project_id: 'floating-seedbed', project_stage_id: 'survey' })];
  w.resident_projects = { projects: { 'floating-seedbed': { project_id: 'floating-seedbed', owner_id: OWN,
    history: [{ task_id: 'career-stage', actor_id: OWN, activity_id: 'seedbed-survey', stage_id: 'survey', outcome: 'completed', at: END, location_id: 'echo-waterside' }], evidence: [] } } };
  w.memory.episodes = [episode('task-view', { source: { kind: 'canonical_task', task_id: 'career-stage', activity_id: 'seedbed-survey' } }),
    episode('project-view', { source: { kind: 'resident_project', task_id: 'career-stage', project_id: 'floating-seedbed', stage_id: 'survey' }, independent_evidence: false })];
  syncDevelopmentEvidence(w, END); const before = developmentReadModel(w);
  assert.equal(before.counts.roots, 1); assert.equal(before.counts.practice, 1); assert.equal(before.recent[0].views.memory_ids.length, 2);
  assert.deepEqual(before.recent[0].views.project_stages, [{ project_id: 'floating-seedbed', stage_id: 'survey' }]);
  w.tasks = []; syncDevelopmentEvidence(w, END);
  assert.deepEqual(developmentReadModel(w), before);
});

test('commitment results have a separate relationship facet and refer to actual tasks without re-counting practice', () => {
  const w = world(); w.tasks = [task('shared-care', { actor_id: GROWER, origin: 'social_life', social_commitment_id: 'cooperation:1' })];
  w.social.commitments = [{ id: 'cooperation:1', kind: 'cooperate', actors: [OWN, GROWER], status: 'completed', finished_at: END,
    location_id: 'moss-sprout-garden', tasks: {}, changes: [{ task_id: 'shared-care' }, { task_id: 'old-travel' }], title: 'PRIVATE SOCIAL TITLE' }];
  w.social.recent = [{ commitment_id: 'cooperation:1', task_id: 'drained-task' }];
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w), r = view.recent.find(r => r.effect.relationship);
  assert.equal(view.counts.roots, 2); assert.equal(view.counts.practice, 1); assert.equal(view.counts.relationship, 1);
  assert.deepEqual(r.views.linked_task_roots, ['task:drained-task', 'task:old-travel', 'task:shared-care']); assert.equal(r.effect.practice, false);
  assert.deepEqual(view.recent.find(r => r.effect.practice).views.commitment_ids, ['cooperation:1']);
  assert.equal(view.actors.find(a => a.actor_id === OWN).practice, 0); assert.equal(view.actors.find(a => a.actor_id === GROWER).practice, 1);
  assert.equal(developmentReadModel(w, { actorId: OWN }).counts.practice, 0); assert.doesNotMatch(JSON.stringify(view), /PRIVATE SOCIAL TITLE/);
});

test('historical project ownership cannot give another actor credit for an actual helper task', () => {
  const w = world(); w.tasks = [task('helper-work', { actor_id: GROWER, activity_id: 'seedbed-inspect', life_goal: 'project:floating-seedbed:inspect', project_id: 'floating-seedbed', project_stage_id: 'inspect' })];
  w.resident_projects = { projects: { 'floating-seedbed': { project_id: 'floating-seedbed', owner_id: OWN,
    history: [{ task_id: 'helper-work', activity_id: 'seedbed-inspect', stage_id: 'inspect', outcome: 'completed', at: END }], evidence: [] } } };
  w.memory.episodes = [episode('misleading-project-owner', { actor_ids: [OWN], source: { kind: 'resident_project', task_id: 'helper-work', project_id: 'floating-seedbed' } })];
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w);
  assert.deepEqual(view.recent[0].actor_ids, [GROWER]); assert.equal(developmentReadModel(w, { actorId: OWN }).counts.practice, 0);
  w.tasks = []; syncDevelopmentEvidence(w, END); assert.deepEqual(developmentReadModel(w).recent[0].actor_ids, [GROWER]);
});

test('failed and cancelled recipe attempts retain transaction failure reasons without inventing a personality or skill judgment', () => {
  const w = world(); w.tasks = [task('blocked-at-end', { status: 'failed', failure_reason: '设施已损坏，材料归还', failure_code: 'facility_damaged', completion: { due_at: END, effect: 'no_effect' } }),
    task('cancelled-work', { status: 'cancelled', failure_reason: null, completion: null })];
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w), topic = view.actors[0].topics.care;
  assert.equal(view.counts.practice, 2); assert.equal(topic.failed, 1); assert.equal(topic.cancelled, 1); assert.equal(topic.completed, 0);
  const failure = view.recent.find(r => r.outcome === 'failed'); assert.equal(failure.effect.completion_effect, 'no_effect');
  assert.deepEqual(failure.failure, { reason: '设施已损坏，材料归还', code: 'facility_damaged', classification: 'unclassified' });
  assert.deepEqual(w.memory.actors[OWN].interests, {}); assert.doesNotMatch(JSON.stringify(view.recent), /讨厌|能力差/);
});

test('travel, rest and record-only observations remain facts and cannot become material practice', () => {
  const w = world(); w.tasks = [task('travel', { kind: 'travel', activity_id: null, completion_effect: undefined, completion: { due_at: END, effect: 'validated_location_change' } }),
    task('rest', { activity_id: null, life_goal: 'rest', life_action: 'rest', completion_effect: 'record_activity_only' }),
    task('observe', { activity_id: null, life_goal: 'interest:moss-sprout-garden', life_action: 'observe', completion_effect: 'record_activity_only', completion: { due_at: END, effect: 'record_activity_only' } })];
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w);
  assert.equal(view.counts.roots, 3); assert.equal(view.counts.practice, 0); assert.equal(view.recent.find(r => r.root_outcome_id === 'task:observe').effect.legacy_interest_eligible, true);
  assert.ok(view.recent.every(r => !r.effect.practice));
});

test('legacy memory can backfill retained canonical activity roots while missing causal details remain unknown', () => {
  const w = world(); w.memory.episodes = [episode(), episode('project', { source: { kind: 'resident_project', task_id: 'actual-care', project_id: 'floating-seedbed', stage_id: 'survey' }, independent_evidence: false }),
    episode('body', { source: { kind: 'body', record_id: 'touch' }, outcome: 'received' }),
    episode('account', { kind: 'hearsay', source: { kind: 'dialogue' } }), episode('model', { kind: 'personal_interpretation', source: { kind: 'model_choice' } }),
    episode('assistant', { source: { kind: 'assistant_reply' } }), episode('unsourced', { source: { kind: 'authored_scene' } })];
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w);
  assert.equal(view.counts.roots, 1); assert.equal(view.counts.practice, 1); assert.equal(view.counts.historical_import, 1);
  assert.equal(view.recent[0].causes.trigger, 'unknown'); assert.equal(view.coverage.causality_unknown_roots, 1);
  assert.equal(w.memory.episodes[0].root_outcome_id, 'task:actual-care'); assert.equal(w.memory.episodes.find(e => e.id === 'memory:model').root_outcome_id, undefined);
  assert.doesNotMatch(JSON.stringify(view), /旧存档中的私人任务说明/);
});

test('a project view does not erase the archived task view of old interest eligibility', () => {
  const w = world(); w.resident_projects = { projects: { 'floating-seedbed': { project_id: 'floating-seedbed', owner_id: OWN,
    history: [{ task_id: 'pruned-survey', actor_id: OWN, activity_id: 'seedbed-survey', stage_id: 'survey', outcome: 'completed', at: END }], evidence: [] } } };
  w.memory.episodes = [episode('pruned-task', { source: { kind: 'canonical_task', task_id: 'pruned-survey', activity_id: 'seedbed-survey' }, independent_evidence: true })];
  syncDevelopmentEvidence(w, END); const r = developmentReadModel(w).recent[0];
  assert.equal(r.source.kind, 'resident_project'); assert.equal(r.effect.legacy_interest_eligible, true); assert.equal(r.effect.legacy_interest_known, true);
  assert.equal(r.causes.trigger, 'unknown'); assert.equal(developmentReadModel(w).counts.practice, 1);
});

test('repeated sync, serialization restart and read projections are idempotent', () => {
  let w = world(); w.tasks = [task()]; syncLivedMemory(w, END);
  const before = structuredClone(w), view = memoryReadModel(w);
  assert.equal(view.development.enabled, true); assert.equal(syncDevelopmentEvidence(w, END).changed, false);
  assert.deepEqual(w, before); w = JSON.parse(JSON.stringify(w)); syncLivedMemory(w, END); assert.deepEqual(w, before);
  developmentReadModel(w, { actorId: OWN }); memoryReadModel(w); assert.deepEqual(w, before);
});

test('task retention beyond one hundred and memory pruning preserve the root once it has been linked', () => {
  const w = world(); w.tasks = Array.from({ length: 150 }, (_, i) => task(`past-${i}`, { finished_at: new Date(Date.parse(START) + i * 1000).toISOString(), completion: { due_at: new Date(Date.parse(START) + i * 1000).toISOString(), effect: LIVING_RULE_VERSION } }));
  syncLivedMemory(w, END); const before = developmentReadModel(w, { limit: 2048 });
  assert.equal(before.counts.roots, 150); assert.equal(before.counts.practice, 150);
  w.tasks = w.tasks.slice(-100); w.memory.episodes = []; syncDevelopmentEvidence(w, END);
  assert.equal(developmentReadModel(w).counts.roots, 150); assert.equal(developmentReadModel(w, { limit: 2048 }).recent.length, 150);
  assert.deepEqual(developmentReadModel(w, { limit: 2048 }), before);
});

test('a conflicting historical view cannot create a second outcome or replace the actual canonical terminal result', () => {
  const w = world(); w.tasks = [task('one-root')]; w.memory.episodes = [episode('wrong-old-view', { outcome: 'failed', source: { kind: 'canonical_task', task_id: 'one-root', activity_id: 'tend-bed' } })];
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w);
  assert.equal(view.counts.roots, 1); assert.equal(view.counts.completed, 1); assert.equal(view.counts.failed, 0);
  assert.deepEqual(view.recent[0].views.conflicting_outcomes, [{ source_kind: 'legacy_memory_fact', outcome: 'failed' }]);
  assert.equal(syncDevelopmentEvidence(w, END).changed, false);
});

test('missing source records stay unknown after pruning and do not become attested owner inputs', () => {
  const w = world(); w.tasks = [task('old-invite', { life_source_ids: ['missing-source'] })]; syncDevelopmentEvidence(w, END);
  const r = developmentReadModel(w).recent[0]; assert.equal(r.effect.practice, true); assert.equal(r.causes.trigger, 'unknown');
  assert.equal(r.causes.sources[0].category, 'unknown'); assert.equal(r.causes.sources[0].attested, false);
  w.refraction = { records: [{ id: 'missing-source', origin_id: 'recovered-id', category: 'dialogue', attested: true }] };
  syncDevelopmentEvidence(w, END); const known = developmentReadModel(w).recent[0]; assert.equal(known.causes.sources[0].category, 'user');
  w.refraction.records = []; syncDevelopmentEvidence(w, END); assert.equal(developmentReadModel(w).recent[0].causes.sources[0].category, 'user');
});

test('execution-time source metadata survives input pruning and distinguishes actual event IDs from aliases', () => {
  const w = world(); w.tasks = [task('snapshot-care', { life_source_ids: ['owner-source'], life_source_context: [
    { record_id: 'owner-source', event_id: 'actual-input-id', origin_id: 'correlation-alias', category: 'user', attested: true } ] })];
  w.refraction = { records: [] }; syncDevelopmentEvidence(w, END); const r = developmentReadModel(w).recent[0];
  assert.equal(r.causes.trigger, 'invited'); assert.equal(r.causes.sources[0].event_id, 'actual-input-id'); assert.equal(r.causes.sources[0].origin_id, 'correlation-alias');
  assert.deepEqual(r.causes.source_event_ids, ['actual-input-id', 'correlation-alias', 'start:snapshot-care']);
  assert.equal(r.effect.practice, true); assert.equal(r.effect.legacy_interest_eligible, false);
  w.tasks = []; syncDevelopmentEvidence(w, END); assert.deepEqual(developmentReadModel(w).recent[0], r);
});

test('weather, external news and body context may inform autonomous practice without turning it into an invitation', () => {
  const w = world(); w.tasks = ['weather', 'external', 'body'].map(category => task(`context-${category}`, {
    life_source_ids: [`source-${category}`], life_source_context: [{ record_id: `source-${category}`, event_id: `event-${category}`, category, attested: true }] }));
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w);
  assert.equal(view.counts.practice, 3); assert.equal(view.actors[0].topics.care.own, 3); assert.equal(view.actors[0].topics.care.invited, 0);
  assert.ok(view.recent.every(r => r.causes.trigger === 'own' && !r.effect.legacy_interest_eligible));
});

test('an unverified execution source cannot acquire attestation from a changed current input record', () => {
  const w = world(); w.tasks = [task('unverified', { life_source_ids: ['source'], life_source_context: [{ record_id: 'source', event_id: 'original-event', category: 'user', attested: false }] })];
  w.refraction = { records: [{ id: 'source', event_id: 'new-event', category: 'dialogue', attested: true }] };
  syncDevelopmentEvidence(w, END); const r = developmentReadModel(w).recent[0];
  assert.equal(r.causes.sources[0].attested, false); assert.equal(r.causes.sources[0].event_id, 'original-event'); assert.equal(r.causes.trigger, 'unknown');
});

test('disabled and actor-filtered read models are safe and counts do not depend on display limit', () => {
  assert.equal(developmentReadModel(null).enabled, false); assert.equal(developmentReadModel({}).counts.roots, 0);
  const w = world(); w.tasks = [task('own'), task('grower', { actor_id: GROWER })]; syncDevelopmentEvidence(w, END);
  assert.equal(developmentReadModel(w, { limit: 1 }).counts.roots, 2); assert.equal(developmentReadModel(w, { limit: 0 }).recent.length, 0);
  assert.equal(developmentReadModel(w, { actorId: GROWER }).counts.roots, 1); assert.equal(developmentReadModel(w, { actorId: 'missing' }).counts.roots, 0);
});

test('bounded records retain newest unique roots and report a retained-record scope', () => {
  const w = world(); w.tasks = Array.from({ length: 2050 }, (_, i) => task(`bounded-${i}`, { finished_at: new Date(Date.parse(START) + i * 1000).toISOString(), completion: { due_at: new Date(Date.parse(START) + i * 1000).toISOString(), effect: LIVING_RULE_VERSION } }));
  syncDevelopmentEvidence(w, END); const view = developmentReadModel(w, { limit: 5000 });
  assert.equal(view.counts.roots, 2048); assert.equal(view.recent.length, 2048); assert.equal(view.coverage.retention.counts_scope, 'retained_unique_root_outcomes');
  assert.equal(view.recent.some(r => r.root_outcome_id === 'task:bounded-0'), false);
  assert.equal(syncDevelopmentEvidence(w, END).changed, false);
});

test('a real SQLite recipe completion links an owner input once, consumes resources and survives restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-development-')); const file = join(dir, 'isolated.sqlite'); let time = Date.parse(START);
  const now = () => new Date(time); let persistence = createSqlitePersistence({ filename: file }), core;
  function reload() { core = createPersistentWorld({ persistence, now, timeMode: 'realtime' }); }
  reload(); t.after(() => { persistence.close(); rmSync(dir, { recursive: true, force: true }); });
  const initial = core.get(); initial.protagonist.location_id = 'moss-sprout-garden'; installAutonomy(initial, START); installLivedMemory(initial, START);
  persistence.put('canonical-world.states', initial.world_id, initial); reload();
  const mutate = (event_id, action, more = {}) => core.ingest({ event_id, type: 'world.mutation', source: 'isolated-rules', character_id: OWN, occurred_at: now().toISOString(), payload: { action, ...more } });
  mutate('install-input', 'install_input_refraction');
  core.ingest({ event_id: 'owner-actual', type: 'user.preference.life', source: 'user', character_id: OWN, occurred_at: START, payload: { suggestion: 'tend', text: 'PRIVATE OWNER NOTE' } }, { attestedKind: 'user', sourceLabel: '用户建议' });
  const sourceId = core.get().refraction.records.find(r => r.origin_id === 'owner-actual').id;
  const beforeWater = core.get().living.objects['seedling-rack'].stock.water;
  mutate('start-real-care', 'start_activity', { activity_id: 'tend-bed', actor_id: OWN, task_id: 'real-owner-care' });
  const started = core.get(), actual = started.tasks.find(t => t.task_id === 'real-owner-care');
  Object.assign(actual, { origin: 'autonomous_life', life_goal: 'input:tend', life_source_ids: [sourceId], life_plan_id: 'owner-plan', life_decision: { source: 'rules' } });
  persistence.put('canonical-world.states', started.world_id, started); reload();
  assert.equal(developmentReadModel(core.get()).counts.practice, 0);
  time = Date.parse(actual.due_at); core.syncWallClock(); core.syncTasks();
  const view = developmentReadModel(core.get()), r = view.recent.find(r => r.root_outcome_id === 'task:real-owner-care');
  assert.equal(r.effect.practice, true); assert.equal(r.effect.legacy_interest_eligible, false); assert.equal(r.causes.sources[0].category, 'user');
  assert.equal(core.get().living.objects['seedling-rack'].stock.water, beforeWater - 1);
  assert.equal(core.get().memory.actors[OWN].interests.care, undefined);
  persistence.close(); persistence = createSqlitePersistence({ filename: file }); reload();
  assert.deepEqual(developmentReadModel(core.get()), view); assert.doesNotMatch(JSON.stringify(view), /PRIVATE OWNER NOTE/);
});
