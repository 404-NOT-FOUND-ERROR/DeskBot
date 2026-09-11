import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { createSqlitePersistence } from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';

const fixedTime = new Date('2026-09-01T00:00:00.000Z');
const testDirectory = mkdtempSync(join(tmpdir(), 'deskbot-world-restart-'));
const databasePath = join(testDirectory, 'deskbot.sqlite');

after(() => rmSync(testDirectory, { recursive: true, force: true }));

function voiceChat(eventId) {
  return {
    event_id: eventId,
    type: 'conversation.input',
    source: 'deskbot-chat',
    occurred_at: fixedTime.toISOString(),
    character_id: 'ember-001',
    correlation_id: 'restart-voice-turn-001',
    payload: { role: 'user', text: '记住这一刻' },
  };
}

test('world snapshot, ledger, event idempotency, and correlation index survive restart', () => {
  const firstPersistence = createSqlitePersistence({ filename: databasePath, now: () => fixedTime });
  const first = createPersistentWorld({ now: () => fixedTime, persistence: firstPersistence });
  first.ingest(voiceChat('restart-chat-001'));
  first.ingest({
    event_id: 'restart-time-001',
    type: 'world.mutation',
    source: 'world-controller',
    occurred_at: fixedTime.toISOString(),
    character_id: 'ember-001',
    correlation_id: null,
    payload: { action: 'advance_time', minutes: 45 },
  });
  firstPersistence.close();

  const secondPersistence = createSqlitePersistence({ filename: databasePath, now: () => fixedTime });
  const second = createPersistentWorld({ now: () => fixedTime, persistence: secondPersistence });
  assert.equal(second.get().world_revision, 2);
  assert.equal(second.get().logical_time.minute_of_day, 525);
  assert.equal(second.get().interaction.user_turn_count, 1);
  assert.deepEqual(second.listMutations().map((record) => record.sequence), [1, 2]);

  const repeatedEvent = second.ingest(voiceChat('restart-chat-001'));
  const repeatedCorrelation = second.ingest(voiceChat('restart-chat-002'));
  assert.equal(repeatedEvent.reason, 'event_already_applied');
  assert.equal(repeatedCorrelation.reason, 'correlation_already_counted');
  assert.equal(second.get().world_revision, 2);
  assert.equal(second.listMutations().length, 2);
  secondPersistence.close();
});

