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
    CREATE TABLE IF NOT EXISTS cognitive_memory_index (
      namespace TEXT NOT NULL, record_id TEXT NOT NULL, search_text TEXT NOT NULL,
      importance REAL NOT NULL, occurred_at TEXT NOT NULL,
      PRIMARY KEY (namespace,record_id)
    );
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

  // Project small scalar fields without materializing large historical payloads.
  function listMetadata(namespace, fields) {
    if (!Array.isArray(fields) || fields.length === 0 || fields.some(field => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))) {
      throw new TypeError('metadata fields must be simple property names');
    }
    const columns = fields.map(field => `json_extract(payload_json, '$.${field}') AS "${field}"`).join(', ');
    return database.prepare(`SELECT ${columns} FROM records WHERE namespace = ? ORDER BY rowid ASC`)
      .all(requireName(namespace, 'namespace'));
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

  function page(namespace,{afterId='',limit=100}={}) {
    return database.prepare('SELECT record_id,payload_json FROM records WHERE namespace=? AND record_id>? ORDER BY record_id LIMIT ?')
      .all(requireName(namespace,'namespace'),afterId,Math.min(200,Math.max(1,limit)))
      .map(row=>({id:row.record_id,value:JSON.parse(row.payload_json)}));
  }
  function count(namespace){return database.prepare('SELECT count(*) AS n FROM records WHERE namespace=?').get(namespace).n;}
  function indexMemory(namespace,id,memory){
    database.prepare('INSERT INTO cognitive_memory_index VALUES (?,?,?,?,?) ON CONFLICT(namespace,record_id) DO UPDATE SET search_text=excluded.search_text, importance=excluded.importance, occurred_at=excluded.occurred_at')
      .run(namespace,id,String(memory.payload.stored_content??memory.payload.raw_content??''),memory.payload.importance??0,memory.occurred_at??memory.interpreted_at??'');
  }
  function searchMemory(namespace,terms=[],limit=32){
    const words=[...new Set(terms.filter(t=>typeof t==='string'&&t.length>1))].slice(0,12);
    const score=words.length?words.map(()=>'(instr(search_text,?)>0)').join('+'):'0.0';
    return database.prepare(`SELECT record_id FROM cognitive_memory_index WHERE namespace=? ORDER BY (${score}) DESC,importance DESC,occurred_at DESC,record_id LIMIT ?`)
      .all(namespace,...words,Math.min(48,Math.max(1,limit))).map(row=>get(namespace,row.record_id)).filter(Boolean);
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
    listMetadata,
    page,count,indexMemory,searchMemory,
    put,
    remove,
    transaction,
  };
}
