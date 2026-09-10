import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { createDeskBotServer } from '../src/app.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';

const fixedTime = new Date('2026-08-31T12:00:00.000Z');
const testDirectory = mkdtempSync(join(tmpdir(), 'deskbot-persistence-'));
const databasePath = join(testDirectory, 'deskbot.sqlite');

after(() => rmSync(testDirectory, { recursive: true, force: true }));

async function startRuntime(llm) {
  const persistence = createSqlitePersistence({ filename: databasePath, now: () => fixedTime });
  const server = createDeskBotServer({ now: () => fixedTime, persistence, llm });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      persistence.close();
    },
  };
}

async function post(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('SQLite restores the complete small-world loop without repeating an LLM turn', async () => {
  let llmCalls = 0;
  const llm = {
    async complete() {
      llmCalls += 1;
      return {
        provider: 'restart-test',
        model: 'restart-test',
        text: '先把这一刻记下来。',
        trace: { call: llmCalls },
      };
    },
  };
  const chat = {
    event_id: 'turn-persist-001',
    character_id: 'ember-001',
    device_id: 'vocat-persist-001',
    message: '今天有点累',
  };

  const first = await startRuntime(llm);
  await post(first.baseUrl, '/api/event', {
    event_id: 'world-persist-001',
    type: 'world.time',
    source: 'clock',
    character_id: 'ember-001',
    payload: { local_hour: 23 },
  });
  await post(first.baseUrl, '/api/devices/hello', {
    device_id: 'vocat-persist-001',
    hardware: 'esp-vocat-v1.2',
    firmware: 'bridge-test-0.1.0',
    capabilities: {
      'audio.capture': true,
      'audio.playback': true,
      'display.expression': true,
    },
    character_id: 'ember-001',
  });
  const chatResponse = await post(first.baseUrl, '/api/chat', chat);
  const chatBody = await chatResponse.json();
  assert.equal(chatResponse.status, 202);
  assert.equal(chatBody.state.state_revision, 1);
  assert.equal(llmCalls, 1);

  const speakCommand = chatBody.turn.output_route.commands.find((command) => (
    command.target === 'vocat' && command.type === 'speak'
  ));
  await post(first.baseUrl, `/api/outbox/${speakCommand.command_id}/ack`, {
    status: 'completed',
    source: 'vocat-persist-001',
    payload: { played: true },
  });
  await first.close();

  const second = await startRuntime(llm);
  const events = await (await fetch(`${second.baseUrl}/api/events`)).json();
  const evidence = await (await fetch(`${second.baseUrl}/api/evidence?character_id=ember-001`)).json();
  const matches = await (await fetch(`${second.baseUrl}/api/world/matches?character_id=ember-001`)).json();
  const devices = await (await fetch(`${second.baseUrl}/api/devices`)).json();
  const state = await (await fetch(`${second.baseUrl}/api/state/ember-001`)).json();
  const restoredCommand = await (await fetch(`${second.baseUrl}/api/outbox/${speakCommand.command_id}`)).json();

  assert.deepEqual(events.events.map((event) => event.event_id), [
    'world-persist-001',
    'turn-persist-001',
    'reply-turn-persist-001',
  ]);
  assert.equal(evidence.evidence.length, 3);
  assert.equal(matches.matches.length, 1);
  assert.equal(devices.devices[0].device_id, 'vocat-persist-001');
  assert.equal(state.state.state_revision, 1);
  assert.equal(restoredCommand.command.status, 'completed');
  assert.equal(restoredCommand.command.acknowledgment.payload.played, true);

  const duplicateResponse = await post(second.baseUrl, '/api/chat', chat);
  const duplicateBody = await duplicateResponse.json();
  assert.equal(duplicateResponse.status, 200);
  assert.equal(duplicateBody.duplicate, true);
  assert.equal(duplicateBody.turn.reply, '先把这一刻记下来。');
  assert.equal(llmCalls, 1);

  const nextResponse = await post(second.baseUrl, '/api/chat', {
    event_id: 'turn-persist-002',
    character_id: 'ember-001',
    device_id: 'vocat-persist-001',
    message: '现在好多了，我很开心',
  });
  const nextBody = await nextResponse.json();
  assert.equal(nextResponse.status, 202);
  assert.equal(nextBody.state.state_revision, 2);
  assert.equal(nextBody.turn.matched_conditions[0].label, 'late-night');
  assert.equal(llmCalls, 2);
  await second.close();
});
