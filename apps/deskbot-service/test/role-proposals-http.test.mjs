import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';

const fixedTime = new Date('2026-09-15T00:00:00.000Z');
const server = createDeskBotServer({ now: () => fixedTime });
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function post(path, body = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function addMutation(eventId, layer, payload) {
  const result = await post('/api/event', {
    event_id: eventId,
    type: 'world.mutation',
    source: 'role-http-test',
    character_id: 'shaping-001',
    layer,
    source_kind: layer === 'user_profile' ? 'user' : layer === 'weather' ? 'external_provider' : 'world_engine',
    confidence: 1,
    provider: 'role-http-test',
    payload,
  });
  assert.equal(result.response.status, 202);
}

test('role API exposes pulls and completes an auditable trial lifecycle', async () => {
  await addMutation('role-weather-001', 'weather', { action: 'update_weather', snapshot: { location: '上海', condition: '连续下雨', observed_at: fixedTime.toISOString() } });
  await addMutation('role-preference-001', 'user_profile', { action: 'observe_user_preference', preference_key: 'walk.place', value: '池塘散步' });
  await addMutation('role-worldline-001', 'world_line', { action: 'apply_world_line_event', event: { event_id: 'role-worldline-event', title: '荷叶亮起来了', summary: '湿地边出现一只青蛙，正在寻找新的落脚处。' } });

  const pulls = await fetch(`${baseUrl}/api/roles/pulls?character_id=shaping-001`).then((response) => response.json());
  const pull = pulls.pulls.find((item) => item.direction_id === 'wetland_frog');
  assert.equal(pull.status, 'candidate');
  assert.deepEqual(pull.sources.sort(), ['user_profile', 'weather', 'world_line'].sort());

  const created = await post('/api/roles/proposals', { character_id: 'shaping-001', direction_id: 'wetland_frog' });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.proposal.status, 'proposed');
  const proposalId = created.body.proposal.proposal_id;

  const chosen = await post(`/api/roles/proposals/${proposalId}/choose`, { choice: 'try', reason: '想先体验湿地生活' });
  assert.equal(chosen.body.proposal.status, 'trying');
  const started = await post(`/api/roles/proposals/${proposalId}/trial/start`, { window_turns: 2 });
  assert.equal(started.body.proposal.trial.status, 'active');
  const observed = await post(`/api/roles/proposals/${proposalId}/trial/observations`, { event_id: 'role-feedback-001', signal: 'positive', evidence_id: 'evidence-role-feedback-001' });
  assert.equal(observed.body.proposal.trial.positive_feedback, 1);
  const duplicate = await post(`/api/roles/proposals/${proposalId}/trial/observations`, { event_id: 'role-feedback-001', signal: 'negative', evidence_id: 'wrong-duplicate' });
  assert.equal(duplicate.body.proposal.trial.turns_observed, 1);
  const completed = await post(`/api/roles/proposals/${proposalId}/trial/observations`, { event_id: 'role-feedback-002', signal: 'neutral', evidence_id: 'evidence-role-feedback-002' });
  assert.equal(completed.body.proposal.trial.status, 'completed');
  const accepted = await post(`/api/roles/proposals/${proposalId}/trial/complete`, { decision: 'accepted', reason: '试行后确认方向' });
  assert.equal(accepted.body.proposal.status, 'accepted');
  assert.equal(accepted.body.proposal.stage_history.at(-1).to, 'accepted');

  const detail = await fetch(`${baseUrl}/api/roles/proposals/${proposalId}`).then((response) => response.json());
  assert.equal(detail.proposal.trial.evidence_ids.length, 2);
  assert.equal(detail.decisions.length, 1);
});

test('role API rejects non-candidates and cannot start a trial before try', async () => {
  const created = await post('/api/roles/proposals', { character_id: 'shaping-001', direction_id: 'starry_observer' });
  assert.equal(created.response.status, 409);
  const missing = await post('/api/roles/proposals/missing/trial/start');
  assert.equal(missing.response.status, 404);
});

test('role API validates identity fields and exposes the active trial used by chat', async () => {
  const characterId = 'shaping-001';
  await post('/api/event', {
    event_id: 'role-chat-weather-001', type: 'world.mutation', source: 'role-http-test', character_id: characterId,
    layer: 'weather', source_kind: 'external_provider', confidence: 1, provider: 'role-http-test',
    payload: { action: 'update_weather', snapshot: { location: '上海', condition: '连续下雨', observed_at: fixedTime.toISOString() } },
  });
  await post('/api/event', {
    event_id: 'role-chat-preference-001', type: 'world.mutation', source: 'role-http-test', character_id: characterId,
    layer: 'user_profile', source_kind: 'user', confidence: 1, provider: 'role-http-test',
    payload: { action: 'observe_user_preference', preference_key: 'walk.place', value: '池塘散步' },
  });
  await post('/api/event', {
    event_id: 'role-chat-worldline-001', type: 'world.mutation', source: 'role-http-test', character_id: characterId,
    layer: 'world_line', source_kind: 'world_engine', confidence: 1, provider: 'role-http-test',
    payload: { action: 'apply_world_line_event', event: { event_id: 'role-chat-worldline-event', title: '湿地来信', summary: '荷叶在雨里亮了起来。' } },
  });
  const invalid = await post('/api/roles/proposals', { character_id: characterId, direction_id: ' ' });
  assert.equal(invalid.response.status, 400);
  const created = await post('/api/roles/proposals', { character_id: characterId, direction_id: 'wetland_frog' });
  const proposalId = created.body.proposal.proposal_id;
  await post(`/api/roles/proposals/${proposalId}/choose`, { choice: 'try' });
  await post(`/api/roles/proposals/${proposalId}/trial/start`, { window_turns: 3 });
  const trials = await fetch(`${baseUrl}/api/roles/trials?character_id=${characterId}`).then((response) => response.json());
  assert.equal(trials.trials[0].direction_id, 'wetland_frog');
  const chat = await post('/api/chat', { event_id: 'role-chat-turn-001', character_id: characterId, message: '把这个任务拆成两步。' });
  assert.equal(chat.response.status, 202);
  assert.match(chat.body.turn.prompt.text, /\[DESKBOT_ACTIVE_ROLE_TRIAL\]/);
  assert.equal(chat.body.turn.active_role_trials[0].direction_id, 'wetland_frog');
  assert.equal(chat.body.turn.trial_observations[0].turns_observed, 1);
  assert.equal(chat.body.turn.expression_intent.role_trial.direction_id, 'wetland_frog');
  assert.equal(chat.body.turn.expression_intent.consumers.screen.motif, 'ripple');
  const after = await fetch(`${baseUrl}/api/roles/trials?character_id=${characterId}`).then((response) => response.json());
  assert.equal(after.trials[0].trial.turns_observed, 1);
});
