/**
 * Street routing on Cloverfield's grid. A route leaves the start point by the
 * shortest hop onto a street, follows the street grid with at most two turns,
 * and steps off onto the destination - so walking citizens stay on the roads
 * instead of cutting diagonally through houses.
 *
 * Pure and deterministic: the same two points always give the same route.
 */
import { BLOCK_PITCH, STREET_LINES, getPlace } from "./town.ts";

export interface RoutePoint {
  x: number;
  y: number;
}

interface StreetEntry {
  point: RoutePoint;
  /** "v" = on a north-south street (x fixed), "h" = on an east-west street (y fixed). */
  axis: "v" | "h";
}

const FIRST_STREET = STREET_LINES[0];
const LAST_STREET = Math.max(...STREET_LINES);

function nearestLine(value: number): number {
  let best: number = STREET_LINES[0];
  for (const line of STREET_LINES) {
    if (Math.abs(line - value) < Math.abs(best - value)) best = line;
  }
  return best;
}

function clampToGrid(value: number): number {
  return Math.min(LAST_STREET, Math.max(FIRST_STREET, value));
}

/** The closest point on any street, and which way that street runs. */
export function streetEntry(p: RoutePoint): StreetEntry {
  const vx = nearestLine(p.x);
  const hy = nearestLine(p.y);
  if (Math.abs(p.x - vx) <= Math.abs(p.y - hy)) {
    return { point: { x: vx, y: clampToGrid(p.y) }, axis: "v" };
  }
  return { point: { x: clampToGrid(p.x), y: hy }, axis: "h" };
}

/** Street line that minimises the detour when crossing between two parallel streets. */
function bestCrossing(a: number, b: number): number {
  let best: number = STREET_LINES[0];
  let bestCost = Infinity;
  for (const line of STREET_LINES) {
    const cost = Math.abs(a - line) + Math.abs(b - line);
    if (cost < bestCost) {
      best = line;
      bestCost = cost;
    }
  }
  return best;
}

function gridCorners(from: StreetEntry, to: StreetEntry): RoutePoint[] {
  const a = from.point;
  const b = to.point;
  if (from.axis === "v" && to.axis === "v") {
    if (a.x === b.x) return [];
    const h = bestCrossing(a.y, b.y);
    return [
      { x: a.x, y: h },
      { x: b.x, y: h },
    ];
  }
  if (from.axis === "h" && to.axis === "h") {
    if (a.y === b.y) return [];
    const v = bestCrossing(a.x, b.x);
    return [
      { x: v, y: a.y },
      { x: v, y: b.y },
    ];
  }
  if (from.axis === "v") return [{ x: a.x, y: b.y }];
  return [{ x: b.x, y: a.y }];
}

const plaza = getPlace("plaza");

/** Fountain Square is open paving, so people can cross it directly. */
function insideSquare(p: RoutePoint): boolean {
  const reach = BLOCK_PITCH / 2 + 2;
  return Math.abs(p.x - plaza.x) <= reach && Math.abs(p.y - plaza.y) <= reach;
}

function dedupe(points: RoutePoint[]): RoutePoint[] {
  const out: RoutePoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  return out;
}

/** Walkable polyline from `from` to `to`, both included. */
export function routeBetween(from: RoutePoint, to: RoutePoint): RoutePoint[] {
  const direct = Math.hypot(to.x - from.x, to.y - from.y);
  if (direct < 3 || (insideSquare(from) && insideSquare(to))) return dedupe([from, to]);

  const start = streetEntry(from);
  const end = streetEntry(to);
  return dedupe([from, start.point, ...gridCorners(start, end), end.point, to]);
}

export function routeLength(route: readonly RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

export interface RouteSample extends RoutePoint {
  /** Heading of the current segment, radians, measured from +x towards +y. */
  heading: number;
}

/** Position and heading at `distance` along the route, clamped to its ends. */
export function sampleRoute(route: readonly RoutePoint[], distance: number): RouteSample {
  const first = route[0];
  if (!first) return { x: 0, y: 0, heading: 0 };
  let remaining = Math.max(0, distance);
  let heading = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    heading = Math.atan2(b.y - a.y, b.x - a.x);
    if (remaining <= length) {
      const t = length === 0 ? 1 : remaining / length;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, heading };
    }
    remaining -= length;
  }
  const last = route[route.length - 1]!;
  return { x: last.x, y: last.y, heading };
}
