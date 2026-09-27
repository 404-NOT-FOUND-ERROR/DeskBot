import { describe, expect, it } from "vitest";
import { buildRoutePreview, buildTravelVisual, DESKBOT_PRESENTATION_SPACE, resolveTravelRoute, travelCostToDuration } from "../src/deskbot/routeVisual.ts";
import type { DeskBotWorldMap, DeskBotWorldRoute } from "../src/deskbot/types.ts";

const map = {
  schema: "deskbot.world-map.v0.1",
  world_id: "test-world",
  world_revision: 4,
  logical_time: { day: 1, minute_of_day: 0, tick: 1 },
  protagonist: { character_id: "shaping-001", location_id: "shaping-field-desk" },
  locations: [
    { location_id: "shaping-field-desk", name: "Origin", description: "", x: 50, y: 90, neighbors: ["tidal-old-road"], current: true, reachable: true, arrival_text: "" },
    { location_id: "tidal-old-road", name: "Transfer", description: "", x: 50, y: 70, neighbors: ["shaping-field-desk", "whisper-market"], current: false, reachable: true, arrival_text: "" },
    { location_id: "whisper-market", name: "Destination", description: "", x: 30, y: 50, neighbors: ["tidal-old-road"], current: false, reachable: false, arrival_text: "" },
  ],
  npcs: [],
  active_event: null,
} satisfies DeskBotWorldMap;

const route = {
  schema: "deskbot.world-route.v0.1",
  world_id: "test-world",
  world_revision: 4,
  character_id: "shaping-001",
  current_location_id: "shaping-field-desk",
  destination_location_id: "whisper-market",
  found: true,
  blocked: false,
  blocked_reason: null,
  locations: [
    { location_id: "shaping-field-desk", name: "Origin" },
    { location_id: "tidal-old-road", name: "Transfer" },
    { location_id: "whisper-market", name: "Destination" },
  ],
  steps: [
    { index: 0, from_location_id: "shaping-field-desk", from_name: "Origin", to_location_id: "tidal-old-road", to_name: "Transfer", travel_cost_minutes: 4, presentation_points: [{ x: 50, y: 90 }, { x: 50, y: 70 }] },
    { index: 1, from_location_id: "tidal-old-road", from_name: "Transfer", to_location_id: "whisper-market", to_name: "Destination", travel_cost_minutes: 8, presentation_points: [{ x: 50, y: 70 }, { x: 50, y: 50 }, { x: 30, y: 50 }] },
  ],
  total_cost_minutes: 12,
} satisfies DeskBotWorldRoute;

describe("DeskBot route visual timing", () => {
  it("keeps longer canonical travel costs slower", () => {
    expect(travelCostToDuration(18)).toBeGreaterThan(travelCostToDuration(4));
  });

  it("clamps unusable costs to a readable bounded animation", () => {
    expect(travelCostToDuration(0)).toBe(700);
    expect(travelCostToDuration(Number.NaN)).toBe(700);
    expect(travelCostToDuration(999)).toBe(3200);
  });
});

describe("DeskBot presentation route contract", () => {
  const fallback = [{ x: 50, y: 70 }, { x: 50, y: 50 }, { x: 30, y: 50 }];

  it("uses the service-owned polyline when its endpoints match the canonical hop", () => {
    const authored = [{ x: 50, y: 70 }, { x: 50, y: 50 }, { x: 30, y: 50 }];
    expect(resolveTravelRoute(authored, authored[0]!, authored.at(-1)!, fallback, DESKBOT_PRESENTATION_SPACE)).toEqual(authored);
  });

  it("falls back for missing, malformed, or stale presentation points", () => {
    expect(resolveTravelRoute(undefined, { x: 50, y: 70 }, { x: 30, y: 50 }, fallback)).toEqual(fallback);
    expect(resolveTravelRoute([{ x: Number.NaN, y: 70 }, { x: 30, y: 50 }], { x: 50, y: 70 }, { x: 30, y: 50 }, fallback)).toEqual(fallback);
    expect(resolveTravelRoute([{ x: 10, y: 10 }, { x: 30, y: 50 }], { x: 50, y: 70 }, { x: 30, y: 50 }, fallback)).toEqual(fallback);
    expect(resolveTravelRoute([{ x: 50, y: 70 }, { x: 30, y: 50 }], { x: 50, y: 70 }, { x: 30, y: 50 }, fallback, "other-map-v1")).toEqual(fallback);
    expect(resolveTravelRoute([{ x: 50, y: 70 }, { x: 130, y: 50 }], { x: 50, y: 70 }, { x: 30, y: 50 }, fallback, DESKBOT_PRESENTATION_SPACE)).toEqual(fallback);
  });

  it("carries the authoritative world revision and world id into travel visuals", () => {
    const visual = buildTravelVisual(1, "origin", "destination", { x: 50, y: 70 }, { x: 30, y: 50 }, fallback, 1, 1, "Destination", 4, "test-world", 9);
    expect(visual.worldId).toBe("test-world");
    expect(visual.worldRevision).toBe(9);
  });
});

describe("DeskBot route preview", () => {
  it("combines all server route hops and identifies transfer locations", () => {
    const preview = buildRoutePreview(route, map);
    expect(preview?.locationIds).toEqual(["shaping-field-desk", "tidal-old-road", "whisper-market"]);
    expect(preview?.transferLocationIds).toEqual(["tidal-old-road"]);
    expect(preview?.points).toEqual([
      { x: 50, y: 90 },
      { x: 50, y: 70 },
      { x: 50, y: 50 },
      { x: 30, y: 50 },
    ]);
    expect(preview?.locationPoints).toEqual([
      { x: 50, y: 90 },
      { x: 50, y: 70 },
      { x: 30, y: 50 },
    ]);
  });

  it("rejects stale, blocked, or location-drifted routes", () => {
    expect(buildRoutePreview({ ...route, world_revision: 3 }, map)).toBeNull();
    expect(buildRoutePreview({ ...route, blocked: true }, map)).toBeNull();
    expect(buildRoutePreview({ ...route, current_location_id: "transfer" }, map)).toBeNull();
  });
});
