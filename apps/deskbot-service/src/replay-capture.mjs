import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
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
const CHATS = 'replay.capture-chats';
const PROVIDERS = 'replay.capture-provider-results';
const JOURNAL = 'replay.capture-journal';
const NONE = new Set();
// A capture id is a durable identity, but two live recorder objects on the
// same persistence must not both subscribe to the same before-commit stream.
// The lock is process-local; the persisted session/registry checks below are
// still authoritative across a restart.
const activeCaptureLocks = new WeakMap();
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

// Chat responses are intentionally represented by digests in the replay
// envelope.  The private provider fixture registry below may retain the
// deterministic fixture text, but the operation journal never does.
function chatResultDigest(result) {
  const turn = result?.turn ?? result ?? null;
  const error = result?.error ?? null;
  return digest({
    duplicate: Boolean(result?.duplicate),
    turn_id: turn?.turn_id ?? null,
    reply_hash: typeof turn?.reply === 'string' ? digest(turn.reply) : null,
    world_revision: turn?.canonical_world?.snapshot?.world_revision ?? result?.canonical_world?.world?.world_revision ?? null,
    output_route: turn?.output_route?.route_id ?? result?.output_route?.route_id ?? null,
    error: error ? { code: error.code ?? null, status: error.statusCode ?? error.status ?? null } : null,
  });
}

function providerFixtureKind(ref) {
  if (ref?.tts && typeof ref.tts === 'object') return 'tts';
  if (ref?.purpose === 'chat') return 'llm';
  return String(ref?.purpose ?? 'provider');
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
export function createCanonicalReplayCapture({ persistence, directory, now = () => new Date(), codeFingerprint = replayCodeFingerprint(),
  onJournalEnvelope = null, expectedNamespaces = null, requireOperationContext = false } = {}) {
  if (persistence?.kind !== 'sqlite' || !persistence.filename || !persistence.insert || !persistence.transaction) fail('replay_capture_requires_sqlite');
  if (typeof directory !== 'string' || !directory.trim()) fail('replay_capture_directory_required');
  const archive = resolve(directory), seedPath = join(archive, 'seed.sqlite');
  const captureId = `capture:${digest(archive).slice(0, 24)}`;
  const namespaceRegistry = expectedNamespaces === null || expectedNamespaces === undefined
    ? null : new Set(expectedNamespaces);
  const namespaceRegistryList = namespaceRegistry ? [...namespaceRegistry].sort() : null;
  const registryHash = digest({ namespaces: namespaceRegistryList, require_operation_context: Boolean(requireOperationContext) });
  const lockMap = activeCaptureLocks.get(persistence) ?? new Map();
  activeCaptureLocks.set(persistence, lockMap);
  const lockToken = {};
  let initialized = false;
  let closed = false;
  const operationStorage = new AsyncLocalStorage();
  const unsubscribeJournal = persistence.subscribeBeforeCommit?.(batch => {
    if (!initialized || !batch?.operations?.length) return;
    const session = persistence.get(SESSIONS, captureId);
    if (!session) return;
    const index = session.journal_count ?? 0;
    const writes = batch.operations.map(operation => ({ ...operation }));
    const context = operationStorage.getStore();
    if (requireOperationContext && !context) fail('operation_context_required');
    if (namespaceRegistry) {
      const registry = namespaceRegistry;
      const unknown = [...new Set(writes.map(operation => operation.namespace))]
        .filter(namespace => !registry.has(namespace));
      if (unknown.length) fail(`operation_namespace_not_registered:${unknown.join(',')}`);
    }
    const envelope = {
      schema: 'deskbot.service-operation.v1',
      capture_id: captureId,
      index,
      operation_id: context?.operation_id ?? `transaction:${batch.transaction_id}`,
      operation_kind: context?.operation_kind ?? 'persistence_transaction',
      source: context?.source ?? 'persistence',
      request_hash: context?.request_hash ?? null,
      result_ref: context?.result_ref ?? null,
      transaction_id: batch.transaction_id,
      started_at: context?.started_at ?? now().toISOString(),
      committed_at: null,
      observed_at: now().toISOString(),
      writes,
      coverage: 'persistence_transaction',
    };
    envelope.record_hash = digest(envelope);
    if (typeof onJournalEnvelope === 'function') onJournalEnvelope(copy(envelope));
    persistence.insert(JOURNAL, `${captureId}:${index}`, envelope);
    persistence.put(SESSIONS, captureId, { ...session, journal_count: index + 1,
      journal_state_digest: digest(namespaceDigests(persistence)) });
  }) ?? (() => {});
  const api = {
    captureId,
    directory: archive,
    close() {
      if (closed) return;
      closed = true;
      unsubscribeJournal();
      if (lockMap.get(captureId) === lockToken) lockMap.delete(captureId);
    },
    withOperation(context, callback) {
      if (!initialized) fail('replay_capture_not_initialized');
      if (!context || typeof context !== 'object' || typeof callback !== 'function') {
        throw new TypeError('withOperation requires an operation context and callback');
      }
      const operation_id = String(context.operation_id ?? '').trim();
      if (!operation_id) throw new TypeError('operation_id must be a non-empty string');
      const operation_kind = String(context.operation_kind ?? context.kind ?? '').trim();
      if (!operation_kind) throw new TypeError('operation_kind must be a non-empty string');
      const source = String(context.source ?? 'service').trim() || 'service';
      const request_hash = context.request_hash ?? (context.request === undefined ? null : digest(context.request));
      const normalized = {
        schema: 'deskbot.service-operation-context.v1', operation_id, operation_kind, source,
        request_hash, result_ref: context.result_ref ?? null,
        started_at: context.started_at ?? now().toISOString(),
      };
      return operationStorage.run(normalized, callback);
    },
    setOperationResultRef(resultRef) {
      const context = operationStorage.getStore();
      if (!context) fail('operation_context_required');
      return api.recordProviderResult(resultRef);
    },
    operationCount() {
      if (!initialized) fail('replay_capture_not_initialized');
      return persistence.get(SESSIONS, captureId).operation_count;
    },
    journalCount() {
      if (!initialized) fail('replay_capture_not_initialized');
      return persistence.get(SESSIONS, captureId).journal_count ?? 0;
    },
    initialize({ world, timeMode, timeZone }) {
      if (closed) fail('replay_capture_closed');
      const activeOwner = lockMap.get(captureId);
      if (activeOwner && activeOwner !== lockToken) fail('replay_capture_already_active');
      const existing = persistence.get(SESSIONS, captureId);
      if (existing) {
        validateSession(existing, codeFingerprint);
        if (existing.source_database !== realpathSync(persistence.filename) || existing.archive_directory !== archive) fail('replay_capture_source_mismatch');
        if (!existsSync(seedPath) || replayFileDigest(seedPath) !== existing.seed_file_hash) fail('replay_capture_seed_mismatch');
        if (digest(world) !== existing.final_world_hash) fail('replay_capture_gap_detected');
        if (existing.journal_registry_hash !== registryHash
          || Boolean(existing.journal_require_operation_context) !== Boolean(requireOperationContext)) {
          fail('replay_capture_registry_mismatch');
        }
        if (existing.journal_state_digest && digest(namespaceDigests(persistence)) !== existing.journal_state_digest) {
          fail('replay_capture_gap_detected');
        }
        lockMap.set(captureId, lockToken);
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
        operation_count: 0, ingress_count: 0, chat_count: 0, provider_count: 0, journal_count: 0,
        journal_namespace_registry: namespaceRegistryList,
        journal_registry_hash: registryHash,
        journal_require_operation_context: Boolean(requireOperationContext),
        journal_state_digest: digest(namespaceDigests(persistence)),
        final_chain_hash: null, coverage: 'canonical_world_only',
      });
      lockMap.set(captureId, lockToken);
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
      const previous = persistence.list(CHATS).find(item => item.capture_id === captureId && item.event_id === id);
      if (previous) return copy(previous);
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
    /** Record an HTTP chat attempt in the private replay archive. The event is
     * replay input; it is intentionally not copied into service-operation
     * journal envelopes (which only retain request hashes). */
    recordChat({ event, result = null, error = null, received_at = now().toISOString(), operation_start = null,
      operation_end = null } = {}) {
      if (!initialized) fail('replay_capture_not_initialized');
      const session = persistence.get(SESSIONS, captureId);
      const id = String(event?.event_id ?? '').trim();
      if (!id) fail('replay_capture_event_id_required');
      const providerRecords = persistence.list(PROVIDERS)
        .filter(item => item.capture_id === captureId && item.operation_id === `chat:${id}`)
        .sort((a, b) => String(a.kind).localeCompare(String(b.kind)));
      const record = {
        schema: 'deskbot.replay-capture-chat.v1', capture_id: captureId,
        event: copy(event), event_id: id, index: session.chat_count ?? 0,
        received_at, duplicate: Boolean(result?.duplicate),
        status: error ? 'error' : 'success',
        operation_start: operation_start ?? session.operation_count,
        operation_end: operation_end ?? session.operation_count,
        result_digest: chatResultDigest(result),
        error: error ? { code: error.code ?? 'chat_failed', status: error.statusCode ?? error.status ?? null,
          retryable: error.retryable === true } : null,
        provider_ref: providerRecords.at(-1)?.ref ?? null,
        provider_refs: providerRecords.map(item => item.ref),
      };
      record.record_hash = digest(record);
      persistence.insert(CHATS, `${captureId}:${record.index}`, record);
      persistence.put(SESSIONS, captureId, { ...session, chat_count: record.index + 1,
        coverage: 'canonical_world_with_service_chat' });
      return record;
    },
    /** Store deterministic provider fixtures separately from operation
     * journals. This namespace is exported only into the private replay tape
     * and is excluded from canonical namespace digests. */
    recordProviderResult(resultRef = null) {
      if (!initialized) fail('replay_capture_not_initialized');
      const context = operationStorage.getStore();
      if (!context) fail('operation_context_required');
      const ref = resultRef === null || resultRef === undefined ? null : copy(resultRef);
      const kind = providerFixtureKind(ref);
      const record = {
        schema: 'deskbot.replay-provider-result.v1', capture_id: captureId,
        operation_id: context.operation_id, kind, ref, recorded_at: now().toISOString(),
      };
      record.record_hash = digest(record);
      const session = persistence.get(SESSIONS, captureId);
      const providerKey = `${captureId}:${context.operation_id}:${kind}`;
      const existed = persistence.get(PROVIDERS, providerKey) !== null;
      persistence.put(PROVIDERS, providerKey, record);
      // A chat can record both an LLM result and a TTS result. Key by phase so
      // the later TTS status cannot hide the LLM fixture needed for replay.
      persistence.put(SESSIONS, captureId, { ...session, provider_count: existed ? (session.provider_count ?? 0) : (session.provider_count ?? 0) + 1 });
      // A fixture may contain private deterministic output needed by a local
      // replay. Keep that payload in the provider registry, while exposing
      // only the attested reference in operation journals.
      const publicRef = ref && typeof ref === 'object' ? { ...ref } : ref;
      if (publicRef && typeof publicRef === 'object') delete publicRef.fixture;
      context.result_ref = publicRef;
      return publicRef;
    },
    getOperationResultRef() {
      return operationStorage.getStore()?.result_ref ?? null;
    },
  };
  return api;
}

/** Local export can run while the source service lives. A read transaction
 * freezes its session plus operation prefix without mutating the source DB. */
export function exportCanonicalReplayCapture({ databasePath, directory, codeFingerprint = replayCodeFingerprint() } = {}) {
  const archive = resolve(directory), captureId = `capture:${digest(archive).slice(0, 24)}`;
  const database = new DatabaseSync(resolve(databasePath), { readOnly: true });
  let session, operations, ingresses, chats, providers, journals, namespace_digests;
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
    chats = [...database.prepare('SELECT payload_json FROM records WHERE namespace=? ORDER BY rowid ASC').iterate(CHATS)]
      .map(row => JSON.parse(row.payload_json)).filter(chat => chat.capture_id === captureId);
    providers = [...database.prepare('SELECT payload_json FROM records WHERE namespace=? ORDER BY rowid ASC').iterate(PROVIDERS)]
      .map(row => JSON.parse(row.payload_json)).filter(provider => provider.capture_id === captureId);
    journals = [...database.prepare('SELECT payload_json FROM records WHERE namespace=? ORDER BY rowid ASC').iterate(JOURNAL)]
      .map(row => JSON.parse(row.payload_json)).filter(journal => journal.capture_id === captureId);
    const grouped = new Map();
    for (const row of database.prepare('SELECT namespace,record_id,payload_json FROM records ORDER BY rowid ASC').iterate()) {
      if (row.namespace.startsWith('replay.capture-')) continue;
      const hash = grouped.get(row.namespace) ?? { count: 0, hash: createHash('sha256') };
      hash.count++; hash.hash.update(digest({ record_id: row.record_id, payload: JSON.parse(row.payload_json) })).update('\0');
      grouped.set(row.namespace, hash);
    }
    namespace_digests = Object.fromEntries([...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([namespace, record]) => [namespace, { count: record.count, digest: record.hash.digest('hex') }]));
    if (session.journal_state_digest && digest(namespace_digests) !== session.journal_state_digest) {
      fail('replay_capture_gap_detected');
    }
    database.exec('COMMIT');
  } finally { database.close(); }
  if (replayFileDigest(join(archive, 'seed.sqlite')) !== session.seed_file_hash) fail('replay_capture_seed_mismatch');
  const portableSession = { ...session, namespace_digests }; delete portableSession.source_database; delete portableSession.archive_directory;
  const tape = { schema: CAPTURE_SCHEMA, rule_version: CAPTURE_RULES, session: portableSession, operations, ingresses,
    chats, providers, journals };
  validateArchive(tape, codeFingerprint);
  writeFileSync(join(archive, 'capture.json'), `${JSON.stringify(tape)}\n`, { mode: 0o600 });
  return { directory: archive, operation_count: operations.length, journal_count: journals.length,
    final_revision: session.final_revision, coverage: session.coverage };
}

function validateArchive(tape, codeFingerprint) {
  if (tape?.schema !== CAPTURE_SCHEMA || tape.rule_version !== CAPTURE_RULES) fail('replay_capture_schema_mismatch');
  validateSession(tape.session, codeFingerprint);
  if (!Array.isArray(tape.operations) || tape.operations.length !== tape.session.operation_count) fail('replay_capture_incomplete');
  if (!Array.isArray(tape.ingresses)) fail('replay_capture_ingress_missing');
  if (tape.ingresses.length !== (tape.session.ingress_count ?? 0)) fail('replay_capture_ingress_incomplete');
  if (!Array.isArray(tape.chats)) tape.chats = [];
  if (tape.chats.length !== (tape.session.chat_count ?? 0)) fail('replay_capture_chat_incomplete');
  if (!Array.isArray(tape.providers)) tape.providers = [];
  if (tape.providers.length !== (tape.session.provider_count ?? 0)) fail('replay_provider_fixture_missing');
  if (!Array.isArray(tape.journals)) fail('replay_capture_journal_missing');
  if (tape.journals.length !== (tape.session.journal_count ?? 0)) fail('replay_capture_journal_incomplete');
  for (const [index, journal] of tape.journals.entries()) {
    const { record_hash: hash, ...content } = journal;
    if (journal.schema !== 'deskbot.service-operation.v1' || journal.capture_id !== tape.session.capture_id
      || journal.index !== index || !journal.transaction_id || !journal.operation_id
      || !journal.operation_kind || !journal.source
      || (journal.request_hash !== null && typeof journal.request_hash !== 'string')
      || !Number.isFinite(Date.parse(journal.observed_at)) || !Array.isArray(journal.writes)
      || digest(content) !== hash) fail('replay_capture_journal_corrupt');
  }
  for (const [index, chat] of tape.chats.entries()) {
    const { record_hash: hash, ...content } = chat;
    if (chat.schema !== 'deskbot.replay-capture-chat.v1' || chat.capture_id !== tape.session.capture_id
      || chat.index !== index || !chat.event_id || !chat.event || !Number.isFinite(Date.parse(chat.received_at))
      || !['success', 'error'].includes(chat.status) || !Number.isSafeInteger(chat.operation_start)
      || !Number.isSafeInteger(chat.operation_end) || chat.operation_start < 0
      || chat.operation_end < chat.operation_start || chat.operation_end > tape.operations.length
      || digest(content) !== hash) fail('replay_capture_chat_corrupt');
  }
  for (const provider of tape.providers) {
    const { record_hash: providerHash, ...providerContent } = provider;
    if (provider.schema !== 'deskbot.replay-provider-result.v1' || provider.capture_id !== tape.session.capture_id
      || !provider.operation_id || !provider.kind || !Object.hasOwn(provider, 'ref') || !Number.isFinite(Date.parse(provider.recorded_at))
      || !providerHash || digest(providerContent) !== providerHash) fail('replay_capture_provider_corrupt');
  }
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

/**
 * Build deterministic provider adapters for a trusted local service replay.
 * The adapters never call a network provider. They consume only the private
 * fixture registry exported in capture.json and fail closed when a fixture is
 * missing, malformed, or does not match the requested phase.
 */
export function createReplayChatProviders({ tape, onFixtureCall = null } = {}) {
  if (!tape || !Array.isArray(tape.providers)) fail('replay_provider_registry_missing');
  const records = tape.providers.map(record => {
    const { record_hash: providerHash, ...providerContent } = record;
    if (recordHashInvalid(record, providerHash, providerContent)) fail('replay_capture_provider_corrupt');
    return record;
  });
  let fixtureCalls = 0;
  const find = (event, kind) => {
    const operationId = `chat:${String(event?.event_id ?? '').trim()}`;
    if (operationId === 'chat:') fail('replay_provider_event_id_required');
    const record = records.find(item => item.operation_id === operationId && item.kind === kind);
    if (!record) fail(`replay_provider_fixture_missing:${operationId}:${kind}`);
    const ref = record.ref;
    if (!ref || typeof ref !== 'object') fail(`replay_provider_fixture_invalid:${operationId}:${kind}`);
    fixtureCalls++;
    onFixtureCall?.({ operation_id: operationId, kind });
    return ref;
  };
  const errorFrom = (ref, fallback) => Object.assign(new Error(ref.error_message ?? fallback), {
    code: ref.error_code ?? fallback,
    retryable: ref.retryable === true,
  });
  const resolve = async ({ event, kind, request } = {}) => {
    const ref = find(event, kind);
    if (ref.status === 'error') throw errorFrom(ref, `replay_${kind}_fixture_error`);
    if (kind === 'llm') {
      if (ref.fixture?.kind !== 'llm.complete.v1' || typeof ref.fixture.text !== 'string') {
        fail(`replay_provider_fixture_invalid:${ref.provider ?? 'unknown'}:llm`);
      }
      return { provider: ref.provider ?? 'replay-fixture', model: ref.model ?? 'replay-fixture', text: ref.fixture.text };
    }
    if (kind === 'tts') {
      if (ref.tts?.status === 'error') throw errorFrom(ref.tts, 'replay_tts_fixture_error');
      const fixture = ref.fixture;
      if (fixture?.kind !== 'tts.synthesize.v1' || !fixture.audio) fail(`replay_provider_fixture_invalid:${ref.provider ?? 'unknown'}:tts`);
      return fixture.audio;
    }
    fail(`replay_provider_kind_unsupported:${kind}`);
  };
  return {
    resolve,
    voiceForEvent: event => records.some(item => item.operation_id === `chat:${String(event?.event_id ?? '').trim()}` && item.kind === 'tts'),
    providerCalls: () => 0,
    fixtureCalls: () => fixtureCalls,
    llm: { id: 'deskbot-replay-fixture', status: () => ({ configured: true, mode: 'replay', provider: 'fixture' }) },
    request: request => resolve(request),
  };
}

function recordHashInvalid(record, providerHash, providerContent) {
  return record.schema !== 'deskbot.replay-provider-result.v1'
    || !record.capture_id || !record.operation_id || !record.kind
    || !Object.hasOwn(record, 'ref') || !Number.isFinite(Date.parse(record.recorded_at))
    || !providerHash || digest(providerContent) !== providerHash;
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
  const records = [
    ...tape.ingresses.map(item => ({ kind: 'ingress', item })),
    ...tape.chats.map(item => ({ kind: 'chat', item })),
  ].sort((a, b) => (a.item.operation_start - b.item.operation_start)
    || String(a.item.received_at).localeCompare(String(b.item.received_at))
    || (a.item.index - b.item.index));
  validateChatProviderCoverage(tape);
  const replayProviders = tape.chats.length ? createReplayChatProviders({ tape }) : null;
  if (restartAt !== null && (!Number.isSafeInteger(restartAt) || restartAt < 0 || restartAt > records.length)) fail('replay_restart_range_invalid');
  mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(archive, 'seed.sqlite'), target);
   let runtime = null, persistence = null, time = tape.session.started_at, nextOperation = 0, startupPending = false;
  const open = async (receivedAt) => {
    if (runtime?.close) await runtime.close(); else persistence?.close();
     time = receivedAt;
     persistence = createSqlitePersistence({ filename: target, now: () => new Date(time) });
    runtime = await runtimeFactory({ persistence, tape, replayProviders, now: () => new Date(time), mode: 'replay' });
    if (!runtime?.ingestNonChatEvent && !runtime?.chat && !runtime?.handleChat) fail('replay_runtime_ingress_missing');
    startupPending = typeof runtime.replayStartup === 'function';
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
    for (const [index, record] of records.entries()) {
       const item = record.item;
       replayStandaloneOperations(item.operation_start);
       time = item.received_at;
      if (restartAt === index) await open(item.received_at);
      // Canonical startup commits (such as the real-time anchor) precede the
      // source listen hook's derived-state bootstrap. A caller-owned isolated
      // runtime can reproduce that bootstrap only after those commits replay.
      // It must not listen, start workers or call external providers.
      if (startupPending) {
        await runtime.replayStartup();
        startupPending = false;
      }
      let result;
      if (record.kind === 'chat') {
        const chat = runtime.chat ?? runtime.handleChat;
        if (typeof chat !== 'function') fail('replay_runtime_chat_missing');
        if (item.status === 'error') {
          try {
            await chat(copy(item.event), copy(item), { tape });
            fail(`replay_service_chat_error_missing:${index}`);
          } catch (error) {
            if (error?.code !== item.error?.code) fail(`replay_service_chat_error_mismatch:${index}`);
            result = { error };
          }
        } else {
          result = await chat(copy(item.event), copy(item), { tape });
        }
        if (chatResultDigest(result) !== item.result_digest) fail(`replay_service_chat_result_mismatch:${index}`);
      } else {
        result = await runtime.ingestNonChatEvent(copy(item.event), copy(item.adapter));
        if (Boolean(result?.duplicate) !== item.duplicate) fail(`replay_service_duplicate_mismatch:${index}`);
        if (ingressResultDigest(result) !== item.result_digest) fail(`replay_service_ingress_result_mismatch:${index}`);
      }
       nextOperation = item.operation_end;
       if (world()?.get && nextOperation && digest(world().get()) !== tape.operations[nextOperation - 1].world_hash) {
         fail(`replay_service_ingress_world_mismatch:${index}`);
       }
    }
     replayStandaloneOperations(tape.operations.length);
     if (restartAt === records.length) await open(time);
    if (startupPending) await runtime.replayStartup();
    const actual = namespaceDigests(persistence);
    const expected = tape.session.namespace_digests ?? null;
     if (!expected || digest(actual) !== digest(expected)) {
       const namespaces = [...new Set([...Object.keys(actual), ...Object.keys(expected ?? {})])]
         .filter(namespace => digest(actual[namespace] ?? null) !== digest(expected?.[namespace] ?? null));
       throw Object.assign(new Error('replay_service_namespace_mismatch'), { code: 'replay_service_namespace_mismatch', namespaces, actual, expected });
     }
    const providerCalls = typeof runtime?.providerCalls === 'function'
      ? runtime.providerCalls()
      : Number.isSafeInteger(runtime?.provider_calls) ? runtime.provider_calls : (tape.chats.length ? null : 0);
    if (tape.chats.length && providerCalls !== 0) fail('replay_service_provider_called');
    if (tape.chats.length && providerCalls === null) fail('replay_runtime_provider_counter_missing');
    return { schema: 'deskbot.service-replay-result.v1', coverage: 'service_ingress_namespaces_verified', ingresses: tape.ingresses.length,
      chats: tape.chats.length,
      namespace_digests: actual, provider_calls: providerCalls ?? 0, verified: true, target_database: target, restart_at: restartAt };
  } finally { if (runtime?.close) await runtime.close(); else persistence?.close(); }
}

function validateChatProviderCoverage(tape) {
  if (!tape.chats.length) return;
  const byOperation = new Map();
  for (const record of tape.providers) {
    const list = byOperation.get(record.operation_id) ?? [];
    list.push(record);
    byOperation.set(record.operation_id, list);
  }
  for (const chat of tape.chats) {
    const operationId = `chat:${chat.event_id}`;
    const fixtures = byOperation.get(operationId) ?? [];
    const llm = fixtures.find(item => item.kind === 'llm');
    if (!llm) fail(`replay_provider_fixture_missing:${operationId}:llm`);
    const tts = fixtures.find(item => item.kind === 'tts');
    if (tts?.ref?.tts?.status === 'success'
      && (tts.ref.fixture?.kind !== 'tts.synthesize.v1' || !tts.ref.fixture.audio)) {
      fail(`replay_provider_fixture_invalid:${operationId}:tts`);
    }
  }
}
