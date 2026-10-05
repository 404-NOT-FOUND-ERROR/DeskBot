import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSqlitePersistence } from '../apps/deskbot-service/src/persistence.mjs';
import { createPersistentWorld } from '../apps/deskbot-service/src/persistent-world.mjs';
import { createRoleProposalStore } from '../apps/deskbot-service/src/role-proposals.mjs';
import { createRoleEvolution } from '../apps/deskbot-service/src/role-evolution.mjs';
import { computeFantasyPull } from '../apps/deskbot-service/src/fantasy-pull.mjs';
import { memoryReadModel } from '../apps/deskbot-service/src/lived-memory.mjs';
import { practicalTrialReadModel } from '../apps/deskbot-service/src/role-practical-trials.mjs';
import { syncLifeNeeds } from '../apps/deskbot-service/src/life-state.mjs';

// Carry forward the stage-four isolated, actually executed prerequisite sample.
// Neither that authored schedule nor the rules-only trial below establishes
// spontaneous model preference. No installed world or provider is accessed.
await import('./review-role-wishes.mjs');
const source = JSON.parse(readFileSync(new URL('../tmp/role-wishes-model-worlds.json', import.meta.url), 'utf8'))
  .find(sample => sample.id === 'prepared');
assert.ok(source);
const OWNER = source.world.protagonist.character_id;
const prepared = source.proposals.find(p => p.direction_id === 'wetland_frog' && p.status === 'prepared');
assert.ok(prepared);
mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
const filename = fileURLToPath(new URL(`../tmp/practical-trial-review-${process.pid}-${Date.now()}.sqlite`, import.meta.url));
let time = Date.parse(source.now), sequence = 0, persistence, world, roles, evolution;
const now = () => new Date(time), iso = () => now().toISOString();
function reload() {
  persistence?.close();
  persistence = createSqlitePersistence({ filename, now });
  world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
  roles = createRoleProposalStore({ persistence, now });
  evolution = createRoleEvolution({ persistence, now, roles, inputStore: { list: () => [] }, computeFantasyPull,
    worldSnapshot: () => world.get() });
}
reload();
const baseline = structuredClone(source.world);
baseline.memory.planner.enabled = false;
for (const state of Object.values(baseline.autonomy.actors)) state.paused = state.actor_id !== OWNER;
persistence.put('canonical-world.states', baseline.world_id, baseline);
persistence.put('role.proposals', prepared.proposal_id, prepared);
reload();
const identity = structuredClone(world.get().protagonist.appearance), priorRoots = new Set(world.get().memory.development.records.map(r => r.root_outcome_id));
const samples = [], modelSamples = [];
const trial = () => practicalTrialReadModel(world.get(), { proposalId: prepared.proposal_id, actorId: OWNER, at: iso() });
function sample(id, label, summary, extra = {}) {
  const state = world.get(), full = evolution.snapshot({ characterId: OWNER });
  // The review needs current wishes and actual memory, not a full duplicate of
  // every historic evolution-run context in each sample.
  const read = { schema: full.schema, rule_version: full.rule_version, character_id: OWNER,
    development: full.development, wishes: full.wishes, practical_trials: full.practical_trials,
    candidates: [], evidence: [], pulls: [], runs: [], cooldowns: [] };
  const proposals = evolution.wishProposals({ characterId: OWNER });
  samples.push({ id, label, summary, now: iso(), memory: memoryReadModel(state), evolution: read, proposals, ...extra });
  modelSamples.push({ id, now: iso(), world: state, proposals });
}
function mutate(payload) {
  const internal = ['start_role_practical_trial', 'control_role_practical_trial'].includes(payload.action);
  return world.ingest({ event_id: `review-practical-${sequence++}`, type: 'world.mutation',
    source: internal ? 'role-practical-trial-engine' : 'authored-practical-fixture', source_kind: 'world_engine',
    character_id: OWNER, occurred_at: iso(), payload }, internal ? { rolePracticalInternal: true } : {});
}
function tick(minutes = 1) {
  time += minutes * 60_000;
  const state = world.get(); syncLifeNeeds(state, iso());
  persistence.put('canonical-world.states', state.world_id, state); reload();
  world.syncWallClock({ maxCatchUpMinutes: 120 }); world.syncTasks();
  mutate({ action: 'advance_autonomous_life' });
}
function until(check, limit = 5000) {
  for (let i = 0; i < limit; i++) { if (check()) return; tick(2); }
  throw new Error(`Trial review timed out: ${JSON.stringify(trial())}`);
}
sample('prepared-before', '已有愿望，尚未开始', '沿用第 4 阶段通过真实路线与配方形成的前置经历和主人支持。尚未登记实际试做，也没有新的试做成果。');
mutate({ action: 'start_role_practical_trial', proposal_id: prepared.proposal_id, actor_id: OWNER,
  direction_id: prepared.direction_id, wish_basis: prepared.wish_basis, variant: 'waterside' });
until(() => trial()?.active_task?.step_role === 'primary');
sample('running-real', '开始真实活动', '规则选择器在处理基本需要后，选择已准备的水岸试做。已经有真实主要任务、期限与材料预留，正在执行仍不算完成。');
const activeId = trial().active_task.task_id, beforePause = structuredClone(world.get().living.inventories[OWNER]?.stock);
mutate({ action: 'control_role_practical_trial', trial_id: trial().trial_id, operation: 'pause' });
assert.equal(trial().status, 'paused');
assert.equal(world.get().tasks.find(t => t.task_id === activeId).status, 'cancelled');
assert.equal(trial().progress.successful_primary, 0);
sample('paused-refund', '暂停并释放当前试做', '暂停确实取消了本试做的主要任务，原执行器处理退款和取消结果。未完成部分没有变成实践成果，日常生活仍可继续。');
mutate({ action: 'control_role_practical_trial', trial_id: trial().trial_id, operation: 'adjust', variant: 'nursery' });
assert.equal(trial().variant_id, 'nursery');
sample('adjusted', '调整未开始的方向', '暂停后调整为苗圃方向。原取消结果和提出愿望的依据保留，不补发材料，也不改写已做过的事情。');
mutate({ action: 'control_role_practical_trial', trial_id: trial().trial_id, operation: 'pause' });
mutate({ action: 'control_role_practical_trial', trial_id: trial().trial_id, operation: 'adjust', variant: 'waterside' });
mutate({ action: 'control_role_practical_trial', trial_id: trial().trial_id, operation: 'pause' });
mutate({ action: 'control_role_practical_trial', trial_id: trial().trial_id, operation: 'resume' });
sample('blocked-day', '当天已尝试，先继续生活', '主要练习的开始记录受上海日历限额约束。恢复不重复消耗旧预留，也不会立刻把取消当成成功；之后仍需实际经过时间。');
until(() => trial()?.progress.successful_primary >= 1);
sample('first-result', '第一份实际结果', '主要配方已经按原规则实际完成，引用同一件任务结果。一次成功仍不足以回顾跨日试做，也不证明喜欢、熟练或获得职业资格。');
until(() => trial()?.status === 'review');
assert.ok(trial().progress.successful_primary >= 2);
assert.ok(trial().progress.primary_days.length >= 2);
sample('review-two-days', '跨日结果，可以回看', '两个上海日留下主要练习的实际成功。规则回顾可以说明做过和遇到的条件，尚未测得作品质量或情感喜欢，也没有接受新形态。');
const beforeRestart = world.get(), beforeTrial = trial();
reload(); assert.deepEqual(world.get(), beforeRestart); assert.deepEqual(trial(), beforeTrial);
sample('restart', '重新载入，沿用结果', '真实 SQLite 关闭并重新载入，试做、取消、跨日结果和共同根均保留，没有再次执行配方或重复增加次数。', { restart_verified: true });
mutate({ action: 'control_role_practical_trial', trial_id: trial().trial_id, operation: 'exit' });
evolution.reconcilePracticalExit(prepared.proposal_id);
assert.equal(trial().status, 'exited');
assert.equal(roles.get(prepared.proposal_id).status, 'withdrawn');
sample('exited', '退出后保留经历', '结束这段实际安排，已完成和取消的结果仍保留。原愿望同时保存主人退出回应，释放方向轴和进入重提冷却。');
assert.deepEqual(world.get().protagonist.appearance, identity);
const roots = world.get().memory.development.records;
assert.ok([...priorRoots].every(root => roots.some(r => r.root_outcome_id === root)));
const document = { schema: 'deskbot.practical-role-trials-review.v1', simulated: true, live_world_untouched: true,
  experiment: { persistence: 'sqlite', external_calls: 0, actors_active: 1, actors_total: 13,
    prerequisite_choices: 'stage4_authored_schedule_with_actual_execution', trial_choices: 'ordinary_bounded_rules',
    forced_trial_choices: false, extra_resource_refills: false, actual_role_acceptance: false, appearance_changes: false }, samples };
writeFileSync(new URL('../apps/jev-town-client/public/role-practical-trials-review.json', import.meta.url), JSON.stringify(document, null, 2));
writeFileSync(new URL('../tmp/role-practical-trials-model-worlds.json', import.meta.url), JSON.stringify(modelSamples));
console.log(JSON.stringify({ samples: samples.map(s => s.id), new_actual_roots: roots.length - priorRoots.size,
  trial_progress: trial().progress, status: trial().status, restart_verified: true, live_world_untouched: true, before_pause_stock: beforePause }));
persistence.close();
