import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLifeFeed, createRefreshGenerationGate, fetchPersistentLifeFeed, readPersistentLifeFeed } from "../src/deskbot/lifeFeed.ts";

const map = {
  world_id: "world", world_revision: 8, protagonist: { character_id: "shaping-001", location_id: "desk" },
  npcs: [{ npc_id: "npc-1", display_name: "巡路员" }], locations: [],
  autonomy: { recent: [{ at: "2026-10-08T01:00:00.000Z", actor_id: "npc-1", kind: "plan_completed", text: "把路标重新摆好了。" }] },
} as any;
const life = {
  world_revision: 8,
  recent_scenes: [{ scene_id: "old", started_at: "2026-10-08T00:00:00.000Z", title: "旧路醒了一下", narration: "潮线退开。", location_id: "road" }],
  current_scene: { scene_id: "now", started_at: "2026-10-08T02:00:00.000Z", title: "檐下的光", narration: "光粒把今天留在桌边。", location_id: "desk" },
  recent_experiences: [],
} as any;

describe("persistent shared-life feed", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("derives a restart-safe fallback only from persisted scenes and NPC records", () => {
    const result = buildLifeFeed(map, life);
    expect(result.map(value => value.id)).toEqual(["scene:now", "npc:2026-10-08T01:00:00.000Z:npc-1:plan_completed:", "scene:old"]);
    expect(result[0]?.text).toBe("光粒把今天留在桌边。");
  });

  it("reads the canonical feed and strips provenance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      schema: "deskbot.world-life-feed-response.v1", world_id: "world", world_revision: 9,
      entries: [{ id: "m1", at: "2026-10-08T03:00:00.000Z", kind: "world", title: "灯亮了", text: "集市重新亮起。", provenance: { sequence: 42 } }],
    }), { status: 200 })));
    const result = await fetchPersistentLifeFeed("http://local");
    expect(result?.[0]).toEqual({ id: "m1", at: "2026-10-08T03:00:00.000Z", kind: "world", title: "灯亮了", text: "集市重新亮起。", sequence: 42 });
    expect(fetch).toHaveBeenCalledWith("http://local/api/life/world/feed?limit=12", {cache:"no-store"});
  });

  it("keeps old services compatible without manufacturing task outcomes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", {status:404})));
    expect(await fetchPersistentLifeFeed("http://local")).toBe(null);
    const snapshot = structuredClone(map);
    snapshot.tasks = [{task_id:"unfinished",title:"新汤还在试做",status:"running",actor_id:"shaping-001",started_at:"2026-10-08T04:00:00.000Z"}];
    expect(buildLifeFeed(snapshot,life).some(value=>value.id.includes("unfinished"))).toBe(false);
  });

  it("preserves server result timestamps, validates entries and uses newest-first order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schema:"deskbot.world-life-feed-response.v1",entries:[
      {id:"start",at:"2026-10-08T01:00:00.000Z",title:"开始试汤",text:"备好了材料。",kind:"task_started"},
      {id:"done",at:"2026-10-08T01:05:00.000Z",title:"试汤完成",text:"喵呜收好了这次结果。",kind:"task_completed",actor_id:"shaping-001",actor_name:"喵呜",location_id:"kitchen",provenance:{event_id:"private"}},
      {id:"invalid",at:"unknown",title:"未知",text:"不可展示"},
    ]}),{status:200})));
    const result=await fetchPersistentLifeFeed("http://local/",1);
    expect(result).toEqual([{id:"done",at:"2026-10-08T01:05:00.000Z",title:"试汤完成",text:"喵呜收好了这次结果。",kind:"task_completed",actorId:"shaping-001",actorName:"喵呜",locationId:"kitchen"}]);
  });

  it("uses canonical mutation sequence when replayed events share a timestamp", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({schema:"deskbot.world-life-feed-response.v1",entries:[
      {id:"seq-7",at:"2026-10-08T01:00:00.000Z",title:"后写入",text:"第二个提交",provenance:{sequence:7}},
      {id:"seq-8",at:"2026-10-08T01:00:00.000Z",title:"最新提交",text:"第三个提交",provenance:{sequence:8}},
      {id:"seq-6",at:"2026-10-08T01:00:00.000Z",title:"先写入",text:"第一个提交",provenance:{sequence:6}},
    ]}),{status:200})));
    const result=await fetchPersistentLifeFeed("http://local");
    expect(result?.map(value => value.id)).toEqual(["seq-8","seq-7","seq-6"]);
  });

  it('retains order inside a shared commit even when names and timestamps sort differently', () => {
    const result = readPersistentLifeFeed({ schema: 'deskbot.world-life-feed-response.v1', entries: [
      { id: 'z-first', at: '2026-10-12T09:00:00Z', title: '先落地', text: '已开始', provenance: { sequence: 50, item_index: 0 } },
      { id: 'a-second', at: '2026-10-12T08:00:00Z', title: '后落地', text: '已开始', provenance: { sequence: 50, item_index: 1 } },
    ] });
    expect(result?.map(item => item.id)).toEqual(['a-second', 'z-first']);
    expect(result?.map(item => item.itemIndex)).toEqual([1, 0]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}

describe("read-model refresh generation", () => {
  it("publishes a complete batch only from the latest concurrent refresh", async () => {
    const gate = createRefreshGenerationGate();
    const old = deferred<{map:number;life:number;feed:string;wishes:string;message:string}>();
    const latest = deferred<{map:number;life:number;feed:string;wishes:string;message:string}>();
    const publications: unknown[] = [];
    const failed = vi.fn();
    const first = gate.run(async commit => { const value = await old.promise; commit(() => publications.push(value)); }, failed);
    const second = gate.run(async commit => { const value = await latest.promise; commit(() => publications.push(value)); }, failed);
    const newer = {map:12,life:12,feed:"new deed",wishes:"new idea",message:"updated"};
    latest.resolve(newer);
    await second;
    old.resolve({map:11,life:11,feed:"old deed",wishes:"old idea",message:"old status"});
    await first;
    expect(publications).toEqual([newer]);
    expect(failed).not.toHaveBeenCalled();
  });

  it("does not publish an old failure after a newer refresh succeeded", async () => {
    const gate = createRefreshGenerationGate();
    const old = deferred<number>();
    const published = vi.fn();
    const failed = vi.fn();
    const first = gate.run(async commit => { const value = await old.promise; commit(() => published(value)); }, failed);
    await gate.run(async commit => { commit(() => published(2)); }, failed);
    old.reject(new Error("connection from old generation failed"));
    await first;
    expect(published).toHaveBeenCalledExactlyOnceWith(2);
    expect(failed).not.toHaveBeenCalled();
  });

  it("invalidates old StrictMode setup and accepts only the reopened lifecycle", async () => {
    const gate = createRefreshGenerationGate();
    const firstSetup = deferred<number>();
    const published = vi.fn();
    const failed = vi.fn();
    gate.activate();
    const old = gate.run(async commit => { const value = await firstSetup.promise; commit(() => published(value)); }, failed);
    gate.invalidate();
    gate.activate();
    await gate.run(async commit => { commit(() => published(3)); }, failed);
    firstSetup.resolve(1);
    await old;
    expect(published).toHaveBeenCalledExactlyOnceWith(3);
  });

  it("unmount and service URL replacement stop old read-model writes", async () => {
    const oldUrl = createRefreshGenerationGate();
    const pending = deferred<number>();
    const published = vi.fn();
    const failed = vi.fn();
    const old = oldUrl.run(async commit => { const value = await pending.promise; commit(() => published(value)); }, failed);
    oldUrl.invalidate();
    const newUrl = createRefreshGenerationGate();
    await newUrl.run(async commit => { commit(() => published(4)); }, failed);
    pending.resolve(1);
    await old;
    expect(published).toHaveBeenCalledExactlyOnceWith(4);
    await oldUrl.run(async commit => { commit(() => published(5)); }, failed);
    expect(published).toHaveBeenCalledTimes(1);
  });
});
