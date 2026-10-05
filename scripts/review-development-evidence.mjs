import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPersistentWorld } from '../apps/deskbot-service/src/persistent-world.mjs';
import { installAutonomy } from '../apps/deskbot-service/src/life-state.mjs';
import { installRefraction } from '../apps/deskbot-service/src/input-refraction.mjs';
import { installLivedMemory, memoryReadModel } from '../apps/deskbot-service/src/lived-memory.mjs';
import { developmentReadModel } from '../apps/deskbot-service/src/development-evidence.mjs';
import { createAutonomousLife } from '../apps/deskbot-service/src/autonomous-life.mjs';
import { createRoleEvolution } from '../apps/deskbot-service/src/role-evolution.mjs';
import { createRoleProposalStore } from '../apps/deskbot-service/src/role-proposals.mjs';
import { createInputStore } from '../apps/deskbot-service/src/input-store.mjs';
import { computeFantasyPull } from '../apps/deskbot-service/src/fantasy-pull.mjs';

// No installed database, credentials or model calls are used. The clock is
// controlled only in this separate sample; production keeps real Shanghai time.
const BASE = Date.parse('2026-10-05T04:00:00Z');
export const DEVELOPMENT_REVIEW_PHASES = ['suggestion', 'executing', 'completed', 'failed', 'restart'];
export function memoryPersistence() {
  let records = new Map();
  const key = (namespace, id) => `${namespace}\0${id}`;
  return {
    get: (namespace, id) => structuredClone(records.get(key(namespace, id)) ?? null),
    list: namespace => [...records].filter(([k]) => k.startsWith(`${namespace}\0`)).map(([, v]) => structuredClone(v)),
    put: (namespace, id, value) => { records.set(key(namespace, id), structuredClone(value)); },
    insert: (namespace, id, value) => {
      if (records.has(key(namespace, id))) throw new Error('duplicate_review_record');
      records.set(key(namespace, id), structuredClone(value));
    },
    transaction: operation => { const before = structuredClone(records); try { return operation(); } catch (error) { records = before; throw error; } },
  };
}
export function createDevelopmentSample(phase = 'completed') {
  if (!DEVELOPMENT_REVIEW_PHASES.includes(phase)) throw new Error('unknown_review_phase');
  const persistence = memoryPersistence();
  let time = BASE;
  const now = () => new Date(time);
  let world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
  const initial = world.get();
  installAutonomy(initial, now().toISOString());
  installRefraction(initial, now().toISOString());
  initial.protagonist.location_id = 'moss-sprout-garden';
  initial.living.objects['garden-bed'].moisture = .55;
  initial.living.objects['garden-bed'].health = .9;
  initial.living.objects['garden-bed'].growth = .2;
  initial.living.objects['seedling-rack'].stock.trays = 2;
  for (const state of Object.values(initial.autonomy.actors)) state.paused = state.actor_id !== 'shaping-001';
  installLivedMemory(initial, now().toISOString(), { plannerEnabled: false });
  persistence.put('canonical-world.states', initial.world_id, initial);
  world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
  const suggestion = { event_id: 'development-review-owner-idea', type: 'user.preference.life', character_id: 'shaping-001',
    source: 'review-user', occurred_at: now().toISOString(), payload: { suggestion: 'tend' } };
  world.ingest(suggestion, { attestedKind: 'user', sourceLabel: '隔离样本的主人建议' });
  let taskId = null;
  if (phase !== 'suggestion') {
    createAutonomousLife({ world, now, enabled: true }).tick();
    const selected = world.get().tasks.find(task => task.activity_id === 'tend-bed');
    assert.ok(selected, 'A real authored activity must start through the normal life loop.');
    taskId = selected.task_id;
    if (['completed', 'failed', 'restart'].includes(phase)) {
      if (phase === 'failed') {
        // Model a crop removed before completion, then use ordinary deadline
        // validation. We do not write a failed task or development record.
        const changed = world.get(); changed.living.objects['garden-bed'].quantity = 0;
        persistence.put('canonical-world.states', changed.world_id, changed);
        world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
      }
      time = Date.parse(selected.due_at);
      world.syncWallClock(); world.syncTasks();
    }
  }
  const before = developmentReadModel(world.get());
  let restartVerified = false;
  if (phase === 'restart') {
    const stable = world.get();
    world = createPersistentWorld({ persistence, now, timeMode: 'realtime' });
    assert.deepEqual(world.get(), stable);
    const replay = world.ingest(suggestion, { attestedKind: 'user', sourceLabel: '隔离样本的主人建议' });
    assert.equal(replay.duplicate, true);
    world.syncTasks();
    assert.deepEqual(developmentReadModel(world.get()), before);
    restartVerified = true;
  }
  const inputStore = createInputStore({ now, persistence });
  const roles = createRoleProposalStore({ now, persistence });
  const evolution = createRoleEvolution({ now, persistence, inputStore, roles, computeFantasyPull, worldSnapshot: () => world.get() });
  return { world, evolution, proof: { simulated: true, phase, now: now().toISOString(), task_id: taskId,
    decision_policy: 'bounded_rules_v1', live_world_untouched: true, restart_verified: restartVerified,
    suggestion_creates_practice: false, input_store_event_count: inputStore.list({ limit: 200 }).length } };
}
function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' });
  response.end(status === 204 ? undefined : JSON.stringify(value));
}
export async function createDevelopmentReviewServer({ port = 4314 } = {}) {
  let sample = createDevelopmentSample();
  const snapshot = () => ({ ...sample.proof, memory: memoryReadModel(sample.world.get()), evolution: sample.evolution.snapshot({ characterId: 'shaping-001' }) });
  const server = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') { json(response, 204, null); return; }
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      if (request.method === 'POST' && url.pathname === '/api/life/development/review') {
        let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1024) throw new Error('review_body_too_large'); }
        sample = createDevelopmentSample(JSON.parse(body).phase); json(response, 200, snapshot()); return;
      }
      if (request.method !== 'GET') { json(response, 405, { error: 'review_read_only' }); return; }
      if (url.pathname === '/api/life/development/review') { json(response, 200, snapshot()); return; }
      if (url.pathname === '/api/life/development') { json(response, 200, developmentReadModel(sample.world.get())); return; }
      if (url.pathname === '/api/life/memory') { json(response, 200, memoryReadModel(sample.world.get())); return; }
      if (url.pathname === '/api/roles/evolution') { json(response, 200, sample.evolution.snapshot({ characterId: 'shaping-001' })); return; }
      json(response, 404, { error: 'review_route_not_found' });
    } catch { json(response, 400, { error: 'invalid_review_request', simulated: true }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}
async function main() {
  if (process.argv.includes('--smoke')) {
    for (const phase of DEVELOPMENT_REVIEW_PHASES) {
      const sample = createDevelopmentSample(phase);
      const data = developmentReadModel(sample.world.get());
      assert.equal(data.counts.practice, ['suggestion', 'executing'].includes(phase) ? 0 : 1);
      if (phase === 'failed') assert.equal(data.counts.failed, 1);
      console.log(`Development review ${phase}: ${data.counts.practice} unique actual practice outcomes.`);
    }
    return;
  }
  const fixture = await createDevelopmentReviewServer({ port: Number(process.env.DESKBOT_DEVELOPMENT_REVIEW_PORT ?? 4314) });
  console.log(`Isolated development review at ${fixture.baseUrl}; controlled clock, bounded rules, memory only.`);
  process.once('SIGINT', async () => { await fixture.close(); process.exit(0); });
  process.once('SIGTERM', async () => { await fixture.close(); process.exit(0); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
