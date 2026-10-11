import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createSqlitePersistence } from './persistence.mjs';
import { cognitionRoot, digest, fail, validateContract } from './cognition-contracts.mjs';
import { createCognitionBridge } from './cognition-bridge.mjs';
import { createCognitionBroker } from './cognition-broker.mjs';

const fixture = JSON.parse(readFileSync(join(cognitionRoot, 'fixture.json'), 'utf8'));
const provenance = JSON.parse(readFileSync(join(cognitionRoot, 'vendor/manifest.json'), 'utf8'));
export const STAGE1_SCHEMA = 'deskbot.cognition.stage1.v1';
const defaultFilename = resolve(cognitionRoot, '../../apps/deskbot-service/data/cognition-stage1.sqlite');
const iso = now => now().toISOString();

// Backup and migration are confined to the lab database. No canonical-world migration.
export function prepareCognitionDatabase(filename) {
  const absolute = resolve(filename); mkdirSync(dirname(absolute), { recursive: true });
  if (!existsSync(absolute)) return null;
  const database = new DatabaseSync(absolute);
  try {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if (!tables.some(t => t.name === 'records')) fail('unsupported_lab_save');
    const rows = database.prepare("SELECT namespace FROM records GROUP BY namespace").all();
    const allowed = new Set(['meta', 'actors', 'objects', 'runs', 'requests', 'memories', 'indexes', 'calls']);
    if (rows.some(r => !allowed.has(r.namespace))) fail('not_a_lab_save', '认知实验数据库不能使用正式人生数据库。');
    const record = database.prepare("SELECT payload_json FROM records WHERE namespace='meta' AND record_id='schema'").get();
    const version = record && JSON.parse(record.payload_json).version;
    if (version === STAGE1_SCHEMA) return null;
    if (version !== 'deskbot.cognition.stage1.v0') fail('unsupported_lab_save');
    const backup = join(dirname(absolute), 'cognition-stage1-backups', `${randomUUID()}.sqlite`);
    mkdirSync(dirname(backup), { recursive: true });
    database.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    const copy = new DatabaseSync(backup, { readOnly: true });
    try { if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') fail('backup_integrity_failed'); }
    finally { copy.close(); }
    return backup;
  } finally { database.close(); }
}

export function validateAdoption(context, proposal, { actor, objects, now = () => new Date() }) {
  validateContract('context', context); validateContract('proposal', proposal);
  if (proposal.actor_id !== context.actor_id || proposal.request_id !== context.request_id || proposal.context_digest !== context.context_digest) fail('session_mismatch');
  if (Date.parse(context.expires_at) < now().getTime()) fail('context_expired');
  if (proposal.expected_actor_version !== context.actor_version || actor.version !== context.actor_version) fail('actor_version_changed');
  if (Date.parse(proposal.generated_at) < Date.parse(context.created_at) || Date.parse(proposal.generated_at) > now().getTime() + 60000) fail('invalid_proposal_time');
  const target = context.known_objects.find(o => o.object_id === proposal.intent.object_id);
  if (!target || !context.allowed_primitives.includes(proposal.intent.primitive)) fail('unknown_action_target');
  const object = objects.find(o => o.object_id === target.object_id);
  if (!object || proposal.intent.expected_object_version !== target.version || object.version !== target.version || digest(object.state) !== digest(target.state)) fail('object_version_changed');
  if (!proposal.source_event_ids.length || new Set(proposal.source_event_ids).size !== proposal.source_event_ids.length || proposal.source_event_ids.some(id => !context.visible_events.some(e => e.event_id === id))) fail('invisible_source');
  return object;
}

export function validateMemory(context, proposal, result, memory) {
  validateContract('result', result); validateContract('memory-commit', memory);
  for (const value of [result, memory]) if (value.request_id !== context.request_id || value.actor_id !== context.actor_id) fail('memory_session_mismatch');
  if (memory.result_id !== result.result_id || memory.root_id !== result.root_id || memory.memory_id !== `${context.request_id}:memory` || memory.memory_group_id !== `${context.actor_id}:${result.root_id}`) fail('memory_root_mismatch');
  if (memory.interpretation !== proposal.interpretation || memory.recorded_at !== result.occurred_at) fail('memory_interpretation_mismatch');
  const expected = `隔离样例中观察 ${result.object_id}：水分 ${result.observed_state.moisture}，蓄光 ${result.observed_state.light}。`;
  if (memory.facts.length !== 1 || memory.facts[0] !== expected) fail('invented_memory_fact');
  return memory;
}

export function createCognitionStage1({ filename = defaultFilename, now = () => new Date(), bridge: configuredBridge, beforeCommit = () => {}, maxCalls = 60 } = {}) {
  const backup = prepareCognitionDatabase(filename);
  const store = createSqlitePersistence({ filename, now });
  store.transaction(() => {
    for (const person of fixture.actors) if (!store.get('actors', person.actor_id)) store.put('actors', person.actor_id, { ...person, version: 0, cognition_sequence: 0, interpretation: null, adopted_role: null, practice: 0 });
    for (const binding of fixture.bindings) if (!store.get('objects', binding.object_id)) store.put('objects', binding.object_id, { ...binding, version: 0, state: { moisture: .72, light: .38 } });
    const previous = store.get('meta', 'schema');
    store.put('meta', 'schema', { ...previous, version: STAGE1_SCHEMA, scope: 'isolated_mock', migrated_at: previous?.migrated_at ?? iso(now), backup: backup ?? previous?.backup ?? null });
    for (const request of store.list('requests')) if (['thinking', 'proposal', 'result'].includes(request.status)) store.put('requests', request.request_id, { ...request, status: 'interrupted', error_code: 'process_interrupted', retry_policy: 'manual_new_request_only' });
    for (const run of store.list('runs')) if (run.status === 'running') store.put('runs', run.run_id, { ...run, status: 'interrupted', finished_at: iso(now) });
  });
  const broker = createCognitionBroker({ store, now, maxCalls });
  let bridge = configuredBridge, closed = false, closing;
  const running = new Map();
  function getBridge() { bridge ??= createCognitionBridge(); return bridge; }
  function buildContext(actorId, runId) {
    const actor = store.get('actors', actorId); if (!actor) fail('unknown_actor');
    const at = iso(now), root = `${runId}:event`;
    const publicEvent = { event_id: `${root}:public`, root_id: root, source: 'lab.synthetic', visibility: 'public', text: '【工程样例】苗圃雨后凝光苔比昨天暗。尚不知道原因，大家可以先观察。', occurred_at: at };
    const privateEvent = { event_id: `${root}:private:${actorId}`, root_id: root, source: 'lab.synthetic', visibility: 'actor_private', text: '【私人样例】我记得上一批苗在通风不足时变暗；这次也未必是同一个原因。', occurred_at: at };
    const context = { schema: 'deskbot.cognition.context.v1', scope: 'isolated_mock', request_id: `${runId}:${actorId}`, actor_id: actorId, context_digest: 'pending', actor_version: actor.version, cognition_sequence: actor.cognition_sequence + 1,
      created_at: at, expires_at: new Date(now().getTime() + 120000).toISOString(), identity: { name: actor.name, role: actor.role, traits: actor.traits, values: actor.values, hard_constraints: actor.hard_constraints }, location_id: fixture.location_id,
      known_objects: store.list('objects').map(({ object_id, name, version, state }) => ({ object_id, name, version, state })),
      visible_events: actorId === 'wetland-grower-001' ? [publicEvent, privateEvent] : [publicEvent],
      memories: store.list('memories').filter(m => m.actor_id === actorId && Array.isArray(m.facts) && typeof m.interpretation === 'string').slice(-6).map(m => ({ memory_id: m.memory_id, text: [...m.facts, m.interpretation].join(' '), root_id: m.root_id })), allowed_primitives: ['observe'] };
    context.context_digest = digest({ ...context, context_digest: null });
    return validateContract('context', context);
  }
  function mockReply(context) {
    const choices = {
      'shaping-001': ['我还不知道它为何变暗，想先把观察和猜想分开。', '先观察苗床的水分和蓄光，再考虑比较条件。'],
      'wetland-grower-001': ['我想到通风的旧事，但还不能据此判断这次原因。', '观察育苗架，留下可供后续比较的记录。'],
      'lamp-keeper-001': ['我关注蓄光是否影响晚间照明，需要先看苗床现状。', '观察苗床，确认蓄光记录，暂不调整灯光。'],
    };
    const [interpretation, goal] = choices[context.actor_id];
    return JSON.stringify({ interpretation, goal, object_index: context.known_objects.findIndex(o => o.object_id === (context.actor_id === 'wetland-grower-001' ? 'seedling-rack' : 'garden-bed')) + 1,
      event_indices: context.visible_events.map((_, i) => i + 1) });
  }
  async function handleActor(context) {
    const id = context.request_id;
    store.insert('requests', id, { request_id: id, actor_id: context.actor_id, status: 'thinking', context, started_at: iso(now) });
    try {
      const proposal = await getBridge().session({ type: 'context', context }, frame => broker.complete({ callId: `${id}:model`, payload: frame, execute: () => mockReply(context) }));
      validateContract('proposal', proposal);
      store.put('requests', id, { ...store.get('requests', id), status: 'proposal', proposal });
      const object = validateAdoption(context, proposal, { actor: store.get('actors', context.actor_id), objects: store.list('objects'), now });
      const result = validateContract('result', { schema: 'deskbot.cognition.result.v1', scope: 'isolated_mock', request_id: id, actor_id: context.actor_id, result_id: `${id}:result`, root_id: context.visible_events[0].root_id, status: 'completed', primitive: 'observe', object_id: object.object_id, observed_state: structuredClone(object.state), occurred_at: iso(now), execution_mode: 'isolated_sample', practice_delta: 0 });
      store.put('requests', id, { ...store.get('requests', id), status: 'result', result });
      const memory = await getBridge().session({ type: 'result', context, proposal, result });
      validateMemory(context, proposal, result, memory);
      await beforeCommit({ context, proposal, result, memory, store });
      if (closed) fail('lab_closed');
      store.transaction(() => {
        validateAdoption(context, proposal, { actor: store.get('actors', context.actor_id), objects: store.list('objects'), now });
        if (store.get('memories', memory.memory_id)) fail('memory_already_committed');
        const actor = store.get('actors', context.actor_id);
        store.insert('memories', memory.memory_id, memory);
        store.put('actors', actor.actor_id, { ...actor, version: actor.version + 1, cognition_sequence: context.cognition_sequence, interpretation: proposal.interpretation, goal: proposal.goal });
        store.put('requests', id, { ...store.get('requests', id), status: 'adopted_isolated', memory, adopted_at: iso(now), formal_world_changed: false });
      });
      // This is a derived, non-semantic demo index, not the memory authority.
      try {
        const embedding = await broker.embed({ callId: `${id}:embedding`, text: [...memory.facts, memory.interpretation].join('\n') });
        store.put('indexes', memory.memory_id, { memory_id: memory.memory_id, actor_id: memory.actor_id, ...embedding });
      } catch (error) { store.put('requests', id, { ...store.get('requests', id), index_error: error.code ?? 'index_failed' }); }
    } catch (error) {
      if (!closed) store.put('requests', id, { ...store.get('requests', id), status: 'rejected', error_code: error.code ?? 'bridge_failed', error: error.message, finished_at: iso(now) });
    }
    return store.get('requests', id);
  }
  async function run({ run_id = randomUUID() } = {}) {
    if (closed) fail('lab_closed');
    if (typeof run_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(run_id)) fail('invalid_run_id');
    if (running.has(run_id)) return running.get(run_id);
    const existing = store.get('runs', run_id); if (existing) return existing;
    if (running.size) fail('lab_busy');
    if (store.list('runs').length >= 64) fail('lab_archive_full');
    store.insert('runs', run_id, { run_id, status: 'running', started_at: iso(now), scenario: 'rain-dim-moss', scope: 'isolated_mock' });
    const operation = (async () => {
      try {
        const contexts = fixture.actors.map(a => buildContext(a.actor_id, run_id));
        const requests = await Promise.all(contexts.map(handleActor));
        const record = { ...store.get('runs', run_id), status: requests.every(r => r.status === 'adopted_isolated') ? 'completed' : 'partially_rejected', finished_at: iso(now), requests: requests.map(r => r.request_id) };
        store.put('runs', run_id, record); return record;
      } finally { running.delete(run_id); }
    })();
    running.set(run_id, operation); return operation;
  }
  async function rebuildIndex() {
    if (running.size) fail('lab_busy');
    const memories = store.list('memories').filter(m => Array.isArray(m.facts) && typeof m.interpretation === 'string');
    const generation = randomUUID();
    const replacements = [];
    for (const memory of memories) {
      const embedding = await broker.embed({ callId: `rebuild:${generation}:${memory.memory_id}`, text: [...memory.facts, memory.interpretation].join('\n') });
      replacements.push({ memory_id: memory.memory_id, actor_id: memory.actor_id, ...embedding });
    }
    store.transaction(() => { for (const old of store.list('indexes')) store.remove('indexes', old.memory_id); for (const item of replacements) store.put('indexes', item.memory_id, item); });
    return { rebuilt: replacements.length, raw_memory_count: store.list('memories').length, semantic: false };
  }
  function status() {
    return { schema: STAGE1_SCHEMA, scope: 'isolated_mock', runtime: bridge?.status() ?? { transport: 'stdio_ndjson', active_sessions: 0, state: 'starts_on_demand' }, upstream: { repository: provenance.repository, commit: provenance.commit, license: provenance.license, invoked: provenance.invoked, files: provenance.files.length },
      fixture, actors: store.list('actors'), objects: store.list('objects'), runs: store.list('runs'), requests: store.list('requests'), memories: store.list('memories'), index_count: store.list('indexes').length, broker: broker.status(),
      boundary: { canonical_world_writable: false, world_execution: 'isolated_sample', memory_authority: 'node_sqlite_raw', semantic_retrieval: false, full_cognitive_loop: false, role_and_practice_updates: false }, backup: store.get('meta', 'schema').backup };
  }
  function close() {
    if (closing) return closing;
    closed = true; bridge?.close();
    closing = (async () => {
      // Workers are killed before awaiting the outstanding jobs. They cannot commit afterwards.
      await Promise.allSettled([...running.values()]);
      broker.close(); store.close();
    })();
    return closing;
  }
  return { run, status, rebuildIndex, close, buildContext, store };
}
