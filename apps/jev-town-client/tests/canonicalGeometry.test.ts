import { describe, expect, it } from "vitest";
import { CANONICAL_SCENE_ANCHORS, canonicalPointForLocation, canonicalRouteBetween, canonicalRoutePoints } from "../src/deskbot/canonicalGeometry.ts";

const locations = [
  { location_id: "shaping-field-desk", x: 50, y: 84 },
  { location_id: "tidal-old-road", x: 49, y: 61 },
  { location_id: "whisper-market", x: 22, y: 38 },
  { location_id: "backlit-grove", x: 77, y: 36 },
  { location_id: "echo-waterside", x: 51, y: 14 },
];

describe("DeskBot canonical presentation geometry", () => {
  it("maps unknown locations from the 0-100 canonical space into the 10-110 Jev Town scene", () => {
    expect(canonicalPointForLocation({ x: 0, y: 0 })).toEqual({ x: 10, y: 10 });
    expect(canonicalPointForLocation({ x: 100, y: 100 })).toEqual({ x: 110, y: 110 });
    expect(canonicalPointForLocation({ x: -20, y: 140 })).toEqual({ x: 10, y: 110 });
    for (const location of locations) {
      const point = canonicalPointForLocation(location);
      expect(point.x).toBeGreaterThanOrEqual(10);
      expect(point.x).toBeLessThanOrEqual(110);
      expect(point.y).toBeGreaterThanOrEqual(10);
      expect(point.y).toBeLessThanOrEqual(110);
    }
  });

  it("uses stable street anchors for known locations", () => {
    expect(canonicalPointForLocation(locations[0]!)).toEqual(CANONICAL_SCENE_ANCHORS["shaping-field-desk"]);
    expect(canonicalPointForLocation(locations[1]!)).toEqual(CANONICAL_SCENE_ANCHORS["tidal-old-road"]);
    expect(canonicalPointForLocation(locations[2]!)).toEqual(CANONICAL_SCENE_ANCHORS["whisper-market"]);
    expect(canonicalPointForLocation(locations[3]!)).toEqual(CANONICAL_SCENE_ANCHORS["backlit-grove"]);
    expect(canonicalPointForLocation(locations[4]!)).toEqual(CANONICAL_SCENE_ANCHORS["echo-waterside"]);
  });

  it("keeps the endpoint anchors on Jev Town road centre lines", () => {
    expect(canonicalPointForLocation(locations[0]!)).toEqual({ x: 50, y: 90 });
    expect(canonicalPointForLocation(locations[4]!)).toEqual({ x: 50, y: 10 });
  });

  it("keeps each rendered hop anchored to its presentation endpoints", () => {
    const from = canonicalPointForLocation(locations[0]!);
    const to = canonicalPointForLocation(locations[1]!);
    const route = canonicalRouteBetween(locations[0]!, locations[1]!);
    expect(route[0]).toEqual(from);
    expect(route.at(-1)).toEqual(to);
  });

  it("resolves ordered server route IDs without inventing route order", () => {
    const points = canonicalRoutePoints(
      ["shaping-field-desk", "tidal-old-road", "whisper-market"],
      { locations },
    );
    expect(points).toEqual([
      { x: 50, y: 90 },
      { x: 50, y: 70 },
      { x: 30, y: 50 },
    ]);
  });

  it("keeps the visual route on the street network between known anchors", () => {
    const route = canonicalRouteBetween(locations[1]!, locations[2]!);
    expect(route[0]).toEqual({ x: 50, y: 70 });
    expect(route.at(-1)).toEqual({ x: 30, y: 50 });
    expect(route).toContainEqual({ x: 50, y: 50 });
  });
});
