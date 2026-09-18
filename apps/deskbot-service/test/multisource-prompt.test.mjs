import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

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
  assert.match(capturedPrompt, /功能信息本身必须使用喵呜会说的词、节奏、偏见和关系态度来表达/);
  assert.match(capturedPrompt, /场景反应 \+ 功能结果 \+ 喵呜的偏见\/欲望\/选择 \+ 可选的世界生活余韵/);
  assert.match(capturedPrompt, /\[DESKBOT_LIVED_WORLD\]/);
  assert.match(capturedPrompt, /当前 Scene 锚点：这是喵呜把外壳擦亮、把新捡来的小东西排成一排的家/);
  assert.match(capturedPrompt, /按当前位置检索出的 Lorebook 切片与当前 Scene/);
  assert.match(capturedPrompt, /possible_beats 尚未发生/);
  assert.match(capturedPrompt, /本轮关键词触发的地点 Lore：低语集市/);
  assert.match(capturedPrompt, /此地现在没有已记录为在场的 NPC/);
  assert.match(capturedPrompt, /Scene opportunity 同样尚未发生/);
  assert.match(capturedPrompt, /NPC 有自己的行程和判断/);
  assert.match(capturedPrompt, /不是每一句话都必须使用的修辞/);
  assert.match(capturedPrompt, /角色感来自称呼、节奏、选择、协商和分寸/);
  assert.match(capturedPrompt, /按当前情境选择 task、fact、companion、playful、curious、reflective 或 boundary/);
  assert.match(capturedPrompt, /高存在感场景（呼唤、闲聊、夸奖、打趣、小胜利、低风险代选、共同玩耍）应当大胆演出来/);
  assert.match(capturedPrompt, /连续三次这类场景至少两次出现“喵呜”或“喵”/);
  assert.match(capturedPrompt, /严肃事实、错误、风险和安全说明必须收起卖萌/);
  assert.match(capturedPrompt, /用户说“随便\/无所谓”时，低风险小事可以替用户选一个方案/);
  assert.match(capturedPrompt, /禁止把光粒、光域、漂移或凝聚成形作为回应主题/);
});
