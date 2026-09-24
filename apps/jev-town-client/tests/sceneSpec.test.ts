import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W, PLACES, QUARTERS, STREET_LINES, STREET_WIDTH } from "../shared/town.ts";
import {
  COTTAGE_SPECS,
  LABEL_SPECS,
  POND_SPECS,
  SIGNATURE_SPECS,
  TILE_SPECS,
  TREE_SPECS,
} from "../src/three/sceneSpec.ts";

describe("SIGNATURE_SPECS", () => {
  it("gives every workplace and landmark exactly one signature building", () => {
    const expected = PLACES.filter((p) => p.kind === "work" || p.kind === "landmark").map((p) => p.id);
    expect(SIGNATURE_SPECS.map((s) => s.id).sort()).toEqual([...expected].sort());
  });

  it("uses a distinct style for every signature building", () => {
    const styles = SIGNATURE_SPECS.map((s) => s.style);
    expect(new Set(styles).size).toBe(styles.length);
  });
});

describe("TILE_SPECS", () => {
  it("covers 25 city blocks plus four strips of countryside", () => {
    expect(TILE_SPECS.filter((t) => t.kind !== "border")).toHaveLength(25);
    expect(TILE_SPECS.filter((t) => t.kind === "border")).toHaveLength(4);
    expect(TILE_SPECS.filter((t) => t.kind === "plaza")).toHaveLength(1);
  });

  it("leaves every street uncovered, so the slab shows through as road", () => {
    for (const tile of TILE_SPECS) {
      const x0 = tile.x + MAP_W / 2 - tile.width / 2;
      const x1 = tile.x + MAP_W / 2 + tile.width / 2;
      const z0 = tile.z + MAP_H / 2 - tile.depth / 2;
      const z1 = tile.z + MAP_H / 2 + tile.depth / 2;
      for (const line of STREET_LINES) {
        const lo = line - STREET_WIDTH / 2 + 1e-6;
        const hi = line + STREET_WIDTH / 2 - 1e-6;
        expect(x1 <= lo || x0 >= hi || z1 <= lo || z0 >= hi, `tile at ${tile.x},${tile.z} covers street ${line}`).toBe(
          true,
        );
      }
    }
  });
});

describe("LABEL_SPECS", () => {
  it("labels every place and every quarter exactly once", () => {
    expect(LABEL_SPECS).toHaveLength(PLACES.length + QUARTERS.length);
    const ids = LABEL_SPECS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("floats every label above the ground", () => {
    for (const label of LABEL_SPECS) expect(label.height).toBeGreaterThan(0);
  });
});

describe("scenery bounds", () => {
  it("keeps every cottage, tree and pond on the slab", () => {
    for (const point of [...COTTAGE_SPECS, ...TREE_SPECS, ...POND_SPECS, ...SIGNATURE_SPECS]) {
      expect(Math.abs(point.x)).toBeLessThanOrEqual(MAP_W / 2);
      expect(Math.abs(point.z)).toBeLessThanOrEqual(MAP_H / 2);
    }
  });
});
