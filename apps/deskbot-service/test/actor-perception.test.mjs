import test from 'node:test';
import assert from 'node:assert/strict';
import { actorPerception, actorCognitionContext, influenceActorCognitionChoices, perceptionNarrativeLabel } from '../src/actor-perception.mjs';
import { composePrompt } from '../src/prompt-composer.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { advanceWorldMessages } from '../src/world-message-transport.mjs';

const base = {
  protagonist: { character_id: 'shaping-001', location_id: 'moss-sprout-garden' },
  npcs: [{ npc_id: 'nearby', location_id: 'moss-sprout-garden' }, { npc_id: 'far', location_id: 'warm-pot-courtyard' }],
  life: { current_scene: { scene_id: 'scene-garden', location_id: 'moss-sprout-garden', title: '苗床边的风', participants: ['nearby'] } },
  active_event: { event_id: 'private-far', location_id: 'warm-pot-courtyard', title: '远处的争执' },
  world_line: { latest_event: { event_id: 'public-news', title: '镇上公告', public: true } },
  social: { notices: [
    { id: 'delivered', text: '巡路员来信', audience: ['shaping-001'] },
    { id: 'far-private', text: '不该听到的私语', participants: ['far'] },
  ] },
};

test('perception separates witnessed, same-place observed, delivered/public and unknown', () => {
  const view = actorPerception(base);
  assert.equal(view.scene.perception.visibility, 'observed', 'same place without participation is not a first-person scene');
  assert.equal(view.active_event, null, 'distant private event is unknown');
  assert.equal(view.latest_event.perception.visibility, 'public');
  assert.equal(view.notices.find(item => item.id === 'delivered').perception.visibility, 'delivered');
  assert.equal(view.notices.some(item => item.id === 'far-private'), false);
  assert.equal(view.nearby_npcs[0].perception.visibility, 'observed');
  assert.equal(perceptionNarrativeLabel(view.latest_event), '公开消息');
});

test('participant receives a witnessed scene and projection is pure', () => {
  const input = structuredClone(base);
  input.life.current_scene.participants = ['shaping-001'];
  const before = JSON.stringify(input);
  const view = actorPerception(input);
  assert.equal(view.scene.perception.visibility, 'witnessed');
  assert.equal(view.scene.title, '苗床边的风');
  assert.equal(JSON.stringify(input), before);
});

test('travel does not create presence at destination', () => {
  const input = structuredClone(base);
  input.protagonist.location_id = 'moss-sprout-garden';
  input.active_event.location_id = 'warm-pot-courtyard';
  input.tasks = [{ actor_id: 'shaping-001', kind: 'travel', destination_location_id: 'warm-pot-courtyard', status: 'running' }];
  assert.equal(actorPerception(input).active_event, null);
  assert.equal(actorPerception(input).scene, null);
  assert.deepEqual(actorPerception(input).nearby_npcs, []);
});

test('unseen event and private notice content never enter any chat context block', () => {
  const world = createPersistentWorld({ now: () => new Date('2026-10-12T02:00:00Z') }).get();
  world.protagonist.location_id = 'moss-sprout-garden';
  world.active_event = { event_id: 'remote-secret', title: 'secret-active-phrase', location_id: 'warm-pot-courtyard', visibility: 'private' };
  world.world_line.latest_event = { event_id: 'secret-line', title: 'secret-line-phrase', audience: ['other-resident'], visibility: 'private' };
  world.world_line.recent_events = [world.world_line.latest_event];
  world.social = { commitments: [], notices: [{ id: 'private-note', text: 'secret-notice-phrase', audience: ['other-resident'] }] };
  const before = JSON.stringify(world);
  const composed = composePrompt({ worldSnapshot: world, userText: '镇上现在有什么动静？' });
  assert.doesNotMatch(composed.prompt, /secret-active-phrase|secret-line-phrase|secret-notice-phrase/);
  assert.equal(JSON.stringify(world), before);
});

test('canonical ingress preserves explicit audience while legacy world-line broadcasts remain public', () => {
  const world = createPersistentWorld({ now: () => new Date('2026-10-12T02:00:00Z') });
  const ingest = (id, event) => world.ingest({ event_id: id, type: 'world.mutation', source: 'test-world-engine',
    character_id: 'shaping-001', payload: { action: 'apply_world_line_event', event } });
  ingest('private-ingress', { event_id: 'private-canonical', title: 'private-runtime-phrase', visibility: 'private', audience: ['someone-else'] });
  assert.equal(world.get().world_line.latest_event.visibility, 'private');
  assert.equal(actorPerception(world.get()).latest_event, null);
  ingest('public-ingress', { event_id: 'public-canonical', title: '公开镇讯' });
  assert.equal(actorPerception(world.get()).latest_event.perception.visibility, 'public');
});

test('actor cognition is source-bounded and only reorders legal choices', () => {
  const world = structuredClone(base);
  world.memory = { episodes: [
    { id: 'fact-near', kind: 'world_fact', actor_ids: ['shaping-001'], at: '2026-10-12T01:00:00.000Z',
      topic: 'care', outcome: 'completed', model_safe: true, model_text: '镇内照料活动：完成。', source: { kind: 'canonical_task' } },
    { id: 'private-far', kind: 'world_fact', actor_ids: ['far'], at: '2026-10-12T01:00:00.000Z',
      topic: 'cook', outcome: 'completed', model_safe: true, model_text: 'secret-cook', source: { kind: 'canonical_task' } },
    { id: 'assistant', kind: 'personal_interpretation', actor_ids: ['shaping-001'], at: '2026-10-12T01:00:00.000Z',
      topic: 'cook', outcome: 'reflected', model_safe: true, model_text: 'secret-model', source: { kind: 'reflection' } },
  ] };
  const context = actorCognitionContext(world, 'shaping-001', '2026-10-12T02:00:00.000Z');
  assert.deepEqual(context.witnessed_facts.map(item => item.id), ['fact-near']);
  assert.doesNotMatch(JSON.stringify(context), /secret-cook|secret-model/);
  const choices = influenceActorCognitionChoices(world, 'shaping-001', [
    { goal: 'care', development_topic: 'care', score: 20, available: true },
    { goal: 'teleport', development_topic: 'teleport', score: 100, available: false },
  ]);
  assert.equal(choices.find(item => item.goal === 'care').perception_bonus, 3);
  assert.equal(choices.find(item => item.goal === 'teleport').perception_bonus, 0);
  assert.equal(JSON.stringify(world.memory.episodes).includes('secret-model'), true);
});

test('remote public scenes and events remain news while local public scenes are observed', () => {
  const world = structuredClone(base);
  Object.assign(world.life.current_scene, { location_id: 'warm-pot-courtyard', visibility: 'public', topic: 'cook' });
  Object.assign(world.active_event, { visibility: 'public', topic: 'cook' });
  world.world_line.recent_events = [world.world_line.latest_event];
  const before = JSON.stringify(world);
  const context = actorCognitionContext(world);
  assert.deepEqual(context.same_place, []);
  assert.deepEqual(new Set(context.public.map(item => item.id)), new Set(['scene-garden', 'private-far', 'public-news']));
  const choices = [{ goal: 'cook', development_topic: 'cook', score: 20, available: true }];
  assert.equal(influenceActorCognitionChoices(world, 'shaping-001', choices)[0].perception_bonus, 1);
  assert.equal(JSON.stringify(world), before);
  world.protagonist.location_id = 'warm-pot-courtyard';
  assert.equal(actorPerception(world).scene.perception.visibility, 'observed');
  assert.equal(influenceActorCognitionChoices(world, 'shaping-001', choices)[0].perception_bonus, 3);
});

test('future and invalid-time information cannot enter perception, cognition or chat', () => {
  const world = createPersistentWorld({ now: () => new Date('2026-10-12T02:00:00Z') }).get();
  world.protagonist.location_id = 'moss-sprout-garden';
  const future = '2026-10-12T03:00:00.000Z';
  world.life.current_scene = { scene_id: 'future-scene', title: 'future-scene-text', started_at: future, visibility: 'public' };
  world.active_event = { event_id: 'future-active', title: 'future-active-text', occurred_at: future, visibility: 'public' };
  world.world_line.latest_event = { event_id: 'future-news', title: 'future-news-text', occurred_at: future, visibility: 'public' };
  world.world_line.recent_events = [world.world_line.latest_event];
  world.social = { commitments: [], notices: [
    { id: 'future-note', text: 'future-note-text', at: future, audience: ['shaping-001'] },
    { id: 'invalid-note', text: 'invalid-note-text', at: 'invalid', audience: ['shaping-001'] },
  ] };
  const at = '2026-10-12T02:00:00.000Z';
  world.updated_at = at;
  const view = actorPerception(world, 'shaping-001', at);
  assert.equal(view.scene, null); assert.equal(view.active_event, null); assert.equal(view.latest_event, null);
  assert.deepEqual(view.notices, []); assert.deepEqual(view.world_events, []);
  assert.deepEqual(actorCognitionContext(world, 'shaping-001', at).delivered, []);
  const composed = composePrompt({ worldSnapshot: world, userText: '今天镇上怎么样？' });
  assert.doesNotMatch(composed.prompt, /future-(?:scene|active|news|note)-text|invalid-note-text/);
});

test('canonical public notice reaches remote actors only through delivered transport', () => {
  const world = structuredClone(base), at = '2026-10-12T02:00:00.000Z', later = '2026-10-12T02:02:00.000Z';
  world.social.commitments = [{ id: 'completed', actors: ['far'], status: 'completed', location_id: 'warm-pot-courtyard' }];
  world.social.notices = [{ id: 'canonical-news', text: '锅边那碗汤已经喝完了。', at, audience: 'public',
    author_id: 'far', verified_by: 'canonical_world_record', source_commitment_id: 'completed' }];
  advanceWorldMessages(world, at);
  const remote = actorPerception(world, 'shaping-001', at);
  assert.deepEqual(remote.notices, []); assert.deepEqual(remote.messages, []);
  assert.equal(actorPerception(world, 'far', at).notices[0].perception.visibility, 'witnessed');
  world.npcs.push({ npc_id: 'local-witness', location_id: 'warm-pot-courtyard' });
  assert.equal(actorPerception(world, 'local-witness', at).notices[0].perception.visibility, 'observed');
  advanceWorldMessages(world, later);
  const received = actorPerception(world, 'shaping-001', later);
  assert.deepEqual(received.notices, [], 'transport content is never duplicated through global notices');
  assert.equal(received.messages[0].content, world.social.notices[0].text);
  assert.equal(received.messages[0].perception.visibility, 'delivered');
  assert.deepEqual(actorPerception(world, 'shaping-001', at).messages, [], 'historical read cannot see later delivery');
});
