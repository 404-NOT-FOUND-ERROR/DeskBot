import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createNpcGoals } from '../src/npc-goals.mjs';
import { createWorldLife, NPC_ROUTINE_SLOT_MS, SLOT_MS } from '../src/world-life.mjs';

function mutation(eventId, payload, occurredAt = '2026-09-17T02:00:00.000Z') {
  return {
    event_id: eventId,
    type: 'world.mutation',
    source: 'world-life-test',
    source_kind: 'world_engine',
    layer: 'world_line',
    character_id: 'shaping-001',
    occurred_at: occurredAt,
    payload,
  };
}

function fixture(initial = '2026-09-17T02:00:00.000Z', persistence = null) {
  let clock = new Date(initial);
  const now = () => new Date(clock);
  const world = createPersistentWorld({ now, persistence });
  const life = createWorldLife({ now, worldSnapshot: () => world.get(), ingest: (event) => world.ingest(event) });
  return {
    world,
    life,
    advance(milliseconds) { clock = new Date(clock.getTime() + milliseconds); },
  };
}

test('world life seeds bounded NPCs and one replayable scene per wall-clock slot', () => {
  const { world, life, advance } = fixture();
  const first = life.tick();
  assert.equal(first.encounters.length, 0);
  assert.equal(world.get().npcs.length, 3);
  assert.equal(world.get().life.current_scene.location_id, 'shaping-field-desk');
  assert.deepEqual(world.listMutations().map((item) => item.action), ['upsert_npc', 'upsert_npc', 'upsert_npc', 'set_life_scene']);

  life.tick();
  assert.equal(world.listMutations().length, 4);

  const firstSceneId = world.get().life.current_scene.scene_id;
  advance(SLOT_MS);
  life.tick();
  assert.equal(world.get().life.current_scene.scene_id, firstSceneId);
  assert.equal(world.get().life.current_scene.continuation_count, 1);
  assert.equal(world.get().life.recent_scenes.length, 0);

  world.ingest(mutation('advance-to-day', { action: 'advance_time', minutes: 5 * 60 }));
  advance(SLOT_MS);
  life.tick();
  assert.notEqual(world.get().life.current_scene.scene_id, firstSceneId);
  assert.equal(world.get().life.recent_scenes.at(-1).scene_id, firstSceneId);
  assert.equal(world.get().life.current_scene.continuity.kind, 'local_progression');
});

test('an older story NPC is upgraded without losing its location or status', () => {
  const { world, life } = fixture();
  world.ingest(mutation('legacy-pathfinder', {
    action: 'upsert_npc',
    npc: { npc_id: 'pathfinder-001', display_name: '旧称巡路员', role: 'route_keeper', location_id: 'whisper-market', status: '正在交换旧地图' },
  }));
  life.tick();
  const npc = world.get().npcs.find((item) => item.npc_id === 'pathfinder-001');
  assert.equal(npc.location_id, 'whisper-market');
  assert.equal(npc.status, '正在交换旧地图');
  assert.match(npc.bio, /缺角地图/);
});

test('NPC seeding safely respects the three-NPC world bound', () => {
  const { world, life } = fixture();
  for (let index = 1; index <= 3; index += 1) {
    world.ingest(mutation(`existing-${index}`, {
      action: 'upsert_npc',
      npc: { npc_id: `existing-${index}`, display_name: `已有角色 ${index}`, location_id: 'shaping-field-desk' },
    }));
  }
  assert.doesNotThrow(() => life.tick());
  assert.equal(world.get().npcs.length, 3);
  assert.equal(world.get().life.current_scene.participants.length, 3);
});

test('world-line outcomes select authored causal Scenes and do not replay a consumed branch', () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('tide-recorded', {
    action: 'apply_world_line_event',
    event: { event_id: 'tide-path-three-days-v1:afterglow', title: '路标留下回声', arc_id: 'tide-path-three-days-v1', status: 'resolved', outcome: 'route_recorded' },
  }));
  const selected = life.tick({ force: true }).current_scene;
  assert.equal(selected.branch_key, 'tide-path-route-recorded');
  assert.deepEqual(selected.cause_event_ids, ['tide-path-three-days-v1:afterglow']);
  const count = world.listMutations().length;
  life.tick({ force: true });
  assert.equal(world.listMutations().length, count);
});

test('a shared NPC experience can become a causal Scene branch', () => {
  const { world, life } = fixture();
  life.tick();
  const pathfinderLocation = world.get().npcs.find((npc) => npc.npc_id === 'pathfinder-001').location_id;
  if (pathfinderLocation !== world.get().protagonist.location_id) {
    world.ingest(mutation('join-pathfinder', { action: 'move_protagonist', location_id: pathfinderLocation }));
  }
  const interaction = life.interact({ interaction_id: 'shared-route', npc_id: 'pathfinder-001', intent: 'help' });
  assert.equal(interaction.accepted, true);
  const selected = life.tick({ force: true }).current_scene;
  assert.equal(selected.branch_key, 'tide-path-shared-route');
  assert.deepEqual(selected.cause_experience_ids, ['npc-interaction:pathfinder-001:shared-route']);
  assert.equal(selected.resolution_state, 'experienced');
});

test('same-place interactions are bounded, idempotent and increase relationship state once', () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('travel-to-road', { action: 'move_protagonist', location_id: 'tidal-old-road' }));
  life.tick({ force: true });

  const body = { interaction_id: 'retryable-001', npc_id: 'pathfinder-001', intent: 'suggest', idea: '把水洼当作只存在十分钟的地图' };
  const first = life.interact(body);
  const repeated = life.interact(body);
  assert.equal(first.accepted, true);
  assert.equal(repeated.accepted, true);
  assert.equal(repeated.duplicate, true);
  const npc = world.get().npcs.find((item) => item.npc_id === 'pathfinder-001');
  assert.deepEqual(npc.relationship, { familiarity: 3, trust: 1, encounters: 1 });
  assert.match(npc.last_response, /先走十步/);
  assert.equal(first.experience.role_direction.direction_id, 'tide_route_explorer');
  assert.equal(first.role_evidence.status, 'observing');
  assert.equal(world.get().life.recent_experiences.length, 1);
  assert.match(world.get().life.recent_experiences[0].summary, /水洼当作只存在十分钟的地图/);

  assert.throws(
    () => life.interact({ npc_id: 'pathfinder-001', intent: 'suggest' }),
    (error) => error.code === 'npc_idea_required',
  );
  assert.throws(
    () => life.interact({ npc_id: 'pathfinder-001', intent: 'command' }),
    (error) => error.code === 'invalid_npc_intent',
  );
  assert.throws(
    () => life.interact({ npc_id: 'shade-collector-001', intent: 'greet' }),
    (error) => error.code === 'npc_not_present',
  );
});

test('story chat is a first-class NPC interaction and does not create role-direction evidence', () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('travel-to-road-for-chat', { action: 'move_protagonist', location_id: 'tidal-old-road' }));
  life.tick({ force: true });
  const result = life.interact({
    interaction_id: 'story-chat-001',
    npc_id: 'pathfinder-001',
    intent: 'chat',
    idea: '你今天为什么一直盯着那块水洼？',
  });
  assert.equal(result.accepted, true);
  assert.match(result.response, /水洼|路/);
  assert.equal(result.role_evidence, null);
  assert.equal(world.get().life.recent_experiences.at(-1).kind, 'npc_interaction');
  assert.match(world.get().life.recent_experiences.at(-1).summary, /聊天/);
});

test('NPC agent receives Persona and Scene context, then persists only its reply', async () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('agent-move-to-desk', { action: 'npc_action', npc_id: 'pathfinder-001', location_id: 'shaping-field-desk', action_name: 'return_to_desk', status: '在桌边整理地图' }));
  const prompts = [];
  const agent = createWorldLife({
    now: () => new Date('2026-09-17T02:00:00.000Z'),
    worldSnapshot: () => world.get(),
    ingest: (event) => world.ingest(event),
    llm: {
      async complete(input) {
        prompts.push(input.prompt);
        return { text: '巡路员把缺角地图压在杯子旁：“你想看那条岔路，我也想试，但我不赞成一口气走到底。先跟我走十步；路标若还认得脚印，我们继续，不认就回来。你选现在走，还是等水退一点？”' };
      },
    },
  });
  const result = await agent.interactWithAgent({
    interaction_id: 'agent-001',
    npc_id: 'pathfinder-001',
    intent: 'suggest',
    idea: '去看看那条会变色的小岔路',
  });
  assert.equal(result.accepted, true);
  assert.match(result.response, /走十步/);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /desires=.*安全岔路/);
  assert.match(prompts[0], /scene_title=/);
  assert.match(prompts[0], /改天气/);
  assert.match(prompts[0], /换外壳/);
  assert.equal(world.get().npcs.find((npc) => npc.npc_id === 'pathfinder-001').last_response, result.response);
  assert.equal(world.get().life.recent_experiences.length, 1);
});

test('NPC agent retry is idempotent and does not call the model twice', async () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('agent-retry-move-to-desk', { action: 'npc_action', npc_id: 'pathfinder-001', location_id: 'shaping-field-desk', action_name: 'return_to_desk', status: '在桌边整理地图' }));
  let calls = 0;
  const agent = createWorldLife({
    now: () => new Date('2026-09-17T02:00:00.000Z'),
    worldSnapshot: () => world.get(),
    ingest: (event) => world.ingest(event),
    llm: { async complete() { calls += 1; return { text: '巡路员用脚尖压住会转向的小路标：“你来得正好。我不喜欢边走边猜，先看脚下这条湿线。你可以跟我试十步，也可以替我守住地图；选一个，别让杯子把岔口占了。”' }; } },
  });
  const body = { interaction_id: 'agent-retry-001', npc_id: 'pathfinder-001', intent: 'greet' };
  const first = await agent.interactWithAgent(body);
  const mutationCount = world.listMutations().length;
  const repeated = await agent.interactWithAgent(body);
  assert.equal(calls, 1);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.response, first.response);
  assert.equal(world.listMutations().length, mutationCount);
});

test('NPC agent failure falls back to authored response and still records the interaction', async () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('agent-fallback-move-to-desk', { action: 'npc_action', npc_id: 'pathfinder-001', location_id: 'shaping-field-desk', action_name: 'return_to_desk', status: '在桌边整理地图' }));
  const agent = createWorldLife({
    now: () => new Date('2026-09-17T02:00:00.000Z'),
    worldSnapshot: () => world.get(),
    ingest: (event) => world.ingest(event),
    llm: { async complete() { throw new Error('provider unavailable'); } },
  });
  const result = await agent.interactWithAgent({ interaction_id: 'agent-fallback-001', npc_id: 'pathfinder-001', intent: 'greet' });
  assert.equal(result.accepted, true);
  assert.match(result.response, /潮痕巡路员/);
  assert.equal(result.experience.npc_id, 'pathfinder-001');
});

test('NPC grounding rewrite falls back to authored response when both drafts remain abstract', async () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('agent-grounding-fallback-move-to-desk', {
    action: 'npc_action',
    npc_id: 'pathfinder-001',
    location_id: 'shaping-field-desk',
    action_name: 'return_to_desk',
    status: '在桌边整理地图',
  }));
  const prompts = [];
  const agent = createWorldLife({
    now: () => new Date('2026-09-17T02:00:00.000Z'),
    worldSnapshot: () => world.get(),
    ingest: (event) => world.ingest(event),
    llm: {
      async complete(input) {
        prompts.push(input.prompt);
        return { text: '在聚形域里，光粒漂移，光域凝聚成形，世界规则因此改变。' };
      },
    },
  });
  const result = await agent.interactWithAgent({
    interaction_id: 'agent-grounding-fallback-001',
    npc_id: 'pathfinder-001',
    intent: 'greet',
  });
  assert.equal(prompts.length, 2);
  assert.match(result.response, /缺角地图|湿路标|路今天往哪边拐/);
  assert.doesNotMatch(result.response, /光粒漂移|世界规则/);
  assert.equal(world.get().npcs.find((npc) => npc.npc_id === 'pathfinder-001').last_response, result.response);
});

test('same-slot outward and return travel create distinct replayable scenes', () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('journey-out', { action: 'move_protagonist', location_id: 'tidal-old-road' }));
  life.tick({ force: true });
  const roadScene = world.get().life.current_scene.scene_id;
  world.ingest(mutation('journey-back', { action: 'move_protagonist', location_id: 'shaping-field-desk' }));
  life.tick({ force: true });
  const deskScene = world.get().life.current_scene.scene_id;
  assert.notEqual(deskScene, roadScene);
  assert.doesNotThrow(() => life.tick({ force: true }));
  assert.equal(world.get().life.recent_scenes.at(-1).scene_id, roadScene);
});

test('Scene names an NPC only while that NPC is actually present', () => {
  const { world, life } = fixture();
  life.tick();
  world.ingest(mutation('visit-road-for-cast', { action: 'move_protagonist', location_id: 'tidal-old-road' }));
  life.tick({ force: true });
  assert.match(world.get().life.current_scene.title, /潮痕巡路员/);
  assert.deepEqual(world.get().life.current_scene.participants, ['pathfinder-001']);

  world.ingest(mutation('pathfinder-leaves', {
    action: 'npc_action',
    npc_id: 'pathfinder-001',
    action_name: 'return_to_desk',
    location_id: 'shaping-field-desk',
    status: '回桌边整理地图',
  }));
  life.tick();
  assert.doesNotMatch(world.get().life.current_scene.title, /潮痕巡路员/);
  assert.deepEqual(world.get().life.current_scene.participants, []);
  assert.equal(world.get().life.current_scene.continuity.kind, 'encounter_changed');
});

test('seeded NPCs and the current scene survive a persistence restart without conflicts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-world-life-'));
  const filename = join(directory, 'world-life.sqlite');
  try {
    const firstPersistence = createSqlitePersistence({ filename });
    const first = fixture('2026-09-17T02:00:00.000Z', firstPersistence);
    first.life.tick();
    const sceneId = first.world.get().life.current_scene.scene_id;
    firstPersistence.close();

    const secondPersistence = createSqlitePersistence({ filename });
    const second = fixture('2026-09-17T02:00:00.000Z', secondPersistence);
    assert.doesNotThrow(() => second.life.tick());
    assert.equal(second.world.get().life.current_scene.scene_id, sceneId);
    assert.equal(second.world.get().npcs.length, 3);
    assert.equal(second.world.listMutations().length, 4);
    secondPersistence.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('bounded NPC routines use the goal engine, move one adjacent hop and refresh local encounters', () => {
  let clock = new Date('2026-09-17T02:00:00.000Z');
  const now = () => new Date(clock);
  const world = createPersistentWorld({ now });
  const goals = createNpcGoals({ now, worldSnapshot: () => world.get(), ingest: (event) => world.ingest(event) });
  const life = createWorldLife({ now, worldSnapshot: () => world.get(), ingest: (event) => world.ingest(event), npcGoals: goals });

  life.tick();
  const pathfinder = world.get().npcs.find((npc) => npc.npc_id === 'pathfinder-001');
  assert.equal(pathfinder.location_id, 'shaping-field-desk');
  assert.equal(life.snapshot().encounters[0].npc_id, 'pathfinder-001');
  assert.equal(goals.list().find((goal) => goal.npc_id === 'pathfinder-001').origin, 'world-life-engine');
  assert.equal(goals.list().find((goal) => goal.npc_id === 'pathfinder-001').state, 'completed');

  clock = new Date(clock.getTime() + NPC_ROUTINE_SLOT_MS);
  life.tick();
  assert.equal(world.get().npcs.find((npc) => npc.npc_id === 'pathfinder-001').location_id, 'tidal-old-road');
  assert.equal(life.snapshot().encounters.some((npc) => npc.npc_id === 'pathfinder-001'), false);
  assert.ok(world.get().life.current_scene.participants.every((npcId) => npcId !== 'pathfinder-001'));
});

test('world-life HTTP endpoints expose encounters and reject remote NPC interaction', async (t) => {
  const now = () => new Date('2026-09-17T02:00:00.000Z');
  const prompts = [];
  const server = createDeskBotServer({
    now,
    websocket: false,
    worldLifeEnabled: true,
    llm: { async complete(input) { prompts.push(input.prompt); return { text: '巡路员把缺角地图压在杯子旁：“你想找新岔路，我也好奇，但我不赞成追着变色跑。先看看这条路，再跟路标走十步；它若还认得脚印，我们继续。你选现在走，还是等水退一点？”' }; } },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const initial = await (await fetch(`${origin}/api/life/world`)).json();
  assert.equal(initial.current_scene.location_id, 'shaping-field-desk');
  assert.equal(initial.encounters[0].npc_id, 'pathfinder-001');

  const remote = await fetch(`${origin}/api/life/npc-interactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ npc_id: 'shade-collector-001', intent: 'greet' }),
  });
  assert.equal(remote.status, 409);
  assert.equal((await remote.json()).error, 'npc_not_present');

  const interaction = await fetch(`${origin}/api/life/npc-interactions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ interaction_id: 'http-idea', npc_id: 'pathfinder-001', intent: 'suggest', idea: '沿着会变色的路标去找新岔路' }),
  });
  assert.equal(interaction.status, 200);
  const interactionBody = await interaction.json();
  assert.equal(interactionBody.accepted, true);
  assert.equal(interactionBody.npc.relationship.encounters, 1);
  assert.equal(interactionBody.experience.npc_id, 'pathfinder-001');
  assert.equal(interactionBody.role_evidence.direction.direction_id, 'tide_route_explorer');
  assert.match(interactionBody.response, /先看看这条路/);
  assert.equal(prompts.length, 1);

  const pulls = await (await fetch(`${origin}/api/roles/pulls?character_id=shaping-001`)).json();
  const routePull = pulls.pulls.find((pull) => pull.direction_id === 'tide_route_explorer');
  assert.equal(routePull.status, 'observing');
  assert.deepEqual(routePull.evidence_ids, ['evidence-npc-interaction:pathfinder-001:http-idea']);
});
