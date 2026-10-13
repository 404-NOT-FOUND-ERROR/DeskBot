import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSqlitePersistence } from '../apps/deskbot-service/src/persistence.mjs';
import { createPersistentWorld, getWorldMap } from '../apps/deskbot-service/src/persistent-world.mjs';
import { createAutonomousLife } from '../apps/deskbot-service/src/autonomous-life.mjs';
import { createLifeChoiceWorker } from '../apps/deskbot-service/src/life-choice.mjs';
import { createSlowCognitionWorker } from '../apps/deskbot-service/src/slow-cognition.mjs';
import { installResidentLife } from '../apps/deskbot-service/src/resident-life.mjs';
import { installRefraction } from '../apps/deskbot-service/src/input-refraction.mjs';
import { installLivedMemory, memoryReadModel } from '../apps/deskbot-service/src/lived-memory.mjs';
import { createReloadableLlm } from '../apps/deskbot-service/src/llm.mjs';
import { createWorldCandidateStore } from '../apps/deskbot-service/src/world-candidates.mjs';
import { canonicalDigest } from '../apps/deskbot-service/src/replay-tape.mjs';
import { localWorldDate } from '../apps/deskbot-service/src/realtime-world.mjs';
import { roleStagesReadModel } from '../apps/deskbot-service/src/role-stages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'shaping-001';
const START = '2026-10-01T04:00:00.000Z';
const MINUTE = 60_000;
const DAY = 86_400_000;

/** Explicit opt-in is required. Importing this module never opens a database,
 * loads credentials, calls a provider, or starts the review. */
export function parseMigrationReviewArgs(args = process.argv.slice(2)) {
  const options = { live: false, configPath: null, maxRequests: 6 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--live') options.live = true;
    else if (args[i] === '--config') options.configPath = args[++i];
    else if (args[i] === '--max-requests') options.maxRequests = Number(args[++i]);
    else if (args[i] === '--help') options.help = true;
    else throw Error('unknown_review_option');
  }
  if (!Number.isInteger(options.maxRequests) || options.maxRequests < 2 || options.maxRequests > 6) throw Error('review_requests_must_be_2_to_6');
  if (options.live && !options.configPath) throw Error('live_review_requires_explicit_config');
  if (!options.live && options.configPath) throw Error('config_requires_live_opt_in');
  return options;
}

function goalSummary(goal) {
  return { goal_id: goal.goal_id, text: goal.text, topic: goal.topic, activity_id: goal.activity_id,
    status: goal.status, source_ids: goal.source_ids, task_ids: goal.task_ids, progress: goal.progress,
    history: goal.history, created_by: goal.created_by };
}

/** The fixture is deliberately a controlled preference, not a claim that a
 * model spontaneously wanted this life. All outcomes still use the real task
 * engine, including routes, reservations, elapsed time and activity effects. */
function fixtureAnswer(world, { prompt, purpose }) {
  const context = JSON.parse(prompt.split('\n').at(-1));
  if (purpose === 'slow_cognition') {
    const fact = [...context.memories].reverse().find(memory => memory.topic === 'care' && memory.activity_id === 'tend-bed')
      ?? [...context.memories].reverse().find(memory => memory.topic && memory.activity_id);
    return { model: 'migration-public-fixture-v1', text: JSON.stringify({
      insights: fact ? [{ text: '这回实际做过之后，我还惦记着苗圃里那件小事。', topic: fact.topic,
        feeling: 'curious', source_ids: [fact.id] }] : [],
      goals: fact ? [{ text: '有余力时，我想再认真试一次刚才做过的事。', topic: fact.topic,
        activity_id: fact.activity_id, source_ids: [fact.id] }] : [], relations: [] }) };
  }
  if (purpose === 'life_choice') {
    const request = world.memory.planner.requests[context.actor_id];
    const preferred = request.candidates.find(choice => choice.cognition_goal_id)
      ?? request.candidates.find(choice => choice.goal === 'continue:care')
      ?? request.candidates.find(choice => choice.goal === 'interest:moss-sprout-garden')
      ?? request.candidates[0];
    return { model: 'migration-public-fixture-v1', text: JSON.stringify({ goal: preferred.goal,
      reason: '眼前的需要留好了，我想把自己惦记的小事实际再试一次。', memory_ids: [] }) };
  }
  throw Error('unsupported_review_model_purpose');
}

/** A disposable, public-fiction-only M3/M4/M8 review. No path parameter can
 * select the installed world: the database is always newly created under tmp.
 * Only one audit report is retained, beside its isolated SQLite database. */
export async function runMigrationReview({ live = false, configPath = null, maxRequests = 6,
  provider = null, outputRoot = join(ROOT, 'tmp'), onProgress = () => {} } = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 2 || maxRequests > 6) throw Error('review_requests_must_be_2_to_6');
  if (live && !configPath && !provider) throw Error('live_review_requires_explicit_config');
  if (!live && provider) throw Error('custom_provider_requires_live_opt_in');
  if (live && !provider) {
    if (!(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)) throw Error('live_review_requires_proxy_env');
    if (process.env.NODE_USE_ENV_PROXY !== '1' && !process.execArgv.includes('--use-env-proxy')) throw Error('live_review_requires_node_env_proxy_at_startup');
  }
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(resolve(outputRoot), 'asamana-migration-review-'));
  const databasePath = join(directory, 'isolated.sqlite');
  const reportPath = join(directory, 'report.json');
  let time = Date.parse(START), sequence = 0, persistence, world, life, choices, slow, candidates;
  let checkpoint = 'initialize';
  const now = () => new Date(time), at = () => now().toISOString();
  const calls = [], snapshots = [], goalPlans = new Map(), canonicalGoalTasks = new Map(), originalIngress = [];
  let realProvider = provider;
  if (live && !realProvider) realProvider = createReloadableLlm({ configPath: resolve(configPath), now });
  const counts = () => ({ all: calls.length, slow: calls.filter(call => call.purpose === 'slow_cognition').length,
    choice: calls.filter(call => call.purpose === 'life_choice').length });
  const llm = { id: live ? 'bounded-live-review' : 'bounded-public-review-fixture',
    status: () => live ? realProvider.status?.() ?? { configured: true } : { configured: true },
    async complete(input) {
      // Keep two requests for cross-day reflection. A shortage of allowance is
      // a reported bounded fallback, never a fabricated model response.
      if (!['slow_cognition', 'life_choice'].includes(input.purpose)) throw Error('unsupported_review_model_purpose');
      if (calls.length >= maxRequests || (input.purpose === 'life_choice' && counts().choice >= maxRequests - 2)) throw Error('review_budget_exhausted');
      const context = JSON.parse(input.prompt.split('\n').at(-1));
      assert.equal((world.get().user_turns ?? []).length, 0, 'No real dialogue may cross the provider boundary');
      if (input.purpose === 'slow_cognition') {
        assert.ok(context.memories.length > 0);
        assert.ok(context.memories.every(memory => memory.kind === 'world_fact'));
        assert.ok(context.memories.every(memory => world.get().memory.episodes.some(episode => episode.id === memory.id && episode.model_safe === true)));
      }
      const call = { call_id: `review-call:${calls.length + 1}`, purpose: input.purpose, at: at(), actor_id: context.actor_id ?? OWNER,
        source_ids: input.purpose === 'slow_cognition' ? context.memories.map(memory => memory.id) : [],
        public_fiction_only: true, status: 'calling' };
      calls.push(call);
      try {
        const result = live ? await realProvider.complete(input) : fixtureAnswer(world.get(), input);
        call.status = 'returned'; call.model = String(result.model ?? 'unknown').slice(0, 80);
        // The report stores the domain's accepted projection below. Raw
        // provider output and complete prompts are deliberately omitted.
        return result;
      } catch {
        call.status = 'provider_error'; call.error = 'provider_unavailable';
        throw Error('provider_unavailable');
      }
    } };
  function ingress(event, adapter = {}) {
    const result = world.ingest(event, adapter);
    originalIngress.push({ event: structuredClone(event), adapter: structuredClone(adapter) });
    return result;
  }
  function mutate(action, extra = {}, adapter = {}) {
    return ingress({ event_id: `asamana-review:${sequence++}:${action}`, type: 'world.mutation',
      source: 'isolated-public-life-review', source_kind: 'world_engine', character_id: OWNER, occurred_at: at(),
      payload: { action, ...extra } }, adapter);
  }
  function open() {
    persistence = createSqlitePersistence({ filename: databasePath, now });
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime', timeZone: 'Asia/Shanghai' });
    life = createAutonomousLife({ world, now, enabled: true });
    choices = createLifeChoiceWorker({ world, llm, now, wake: id => life.tick({ wakeId: id }) });
    slow = createSlowCognitionWorker({ world, llm, now, maxPerTick: 1 });
    candidates = createWorldCandidateStore({ now, persistence, worldSnapshot: () => world.get(),
      ingest: event => ingress(event), listMutations: options => world.listMutations(options) });
  }
  function close() { choices?.stop(); slow?.stop(); persistence?.close(); }
  function restart() { close(); open(); }
  function capture(id) {
    const state = world.get(), own = state.memory?.maintenance?.actors?.[OWNER];
    const goals = [...(own?.goals ?? []), ...(own?.goal_history ?? [])];
    const plan = state.autonomy?.actors?.[OWNER]?.plan;
    if (plan?.cognition_goal_id) {
      const previous = goalPlans.get(plan.plan_id);
      goalPlans.set(plan.plan_id, { plan_id: plan.plan_id, goal_id: plan.cognition_goal_id,
        goal: plan.goal, task_id: plan.task_id, status: plan.status, at: at(),
        task_ids: [...new Set([...(previous?.task_ids ?? []), plan.task_id].filter(Boolean))] });
    }
    // A completed plan is intentionally cleared by the autonomous loop. Keep
    // the durable task's authored life_plan_id as the audit bridge so a
    // cross-day carried intention remains verifiable after restart and settle.
    for (const task of state.tasks.filter(task => task.actor_id === OWNER && task.cognition_goal_id && task.life_plan_id)) {
      canonicalGoalTasks.set(task.task_id, structuredClone(task));
      const previous = goalPlans.get(task.life_plan_id) ?? { plan_id: task.life_plan_id,
        goal_id: task.cognition_goal_id, goal: task.life_goal, status: 'completed', at: task.finished_at ?? at(), task_ids: [] };
      previous.task_ids = [...new Set([...(previous.task_ids ?? []), task.task_id])];
      previous.status = task.status === 'running' ? 'executing' : previous.status;
      goalPlans.set(task.life_plan_id, previous);
    }
    const snapshot = { id, at: at(), date: localWorldDate(at(), 'Asia/Shanghai').date, world_revision: state.world_revision,
      sequence: world.readSnapshot({ feedLimit: 1 }).sequence,
      request: own?.request ? { id: own.request.id, date: own.request.date, status: own.request.status, error: own.request.error,
        model: own.request.model, source_ids: own.request.source_ids } : null,
      goals: goals.map(goalSummary), plan: plan ? { plan_id: plan.plan_id, goal: plan.goal,
        cognition_goal_id: plan.cognition_goal_id, task_id: plan.task_id, status: plan.status } : null,
      tasks: state.tasks.filter(task => task.actor_id === OWNER && (task.cognition_goal_id || task.activity_id)).map(task => ({
        task_id: task.task_id, activity_id: task.activity_id, status: task.status, origin: task.origin,
        cognition_goal_id: task.cognition_goal_id ?? null, plan_id: task.life_plan_id ?? null,
        started_at: task.started_at, due_at: task.due_at, finished_at: task.finished_at,
        success: task.completion?.result?.success ?? null, failure_classification: task.failure_classification ?? null })),
      ...(id.startsWith('step:') ? {} : { memory: memoryReadModel(state), map: getWorldMap(state),
        role_stages: roleStagesReadModel(state) }) };
    snapshots.push(snapshot); return snapshot;
  }
  function settleAt(timestamp) {
    time = Date.parse(timestamp);
    world.syncWallClock(); world.syncTasks({ limit: 1000 });
  }
  async function step({ choose = true } = {}) {
    const task = world.get().tasks.find(item => item.actor_id === OWNER && item.status === 'running');
    settleAt(task?.due_at ?? new Date(time + 5 * MINUTE).toISOString());
    life.tick(); if (choose) await choices.tick();
    capture(`step:${sequence++}`);
  }
  async function until(predicate, maximum = 360, { choose = true, date = null } = {}) {
    for (let i = 0; i < maximum; i++) {
      if (predicate()) return true;
      if (date && localWorldDate(at(), 'Asia/Shanghai').date !== date) return false;
      await step({ choose });
    }
    return Boolean(predicate());
  }
  const report = { schema: 'deskbot.asamana-migration-review.v1', live, simulated_clock: true,
    public_fiction_only: true, installed_world_read: false, installed_world_written: false,
    external_call_limit: live ? maxRequests : 0, directory, database_path: databasePath,
    conditions: { active_actors: 1, resident_choices_paused: true, healthy_starting_actor: true,
      authored_initial_materials: true, completed_tasks_seeded: false, memory_roots_seeded: false,
      spontaneous_preference_claimed: false, real_model_sample: live,
      fixture_preference: live ? null : 'care:tend-bed', goal_execution_step_limit: 120,
      world_time_mode: 'real_time', controlled_now: START },
    gates: {}, limitations: ['controlled-clock run is not 7–14 days of real-time living',
      'role wish/practical-trial/stage visual acceptance remains the separate stages review',
      'browser pixels, long disconnect recovery and physical devices are not certified by this script'] };
  try {
    open();
    // This is the one author-controlled initial scene. No task or past
    // experience is inserted, and all later effects use ordinary ingress.
    const initial = world.get();
    installResidentLife(initial, at()); installRefraction(initial, at());
    initial.protagonist.location_id = 'moss-sprout-garden';
    Object.assign(initial.living.objects['garden-bed'], { health: .62, moisture: .55, growth: .2 });
    initial.living.objects['seedling-rack'].stock.trays = 2;
    initial.living.objects['shared-table'].stock.rations = 8;
    for (const actor of Object.values(initial.autonomy.actors)) { actor.paused = actor.actor_id !== OWNER; actor.energy = .9; actor.appetite = .1; }
    installLivedMemory(initial, at(), { plannerEnabled: true });
    assert.equal(initial.tasks.length, 0); assert.equal(initial.memory.episodes.length, 0);
    persistence.put('canonical-world.states', initial.world_id, initial); restart();
    capture('fresh');
    checkpoint = 'source_ingress';
    for (const [type, source, attestedKind, topic_code] of [
      ['user.preference.life', 'public-fiction-owner', 'user', 'tend'],
      ['external.observation', 'public-fiction-provider', 'provider', 'tend'],
      ['agent.message', 'public-fiction-postcarrier', 'agent', 'tend'],
    ]) ingress({ event_id: `asamana-review:source:${type}`, type, source, character_id: OWNER, occurred_at: at(),
      payload: { suggestion: 'tend', topic_code, text: '隔离公开虚构样本：有空留意苗圃的实际条件。' } },
    { attestedKind, sourceLabel: '公开虚构验收来源' });
    const beforeContactPractice = world.get().memory.development.records.length;
    assert.equal(beforeContactPractice, 0, 'Reading multiple sources does not mint practiced outcomes');
    life.tick();
    checkpoint = 'initial_real_activity';
    const firstTask = world.get().tasks.find(task => task.actor_id === OWNER && task.activity_id === 'tend-bed' && task.status === 'running');
    assert.ok(firstTask, 'The original autonomous loop must start the real authored nursery activity');
    capture('first-activity-running'); settleAt(firstTask.due_at);
    const finished = world.get().tasks.find(task => task.task_id === firstTask.task_id);
    assert.equal(finished.status, 'completed'); assert.equal(finished.completion.result.success, true);
    capture('first-real-outcome');
    // Only one actor has real outcomes; the slow worker cannot incur twelve
    // extra resident calls. At most two daily calls are allowed below.
    checkpoint = 'day1_reflection'; await slow.tick(); capture('day1-reflection');
    const firstRequest = world.get().memory.maintenance.actors[OWNER].request;
    const firstGoals = world.get().memory.maintenance.actors[OWNER].goals;
    const firstSnapshot = world.get();
    const countBeforeNoop = counts().all; await slow.tick();
    assert.equal(counts().all, countBeforeNoop, 'The same reflection cannot bill twice');
    assert.deepEqual(world.get(), firstSnapshot, 'No-op daily maintenance does not append another fact');
    const restartBefore = canonicalDigest(world.get()); restart();
    assert.equal(canonicalDigest(world.get()), restartBefore); await slow.tick();
    assert.equal(counts().all, countBeforeNoop, 'Restart cannot repeat a settled provider call');
    report.gates.restart_no_double_bill = true;
    onProgress({ phase: 'day1', provider_calls: live ? counts().all : 0, reflection_status: firstRequest.status });
    // Allow the ordinary loop to execute a reflected intention. Do not stamp
    // a goal on a task, choose its status, or top up its conditions here.
    life.tick(); await choices.tick(); capture('post-reflection-life');
    checkpoint = 'day1_goal_execution';
    const day1GoalSettled = await until(() => [...(world.get().memory.maintenance.actors[OWNER].goals ?? []),
      ...(world.get().memory.maintenance.actors[OWNER].goal_history ?? [])].some(goal => goal.history?.length),
    firstGoals.length ? 120 : 0, { date: firstRequest.date });
    // Continue actual rule-governed living until the next Shanghai date. The
    // simulated clock advances only to scheduled deadlines or a small tick.
    const nextDate = localWorldDate(new Date(Date.parse(START) + DAY).toISOString(), 'Asia/Shanghai').date;
    checkpoint = 'cross_day_living';
    assert.equal(await until(() => localWorldDate(at(), 'Asia/Shanghai').date === nextDate, 600, { choose: false }), true,
      'The isolated run must cross two actual logical Shanghai dates');
    // Travel/observation facts are valid memories but do not imply a recipe
    // intention. Wait for a new real activity result, not merely another fact.
    checkpoint = 'day2_real_activity';
    const day2Activity = await until(() => world.get().memory.episodes.some(episode => episode.kind === 'world_fact'
      && episode.model_safe && episode.source?.activity_id && episode.topic
      // The deterministic fixture openly samples one care recipe. It waits
      // for that actual result rather than converting an unrelated one-off
      // harvest into a claim that repeating it is presently possible.
      && (live || episode.source.activity_id === 'tend-bed')
      && localWorldDate(episode.at, 'Asia/Shanghai').date === nextDate), 120, { choose: false, date: nextDate });
    report.gates.day2_new_recipe_fact = day2Activity;
    checkpoint = 'day2_reflection'; await slow.tick(); capture('day2-reflection');
    const day2Request = structuredClone(world.get().memory.maintenance.actors[OWNER].request);
    const day2Goals = structuredClone(world.get().memory.maintenance.actors[OWNER].goals);
    life.tick(); await choices.tick();
    checkpoint = 'day2_goal_execution';
    // A reflection after today's enacted practice may need a later legal
    // opportunity. This release only observes the second date and reports
    // inconclusive if it does not execute; it does not force another practice.
    const day2GoalSettled = await until(() => world.get().memory.maintenance.actors[OWNER].goals
      .some(goal => goal.history?.length && goal.created_by !== firstRequest.id), day2Goals.length ? 120 : 0,
    { date: nextDate });
    capture('day2-life-results');
    // An intention formed after today's discretionary practice legitimately
    // waits for the next local day. Follow that same captured goal through a
    // bounded third date; don't reset it, refill materials, mint a model goal
    // or confuse tomorrow's separate ordinary task with this intention.
    const carriedGoalIds = new Set(day2Goals.map(goal => goal.goal_id));
    const carriedGoalSettled = () => [...(world.get().memory.maintenance.actors[OWNER].goals ?? []),
      ...(world.get().memory.maintenance.actors[OWNER].goal_history ?? [])]
      .some(goal => carriedGoalIds.has(goal.goal_id) && goal.history?.length);
    let nextOpportunitySettled = day2GoalSettled;
    const thirdDate = localWorldDate(new Date(Date.parse(START) + 2 * DAY).toISOString(), 'Asia/Shanghai').date;
    if (!nextOpportunitySettled && day2Goals.length) {
      checkpoint = 'carried_intention_next_day';
      assert.equal(await until(() => localWorldDate(at(), 'Asia/Shanghai').date === thirdDate, 600, { choose: false }), true);
      capture('day3-carried-intention');
      restart(); capture('day3-restarted-intention');
      checkpoint = 'carried_intention_execution';
      nextOpportunitySettled = await until(carriedGoalSettled, 180, { date: thirdDate });
      capture('day3-life-results');
    }
    const own = world.get().memory.maintenance.actors[OWNER];
    report.gates.cross_day_reflection = own.request.date !== firstRequest.date;
    report.gates.reflection_outputs_valid = [firstRequest.status, own.request.status].every(status => status === 'completed');
    report.gates.goal_execution = { day1: day1GoalSettled, day2: day2GoalSettled,
      carried_intention_next_opportunity: nextOpportunitySettled,
      day2_goal_ids: [...carriedGoalIds],
      empty_day1: firstGoals.length === 0, empty_day2: day2Goals.length === 0 };
    const chains = [...(own.goals ?? []), ...(own.goal_history ?? [])].map(goal => ({ ...goalSummary(goal),
      plans: [...goalPlans.values()].filter(plan => plan.goal_id === goal.goal_id),
      canonical_tasks: [...canonicalGoalTasks.values()].filter(task => task.cognition_goal_id === goal.goal_id).map(task => ({
        task_id: task.task_id, activity_id: task.activity_id, status: task.status, plan_id: task.life_plan_id,
        origin: task.origin, result_success: task.completion?.result?.success ?? null })) }));
    checkpoint = 'canonical_goal_chains';
    report.goal_execution_chains = chains;
    for (const chain of chains) for (const result of chain.history ?? []) {
      assert.equal(result.authority, 'canonical_task');
      const task = chain.canonical_tasks.find(task => task.task_id === result.task_id);
      assert.ok(task); assert.equal(task.activity_id, chain.activity_id); assert.equal(task.status, result.outcome);
      assert.ok(chain.plans.some(plan => plan.plan_id === task.plan_id && plan.task_ids.includes(task.task_id)),
        'Goal must have the actual autonomous plan that started this exact canonical task');
    }
    report.goal_execution_chains = chains;
    // A public external world observation must be reviewed before its legal
    // world-line mutation, and repeated approval is a no-op across restart.
    const noticeEvent = { event_id: 'asamana-review:external-world-notice', type: 'external.world_event',
      source: 'untrusted_observation', source_kind: 'external_provider', character_id: OWNER, occurred_at: at(), observed_at: at(),
      payload: { world_event: { event_id: 'asamana-review:accepted-notice', title: '水岸收到一封公开来信',
        summary: '公开虚构样本留下一条待核对的旧路消息。', opportunity: '有空再决定是否核对。' } } };
    checkpoint = 'world_candidate'; const beforeObserve = canonicalDigest(world.get());
    const candidate = candidates.observe(noticeEvent).candidate; assert.ok(candidate);
    assert.equal(canonicalDigest(world.get()), beforeObserve);
    const beforePreview = canonicalDigest({ world: world.get(), mutations: world.listMutations({ limit: 1000 }) });
    candidates.preview(candidate.candidate_id);
    assert.equal(canonicalDigest({ world: world.get(), mutations: world.listMutations({ limit: 1000 }) }), beforePreview);
    candidates.accept(candidate.candidate_id, { expectedWorldRevision: world.get().world_revision });
    const candidateBeforeRestart = canonicalDigest({ world: world.get(), mutations: world.listMutations({ limit: 1000 }) });
    restart(); candidates.accept(candidate.candidate_id, { expectedWorldRevision: -1 });
    assert.equal(canonicalDigest({ world: world.get(), mutations: world.listMutations({ limit: 1000 }) }), candidateBeforeRestart);
    report.gates.world_candidate_preview_accept_duplicate = true;
    checkpoint = 'ingress_idempotency'; const beforeDuplicate = canonicalDigest(world.get());
    for (const record of originalIngress) assert.equal(world.ingest(record.event, record.adapter).duplicate, true);
    assert.equal(canonicalDigest(world.get()), beforeDuplicate);
    report.gates.ingress_idempotency = true;
    const completedDates = [...new Set(world.get().memory.development.records.filter(record => record.effect?.practice
      && record.outcome === 'completed').map(record => localWorldDate(record.at, 'Asia/Shanghai').date))];
    assert.ok(completedDates.length >= 2, 'Cross-day activity roots must be produced by original recipes');
    report.gates.real_activity_dates = completedDates;
    checkpoint = 'final_restart';
    const durableMemory = canonicalDigest(world.get().memory); const callsBeforeFinal = counts().all;
    restart(); assert.equal(canonicalDigest(world.get().memory), durableMemory);
    // A new logical date legitimately permits a new reflection. This test
    // claims no rebilling only while still on the already settled date.
    if (localWorldDate(at(), 'Asia/Shanghai').date === day2Request.date) {
      await slow.tick(); assert.equal(counts().all, callsBeforeFinal);
      assert.equal(canonicalDigest(world.get().memory), durableMemory);
    } else report.gates.final_reflection_skipped_new_date = true;
    report.gates.final_restart_memory_and_call_count = true;
    report.status = !report.gates.reflection_outputs_valid ? 'inconclusive_reflection_failed'
      : day1GoalSettled && nextOpportunitySettled ? 'verified'
      : firstGoals.length === 0 || day2Goals.length === 0 ? 'inconclusive_no_intention' : 'inconclusive_goal_not_executed';
    report.calls = calls; report.fixture_calls = live ? 0 : calls.length; report.external_calls = live ? calls.length : 0;
    report.ended_at = at(); report.snapshots = snapshots;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    return { report, reportPath, databasePath };
  } catch (error) {
    report.status = 'failed'; report.failure = { checkpoint,
      code: /^[a-zA-Z0-9_: .-]{1,200}$/.test(error?.code ?? '') ? error.code : 'review_invariant_failed' };
    report.calls = calls; report.external_calls = live ? calls.length : 0; report.ended_at = at(); report.snapshots = snapshots;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    const failure = Error('migration_review_failed'); failure.reportPath = reportPath; throw failure;
  } finally { close(); }
}

async function main() {
  const options = parseMigrationReviewArgs();
  if (options.help) {
    console.log('Default (zero external calls): node scripts/review-asamana-migration.mjs');
    console.log('Live (max 6 calls, explicit local config, env proxy enabled): node --use-env-proxy scripts/review-asamana-migration.mjs --live --config PATH --max-requests 6');
    return;
  }
  const result = await runMigrationReview({ ...options, onProgress: progress => console.log(JSON.stringify(progress)) });
  console.log(JSON.stringify({ status: result.report.status, external_calls: result.report.external_calls,
    fixture_calls: result.report.fixture_calls, report: result.reportPath, database: result.databasePath,
    installed_world_untouched: true, simulated_clock: true }));
  if (result.report.status !== 'verified') process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(JSON.stringify({ error: 'migration_review_failed', ...(error.reportPath ? { report: error.reportPath } : {}) }));
  process.exitCode = 1;
});
