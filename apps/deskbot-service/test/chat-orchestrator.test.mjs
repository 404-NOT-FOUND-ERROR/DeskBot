import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createChatOrchestrator } from '../src/chat-orchestrator.mjs';
import { createEvidenceLedger } from '../src/evidence-ledger.mjs';
import { createInputStore, InputError } from '../src/input-store.mjs';
import { createOutputRouter } from '../src/output-router.mjs';
import { createStateEngine } from '../src/state-engine.mjs';
import { createWorldContext } from '../src/world-context.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');

test('concurrent chat retries share one LLM call and one output route', async () => {
  let complete;
  let calls = 0;
  const completion = new Promise((resolve) => { complete = resolve; });
  const inputStore = createInputStore({ now: () => fixedTime });
  const outputRouter = createOutputRouter({ now: () => fixedTime });
  const orchestrator = createChatOrchestrator({
    inputStore,
    stateEngine: createStateEngine({ now: () => fixedTime }),
    worldContext: createWorldContext({ now: () => fixedTime }),
    evidenceLedger: createEvidenceLedger({ now: () => fixedTime }),
    outputRouter,
    llm: {
      async complete() {
        calls += 1;
        return completion;
      },
    },
    now: () => fixedTime,
  });
  const request = {
    event_id: 'turn-concurrent-001',
    character_id: 'ember-001',
    device_id: 'vocat-001',
    message: '今天有点累',
  };

  const first = orchestrator.run(request);
  const second = orchestrator.run(request);
  await Promise.resolve();
  assert.equal(calls, 1);

  complete({ provider: 'controlled-llm', model: 'controlled-llm', text: '先慢一点。', trace: {} });
  const [firstTurn, secondTurn] = await Promise.all([first, second]);

  assert.equal(firstTurn.duplicate, false);
  assert.equal(secondTurn.duplicate, true);
  assert.equal(firstTurn.output_route.commands.length, 5);
  assert.equal(outputRouter.size(), 5);
  assert.equal(inputStore.size(), 2);
});

test('conflicting chat body cannot reuse an existing event ID', async () => {
  const orchestrator = createChatOrchestrator({
    inputStore: createInputStore({ now: () => fixedTime }),
    stateEngine: createStateEngine({ now: () => fixedTime }),
    worldContext: createWorldContext({ now: () => fixedTime }),
    llm: {
      async complete() {
        return { provider: 'test', model: 'test', text: '好。', trace: {} };
      },
    },
    now: () => fixedTime,
  });

  await orchestrator.run({ event_id: 'turn-conflict-001', character_id: 'ember-001', message: '第一句' });
  await assert.rejects(
    () => orchestrator.run({ event_id: 'turn-conflict-001', character_id: 'ember-001', message: '第二句' }),
    (error) => error instanceof InputError && error.code === 'event_id_conflict',
  );
});

test('a bounded recent conversation and the character seed reach the next turn prompt', async () => {
  const prompts = [];
  const orchestrator = createChatOrchestrator({
    inputStore: createInputStore({ now: () => fixedTime }),
    stateEngine: createStateEngine({ now: () => fixedTime }),
    worldContext: createWorldContext({ now: () => fixedTime }),
    llm: {
      async complete({ prompt }) {
        prompts.push(prompt);
        return { provider: 'test', model: 'test', text: '我记住了。', trace: {} };
      },
    },
    now: () => fixedTime,
  });

  await orchestrator.run({
    event_id: 'turn-memory-001',
    character_id: 'shaping-001',
    message: '以后叫我小周',
  });
  await orchestrator.run({
    event_id: 'turn-memory-002',
    character_id: 'shaping-001',
    message: '你还记得我怎么称呼吗？',
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /seed_version=miaowu-expression-seed-v4/);
  assert.match(prompts[1], /model_name=喵呜/);
  assert.match(prompts[1], /continuity_identity=聚形域中持续存在的同一个个体/);
  assert.match(prompts[1], /first_scene=第一天没有宏大的降临/);
  assert.match(prompts[1], /personality=有明显的猫感/);
  assert.match(prompts[1], /response_modes=task：/);
  assert.match(prompts[1], /catchphrase_rules=/);
  assert.match(prompts[1], /trigger_rules=用户说“随便”或“无所谓”/);
  assert.match(prompts[1], /disagreement_style=/);
  assert.match(prompts[1], /roleplay_methods=稳定动机/);
  assert.match(prompts[1], /presence_matrix=high：呼唤、闲聊/);
  assert.match(prompts[1], /soul_positioning=一个存在于奇幻持续世界中的潮玩生命体/);
  assert.match(prompts[1], /likes=把混乱的事情变清楚/);
  assert.match(prompts[1], /aversions=被当作只会执行命令的按钮/);
  assert.match(prompts[1], /fantasy_drive=多源输入先形成被某种奇幻生活吸引/);
  assert.match(prompts[1], /lived_world_drive=聚形域不是数据库背景板/);
  assert.match(prompts[1], /连续三次这类场景至少两次出现“喵呜”或“喵”/);
  assert.match(prompts[1], /tts_direction=未来 TTS/);
  assert.match(prompts[1], /\[DESKBOT_CHARACTER_PROFILE\]/);
  assert.match(prompts[1], /"current_role":\{"stage_id":"miaowu-v1","display_name":"喵呜"/);
  assert.match(prompts[1], /"current_form":\{"form_id":"cat-toy-baseline-v1"/);
  assert.doesNotMatch(prompts[1], /"candidate_directions"/);
  assert.match(prompts[1], /\[DESKBOT_RECENT_CONVERSATION\]/);
  assert.match(prompts[1], /用户：以后叫我小周/);
  assert.match(prompts[1], /角色：我记住了。/);
  assert.match(prompts[1], /不得说“已经记下\/已设提醒\/已经执行”/);
  assert.match(prompts[1], /不得把未观测到的屏幕亮起、耳朵转动、动作或传感器状态描述成已经真实发生/);
  assert.match(prompts[1], /daily_consequence 是当前已生效的影响/);
});

test('recent assistant replies that expose role backend language are not imitated', async () => {
  const prompts = [];
  let turn = 0;
  const orchestrator = createChatOrchestrator({
    inputStore: createInputStore({ now: () => fixedTime }),
    stateEngine: createStateEngine({ now: () => fixedTime }),
    worldContext: createWorldContext({ now: () => fixedTime }),
    llm: {
      async complete({ prompt }) {
        prompts.push(prompt);
        turn += 1;
        return {
          provider: 'test',
          model: 'test',
          text: turn === 1 ? '一个方向是水边跳跃，另一个方向是记录者角色卡。' : '喵，这次只说眼前的。',
          trace: {},
        };
      },
    },
    now: () => fixedTime,
  });

  await orchestrator.run({ event_id: 'turn-leak-001', character_id: 'shaping-001', message: '你最近想做什么？' });
  await orchestrator.run({ event_id: 'turn-leak-002', character_id: 'shaping-001', message: '说具体一点。' });

  assert.equal(prompts.length, 2);
  assert.doesNotMatch(prompts[1], /一个方向是水边跳跃/);
  assert.match(prompts[1], /旧助手回复若带后台方向或审计口吻会被隔离/);
});

test('an explicit latest-weather request refreshes the provider before LLM completion', async () => {
  let refreshCalls = 0;
  let prompt;
  const persistentWorld = createPersistentWorld({ now: () => fixedTime });
  const orchestrator = createChatOrchestrator({
    inputStore: createInputStore({ now: () => fixedTime }),
    stateEngine: createStateEngine({ now: () => fixedTime }),
    worldContext: createWorldContext({ now: () => fixedTime }),
    persistentWorld,
    llm: {
      async complete({ prompt: completionPrompt }) {
        prompt = completionPrompt;
        return { provider: 'test', model: 'test', text: '刚更新好了。', trace: {} };
      },
    },
    refreshWeather: async ({ force }) => {
      assert.equal(force, true);
      refreshCalls += 1;
      const event = {
        event_id: 'weather-refresh-chat-001',
        type: 'world.mutation',
        source: 'test-weather',
        occurred_at: fixedTime.toISOString(),
        character_id: 'shaping-001',
        payload: {
          action: 'update_weather',
          snapshot: {
            location: '上海',
            condition: '小雨',
            temperature_c: 24,
            humidity: 0.8,
            wind_mps: 2,
            observed_at: fixedTime.toISOString(),
            provider: 'test-weather',
          },
        },
      };
      persistentWorld.ingest(event);
      return { cached: false, snapshot: event.payload.snapshot };
    },
    now: () => fixedTime,
  });

  const turn = await orchestrator.run({
    event_id: 'turn-weather-refresh-001',
    character_id: 'shaping-001',
    message: '请帮我请求最新天气。',
  });

  assert.equal(refreshCalls, 1);
  assert.equal(turn.weather_refresh.status, 'refreshed');
  assert.equal(turn.canonical_world.snapshot.weather.snapshot.condition, '小雨');
  assert.match(prompt, /"status":"refreshed"/);
  assert.match(prompt, /小雨/);
});

test('an active role trial changes the prompt temporarily and records a neutral turn', async () => {
  const prompts = [];
  const observations = [];
  const orchestrator = createChatOrchestrator({
    inputStore: createInputStore({ now: () => fixedTime }),
    stateEngine: createStateEngine({ now: () => fixedTime }),
    worldContext: createWorldContext({ now: () => fixedTime }),
    llm: {
      async complete({ prompt }) {
        prompts.push(prompt);
        return { provider: 'test', model: 'test', text: '喵。先试这一块。', trace: {} };
      },
    },
    activeRoleTrials: () => [{
      proposal_id: 'proposal-trial-001',
      direction_id: 'workshop_maker',
      label: '工坊学徒',
      life: '拆解、修理和亲手构造东西的生活',
      trial: { status: 'active', turns_observed: 1, max_turns: 5 },
      overlay: {
        direction_id: 'workshop_maker',
        label: '工坊学徒',
        presence: '动手、拆解、验证',
        speech: '先试这一块',
        preferences: '机械和结构',
        boundary: '不假装已经改好设备',
      },
    }],
    recordRoleTrialObservation: (input) => {
      observations.push(input);
      return [{ proposal_id: 'proposal-trial-001', direction_id: 'workshop_maker', status: 'active', turns_observed: 2 }];
    },
    now: () => fixedTime,
  });

  const turn = await orchestrator.run({ event_id: 'turn-role-trial-001', character_id: 'shaping-001', message: '帮我拆一下这个任务。' });
  assert.match(prompts[0], /\[DESKBOT_ACTIVE_ROLE_TRIAL\]/);
  assert.match(prompts[0], /把复杂东西拆成能亲手验证的小块/);
  assert.doesNotMatch(prompts[0], /proposal-trial-001/);
  assert.doesNotMatch(prompts[0], /"direction_id":"workshop_maker"/);
  assert.doesNotMatch(prompts[0], /"turns_observed":1/);
  assert.doesNotMatch(prompts[0], /"overlay"/);
  assert.equal(turn.active_role_trials[0].direction_id, 'workshop_maker');
  assert.equal(turn.trial_observations[0].turns_observed, 2);
  assert.equal(turn.expression_intent.role_trial.direction_id, 'workshop_maker');
  assert.equal(turn.expression_intent.consumers.screen.motif, 'gear_tick');
  assert.equal(turn.output_plan[0].expression_intent.consumers.tts.role_trial_direction, 'workshop_maker');
  assert.deepEqual(observations[0], {
    characterId: 'shaping-001',
    eventId: 'turn-role-trial-001',
    evidenceId: 'evidence-turn-role-trial-001',
    signal: 'neutral',
  });
});
