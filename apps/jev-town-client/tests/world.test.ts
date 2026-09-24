import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W } from "../shared/town.ts";
import { mapToWorld, worldToMap, WORLD_DEPTH, WORLD_SCALE, WORLD_WIDTH } from "../shared/world.ts";

describe("mapToWorld", () => {
  it("maps the map centre onto the world origin", () => {
    const centre = mapToWorld(MAP_W / 2, MAP_H / 2);
    expect(centre.x).toBeCloseTo(0);
    expect(centre.z).toBeCloseTo(0);
  });

  it("maps the four map corners onto the four corners of the ground plane", () => {
    expect(mapToWorld(0, 0)).toMatchObject({ x: -WORLD_WIDTH / 2, z: -WORLD_DEPTH / 2 });
    expect(mapToWorld(MAP_W, 0)).toMatchObject({ x: WORLD_WIDTH / 2, z: -WORLD_DEPTH / 2 });
    expect(mapToWorld(0, MAP_H)).toMatchObject({ x: -WORLD_WIDTH / 2, z: WORLD_DEPTH / 2 });
    expect(mapToWorld(MAP_W, MAP_H)).toMatchObject({ x: WORLD_WIDTH / 2, z: WORLD_DEPTH / 2 });
  });

  it("scales distances linearly by WORLD_SCALE", () => {
    const a = mapToWorld(10, 10);
    const b = mapToWorld(20, 10);
    expect(b.x - a.x).toBeCloseTo(10 * WORLD_SCALE);
  });

  it("is a pure function: identical inputs always give identical outputs", () => {
    expect(mapToWorld(37, 61)).toEqual(mapToWorld(37, 61));
  });

  it("round-trips through worldToMap", () => {
    const original = { x: 42, y: 17 };
    const world = mapToWorld(original.x, original.y);
    const back = worldToMap(world.x, world.z);
    expect(back.x).toBeCloseTo(original.x);
    expect(back.y).toBeCloseTo(original.y);
  });
});
