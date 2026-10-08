import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLifeFeed, fetchPersistentLifeFeed } from "../src/deskbot/lifeFeed.ts";

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
    expect(result?.[0]).toEqual({ id: "m1", at: "2026-10-08T03:00:00.000Z", kind: "world", title: "灯亮了", text: "集市重新亮起。" });
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
});
