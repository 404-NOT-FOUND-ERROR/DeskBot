import assert from 'node:assert/strict';
import test from 'node:test';
import { roleStageHttpFixture, stageSaved } from './support/role-stage-http-fixture.mjs';
import { composePrompt, modelRoleStageContext, modelRoleWishContext } from '../src/prompt-composer.mjs';
import { guardRoleWishFacts } from '../src/role-wish-fact-guard.mjs';
import { createChatOrchestrator } from '../src/chat-orchestrator.mjs';
import { createInputStore } from '../src/input-store.mjs';
import { createOutputRouter } from '../src/output-router.mjs';
import { createStateEngine } from '../src/state-engine.mjs';
import { createWorldContext } from '../src/world-context.mjs';
const OWNER = 'shaping-001';

test('canonical accepted form drives finite prompt and explicit reply; rollback ignores stale overlays and retains facts', async t => {
  const h = await roleStageHttpFixture(t), { proposal } = await h.actualReview();
  const preview = await h.preview(proposal.proposal_id);
  const accepted = await h.stageAction(proposal.proposal_id, 'accept', { event_id: 'expression-accept', preview_fingerprint: preview.preview_fingerprint });
  assert.equal(accepted.status, 202, JSON.stringify(accepted));
  const wishes = () => h.server.roleEvolution.wishProposals({ characterId: OWNER });
  const world = h.world.get(), before = stageSaved(h.persistence), stages = modelRoleStageContext(world);
  assert.equal(stages.length, 1); assert.equal(stages[0].direction, '荷叶青蛙');
  assert.equal(stages[0].virtual_appearance_adopted, true); assert.equal(stages[0].physical_shell_changed, false);
  const composed = composePrompt({ userText: '你现在已经变成青蛙了吗？', worldSnapshot: world, roleWishes: wishes(),
    currentRoleStages: [{ direction_id: 'chef', label: 'PRIVATE_FORGED', overlay: { speech: 'PRIVATE_OVERLAY' } }] });
  assert.match(composed.prompt, /当前虚拟形态：荷叶青蛙/); assert.doesNotMatch(composed.prompt, /PRIVATE_FORGED|PRIVATE_OVERLAY/);
  const roleContext = modelRoleWishContext(wishes(), world).find(item => item.direction === '荷叶青蛙');
  assert.equal(roleContext.adopted_stage.current, true); assert.equal(roleContext.changes_appearance, true);
  const query = '你现在已经变成青蛙了吗？';
  const guarded = guardRoleWishFacts({ userText: query, text: 'RAW_PHYSICAL 我已经换了实体蛙壳，可以跳进池塘。', worldSnapshot: world, roleWishes: wishes() });
  assert.equal(guarded.reason, 'canonical_role_stage_status'); assert.match(guarded.text, /虚拟造型已经采用荷叶青蛙/);
  assert.match(guarded.text, /实体外壳、声音和硬件能力还没有/); assert.doesNotMatch(guarded.text, /RAW_PHYSICAL|可以跳进/);
  assert.deepEqual(stageSaved(h.persistence), before, 'prompt and guard remain read-only');
  // A newer withdrawn wish/history must not hide a restored older current
  // direction. This is a read-model regression fixture, not a new adoption.
  const historic = structuredClone(world), archive = historic.role_stages.actors[OWNER];
  const actual = archive.versions[0];
  archive.versions.push({ ...structuredClone(actual), stage_id: 'newer-rolled', proposal_id: 'newer-withdrawn', status: 'rolled_back', rolled_back_at: h.now().toISOString() });
  const priorWishes = wishes(), latest = { ...priorWishes.find(p => p.proposal_id === proposal.proposal_id), proposal_id: 'newer-withdrawn', status: 'withdrawn', proposed_at: '2026-10-11T04:00:00Z' };
  const restored = guardRoleWishFacts({ userText: query, text: 'RAW_OLD_HISTORY', worldSnapshot: historic, roleWishes: [...priorWishes, latest] });
  assert.match(restored.text, /虚拟造型已经采用/); assert.doesNotMatch(restored.text, /现在已回退/);
  const stage = h.server.roleEvolution.currentStages({ characterId: OWNER }).find(item => item.direction_id === 'wetland_frog');
  const rollback = await h.stageAction(proposal.proposal_id, 'rollback', { event_id: 'expression-rollback', stage_id: stage.stage_id });
  assert.equal(rollback.status, 202, JSON.stringify(rollback));
  const after = h.world.get(); assert.deepEqual(modelRoleStageContext(after), []);
  const revertedPrompt = composePrompt({ userText: query, worldSnapshot: after, roleWishes: wishes(), currentRoleStages: [{ direction_id: 'chef', label: 'PRIVATE_STALE_STAGE', overlay: { speech: 'PRIVATE_OVERLAY' } }] });
  assert.match(revertedPrompt.prompt, /当前两个轴都没有采用中的新方向/); assert.doesNotMatch(revertedPrompt.prompt, /PRIVATE_STALE_STAGE|PRIVATE_OVERLAY/);
  const rolled = guardRoleWishFacts({ userText: query, text: 'RAW_STALE 我仍然已经是青蛙。', worldSnapshot: after, roleWishes: wishes() });
  assert.equal(rolled.reason, 'canonical_role_stage_status'); assert.match(rolled.text, /现在已回退/); assert.match(rolled.text, /实际.*经历|已经发生的经历/);
  assert.doesNotMatch(rolled.text, /RAW_STALE|虚拟造型已经采用/);
});

test('explicit two-axis status uses canonical combination after adoption and after a form rollback', async t => {
  const h = await roleStageHttpFixture(t), frog = (await h.actualReview()).proposal;
  let preview = await h.preview(frog.proposal_id);
  assert.equal((await h.stageAction(frog.proposal_id, 'accept', { event_id: 'combo-frog', preview_fingerprint: preview.preview_fingerprint })).status, 202);
  await h.actualActivity('gather-light-fruit', 'backlit-grove');
  const chef = (await h.actualReview('chef', { variant: 'stew' })).proposal;
  preview = await h.preview(chef.proposal_id);
  assert.equal((await h.stageAction(chef.proposal_id, 'accept', { event_id: 'combo-chef', preview_fingerprint: preview.preview_fingerprint })).status, 202);
  const render = () => guardRoleWishFacts({ userText: '你现在已经变成青蛙厨师了吗？', text: 'RAW_COMBO 已经能在现实跳跃做饭。', worldSnapshot: h.world.get(), roleWishes: h.server.roleEvolution.wishProposals({ characterId: OWNER }) });
  let reply = render(); assert.equal(reply.reason, 'canonical_role_stage_combination_status');
  assert.match(reply.text, /虚拟形态是荷叶青蛙，生活职业是灶边厨师/); assert.doesNotMatch(reply.text, /RAW_COMBO|已经能/);
  const form = h.server.roleEvolution.currentStages({ characterId: OWNER }).find(s => s.axis === 'form');
  assert.equal((await h.stageAction(frog.proposal_id, 'rollback', { event_id: 'combo-form-back', stage_id: form.stage_id })).status, 202);
  reply = render(); assert.match(reply.text, /虚拟形态是原来的造型，生活职业是灶边厨师/);
});

for (const withVoice of [false, true]) test(`adopted and rolled-back stage answer reaches ${withVoice ? 'TTS' : 'device speech'} and outbox consistently once`, async t => {
  const h = await roleStageHttpFixture(t), { proposal } = await h.actualReview();
  const preview = await h.preview(proposal.proposal_id);
  assert.equal((await h.stageAction(proposal.proposal_id, 'accept', { event_id: 'chat-stage-accept', preview_fingerprint: preview.preview_fingerprint })).status, 202);
  const inputStore = createInputStore({ persistence: h.persistence, now: h.now });
  const outputRouter = createOutputRouter({ persistence: h.persistence, now: h.now });
  const spoken = []; let calls = 0;
  const options = { inputStore, outputRouter, persistentWorld: h.world, persistence: h.persistence, now: h.now,
    stateEngine: createStateEngine({ persistence: h.persistence, now: h.now }), worldContext: createWorldContext({ now: h.now }),
    llm: { async complete() { calls++; return { text: 'PRIVATE_RAW_STAGE 我已经换了蛙壳，获得跳跃能力。', provider: 'controlled', model: 'controlled' }; } },
    currentRoleStages: id => h.server.roleEvolution.currentStages({ characterId: id }),
    currentRoleWishes: id => h.server.roleEvolution.wishProposals({ characterId: id }),
    ...(withVoice ? { voiceClient: { async synthesize(request) { spoken.push(request.text); return { audio: {}, request_id: `stage-audio-${calls}` }; } },
      audioArtifacts: { put() { return { artifact: { audio_id: `stage-audio-${calls}`, format: { codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 }, duration_ms: 200, byte_count: 6400, sha256: '0'.repeat(64), encoding: 'binary', profile: {} }, duplicate: false }; } } } : {}),
  };
  for (const phase of ['accepted', 'rolled-back']) {
    if (phase === 'rolled-back') {
      const stage = h.server.roleEvolution.currentStages({ characterId: OWNER })[0];
      assert.equal((await h.stageAction(proposal.proposal_id, 'rollback', { event_id: 'chat-stage-rollback', stage_id: stage.stage_id })).status, 202);
    }
    const before = h.world.get();
    const baseline = stageSaved(h.persistence).filter(([ns]) => ns.startsWith('role.'));
    const orchestrator = createChatOrchestrator(options);
    const request = { event_id: `stage-chat-${phase}`, character_id: OWNER, device_id: 'vocat-001', message: '你现在已经变成青蛙了吗？' };
    const turn = await orchestrator.run(request), replay = await orchestrator.run(request);
    assert.equal(replay.duplicate, true); assert.equal(replay.reply, turn.reply);
    assert.equal(turn.trace.role_wish_fact_guard.reason, 'canonical_role_stage_status');
    assert.match(turn.reply, phase === 'accepted' ? /虚拟造型已经采用/ : /现在已回退/);
    assert.doesNotMatch(turn.reply, /PRIVATE_RAW_STAGE|获得跳跃/);
    assert.equal(turn.reply_event.payload.text, turn.reply);
    assert.ok(turn.planned_output_plan.filter(o => o.type === 'speak').every(o => o.text === turn.reply));
    if (withVoice) assert.equal(spoken.at(-1), turn.reply);
    else assert.ok(turn.output_route.commands.filter(o => o.type === 'speak').every(o => o.payload.text === turn.reply));
    assert.doesNotMatch(JSON.stringify(h.persistence.list('output.commands')), /PRIVATE_RAW_STAGE|获得跳跃/);
    assert.deepEqual(stageSaved(h.persistence).filter(([ns]) => ns.startsWith('role.')), baseline);
    const after = h.world.get();
    for (const key of ['tasks', 'living', 'role_stages', 'practical_role_trials']) assert.deepEqual(after[key], before[key]);
    assert.deepEqual(after.protagonist.appearance, before.protagonist.appearance);
    assert.deepEqual(after.memory.development.records, before.memory.development.records);
    const restarted = createChatOrchestrator(options); assert.equal((await restarted.run(request)).reply, turn.reply);
  }
  assert.equal(calls, 2); if (withVoice) assert.equal(spoken.length, 2);
});
