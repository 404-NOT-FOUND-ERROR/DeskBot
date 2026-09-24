/**
 * Pure mapping from the flat 160 x 100 map space (see {@link ./town.ts}) into
 * the Three.js world's ground plane, expressed as (x, z) coordinates (Three.js
 * uses a Y-up axis convention, so the map's 2D plane becomes the XZ plane).
 *
 * The map's logical (x, y) coordinates never change: this is a render-only
 * transform, applied at the last possible moment by the scene builder.
 */
import { MAP_H, MAP_W } from "./town.ts";

/** One map unit becomes this many Three.js world units. */
// The scene is modelled directly in map units, so building and citizen sizes in
// src/three read in the same units as the street grid in shared/town.ts.
export const WORLD_SCALE = 1;

export const WORLD_WIDTH = MAP_W * WORLD_SCALE;
export const WORLD_DEPTH = MAP_H * WORLD_SCALE;

export interface WorldPoint {
  x: number;
  z: number;
}

/** Projects a map-space point onto the ground plane, centred at the world origin. */
export function mapToWorld(x: number, y: number): WorldPoint {
  return {
    x: (x - MAP_W / 2) * WORLD_SCALE,
    z: (y - MAP_H / 2) * WORLD_SCALE,
  };
}

/** Inverse of {@link mapToWorld}. */
export function worldToMap(x: number, z: number): { x: number; y: number } {
  return {
    x: x / WORLD_SCALE + MAP_W / 2,
    y: z / WORLD_SCALE + MAP_H / 2,
  };
}
