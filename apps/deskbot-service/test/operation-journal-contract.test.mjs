import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as persistenceModule from '../src/persistence.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import {
  createCanonicalReplayCapture,
  exportCanonicalReplayCapture,
  replayCanonicalCapture,
} from '../src/replay-capture.mjs';

const FIXED_NOW = new Date('2026-10-13T04:00:00.000Z');
const OPERATION_RULES = 'operation-journal-contract-rules';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-operation-journal-contract-'));
  const persistence = persistenceModule.createSqlitePersistence({
    filename: join(directory, 'source.sqlite'),
    now: () => FIXED_NOW,
  });
  const world = createPersistentWorld({
    persistence,
    now: () => FIXED_NOW,
    timeMode: 'realtime',
    syncClockOnCreate: false,
  });
  t.after(() => {
    persistence.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, persistence, world };
}

/** M6b operation-journal contract seam. Keep these assertions at the public
 * capture boundary so the service can evolve its internal journal plumbing
 * without creating a second write path. */
function installJournal({ directory, persistence, world }, options = {}) {
  const capture = createCanonicalReplayCapture({
    persistence,
    directory,
    codeFingerprint: OPERATION_RULES,
    expectedNamespaces: ['events'],
    now: () => FIXED_NOW,
    ...options,
  });
  capture.initialize({ world: world.get(), timeMode: 'realtime', timeZone: 'Asia/Shanghai' });
  return capture;
}

test('capture hook failure rolls back the business transaction and its journal envelope', t => {
  const h = fixture(t), { persistence } = h;
  installJournal(h, {
    onJournalEnvelope: () => { throw new Error('capture_disk_failure'); },
  });

  assert.throws(
    () => persistence.put('events', 'event-1', { value: 'must roll back' }),
    /capture_disk_failure/,
  );
  assert.equal(persistence.get('events', 'event-1'), null);
  assert.deepEqual(persistence.list('replay.capture-journal'), []);
});

test('an unregistered business namespace fails closed before any business or journal write', t => {
  const h = fixture(t), { persistence } = h;
  const capture = installJournal(h);

  assert.throws(
    () => persistence.put('unregistered-business', 'record-1', { value: 'blocked' }),
    /namespace.*(registered|allowed)|operation_namespace_not_registered|replay_capture_unregistered_namespace/i,
  );
  assert.equal(persistence.get('unregistered-business', 'record-1'), null);
  assert.deepEqual(persistence.list('replay.capture-journal'), []);

  persistence.put('events', 'registered-1', { value: 'captured' });
  const [envelope] = persistence.list('replay.capture-journal');
  assert.equal(envelope.schema, 'deskbot.service-operation.v1');
  assert.equal(envelope.capture_id, capture.captureId);
  assert.equal(envelope.index, 0);
  assert.equal(typeof envelope.transaction_id, 'string');
  assert.ok(envelope.transaction_id.length > 0);
  assert.equal(Number.isFinite(Date.parse(envelope.started_at)), true);
  assert.equal(envelope.committed_at, null);
  assert.equal(envelope.coverage, 'persistence_transaction');
  assert.deepEqual(envelope.writes.map(({ namespace, record_id, operation }) =>
    ({ namespace, record_id, operation })), [
    { namespace: 'events', record_id: 'registered-1', operation: 'put' },
  ]);
});

test('writes to capture namespaces do not recursively create operation envelopes', t => {
  const h = fixture(t), { persistence } = h;
  const seen = [];
  installJournal(h, {
    onJournalEnvelope: envelope => {
      seen.push(envelope);
      persistence.put('replay.capture-receipts', `receipt:${envelope.index}`, {
        operation_id: envelope.index,
      });
    },
  });

  persistence.put('events', 'event-1', { value: 'one' });

  const envelopes = persistence.list('replay.capture-journal');
  assert.equal(seen.length, 1);
  assert.equal(envelopes.length, 1);
  assert.equal(persistence.list('replay.capture-journal').length, 1);
  assert.deepEqual(persistence.list('replay.capture-receipts'), [{ operation_id: 0 }]);
});

test('namespace registry is frozen at initialize and cannot be widened by mutating the source array', t => {
  const h = fixture(t), { persistence } = h;
  const expectedNamespaces = ['events'];
  installJournal(h, { expectedNamespaces });
  expectedNamespaces.push('late-business-namespace');

  assert.throws(
    () => persistence.put('late-business-namespace', 'record-1', { value: 'must remain blocked' }),
    /registry|namespace|journal/i,
  );
  assert.equal(persistence.get('late-business-namespace', 'record-1'), null);
});

test('closing capture and writing a non-canonical namespace leaves a gap that reinitialize and export reject', t => {
  const h = fixture(t), { persistence, world } = h;
  const capture = installJournal(h);
  capture.close();
  persistence.put('events', 'after-close', { value: 'uncaptured' });

  assert.throws(
    () => capture.initialize({ world: world.get(), timeMode: 'realtime', timeZone: 'Asia/Shanghai' }),
    /gap|journal|capture/i,
  );
  assert.throws(
    () => exportCanonicalReplayCapture({
      databasePath: persistence.filename,
      directory: h.directory,
      codeFingerprint: OPERATION_RULES,
    }),
    /gap|journal|capture/i,
  );
});

test('the same persistence and capture id cannot be initialized by a second recorder', t => {
  const h = fixture(t), { persistence, world } = h;
  const first = installJournal(h);
  const second = createCanonicalReplayCapture({
    persistence,
    directory: h.directory,
    codeFingerprint: OPERATION_RULES,
    expectedNamespaces: ['events'],
    now: () => FIXED_NOW,
  });

  assert.throws(
    () => second.initialize({ world: world.get(), timeMode: 'realtime', timeZone: 'Asia/Shanghai' }),
    /capture|journal|already|duplicate/i,
  );
  second.close();
  first.close();
});

test('deleted, tampered, or reordered journal entries fail before replay target creation', t => {
  const h = fixture(t), { persistence } = h;
  const capture = installJournal(h);
  persistence.put('events', 'journal-a', { value: 'a' });
  persistence.put('events', 'journal-b', { value: 'b' });
  exportCanonicalReplayCapture({
    databasePath: persistence.filename,
    directory: h.directory,
    codeFingerprint: OPERATION_RULES,
  });
  const manifest = join(h.directory, 'capture.json');
  const original = readFileSync(manifest, 'utf8');
  const baseline = JSON.parse(original);
  assert.equal(baseline.journals.length, 2);

  const variants = [
    ['deleted', tape => { tape.journals.pop(); }],
    ['tampered', tape => { tape.journals[0].writes[0].record_id = 'tampered'; }],
    ['reordered', tape => { tape.journals.reverse(); }],
  ];
  for (const [name, mutate] of variants) {
    const tape = structuredClone(baseline);
    mutate(tape);
    writeFileSync(manifest, JSON.stringify(tape));
    const target = join(h.directory, `replay-${name}.sqlite`);
    assert.throws(
      () => replayCanonicalCapture({
        directory: h.directory,
        targetDatabase: target,
        codeFingerprint: OPERATION_RULES,
      }),
      /journal|capture|gap|corrupt|incomplete/i,
    );
    assert.equal(existsSync(target), false, `${name} must fail before creating target`);
  }
  writeFileSync(manifest, original);
  capture.close();
});

test('parallel withOperation contexts remain attached to their own persistence writes', async t => {
  const h = fixture(t), { persistence } = h;
  const capture = installJournal(h);
  await Promise.all([
    capture.withOperation({ operation_id: 'operation-a', operation_kind: 'parallel-test', source: 'source-a' }, async () => {
      await new Promise(resolve => setTimeout(resolve, 4));
      persistence.put('events', 'parallel-a', { value: 'a' });
    }),
    capture.withOperation({ operation_id: 'operation-b', operation_kind: 'parallel-test', source: 'source-b' }, async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      persistence.put('events', 'parallel-b', { value: 'b' });
    }),
  ]);
  const byRecord = new Map(persistence.list('replay.capture-journal')
    .flatMap(journal => journal.writes.map(write => [write.record_id, journal])));
  assert.equal(byRecord.get('parallel-a').operation_id, 'operation-a');
  assert.equal(byRecord.get('parallel-a').source, 'source-a');
  assert.equal(byRecord.get('parallel-b').operation_id, 'operation-b');
  assert.equal(byRecord.get('parallel-b').source, 'source-b');
  capture.close();
});

test('requireOperationContext rejects an unscoped transaction and rolls it back', t => {
  const h = fixture(t), { persistence } = h;
  const capture = installJournal(h, { requireOperationContext: true });

  assert.throws(
    () => persistence.put('events', 'missing-context', { value: 'must roll back' }),
    /context|operation|journal/i,
  );
  assert.equal(persistence.get('events', 'missing-context'), null);
  assert.deepEqual(persistence.list('replay.capture-journal'), []);
  capture.withOperation({ operation_id: 'scoped-operation', operation_kind: 'context-test' }, () => {
    persistence.put('events', 'with-context', { value: 'captured' });
  });
  assert.equal(persistence.get('events', 'with-context').value, 'captured');
});

test('restarting a capture with a changed registry is rejected', t => {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-operation-journal-restart-'));
  const filename = join(directory, 'source.sqlite');
  let persistence = persistenceModule.createSqlitePersistence({ filename, now: () => FIXED_NOW });
  let world = createPersistentWorld({ persistence, now: () => FIXED_NOW, timeMode: 'realtime', syncClockOnCreate: false });
  const first = createCanonicalReplayCapture({
    persistence,
    directory,
    codeFingerprint: OPERATION_RULES,
    expectedNamespaces: ['events'],
    now: () => FIXED_NOW,
  });
  first.initialize({ world: world.get(), timeMode: 'realtime', timeZone: 'Asia/Shanghai' });
  first.close();
  persistence.close();
  persistence = persistenceModule.createSqlitePersistence({ filename, now: () => FIXED_NOW });
  world = createPersistentWorld({ persistence, now: () => FIXED_NOW, timeMode: 'realtime', syncClockOnCreate: false });
  const changed = createCanonicalReplayCapture({
    persistence,
    directory,
    codeFingerprint: OPERATION_RULES,
    expectedNamespaces: ['events', 'new-writer'],
    now: () => FIXED_NOW,
  });
  t.after(() => {
    try { changed.close(); } catch {}
    try { persistence.close(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  assert.throws(
    () => changed.initialize({ world: world.get(), timeMode: 'realtime', timeZone: 'Asia/Shanghai' }),
    /registry|namespace|journal|capture/i,
  );
});

test('operation context survives an async provider boundary without persisting raw request content', async t => {
  const h = fixture(t), { persistence } = h;
  const capture = installJournal(h);
  await capture.withOperation({ operation_id: 'chat:req-1', operation_kind: 'chat.request', source: 'http',
    request: { message: '含有不应进入封套正文的内容' } }, async () => {
    await Promise.resolve();
    persistence.put('events', 'chat:req-1', { accepted: true });
  });
  const [envelope] = persistence.list('replay.capture-journal');
  assert.equal(envelope.operation_id, 'chat:req-1');
  assert.equal(envelope.operation_kind, 'chat.request');
  assert.equal(envelope.source, 'http');
  assert.match(envelope.request_hash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(envelope, 'request'), false);
});
