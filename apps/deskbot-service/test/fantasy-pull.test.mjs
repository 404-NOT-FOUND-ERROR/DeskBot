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
