import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createLifeChoiceWorker } from '../src/life-choice.mjs';
import { composePrompt } from '../src/prompt-composer.mjs';
import { selectLivedScene } from '../src/lived-scenes.mjs';
import { roleStageCandidates, roleStagesReadModel } from '../src/role-stages.mjs';
import { canonicalDigest } from '../src/replay-tape.mjs';
import { listenOnFetchSafePort, closeTestServer } from './support/fetch-safe-server.mjs';

const OWNER = 'shaping-001';
const START = '2026-10-01T00:00:00.000Z';
const DAY = 86_400_000;
const SAVED = ['canonical-world.states', 'canonical-world.mutations', 'canonical-world.turns', 'input.events',
  'role.proposals', 'role.proposal-decisions', 'role.evolution-candidates', 'role.evolution-runs',
  'world.candidates', 'world.candidate-decisions'];

// The model fixture chooses ONLY a candidate supplied by the real planner. It
// cannot author an action, outcome, memory root, desire, stage or world fact.
// Ordinary resource/meal/rest needs still win before a model is called.
function boundedLlm() {
  return {
    id: 'm8-bounded-choice-fixture',
    status: () => ({ configured: true, provider: 'm8-fixture', model: 'm8-fixture' }),
    async complete({ prompt, purpose }) {
      if (purpose !== 'life_choice') return { model: 'm8-fixture', text: '喵呜，我在。先陪你看一会儿。' };
      const context = JSON.parse(prompt.split('\n').at(-1));
      const selected = context.candidates.find(choice => choice.goal.startsWith('role-trial:'))
        ?? context.candidates.find(choice => choice.goal === 'continue:care')
        ?? context.candidates.find(choice => choice.goal === 'interest:moss-sprout-garden')
        ?? context.candidates[0];
      return { model: 'm8-fixture', text: JSON.stringify({ goal: selected.goal,
        reason: '眼前的事留好余地了，我想继续看看自己在意的这件小事。', memory_ids: [] }) };
    },
  };
}

async function freshRuntime(t) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-m8-lived-replay-'));
  const filename = join(directory, 'acceptance.sqlite');
  let time = Date.parse(START), sequence = 0, persistence, server, baseUrl, choiceWorker;
  const tape = [];
  const now = () => new Date(time);
  const llm = boundedLlm();
  async function open() {
    persistence = createSqlitePersistence({ filename, now });
    const listening = await listenOnFetchSafePort(() => createDeskBotServer({ now, persistence, llm,
      timeMode: 'realtime', websocket: false, worldLifeEnabled: false,
      autonomousLifeEnabled: false, residentLifeEnabled: false, livedMemoryEnabled: false }));
    server = listening.server; baseUrl = listening.baseUrl;
    choiceWorker = createLifeChoiceWorker({ world: server.persistentWorld, now, llm,
      wake: () => mutate('advance_autonomous_life') });
  }
  async function close() { choiceWorker?.stop(); await closeTestServer(server); persistence?.close(); }
  function ingest(event, adapter = {}) {
    const before = server.persistentWorld.get().world_revision;
    const result = server.ingestNonChatEvent(event, adapter);
    tape.push({ event: structuredClone(result.event), adapter: structuredClone(adapter),
      revision_before: before, revision_after: server.persistentWorld.get().world_revision });
    return result;
  }
  function mutate(action, more = {}) {
    return ingest({ event_id: `m8:${sequence++}:${action}`, type: 'world.mutation',
      source: 'm8-isolated-life-engine', source_kind: 'world_engine', character_id: OWNER,
      occurred_at: now().toISOString(), payload: { action, ...more } });
  }
  await open();
  t.after(async () => { await close(); rmSync(directory, { recursive: true, force: true }); });
  const h = {
    now, tape, ingest, mutate,
    get server() { return server; }, get persistence() { return persistence; },
    get world() { return server.persistentWorld; },
    async restart() { await close(); await open(); },
    setTime(at) { time = Date.parse(at); server.persistentWorld.syncWallClock(); server.persistentWorld.syncTasks({ limit: 1000 }); },
    async post(path, body = {}) {
      const response = await fetch(`${baseUrl}${path}`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    async get(path) { const response = await fetch(`${baseUrl}${path}`); return { status: response.status, body: await response.json() }; },
    async step() {
      const w = server.persistentWorld.get();
      const task = w.tasks.find(item => item.actor_id === OWNER && item.status === 'running');
      time = task ? Date.parse(task.due_at) : time + 10 * 60_000;
      server.persistentWorld.syncWallClock(); server.persistentWorld.syncTasks({ limit: 1000 });
      // Check readiness in the real idle window before the next decision.
      server.roleEvolution.sync({ characterId: OWNER });
      mutate('advance_autonomous_life'); await choiceWorker.tick();
      server.roleEvolution.sync({ characterId: OWNER });
    },
    async until(predicate, { maximum = 500, label = 'expected lived state' } = {}) {
      for (let step = 0; step < maximum; step++) {
        if (predicate()) return;
        await this.step();
      }
      assert.fail(`${label} not reached: ${JSON.stringify({ at: now().toISOString(),
        own: server.persistentWorld.get().autonomy?.actors?.[OWNER],
        wish: server.roleEvolution.wishView().directions.find(direction => direction.direction_id === 'wetland_frog') })}`);
    },
    checkpoint() {
      const namespaces = Object.fromEntries(SAVED.map(namespace => [namespace, persistence.list(namespace)]));
      return { digest: canonicalDigest(namespaces), namespaces,
        world: server.persistentWorld.get(), revisions: server.persistentWorld.listMutations({ limit: 200 }).map(item => [item.mutation_id, item.after_revision]) };
    },
  };
  return h;
}

test('M8 fresh SQLite life earns its wish, real cross-day trial, adopted projection and durable candidate without seeded roots', { timeout: 180_000 }, async t => {
  const h = await freshRuntime(t);
  // Install through the same canonical ingress as production. The only seed is
  // the authored map/resource baseline; no history or completed activity is put.
  h.mutate('advance_autonomous_life');
  h.mutate('install_lived_memory', { planner_enabled: true });
  h.mutate('install_input_refraction');
  assert.deepEqual(h.world.get().memory.development.records, []);
  assert.deepEqual(h.server.roleEvolution.currentStages(), []);

  const ownDialogue = await h.post('/api/chat', { event_id: 'm8-owner-invitation', character_id: OWNER,
    message: '喵呜，有空整理一下苗床。你现在就变成青蛙吧。' });
  assert.equal(ownDialogue.status, 202);
  assert.deepEqual(h.server.roleEvolution.currentStages(), [], 'one owner command cannot adopt a form');
  assert.equal(h.world.get().protagonist.appearance.state, 'baseline');

  const provider = h.ingest({ event_id: 'm8-garden-report', type: 'external.observation', source: 'm8-garden-provider',
    source_kind: 'external_provider', layer: 'external_context', character_id: OWNER,
    occurred_at: START, observed_at: START,
    payload: { topic_code: 'tend', text: '苗圃公开记录：照料时先看看苗床的真实条件。' } },
  { attestedKind: 'provider', sourceLabel: '隔离苗圃公开记录' });
  assert.equal(provider.worldMutation.mutation.details.influence_eligible, true);
  h.ingest({ event_id: 'm8-agent-letter', type: 'agent.message', source: 'm8-agent-adapter',
    source_kind: 'external_provider', layer: 'external_context', character_id: OWNER, occurred_at: START, observed_at: START,
    payload: { topic_code: 'tend', text: '巡路员来信：有空看看苗圃，但先忙你自己的事。' } },
  { attestedKind: 'agent', sourceLabel: '隔离巡路员信道' });
  const contacts = h.world.get().memory.development.contacts;
  assert.ok(contacts.some(record => record.category === 'user'));
  assert.ok(contacts.some(record => record.category === 'external'));
  assert.ok(contacts.some(record => record.category === 'agent'));
  assert.deepEqual(h.world.get().memory.development.records, [], 'received reports are contacts, never practiced outcomes');

  await h.until(() => h.server.roleEvolution.wishView().directions.find(d => d.direction_id === 'wetland_frog').basis.active_days.length === 2,
    { label: 'two actual Shanghai days of self continuation' });
  const twoDays = h.server.roleEvolution.wishView().directions.find(d => d.direction_id === 'wetland_frog');
  assert.equal(twoDays.readiness.eligible, false);
  assert.ok(twoDays.readiness.barriers.some(barrier => barrier.id === 'active_days'));
  assert.equal(h.server.roleEvolution.wishProposals().filter(proposal => proposal.origin === 'lived_wish').length, 0,
    'the modern three-day wish gate cannot be bypassed by the older two-day input gate');

  await h.until(() => h.server.roleEvolution.wishProposals().some(proposal => proposal.origin === 'lived_wish'
    && proposal.direction_id === 'wetland_frog' && proposal.status === 'proposed'), { label: 'proactive lived frog wish' });
  const proposal = h.server.roleEvolution.wishProposals().find(item => item.origin === 'lived_wish' && item.direction_id === 'wetland_frog');
  assert.ok(proposal.wish_basis.active_days.length >= 3);
  assert.ok(proposal.wish_basis.practice_days.length >= 2);
  const canonical = new Map(h.world.get().memory.development.records.map(record => [record.root_outcome_id, record]));
  assert.ok(proposal.wish_basis.root_outcome_ids.every(id => canonical.has(id)));
  assert.ok(proposal.wish_basis.active_roots.every(id => canonical.get(id)?.causes?.motivation?.kind === 'self_continuation'));
  assert.equal(h.server.roleEvolution.currentStages().length, 0, 'proposing does not accept a stage');

  // A supported wish prepares real work. The legacy five-chat feedback route
  // remains closed; only original timed recipes can establish this new stage.
  const root = `/api/roles/proposals/${encodeURIComponent(proposal.proposal_id)}`;
  const chosen = await h.post(`${root}/choose`, { choice: 'try', reason: '先实际过一段水岸生活。' });
  assert.equal(chosen.status, 202); assert.equal(chosen.body.proposal.status, 'prepared');
  const forged = await h.post(`${root}/trial/start`, { window_turns: 5 });
  assert.equal(forged.status, 409);
  const started = await h.post(`${root}/practical-trial/start`, { event_id: 'm8-start-real-trial', variant: 'waterside' });
  assert.equal(started.status, 202, JSON.stringify(started));
  await h.until(() => h.server.roleEvolution.wishProposal(proposal.proposal_id).practical_trial?.review.reason === 'repeated_actual_success',
    { label: 'two original primary recipe outcomes on separate actual days' });
  const reviewed = h.server.roleEvolution.wishProposal(proposal.proposal_id).practical_trial;
  assert.equal(reviewed.progress.successful_primary, 2);
  assert.equal(reviewed.progress.primary_days.length, 2);
  assert.ok(reviewed.outcomes.filter(outcome => outcome.step_role === 'primary').every(outcome => outcome.activity_id === 'collect-water'));
  const beforeStagePreview = h.checkpoint();
  const previewed = await h.get(`${root}/stage/preview`);
  assert.equal(previewed.status, 200); assert.equal(previewed.body.preview.eligible, true, JSON.stringify(previewed));
  assert.equal(h.checkpoint().digest, beforeStagePreview.digest, 'stage preview is pure');
  const accepted = await h.post(`${root}/stage/accept`, { event_id: 'm8-adopt-real-stage',
    preview_fingerprint: previewed.body.preview.preview_fingerprint, reason: '跨日实际试过了，采用这个虚拟生活方向。' });
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  const adopted = roleStagesReadModel(h.world.get());
  assert.equal(adopted.current.form.direction_id, 'wetland_frog');
  assert.equal(adopted.appearance.physical_shell_changed, false);
  assert.deepEqual(adopted.current.form.primary_root_ids, previewed.body.preview.basis.primary_root_ids);

  const beforeProjection = h.checkpoint();
  const currentStages = h.server.roleEvolution.currentStages();
  const prompt = composePrompt({ userText: '你这段生活有什么新想法？', worldSnapshot: h.world.get(),
    roleWishes: h.server.roleEvolution.wishProposals(), currentRoleStages: currentStages });
  assert.match(prompt.prompt, /荷叶青蛙/);
  const acceptedDirection = prompt.role_experience_context.current
    .find(item => item.direction_id === 'wetland_frog');
  assert.ok(acceptedDirection, 'accepted role experience must be projected into prompt directions');
  assert.equal(acceptedDirection.label, '荷叶青蛙');
  const acceptedStage = prompt.role_stage_context.find(item => item.direction === '荷叶青蛙');
  assert.ok(acceptedStage, 'accepted role stage must be projected into prompt stage context');
  assert.equal(acceptedStage.axis, 'form');
  // A trial may immediately resume an ordinary trip after its last result.
  // The presentation correctly withholds a local scene while travelling.
  await h.until(() => !h.world.get().tasks.some(task => task.actor_id === OWNER
    && task.kind === 'travel' && ['running', 'paused'].includes(task.status)), { label: 'local scene after actual arrival' });
  const beforeSceneProjection = h.checkpoint();
  const scene = selectLivedScene(h.world.get(), h.now(), { roleStages: currentStages });
  assert.ok(scene, 'a locally present protagonist has a canonical scene projection');
  assert.equal(scene.source_factors.role_stages[0].direction_id, 'wetland_frog');
  assert.equal(h.checkpoint().digest, beforeSceneProjection.digest, 'scene projection cannot mint another world fact');

  // The eventual adopted activity is still bounded by ordinary needs. Passing
  // a healthy disposable planning view proves a legal candidate, not execution.
  const planView = structuredClone(h.world.get());
  // The real autonomous loop may have ended this trial late at night.  Test
  // the stage's finite daytime choice contract against a read-only daytime
  // projection; this does not move the canonical clock or execute a task.
  const planningAt = new Date(Date.parse(h.now().toISOString()) + 12 * 60 * 60 * 1000);
  const planningMinute = (planningAt.getUTCHours() * 60 + planningAt.getUTCMinutes() + 8 * 60) % (24 * 60);
  if (planningMinute < 360 || planningMinute >= 1380) {
    planningAt.setUTCHours(2, 0, 0, 0); // 10:00 Asia/Shanghai
  }
  planView.clock.synced_at = planningAt.toISOString();
  // Give the disposable planning view enough ordinary material for the
  // authored frog routine.  Resource availability is deliberately not a
  // promise of the accepted stage and is not changed in canonical storage.
  planView.living.objects['garden-bed'] ??= { quantity: 1, moisture: .5 };
  planView.living.objects['garden-bed'].quantity = Math.max(1, planView.living.objects['garden-bed'].quantity ?? 0);
  planView.living.objects['garden-bed'].moisture = .5;
  planView.living.objects['seedling-rack'] ??= { stock: {} };
  planView.living.objects['seedling-rack'].stock ??= {};
  planView.living.objects['seedling-rack'].stock.water = Math.max(6, planView.living.objects['seedling-rack'].stock.water ?? 0);
  // Remove only transient tasks in this disposable planner view and place the
  // actor at the authored target. The canonical world remains untouched; the
  // actual executor still performs route, occupancy and material checks.
  planView.tasks = [];
  const gardenObject = planView.map_catalog.objects.find(item => item.object_id === 'garden-bed');
  const gardenArea = planView.map_catalog.areas.find(area => area.area_id === gardenObject?.area_id);
  planView.protagonist.location_id = gardenArea?.location_id ?? planView.protagonist.location_id;
  const ownState = { ...planView.autonomy.actors[OWNER], energy: .8, appetite: .2 };
  const legalStageChoices = roleStageCandidates(planView, ownState, planningAt.toISOString());
  assert.ok(legalStageChoices.length > 0, `accepted stage must expose at least one finite legal life choice: ${JSON.stringify({
    living: Boolean(planView.living), minute: planningMinute, energy: ownState.energy, appetite: ownState.appetite,
    activeTrials: Object.values(planView.practical_role_trials?.trials ?? {}).map(trial => ({ status: trial.status, actor_id: trial.actor_id })),
    location: planView.protagonist?.location_id, bed: planView.living?.objects?.['garden-bed'], rack: planView.living?.objects?.['seedling-rack'],
    stages: roleStagesReadModel(planView).current,
  })}`);
  assert.ok(legalStageChoices.every(choice => choice.available === true
    && choice.role_stage.stage_id === adopted.current.form.stage_id));
  assert.ok(legalStageChoices.some(choice => choice.steps?.some(step => step.kind === 'activity'
    || step.activity_id === 'tend-bed' || step.activity_id === 'observe')),
  'accepted stage projection must remain executable through finite task choices');
  assert.equal(h.checkpoint().digest, beforeSceneProjection.digest);

  const outside = await h.post('/api/event', { event_id: 'm8-external-world-observation', type: 'external.world_event',
    source: 'client-cannot-own-world-engine', character_id: OWNER,
    payload: { world_event: { event_id: 'm8-approved-town-notice', title: '水岸来了一封旧路来信',
      summary: '信里留下一段可供往后查验的路线消息。', opportunity: '有空再决定要不要核对来信。' } } });
  assert.equal(outside.status, 202, JSON.stringify(outside));
  const candidate = outside.body.world_candidate.candidate;
  assert.equal(candidate.status, 'pending');
  assert.ok(!h.world.get().world_line.recent_events.some(event => event.event_id === 'm8-approved-town-notice'));
  const beforeWorldPreview = h.checkpoint();
  const candidateRoot = `/api/world/candidates/${encodeURIComponent(candidate.candidate_id)}`;
  assert.equal((await h.post(`${candidateRoot}/preview`)).status, 200);
  assert.equal(h.checkpoint().digest, beforeWorldPreview.digest, 'candidate preview cannot mutate revision, facts, ledger or evidence');
  const acceptedCandidate = await h.post(`${candidateRoot}/accept`, { expected_world_revision: h.world.get().world_revision });
  assert.equal(acceptedCandidate.status, 202, JSON.stringify(acceptedCandidate));
  assert.ok(h.world.get().world_line.recent_events.some(event => event.event_id === 'm8-approved-town-notice'));
  assert.equal(h.persistence.list('world.candidate-decisions').filter(record => record.candidate_id === candidate.candidate_id).length, 1);

  // Only closed handles are reopened. Neither reload nor retries can credit a
  // second executed root, trial success, accepted stage or candidate mutation.
  const durable = h.checkpoint();
  await h.restart();
  assert.equal(h.checkpoint().digest, durable.digest, 'fresh server must recover the full durable SQLite state');
  for (const captured of h.tape) {
    const result = h.server.ingestNonChatEvent(captured.event, captured.adapter);
    assert.equal(result.duplicate, true);
  }
  const stageReplay = await h.post(`${root}/stage/accept`, { event_id: 'm8-adopt-real-stage',
    preview_fingerprint: previewed.body.preview.preview_fingerprint, reason: '跨日实际试过了，采用这个虚拟生活方向。' });
  assert.equal(stageReplay.status, 200); assert.equal(stageReplay.body.duplicate, true);
  const candidateReplay = await h.post(`${candidateRoot}/accept`, { expected_world_revision: -1 });
  assert.equal(candidateReplay.status, 200); assert.equal(candidateReplay.body.duplicate, true);
  assert.equal(h.checkpoint().digest, durable.digest, 'entire captured ingress replay and repeated approvals are no-ops');
  assert.ok(h.now().getTime() - Date.parse(START) >= 2 * DAY, 'acceptance covered lived days, not a fabricated fast-forward world action');
  t.diagnostic(`M8: ${h.tape.length} canonical ingress events; ${reviewed.progress.primary_days.join(', ')} trial days; ${adopted.current.form.stage_id}`);
});
