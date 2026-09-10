import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function requireName(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

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

  function put(namespace, recordId, value) {
    putStatement.run(
      requireName(namespace, 'namespace'),
      requireName(recordId, 'recordId'),
      JSON.stringify(value),
      now().toISOString(),
    );
    return value;
  }

  function insert(namespace, recordId, value) {
    insertStatement.run(
      requireName(namespace, 'namespace'),
      requireName(recordId, 'recordId'),
      JSON.stringify(value),
      now().toISOString(),
    );
    return value;
  }

  function remove(namespace, recordId) {
    return removeStatement.run(
      requireName(namespace, 'namespace'),
      requireName(recordId, 'recordId'),
    ).changes > 0;
  }

  function transaction(operation) {
    if (typeof operation !== 'function') {
      throw new TypeError('operation must be a function');
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    close: () => database.close(),
    filename: databasePath,
    get,
    insert,
    kind: 'sqlite',
    list,
    put,
    remove,
    transaction,
  };
}
