import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSqlitePersistence, stableJsonHash } from '../src/persistence.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'deskbot-write-audit-'));
  const filename = join(directory, 'source.sqlite');
  let persistence = createSqlitePersistence({ filename, now: () => new Date('2026-10-13T04:00:00Z') });
  t.after(() => { persistence.close(); rmSync(directory, { recursive: true, force: true }); });
  return { get persistence() { return persistence; }, restart() {
    persistence.close(); persistence = createSqlitePersistence({ filename }); return persistence;
  } };
}

test('write audit is opt-in and creates no audit namespace or persistent journal by default', t => {
  const h = fixture(t), p = h.persistence;
  p.put('events', 'first', { event_id: 'first' });
  p.transaction(() => p.insert('events', 'second', { event_id: 'second' }));
  assert.deepEqual(p.listNamespaces(), ['events']);
  assert.deepEqual(p.listNamespaces({ excludeReplayCapture: false }), ['events']);
  assert.deepEqual(p.getWriteObserverErrors(), []);
});

test('stable hashes ignore JSON key order and retain array ordering and stored JSON semantics', () => {
  assert.equal(stableJsonHash({ b: { x: 2, a: 1 }, a: ['one', 'two'] }),
    stableJsonHash({ a: ['one', 'two'], b: { a: 1, x: 2 } }));
  assert.notEqual(stableJsonHash(['one', 'two']), stableJsonHash(['two', 'one']));
  assert.equal(stableJsonHash({ discarded: undefined, count: NaN }), stableJsonHash({ count: null }));
  assert.throws(() => stableJsonHash(undefined), /JSON serializable/);
});

test('committed journal preserves transaction/write order with hashes and excludes capture writes', t => {
  const h = fixture(t), p = h.persistence, committed = [];
  p.put('events', 'existing', { value: 1 });
  const stop = p.subscribeWrites(batch => committed.push(batch));
  p.transaction(() => {
    p.put('events', 'existing', { value: 2 });
    p.insert('events', 'new', { value: 3 });
    p.put('replay.capture-audit', 'excluded', { secret: 'audit self-observation must be absent' });
    p.remove('events', 'new');
    p.remove('events', 'missing');
  });
  assert.equal(committed.length, 1);
  assert.equal(committed[0].schema, 'persistence-write-batch.v1');
  assert.deepEqual(committed[0].operations, [
    { operation: 'put', namespace: 'events', record_id: 'existing', before_hash: stableJsonHash({ value: 1 }), after_hash: stableJsonHash({ value: 2 }) },
    { operation: 'insert', namespace: 'events', record_id: 'new', before_hash: null, after_hash: stableJsonHash({ value: 3 }) },
    { operation: 'remove', namespace: 'events', record_id: 'new', before_hash: stableJsonHash({ value: 3 }), after_hash: null },
  ]);
  assert.ok(Object.isFrozen(committed[0].operations[0]));
  stop(); p.put('events', 'unobserved', {});
  assert.equal(committed.length, 1);
});

test('business failure rolls back transaction and emits no committed journal', t => {
  const h = fixture(t), p = h.persistence, committed = [], before = [];
  p.insert('events', 'first', { value: 1 });
  p.subscribeWrites(batch => committed.push(batch)); p.subscribeBeforeCommit(batch => before.push(batch));
  assert.throws(() => p.transaction(() => {
    p.put('events', 'first', { value: 2 });
    p.insert('events', 'first', { value: 'duplicate must fail' });
  }), /UNIQUE constraint/);
  assert.deepEqual(p.get('events', 'first'), { value: 1 });
  assert.deepEqual(committed, []); assert.deepEqual(before, []);
  p.put('events', 'after', {});
  assert.equal(committed.length, 1, 'a rolled-back transaction must not strand the audit context');
});

test('before-commit capture audit is atomic for standalone and grouped writes, including restart', t => {
  const h = fixture(t), p = h.persistence, committed = [];
  p.subscribeWrites(batch => committed.push(batch));
  const stop = p.subscribeBeforeCommit(batch => {
    p.insert('replay.capture-write-audit', batch.transaction_id, batch);
    if (batch.operations.some(operation => operation.record_id === 'fail')) throw Error('capture_disk_failure');
  });
  p.put('events', 'first', { value: 1 });
  assert.throws(() => p.put('events', 'fail', { value: 'must roll back' }), /capture_disk_failure/);
  assert.throws(() => p.transaction(() => {
    p.put('events', 'first', { value: 'must also roll back' });
    p.insert('tasks', 'fail', {});
  }), /capture_disk_failure/);
  assert.deepEqual(p.get('events', 'first'), { value: 1 });
  assert.equal(p.get('events', 'fail'), null); assert.equal(p.get('tasks', 'fail'), null);
  assert.equal(p.list('replay.capture-write-audit').length, 1); assert.equal(committed.length, 1);
  stop();
  h.restart();
  assert.equal(h.persistence.list('replay.capture-write-audit').length, 1);
  assert.deepEqual(h.persistence.get('events', 'first'), { value: 1 });
  assert.equal(h.persistence.get('tasks', 'fail'), null);
});

test('audit hook cannot alter business state and observer failure cannot misreport committed rollback', t => {
  const h = fixture(t), p = h.persistence;
  const stop = p.subscribeBeforeCommit(() => p.put('world', 'forged', { revision: 999 }));
  assert.throws(() => p.put('events', 'blocked', {}), /only replay.capture/);
  assert.equal(p.get('world', 'forged'), null); assert.equal(p.get('events', 'blocked'), null);
  stop();
  p.subscribeWrites(() => { throw Error('observer_failed'); });
  p.put('events', 'committed', { value: 1 });
  assert.deepEqual(p.get('events', 'committed'), { value: 1 });
  assert.equal(p.getWriteObserverErrors()[0].message, 'observer_failed');
  const errors = p.getWriteObserverErrors(); errors[0].message = 'mutated';
  assert.equal(p.getWriteObserverErrors()[0].message, 'observer_failed');
});

test('frozen snapshots preserve global insertion order across update, remove/reinsert and restart', t => {
  const h = fixture(t), p = h.persistence;
  p.insert('events', 'event-b', { order: ['b', 'a'] });
  p.insert('tasks', 'task-a', { amount: 1 });
  p.insert('events', 'event-a', { order: ['a', 'b'] });
  p.put('events', 'event-b', { order: ['b', 'a'], updated: true });
  p.remove('tasks', 'task-a'); p.insert('tasks', 'task-a', { amount: 2 });
  p.put('replay.capture-session', 'ignored', {});
  const seed = p.snapshotRecords();
  assert.deepEqual(seed.map(record => [record.namespace, record.record_id]), [
    ['events', 'event-b'], ['events', 'event-a'], ['tasks', 'task-a'],
  ]);
  assert.ok(Object.isFrozen(seed)); assert.ok(Object.isFrozen(seed[0].payload.order));
  assert.throws(() => seed[0].payload.order.push('intrusion'), TypeError);
  assert.deepEqual([...p.iterateRecords()], seed);
  assert.deepEqual(p.listNamespaces(), ['events', 'tasks']);
  assert.deepEqual(p.listNamespaces({ excludeReplayCapture: false }), ['events', 'tasks', 'replay.capture-session']);
  h.restart();
  assert.deepEqual(h.persistence.snapshotRecords(), seed);
  assert.deepEqual(h.persistence.list('events').map(event => event.order), [['b', 'a'], ['a', 'b']]);
});

test('journal detects idempotent replacement separately from failed duplicate insert', t => {
  const h = fixture(t), p = h.persistence, committed = [];
  p.subscribeWrites(batch => committed.push(batch));
  p.insert('events', 'duplicate', { event_id: 'duplicate' });
  p.put('events', 'duplicate', { event_id: 'duplicate' });
  assert.throws(() => p.insert('events', 'duplicate', { event_id: 'duplicate' }), /UNIQUE constraint/);
  assert.equal(committed.length, 2);
  assert.equal(committed[1].operations[0].before_hash, committed[1].operations[0].after_hash);
  assert.equal(p.list('events').length, 1);
});

test('async or nested transactions cannot commit partial work outside the synchronous contract', t => {
  const h = fixture(t), p = h.persistence;
  assert.throws(() => p.transaction(() => {
    p.put('events', 'async', {}); return Promise.resolve('not synchronous');
  }), /must be synchronous/);
  assert.equal(p.get('events', 'async'), null);
  assert.throws(() => p.transaction(() => {
    p.put('events', 'outer', {}); p.transaction(() => p.put('events', 'inner', {}));
  }), /nested/);
  assert.equal(p.get('events', 'outer'), null); assert.equal(p.get('events', 'inner'), null);
});
