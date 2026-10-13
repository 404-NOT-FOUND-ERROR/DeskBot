import { createHash } from 'node:crypto';
import { getWorldMap } from './persistent-world.mjs';

export const WORLD_OBSERVER_SCHEMA = 'deskbot.world-observer-snapshot.v1';
export const WORLD_OBSERVER_MESSAGE_SCHEMA = 'deskbot.world-observer-message.v1';
export const WORLD_STREAM_PROTOCOL = 'deskbot.world-stream.v1';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_PATH = '/api/world/stream';
const DEFAULT_HTTP_PATH = '/api/world/snapshot';
const MAX_CONTROL_BYTES = 256 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES = 512 * 1024;
const DEFAULT_MAX_QUEUE_ITEMS = 32;
const DEFAULT_FEED_LIMIT = 20;
const DEFAULT_MAX_SUBSCRIBERS = 32;
const CURRENT_TASK_STATUSES = new Set(['running', 'paused']);
const CURRENT_COMMITMENT_STATUSES = new Set(['proposed', 'accepted', 'meeting', 'working']);
const PENDING_INPUT_STATUSES = new Set(['pending', 'deferred', 'chosen']);

const clone = value => value === undefined ? undefined : structuredClone(value);
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function validUpgrade(request) {
  const upgrade = String(request.headers?.upgrade ?? '').toLowerCase();
  const connection = String(request.headers?.connection ?? '').toLowerCase();
  const key = request.headers?.['sec-websocket-key'];
  return upgrade === 'websocket'
    && connection.split(',').map(value => value.trim()).includes('upgrade')
    && typeof key === 'string' && Buffer.from(key, 'base64').length === 16
    && String(request.headers?.['sec-websocket-version'] ?? '') === '13';
}

function acceptKey(key) {
  return createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

function httpError(socket, status, reason) {
  if (socket.destroyed) return;
  const body = `${status} ${reason}\n`;
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,OPTIONS',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function boundedInt(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function observerMapProjection(map) {
  if (!map) return map;
  const projected = clone(map);
  // The map/stream describe what exists now. Completed task and decision
  // history is available through the canonical feed and dedicated read APIs.
  if (Array.isArray(projected.tasks)) {
    projected.tasks = projected.tasks.filter(task => CURRENT_TASK_STATUSES.has(task.status))
      .map(({ history, ...task }) => task);
  }
  if (projected.memory?.planner) {
    projected.memory.planner.requests = (projected.memory.planner.requests ?? [])
      .map(({ actor_id, status }) => ({ actor_id, status }));
    delete projected.memory.planner.recent;
  }
  if (projected.memory) {
    projected.memory.own = projected.memory.own?.slice(0, 12) ?? [];
    const perActor = new Map();
    if (projected.memory.development?.recent) {
      projected.memory.development.recent = projected.memory.development.recent.filter(record => {
        const actors = record.actor_ids ?? [];
        if (!actors.some(id => (perActor.get(id) ?? 0) < 4)) return false;
        for (const id of actors) perActor.set(id, (perActor.get(id) ?? 0) + 1);
        return true;
      });
    }
    if (Array.isArray(projected.memory.development?.facets?.actors)) {
      // These empty topics are already hidden by the life panel. Their long
      // authored explanations are not history or current evidence; sending
      // all of them for every resident crowds out the actual recent facts.
      projected.memory.development.facets.actors = projected.memory.development.facets.actors.map(actor => ({
        ...actor,
        topics: (actor.topics ?? []).filter(topic => !(topic.contact?.count === 0
          && topic.interest?.status === 'unobserved'
          && topic.capability?.status === 'unobserved'
          && topic.self_assessment?.status === 'unobserved')),
      }));
    }
  }
  if (projected.autonomy) {
    delete projected.autonomy.cadence;
    const displayFeedback = feedback => {
      if (!feedback) return feedback;
      const { action_feedback, ...display } = feedback;
      return display;
    };
    projected.autonomy.actors = (projected.autonomy.actors ?? []).map(({ last_candidates, cooldowns, ...actor }) => ({
      ...actor,
      ...(actor.last_feedback ? { last_feedback: displayFeedback(actor.last_feedback) } : {}),
    }));
    if (Array.isArray(projected.autonomy.recent)) projected.autonomy.recent = projected.autonomy.recent.map(displayFeedback);
  }
  if (projected.social) {
    delete projected.social.residents;
    delete projected.social.cooldowns;
    projected.social.commitments = (projected.social.commitments ?? [])
      .filter(commitment => CURRENT_COMMITMENT_STATUSES.has(commitment.status));
  }
  if (projected.refraction?.records) {
    const records = projected.refraction.records;
    const retained = new Set(records.slice(-8).map(record => record.id));
    for (const record of records) if (PENDING_INPUT_STATUSES.has(record.status)) retained.add(record.id);
    for (const kind of ['weather', 'sourced_report', 'environment_reference']) {
      const latest = records.findLast(record => record.category === kind || record.meaning === kind);
      if (latest) retained.add(latest.id);
    }
    projected.refraction.records = records.filter(record => retained.has(record.id));
  }
  if (Array.isArray(projected.npcs)) {
    projected.npcs = projected.npcs.map(({ recent_interactions, last_interaction, last_response, ...npc }) => npc);
  }
  return projected;
}

/**
 * Read-only observer over the canonical world. It deliberately receives a
 * snapshot builder rather than a mutator; clients can never submit a world
 * mutation through this module.
 */
export function createWorldObserver({
  persistentWorld,
  worldLife = null,
  mapReadModel = null,
  roleWishes = null,
  now = () => new Date(),
  worldId = null,
  path = DEFAULT_PATH,
  httpPath = DEFAULT_HTTP_PATH,
  maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  maxQueueItems = DEFAULT_MAX_QUEUE_ITEMS,
  maxSubscribers = DEFAULT_MAX_SUBSCRIBERS,
  heartbeatMs = 15_000,
  slowTimeoutMs = 30_000,
  subscribeTimeoutMs = 10_000,
  feedLimit = DEFAULT_FEED_LIMIT,
} = {}) {
  if (!persistentWorld || typeof persistentWorld.get !== 'function'
    || typeof persistentWorld.listMutations !== 'function'
    || typeof persistentWorld.listLifeFeed !== 'function'
    || typeof persistentWorld.subscribeMutations !== 'function') {
    throw new TypeError('world observer needs a persistentWorld with read and mutation subscription methods');
  }
  if (typeof mapReadModel !== 'function' && mapReadModel !== null) throw new TypeError('mapReadModel must be a function');
  if (typeof roleWishes !== 'function' && roleWishes !== null) throw new TypeError('roleWishes must be a function');
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1024 || maxPayloadBytes > 8 * 1024 * 1024) throw new TypeError('maxPayloadBytes must be 1024 to 8388608');
  if (!Number.isSafeInteger(maxQueueItems) || maxQueueItems < 1 || maxQueueItems > 256) throw new TypeError('maxQueueItems must be 1 to 256');
  if (!Number.isSafeInteger(maxSubscribers) || maxSubscribers < 1 || maxSubscribers > 256) throw new TypeError('maxSubscribers must be 1 to 256');
  for (const [name, value] of Object.entries({ heartbeatMs, slowTimeoutMs, subscribeTimeoutMs })) {
    if (!Number.isSafeInteger(value) || value < 10 || value > 300_000) throw new TypeError(`${name} must be 10 to 300000`);
  }

  const peers = new Set();
  let attachedServer = null;
  let upgradeHandler = null;
  let unsubscribe = null;
  let closed = false;

  function resolveWorld(requested = null) {
    const id = text(requested) ?? worldId ?? undefined;
    const world = persistentWorld.get(id);
    if (!world) {
      const error = new Error(`world ${id ?? 'default'} does not exist`);
      error.code = 'world_not_found';
      error.statusCode = 404;
      throw error;
    }
    return world;
  }

  function buildSnapshot({ requestedWorldId = null, characterId = null, requestedFeedLimit = feedLimit } = {}) {
    const resolvedId = text(requestedWorldId) ?? worldId ?? undefined;
    const read = typeof persistentWorld.readSnapshot === 'function'
      ? persistentWorld.readSnapshot({ worldId: resolvedId, feedLimit: boundedInt(requestedFeedLimit, feedLimit, 1, 200) })
      : null;
    const world = read?.world ?? resolveWorld(resolvedId);
    // Every read below is derived from this one immutable clone. No projection
    // is allowed to call ingest or advance a clock.
    const revision = Number.isInteger(world.world_revision) ? world.world_revision : 0;
    let sequence = read?.sequence;
    // Compatibility for test/external adapters predating readSnapshot: walk
    // the bounded ledger pages, never mistake its first page for its tail.
    if (!Number.isSafeInteger(sequence)) {
      sequence = 0;
      while (true) {
        const records = persistentWorld.listMutations({ worldId: world.world_id, afterSequence: sequence, limit: 200 });
        const next = records.reduce((highest, item) => Math.max(highest, item.sequence ?? 0), sequence);
        if (next === sequence) break;
        sequence = next;
        if (records.length < 200) break;
      }
    }
    const map = mapReadModel ? mapReadModel(clone(world), { characterId: characterId ?? world.protagonist?.character_id })
      : getWorldMap(clone(world), { characterId: characterId ?? world.protagonist?.character_id });
    const life = worldLife?.snapshot
      ? worldLife.snapshot(clone(world))
      : null;
    const rawFeed = read?.feed ?? persistentWorld.listLifeFeed({ worldId: world.world_id, limit: boundedInt(requestedFeedLimit, feedLimit, 1, 200) });
    const feed = {
      schema: 'deskbot.world-life-feed-response.v1',
      world_id: world.world_id,
      world_revision: revision,
      head_sequence: sequence,
      current_sequence: sequence,
      entries: clone(rawFeed),
      cursor: read?.feed_cursor ? clone(read.feed_cursor) : {
        before_id: rawFeed[0]?.id ?? null,
        after_id: rawFeed.at(-1)?.id ?? null,
        before_sequence: rawFeed[0]?.provenance?.sequence ?? null,
        after_sequence: rawFeed.at(-1)?.provenance?.sequence ?? null,
        has_more_before: rawFeed[0] ? persistentWorld.listLifeFeed({ worldId: world.world_id, beforeId: rawFeed[0].id, limit: 1 }).length > 0 : false,
        has_more_after: false,
      },
    };
    const wishes = roleWishes ? roleWishes(clone(world)) : null;
    if ((map && map.world_revision !== revision) || (life && life.world_revision !== revision)) {
      throw new Error('observer read projections must match the captured canonical world revision');
    }
    const snapshotCore = {
      schema: WORLD_OBSERVER_SCHEMA,
      world_id: world.world_id,
      world_revision: revision,
      sequence,
      captured_at: now().toISOString(),
      map: observerMapProjection(map),
      life: clone(life),
      feed,
      role_wishes: clone(wishes),
    };
    return {
      ...snapshotCore,
      snapshot_id: `world-snapshot:${world.world_id}:${revision}:${sequence}:${digest({ ...snapshotCore, captured_at: undefined }).slice(0, 16)}`,
    };
  }

  function mutationMessage(mutation, peer) {
    if (!mutation || mutation.world_id !== peer.worldId || mutation.applied === false) return null;
    const sequence = Number.isInteger(mutation.sequence) ? mutation.sequence : 0;
    if (sequence <= peer.lastSequence) return null;
    const world = resolveWorld(peer.worldId);
    const snapshot = buildSnapshot({ requestedWorldId: peer.worldId, characterId: peer.characterId, requestedFeedLimit: peer.feedLimit });
    // An update carries a complete read projection, keeping map/scene/feed/NPC
    // values on one canonical revision. Clients may safely discard stale seqs.
    if (snapshot.sequence < sequence) return null;
    return {
      schema: WORLD_OBSERVER_MESSAGE_SCHEMA,
      type: 'world.update',
      world_id: world.world_id,
      world_revision: snapshot.world_revision,
      sequence: snapshot.sequence,
      // The public stream does not forward the raw mutation diff, model
      // traces, provider payload or private device/user-profile audit fields.
      mutation: { mutation_id: mutation.mutation_id, sequence: mutation.sequence, action: mutation.action,
        before_revision: mutation.before_revision, after_revision: mutation.after_revision, committed_at: mutation.committed_at },
      snapshot,
    };
  }

  function onMutation(mutation) {
    if (closed) return;
    for (const peer of [...peers]) {
      if (!peer.subscribed || peer.closed || mutation.world_id !== peer.worldId) continue;
      try {
        const message = mutationMessage(mutation, peer);
        if (message) {
          peer.lastSequence = message.sequence;
          peer.enqueue(message);
        }
      } catch {
        peer.close(1011, 'observer projection failed');
      }
    }
  }

  unsubscribe = persistentWorld.subscribeMutations(onMutation);

  function subscribePeer(peer, payload = {}) {
    if (payload.schema !== WORLD_STREAM_PROTOCOL || payload.type !== 'world.subscribe') {
      peer.close(1008, 'world.subscribe is required');
      return;
    }
    const requestedId = text(payload.world_id) ?? worldId;
    let snapshot;
    try {
      snapshot = buildSnapshot({ requestedWorldId: requestedId, characterId: payload.character_id, requestedFeedLimit: payload.feed_limit });
      if (payload.after_sequence !== undefined && (!Number.isSafeInteger(payload.after_sequence) || payload.after_sequence < 0)) {
        const error = new Error('observer resume sequence must be a non-negative integer');
        error.code = 'invalid_observer_cursor'; error.statusCode = 400; throw error;
      }
      if (payload.after_sequence > snapshot.sequence) {
        const error = new Error('observer resume cursor is ahead of this world ledger');
        error.code = 'observer_cursor_ahead'; error.statusCode = 409; throw error;
      }
    } catch (error) {
      peer.send({ schema: WORLD_OBSERVER_MESSAGE_SCHEMA, type: 'world.error', code: error.code ?? 'world_not_found', message: error.message });
      peer.close(error.statusCode >= 400 && error.statusCode < 500 ? 1008 : 1011, error.message);
      return;
    }
    peer.worldId = snapshot.world_id;
    peer.characterId = text(payload.character_id) ?? snapshot.map?.protagonist?.character_id ?? null;
    peer.feedLimit = boundedInt(payload.feed_limit, feedLimit, 1, 200);
    peer.lastSequence = snapshot.sequence;
    peer.subscribed = true;
    clearTimeout(peer.subscribeTimer);
    peer.resetQueue?.();
    peer.send({ schema: WORLD_OBSERVER_MESSAGE_SCHEMA, type: 'world.snapshot', world_id: snapshot.world_id,
      world_revision: snapshot.world_revision, sequence: snapshot.sequence, snapshot,
      ...(payload.after_sequence !== undefined ? { resume: { from_sequence: payload.after_sequence,
        to_sequence: snapshot.sequence, mode: 'snapshot', history_available: payload.after_sequence < snapshot.sequence } } : {}) });
  }

  function handleText(peer, textPayload) {
    if (Buffer.byteLength(textPayload, 'utf8') > MAX_CONTROL_BYTES) return peer.close(1009, 'control message too large');
    let payload;
    try { payload = JSON.parse(textPayload); } catch { return peer.close(1003, 'control message must be JSON'); }
    if (payload?.type === 'world.resync') {
      if (!peer.subscribed) return peer.close(1008, 'subscribe first');
      return subscribePeer(peer, { schema: WORLD_STREAM_PROTOCOL, type: 'world.subscribe', world_id: peer.worldId,
        character_id: peer.characterId, feed_limit: peer.feedLimit, after_sequence: payload.after_sequence ?? peer.lastSequence });
    }
    return subscribePeer(peer, payload);
  }

  class Peer {
    constructor(socket) {
      this.socket = socket; this.buffer = Buffer.alloc(0); this.closed = false;
      this.subscribed = false; this.worldId = null; this.characterId = null; this.feedLimit = feedLimit;
      this.lastSequence = 0; this.queue = []; this.queueBytes = 0; this.writing = false;
      this.lastPongAt = Date.now(); this.slowTimer = null;
      this.onDrain = () => { clearTimeout(this.slowTimer); this.slowTimer = null; this.writing = false; this.flush(); };
      socket.on('data', chunk => this.consume(chunk));
      socket.on('error', () => this.close(1011, 'socket error'));
      socket.on('end', () => this.cleanup()); socket.on('close', () => this.cleanup());
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastPongAt > heartbeatMs * 3) return this.close(1001, 'observer heartbeat expired');
        this.writeFrame(9, Buffer.alloc(0));
      }, heartbeatMs); this.heartbeat.unref?.();
      this.subscribeTimer = setTimeout(() => { if (!this.subscribed) this.close(1008, 'world subscription timed out'); }, subscribeTimeoutMs);
      this.subscribeTimer.unref?.();
    }
    consume(chunk) {
      if (this.closed) return;
      this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
      try {
        while (true) {
          const frame = this.frame(); if (!frame) break;
          if (frame.opcode === 8) return this.close(1000, 'client closed');
          if (frame.opcode === 9) { this.writeFrame(10, frame.payload); continue; }
          if (frame.opcode === 1) handleText(this, frame.payload.toString('utf8'));
          else if (frame.opcode === 10) this.lastPongAt = Date.now();
          else this.close(1003, 'text protocol only');
          if (this.closed) break;
        }
      } catch { this.close(1002, 'invalid websocket frame'); }
    }
    frame() {
      if (this.buffer.length < 2) return null;
      const first = this.buffer[0], second = this.buffer[1], opcode = first & 0x0f, fin = (first & 0x80) !== 0;
      if (!fin || (first & 0x70) !== 0) throw new Error('unsupported websocket frame');
      let len = second & 0x7f, offset = 2;
      if ((second & 0x80) === 0) throw new Error('client frame must be masked');
      if (len === 126) { if (this.buffer.length < 4) return null; len = this.buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) {
        if (this.buffer.length < 10) return null;
        const high = this.buffer.readUInt32BE(2), low = this.buffer.readUInt32BE(6);
        if (high !== 0 || low > MAX_CONTROL_BYTES) throw new Error('control frame too large');
        len = low; offset = 10;
      }
      if (len > MAX_CONTROL_BYTES || (opcode >= 8 && len > 125)) throw new Error('control frame too large');
      if (this.buffer.length < offset + 4 + len) return null;
      const mask = this.buffer.subarray(offset, offset + 4); offset += 4;
      const payload = Buffer.from(this.buffer.subarray(offset, offset + len));
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      this.buffer = this.buffer.subarray(offset + len); return { opcode, payload };
    }
    send(value) {
      if (this.closed) return;
      const body = Buffer.from(JSON.stringify(value));
      if (body.length > maxPayloadBytes) return this.close(1009, 'observer payload too large');
      this.queue.push(body); this.queueBytes += body.length;
      if (this.queue.length > maxQueueItems || this.queueBytes > maxPayloadBytes * 2) return this.close(1013, 'observer subscriber is too slow');
      this.flush();
    }
    enqueue(value) { this.send(value); }
    resetQueue() { this.queue = []; this.queueBytes = 0; }
    flush() {
      if (this.closed || this.writing) return;
      const body = this.queue.shift(); if (!body) return;
      this.queueBytes -= body.length; this.writing = true;
      const ok = this.writeFrame(1, body);
      if (ok) { this.writing = false; this.flush(); }
      else {
        this.socket.once('drain', this.onDrain);
        this.slowTimer = setTimeout(() => this.close(1013, 'observer subscriber is too slow'), slowTimeoutMs);
        this.slowTimer.unref?.();
      }
    }
    writeFrame(opcode, payload) {
      if (this.closed || this.socket.destroyed) return false;
      const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? []);
      let header;
      if (body.length < 126) header = Buffer.from([0x80 | opcode, body.length]);
      else if (body.length <= 0xffff) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(body.length, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(body.length, 6); }
      return this.socket.write(Buffer.concat([header, body]));
    }
    close(code = 1000, reason = '') {
      if (this.closed) return;
      const bytes = Buffer.from(reason).subarray(0, 120), body = Buffer.alloc(2 + bytes.length);
      body.writeUInt16BE(code, 0); bytes.copy(body, 2);
      try { this.writeFrame(8, body); } catch { /* socket already closed */ }
      this.cleanup();
      this.socket.end();
      // end() may otherwise wait indefinitely for a stalled reader to drain.
      const destroyTimer = setTimeout(() => this.socket.destroy(), 100);
      destroyTimer.unref?.();
    }
    cleanup() {
      this.closed = true; peers.delete(this); clearInterval(this.heartbeat); clearTimeout(this.slowTimer);
      clearTimeout(this.subscribeTimer);
      this.socket.off('drain', this.onDrain); this.queue = []; this.queueBytes = 0;
    }
  }

  function handleUpgrade(request, socket, head = Buffer.alloc(0)) {
    let requestUrl;
    try { requestUrl = new URL(request.url ?? '/', 'http://localhost'); } catch { return false; }
    if (requestUrl.pathname !== path) return false;
    if (closed) { httpError(socket, 503, 'Service Unavailable'); return true; }
    if (peers.size >= maxSubscribers) { httpError(socket, 503, 'Service Unavailable'); return true; }
    if (!validUpgrade(request)) { httpError(socket, 400, 'Bad Request'); return true; }
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(request.headers['sec-websocket-key'])}`, '', ''].join('\r\n'));
    socket.setNoDelay?.(true);
    const peer = new Peer(socket); peers.add(peer);
    // The client must explicitly subscribe before a snapshot is emitted. This
    // keeps the stream read-only and makes reconnect intent unambiguous.
    if (head?.length) peer.consume(head); return true;
  }

  function handleHttp(request, response) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== httpPath) return false;
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,OPTIONS' }); response.end(); return true; }
    if (request.method !== 'GET') { sendJson(response, 405, { error: 'method_not_allowed' }); return true; }
    try {
      const snapshot = buildSnapshot({ requestedWorldId: url.searchParams.get('world_id'), characterId: url.searchParams.get('character_id'), requestedFeedLimit: url.searchParams.get('feed_limit') });
      const encoded = JSON.stringify(snapshot);
      if (Buffer.byteLength(encoded) > maxPayloadBytes) {
        sendJson(response, 413, { error: 'observer_payload_too_large', message: 'world observer snapshot exceeds the configured bound' });
      } else sendJson(response, 200, snapshot);
    } catch (error) { sendJson(response, error.statusCode ?? 500, { error: error.code ?? 'observer_error', message: error.message }); }
    return true;
  }

  function attach(server) {
    if (!server || typeof server.on !== 'function') throw new TypeError('an HTTP server is required');
    if (attachedServer) return observer;
    attachedServer = server; upgradeHandler = (request, socket, head) => { try { handleUpgrade(request, socket, head); } catch { httpError(socket, 400, 'Bad Request'); } };
    server.on('upgrade', upgradeHandler); return observer;
  }
  function close() {
    closed = true; unsubscribe?.(); unsubscribe = null; for (const peer of [...peers]) peer.close(1001, 'observer shutting down'); peers.clear();
    if (attachedServer && upgradeHandler) attachedServer.off('upgrade', upgradeHandler); attachedServer = null; upgradeHandler = null;
  }
  const observer = { buildSnapshot, handleUpgrade, handleHttp, attach, close, peers: () => [...peers].map(peer => ({ subscribed: peer.subscribed, world_id: peer.worldId, sequence: peer.lastSequence })) };
  return observer;
}

export function attachWorldObserver({ server, ...options } = {}) {
  const observer = createWorldObserver(options); observer.attach(server); return observer;
}

export { DEFAULT_PATH as WORLD_STREAM_PATH, DEFAULT_HTTP_PATH as WORLD_SNAPSHOT_PATH };
