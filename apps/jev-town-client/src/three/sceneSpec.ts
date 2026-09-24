/**
 * Deterministic, pure-data description of the 3D town's static scenery
 * (ground tiles, buildings, trees, ponds, labels). Every value here is derived
 * from `shared/town.ts` and `shared/decor.ts` through `shared/world.ts`'s
 * coordinate mapping - there is no `Math.random` and no dependency on
 * Three.js, so this module can be unit tested on its own and is only ever
 * consumed by `buildScene.ts` to construct the actual Object3D graph.
 */
import { DECOR_COTTAGES, DECOR_PONDS, DECOR_TREES, PARK_BLOCKS, type Facing, type TreeVariant } from "@shared/decor.ts";
import {
  BLOCKS,
  BLOCK_HALF,
  MAP_H,
  MAP_W,
  PLACES,
  QUARTERS,
  STREET_LINES,
  STREET_WIDTH,
  getPlace,
  type PlaceId,
  type PlaceKind,
} from "@shared/town.ts";
import { mapToWorld } from "@shared/world.ts";

/** Visual style of a functional building, one per workplace/landmark. */
export type SignatureStyle =
  | "chapel"
  | "school"
  | "market"
  | "bakery"
  | "farm"
  | "clinic"
  | "library"
  | "tavern"
  | "forge"
  | "docks"
  | "watchtower";

export interface CottageSpec {
  x: number;
  z: number;
  facing: Facing;
  tint: number;
  scale: number;
}

export interface SignatureSpec {
  id: PlaceId;
  style: SignatureStyle;
  x: number;
  z: number;
}

export type TileKind = "lawn" | "park" | "plaza" | "border";

/** A raised ground tile. Streets are simply the gaps left between tiles. */
export interface TileSpec {
  kind: TileKind;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface TreeSpec {
  x: number;
  z: number;
  variant: TreeVariant;
  scale: number;
}

export interface PondSpec {
  x: number;
  z: number;
}

export type LabelKind = PlaceKind | "quarter";

export interface LabelSpec {
  id: string;
  x: number;
  z: number;
  label: string;
  kind: LabelKind;
  /** Height above the ground the label floats at, in world units. */
  height: number;
}

const SIGNATURE_STYLE: Partial<Record<PlaceId, SignatureStyle>> = {
  chapel: "chapel",
  school: "school",
  market: "market",
  bakery: "bakery",
  farm: "farm",
  clinic: "clinic",
  library: "library",
  tavern: "tavern",
  forge: "forge",
  docks: "docks",
  watchtower: "watchtower",
};

/** Roof-top height of each signature style, used to float its label just above it. */
export const SIGNATURE_HEIGHT: Record<SignatureStyle, number> = {
  chapel: 11,
  school: 8.4,
  market: 5.2,
  bakery: 6.6,
  farm: 6.8,
  clinic: 6.8,
  library: 7.8,
  tavern: 7.6,
  forge: 7.4,
  docks: 4.6,
  watchtower: 16,
};

export const SIGNATURE_SPECS: readonly SignatureSpec[] = PLACES.flatMap((place) => {
  const style = SIGNATURE_STYLE[place.id];
  if (!style) return [];
  const w = mapToWorld(place.x, place.y);
  return [{ id: place.id, style, x: w.x, z: w.z }];
});

export const COTTAGE_SPECS: readonly CottageSpec[] = DECOR_COTTAGES.map((c) => {
  const w = mapToWorld(c.x, c.y);
  return { x: w.x, z: w.z, facing: c.facing, tint: c.tint, scale: c.scale };
});

const plaza = getPlace("plaza");
const PLAZA_WORLD = mapToWorld(plaza.x, plaza.y);

/** Plaza corner trees: the square is paved, so its greenery is placed here rather than in decor. */
const PLAZA_TREES: TreeSpec[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
].map(([sx, sz]) => ({
  x: PLAZA_WORLD.x + (sx ?? 0) * (BLOCK_HALF - 1.6),
  z: PLAZA_WORLD.z + (sz ?? 0) * (BLOCK_HALF - 1.6),
  variant: "round" as const,
  scale: 1.05,
}));

export const TREE_SPECS: readonly TreeSpec[] = [
  ...DECOR_TREES.map((t) => {
    const w = mapToWorld(t.x, t.y);
    return { x: w.x, z: w.z, variant: t.variant, scale: t.scale };
  }),
  ...PLAZA_TREES,
];

export const POND_SPECS: readonly PondSpec[] = DECOR_PONDS.map((p) => mapToWorld(p.x, p.y));

export const PLAZA_SPEC: PondSpec = PLAZA_WORLD;

function tileKind(x: number, y: number, placeId: PlaceId | null): TileKind {
  if (placeId === "plaza") return "plaza";
  if (PARK_BLOCKS.some((p) => p.x === x && p.y === y)) return "park";
  return "lawn";
}

const BLOCK_SIZE = BLOCK_HALF * 2;
const KERB = STREET_LINES[0] - STREET_WIDTH / 2;
const FAR_KERB = Math.max(...STREET_LINES) + STREET_WIDTH / 2;

/** 25 block tiles plus the four strips of countryside outside the ring road. */
export const TILE_SPECS: readonly TileSpec[] = [
  ...BLOCKS.map((b) => {
    const w = mapToWorld(b.x, b.y);
    return { kind: tileKind(b.x, b.y, b.placeId), x: w.x, z: w.z, width: BLOCK_SIZE, depth: BLOCK_SIZE };
  }),
  ...(
    [
      [MAP_W / 2, KERB / 2, MAP_W, KERB],
      [MAP_W / 2, (FAR_KERB + MAP_H) / 2, MAP_W, MAP_H - FAR_KERB],
      [KERB / 2, MAP_H / 2, KERB, FAR_KERB - KERB],
      [(FAR_KERB + MAP_W) / 2, MAP_H / 2, MAP_W - FAR_KERB, FAR_KERB - KERB],
    ] as const
  ).map(([cx, cy, width, depth]) => {
    const w = mapToWorld(cx, cy);
    return { kind: "border" as const, x: w.x, z: w.z, width, depth };
  }),
];

export const LABEL_SPECS: readonly LabelSpec[] = [
  ...PLACES.filter((p) => p.kind !== "home").map((p) => {
    const w = mapToWorld(p.x, p.y);
    const signature = SIGNATURE_STYLE[p.id];
    return {
      id: p.id,
      x: w.x,
      z: w.z,
      label: p.label,
      kind: p.kind,
      height: signature ? SIGNATURE_HEIGHT[signature] + 0.8 : 7.5,
    };
  }),
  ...PLACES.filter((p) => p.kind === "home").map((p) => {
    const w = mapToWorld(p.x, p.y);
    return { id: p.id, x: w.x, z: w.z, label: p.label, kind: p.kind, height: 7 };
  }),
  ...QUARTERS.map((q) => {
    const w = mapToWorld(q.x, q.y);
    return { id: `quarter-${q.id}`, x: w.x, z: w.z, label: q.label, kind: "quarter" as const, height: 0.6 };
  }),
];
