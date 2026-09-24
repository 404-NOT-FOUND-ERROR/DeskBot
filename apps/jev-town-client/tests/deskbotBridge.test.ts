import { describe, expect, it } from "vitest";
import { buildNpcCandidates, validateCandidate } from "../src/deskbot/bridge.ts";
import type { DeskBotWorldMap } from "../src/deskbot/types.ts";

const map: DeskBotWorldMap = {
  schema: "deskbot.world-map.v0.1",
  world_id: "test",
  world_revision: 8,
  logical_time: { day: 1, minute_of_day: 480, tick: 8 },
  protagonist: { character_id: "shaping-001", location_id: "desk" },
  locations: [
    { location_id: "desk", name: "桌边", description: "", x: 10, y: 10, neighbors: ["road"], current: true, reachable: false, arrival_text: "" },
    { location_id: "road", name: "旧路", description: "", x: 20, y: 20, neighbors: ["desk"], current: false, reachable: true, arrival_text: "" },
    { location_id: "lake", name: "水岸", description: "", x: 30, y: 30, neighbors: [], current: false, reachable: false, arrival_text: "" },
  ],
  npcs: [{ npc_id: "npc-1", display_name: "巡路员", role: "keeper", location_id: "desk", status: "观察", bio: "", temperament: "", speech_style: "", last_action: null }],
};

describe("DeskBot bridge candidate boundary", () => {
  it("only offers stay plus adjacent moves", () => {
    const npc = map.npcs[0];
    expect(npc).toBeDefined();
    const candidates = buildNpcCandidates(map, npc!);
    expect(candidates.map((item) => item.locationId ?? "stay")).toEqual(["stay", "road"]);
    expect(candidates.some((item) => item.locationId === "lake")).toBe(false);
  });

  it("rejects stale revision and a moved NPC before writing", () => {
    const npc = map.npcs[0];
    expect(npc).toBeDefined();
    const candidate = buildNpcCandidates(map, npc!)[1];
    expect(candidate).toBeDefined();
    expect(validateCandidate(candidate!, { ...map, world_revision: 9 })).toMatch(/世界已继续运行/);
    expect(validateCandidate(candidate!, { ...map, npcs: [{ ...npc!, location_id: "road" }] })).toMatch(/已经离开/);
  });
});
