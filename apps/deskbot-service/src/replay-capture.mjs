import { createHash } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { canonicalDigest } from './replay-tape.mjs';
import { createSqlitePersistence } from './persistence.mjs';
import { createPersistentWorld } from './persistent-world.mjs';

export const CAPTURE_SCHEMA = 'deskbot.canonical-replay-capture.v1';
export const CAPTURE_RULES = 'deskbot.canonical-replay-capture-rules.v1';
const SESSIONS = 'replay.capture-sessions';
const OPERATIONS = 'replay.capture-operations';
const INGRESSES = 'replay.capture-ingresses';
const NONE = new Set();
const digest = value => canonicalDigest(value, { volatileKeys: NONE });
const copy = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Covers the complete local JS rule graph, rather than assuming an unchanged
 * WORLD_RULE_VERSION means every imported domain rule is unchanged. */
export function replayCodeFingerprint(directory = dirname(fileURLToPath(import.meta.url))) {
  const hash = createHash('sha256');
  for (const name of readdirSync(directory).filter(name => name.endsWith('.mjs')).sort()) {
    hash.update(name).update('\0').update(readFileSync(join(directory, name))).update('\0');
  }
  const contentDirectory = resolve(directory, '../../../world-content');
  const visit = (folder, prefix = '') => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) visit(join(folder, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.json')) hash.update(`content/${prefix}${entry.name}`).update('\0')
        .update(readFileSync(join(folder, entry.name))).update('\0');
    }
  };
  if (existsSync(contentDirectory)) visit(contentDirectory);
  return hash.digest('hex');
}

export function replayFileDigest(filename) {
  const hash = createHash('sha256'), fd = openSync(filename, 'r'), buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let count;
    while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { closeSync(fd); }
}

function snapshotDatabase(source, target) {
  if (existsSync(target)) fail('replay_seed_already_exists');
  // SQLite creates one consistent snapshot including committed WAL pages.
  // Ordinary copyFile(source.sqlite) would silently lose WAL-only facts.
  const database = new DatabaseSync(source, { readOnly: true });
  try { database.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`); }
  finally { database.close(); }
}

function validateSession(session, codeFingerprint) {
  if (session?.schema !== CAPTURE_SCHEMA || session.rule_version !== CAPTURE_RULES) fail('replay_capture_schema_mismatch');
  if (session.code_fingerprint !== codeFingerprint) fail('replay_capture_code_mismatch');
  if (!Number.isSafeInteger(session.operation_count) || session.operation_count < 0) fail('replay_capture_invalid_count');
}

function resultReferences(event) {
  const p = event.payload ?? {};
  // These are outputs already obtained and validated by a private worker.
  // Replay executes the same resolution rule, never calls complete() again.
  return ['resolve_slow_cognition', 'resolve_life_choice'].includes(p.action) ? {
    request_id: p.request_id ?? null, model: p.model ?? null, action: p.action,
    result_hash: digest({ text: p.text ?? null, error: p.error ?? null, choice: p.choice ?? null, payload: p }),
  } : null;
}

function ingressResultDigest(result) {
  return digest({ duplicate: Boolean(result?.duplicate), worldMutation: result?.worldMutation ?? null,
    roleEvolution: result?.roleEvolution ?? null, worldCandidate: result?.worldCandidate ?? null,
    evidence: result?.evidence ?? null });
}

/** Opt-in, private canonical ingress recorder. initialize runs after migration
 * and before startup clock/task/worker writes. Each record is in the SAME
 * SQLite transaction as its canonical fact, so a crash cannot leave a committed
 * world operation without its original input. No recorder means no seed/file/
 * namespace creation. It is deliberately not available as an HTTP capability.
 *
 * v1 scope: canonical world, tasks, cadence, memory maintenance, adopted stages
 * and accepted world facts. Other namespace writers and candidate decisions
 * require their own operation journal before whole-service equality is claimed.
 */
export function createCanonicalReplayCapture({ persistence, directory, now = () => new Date(), codeFingerprint = replayCodeFingerprint() } = {}) {
  if (persistence?.kind !== 'sqlite' || !persistence.filename || !persistence.insert || !persistence.transaction) fail('replay_capture_requires_sqlite');
  if (typeof directory !== 'string' || !directory.trim()) fail('replay_capture_directory_required');
  const archive = resolve(directory), seedPath = join(archive, 'seed.sqlite');
  const captureId = `capture:${digest(archive).slice(0, 24)}`;
  let initialized = false;
  return {
    captureId,
    directory: archive,
    operationCount() {
      if (!initialized) fail('replay_capture_not_initialized');
      return persistence.get(SESSIONS, captureId).operation_count;
    },
    initialize({ world, timeMode, timeZone }) {
      const existing = persistence.get(SESSIONS, captureId);
      if (existing) {
        validateSession(existing, codeFingerprint);
        if (existing.source_database !== realpathSync(persistence.filename) || existing.archive_directory !== archive) fail('replay_capture_source_mismatch');
        if (!existsSync(seedPath) || replayFileDigest(seedPath) !== existing.seed_file_hash) fail('replay_capture_seed_mismatch');
        if (digest(world) !== existing.final_world_hash) fail('replay_capture_gap_detected');
        initialized = true;
        return;
      }
      mkdirSync(archive, { recursive: true });
      snapshotDatabase(persistence.filename, seedPath);
      persistence.insert(SESSIONS, captureId, {
        schema: CAPTURE_SCHEMA, rule_version: CAPTURE_RULES, capture_id: captureId,
        source_database: realpathSync(persistence.filename), archive_directory: archive,
        started_at: now().toISOString(), seed_file: 'seed.sqlite', seed_file_hash: replayFileDigest(seedPath),
        seed_world_hash: digest(world), final_world_hash: digest(world),
        code_fingerprint: codeFingerprint, clock: { time_mode: timeMode, time_zone: timeZone },
        world_id: world.world_id, seed_revision: world.world_revision, final_revision: world.world_revision,
        operation_count: 0, ingress_count: 0, final_chain_hash: null, coverage: 'canonical_world_only',
      });
      initialized = true;
    },
    recordCommit({ event, adapter, received_at, before_world, mutation, world }) {
      if (!initialized) fail('replay_capture_not_initialized');
      const session = persistence.get(SESSIONS, captureId);
      if (digest(before_world) !== session.final_world_hash) fail('replay_capture_gap_detected');
      const operation = {
        schema: 'deskbot.canonical-replay-operation.v1', capture_id: captureId,
        index: session.operation_count, event: copy(event), adapter: copy(adapter),
        received_at, logical_time_before: copy(before_world.logical_time),
        expected_mutation_id: mutation.mutation_id, expected_sequence: mutation.sequence,
        expected_revision: world.world_revision, before_world_hash: session.final_world_hash,
        world_hash: digest(world), mutation_hash: digest(mutation), model_result: resultReferences(event),
        previous_chain_hash: session.final_chain_hash,
      };
      operation.chain_hash = digest(operation);
      persistence.insert(OPERATIONS, `${captureId}:${operation.index}`, operation);
      persistence.put(SESSIONS, captureId, { ...session, operation_count: operation.index + 1,
        final_world_hash: operation.world_hash, final_revision: world.world_revision,
        final_sequence: mutation.sequence, final_chain_hash: operation.chain_hash });
    },
    recordIngress({ event, adapter = {}, result = null, received_at = now().toISOString(), operation_start = null }) {
      if (!initialized) fail('replay_capture_not_initialized');
      const session = persistence.get(SESSIONS, captureId);
      const id = String(event?.event_id ?? '').trim();
      if (!id) fail('replay_capture_event_id_required');
      const record = {
        schema: 'deskbot.replay-capture-ingress.v1', capture_id: captureId, event_id: id, index: session.ingress_count ?? 0,
         event: copy(event), adapter: copy(adapter), received_at,
        duplicate: Boolean(result?.duplicate),
         operation_start: operation_start ?? session.operation_count,
         operation_end: session.operation_count,
         result_digest: ingressResultDigest(result),
      };
      record.record_hash = digest(record);
      persistence.transaction(() => {
        persistence.insert(INGRESSES, `${captureId}:${record.index}`, record);
       persistence.put(SESSIONS, captureId, {
         ...session,
         ingress_count: record.index + 1,
         // Recording an app ingress is not proof that every service writer
         // was captured; the isolated service replay checks all namespaces.
         coverage: 'canonical_world_with_service_ingress',
       });
      });
      return record;
    },
  };
}

/** Local export can run while the source service lives. A read transaction
 * freezes its session plus operation prefix without mutating the source DB. */
export function exportCanonicalReplayCapture({ databasePath, directory, codeFingerprint = replayCodeFingerprint() } = {}) {
  const archive = resolve(directory), captureId = `capture:${digest(archive).slice(0, 24)}`;
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
  let session, operations, ingresses, namespace_digests;
  try {
    database.exec('BEGIN');
    const row = database.prepare('SELECT payload_json FROM records WHERE namespace=? AND record_id=?').get(SESSIONS, captureId);
    if (!row) fail('replay_capture_not_found');
    session = JSON.parse(row.payload_json); validateSession(session, codeFingerprint);
     const state = database.prepare('SELECT payload_json FROM records WHERE namespace=? AND record_id=?')
       .get('canonical-world.states', session.world_id);
     if (!state || digest(JSON.parse(state.payload_json)) !== session.final_world_hash) fail('replay_capture_gap_detected');
    operations = [...database.prepare('SELECT payload_json FROM records WHERE namespace=? ORDER BY rowid ASC').iterate(OPERATIONS)]
      .map(row => JSON.parse(row.payload_json)).filter(operation => operation.capture_id === captureId && operation.index < session.operation_count);
    ingresses = [...database.prepare('SELECT payload_json FROM records WHERE namespace=? ORDER BY rowid ASC').iterate(INGRESSES)]
      .map(row => JSON.parse(row.payload_json)).filter(ingress => ingress.capture_id === captureId);
    const grouped = new Map();
    for (const row of database.prepare('SELECT namespace,record_id,payload_json FROM records ORDER BY rowid ASC').iterate()) {
      if (row.namespace.startsWith('replay.capture-')) continue;
      const hash = grouped.get(row.namespace) ?? { count: 0, hash: createHash('sha256') };
      hash.count++; hash.hash.update(digest({ record_id: row.record_id, payload: JSON.parse(row.payload_json) })).update('\0');
      grouped.set(row.namespace, hash);
    }
    namespace_digests = Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, record]) => [namespace, { count: record.count, digest: record.hash.digest('hex') }]));
    database.exec('COMMIT');
  } finally { database.close(); }
  if (replayFileDigest(join(archive, 'seed.sqlite')) !== session.seed_file_hash) fail('replay_capture_seed_mismatch');
  const portableSession = { ...session, namespace_digests }; delete portableSession.source_database; delete portableSession.archive_directory;
  const tape = { schema: CAPTURE_SCHEMA, rule_version: CAPTURE_RULES, session: portableSession, operations, ingresses };
  validateArchive(tape, codeFingerprint);
  writeFileSync(join(archive, 'capture.json'), `${JSON.stringify(tape)}\n`, { mode: 0o600 });
  return { directory: archive, operation_count: operations.length, final_revision: session.final_revision, coverage: session.coverage };
}

function validateArchive(tape, codeFingerprint) {
  if (tape?.schema !== CAPTURE_SCHEMA || tape.rule_version !== CAPTURE_RULES) fail('replay_capture_schema_mismatch');
  validateSession(tape.session, codeFingerprint);
  if (!Array.isArray(tape.operations) || tape.operations.length !== tape.session.operation_count) fail('replay_capture_incomplete');
  if (!Array.isArray(tape.ingresses)) fail('replay_capture_ingress_missing');
  if (tape.ingresses.length !== (tape.session.ingress_count ?? 0)) fail('replay_capture_ingress_incomplete');
   let previousOperationEnd = 0;
   for (const [index, ingress] of tape.ingresses.entries()) {
    const { record_hash, ...content } = ingress;
     if (ingress.schema !== 'deskbot.replay-capture-ingress.v1' || ingress.index !== index
       || ingress.capture_id !== tape.session.capture_id || !Number.isFinite(Date.parse(ingress.received_at))
       || digest(content) !== record_hash) fail('replay_capture_ingress_corrupt');
     if (!Number.isSafeInteger(ingress.operation_start) || !Number.isSafeInteger(ingress.operation_end)
       || ingress.operation_start < previousOperationEnd || ingress.operation_end < ingress.operation_start
       || ingress.operation_end > tape.operations.length) fail('replay_capture_ingress_operation_range');
     previousOperationEnd = ingress.operation_end;
  }
  let previous = null, worldHash = tape.session.seed_world_hash;
  for (const [index, operation] of tape.operations.entries()) {
    const { chain_hash: hash, ...content } = operation;
    if (operation.schema !== 'deskbot.canonical-replay-operation.v1' || operation.capture_id !== tape.session.capture_id
      || operation.index !== index || operation.previous_chain_hash !== previous || digest(content) !== hash
      || operation.before_world_hash !== worldHash || !Number.isFinite(Date.parse(operation.received_at))) fail('replay_capture_operation_corrupt');
    previous = hash; worldHash = operation.world_hash;
  }
  if (previous !== tape.session.final_chain_hash || worldHash !== tape.session.final_world_hash) fail('replay_capture_final_mismatch');
}

function namespaceDigests(persistence) {
  const grouped = new Map();
  for (const row of persistence.iterateRecords({ excludeReplayCapture: true })) {
    const record = grouped.get(row.namespace) ?? { count: 0, hash: createHash('sha256') };
    record.count++; record.hash.update(digest({ record_id: row.record_id, payload: row.payload })).update('\0');
    grouped.set(row.namespace, record);
  }
  return Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([namespace, record]) => [namespace, { count: record.count, digest: record.hash.digest('hex') }]));
}

/** Execute a LOCAL TRUSTED archive through existing rules. Trusted adapter
 * attestations are never accepted from public endpoints. The archive contains
 * private source data and has no authentication: do not replay untrusted files.
 * This function never opens the original database, loads credentials, starts
 * workers, or calls a model. Each result must exactly match the captured commit.
 */
export function replayCanonicalCapture({ directory, targetDatabase, restartAt = null, codeFingerprint = replayCodeFingerprint() } = {}) {
  const archive = resolve(directory), target = resolve(targetDatabase), seed = join(archive, 'seed.sqlite');
  const tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
  validateArchive(tape, codeFingerprint);
  if (replayFileDigest(seed) !== tape.session.seed_file_hash) fail('replay_capture_seed_mismatch');
  if (existsSync(target) || existsSync(`${target}-wal`) || existsSync(`${target}-shm`) || target === seed) fail('replay_target_must_be_new');
  if (restartAt !== null && (!Number.isSafeInteger(restartAt) || restartAt < 0 || restartAt > tape.operations.length)) fail('replay_restart_range_invalid');
  mkdirSync(dirname(target), { recursive: true }); copyFileSync(seed, target);
  let persistence, world, time = tape.session.started_at;
  const reopen = () => {
    persistence?.close();
    persistence = createSqlitePersistence({ filename: target, now: () => new Date(time) });
    world = createPersistentWorld({ persistence, now: () => new Date(time), timeMode: tape.session.clock.time_mode,
      timeZone: tape.session.clock.time_zone, syncClockOnCreate: false });
  };
  try {
    reopen();
    if (digest(world.get()) !== tape.session.seed_world_hash) fail('replay_seed_rule_mismatch');
    for (const [index, operation] of tape.operations.entries()) {
      time = operation.received_at;
      if (restartAt === index) reopen();
      if (digest(world.get()) !== operation.before_world_hash) fail('replay_before_world_mismatch');
      const result = world.ingest(copy(operation.event), copy(operation.adapter));
      if (!result.mutation || result.mutation.mutation_id !== operation.expected_mutation_id
        || result.mutation.sequence !== operation.expected_sequence || digest(result.mutation) !== operation.mutation_hash
        || digest(world.get()) !== operation.world_hash) fail(`replay_result_mismatch:${index}`);
      // Delivery dedupe is part of the real writer contract, not a replay hack.
      const duplicate = world.ingest(copy(operation.event), copy(operation.adapter));
      if (!duplicate.duplicate || digest(world.get()) !== operation.world_hash) fail('replay_duplicate_changed_world');
    }
    if (restartAt === tape.operations.length) reopen();
    if (digest(world.get()) !== tape.session.final_world_hash) fail('replay_final_world_mismatch');
    return { schema: 'deskbot.canonical-replay-result.v1', coverage: 'canonical_world_only',
      operations: tape.operations.length, world_revision: world.get().world_revision,
      world_hash: digest(world.get()), verified: true, provider_calls: 0, target_database: target,
      restart_at: restartAt };
  } finally { persistence?.close(); }
}

/** Full-service replay seam. Unlike the canonical-only helper, this accepts a
 * caller-owned isolated createDeskBotServer factory and replays every captured
 * app ingress through that service. No SQL record from the source is applied;
 * the seed is only the pre-capture baseline. This is intentionally a library
 * API, not an HTTP endpoint, because adapters and model fixtures are trusted
 * local test inputs. */
export async function replayServiceCapture({ directory, targetDatabase, runtimeFactory, restartAt = null, codeFingerprint = replayCodeFingerprint() } = {}) {
  if (typeof runtimeFactory !== 'function') fail('replay_runtime_factory_required');
  const archive = resolve(directory), target = resolve(targetDatabase), tape = JSON.parse(readFileSync(join(archive, 'capture.json'), 'utf8'));
  validateArchive(tape, codeFingerprint);
  if (replayFileDigest(join(archive, 'seed.sqlite')) !== tape.session.seed_file_hash) fail('replay_capture_seed_mismatch');
  if (existsSync(target) || existsSync(`${target}-wal`) || existsSync(`${target}-shm`) || target === join(archive, 'seed.sqlite')) fail('replay_target_must_be_new');
  if (restartAt !== null && (!Number.isSafeInteger(restartAt) || restartAt < 0 || restartAt > tape.ingresses.length)) fail('replay_restart_range_invalid');
  mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(archive, 'seed.sqlite'), target);
   let runtime = null, persistence = null, time = tape.session.started_at, nextOperation = 0;
  const open = async (receivedAt) => {
    if (runtime?.close) await runtime.close(); else persistence?.close();
     time = receivedAt;
     persistence = createSqlitePersistence({ filename: target, now: () => new Date(time) });
     runtime = await runtimeFactory({ persistence, tape, now: () => new Date(time), mode: 'replay' });
    if (!runtime?.ingestNonChatEvent) fail('replay_runtime_ingress_missing');
  };
   const world = () => runtime.persistentWorld;
   const replayStandaloneOperations = end => {
     if (nextOperation === end) return;
     if (!world()?.ingest || !world()?.get) fail('replay_runtime_world_missing');
     while (nextOperation < end) {
       const operation = tape.operations[nextOperation];
       time = operation.received_at;
       if (digest(world().get()) !== operation.before_world_hash) fail(`replay_service_before_world_mismatch:${nextOperation}`);
       const result = world().ingest(copy(operation.event), copy(operation.adapter));
       if (result.mutation?.mutation_id !== operation.expected_mutation_id || digest(result.mutation) !== operation.mutation_hash
         || digest(world().get()) !== operation.world_hash) fail(`replay_service_world_mismatch:${nextOperation}`);
       nextOperation++;
     }
   };
  try {
    await open(tape.session.started_at);
    for (const [index, ingress] of tape.ingresses.entries()) {
       replayStandaloneOperations(ingress.operation_start);
       time = ingress.received_at;
      if (restartAt === index) await open(ingress.received_at);
      const result = await runtime.ingestNonChatEvent(copy(ingress.event), copy(ingress.adapter));
      if (Boolean(result?.duplicate) !== ingress.duplicate) fail(`replay_service_duplicate_mismatch:${index}`);
       if (ingressResultDigest(result) !== ingress.result_digest) fail(`replay_service_ingress_result_mismatch:${index}`);
       nextOperation = ingress.operation_end;
       if (world()?.get && nextOperation && digest(world().get()) !== tape.operations[nextOperation - 1].world_hash) {
         fail(`replay_service_ingress_world_mismatch:${index}`);
       }
    }
     replayStandaloneOperations(tape.operations.length);
     if (restartAt === tape.ingresses.length) await open(time);
    const actual = namespaceDigests(persistence);
    const expected = tape.session.namespace_digests ?? null;
     if (!expected || digest(actual) !== digest(expected)) {
       const namespaces = [...new Set([...Object.keys(actual), ...Object.keys(expected ?? {})])]
         .filter(namespace => digest(actual[namespace] ?? null) !== digest(expected?.[namespace] ?? null));
       throw Object.assign(new Error('replay_service_namespace_mismatch'), { code: 'replay_service_namespace_mismatch', namespaces });
     }
    return { schema: 'deskbot.service-replay-result.v1', coverage: 'service_ingress_namespaces_verified', ingresses: tape.ingresses.length,
      namespace_digests: actual, provider_calls: 0, verified: true, target_database: target, restart_at: restartAt };
  } finally { if (runtime?.close) await runtime.close(); else persistence?.close(); }
}
