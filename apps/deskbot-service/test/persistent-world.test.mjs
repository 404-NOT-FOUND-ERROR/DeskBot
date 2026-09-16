import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPersistentWorld,
  PersistentWorldError,
} from '../src/persistent-world.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');

function event(overrides = {}) {
  return {
    event_id: 'world-event-001',
    type: 'world.mutation',
    source: 'world-controller',
    occurred_at: fixedTime.toISOString(),
    character_id: 'ember-001',
    correlation_id: null,
    payload: { action: 'advance_time', minutes: 60 },
    ...overrides,
  };
}

test('default world is small, deterministic, and supports a bounded NPC schema', () => {
  const persistentWorld = createPersistentWorld({ now: () => fixedTime });
  const initial = persistentWorld.get();

  assert.equal(initial.world_id, 'deskbot-small-world');
  assert.equal(initial.world_revision, 0);
  assert.equal(initial.protagonist.character_id, 'shaping-001');
  assert.equal(initial.protagonist.display_name, '喵呜');
  assert.equal(initial.protagonist.display_name_status, 'active_role_stage');
  assert.equal(initial.protagonist.character_profile.schema, 'deskbot.character-profile.v0.1');
  assert.equal(initial.protagonist.character_profile.version, 'miaowu-expression-v3');
  assert.equal(initial.protagonist.character_profile.continuity_identity.identity_id, 'shaping-001');
  assert.equal(initial.protagonist.character_profile.current_role.stage_id, 'miaowu-v1');
  assert.equal(initial.protagonist.character_profile.current_role.display_name, '喵呜');
  assert.equal(initial.protagonist.character_profile.current_form.form_id, 'cat-toy-baseline-v1');
  assert.ok(initial.protagonist.character_profile.response_modes.includes('playful'));
  assert.match(initial.protagonist.character_profile.speech_style.performance_pattern, /场景反应 \+ 功能结果/);
  assert.equal(initial.protagonist.character_profile.roleplay_contract.version, 'miaowu-roleplay-v2');
  assert.equal(initial.protagonist.character_profile.tts_profile.profile_id, 'miaowu-v1');
  assert.equal(initial.protagonist.appearance.state, 'baseline');
  assert.equal(initial.protagonist.appearance.version, 'appearance-baseline-v0.2');
  assert.equal(initial.protagonist.appearance.silhouette, '白色圆润多瓣底座 + 圆形黑屏幕脸 + 两只短三角耳');
  assert.equal(initial.protagonist.appearance.recognition_anchor, '白色多瓣底座 + 黑色圆屏 + 两只短三角耳 + 黄色胸口圆点');
  assert.equal(initial.locations.length, 1);
  assert.deepEqual(initial.npcs, []);
  assert.equal(initial.active_event, null);
  assert.deepEqual(initial.pending_items, []);

  const time = persistentWorld.ingest(event());
  assert.equal(time.applied, true);
  assert.equal(time.mutation.source_layer, 'L3');
  assert.equal(time.mutation.trigger_event_id, 'world-event-001');
  assert.ok(time.mutation.changes.some((change) => change.field_path === '/logical_time/minute_of_day'));
  assert.equal(time.mutation.changes[0].source_layer, 'L3');
  assert.deepEqual(time.world.logical_time, {
    schema: 'foundry.logical-time.v0.1',
    day: 1,
    minute_of_day: 540,
    tick: 1,
  });

  persistentWorld.ingest(event({
    event_id: 'world-event-activate',
    payload: {
      action: 'activate_event',
      event: { event_id: 'evt-tea', title: 'Tea arrives', summary: 'A cup is placed on the desk.', daily_consequence: 'The desk smells of tea today.', opportunity: 'Taste the cooling tea.', unresolved_hook: 'Nobody saw who brought it.' },
    },
  }));
  persistentWorld.ingest(event({
    event_id: 'world-event-queue',
    payload: {
      action: 'enqueue_pending_item',
      item: { item_id: 'pending-note', kind: 'reminder', summary: 'Review the sketch.' },
    },
  }));
  persistentWorld.ingest(event({
    event_id: 'world-event-npc',
    payload: {
      action: 'upsert_npc',
      npc: { npc_id: 'npc-lin', display_name: 'Lin', role: 'visitor' },
    },
  }));

  const state = persistentWorld.get();
  assert.equal(state.world_revision, 4);
  assert.equal(state.active_event.event_id, 'evt-tea');
  assert.equal(state.active_event.daily_consequence, 'The desk smells of tea today.');
  assert.equal(state.active_event.opportunity, 'Taste the cooling tea.');
  assert.equal(state.active_event.unresolved_hook, 'Nobody saw who brought it.');
  assert.equal(state.pending_items[0].item_id, 'pending-note');
  assert.equal(state.npcs[0].npc_id, 'npc-lin');
  assert.deepEqual(
    persistentWorld.listMutations().map((mutation) => mutation.sequence),
    [1, 2, 3, 4],
  );

  assert.throws(
    () => persistentWorld.ingest(event({
      event_id: 'world-event-second-active',
      payload: { action: 'activate_event', event: { event_id: 'evt-two', title: 'Second event' } },
    })),
    (error) => error instanceof PersistentWorldError && error.code === 'active_event_conflict',
  );
});

test('world-line events preserve concrete lived-world slices', () => {
  const persistentWorld = createPersistentWorld({ now: () => fixedTime });
  persistentWorld.ingest(event({
    event_id: 'world-line-lived-slice',
    layer: 'world_line',
    payload: {
      action: 'apply_world_line_event',
      event: {
        event_id: 'crossing-shadow-001',
        title: '交叠潮经过桌边',
        summary: '两条远处世界线短暂重叠。',
        daily_consequence: '桌边的影子今天偶尔朝错误方向移动。',
        opportunity: '喵呜可以记下三次影子错位的时刻。',
        unresolved_hook: '第三次错位时，影子里多出了一对耳朵。',
      },
    },
  }));
  const latest = persistentWorld.get().world_line.latest_event;
  assert.equal(latest.daily_consequence, '桌边的影子今天偶尔朝错误方向移动。');
  assert.equal(latest.opportunity, '喵呜可以记下三次影子错位的时刻。');
  assert.equal(latest.unresolved_hook, '第三次错位时，影子里多出了一对耳朵。');
});

test('world mutation event IDs are idempotent and conflicting reuse is rejected', () => {
  const persistentWorld = createPersistentWorld({ now: () => fixedTime });
  const original = event();
  const first = persistentWorld.ingest(original);
  const duplicate = persistentWorld.ingest(original);

  assert.equal(first.applied, true);
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reason, 'event_already_applied');
  assert.equal(persistentWorld.get().world_revision, 1);
  assert.equal(persistentWorld.listMutations().length, 1);

  assert.throws(
    () => persistentWorld.ingest(event({ payload: { action: 'advance_time', minutes: 90 } })),
    (error) => error instanceof PersistentWorldError && error.code === 'world_event_conflict',
  );
});

test('one voice correlation counts one user turn while transport and assistant events stay read-only', () => {
  const persistentWorld = createPersistentWorld({ now: () => fixedTime });
  const common = {
    source: 'voice-sidecar',
    occurred_at: fixedTime.toISOString(),
    character_id: 'ember-001',
    correlation_id: 'voice-turn-001',
  };

  const partial = persistentWorld.ingest(event({
    ...common,
    event_id: 'voice-partial-001',
    type: 'voice.asr.partial',
    payload: { text: '你好' },
  }));
  const final = persistentWorld.ingest(event({
    ...common,
    event_id: 'voice-final-001',
    type: 'voice.asr.final',
    payload: { text: '你好，今天怎么样' },
  }));
  const chat = persistentWorld.ingest(event({
    ...common,
    event_id: 'voice-chat-001',
    type: 'conversation.input',
    payload: { role: 'user', text: '你好，今天怎么样' },
  }));
  const repeatedChat = persistentWorld.ingest(event({
    ...common,
    event_id: 'voice-chat-002',
    type: 'conversation.input',
    payload: { role: 'user', text: '你好，今天怎么样' },
  }));
  const assistant = persistentWorld.ingest(event({
    ...common,
    event_id: 'voice-reply-001',
    type: 'conversation.reply',
    payload: { role: 'assistant', text: '我很好。' },
  }));

  assert.equal(partial.applied, false);
  assert.equal(final.applied, false);
  assert.equal(chat.applied, true);
  assert.equal(repeatedChat.reason, 'correlation_already_counted');
  assert.equal(assistant.reason, 'assistant_output_is_read_only');
  assert.equal(persistentWorld.get().interaction.user_turn_count, 1);
  assert.equal(persistentWorld.get().world_revision, 1);
  assert.deepEqual(persistentWorld.listMutations().map((mutation) => mutation.action), ['record_user_turn']);
});

test('active event resolves FIFO items and enforces the three-NPC bound', () => {
  const persistentWorld = createPersistentWorld({ now: () => fixedTime });
  const mutate = (eventId, payload) => persistentWorld.ingest(event({ event_id: eventId, payload }));

  mutate('bound-event-activate', {
    action: 'activate_event',
    event: { event_id: 'evt-bound', title: 'Bounded event' },
  });
  mutate('bound-item-1', {
    action: 'enqueue_pending_item',
    item: { item_id: 'item-1', summary: 'First' },
  });
  mutate('bound-item-2', {
    action: 'enqueue_pending_item',
    item: { item_id: 'item-2', summary: 'Second' },
  });
  const wrongHead = () => mutate('bound-item-wrong-head', {
    action: 'dequeue_pending_item',
    item_id: 'item-2',
  });
  assert.throws(wrongHead, (error) => error.code === 'pending_item_order_conflict');
  mutate('bound-item-pop', { action: 'dequeue_pending_item' });
  assert.deepEqual(persistentWorld.get().pending_items.map((item) => item.item_id), ['item-2']);
  mutate('bound-event-resolve', {
    action: 'resolve_active_event',
    event_id: 'evt-bound',
    outcome: 'complete',
  });
  assert.equal(persistentWorld.get().active_event, null);

  for (let index = 1; index <= 3; index += 1) {
    mutate(`bound-npc-${index}`, {
      action: 'upsert_npc',
      npc: { npc_id: `npc-${index}`, display_name: `NPC ${index}` },
    });
  }
  assert.throws(
    () => mutate('bound-npc-4', {
      action: 'upsert_npc',
      npc: { npc_id: 'npc-4', display_name: 'NPC 4' },
    }),
    (error) => error.code === 'npc_limit_reached',
  );
  assert.equal(persistentWorld.get().npcs.length, 3);
});
