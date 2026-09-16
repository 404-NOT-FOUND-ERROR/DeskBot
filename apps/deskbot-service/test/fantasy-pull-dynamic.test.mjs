import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFantasyPull } from '../src/fantasy-pull.mjs';

const hint = { direction_id: 'lantern_moth', label: '灯笼蛾旅者', life: '在夜灯、花粉和城市缝隙间迁徙的生活', cues: ['灯笼蛾', '花粉', '夜灯'] };

test('structured hints can create an open direction only after repeated independent evidence', () => {
  const events = [
    { event_id: 'world-1', type: 'world.mutation', layer: 'world_line', source: 'world', payload: { role_direction: hint }, occurred_at: '2026-09-16T00:00:00Z' },
    { event_id: 'weather-1', type: 'weather.observation', layer: 'weather', source: 'qweather', payload: { direction_hint: hint, text: '夜灯附近有花粉' }, occurred_at: '2026-09-16T01:00:00Z' },
    { event_id: 'user-1', type: 'conversation.input', layer: 'dialogue', source: 'user', payload: { text: '我想看看灯笼蛾怎么生活', role_direction: hint }, occurred_at: '2026-09-16T02:00:00Z' },
  ];
  const result = computeFantasyPull(events, { now: new Date('2026-09-16T03:00:00Z'), maxCandidates: 10 });
  const candidate = result.find(item => item.direction_id === 'lantern_moth');
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.sources.length, 3);
  assert.equal(candidate.schema, 'deskbot.fantasy-pull.v0.3');
});

test('a single structured hint remains observing and cannot directly alter role', () => {
  const result = computeFantasyPull([{ event_id: 'one', type: 'conversation.input', layer: 'dialogue', payload: { role_direction: hint }, occurred_at: '2026-09-16T00:00:00Z' }], { now: new Date('2026-09-16T01:00:00Z'), maxCandidates: 10 });
  assert.equal(result.find(item => item.direction_id === 'lantern_moth')?.status, 'observing');
});
