/**
 * Purely decorative scenery - cottages, trees, park ponds - filling every city
 * block so the town reads as a dense, lived-in place rather than a schematic
 * of twenty functional buildings. None of this feeds gameplay: citizens never
 * travel to or from these points (see shared/positions.ts).
 *
 * Everything here is a deterministic function of the block grid in
 * shared/town.ts, computed once at module load, so the town looks identical
 * on every load and in every test run - no `Math.random`.
 */
import { BLOCKS, BLOCK_HALF, MAP_H, MAP_W, STREET_LINES, STREET_WIDTH, getPlace } from "./town.ts";

export interface DecorPoint {
  x: number;
  y: number;
}

/** Which way a building's front door faces: toward -y, +x, +y or -x. */
export type Facing = 0 | 1 | 2 | 3;

export interface DecorCottage extends DecorPoint {
  facing: Facing;
  /** 0-3, picks a wall/roof tint so a street of cottages isn't uniform. */
  tint: number;
  /** Overall size multiplier, roughly 0.85-1.1. */
  scale: number;
}

export type TreeVariant = "round" | "pine";

export interface DecorTree extends DecorPoint {
  variant: TreeVariant;
  scale: number;
}

/** Deterministic pseudo-random value in [0, 1) for a given integer seed. */
function hash(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453123;
  return s - Math.floor(s);
}

/** Blocks with no place of their own that are laid out as small parks instead of housing. */
export const PARK_BLOCKS: readonly DecorPoint[] = [
  { x: 40, y: 60 },
  { x: 80, y: 60 },
];

function isPark(x: number, y: number): boolean {
  return PARK_BLOCKS.some((p) => p.x === x && p.y === y);
}

const LOT = BLOCK_HALF / 2 + 0.2;
const LOT_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [-LOT, -LOT],
  [LOT, -LOT],
  [-LOT, LOT],
  [LOT, LOT],
];

function facingToward(dx: number, dy: number, seed: number): Facing {
  // Face whichever of the two nearest streets the lot touches; vary it per lot.
  if (hash(seed) < 0.5) return dy < 0 ? 0 : 2;
  return dx > 0 ? 1 : 3;
}

const cottages: DecorCottage[] = [];
const trees: DecorTree[] = [];

function tree(x: number, y: number, seed: number, variant?: TreeVariant) {
  trees.push({
    x,
    y,
    variant: variant ?? (hash(seed * 9 + 7) > 0.38 ? "round" : "pine"),
    scale: 0.85 + hash(seed * 3 + 11) * 0.35,
  });
}

let seed = 1;
for (const block of BLOCKS) {
  const place = block.placeId ? getPlace(block.placeId) : null;

  if (place && (place.kind === "work" || place.kind === "landmark")) {
    // The signature building takes the middle of the block; trees fill the corners.
    for (const [dx, dy] of LOT_OFFSETS) {
      seed += 1;
      tree(block.x + dx * 1.45, block.y + dy * 1.45, seed);
    }
    continue;
  }

  if (place?.kind === "plaza") continue;

  if (!place && isPark(block.x, block.y)) {
    // Trees ringing a pond, with the pond left clear in the middle.
    for (let i = 0; i < 8; i++) {
      seed += 1;
      const angle = (i / 8) * Math.PI * 2 + hash(seed) * 0.4;
      const r = BLOCK_HALF * (0.7 + hash(seed + 1) * 0.18);
      tree(block.x + Math.cos(angle) * r, block.y + Math.sin(angle) * r, seed);
    }
    continue;
  }

  // Housing: four cottage lots, occasionally swapping one for a garden tree.
  LOT_OFFSETS.forEach(([dx, dy], lotIndex) => {
    seed += 1;
    const jitterX = (hash(seed * 5 + 1) - 0.5) * 0.8;
    const jitterY = (hash(seed * 5 + 2) - 0.5) * 0.8;
    if (place === null && lotIndex === Math.floor(hash(seed * 17) * 6)) {
      tree(block.x + dx, block.y + dy, seed);
      return;
    }
    cottages.push({
      x: block.x + dx + jitterX,
      y: block.y + dy + jitterY,
      facing: facingToward(dx, dy, seed * 7 + 3),
      tint: Math.floor(hash(seed * 11 + 5) * 4),
      scale: 0.88 + hash(seed * 13 + 9) * 0.2,
    });
  });
  seed += 1;
  tree(block.x + (hash(seed) - 0.5) * 1.2, block.y + (hash(seed + 2) - 0.5) * 1.2, seed, "round");
}

// A belt of trees and the odd farmhouse around the outside of the ring road.
const BORDER_INNER = STREET_LINES[0] - STREET_WIDTH / 2; // kerb of the outer street
for (let along = 3; along < MAP_W; along += 6.5) {
  for (const side of [0, 1, 2, 3] as const) {
    seed += 1;
    const depth = 1.8 + hash(seed * 3) * (BORDER_INNER - 3.2);
    const t = along + (hash(seed * 7) - 0.5) * 2;
    const point: DecorPoint =
      side === 0
        ? { x: t, y: depth }
        : side === 1
          ? { x: MAP_W - depth, y: t }
          : side === 2
            ? { x: MAP_W - t, y: MAP_H - depth }
            : { x: depth, y: MAP_H - t };
    if (point.x < 1 || point.y < 1 || point.x > MAP_W - 1 || point.y > MAP_H - 1) continue;
    const roll = hash(seed * 19 + 4);
    if (roll < 0.14 && along > 12 && along < MAP_W - 12) {
      // Pull farmhouses back from the kerb so their walls clear the ring road.
      const inset = side === 0 ? { y: 4 } : side === 1 ? { x: MAP_W - 4 } : side === 2 ? { y: MAP_H - 4 } : { x: 4 };
      cottages.push({ ...point, ...inset, facing: ((side + 2) % 4) as Facing, tint: Math.floor(roll * 28) % 4, scale: 0.9 });
    } else if (roll < 0.9) {
      tree(point.x, point.y, seed);
    }
  }
}

export const DECOR_COTTAGES: readonly DecorCottage[] = cottages;
export const DECOR_COTTAGE_COUNT = cottages.length;
export const DECOR_TREES: readonly DecorTree[] = trees;

/** Park ponds, one in the middle of each park block. */
export const DECOR_PONDS: readonly DecorPoint[] = PARK_BLOCKS;
