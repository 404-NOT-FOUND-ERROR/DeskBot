import { afterEach, describe, expect, it, vi } from "vitest";
import { acceptWorldSnapshot, createWorldSnapshotRenderGate, WorldObserverClient, type WorldObserverSnapshot } from "../src/deskbot/worldObserver.ts";

const snap = (revision: number, sequence: number, id = `${revision}-${sequence}`): WorldObserverSnapshot => ({
  schema: "deskbot.world-observer-snapshot.v1", world_id: "w", world_revision: revision, sequence,
  snapshot_id: id, captured_at: "2026-10-11T00:00:00.000Z", map: {world_revision:revision}, life: {world_revision:revision}, feed: {world_revision:revision}, role_wishes: {world_revision:revision},
});

describe("world observer revision gate", () => {
  it("accepts same revision with newer ledger sequence and rejects stale snapshots", () => {
    const current = snap(4, 8);
    expect(acceptWorldSnapshot(current, snap(4, 9))?.sequence).toBe(9);
    expect(acceptWorldSnapshot(current, snap(4, 7))).toBeNull();
    expect(acceptWorldSnapshot(current, snap(3, 99))).toBeNull();
    expect(acceptWorldSnapshot(current, snap(4, 8))).toBeNull();
  });

  it("never accepts another world's snapshot", () => {
    expect(acceptWorldSnapshot(snap(1, 1), { ...snap(2, 2), world_id: "other" })).toBeNull();
  });
  it("rejects mixed projections and backwards canonical sequence", () => {
    expect(acceptWorldSnapshot(null, { ...snap(2,2), life: { world_revision: 1 } })).toBeNull();
    expect(acceptWorldSnapshot(snap(2,3), snap(3,2))).toBeNull();
  });
  it('does not roll back same-ledger role projections captured earlier', () => {
    const current = {...snap(4,8,'new'), captured_at:'2026-10-11T01:00:00Z'};
    expect(acceptWorldSnapshot(current, snap(4,8,'old'))).toBeNull();
    expect(acceptWorldSnapshot(current, {...snap(4,8,'next'), captured_at:'2026-10-11T02:00:00Z'})).not.toBeNull();
    expect(acceptWorldSnapshot(null, {...snap(4,8),captured_at:'invalid'})).toBeNull();
  });
});

describe("world observer client", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("reads a bounded snapshot and does not roll back on repeated reads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(snap(2, 3)), { status: 200 })));
    const client = new WorldObserverClient("http://127.0.0.1:4311", { characterId: "shaping-001", feedLimit: 6 });
    expect((await client.read()).sequence).toBe(3);
    expect((await client.read()).sequence).toBe(3);
    expect(fetch).toHaveBeenLastCalledWith("http://127.0.0.1:4311/api/world/snapshot?character_id=shaping-001&feed_limit=6", expect.objectContaining({ cache: "no-store" }));
    vi.unstubAllGlobals();
  });

  it("does not silently return the previous world when a bound world changes", async () => {
    let body = snap(2, 3); body = { ...body, world_id: "a", map: { world_revision: 2 }, life: { world_revision: 2 }, feed: { world_revision: 2 }, role_wishes: { world_revision: 2 } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
    const client = new WorldObserverClient("http://local", { worldId: "a" });
    expect((await client.read()).world_id).toBe("a");
    body = { ...body, world_id: "b" };
    await expect(client.read({ worldId: "b" })).rejects.toThrow('绑定了另一世界');
    expect(client.snapshot?.world_id).toBe("a");
    client.close();
  });
  it("keeps a newer websocket frame when an older HTTP read finishes late", async () => {
    let finishRead!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finishRead = resolve; })));
    class FakeSocket extends EventTarget {
      readyState = 1;
      send() {} close() { this.readyState = 3; }
    }
    const client = new WorldObserverClient('http://local', { WebSocketImpl: FakeSocket as unknown as typeof WebSocket });
    const socket = client.connect();
    const read = client.read();
    socket.dispatchEvent(new MessageEvent('message', {data: JSON.stringify({schema:'deskbot.world-observer-message.v1',type:'world.update',snapshot:snap(5,7)})}));
    finishRead(new Response(JSON.stringify(snap(4,6)), {status:200}));
    expect((await read).sequence).toBe(7);
    expect(client.snapshot?.world_revision).toBe(5);
    client.close();
  });
  it('cancels pending HTTP reads when the observer is closed', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const client = new WorldObserverClient('http://local');
    const read = client.read();
    const rejected = expect(read).rejects.toMatchObject({name:'AbortError'});
    client.close();
    await rejected;
    await expect(client.read()).rejects.toThrow('已关闭');
  });
  it("reconnects, subscribes afresh and ignores messages from an old socket", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      static OPEN = 1; readyState = 1; sent: unknown[] = [];
      constructor(public url: string) { super(); sockets.push(this); }
      send(value: string) { this.sent.push(JSON.parse(value)); }
      close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
      message(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
    }
    const updates = vi.fn(), snapshots = vi.fn(), resumed = vi.fn();
    const client = new WorldObserverClient("http://local", { WebSocketImpl: FakeSocket as unknown as typeof WebSocket, reconnectDelayMs: 100 });
    client.connect({ onSnapshot: snapshots, onUpdate: updates, onResume: resumed });
    sockets[0]!.dispatchEvent(new Event("open"));
    expect(sockets[0]!.sent[0]).toMatchObject({ type: "world.subscribe" });
    const message = (value: WorldObserverSnapshot, type = "world.snapshot") => ({ schema: "deskbot.world-observer-message.v1", type, snapshot: value });
    sockets[0]!.message(message(snap(2,3)));
    sockets[0]!.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets.length).toBe(2);
    sockets[1]!.dispatchEvent(new Event("open"));
    expect(sockets[1]!.sent[0]).toMatchObject({ type: 'world.subscribe', after_sequence: 3, world_id: 'w' });
    const resume = { from_sequence: 3, to_sequence: 4, mode: 'snapshot', history_available: true };
    sockets[1]!.message({ ...message(snap(3,4)), resume });
    sockets[0]!.message(message(snap(99,99), "world.update"));
    sockets[1]!.message(message(snap(2,3), "world.update"));
    expect(client.snapshot?.sequence).toBe(4);
    expect(updates).not.toHaveBeenCalled();
    expect(snapshots).toHaveBeenCalledTimes(2);
    expect(resumed).toHaveBeenCalledExactlyOnceWith(resume);
    client.resync(); expect(sockets[1]!.sent.at(-1)).toEqual({ type: 'world.resync', after_sequence: 4 });
    client.close(); await vi.advanceTimersByTimeAsync(1_000); expect(sockets.length).toBe(2);
  });

  it("backs off across handshake-only reconnects until a valid snapshot arrives", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    class FakeSocket extends EventTarget {
      static OPEN = 1; readyState = 1;
      constructor(public url: string) { super(); sockets.push(this); }
      send() {} close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
    }
    const client = new WorldObserverClient("http://local", { WebSocketImpl: FakeSocket as unknown as typeof WebSocket, reconnectDelayMs: 100, maxReconnectDelayMs: 1_000 });
    client.connect(); sockets[0]!.dispatchEvent(new Event("open")); sockets[0]!.close();
    await vi.advanceTimersByTimeAsync(100); sockets[1]!.dispatchEvent(new Event("open")); sockets[1]!.close();
    await vi.advanceTimersByTimeAsync(199); expect(sockets.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1); expect(sockets.length).toBe(3);
    sockets[2]!.dispatchEvent(new Event("open")); sockets[2]!.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ schema: 'deskbot.world-observer-message.v1', type: 'world.snapshot', snapshot: snap(1, 1) }) })); sockets[2]!.close();
    await vi.advanceTimersByTimeAsync(100); expect(sockets.length).toBe(4);
    client.close();
  });
});

describe("world snapshot render gate", () => {
  it("publishes the whole projection once and waits for renderer completion", () => {
    const published: number[] = [];
    const gate = createWorldSnapshotRenderGate({ publish: snapshot => published.push(snapshot.sequence) });
    expect(gate.offer(snap(1,1))).toBe(true);
    expect(gate.offer(snap(2,2))).toBe(true);
    expect(gate.offer(snap(2,2))).toBe(false);
    expect(published).toEqual([1]);
    expect(gate.rendered("other")).toBe(false);
    expect(gate.rendered("1-1")).toBe(true);
    expect(published).toEqual([1,2]);
    gate.close(); expect(gate.rendered("2-2")).toBe(false);
    expect(gate.offer(snap(3,3))).toBe(false);
  });
  it("bounds queued snapshots and requests current state when rendering falls behind", () => {
    const published: number[] = [], resync = vi.fn();
    const gate = createWorldSnapshotRenderGate({ publish: value => published.push(value.sequence), maxPending: 2, onResync: resync });
    for (let sequence=1;sequence<=5;sequence+=1) gate.offer(snap(sequence,sequence));
    expect(gate.state().pending).toBe(2);
    expect(resync).toHaveBeenCalledTimes(1);
    gate.rendered("1-1"); expect(published).toEqual([1,4]);
    gate.rendered("4-4"); expect(published).toEqual([1,4,5]);
  });

  it("recovers when a renderer rejects a frame", () => {
    const published: number[] = [], errors: Error[] = [], resync = vi.fn();
    const gate = createWorldSnapshotRenderGate({ publish: value => { published.push(value.sequence); if (value.sequence === 1) throw new Error('renderer failed'); }, onError: error => errors.push(error), onResync: resync });
    expect(gate.offer(snap(1, 1))).toBe(true);
    expect(gate.state().rendering).toBe(null);
    expect(gate.rendered("1-1")).toBe(false);
    expect(gate.offer(snap(2, 2))).toBe(true);
    expect(errors).toHaveLength(1); expect(resync).toHaveBeenCalled();
    expect(gate.state().rendering).toBe("2-2");
    expect(gate.rendered("2-2")).toBe(true);
    expect(gate.state().rendering).toBe(null); expect(gate.state().pending).toBe(0);
    expect(published).toEqual([1, 2]);
  });
});
