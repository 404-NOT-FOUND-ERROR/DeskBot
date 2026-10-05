import { routeBetween, type RoutePoint } from "@shared/routes.ts";
import type { DeskBotLocation } from "./types.ts";

/**
 * DeskBot owns a presentation-neutral 0-100 map. Jev Town's scene is a
 * 120x120 street grid whose walkable boundary starts at 10 and ends at 110.
 * This is a render-only transform; it does not copy canonical neighbours or
 * travel costs into the client.
 */
export const CANONICAL_MAP_SIZE = 100;
export const SCENE_MAP_PADDING = 10;
export const SCENE_MAP_SCALE = 1;

/**
 * Stable render anchors for the current Morrowmere locations.
 *
 * DeskBot's x/y values are canonical world metadata, not Jev Town road
 * coordinates.  Keeping this small presentation map here lets the service
 * remain authoritative while making the known locations land on the town's
 * existing street network.  New content falls back to the canonical
 * projection below until it receives an intentional scene anchor.
 */
export const CANONICAL_SCENE_ANCHORS: Readonly<Record<string, RoutePoint>> = Object.freeze({
  // Jev Town roads are centred on 10/30/50/70/90/110. Keep the two
  // north/south endpoints on those centre lines so figures do not stand in
  // the raised block tiles at the edge of the road.
  "shaping-field-desk": { x: 50, y: 90 },
  "tidal-old-road": { x: 50, y: 70 },
  "whisper-market": { x: 30, y: 50 },
  "backlit-grove": { x: 90, y: 50 },
  "echo-waterside": { x: 50, y: 10 },
});

export type CanonicalLocationRef = Pick<DeskBotLocation, "x" | "y"> &
  Partial<Pick<DeskBotLocation, "location_id" | "presentation">>;

function finiteCoordinate(value: number, fallback: number): number {
  const finite = Number.isFinite(value) ? value : fallback;
  return Math.min(CANONICAL_MAP_SIZE, Math.max(0, finite));
}

/** Project a DeskBot location into Jev Town scene space. */
export function canonicalPointForLocation(location: CanonicalLocationRef): RoutePoint {
  // Current catalogs carry their scene anchors from the service. The table
  // below is only a compatibility fallback for older map responses.
  const supplied = location.presentation;
  if (supplied?.space === "jev-town-map-v1" && [supplied.point.x, supplied.point.y].every(value => Number.isFinite(value) && value >= 10 && value <= 110)) return { ...supplied.point };
  const anchored = location.location_id ? CANONICAL_SCENE_ANCHORS[location.location_id] : undefined;
  if (anchored) return { ...anchored };
  return {
    x: SCENE_MAP_PADDING + finiteCoordinate(location.x, CANONICAL_MAP_SIZE / 2) * SCENE_MAP_SCALE,
    y: SCENE_MAP_PADDING + finiteCoordinate(location.y, CANONICAL_MAP_SIZE / 2) * SCENE_MAP_SCALE,
  };
}

/**
 * Return a stable, street-respecting visual polyline for one server-authorized
 * hop. The server still supplies the from/to location IDs and the client only
 * adds presentation waypoints between those two fixed endpoints.
 */
export function canonicalRouteBetween(
  from: CanonicalLocationRef,
  to: CanonicalLocationRef,
): RoutePoint[] {
  return routeBetween(canonicalPointForLocation(from), canonicalPointForLocation(to));
}

/** Resolve a canonical route's ordered location IDs into scene-space points. */
export function canonicalRoutePoints(
  locationIds: readonly string[],
  map: { locations: ReadonlyArray<Pick<DeskBotLocation, "location_id" | "x" | "y">> },
): RoutePoint[] {
  const byId = new Map(map.locations.map((location) => [location.location_id, location]));
  return locationIds.flatMap((locationId) => {
    const location = byId.get(locationId);
    return location ? [canonicalPointForLocation(location)] : [];
  });
}
