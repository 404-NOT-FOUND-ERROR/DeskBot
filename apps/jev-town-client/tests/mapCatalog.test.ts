import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalPointForLocation } from "../src/deskbot/canonicalGeometry.ts";
import { resolveTravelRoute } from "../src/deskbot/routeVisual.ts";
import type { DeskBotLocation, DeskBotWorldRouteStep } from "../src/deskbot/types.ts";

const catalog = JSON.parse(readFileSync(new URL("../../../world-content/companion-world/map.v1.json", import.meta.url), "utf8")) as {
  locations: DeskBotLocation[];
  passages: { from_location_id: string; to_location_id: string; presentation_space: string; presentation_points: { x: number; y: number }[] }[];
};
describe("shared living map presentation", () => {
  it("renders all ten authored places from the service presentation anchors", () => {
    expect(catalog.locations).toHaveLength(10);
    for (const place of catalog.locations) expect(canonicalPointForLocation(place)).toEqual(place.presentation?.point);
    const home = catalog.locations.find(place => place.location_id === "shaping-field-desk")!;
    expect(canonicalPointForLocation({ ...home, presentation: { space: "jev-town-map-v1", point: { x: 70, y: 90 } } })).toEqual({ x: 70, y: 90 });
  });
  it("uses every authorized passage geometry with its actual scene endpoints", () => {
    for (const passage of catalog.passages) {
      const from = catalog.locations.find(place => place.location_id === passage.from_location_id)!;
      const to = catalog.locations.find(place => place.location_id === passage.to_location_id)!;
      const step: DeskBotWorldRouteStep = { ...passage, index: 0, from_name: from.name, to_name: to.name, travel_cost_minutes: 5 };
      const route = resolveTravelRoute(step.presentation_points, canonicalPointForLocation(from), canonicalPointForLocation(to), [], step.presentation_space);
      expect(route[0]).toEqual(from.presentation?.point);
      expect(route.at(-1)).toEqual(to.presentation?.point);
    }
  });
});
