export const WORLD_OBSERVER_SCHEMA = "deskbot.world-observer-snapshot.v1" as const;
export const WORLD_OBSERVER_MESSAGE_SCHEMA = "deskbot.world-observer-message.v1" as const;
export const WORLD_STREAM_PROTOCOL = "deskbot.world-stream.v1" as const;

export interface WorldObserverSnapshot {
  schema: typeof WORLD_OBSERVER_SCHEMA;
  world_id: string;
  world_revision: number;
  sequence: number;
  snapshot_id: string;
  captured_at: string;
  map: unknown;
  life: unknown;
  feed: unknown;
  role_wishes: unknown;
}

export interface WorldObserverMutation {
  mutation_id: string;
  sequence: number;
  action: string;
  before_revision: number;
  after_revision: number;
  committed_at: string;
}

export interface WorldObserverMessage {
  schema: typeof WORLD_OBSERVER_MESSAGE_SCHEMA;
  type: "world.snapshot" | "world.update" | "world.error";
  world_id?: string;
  world_revision?: number;
  sequence?: number;
  snapshot?: WorldObserverSnapshot;
  mutation?: WorldObserverMutation;
  code?: string;
  message?: string;
  resume?: WorldObserverResume;
}

export interface WorldObserverResume {
  from_sequence: number;
  to_sequence: number;
  mode: 'snapshot';
  history_available: boolean;
}

export interface WorldObserverReadOptions {
  worldId?: string;
  characterId?: string;
  feedLimit?: number;
  signal?: AbortSignal;
}

export interface WorldObserverClientOptions extends WorldObserverReadOptions {
  WebSocketImpl?: typeof WebSocket;
  reconnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
}

export interface WorldObserverHandlers {
  onSnapshot?: (snapshot: WorldObserverSnapshot) => void;
  onUpdate?: (message: WorldObserverMessage, snapshot: WorldObserverSnapshot) => void;
  onError?: (error: Error) => void;
  onState?: (state: "connecting" | "open" | "closed") => void;
  onResume?: (resume: WorldObserverResume) => void;
}

function observerUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function isSnapshot(value: unknown): value is WorldObserverSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorldObserverSnapshot>;
  return item.schema === WORLD_OBSERVER_SCHEMA && typeof item.world_id === "string" && item.world_id.length > 0
    && Number.isSafeInteger(item.world_revision) && Number.isSafeInteger(item.sequence)
    && item.world_revision! >= 0 && item.sequence! >= 0 && typeof item.snapshot_id === "string" && item.snapshot_id.trim().length > 0
    && typeof item.captured_at === 'string' && Number.isFinite(Date.parse(item.captured_at))
    && [item.map, item.life, item.feed, item.role_wishes].every(projection => projection === null
      || Boolean(projection) && typeof projection === "object"
        && (projection as { world_revision?: number }).world_revision === item.world_revision);
}

/**
 * Canonical revision/sequence gate shared by HTTP refresh and the live stream.
 * A same-revision snapshot with a newer ledger sequence is valid; an older
 * sequence can never roll the rendered world backwards.
 */
export function acceptWorldSnapshot(current: WorldObserverSnapshot | null, next: unknown): WorldObserverSnapshot | null {
  if (!isSnapshot(next)) return null;
  if (!current) return next;
  if (next.world_id !== current.world_id) return null;
  if (next.world_revision < current.world_revision) return null;
  if (next.sequence < current.sequence) return null;
  if (next.world_revision === current.world_revision && next.sequence === current.sequence
    && next.snapshot_id === current.snapshot_id) return null;
  // Role wishes may change without a canonical world mutation. For those
  // same-ledger read projections, a late HTTP response must not undo the more
  // recently captured panel state delivered by the stream.
  if (next.world_revision === current.world_revision && next.sequence === current.sequence
    && Date.parse(next.captured_at) < Date.parse(current.captured_at)) return null;
  return next;
}

export class WorldObserverClient {
  private readonly root: string;
  private readonly options: WorldObserverClientOptions;
  private readonly WebSocketImpl?: typeof WebSocket;
  private socket: WebSocket | null = null;
  private current: WorldObserverSnapshot | null = null;
  private generation = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private disposed = false;
  private reads = new Set<AbortController>();
  private boundWorldId: string | null;

  constructor(baseUrl: string, options: WorldObserverClientOptions = {}) {
    this.root = baseUrl;
    this.options = options;
    this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket;
    this.boundWorldId = options.worldId ?? null;
  }

  get snapshot(): WorldObserverSnapshot | null { return this.current; }

  async read(options: WorldObserverReadOptions = {}): Promise<WorldObserverSnapshot> {
    if (this.disposed) throw new Error('世界观察连接已关闭');
    const generation = this.generation;
    const params = new URLSearchParams();
    const worldId = options.worldId ?? this.options.worldId;
    if (worldId && this.boundWorldId && worldId !== this.boundWorldId) {
      throw new Error('世界观察连接绑定了另一世界，请为新世界建立独立连接');
    }
    if (worldId) this.boundWorldId = worldId;
    const characterId = options.characterId ?? this.options.characterId;
    const feedLimit = options.feedLimit ?? this.options.feedLimit;
    if (worldId) params.set("world_id", worldId);
    if (characterId) params.set("character_id", characterId);
    if (feedLimit !== undefined) params.set("feed_limit", String(feedLimit));
    const controller = new AbortController();
    this.reads.add(controller);
    const cancel = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) cancel();
    else options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetch(`${observerUrl(this.root, "/api/world/snapshot")}?${params}`, {
        cache: "no-store", signal: controller.signal,
      });
      const body = await response.json() as unknown;
      if (!response.ok || !isSnapshot(body)) throw new Error((body as { message?: string })?.message ?? "无法读取世界快照");
      if (this.boundWorldId && body.world_id !== this.boundWorldId) throw new Error('返回的世界与观察连接不匹配');
      this.boundWorldId ??= body.world_id;
      const accepted = acceptWorldSnapshot(this.current, body);
      if (accepted && generation === this.generation && !this.disposed) this.current = accepted;
      return this.current ?? body;
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      this.reads.delete(controller);
    }
  }

  connect(handlers: WorldObserverHandlers = {}): WebSocket {
    this.close();
    this.disposed = false;
    this.reconnectAttempts = 0;
    return this.open(handlers);
  }

  private open(handlers: WorldObserverHandlers): WebSocket {
    if (!this.WebSocketImpl) throw new Error("当前浏览器不支持世界实时连接");
    const generation = ++this.generation;
    handlers.onState?.("connecting");
    const url = observerUrl(this.root, "/api/world/stream").replace(/^http/, "ws");
    const socket = new this.WebSocketImpl(url);
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (generation !== this.generation || this.disposed) return;
      handlers.onState?.("open");
      socket.send(JSON.stringify({ schema: WORLD_STREAM_PROTOCOL, type: "world.subscribe",
        ...(this.boundWorldId ? { world_id: this.boundWorldId } : {}),
        ...(this.current ? { after_sequence: this.current.sequence } : {}),
        ...(this.options.characterId ? { character_id: this.options.characterId } : {}),
        ...(this.options.feedLimit === undefined ? {} : { feed_limit: this.options.feedLimit }) }));
    });
    socket.addEventListener("message", event => {
      if (generation !== this.generation || this.disposed) return;
      let body: WorldObserverMessage;
      try { body = JSON.parse(String(event.data)) as WorldObserverMessage; }
      catch { handlers.onError?.(new Error("世界流消息不是有效 JSON")); return; }
      if (body.schema !== WORLD_OBSERVER_MESSAGE_SCHEMA || !["world.snapshot", "world.update", "world.error"].includes(body.type)) return;
      if (body.type === "world.error") { handlers.onError?.(new Error(body.message ?? body.code ?? "世界流失败")); return; }
      if (!isSnapshot(body.snapshot) || this.boundWorldId && body.snapshot.world_id !== this.boundWorldId) return;
      this.boundWorldId ??= body.snapshot.world_id;
      // A TCP handshake alone does not prove a working subscription. Reset
      // backoff only after receiving a valid snapshot, including a duplicate.
      this.reconnectAttempts = 0;
      if (body.resume?.mode === 'snapshot' && Number.isSafeInteger(body.resume.from_sequence) && body.resume.from_sequence >= 0
        && body.resume.to_sequence === body.snapshot.sequence && body.resume.to_sequence >= body.resume.from_sequence
        && typeof body.resume.history_available === 'boolean') handlers.onResume?.(body.resume);
      const accepted = acceptWorldSnapshot(this.current, body.snapshot);
      if (!accepted) return;
      this.current = accepted;
      if (body.type === "world.snapshot") handlers.onSnapshot?.(accepted);
      else handlers.onUpdate?.(body, accepted);
    });
    socket.addEventListener("error", () => { if (generation === this.generation && !this.disposed) handlers.onError?.(new Error("世界流连接失败")); });
    socket.addEventListener("close", () => {
      if (generation !== this.generation || this.disposed) return;
      this.socket = null; handlers.onState?.("closed");
      if (this.options.reconnect === false) return;
      const initialDelay = Math.max(100, this.options.reconnectDelayMs ?? 500);
      const delay = Math.min(this.options.maxReconnectDelayMs ?? 15_000, initialDelay * 2 ** Math.min(this.reconnectAttempts++, 8));
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.disposed && generation === this.generation) this.open(handlers);
      }, delay);
    });
    return socket;
  }

  resync(): void { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: "world.resync", ...(this.current ? { after_sequence: this.current.sequence } : {}) })); }
  close(): void {
    this.disposed = true; this.generation += 1;
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const controller of this.reads) controller.abort();
    this.reads.clear();
    if (this.socket) { const socket = this.socket; this.socket = null; socket.close(); }
  }
}

/**
 * Holds the next complete snapshot until the renderer confirms the current
 * snapshot. The map, NPC panel and story feed publish together. A bounded
 * overflow retains the newest complete state and asks transport for resync.
 */
export function createWorldSnapshotRenderGate({
  publish, maxPending = 8, onResync = () => {}, onError = () => {},
}: { publish: (snapshot: WorldObserverSnapshot) => void; maxPending?: number; onResync?: () => void; onError?: (error: Error) => void }) {
  let latest: WorldObserverSnapshot | null = null;
  let rendering: WorldObserverSnapshot | null = null;
  let pending: WorldObserverSnapshot[] = [];
  let closed = false;
  function next() {
    if (closed || rendering || !pending.length) return;
    while (!closed && !rendering && pending.length) {
      rendering = pending.shift()!;
      try { publish(rendering); }
      catch (error) {
        if (latest === rendering) latest = null;
        rendering = null;
        onError(error instanceof Error ? error : new Error('世界快照未能呈现'));
        onResync();
      }
    }
  }
  return {
    offer(snapshot: WorldObserverSnapshot): boolean {
      if (closed) return false;
      const accepted = acceptWorldSnapshot(latest, snapshot);
      if (!accepted) return false;
      latest = accepted; pending.push(accepted);
      if (pending.length > Math.max(1, maxPending)) { pending = [accepted]; onResync(); }
      next(); return true;
    },
    rendered(snapshotId: string): boolean {
      if (closed || rendering?.snapshot_id !== snapshotId) return false;
      rendering = null; next(); return true;
    },
    close() { closed = true; pending = []; rendering = null; },
    state: () => ({ rendering: rendering?.snapshot_id ?? null, pending: pending.length, latest_sequence: latest?.sequence ?? null }),
  };
}
