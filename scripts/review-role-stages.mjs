import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSqlitePersistence } from '../apps/deskbot-service/src/persistence.mjs';
import { createPersistentWorld, getWorldMap } from '../apps/deskbot-service/src/persistent-world.mjs';
import { createRoleProposalStore } from '../apps/deskbot-service/src/role-proposals.mjs';
import { createRoleEvolution } from '../apps/deskbot-service/src/role-evolution.mjs';
import { computeFantasyPull } from '../apps/deskbot-service/src/fantasy-pull.mjs';
import { memoryReadModel, syncLivedMemory } from '../apps/deskbot-service/src/lived-memory.mjs';
import { advanceAutonomousLife } from '../apps/deskbot-service/src/autonomous-life.mjs';
import { advanceLivingResources } from '../apps/deskbot-service/src/living-resources.mjs';
import { activeWorldTask, applyRealTimeClock, advanceWorldTask } from '../apps/deskbot-service/src/realtime-world.mjs';
import { startPracticalTrial, settlePracticalTrials, practicalTrialReadModel } from '../apps/deskbot-service/src/role-practical-trials.mjs';
import { roleStagePreview, acceptRoleStage, rollbackRoleStage, roleStagesReadModel } from '../apps/deskbot-service/src/role-stages.mjs';

// Reproduce the previous real prerequisite schedule; preserve its separately
// accepted public review. No installed DB, credential or external API is used.
const previousReview = new URL('../apps/jev-town-client/public/role-wishes-review.json', import.meta.url);
const previousBytes = readFileSync(previousReview);
try { await import('./review-role-wishes.mjs'); } finally { writeFileSync(previousReview, previousBytes); }
const source = JSON.parse(readFileSync(new URL('../tmp/role-wishes-model-worlds.json', import.meta.url))).find(s => s.id === 'two-axes');
assert.ok(source);
mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
const filename = fileURLToPath(new URL(`../tmp/role-stages-${process.pid}-${Date.now()}.sqlite`, import.meta.url));
const OWNER = source.world.protagonist.character_id, M = 60_000;
let time = Date.parse(source.now), w = structuredClone(source.world), persistence, persistent, roles, evolution;
const now = () => new Date(time), iso = () => now().toISOString();
function reload() {
  persistence?.close(); persistence = createSqlitePersistence({ filename, now });
  persistent = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
  roles = createRoleProposalStore({ persistence, now });
  evolution = createRoleEvolution({ persistence, now, roles, inputStore: { list: () => [] }, computeFantasyPull, worldSnapshot: () => w });
}
reload();
// A finite counterfactual starting stock/need branch makes both opportunities
// inspectable. It is recorded here, never applied to the installed world.
for (const actor of Object.values(w.autonomy.actors)) actor.paused = actor.actor_id !== OWNER;
Object.assign(w.living.objects['garden-bed'], { health: .98, moisture: .55, growth: .3 });
Object.assign(w.living.objects['seedling-rack'].stock, { water: 12, trays: 2 });
w.living.objects['shared-table'].stock.rations = 8; w.living.objects['trial-stove'].stock.water = 6;
w.living.inventories[OWNER] = { stock: { moss: 5, light_fruit: 4 }, capacity: 24 };
for (const proposal of source.proposals) persistence.put('role.proposals', proposal.proposal_id, proposal);
persistence.put('canonical-world.states', w.world_id, w); reload(); w = persistent.get();
const baselineProfile = structuredClone(w.protagonist.character_profile), baselineId = w.protagonist.character_id;
const priorRoots = new Set(w.memory.development.records.map(r => r.root_outcome_id));
const samples = [], privateSamples = [];
function checkpoint() { persistence.put('canonical-world.states', w.world_id, w); }
const proposal = direction => roles.list().find(p => p.direction_id === direction);
function preview(direction = 'wetland_frog') { return roleStagePreview(w, { proposal: proposal(direction), at: iso() }); }
function sample(id, label, summary, direction = 'wetland_frog', extra = {}) {
  checkpoint(); const snapshot = evolution.snapshot({ characterId: OWNER });
  const read = { ...snapshot, candidates: [], evidence: [], pulls: [], runs: [], cooldowns: [] };
  const proposals = evolution.wishProposals({ characterId: OWNER });
  samples.push({ id, label, summary, now: iso(), memory: memoryReadModel(w), evolution: read, proposals,
    appearance: structuredClone(w.protagonist.appearance), preview: preview(direction), map: getWorldMap(w), ...extra });
  privateSamples.push({ id, now: iso(), world: structuredClone(w), proposals });
}
function advance(ms) {
  const target = time + ms;
  for (let task; (task = w.tasks.filter(t => t.status === 'running' && Date.parse(t.due_at) <= target).sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at))[0]);) {
    advanceLivingResources(w, task.due_at, { force: true });
    advanceWorldTask(w, { task_id: task.task_id, expected_task_revision: task.revision }, task.due_at);
  }
  time = target; advanceLivingResources(w, iso(), { force: true }); applyRealTimeClock(w, iso()); syncLivedMemory(w, iso()); settlePracticalTrials(w, iso());
}
function arrangeOpportunity() {
  assert.equal(activeWorldTask(w, OWNER), null);
  Object.assign(w.autonomy.actors[OWNER], { energy: .88, appetite: .15, updated_at: iso(), plan: null, next_decision_at: iso() });
  Object.assign(w.living.objects['garden-bed'], { health: .98, moisture: .55, growth: .3 });
}
function untilPrimary() {
  for (let i = 0; i < 400; i++) {
    const task = activeWorldTask(w, OWNER); if (task?.role_trial?.step_role === 'primary') return task;
    advanceAutonomousLife(w, iso(), { eventId: `review-stages-life:${iso()}` }); advance(M);
  }
  throw Error('No actual primary activity was chosen within the bounded fixture');
}
function success() { const task = untilPrimary(); advance(Date.parse(task.due_at) - time); assert.equal(task.status, 'completed'); return task; }
function start(direction) {
  if (proposal(direction).status === 'proposed') roles.choose(proposal(direction).proposal_id, 'try');
  const p = proposal(direction); arrangeOpportunity();
  startPracticalTrial(w, { proposalId: p.proposal_id, actorId: OWNER, directionId: direction, wishBasis: p.wish_basis,
    at: iso(), eventId: `review-stage-start:${direction}`, ...(direction === 'wetland_frog' ? { variant: 'nursery' } : {}) });
}
function adopt(direction) {
  const p = proposal(direction), before = JSON.stringify(w), view = preview(direction);
  assert.equal(view.eligible, true, JSON.stringify(view.barriers)); assert.equal(JSON.stringify(w), before);
  const result = acceptRoleStage(w, { proposalId: p.proposal_id, actorId: OWNER, directionId: direction, wishBasis: p.wish_basis,
    previewFingerprint: view.preview_fingerprint, at: iso(), eventId: `review-adopt:${direction}` });
  checkpoint(); evolution.reconcileRoleStage(p.proposal_id); return result.stage;
}
sample('prepared', '愿望已准备，造型未采用', '沿用三个上海日真实路线和配方形成的原愿望。当前外观没有采用新方向；预览也不能代替实际试做。');
start('wetland_frog'); success();
sample('first-result', '一次实际结果，继续了解', '原自主候选选择了苗圃主要练习，原材料预留和期限结算留下一个结果根。一次成功不能采用新形态。');
advance(24 * 60 * M); arrangeOpportunity(); settlePracticalTrials(w, iso()); success();
sample('ready-preview', '两日结果，先看预览', '当前方式跨两个上海日实际完成两次主要活动。预览展示荷叶青蛙，但当前地图形体仍是原样；读取没有写入造型。');
const frog = adopt('wetland_frog');
sample('adopted-form', '采用荷叶青蛙方向', '同一虚拟个体增加青蛙轮廓、眼丘和荷叶细节。日常增加照料与水岸选项，原需要、库存、任务和实体壳保留。');
start('chef'); success(); advance(24 * 60 * M); arrangeOpportunity(); settlePracticalTrials(w, iso()); success();
const chef = adopt('chef');
sample('adopted-combination', '青蛙形态与灶边职业组合', '灶边方向也通过自己的两次原配方主要结果采用。帽子和围裙与蛙形组合；不会把青蛙结果移植成做饭资格。', 'chef');
// An explicit hunger counterexample: normal needs still win. The ensuing
// travel/meal is selected and completed by the original ordinary-life engine.
arrangeOpportunity(); w.autonomy.actors[OWNER].appetite = .85;
advanceAutonomousLife(w, iso(), { eventId: 'review-stage-needs-first' });
assert.ok(['meal', 'store-meals'].includes(w.autonomy.actors[OWNER].plan.goal), 'ordinary food needs or existing food delivery win over stage practice');
for (let i = 0; i < 100 && !w.tasks.some(t => t.actor_id === OWNER && t.activity_id === 'share-meal' && t.status === 'completed' && Date.parse(t.started_at) >= Date.parse(chef.accepted_at)); i++) {
  const task = activeWorldTask(w, OWNER); advance(task ? Math.max(M, Date.parse(task.due_at) - time) : M);
  advanceAutonomousLife(w, iso(), { eventId: `review-stage-meal:${iso()}` });
}
assert.ok(w.autonomy.actors[OWNER].appetite < .3);
sample('ordinary-life', '有新方向，也要先吃饭', '受控饥饿反例中，原生活选择器先处理现有饭菜交接并实际完成吃饭。角色职业没有夺走基本需要，也没有赠送食物。', 'chef');
checkpoint(); const beforeRestart = structuredClone(w); reload(); w = persistent.get(); assert.deepEqual(w, beforeRestart);
sample('restart', '重启后仍是同一个体', 'SQLite 关闭并通过真实加载器重载。两个轴的版本、实际根和现有任务一致，没有重复采用或重复结算。', 'chef', { restart_verified: true });
const beforeRollback = structuredClone({ living: w.living, tasks: w.tasks, memory: w.memory });
rollbackRoleStage(w, { stageId: frog.stage_id, at: iso(), eventId: 'review-rollback-form' }); checkpoint(); evolution.reconcileRoleStage(frog.proposal_id);
assert.equal(roleStagesReadModel(w).current.form, null); assert.equal(roleStagesReadModel(w).current.vocation.stage_id, chef.stage_id);
assert.deepEqual({ living: w.living, tasks: w.tasks, memory: w.memory }, beforeRollback);
sample('rollback-form', '回退蛙形，灶边生活继续', '只恢复形态这一轴的原样。厨师配件和方向继续，正在做的事与已经消耗的材料、结果和记忆都保留。', 'chef');
rollbackRoleStage(w, { stageId: chef.stage_id, at: iso(), eventId: 'review-rollback-vocation' }); checkpoint(); evolution.reconcileRoleStage(chef.proposal_id);
sample('rollback-vocation', '回到原造型，经历不退回', '两个方向都已回退。旧试做结果封存，不能反复采用；新的方向仍需新的愿望、回应与实际生活。', 'chef');
assert.equal(w.protagonist.character_id, baselineId); assert.deepEqual(w.protagonist.character_profile, baselineProfile);
assert.ok([...priorRoots].every(root => w.memory.development.records.some(r => r.root_outcome_id === root)));
const document = { schema: 'deskbot.role-stages-review.v1', simulated: true, live_world_untouched: true,
  experiment: { persistence: 'sqlite', external_calls: 0, actors_active: 1, actors_total: 13,
    prerequisites: 'stage4_authored_schedule_with_actual_execution', trial_choices: 'ordinary_bounded_rules',
    controlled_initial_stock: true, controlled_next_day_needs_and_bed: true, later_resource_refills: false,
    spontaneous_model_choice_verified: false, liking_or_qualification_proven: false, physical_shell_changed: false,
    actual_adopted_directions: ['wetland_frog', 'chef'], accepted_primary_results: 4 }, samples };
writeFileSync(new URL('../apps/jev-town-client/public/role-stages-review.json', import.meta.url), JSON.stringify(document, null, 2));
writeFileSync(new URL('../tmp/role-stages-model-worlds.json', import.meta.url), JSON.stringify(privateSamples));
console.log(JSON.stringify({ samples: samples.map(s => s.id), actual_new_roots: w.memory.development.records.length - priorRoots.size,
  accepted_primary_results: 4, axes: 2, sqlite_restart_verified: true, live_world_untouched: true })); persistence.close();
