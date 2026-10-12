import test from 'node:test';
import assert from 'node:assert/strict';
import { actorPerception, actorCognitionContext, influenceActorCognitionChoices, perceptionNarrativeLabel } from '../src/actor-perception.mjs';
import { composePrompt } from '../src/prompt-composer.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';

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
