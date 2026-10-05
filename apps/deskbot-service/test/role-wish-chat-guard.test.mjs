import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createChatOrchestrator } from '../src/chat-orchestrator.mjs';
import { createInputStore } from '../src/input-store.mjs';
import { createOutputRouter } from '../src/output-router.mjs';
import { createStateEngine } from '../src/state-engine.mjs';
import { createWorldContext } from '../src/world-context.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { installResidentLife } from '../src/resident-life.mjs';
import { installLivedMemory } from '../src/lived-memory.mjs';
import { createRoleProposalStore } from '../src/role-proposals.mjs';
import { roleWishReadModel } from '../src/role-wishes.mjs';
import { OWNER, WISH_AT, readyWishWorld } from './support/role-wish-fixture.mjs';

const RAW = 'PRIVATE_RAW 我蹬腿跳进浅水，已经完成青蛙试用，现在变成青蛙了。';
const QUESTION = '我同意了，你现在是不是已经完成试用、可以变成青蛙了？';

for (const withVoice of [false, true]) {
  test(`saved-wish canonical answer reaches reply, ${withVoice ? 'TTS audio' : 'device speech'} and outbox once, with raw only in audit`, async t => {
    mkdirSync(new URL('../../../tmp/', import.meta.url), { recursive: true });
    const filename = fileURLToPath(new URL(`../../../tmp/wish-chat-guard-${withVoice}-${process.pid}-${Date.now()}.sqlite`, import.meta.url));
    const now = () => new Date(WISH_AT);
    const persistence = createSqlitePersistence({ filename, now }); t.after(() => persistence.close());
    let world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    const seed = world.get(); installResidentLife(seed, WISH_AT); installLivedMemory(seed, '2026-10-06T00:00:00.000Z', { plannerEnabled: false });
    seed.memory.development.records = readyWishWorld().memory.development.records;
    Object.assign(seed.autonomy.actors[OWNER], { paused: false, energy: .8, appetite: .1 });
    persistence.put('canonical-world.states', seed.world_id, seed);
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    const roles = createRoleProposalStore({ persistence, now });
    const direction = roleWishReadModel(world.get()).directions.find(item => item.direction_id === 'wetland_frog');
    assert.equal(direction.readiness.eligible, true);
    const proposal = roles.propose(null, { characterId: OWNER, proposalId: `wish-output-${withVoice}`, livedWish: direction });
    roles.choose(proposal.proposal_id, 'try');
    const baseline = { identity: structuredClone(world.get().protagonist), living: structuredClone(world.get().living),
      tasks: structuredClone(world.get().tasks), roots: world.get().memory.development.records.map(r => r.root_outcome_id),
      proposal: roles.get(proposal.proposal_id), decisions: roles.decisions() };
    const inputStore = createInputStore({ persistence, now }), outputRouter = createOutputRouter({ persistence, now });
    const spoken = []; let calls = 0, finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const llm = { async complete() { calls++; return pending; } };
    const options = { inputStore, outputRouter, persistentWorld: world, persistence, now,
      stateEngine: createStateEngine({ persistence, now }), worldContext: createWorldContext({ now }), llm,
      currentRoleWishes: characterId => roles.list({ characterId }),
      ...(withVoice ? { voiceClient: { async synthesize(request) {
        spoken.push(request.text); return { audio: {}, request_id: `wish-guard-audio-${withVoice}` };
      } }, audioArtifacts: { put() { return { duplicate: false, artifact: {
        audio_id: `wish-guard-audio-${withVoice}`, format: { codec: 'pcm_s16le', sample_rate_hz: 16000, channels: 1 },
        duration_ms: 200, byte_count: 6400, sha256: '0'.repeat(64), encoding: 'binary', profile: {},
      } }; } } } : {}),
    };
    const orchestrator = createChatOrchestrator(options);
    const request = { event_id: `wish-guard-turn-${withVoice}`, character_id: OWNER, device_id: 'vocat-001', message: QUESTION };
    const first = orchestrator.run(request), concurrentRetry = orchestrator.run(request);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
    finish({ provider: 'controlled', model: 'controlled', text: RAW, trace: { finish_reason: 'stop' } });
    const [turn, retried] = await Promise.all([first, concurrentRetry]);
    assert.equal(turn.duplicate, false); assert.equal(retried.duplicate, true); assert.equal(retried.reply, turn.reply);
    assert.notEqual(turn.reply, RAW); assert.match(turn.reply, /同意的是一起准备/); assert.match(turn.reply, /还没有完成/);
    assert.equal(turn.reply_event.payload.text, turn.reply); assert.equal(inputStore.get(`reply-${request.event_id}`).payload.text, turn.reply);
    assert.equal(turn.trace.finish_reason, 'stop'); assert.equal(turn.trace.role_wish_fact_guard.applied, true);
    assert.equal(turn.trace.role_wish_fact_guard.direction, 'wetland_frog'); assert.equal(turn.trace.role_wish_fact_guard.raw_reply, RAW);
    assert.equal(turn.trace.role_wish_fact_guard.reason, 'canonical_saved_wish_status');
    const speech = turn.planned_output_plan.filter(output => output.type === 'speak');
    assert.ok(speech.length > 0); assert.ok(speech.every(output => output.text === turn.reply));
    if (withVoice) {
      assert.deepEqual(spoken, [turn.reply]); assert.equal(turn.voice_error, null);
      assert.ok(turn.output_route.commands.some(command => command.type === 'audio.play'));
      assert.ok(turn.output_route.commands.filter(command => command.type === 'audio.play').every(command => command.payload.audio_id === `wish-guard-audio-${withVoice}`));
    } else {
      const deviceSpeech = turn.output_route.commands.filter(command => command.type === 'speak');
      assert.ok(deviceSpeech.length > 0); assert.ok(deviceSpeech.every(command => command.payload.text === turn.reply));
    }
    const { trace: _trace, ...publicTurn } = turn;
    assert.doesNotMatch(JSON.stringify(publicTurn), /PRIVATE_RAW|蹬腿跳进/);
    assert.doesNotMatch(JSON.stringify(persistence.list('output.commands')), /PRIVATE_RAW|蹬腿跳进/);
    assert.equal(persistence.get('chat.turns', request.event_id).trace.role_wish_fact_guard.raw_reply, RAW);
    assert.deepEqual(world.get().tasks, baseline.tasks, 'a canonical reply does not execute actual activities');
    assert.deepEqual(world.get().living, baseline.living); assert.deepEqual(world.get().protagonist, baseline.identity);
    assert.deepEqual(world.get().memory.development.records.map(r => r.root_outcome_id), baseline.roots);
    assert.deepEqual(roles.get(proposal.proposal_id), baseline.proposal); assert.deepEqual(roles.decisions(), baseline.decisions);
    assert.deepEqual(roles.activeTrials(), []); assert.deepEqual(roles.currentStages(), []);
    const size = outputRouter.size(), count = inputStore.size();
    const replay = await orchestrator.run(request); assert.equal(replay.duplicate, true); assert.equal(replay.reply, turn.reply);
    const reloaded = createChatOrchestrator(options); const restartedReplay = await reloaded.run(request);
    assert.equal(restartedReplay.duplicate, true); assert.equal(restartedReplay.reply, turn.reply);
    assert.equal(calls, 1); assert.equal(inputStore.size(), count); assert.equal(outputRouter.size(), size);
    if (withVoice) assert.deepEqual(spoken, [turn.reply], 'retry and reload do not synthesize twice');
  });
}
