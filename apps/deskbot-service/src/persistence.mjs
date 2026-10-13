import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

function requireName(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

// JSON object key order is incidental; array/record order is part of the
// contract. Hash the stored JSON value rather than its caller's object graph.
export function stableJsonHash(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('value must be JSON serializable');
  const canonical = (item) => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item && typeof item === 'object') {
      return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`;
    }
    return JSON.stringify(item);
  };
  return createHash('sha256').update(canonical(JSON.parse(serialized))).digest('hex');
}

function freezeJson(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

const isCaptureNamespace = (namespace) => namespace.startsWith('replay.capture-');

export function createSqlitePersistence({ filename, now = () => new Date() } = {}) {
  const databasePath = resolve(requireName(filename, 'filename'));
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS records (
      namespace TEXT NOT NULL,
      record_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (namespace, record_id)
    );
    CREATE INDEX IF NOT EXISTS records_namespace_idx
      ON records (namespace);
    PRAGMA user_version = 1;
  `);

  const getStatement = database.prepare(`
    SELECT payload_json
    FROM records
    WHERE namespace = ? AND record_id = ?
  `);
  const listStatement = database.prepare(`
    SELECT payload_json
    FROM records
    WHERE namespace = ?
    ORDER BY rowid ASC
  `);
  const putStatement = database.prepare(`
    INSERT INTO records (namespace, record_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(namespace, record_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const insertStatement = database.prepare(`
    INSERT INTO records (namespace, record_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  const removeStatement = database.prepare(`
    DELETE FROM records
    WHERE namespace = ? AND record_id = ?
  `);
  const recordsStatement = database.prepare(`
    SELECT namespace, record_id, payload_json, updated_at
    FROM records ORDER BY rowid ASC
  `);
  const namespacesStatement = database.prepare(`
    SELECT namespace FROM records
    GROUP BY namespace ORDER BY MIN(rowid) ASC
  `);
  const writeObservers = new Set(), beforeCommitObservers = new Set(), observerErrors = [];
  const journalSession = randomUUID();
  let transactionCounter = 0, currentTransaction = null, invokingBeforeCommit = false;

  function subscribe(collection, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    collection.add(listener);
    return () => collection.delete(listener);
  }

  function publishCommitted(batch) {
    // Observational failures cannot make an already committed business write
    // appear rolled back. Capture that requires atomicity uses beforeCommit.
    for (const observer of [...writeObservers]) {
      try { observer(batch); }
      catch (error) {
        observerErrors.push({ transaction_id: batch.transaction_id, message: String(error?.message ?? error) });
        if (observerErrors.length > 100) observerErrors.shift();
      }
    }
  }

  function write(operation, namespace, recordId, value) {
    const name = requireName(namespace, 'namespace'), id = requireName(recordId, 'recordId');
    if (invokingBeforeCommit && !isCaptureNamespace(name)) {
      throw new Error('before-commit audit hooks may write only replay.capture-* namespaces');
    }
    const monitored = !isCaptureNamespace(name) && (writeObservers.size > 0 || beforeCommitObservers.size > 0);
    // An atomic audit hook needs a transaction even for a standalone write.
    if (monitored && !currentTransaction) {
      return transaction(() => write(operation, name, id, value));
    }
    const before = monitored ? getStatement.get(name, id) : null;
    const serialized = operation === 'remove' ? null : JSON.stringify(value);
    const result = operation === 'remove'
      ? removeStatement.run(name, id)
      : (operation === 'put' ? putStatement : insertStatement).run(name, id, serialized, now().toISOString());
    if (monitored && result.changes > 0) {
      currentTransaction.operations.push({
        operation, namespace: name, record_id: id,
        before_hash: before ? stableJsonHash(JSON.parse(before.payload_json)) : null,
        after_hash: operation === 'remove' ? null : stableJsonHash(JSON.parse(serialized)),
      });
    }
    return operation === 'remove' ? result.changes > 0 : value;
  }

  function get(namespace, recordId) {
    const row = getStatement.get(
      requireName(namespace, 'namespace'),
      requireName(recordId, 'recordId'),
    );
    return row ? JSON.parse(row.payload_json) : null;
  }

  function list(namespace) {
    return listStatement
      .all(requireName(namespace, 'namespace'))
      .map((row) => JSON.parse(row.payload_json));
  }

  // Stream large append-only namespaces one JSON record at a time. Callers
  // must not retain the full payload when they only need its cursor/index.
  function* iterate(namespace) {
    for (const row of listStatement.iterate(requireName(namespace, 'namespace'))) {
      yield JSON.parse(row.payload_json);
    }
  }

  function listNamespaces({ excludeReplayCapture = true } = {}) {
    return Object.freeze(namespacesStatement.all().map((row) => row.namespace)
      .filter((namespace) => !excludeReplayCapture || !isCaptureNamespace(namespace)));
  }

  function* iterateRecords({ excludeReplayCapture = true } = {}) {
    for (const row of recordsStatement.iterate()) {
      if (excludeReplayCapture && isCaptureNamespace(row.namespace)) continue;
      yield freezeJson({ namespace: row.namespace, record_id: row.record_id,
        payload: JSON.parse(row.payload_json), updated_at: row.updated_at });
    }
  }

  function snapshotRecords(options) {
    // Materialization is explicit and intended for a frozen seed/export;
    // ordinary startup must keep using the streaming namespace iterator.
    return Object.freeze([...iterateRecords(options)]);
  }

  function put(namespace, recordId, value) {
    return write('put', namespace, recordId, value);
  }

  function insert(namespace, recordId, value) {
    return write('insert', namespace, recordId, value);
  }

  function remove(namespace, recordId) {
    return write('remove', namespace, recordId);
  }

  function transaction(operation) {
    if (typeof operation !== 'function') {
      throw new TypeError('operation must be a function');
    }

    if (currentTransaction) throw new Error('nested persistence transactions are not supported');
    database.exec('BEGIN IMMEDIATE');
    currentTransaction = { transaction_id: `${journalSession}:${++transactionCounter}`, operations: [] };
    let batch;
    try {
      const result = operation();
      if (result && typeof result.then === 'function') throw new TypeError('persistence transactions must be synchronous');
      if (currentTransaction.operations.length) {
        batch = freezeJson({ schema: 'persistence-write-batch.v1',
          transaction_id: currentTransaction.transaction_id, operations: [...currentTransaction.operations] });
        invokingBeforeCommit = true;
        try {
          for (const observer of [...beforeCommitObservers]) {
            const observation = observer(batch);
            if (observation && typeof observation.then === 'function') throw new TypeError('before-commit audit hooks must be synchronous');
          }
        } finally { invokingBeforeCommit = false; }
      }
      database.exec('COMMIT');
      currentTransaction = null;
      if (batch) publishCommitted(batch);
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      currentTransaction = null;
      invokingBeforeCommit = false;
      throw error;
    }
  }

  return {
    close: () => database.close(),
    filename: databasePath,
    get,
    insert,
    kind: 'sqlite',
    iterate,
    iterateRecords,
    list,
    listNamespaces,
    put,
    remove,
    snapshotRecords,
    subscribeWrites: (listener) => subscribe(writeObservers, listener),
    subscribeBeforeCommit: (listener) => subscribe(beforeCommitObservers, listener),
    getWriteObserverErrors: () => structuredClone(observerErrors),
    transaction,
  };
}
