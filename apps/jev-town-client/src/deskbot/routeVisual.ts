import type { Point } from "@shared/positions.ts";
import type { DeskBotPresentationPoint } from "./types.ts";
import type { DeskBotWorldMap, DeskBotWorldRoute } from "./types.ts";
import { canonicalPointForLocation, canonicalRouteBetween } from "./canonicalGeometry.ts";

/** Presentation-space contract shared by the DeskBot route service and Jev Town. */
export const DESKBOT_PRESENTATION_SPACE = "jev-town-map-v1";
const PRESENTATION_MIN = 0;
// The scene slab is 120 wide; admitted routes use the 10..110 street boundary.
const PRESENTATION_MAX = 110;

/**
 * A visual segment for the protagonist's current canonical world step.
 * The client may compress real logical time for presentation, but it must keep
 * the segment endpoints and relative cost supplied by DeskBot.
 */
export interface DeskBotTravelVisual {
  worldId: string;
  worldRevision: number;
  citizenId: number;
  fromLocationId: string;
  toLocationId: string;
  from: Point;
  to: Point;
  route: Point[];
  durationMs: number;
  step: number;
  total: number;
  destinationName: string;
}

/**
 * A complete, server-authorized route shown while a destination is selected.
 * The route order and destination come from DeskBot; only the render-space
 * street waypoints are derived locally from the canonical presentation map.
 */
export interface DeskBotRoutePreview {
  worldRevision: number;
  destinationLocationId: string;
  locationIds: string[];
  locationPoints: Point[];
  points: Point[];
  transferLocationIds: string[];
}

function samePoint(a: Point | undefined, b: Point | undefined): boolean {
  return Boolean(a && b && Math.hypot(a.x - b.x, a.y - b.y) <= 0.001);
}

function appendSegment(target: Point[], segment: readonly Point[]): void {
  for (const point of segment) {
    if (!samePoint(target.at(-1), point)) target.push({ ...point });
  }
}

/**
 * Build the visual route for a selected remote destination. Returning null on
 * revision or contract drift is intentional: a stale preview must disappear
 * instead of suggesting that the client knows a route the world no longer has.
 */
export function buildRoutePreview(
  route: DeskBotWorldRoute | null | undefined,
  map: DeskBotWorldMap | null | undefined,
): DeskBotRoutePreview | null {
  if (!route || !map) return null;
  if (route.world_revision !== map.world_revision || route.world_id !== map.world_id) return null;
  if (!route.found || route.blocked) return null;
  if (route.current_location_id !== map.protagonist.location_id) return null;

  const locationIds = route.locations.map((location) => location.location_id);
  if (locationIds.length === 0 || locationIds.at(-1) !== route.destination_location_id) return null;
  const byId = new Map(map.locations.map((location) => [location.location_id, location]));
  const locations = locationIds.map((locationId) => byId.get(locationId));
  if (locations.some((location) => !location)) return null;

  const points: Point[] = [];
  for (let index = 0; index < locations.length - 1; index += 1) {
    const from = locations[index]!;
    const to = locations[index + 1]!;
    const step = route.steps[index];
    const fallback = canonicalRouteBetween(from, to);
    const presentation = step
      && step.from_location_id === from.location_id
      && step.to_location_id === to.location_id
      ? step.presentation_points
      : undefined;
    appendSegment(points, resolveTravelRoute(
      presentation,
      canonicalPointForLocation(from),
      canonicalPointForLocation(to),
      fallback,
      step?.presentation_space,
    ));
  }

  if (points.length < 2) return null;
  return {
    worldRevision: map.world_revision,
    destinationLocationId: route.destination_location_id,
    locationIds,
    locationPoints: locations.map((location) => canonicalPointForLocation(location!)),
    points,
    transferLocationIds: locationIds.slice(1, -1),
  };
}

/** Build the client-side segment without inventing a destination or world state. */
export function buildTravelVisual(
  citizenId: number,
  fromLocationId: string,
  toLocationId: string,
  from: Point,
  to: Point,
  route: Point[],
  step: number,
  total: number,
  destinationName: string,
  travelCostMinutes: number,
  worldId: string,
  worldRevision: number,
): DeskBotTravelVisual {
  return {
    worldId,
    worldRevision,
    citizenId,
    fromLocationId,
    toLocationId,
    from: { ...from },
    to: { ...to },
    route: route.map((point) => ({ ...point })),
    durationMs: travelCostToDuration(travelCostMinutes),
    step,
    total,
    destinationName,
  };
}

/**
 * Prefer the presentation polyline authored by DeskBot for this hop.  The
 * fallback keeps older services and unknown locations renderable, while the
 * endpoint check prevents a stale or malformed polyline from moving a figure
 * to a different place than the canonical world mutation.
 */
export function resolveTravelRoute(
  presentationPoints: readonly DeskBotPresentationPoint[] | undefined,
  from: Point,
  to: Point,
  fallback: readonly Point[],
  presentationSpace?: string,
): Point[] {
  if (!presentationPoints || presentationPoints.length < 2) return fallback.map((point) => ({ ...point }));
  if (presentationSpace && presentationSpace !== DESKBOT_PRESENTATION_SPACE) {
    return fallback.map((point) => ({ ...point }));
  }
  if (presentationPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    return fallback.map((point) => ({ ...point }));
  }
  const points = presentationPoints
    .map((point) => ({ x: point.x, y: point.y }));
  if (points.length < 2) return fallback.map((point) => ({ ...point }));
  if (presentationSpace && points.some((point) => (
    point.x < PRESENTATION_MIN || point.x > PRESENTATION_MAX
    || point.y < PRESENTATION_MIN || point.y > PRESENTATION_MAX
  ))) {
    return fallback.map((point) => ({ ...point }));
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.hypot(first.x - from.x, first.y - from.y) > 0.1
    || Math.hypot(last.x - to.x, last.y - to.y) > 0.1) {
    return fallback.map((point) => ({ ...point }));
  }
  return points;
}

/** Map logical travel minutes to a readable UI animation while preserving order until the UI cap. */
export function travelCostToDuration(travelCostMinutes: number): number {
  const cost = Number.isFinite(travelCostMinutes) ? Math.max(1, travelCostMinutes) : 1;
  return Math.min(3200, 600 + cost * 100);
}
