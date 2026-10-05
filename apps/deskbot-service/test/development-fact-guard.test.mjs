import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardDevelopmentFacts } from '../src/development-fact-guard.mjs';
import { createChatOrchestrator } from '../src/chat-orchestrator.mjs';
import { createInputStore } from '../src/input-store.mjs';
import { createOutputRouter } from '../src/output-router.mjs';
import { createStateEngine } from '../src/state-engine.mjs';
import { createWorldContext } from '../src/world-context.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { installAutonomy } from '../src/life-state.mjs';
import { installRefraction } from '../src/input-refraction.mjs';
import { installLivedMemory, syncLivedMemory, modelDevelopmentContext } from '../src/lived-memory.mjs';

const OWN = 'shaping-001', AT = '2026-10-06T04:00:00.000Z';
const QUESTION = '我让你多照料苗圃，是不是说明你已经很喜欢它，而且会照料了？';
const RAW = '你交给我做的事，我做了，说明我把它做完了。我按你说的去浇水、去看它。';
function snapshot({ success = false, failed = false } = {}) {
  return {
    protagonist: { character_id: OWN }, npcs: [], clock: { synced_at: AT },
    memory: { development: { revision: 1, contacts: [{ actor_id: OWN, topic: 'care', at: AT, source_record_id: 'private-contact' }],
      records: success || failed ? [{ root_outcome_id: 'task:private-root', actor_ids: [OWN], at: AT, activity_id: 'tend-bed',
        outcome: failed ? 'failed' : 'completed', topic: 'care', source: { kind: 'canonical_task', life_action: 'activity' },
        effect: { practice: true }, causes: { trigger: 'invited', motivation: { kind: 'invited' } },
        ...(failed ? { failure: { classification: 'condition', code: 'crop_absent' } } : {}) }] : [] } },
  };
}
const guard = (text, worldSnapshot = snapshot(), userText = QUESTION, extra = {}) =>
  guardDevelopmentFacts({ userText, text, worldSnapshot, ...extra });

test('contact-only self assessment corrects definite first-person practice without inventing feelings or evidence', () => {
  const w = snapshot(), before = structuredClone(w);
  for (const text of [RAW, '我做过照料。', '说明我把苗床照料的事做完了。', '我按你说的去浇水。']) {
    const result = guard(text, w);
    assert.equal(result.applied, true, text);
    assert.equal(result.topic, 'care');
    assert.equal(result.reason, 'affirmative_completed_practice_without_success');
    assert.match(result.text, /听到这个建议/);
    assert.match(result.text, /还没有真正完成照料的记录/);
    assert.doesNotMatch(result.text, /喜欢它|开心|private-/);
  }
  assert.deepEqual(w, before, 'reading and replacing a reply must not add an actual outcome');
});

test('a definite ability claim is bounded to an authored practice topic', () => {
  for (const [question, text, topic] of [
    [QUESTION, '照料我做得来。', 'care'],
    ['你在小镇已经会做饭了吗？', '我会做饭。', 'cook'],
    ['你在聚形域擅长制作托盘吗？', '我能做托盘。', 'craft'],
    ['你在小镇维修水泵做得来吗？', '我会修理水泵。', 'repair'],
  ]) {
    const result = guard(text, snapshot(), question);
    assert.equal(result.applied, true, text); assert.equal(result.topic, topic);
    assert.equal(result.reason, 'definite_ability_without_success');
  }
});

test('correct negative, uncertain, hypothetical and future self assessments pass through', () => {
  for (const text of [
    '我还没做过照料，不能说已经会了。', '我没有把苗床做完。', '我不是不会，而是还没有真正做过。',
    '如果有苗木，我会照料。', '要是有空，我按你说的去浇水。', '我可能会照料，但要试过才知道。',
    '我准备做托盘。', '我想去浇水。', '我明天按你说的去浇水。', '我会去浇水，完成后再说。',
    '我试一试，再看做不做得来。',
  ]) {
    const result = guard(text);
    assert.equal(result.applied, false, text); assert.equal(result.text, text);
  }
});

test('another actor, quotation, attention and non-practice decisions do not become execution claims', () => {
  for (const text of [
    '小岚已经照料过苗床，我看他做了。', '你说“我做了”，这还不能证明我的能力。',
    '主人说我会照料，但我还没试过。', '我做了一个决定：先去观察。',
    '我把计划做完了，下一步才动手。', '我在苗圃观察过，也听到了建议。',
  ]) {
    const result = guard(text);
    assert.equal(result.applied, false, text); assert.equal(result.text, text);
  }
});

test('ordinary real help, missing virtual context and ambiguous or unknown topics are untouched', () => {
  for (const question of [
    '你会做饭吗？教我一个菜谱。', '在现实里我该怎么照料苗圃？', '你会浇水吗？',
    '苗圃今天怎么样？', '你在聚形域会驾驶星舰了吗？', '你在小镇会照料和做饭了吗？',
    '你在苗圃已经会照料了吗，也教我如何做盆栽养护。',
  ]) assert.equal(guard('我会照料。我做了。', snapshot(), question).applied, false, question);
});

test('one actual success is sufficient to leave this narrow guard, and unavailable evidence remains unknown', () => {
  assert.equal(guard(RAW, snapshot({ success: true })).reason, 'actual_success_available');
  for (const w of [null, { protagonist: { character_id: OWN } }, { ...snapshot(), protagonist: null }]) {
    const result = guard(RAW, w); assert.equal(result.applied, false); assert.equal(result.text, RAW);
  }
  assert.equal(guard(RAW, snapshot(), QUESTION, { actorId: 'unregistered-actor' }).reason, 'topic_evidence_unavailable');
});

test('a zero-success condition failure with a truthful bounded explanation is untouched', () => {
  const text = '苗床已经空了，照料需要的苗木不在，这次没有完成。我还不能说自己会照料，也不把这次条件问题说成能力差。';
  const result = guard(text, snapshot({ failed: true }));
  assert.equal(result.applied, false); assert.equal(result.text, text);
});

test('chat applies the guard once before reply, speech and outbox, preserves local raw audit, and retry stays idempotent', async t => {
  for (const withVoice of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'deskbot-fact-guard-'));
    const persistence = createSqlitePersistence({ filename: join(dir, 'test.sqlite') });
    t.after(() => { persistence.close(); rmSync(dir, { recursive: true, force: true }); });
    const now = () => new Date(AT);
    let world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    const w = world.get(); installAutonomy(w, AT); installLivedMemory(w, AT);
    installRefraction(w, AT);
    w.refraction.records.push({ id: 'private-contact', origin_id: 'private-contact', category: 'dialogue',
      attested: true, freshness: 'fresh', suggestion: 'tend', received_at: AT, status: 'completed' });
    syncLivedMemory(w, AT); persistence.put('canonical-world.states', w.world_id, w);
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    const inputStore = createInputStore({ persistence, now }), outputRouter = createOutputRouter({ persistence, now });
    let calls = 0; const spoken = [];
    const orchestrator = createChatOrchestrator({ inputStore, outputRouter, persistentWorld: world, persistence, now,
      stateEngine: createStateEngine({ persistence, now }), worldContext: createWorldContext({ now }),
      llm: { async complete() { calls++; return { provider: 'test', model: 'test', text: RAW, trace: { finish_reason: 'stop' } }; } },
      ...(withVoice ? {
        voiceClient: { async synthesize(request) { spoken.push(request.text); return { audio: {}, request_id: 'guard-audio' }; } },
        audioArtifacts: { put() { return { artifact: { audio_id: 'guard-audio', format: { codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 },
          duration_ms: 200, byte_count: 6400, sha256: '0'.repeat(64), encoding: 'binary', profile: {} }, duplicate: false }; } },
      } : {}),
    });
    const request = { event_id: `guard-chat-${withVoice}`, character_id: OWN, device_id: 'vocat-001', message: QUESTION };
    const turn = await orchestrator.run(request);
    assert.equal(calls, 1); assert.notEqual(turn.reply, RAW);
    assert.equal(turn.reply_event.payload.text, turn.reply);
    assert.equal(inputStore.get(`reply-${request.event_id}`).payload.text, turn.reply);
    assert.equal(turn.trace.finish_reason, 'stop'); assert.equal(turn.trace.development_fact_guard.raw_reply, RAW);
    assert.equal(turn.trace.development_fact_guard.reason, 'affirmative_completed_practice_without_success');
    assert.ok(turn.planned_output_plan.filter(o => o.type === 'speak').every(o => o.text === turn.reply));
    if (withVoice) {
      assert.deepEqual(spoken, [turn.reply]); assert.equal(turn.voice_error, null);
      assert.ok(turn.output_route.commands.filter(c => c.type === 'audio.play').every(c => c.payload.audio_id === 'guard-audio'));
    } else assert.ok(turn.output_route.commands.filter(c => c.type === 'speak').every(c => c.payload.text === turn.reply));
    assert.doesNotMatch(JSON.stringify(turn.output_route), /我按你说的去浇水/);
    assert.equal(modelDevelopmentContext(world.get()).topics.find(entry => entry.topic === 'care').capability.successful_practice, 0);
    assert.equal(world.get().tasks.length, 0, 'corrected dialogue does not manufacture an executed task');
    const commands = outputRouter.size();
    const retry = await orchestrator.run(request);
    assert.equal(retry.duplicate, true); assert.equal(retry.reply, turn.reply); assert.equal(calls, 1); assert.equal(outputRouter.size(), commands);
  }
});
