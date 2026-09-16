import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeFantasyPull } from '../src/fantasy-pull.mjs';

const event = (id, layer, text) => ({ event_id: id, type: 'world.mutation', layer, source: layer, confidence: 1, payload: { summary: text } });

test('fantasy pull requires repeated evidence across distinct sources', () => {
  const observing = computeFantasyPull([
    event('r1', 'weather', '连续下雨'),
    event('r2', 'weather', '雨天适合去池塘'),
  ]);
  assert.equal(observing[0].status, 'observing');
  const candidate = computeFantasyPull([
    event('r1', 'weather', '连续下雨'),
    event('r2', 'user_profile', '我喜欢去池塘散步'),
    event('r3', 'world_line', '荷叶旁出现一只青蛙'),
  ]);
  assert.equal(candidate[0].direction_id, 'wetland_frog');
  assert.equal(candidate[0].status, 'candidate');
  assert.deepEqual(candidate[0].evidence_ids, ['evidence-r1', 'evidence-r2', 'evidence-r3']);
  assert.equal(candidate[0].sources.length, 3);
});

test('a user command alone cannot create a fantasy candidate', () => {
  const pulls = computeFantasyPull([
    { event_id: 'force-1', type: 'conversation.input', layer: 'dialogue', source: 'dialogue', payload: { text: '你现在变成青蛙' } },
  ]);
  assert.equal(pulls[0].status, 'observing');
});

test('pull merges duplicate events, decays old evidence, and caps retained directions', () => {
  const fresh = computeFantasyPull([
    event('same', 'weather', '雨天池塘'),
    event('same', 'weather', '雨天池塘'),
    event('u', 'user_profile', '我喜欢池塘散步'),
    event('w', 'world_line', '荷叶青蛙出现'),
  ]);
  assert.equal(fresh[0].evidence_ids.length, 3);
  const old = computeFantasyPull([
    { ...event('o1', 'weather', '雨天池塘'), occurred_at: '2020-01-01T00:00:00.000Z' },
    { ...event('o2', 'user_profile', '我喜欢池塘散步'), occurred_at: '2020-01-01T00:00:00.000Z' },
    { ...event('o3', 'world_line', '荷叶青蛙出现'), occurred_at: '2020-01-01T00:00:00.000Z' },
  ], { now: new Date('2026-09-14T00:00:00.000Z') });
  assert.equal(old.length, 0);
});

test('pull reads structured weather and preference fields used by real mutation events', () => {
  const pulls = computeFantasyPull([
    { event_id: 'structured-weather', layer: 'weather', source: 'qweather', payload: { snapshot: { condition: '连续下雨', location: '上海' } } },
    { event_id: 'structured-preference', layer: 'user_profile', source: 'user', payload: { preference_key: 'walk.place', value: '池塘散步' } },
    { event_id: 'structured-world', layer: 'world_line', source: 'world-engine', payload: { event: { title: '荷叶边的青蛙', summary: '湿地出现新的落脚处' } } },
  ]);
  assert.equal(pulls.find((item) => item.direction_id === 'wetland_frog')?.status, 'candidate');
});

test('candidate cap keeps the highest scoring directions after sorting', () => {
  const pulls = computeFantasyPull([
    event('low-1', 'weather', '星星'),
    event('low-2', 'user_profile', '星空'),
    event('low-3', 'world_line', '星星'),
    event('high-1', 'weather', '雨天池塘青蛙'),
    event('high-2', 'user_profile', '我喜欢池塘散步青蛙'),
    event('high-3', 'world_line', '荷叶青蛙出现'),
  ], { maxCandidates: 1 });
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].direction_id, 'wetland_frog');
});

test('assistant replies and output transport cannot create or reinforce fantasy pulls', () => {
  const pulls = computeFantasyPull([
    { event_id: 'reply-1', type: 'conversation.reply', layer: 'dialogue', source: 'deskbot-service', payload: { role: 'assistant', text: '雨、池塘、荷叶和青蛙让我想变成湿地生物' } },
    { event_id: 'reply-2', type: 'conversation.reply', layer: 'weather', source: 'deskbot-service', payload: { text: '雨天去池塘散步' } },
    { event_id: 'voice-1', type: 'voice.tts.output', layer: 'world_line', source: 'voice-sidecar', payload: { text: '云朵、梦、漂浮和童话' } },
    { event_id: 'device-life-1', type: 'device.lifecycle.connected', layer: 'device_context', source: 'deskbot-service', payload: { summary: '工坊机械设备连接' } },
  ]);
  assert.deepEqual(pulls, []);
});

test('assistant wording cannot promote otherwise insufficient real evidence', () => {
  const pulls = computeFantasyPull([
    event('real-weather', 'weather', '今天下雨'),
    { event_id: 'self-reply-1', type: 'conversation.reply', layer: 'dialogue', source: 'deskbot-service', payload: { role: 'assistant', text: '我想去池塘蹲在荷叶上当青蛙' } },
    { event_id: 'self-reply-2', type: 'conversation.reply', layer: 'world_line', source: 'deskbot-service', payload: { role: 'assistant', text: '湿地散步很适合我' } },
  ]);
  assert.equal(pulls[0].direction_id, 'wetland_frog');
  assert.equal(pulls[0].status, 'observing');
  assert.deepEqual(pulls[0].evidence_ids, ['evidence-real-weather']);
});
