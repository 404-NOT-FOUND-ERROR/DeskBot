/**
 * The map. Cloverfield is laid out on a regular street grid: a square of
 * 5 x 5 city blocks separated by streets, grouped into four named quarters
 * around a central Fountain Square. Everything - the 3D scene, the citizens'
 * standing spots and the routes they walk - is derived from the coordinates
 * in this file, which live in a 120 x 120 design space.
 */

export const MAP_W = 120;
export const MAP_H = 120;

/** Centre-line coordinate of every street, on both axes. */
export const STREET_LINES = [10, 30, 50, 70, 90, 110] as const;

/** Width of a street, in map units. */
export const STREET_WIDTH = 4;

/** Distance between neighbouring street centre-lines, i.e. one block plus one street. */
export const BLOCK_PITCH = 20;

/** Half the width of a block's buildable interior, measured from its centre to the kerb. */
export const BLOCK_HALF = BLOCK_PITCH / 2 - STREET_WIDTH / 2;

/** Centre coordinate of every block, on both axes. */
export const BLOCK_CENTRES = [20, 40, 60, 80, 100] as const;

export type PlaceKind = "plaza" | "work" | "home" | "landmark";

export type QuarterId = "willow" | "orchard" | "sunrise" | "harbor" | "centre";

export interface Place {
  id: string;
  label: string;
  kind: PlaceKind;
  quarter: QuarterId;
  /** Block centre. Every place owns exactly one block. */
  x: number;
  y: number;
}

export const PLACES = [
  { id: "plaza", label: "Fountain Square", kind: "plaza", quarter: "centre", x: 60, y: 60 },
  { id: "watchtower", label: "Watchtower", kind: "landmark", quarter: "willow", x: 80, y: 20 },
  { id: "chapel", label: "Willow Chapel", kind: "work", quarter: "willow", x: 40, y: 20 },
  { id: "school", label: "Willow School", kind: "work", quarter: "willow", x: 60, y: 20 },
  { id: "market", label: "Market Hall", kind: "work", quarter: "centre", x: 60, y: 40 },
  { id: "bakery", label: "Orchard Bakery", kind: "work", quarter: "orchard", x: 20, y: 40 },
  { id: "farm", label: "Orchard Farm", kind: "work", quarter: "orchard", x: 20, y: 100 },
  { id: "clinic", label: "Sunrise Clinic", kind: "work", quarter: "sunrise", x: 100, y: 40 },
  { id: "library", label: "Sunrise Library", kind: "work", quarter: "sunrise", x: 100, y: 80 },
  { id: "tavern", label: "Harbor Tavern", kind: "work", quarter: "centre", x: 60, y: 80 },
  { id: "forge", label: "Harbor Forge", kind: "work", quarter: "harbor", x: 80, y: 100 },
  { id: "docks", label: "Harbor Docks", kind: "work", quarter: "harbor", x: 100, y: 100 },
  { id: "cottage_north", label: "Willow Lane", kind: "home", quarter: "willow", x: 20, y: 20 },
  { id: "cottage_hill", label: "Hill Houses", kind: "home", quarter: "willow", x: 100, y: 20 },
  { id: "cottage_west", label: "Orchard Cottages", kind: "home", quarter: "orchard", x: 20, y: 60 },
  { id: "cottage_lane", label: "Millers Lane", kind: "home", quarter: "orchard", x: 20, y: 80 },
  { id: "cottage_east", label: "Sunrise Row", kind: "home", quarter: "sunrise", x: 100, y: 60 },
  { id: "cottage_quay", label: "Quayside Rooms", kind: "home", quarter: "harbor", x: 80, y: 80 },
  { id: "cottage_south", label: "South Cottages", kind: "home", quarter: "harbor", x: 40, y: 100 },
  { id: "cottage_green", label: "Green Row", kind: "home", quarter: "harbor", x: 60, y: 100 },
] as const satisfies readonly Place[];

export type PlaceId = (typeof PLACES)[number]["id"];

const PLACE_BY_ID = new Map<string, Place>(PLACES.map((p) => [p.id, p]));

export function getPlace(id: PlaceId): Place {
  const place = PLACE_BY_ID.get(id);
  if (!place) throw new Error(`Unknown place: ${id}`);
  return place;
}

export interface Quarter {
  id: Exclude<QuarterId, "centre">;
  label: string;
  /** Where the quarter's name floats: on the town's outer ring road, facing its blocks. */
  x: number;
  y: number;
}

export const QUARTERS: readonly Quarter[] = [
  { id: "willow", label: "Willow Quarter", x: 60, y: 10 },
  { id: "orchard", label: "Orchard Quarter", x: 10, y: 60 },
  { id: "sunrise", label: "Sunrise Quarter", x: 110, y: 60 },
  { id: "harbor", label: "Harbor Quarter", x: 60, y: 110 },
];

export interface Block {
  /** Column and row, 0-4. */
  col: number;
  row: number;
  x: number;
  y: number;
  /** The place that owns this block, or null for an ordinary residential or park block. */
  placeId: PlaceId | null;
}

/** All 25 blocks, row by row, each tagged with the place that owns it (if any). */
export const BLOCKS: readonly Block[] = BLOCK_CENTRES.flatMap((y, row) =>
  BLOCK_CENTRES.map((x, col) => {
    const place = PLACES.find((p) => p.x === x && p.y === y);
    return { col, row, x, y, placeId: place ? place.id : null };
  }),
);
