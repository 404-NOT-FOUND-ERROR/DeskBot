import { describe, expect, it, vi } from "vitest";
import { DECOR_COTTAGES, DECOR_COTTAGE_COUNT, DECOR_PONDS, DECOR_TREES, PARK_BLOCKS } from "../shared/decor.ts";
import { BLOCK_HALF, BLOCKS, MAP_H, MAP_W, STREET_LINES, STREET_WIDTH, getPlace } from "../shared/town.ts";

/** Largest half-extent of a cottage's footprint (4.4 x 3.8 at up to 1.08x scale). */
const COTTAGE_REACH = 2.4;
const STREET_MIN = Math.min(...STREET_LINES) - STREET_WIDTH / 2;
const STREET_MAX = Math.max(...STREET_LINES) + STREET_WIDTH / 2;

function blockAt(x: number, y: number) {
  return BLOCKS.find((b) => Math.abs(b.x - x) <= BLOCK_HALF && Math.abs(b.y - y) <= BLOCK_HALF) ?? null;
}

describe("decorative scenery", () => {
  it("fills the town with a dense neighbourhood of cottages", () => {
    expect(DECOR_COTTAGES).toHaveLength(DECOR_COTTAGE_COUNT);
    expect(DECOR_COTTAGE_COUNT).toBeGreaterThanOrEqual(40);
  });

  it("keeps every decorative point inside the map bounds", () => {
    for (const point of [...DECOR_COTTAGES, ...DECOR_TREES, ...DECOR_PONDS]) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(MAP_W);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(MAP_H);
    }
  });

  it("never lets a cottage spill onto a street", () => {
    for (const c of DECOR_COTTAGES) {
      for (const line of STREET_LINES) {
        const acrossVertical = Math.abs(c.x - line) < STREET_WIDTH / 2 + COTTAGE_REACH;
        const alongVertical = c.y + COTTAGE_REACH > STREET_MIN && c.y - COTTAGE_REACH < STREET_MAX;
        expect(acrossVertical && alongVertical, `cottage at ${c.x},${c.y} overlaps street x=${line}`).toBe(false);
        const acrossHorizontal = Math.abs(c.y - line) < STREET_WIDTH / 2 + COTTAGE_REACH;
        const alongHorizontal = c.x + COTTAGE_REACH > STREET_MIN && c.x - COTTAGE_REACH < STREET_MAX;
        expect(acrossHorizontal && alongHorizontal, `cottage at ${c.x},${c.y} overlaps street y=${line}`).toBe(false);
      }
    }
  });

  it("leaves workplace, landmark, plaza and park blocks free of filler cottages", () => {
    for (const c of DECOR_COTTAGES) {
      const block = blockAt(c.x, c.y);
      if (!block) continue; // countryside outside the ring road
      const place = block.placeId ? getPlace(block.placeId) : null;
      expect(place === null || place.kind === "home", `cottage in ${block.placeId}`).toBe(true);
      expect(PARK_BLOCKS.some((p) => p.x === block.x && p.y === block.y)).toBe(false);
    }
  });

  it("scatters a bounded number of trees", () => {
    expect(DECOR_TREES.length).toBeGreaterThan(60);
    expect(DECOR_TREES.length).toBeLessThanOrEqual(250);
  });

  it("puts a pond in the middle of every park", () => {
    expect(DECOR_PONDS).toEqual(PARK_BLOCKS);
  });

  it("is deterministic: every cottage and tree has fixed, reproducible coordinates", async () => {
    const snapshot = (list: readonly { x: number; y: number }[]) => list.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`);
    const first = { cottages: snapshot(DECOR_COTTAGES), trees: snapshot(DECOR_TREES) };
    vi.resetModules();
    const fresh = await import("../shared/decor.ts");
    expect(snapshot(fresh.DECOR_COTTAGES)).toEqual(first.cottages);
    expect(snapshot(fresh.DECOR_TREES)).toEqual(first.trees);
  });
});
