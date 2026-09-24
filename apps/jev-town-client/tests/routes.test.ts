import { describe, expect, it } from "vitest";
import { ACTIONS } from "../shared/actions.ts";
import { CITIZENS } from "../shared/citizens.ts";
import { FOUNTAIN_RADIUS, destinationFor, postPosition, travelDurationMs, type Point } from "../shared/positions.ts";
import { routeBetween, routeLength, sampleRoute } from "../shared/routes.ts";
import { BLOCK_PITCH, STREET_LINES, STREET_WIDTH, getPlace } from "../shared/town.ts";

const plaza = getPlace("plaza");

function onStreet(p: Point, slack = 0): boolean {
  const half = STREET_WIDTH / 2 + slack;
  return STREET_LINES.some((line) => Math.abs(p.x - line) <= half || Math.abs(p.y - line) <= half);
}

function inSquare(p: Point): boolean {
  const reach = BLOCK_PITCH / 2 + 2;
  return Math.abs(p.x - plaza.x) <= reach && Math.abs(p.y - plaza.y) <= reach;
}

const SPOTS: Point[] = CITIZENS.flatMap((c) => [postPosition(c), ...ACTIONS.map((a) => destinationFor(c, a))]);

describe("standing spots", () => {
  it("parks every idle citizen on a street, never inside a block", () => {
    for (const citizen of CITIZENS) expect(onStreet(postPosition(citizen))).toBe(true);
  });

  it("gathers JOINers on the square around the fountain, not in it", () => {
    for (const citizen of CITIZENS) {
      const p = destinationFor(citizen, "JOIN");
      const r = Math.hypot(p.x - plaza.x, p.y - plaza.y);
      expect(r).toBeGreaterThan(FOUNTAIN_RADIUS);
      expect(inSquare(p)).toBe(true);
    }
  });

  it("sends warners to the watchtower and fleers to their own homes", () => {
    const tower = getPlace("watchtower");
    for (const citizen of CITIZENS) {
      const warn = destinationFor(citizen, "WARN");
      expect(Math.hypot(warn.x - tower.x, warn.y - tower.y)).toBeLessThan(BLOCK_PITCH);
      const home = getPlace(citizen.homeId);
      const flee = destinationFor(citizen, "FLEE");
      expect(Math.hypot(flee.x - home.x, flee.y - home.y)).toBeLessThan(BLOCK_PITCH);
    }
  });
});

describe("routeBetween", () => {
  it("starts and ends exactly at the requested points", () => {
    const route = routeBetween(SPOTS[0]!, SPOTS[SPOTS.length - 1]!);
    expect(route[0]).toEqual(SPOTS[0]);
    expect(route[route.length - 1]).toEqual(SPOTS[SPOTS.length - 1]);
  });

  it("only ever walks along streets or across the open square", () => {
    for (let i = 0; i < SPOTS.length; i += 3) {
      for (let j = 1; j < SPOTS.length; j += 7) {
        const route = routeBetween(SPOTS[i]!, SPOTS[j]!);
        const length = routeLength(route);
        for (let d = 0; d <= length; d += 0.5) {
          const p = sampleRoute(route, d);
          expect(onStreet(p, 0.1) || inSquare(p), `${JSON.stringify(p)} on ${JSON.stringify(route)}`).toBe(true);
        }
      }
    }
  });

  it("turns only at right angles between the first and last hop", () => {
    const route = routeBetween(postPosition(CITIZENS[0]!), destinationFor(CITIZENS[0]!, "WARN"));
    for (let i = 2; i < route.length - 1; i++) {
      const a = route[i - 1]!;
      const b = route[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("is never shorter than the straight line", () => {
    for (let i = 0; i < SPOTS.length; i += 11) {
      const a = SPOTS[i]!;
      const b = SPOTS[(i * 7 + 5) % SPOTS.length]!;
      expect(routeLength(routeBetween(a, b))).toBeGreaterThanOrEqual(Math.hypot(b.x - a.x, b.y - a.y) - 1e-9);
    }
  });
});

describe("sampleRoute", () => {
  it("clamps to the ends and interpolates in between", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(sampleRoute(route, -5)).toMatchObject({ x: 0, y: 0 });
    expect(sampleRoute(route, 15)).toMatchObject({ x: 10, y: 5 });
    expect(sampleRoute(route, 99)).toMatchObject({ x: 10, y: 10 });
    expect(sampleRoute(route, 15).heading).toBeCloseTo(Math.PI / 2);
  });
});

describe("travelDurationMs", () => {
  it("is zero for no movement, grows with distance, and is capped", () => {
    const a = postPosition(CITIZENS[0]!);
    expect(travelDurationMs(a, a)).toBe(0);
    const near = travelDurationMs(a, { x: a.x + 2, y: a.y });
    const far = travelDurationMs({ x: 10, y: 10 }, { x: 110, y: 110 });
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(4200);
  });
});
