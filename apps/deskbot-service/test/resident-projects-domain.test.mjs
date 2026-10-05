import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installLivingResources, advanceLivingResources, prepareLivingActivity, completeLivingActivity, livingReadModel } from '../src/living-resources.mjs';
import { startActivityTask, advanceWorldTask, controlWorldTask } from '../src/realtime-world.mjs';
import { installResidentProjects, projectCandidates, settleResidentProjects, settleProjectTask, projectReadModel, updateProjectScheduling } from '../src/resident-projects.mjs';
const BASE = Date.parse('2026-10-05T01:00:00.000Z'), H = 3_600_000;
const grower = 'wetland-grower-001', mender = 'spare-mender-001', cook = 'pot-cook-001', trader = 'market-trader-001', own = 'shaping-001';
const iso = at => new Date(at).toISOString();
function fixture() {
  const objects = ['floating-frame', 'garden-bed', 'seedling-rack', 'repair-bench', 'parts-drawers', 'market-canopy', 'trial-stove', 'shared-table'];
  const authored = { [grower]: 'floating-seedbed', [mender]: 'small-water-pump', [cook]: 'leaf-signature-soup', [trader]: 'market-goal' };
  const world = { clock: { mode: 'real_time', synced_at: iso(BASE), time_zone: 'Asia/Shanghai' }, tasks: [], weather: {},
    protagonist: { character_id: own, location_id: 'fixture-yard' },
    npcs: Object.entries(authored).map(([npc_id, project_id]) => ({ npc_id, display_name: npc_id, location_id: 'fixture-yard', temperament: '保留原性格', project: { project_id, goal: project_id, status: 'authored_goal' } })),
    resident_life: { version: 'fixture-installed' }, locations: [{ location_id: 'fixture-yard', name: '试验院子' }],
    map_catalog: { objects: objects.map(object_id => ({ object_id, area_id: 'fixture-area', name: object_id })), areas: [{ area_id: 'fixture-area', location_id: 'fixture-yard', access: 'public' }] } };
  installLivingResources(world, iso(BASE));
  world.living.objects['floating-frame'].water_level = .7;
  world.living.inventories[grower] = { stock: { wood: 2, fasteners: 2, seeds: 6, water: 12 }, capacity: 24 };
  world.living.inventories[mender] = { stock: { wood: 3, fasteners: 6 }, capacity: 24 };
  world.living.inventories[cook] = { stock: { moss: 8 }, capacity: 24 };
  installResidentProjects(world, iso(BASE));
  let now = BASE, sequence = 0;
  function advanceTo(at) { advanceLivingResources(world, iso(at)); now = at; world.clock.synced_at = iso(at); }
  function start(id, actorId) {
    const result = startActivityTask(world, { activity_id: id, actor_id: actorId, task_id: `fixture-${++sequence}`,
      project_id: 'forged-project', project_stage_id: 'forged-stage', project_attempt: 999, project_projection: true }, { eventId: `fixture-event-${sequence}`, at: iso(now) });
    return world.tasks.find(t => t.task_id === result.task_id);
  }
  function finish(task) {
    advanceTo(Date.parse(task.due_at));
    return advanceWorldTask(world, { task_id: task.task_id, expected_task_revision: task.revision }, iso(now));
  }
  function run(id, actorId) { const task = start(id, actorId); finish(task); assert.equal(task.status, 'completed', task.failure_reason); return task; }
  return { world, start, finish, run, advanceTo, now: () => now, after: ms => advanceTo(now + ms),
    state: id => world.resident_projects.projects[id], frame: () => world.living.objects['floating-frame'],
    seedbed: () => world.living.objects['floating-frame'].project_assets?.floating_seedbed,
    pump: () => world.living.objects['floating-frame'].project_assets?.small_water_pump };
}
function plant(h) { h.run('seedbed-survey', grower); h.run('seedbed-plant', grower); }
function installPump(h) { h.run('pump-survey', mender); h.run('pump-assemble', mender); h.run('pump-install', mender); }
function serveSoup(h) { h.run('soup-record-ratio', cook); h.run('soup-cook-trial', cook); h.run('soup-serve-trial', cook); }

test('project installation is additive, idempotent, preserves authored identities and creates no gifts or past accomplishments', () => {
  const h = fixture(), w = h.world;
  const old = structuredClone(w); delete w.resident_projects;
  for (const npc of w.npcs) { npc.project.status = 'authored_goal'; delete npc.project.progress; }
  delete w.living.objects['shared-table'].stock.trial_soup;
  const stock = structuredClone(w.living), tasks = structuredClone(w.tasks);
  assert.equal(installResidentProjects(w, iso(BASE + H)), true);
  const expected = structuredClone(stock); expected.objects['shared-table'].stock.trial_soup = 0;
  assert.deepEqual(w.living, expected); assert.deepEqual(w.tasks, tasks);
  assert.equal(w.npcs.find(n => n.npc_id === trader).project.status, 'authored_goal');
  assert.ok(w.npcs.every(n => n.temperament === '保留原性格'));
  assert.ok(Object.values(w.resident_projects.projects).every(p => p.evidence.length === 0 && p.history.length === 0 && p.status === 'active'));
  const installed = structuredClone(w); assert.equal(installResidentProjects(w, iso(BASE + 2 * H)), false); assert.deepEqual(w, installed);
  assert.equal(old.living.objects['floating-frame'].stock.raw_water, w.living.objects['floating-frame'].stock.raw_water);
});

test('canonical activity owns metadata; role, stage and unregistered completion cannot claim a project', () => {
  const h = fixture();
  assert.throws(() => h.start('seedbed-survey', cook), { code: 'activity_unavailable' });
  assert.throws(() => h.start('seedbed-accept', grower), { code: 'activity_unavailable' });
  const task = h.start('seedbed-survey', grower);
  assert.equal(task.project_id, 'floating-seedbed'); assert.equal(task.project_stage_id, 'survey'); assert.equal(task.project_attempt, 1); assert.equal(task.project_projection, undefined);
  const detached = { ...task, task_id: 'detached' };
  assert.equal(completeLivingActivity(h.world, detached, iso(h.now())).success, false);
  h.finish(task); assert.equal(h.state('floating-seedbed').stage_id, 'plant');
  assert.equal(h.state('floating-seedbed').evidence.length, 1);
  const after = structuredClone(h.world); assert.equal(settleProjectTask(h.world, task, iso(h.now())), false); assert.deepEqual(h.world, after);
  h.run('water-bed', own); assert.equal(h.state('floating-seedbed').evidence.length, 1, 'ordinary watering cannot claim the project');
  assert.ok(h.state('floating-seedbed').history.every(e => e.outcome === 'completed' && e.location_id === 'fixture-yard'));
});

test('planner projection may model outputs on its clone, but cannot supply canonical evidence', () => {
  const h = fixture(), clone = structuredClone(h.world), before = structuredClone(h.state('floating-seedbed'));
  const prepared = prepareLivingActivity(clone, 'seedbed-survey', grower, iso(BASE));
  const result = completeLivingActivity(clone, { ...prepared, actor_id: grower, task_id: 'projection-only', project_projection: true }, iso(BASE));
  assert.equal(result.success, true); assert.equal(settleResidentProjects(clone, iso(BASE)), false);
  assert.deepEqual(clone.resident_projects.projects['floating-seedbed'], before); assert.deepEqual(h.state('floating-seedbed'), before);
});

test('floating nursery waits through real environment, requires an independent inspection, then produces finite harvest and replant', () => {
  const h = fixture(); plant(h);
  const installed = h.seedbed().installed_at;
  assert.equal(h.seedbed().quantity, 6); assert.equal(h.world.living.inventories[grower].stock.seeds, 4);
  assert.throws(() => h.start('seedbed-inspect', mender), { code: 'activity_unavailable' });
  h.advanceTo(Date.parse(installed) + 12 * H);
  assert.equal(h.state('floating-seedbed').status, 'active', 'waiting alone does not accept the nursery');
  h.run('seedbed-inspect', mender); h.run('seedbed-accept', grower);
  assert.equal(h.state('floating-seedbed').status, 'completed'); assert.ok(h.seedbed().accepted_at);
  assert.ok(h.state('floating-seedbed').evidence.some(e => e.activity_id === 'seedbed-inspect' && e.actor_id === mender));
  const status = h.state('floating-seedbed').status;
  h.advanceTo(Date.parse(installed) + 72 * H);
  assert.ok(h.seedbed().growth >= .85, 'the accepted plants actually grow, rather than spawning harvest during acceptance');
  assert.ok(projectCandidates(h.world, grower, iso(h.now())).some(c => c.activity_id === 'harvest-float-bed'));
  const produced = Math.floor(h.seedbed().quantity * h.seedbed().health); h.run('harvest-float-bed', trader);
  assert.equal(h.world.living.inventories[trader].stock.moss, produced); assert.equal(h.seedbed().quantity, 0); assert.equal(h.seedbed().status, 'empty');
  const seedsBefore = h.world.living.inventories[grower].stock.seeds; h.run('sow-float-bed', grower);
  assert.equal(h.world.living.inventories[grower].stock.seeds, seedsBefore - 2); assert.equal(h.seedbed().quantity, 6); assert.equal(h.state('floating-seedbed').status, status);
  assert.equal(projectReadModel(h.world).projects.find(p => p.project_id === 'floating-seedbed').ready_at, null);
});

test('paused and cancelled phases do not complete, and a changed safety predicate refunds held materials', () => {
  const h = fixture(); h.run('pump-survey', mender);
  const initial = structuredClone(h.world.living.inventories[mender].stock), task = h.start('pump-assemble', mender);
  controlWorldTask(h.world, { task_id: task.task_id, operation: 'pause' }, iso(h.now())); h.after(2 * H);
  assert.equal(task.status, 'paused'); assert.equal(h.state('small-water-pump').stage_id, 'assemble');
  controlWorldTask(h.world, { task_id: task.task_id, operation: 'cancel' }, iso(h.now()));
  assert.equal(h.state('small-water-pump').status, 'setback'); assert.equal(h.state('small-water-pump').stage_id, 'assemble');
  assert.deepEqual(h.world.living.inventories[mender].stock, initial); assert.equal(h.state('small-water-pump').evidence.length, 1);
  const retry = h.run('pump-assemble', mender); assert.ok(retry.project_attempt > task.project_attempt);
  const kit = h.world.living.inventories[mender].stock.pump_kit, install = h.start('pump-install', mender); h.frame().water_level = .95; h.finish(install);
  assert.equal(install.status, 'failed'); assert.equal(h.world.living.inventories[mender].stock.pump_kit, kit);
  assert.equal(h.state('small-water-pump').stage_id, 'install'); assert.equal(h.pump(), undefined);
  assert.equal(h.state('small-water-pump').history.at(-1).outcome, 'failed');
});

test('installed trial pump can be repaired without advancing the project; real helper use and later acceptance unlock faster finite water', () => {
  const h = fixture(); installPump(h);
  assert.equal(h.world.living.inventories[mender].stock.pump_kit, 0); assert.equal(h.pump().status, 'installed_trial');
  h.pump().condition = .3;
  assert.ok(projectCandidates(h.world, mender, iso(h.now())).some(c => c.activity_id === 'repair-pump' && c.available));
  const token = h.state('small-water-pump').attempt, stage = h.state('small-water-pump').stage_id;
  h.run('repair-pump', mender); assert.equal(h.state('small-water-pump').attempt, token); assert.equal(h.state('small-water-pump').stage_id, stage); assert.equal(h.pump().status, 'installed_trial');
  const raw = h.frame().stock.raw_water, trial = h.run('pump-trial', grower);
  assert.equal(trial.reservation.status, 'consumed'); assert.equal(h.world.living.inventories[grower].stock.water, 14);
  assert.ok(h.frame().stock.raw_water < raw - 1.8); assert.throws(() => h.start('pump-accept', mender), { code: 'activity_unavailable' });
  h.advanceTo(Date.parse(h.pump().installed_at) + 6 * H); h.run('pump-accept', mender);
  assert.equal(h.pump().status, 'ready'); assert.equal(h.state('small-water-pump').status, 'completed');
  const rawBefore = h.frame().stock.raw_water, waterBefore = h.world.living.inventories[grower].stock.water;
  const used = h.run('pump-water', grower); assert.equal(used.duration_ms, 300_000);
  assert.equal(h.world.living.inventories[grower].stock.water, waterBefore + 4); assert.ok(h.frame().stock.raw_water < rawBefore - 3.9);
  assert.equal(h.pump().use_count, 2);
});

test('two actual distinct tasters consume one batch, cancellation preserves the first feedback, and later repeat cook yields a durable usable recipe', () => {
  const h = fixture(); serveSoup(h);
  const batch = h.world.living.objects['shared-table'].project_batches['leaf-signature-soup'];
  assert.equal(batch.remaining_portions, 2); assert.equal(h.world.living.objects['shared-table'].stock.trial_soup, 2);
  h.run('soup-taste-trial', grower); assert.equal(batch.remaining_portions, 1); assert.equal(batch.feedback.length, 1);
  assert.throws(() => h.start('soup-taste-trial', grower), { code: 'activity_unavailable' });
  const cancel = h.start('soup-taste-trial', trader); controlWorldTask(h.world, { task_id: cancel.task_id, operation: 'cancel' }, iso(h.now()));
  assert.equal(batch.feedback.length, 1); assert.equal(batch.remaining_portions, 1); assert.equal(h.world.living.objects['shared-table'].stock.trial_soup, 1);
  h.run('soup-taste-trial', trader); assert.equal(batch.remaining_portions, 0);
  assert.throws(() => h.start('soup-confirm-recipe', cook), { code: 'activity_unavailable' });
  h.advanceTo(Date.parse(batch.prepared_at) + 24 * H); h.run('soup-confirm-recipe', cook);
  const saved = h.world.living.objects['trial-stove'].recipe_book['leaf-signature-soup'];
  assert.equal(h.state('leaf-signature-soup').status, 'completed'); assert.equal(saved.yield_count, 3);
  assert.deepEqual(saved.feedback.map(f => f.actor_id), [grower, trader]); assert.equal(h.world.living.inventories[cook].stock.rations, 3);
  h.world.living.inventories[trader] = { stock: { moss: 2 }, capacity: 24 };
  const beforeWater = h.world.living.objects['trial-stove'].stock.water; h.run('cook-leaf-soup', trader);
  assert.equal(h.world.living.inventories[trader].stock.moss, 0); assert.equal(h.world.living.inventories[trader].stock.rations, 3);
  assert.equal(h.world.living.objects['trial-stove'].stock.water, beforeWater - 1);
});

test('expired trial causes an explained retry instead of resetting inventory or forgetting consumed feedback', () => {
  const h = fixture(); serveSoup(h); h.run('soup-taste-trial', grower);
  const beforeMoss = h.world.living.inventories[cook].stock.moss;
  const old = h.world.living.objects['shared-table'].project_batches['leaf-signature-soup']; h.advanceTo(Date.parse(old.expires_at));
  settleResidentProjects(h.world, iso(h.now()));
  assert.equal(h.state('leaf-signature-soup').stage_id, 'cook'); assert.equal(h.state('leaf-signature-soup').status, 'setback');
  assert.equal(old.feedback.length, 1); assert.equal(h.world.living.inventories[cook].stock.moss, beforeMoss);
  h.run('soup-cook-trial', cook); h.run('soup-serve-trial', cook);
  const fresh = h.world.living.objects['shared-table'].project_batches['leaf-signature-soup'];
  assert.notEqual(fresh.batch_id, old.batch_id); assert.equal(fresh.feedback.length, 0); assert.equal(fresh.remaining_portions, 2);
  assert.equal(h.world.living.objects['shared-table'].stock.trial_soup, 2, 'the old unconsumed spoiled portion is discarded, never counted as new trial soup');
  assert.equal(h.world.living.inventories[cook].stock.moss, beforeMoss - 2);
  assert.ok(h.state('leaf-signature-soup').evidence.some(e => e.details.feedback?.batch_id === old.batch_id));
});

test('current project blockers remain read-only, ignore a previous taster, and maintenance can restore the final nursery acceptance phase', () => {
  const h = fixture(); serveSoup(h); h.run('soup-taste-trial', grower);
  updateProjectScheduling(h.world, grower, iso(h.now()), [{ project_id: 'leaf-signature-soup', project_stage_id: 'taste', actor_id: grower, activity_id: 'soup-taste-trial', available: false, blocked_reason: '你已经尝过' }]);
  updateProjectScheduling(h.world, trader, iso(h.now()), [{ project_id: 'leaf-signature-soup', project_stage_id: 'taste', actor_id: trader, activity_id: 'soup-taste-trial', available: true }]);
  const before = structuredClone(h.world); assert.equal(projectReadModel(h.world).projects.find(p => p.project_id === 'leaf-signature-soup').blocked_reason, null); assert.deepEqual(h.world, before);
  plant(h); h.advanceTo(Date.parse(h.seedbed().installed_at) + 12 * H); h.run('seedbed-inspect', mender);
  h.seedbed().health = .55;
  assert.ok(projectCandidates(h.world, grower, iso(h.now())).some(c => c.activity_id === 'seedbed-care' && c.available));
  assert.throws(() => h.start('seedbed-accept', grower), { code: 'activity_unavailable' });
  h.run('seedbed-care', grower); h.run('seedbed-accept', grower); assert.equal(h.state('floating-seedbed').status, 'completed');
  const visible = livingReadModel(h.world, own).activities;
  assert.ok(visible.some(a => a.activity_id === 'seedbed-care')); assert.ok(!visible.some(a => a.activity_id === 'soup-record-ratio'));
});

test('a dead prototype returns to real planting without restoring seed stock or erasing the lost trial', () => {
  const h = fixture(); plant(h);
  const stock = structuredClone(h.world.living.inventories[grower].stock), installed = h.seedbed().installed_at;
  h.frame().water_level = .1;
  h.advanceTo(Date.parse(installed) + 20 * H);
  assert.equal(h.seedbed().quantity, 0); assert.equal(h.seedbed().status, 'dead');
  settleResidentProjects(h.world, iso(h.now()));
  assert.equal(h.state('floating-seedbed').status, 'setback'); assert.equal(h.state('floating-seedbed').stage_id, 'plant');
  assert.equal(h.state('floating-seedbed').evidence.length, 2); assert.deepEqual(h.world.living.inventories[grower].stock, stock);
  assert.match(h.state('floating-seedbed').last_outcome.reason, /死亡/);
  assert.ok(projectCandidates(h.world, grower, iso(h.now())).some(c => c.activity_id === 'seedbed-plant' && !c.available));
  const after = structuredClone(h.world); assert.equal(settleResidentProjects(h.world, iso(h.now())), false); assert.deepEqual(h.world, after);
});

test('terminal evidence remains durable after the canonical hundred-task retention window', () => {
  const h = fixture(), task = h.run('seedbed-survey', grower);
  for (let index = 0; index < 101; index++) {
    const result = startActivityTask(h.world, { actor_id: own, task_id: `ordinary-${index}`, kind: 'care', title: '整理手边的小事', duration_seconds: 1 }, { eventId: `ordinary-${index}`, at: iso(h.now()) });
    h.finish(h.world.tasks.find(t => t.task_id === result.task_id));
  }
  assert.ok(!h.world.tasks.some(t => t.task_id === task.task_id));
  assert.equal(h.state('floating-seedbed').stage_id, 'plant'); assert.equal(h.state('floating-seedbed').evidence[0].task_id, task.task_id);
  const before = structuredClone(h.world); assert.equal(settleResidentProjects(h.world, iso(h.now())), false); assert.deepEqual(h.world, before);
});
