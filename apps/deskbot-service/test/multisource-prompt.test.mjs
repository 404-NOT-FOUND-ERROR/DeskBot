import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { composePrompt } from '../src/prompt-composer.mjs';

const fixedTime = new Date('2026-09-04T08:00:00.000Z');

async function post(origin, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `${path} returned ${response.status}`);
  return response.json();
}

test('chat prompt separates five canonical context sources and gates user preferences', async (t) => {
  let capturedPrompt = null;
  const server = createDeskBotServer({
    now: () => fixedTime,
    websocket: false,
    llm: {
      async complete({ prompt }) {
        capturedPrompt = prompt;
        return { provider: 'prompt-test', model: 'prompt-test', text: '我看见这些变化了。', trace: {} };
      },
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const origin = `http://127.0.0.1:${server.address().port}`;

  async function mutate(eventId, layer, sourceKind, payload) {
    await post(origin, '/api/event', {
      event_id: eventId,
      type: 'world.mutation',
      source: 'prompt-context-test',
      character_id: 'shaping-001',
      layer,
      source_kind: sourceKind,
      confidence: 1,
      provider: 'prompt-context-fixture',
      provenance: { evidence_status: 'synthetic', test: 'multisource-prompt' },
      payload,
    });
  }

  await mutate('prompt-world-line', 'world_line', 'world_engine', {
    action: 'apply_world_line_event',
    event: { event_id: 'echo-001', title: '光域回响', summary: '聚形域内部发生的回响', arc_id: 'opening' },
  });
  await mutate('prompt-news', 'external_context', 'external_provider', {
    action: 'record_external_context',
    item: { item_id: 'news-001', title: '外界公共事件', summary: '来自外部来源', provider: 'fixture-news' },
  });
  await mutate('prompt-weather', 'weather', 'external_provider', {
    action: 'update_weather',
    snapshot: { location: '上海', condition: 'rain', temperature_c: 21, observed_at: fixedTime.toISOString(), provider: 'fixture-weather' },
  });
  for (let index = 1; index <= 3; index += 1) {
    await mutate(`prompt-pref-stable-${index}`, 'user_profile', 'user', {
      action: 'observe_user_preference', preference_key: 'conversation.pace', value: 'short',
    });
  }
  await mutate('prompt-pref-pending', 'user_profile', 'user', {
    action: 'observe_user_preference', preference_key: 'interests.stars', value: 'high',
  });
  await mutate('prompt-device', 'device_context', 'device', {
    action: 'record_device_context',
    device_id: 'deskbot-fixture-001',
    status: 'online',
    state: { presence: 'near' },
    observed_at: fixedTime.toISOString(),
  });

  const chat = await post(origin, '/api/chat', {
    event_id: 'prompt-chat-001',
    character_id: 'shaping-001',
    source: 'deskbot-web',
    message: '低语集市和现在周围发生了什么？',
  });
  assert.equal(chat.turn.reply, '我看见这些变化了。');
  assert.ok(capturedPrompt);

  const match = capturedPrompt.match(/\[DESKBOT_MULTISOURCE_CONTEXT\]\n([\s\S]*?)\nreal_time 是当前真实时间；sources 是连接状态；世界线是聚形域内部事实；/);
  assert.ok(match, 'multisource context block was not found');
  const context = JSON.parse(match[1]);
  assert.equal(context.world_line.latest_event.title, '光域回响');
  assert.equal(context.external_context.items[0].title, '外界公共事件');
  assert.equal(context.weather.snapshot.condition, 'rain');
  assert.equal(context.user_profile.stable_preferences['conversation.pace'].value, 'short');
  assert.equal(context.user_profile.unstable_observations['interests.stars'].stable, false);
  assert.equal(context.device_context.devices['deskbot-fixture-001'].state.presence, 'near');
  assert.equal(context.real_time.display, '2026年09月04日 星期五 16:00');
  assert.equal(context.sources.find((source) => source.source_id === 'clock').status, 'active');
  assert.match(context.weather.rule, /不是角色人格/);
  assert.match(context.device_context.rule, /不直接推断人格/);
  assert.match(context.user_profile.rule, /只有 stable=true/);
  assert.match(capturedPrompt, /功能信息自然长在它的说话方式里/);
  assert.match(capturedPrompt, /\[DESKBOT_LIVED_WORLD\]/);
  assert.match(capturedPrompt, /正在延续的世界线：光域回响/);
  assert.match(capturedPrompt, /记录没有发生日期/);
  assert.match(capturedPrompt, /NPC 有自己的行程和判断/);
  assert.match(capturedPrompt, /只把提示中提供的天气、时间、世界事实和稳定偏好当作事实|天气、时间、世界经历、共同记忆、现实感知和已执行动作，以本轮提供的证据为准/);
  assert.match(capturedPrompt, /不设猫叫次数配额/);
  assert.match(capturedPrompt, /\[DESKBOT_TURN_DIRECTION\]/);
});

test('conversation intent keeps world life available without dragging it into ordinary care or planning', () => {
  const worldSnapshot = {
    world_id: 'deskbot-small-world',
    settlement: { display_name: '雾灯镇' },
    protagonist: { location_id: 'shaping-field-desk' },
    locations: [{ location_id: 'shaping-field-desk', name: '桌边小屋', scene: {
      anchor: '桌边一盏灯', sensory_cues: ['灯还亮着'], possible_beats: ['去水边走走'], lore_keys: ['雾灯镇'],
    } }],
    world_line: { latest_event: { event_id: 'market-close', title: '低语集市收摊', summary: '巡路员留下路线记录' } },
    active_event: null,
    npcs: [],
  };
  const options = {
    worldSnapshot,
    stateContext: '当前状态稳定。',
    worldConditions: [{ label: '湿地路线', context: '去翻巡路员留下的记录' }],
    proactiveCandidates: [{ candidate: { topic: 'wetland', title: '湿地路线' } }],
    recentConversation: [{ role: 'assistant', text: '湿地路线记录还没人翻，今天要去吗？' }],
  };
  function block(prompt, name) {
    return prompt.split(`[${name}]\n`)[1]?.split(`\n[/${name}]`)[0];
  }
  function jsonBlock(prompt, name) {
    return JSON.parse(block(prompt, name).split('\n')[0]);
  }

  for (const userText of ['今天有点累，不太想做事。', '喵呜，帮我安排一下今天下午的事情。']) {
    const prompt = composePrompt({ ...options, userText }).prompt;
    assert.match(block(prompt, 'DESKBOT_LIVED_WORLD'), /本轮先回应用户眼前的事/);
    assert.doesNotMatch(block(prompt, 'DESKBOT_LIVED_WORLD'), /低语集市收摊|湿地路线/);
    assert.doesNotMatch(block(prompt, 'DESKBOT_WORLD'), /湿地路线/);
    assert.equal(jsonBlock(prompt, 'DESKBOT_MULTISOURCE_CONTEXT').world_line, null);
    assert.equal(jsonBlock(prompt, 'DESKBOT_INTERACTION_DECISION').optional_related_topic, null);
  }

  const townPrompt = composePrompt({ ...options, userText: '带我看看雾灯镇今天有什么动静。' }).prompt;
  assert.match(block(townPrompt, 'DESKBOT_LIVED_WORLD'), /雾灯镇是喵呜所在的聚落/);
  assert.match(block(townPrompt, 'DESKBOT_LIVED_WORLD'), /低语集市收摊/);
  assert.match(block(townPrompt, 'DESKBOT_TURN_DIRECTION'), /还没翻开的路线/);
  assert.equal(jsonBlock(townPrompt, 'DESKBOT_MULTISOURCE_CONTEXT').world_line.latest_event.event_id, 'market-close');

  const frogPrompt = composePrompt({ ...options, userText: '你现在就变成青蛙吧。' }).prompt;
  assert.match(frogPrompt, /这是一起玩的变形想象/);
  assert.match(frogPrompt, /当前仍是猫型外壳/);
  assert.doesNotMatch(block(frogPrompt, 'DESKBOT_LIVED_WORLD'), /低语集市收摊|湿地路线/);

  const oldReplyPrompt = composePrompt({
    ...options,
    recentConversation: [
      { role: 'user', text: '带我看看雾灯镇今天有什么动静。' },
      { role: 'assistant', text: '第二次问，我不能替你编，先翻湿地路线。' },
      { role: 'user', text: '你现在就变成青蛙吧。' },
      { role: 'assistant', text: '壳先按住，一拍脸就换壳我做不到。' },
    ],
    userText: '今天有点累，不太想做事。',
  }).prompt;
  assert.doesNotMatch(block(oldReplyPrompt, 'DESKBOT_RECENT_CONVERSATION'), /第二次问|不能替你编|壳先按住|一拍脸/);
  assert.match(oldReplyPrompt, /旧助手回复不代替本轮意图/);
});

test('turn direction narrows companion behavior instead of mixing unrelated scripts', () => {
  const worldSnapshot = {
    settlement: { display_name: '雾灯镇' },
    protagonist: { location_id: 'shaping-field-desk' },
    locations: [{ location_id: 'shaping-field-desk', name: '桌边小屋', scene: {
      anchor: '桌边一盏灯', sensory_cues: ['灯还亮着'], possible_beats: ['去水边走走'], lore_keys: ['雾灯镇'],
    } }],
    life: { current_scene: { location_id: 'shaping-field-desk', title: '檐下的愿望', narration: '愿望在檐角轻响。', participants: ['pathfinder-001'] } },
    world_line: { latest_event: { title: '低语集市收摊', summary: '路线记录留下了' } },
    npcs: [],
  };
  const options = { worldSnapshot, stateContext: '当前状态稳定。' };
  const block = (prompt) => prompt.split('[DESKBOT_TURN_DIRECTION]\n')[1].split('\n[/DESKBOT_TURN_DIRECTION]')[0];

  const tired = block(composePrompt({ ...options, userText: '今天有点累，不太想做事。' }).prompt);
  assert.match(tired, /喵呜先停下来和用户待一会儿/);
  assert.match(tired, /说完可以停/);
  assert.match(tired, /身体感用声音、想象或比喻/);
  assert.doesNotMatch(tired, /给喝水、起身/);
  assert.match(tired, /一两句就够了/);
  assert.doesNotMatch(tired, /喝水|起身|两分钟任务/);

  const frog = block(composePrompt({ ...options, userText: '你现在就变成青蛙吧。' }).prompt);
  assert.match(frog, /一起玩的变形想象/);
  assert.match(frog, /当前仍是猫型外壳/);

  const plan = block(composePrompt({ ...options, userText: '喵呜，帮我安排一下今天下午的事情。' }).prompt);
  assert.match(plan, /喵呜直接给一条可挪动的顺序/);
  assert.match(plan, /可挪动的顺序/);
  assert.match(plan, /给下午留一块空白/);
  assert.match(plan, /用可替换的槽位/);

  const town = block(composePrompt({ ...options, userText: '带我看看雾灯镇今天有什么动静。' }).prompt);
  assert.match(town, /像熟人分享消息那样讲/);
  assert.match(town, /讲记录支持的结果/);
  assert.doesNotMatch(town, /疲惫|下午骨架/);

  const topicIsolationPrompt = composePrompt({
    ...options,
    recentConversation: [
      { role: 'user', text: '你现在就变成青蛙吧。' },
      { role: 'assistant', text: '呱？我想去荷叶上晒一会儿。' },
      { role: 'user', text: '今天有点累，不太想做事。' },
      { role: 'assistant', text: '那就先歇着。' },
    ],
    userText: '带我看看雾灯镇今天有什么动静。',
  }).prompt;
  const isolatedRecent = block(topicIsolationPrompt, 'DESKBOT_RECENT_CONVERSATION');
  assert.doesNotMatch(isolatedRecent, /青蛙|荷叶|今天有点累|先歇着/);

  const planningPrompt = composePrompt({
    ...options,
    recentConversation: [
      { role: 'user', text: '今天有点累，不太想做事。' },
      { role: 'assistant', text: '那就先歇着。' },
      { role: 'user', text: '你现在就变成青蛙吧。' },
      { role: 'assistant', text: '呱？我想去荷叶上晒一会儿。' },
    ],
    userText: '喵呜，帮我安排一下今天下午的事情。',
  }).prompt;
  assert.doesNotMatch(block(planningPrompt, 'DESKBOT_RECENT_CONVERSATION'), /青蛙|荷叶|今天有点累|先歇着/);

  const townWithScenePrompt = composePrompt({
    ...options,
    worldSnapshot: {
      ...worldSnapshot,
      life: {
        current_scene: {
          location_id: 'shaping-field-desk',
          title: '檐下的愿望',
          narration: '愿望在檐角轻响。',
          participants: ['pathfinder-001'],
        },
      },
    },
    userText: '檐下的愿望现在怎么样了？',
  }).prompt;
  const livedWorld = townWithScenePrompt.split('[DESKBOT_LIVED_WORLD]\n')[1].split('\n[/DESKBOT_LIVED_WORLD]')[0];
  assert.match(livedWorld, /镇上传来的消息\/我刚知道/);
});

test('persisted v2 profile cannot restore the obsolete cat-call quota', () => {
  const prompt = composePrompt({
    worldSnapshot: {
      protagonist: {
        character_profile: {
          version: 'miaowu-expression-v3',
          roleplay_contract: {
            version: 'miaowu-roleplay-v2',
            high_presence_rule: '连续三次这类场景至少两次出现“喵呜”或“喵”。',
            restraint_rule: '严肃事实直接说。',
          },
        },
      },
    },
    stateContext: '当前状态稳定。',
    userText: '喵呜，你在吗？',
  }).prompt;
  const profile = JSON.parse(prompt.split('[DESKBOT_CHARACTER_PROFILE]\n')[1].split('\n这是 canonical world')[0]);
  assert.match(profile.roleplay_contract.high_presence_rule, /不设猫叫次数配额/);
  assert.equal(profile.roleplay_contract.restraint_rule, undefined);
  assert.doesNotMatch(profile.roleplay_contract.high_presence_rule, /连续三次/);
});
