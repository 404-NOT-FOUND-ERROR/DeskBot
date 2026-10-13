import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSqlitePersistence } from '../src/persistence.mjs';
import { createCanonicalReplayCapture } from '../src/replay-capture.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createDeskBotServer } from '../src/app.mjs';

const BASE = Date.parse('2026-10-14T00:00:00.000Z');
const CODE = 'm6b-worker-operation-contract-v1';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  // The startup hook contains a couple of intentionally fire-and-forget worker
  // calls (life-choice and slow cognition). Give their operation scopes a
  // chance to settle before taking the audit snapshot.
  await new Promise(resolve => setTimeout(resolve, 25));
}

test('worker startup tick has a stable operation id and restart does not repeat canonical writes', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'deskbot-worker-operation-'));
  const databasePath = join(dir, 'source.sqlite');
  const archive = join(dir, 'archive');
  let time = BASE;
  let persistence = createSqlitePersistence({ filename: databasePath });
  let capture;
  let server;
  const now = () => new Date(time);

  const open = async () => {
    capture = createCanonicalReplayCapture({ persistence, directory: archive, now, codeFingerprint: CODE });
    const world = createPersistentWorld({ persistence, now, timeMode: 'realtime', replayCapture: capture });
    server = createDeskBotServer({
      now,
      persistence,
      persistentWorld: world,
      replayCapture: capture,
      websocket: false,
      worldStreamEnabled: false,
      worldLifeEnabled: false,
      autonomousLifeEnabled: false,
      residentLifeEnabled: false,
      livedMemoryEnabled: false,
    });
    await listen(server);
    return world;
  };

  try {
    const firstWorld = await open();
    const firstMutations = persistence.list('canonical-world.mutations');
    const firstJournal = persistence.list('replay.capture-journal');
    const firstRoleRuns = persistence.list('role.evolution-runs');
    const expected = ['scheduler:role-evolution:startup'];
    const firstIds = persistence.list('replay.capture-journal')
      .map(item => item.operation_id)
      .filter(id => expected.includes(id));
    assert.deepEqual([...new Set(firstIds)].sort(), [...expected].sort());
    const firstWorldHash = JSON.stringify(firstWorld.get());

    await new Promise(resolve => server.close(resolve));
    capture.close();
    persistence.close();

    // Reopen the same source database and capture archive. The service startup
    // cadence runs again, but all domain state remains unchanged because no
    // worker has a new logical slot or a legal mutation to commit.
    persistence = createSqlitePersistence({ filename: databasePath });
    const secondWorld = await open();
    const secondMutations = persistence.list('canonical-world.mutations');
    const secondJournal = persistence.list('replay.capture-journal');
    assert.equal(JSON.stringify(secondWorld.get()), firstWorldHash);
    assert.deepEqual(secondMutations, firstMutations);
    assert.deepEqual(persistence.list('role.evolution-runs'), firstRoleRuns,
      'replaying the same logical worker slot must not create a second run');
    assert.equal(secondJournal.filter(item => item.operation_id === 'scheduler:role-evolution:startup').length, 1,
      'duplicate worker tick must not create a second journal write');
  } finally {
    try { server?.close(); } catch { /* already closed */ }
    capture?.close?.();
    try { persistence?.close(); } catch { /* already closed */ }
    rmSync(dir, { recursive: true, force: true });
  }
});
