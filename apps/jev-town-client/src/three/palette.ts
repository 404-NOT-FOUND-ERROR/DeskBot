/**
 * Storybook-town colour palette for the 3D scene, as hex ints for Three.js.
 * Soft sage lawns, cream streets and walls, brick-red and slate roofs - the
 * same warm grammar as the rest of the UI (see the custom properties in
 * src/styles.css), tuned to stay readable under the scene's lighting.
 */

export const PALETTE = {
  street: 0xeee4c8,
  kerb: 0xd9cca8,
  lawn: 0x9cc184,
  lawnPark: 0x8fba78,
  lawnBorder: 0x93b87d,
  slabSide: 0x7e9f6a,
  slabUnder: 0x6c8b5b,
  island: 0xc9dcb0,
  paving: 0xe9dfc6,
  pavement: 0xe3d8bc,
  roadLine: 0xf6efdc,
  pavingDark: 0xd8cba9,
  stone: 0xd9cfb8,
  stoneDark: 0xa99e89,
  timber: 0x7a5236,
  door: 0x6b4a34,
  window: 0x5d7483,
  windowFrame: 0xf6efe0,
  chimney: 0x9b5a45,
  water: 0x8ccbd0,
  waterDeep: 0x6fb3bd,
  canopy: 0x6f9c5c,
  canopyLight: 0x86b06d,
  canopyDark: 0x557f48,
  pine: 0x4f7a4a,
  trunk: 0x7a5538,
  skin: 0xf0d3b3,
  bench: 0x8a6446,
  lamp: 0x4b4a45,
  gold: 0xd9a93f,
  soil: 0x9a7650,
  crop: 0xb8c46a,
  hedge: 0x5f8a4e,
  flowerA: 0xd96b7a,
  flowerB: 0xe6c455,
  flowerC: 0xc08ad4,
  hay: 0xe0c071,
  ember: 0xff8a3d,
  cross: 0xc8453a,
} as const;

/** Cottage wall tints, indexed by a cottage's `tint`. */
export const WALL_TINTS: readonly number[] = [0xf6eedd, 0xf1e5cc, 0xf8f1e4, 0xeee0c4];

/** Cottage roof colours, indexed by a cottage's `tint`: brick, deep red, slate, terracotta. */
export const ROOF_TINTS: readonly number[] = [0xb9472f, 0x9e3a2a, 0x55697a, 0xc0603a];

/** One colour band per citizen, matching `citizen.palette` (0-5). */
export const CITIZEN_PALETTE: readonly number[] = [0xd97756, 0x4d8a63, 0x4d6a9a, 0xc9932f, 0x8a5a9a, 0x4a9a94];

export const ACTION_COLOR: Record<string, number> = {
  IGNORE: 0x8a7a5c,
  INVESTIGATE: 0x4d6a7a,
  JOIN: 0xc9932f,
  FLEE: 0xb23b3b,
  WARN: 0x983c22,
};

export const FOCUS_COLOR = 0x1d5fae;

export function toCssHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
