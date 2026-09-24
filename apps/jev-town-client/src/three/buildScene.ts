/**
 * Imperative Three.js builders for the town. Static scenery is modelled from
 * a handful of primitives and baked into a few merged, vertex-coloured
 * meshes, so a town of hundreds of cottages and trees costs only a few draw
 * calls. `TownScene3D.tsx` is the only caller, and owns the scene graph's
 * lifetime (mounting, animating and disposing).
 *
 * Local building convention: the front door faces +z, and y is up.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { MAP_H, MAP_W, STREET_LINES } from "@shared/town.ts";
import { ACTION_COLOR, CITIZEN_PALETTE, FOCUS_COLOR, PALETTE, ROOF_TINTS, WALL_TINTS } from "./palette.ts";
import {
  COTTAGE_SPECS,
  PLAZA_SPEC,
  POND_SPECS,
  SIGNATURE_SPECS,
  TILE_SPECS,
  TREE_SPECS,
  type CottageSpec,
  type SignatureSpec,
  type TileKind,
  type TreeSpec,
} from "./sceneSpec.ts";

// --- Geometry batching --------------------------------------------------------

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_ICO = new THREE.IcosahedronGeometry(1, 1);

function gableGeometry(): THREE.BufferGeometry {
  // Triangular prism, ridge along x, 1 x 1 x 1, base at y = 0. Winding is
  // counter-clockwise from outside so the flat normals face outwards.
  const A = [-0.5, 0, -0.5];
  const B = [-0.5, 0, 0.5];
  const C = [-0.5, 1, 0];
  const A2 = [0.5, 0, -0.5];
  const B2 = [0.5, 0, 0.5];
  const C2 = [0.5, 1, 0];
  const triangles = [
    [A, B, C],
    [A2, C2, B2],
    [B, B2, C2],
    [B, C2, C],
    [A, C, C2],
    [A, C2, A2],
    [A, A2, B2],
    [A, B2, B],
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(triangles.flat(2), 3));
  return geometry;
}

const UNIT_GABLE = gableGeometry();

type ColorFn = (normal: THREE.Vector3) => number;

/** Collects transformed, vertex-coloured copies of primitives and merges them into one mesh. */
class GeometryBatch {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly normal = new THREE.Vector3();
  private readonly color = new THREE.Color();

  add(source: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number | ColorFn): void {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    geometry.deleteAttribute("uv");
    geometry.deleteAttribute("normal");
    geometry.applyMatrix4(matrix);
    geometry.computeVertexNormals(); // flat, since every triangle has its own vertices
    const normals = geometry.getAttribute("normal");
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      if (typeof color === "number") {
        this.color.setHex(color);
      } else {
        this.normal.fromBufferAttribute(normals, i);
        this.color.setHex(color(this.normal));
      }
      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }

  /** Merges everything collected so far and empties the batch. */
  buildGeometry(): THREE.BufferGeometry {
    const merged = this.parts.length > 0 ? mergeGeometries(this.parts, false) : new THREE.BufferGeometry();
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    return merged ?? new THREE.BufferGeometry();
  }

  build(material: THREE.Material, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(this.buildGeometry(), material);
    mesh.name = name;
    return mesh;
  }
}

const tmpMatrix = new THREE.Matrix4();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * A drawing cursor for one object: every primitive is placed in the object's
 * local frame (door towards +z) and baked into the batch in world space.
 */
class Parts {
  constructor(
    private readonly batch: GeometryBatch,
    private readonly base: THREE.Matrix4,
  ) {}

  private local(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotY = 0): THREE.Matrix4 {
    tmpPosition.set(x, y, z);
    tmpQuaternion.setFromAxisAngle(Y_AXIS, rotY);
    tmpScale.set(sx, sy, sz);
    tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
    return tmpMatrix.premultiply(this.base);
  }

  /** Box sitting on `y`, centred on (x, z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number | ColorFn, rotY = 0): void {
    this.batch.add(UNIT_BOX, this.local(x, y + h / 2, z, w, h, d, rotY), color);
  }

  /** Gable roof: `length` along the ridge (local x before `rotY`), `depth` across it. */
  gable(length: number, depth: number, height: number, x: number, y: number, z: number, color: number, rotY = 0): void {
    this.batch.add(UNIT_GABLE, this.local(x, y, z, length, height, depth, rotY), color);
  }

  cylinder(
    radiusTop: number,
    radiusBottom: number,
    h: number,
    segments: number,
    x: number,
    y: number,
    z: number,
    color: number,
  ): void {
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, h, segments);
    this.batch.add(geometry, this.local(x, y + h / 2, z, 1, 1, 1), color);
    geometry.dispose();
  }

  /** Pyramid or cone; four segments with rotY = PI/4 gives a square hip roof. */
  cone(radius: number, h: number, segments: number, x: number, y: number, z: number, color: number, rotY = 0): void {
    const geometry = new THREE.ConeGeometry(radius, h, segments);
    this.batch.add(geometry, this.local(x, y + h / 2, z, 1, 1, 1, rotY), color);
    geometry.dispose();
  }

  blob(rx: number, ry: number, rz: number, x: number, y: number, z: number, color: number): void {
    this.batch.add(UNIT_ICO, this.local(x, y, z, rx, ry, rz), color);
  }
}

function frame(x: number, z: number, rotY = 0, scale = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromAxisAngle(Y_AXIS, rotY),
    new THREE.Vector3(scale, scale, scale),
  );
}

/** Rotation that turns a building's local +z door towards a map facing (0: -y, 1: +x, 2: +y, 3: -x). */
export function facingRotation(facing: 0 | 1 | 2 | 3): number {
  return [Math.PI, Math.PI / 2, 0, -Math.PI / 2][facing] ?? 0;
}

const topAndSides =
  (top: number, sides: number): ColorFn =>
  (n) =>
    n.y > 0.5 ? top : sides;

// --- Ground -------------------------------------------------------------------

const TILE_TOP: Record<TileKind, number> = {
  lawn: PALETTE.lawn,
  park: PALETTE.lawnPark,
  plaza: PALETTE.paving,
  border: PALETTE.lawnBorder,
};

const TILE_HEIGHT = 0.35;

const PAVEMENT = 1.3;

function addGround(batch: GeometryBatch): void {
  const p = new Parts(batch, new THREE.Matrix4());
  // Street-coloured slab: every gap between the raised tiles below reads as a road.
  p.box(MAP_W, 3, MAP_H, 0, -3, 0, topAndSides(PALETTE.street, PALETTE.slabSide));
  p.box(MAP_W + 1.6, 1.4, MAP_H + 1.6, 0, -4.2, 0, PALETTE.slabUnder);
  for (const tile of TILE_SPECS) {
    // A kerbed pavement runs around each block, with the lawn or paving on top.
    p.box(
      tile.width + PAVEMENT * 2,
      TILE_HEIGHT * 0.62,
      tile.depth + PAVEMENT * 2,
      tile.x,
      0,
      tile.z,
      topAndSides(PALETTE.pavement, PALETTE.kerb),
    );
    p.box(tile.width, TILE_HEIGHT, tile.depth, tile.x, 0, tile.z, topAndSides(TILE_TOP[tile.kind], PALETTE.kerb));
  }
  addRoadMarkings(p);
  addPlanting(p);
}

/** Tufts of longer grass and the odd flower, so lawns are not flat colour. */
function addPlanting(p: Parts): void {
  const half = MAP_W / 2;
  const flowers = [PALETTE.flowerA, PALETTE.flowerB, PALETTE.flowerC];
  let seed = 1;
  for (const tile of TILE_SPECS) {
    if (tile.kind === "plaza") continue;
    const count = tile.kind === "border" ? 40 : 10;
    for (let i = 0; i < count; i++) {
      seed += 1;
      const rx = (hash(seed * 3 + 1) - 0.5) * (tile.width - 1.5);
      const rz = (hash(seed * 5 + 2) - 0.5) * (tile.depth - 1.5);
      const x = tile.x + rx;
      const z = tile.z + rz;
      // Keep clear of the middle of a block, where buildings stand.
      if (tile.kind !== "border" && Math.abs(rx) < tile.width * 0.3 && Math.abs(rz) < tile.depth * 0.3) continue;
      const roll = hash(seed * 7 + 3);
      if (roll < 0.22) {
        p.blob(0.12, 0.1, 0.12, x, TILE_HEIGHT + 0.22, z, flowers[Math.floor(roll * 13) % flowers.length]!);
        p.box(0.04, 0.22, 0.04, x, TILE_HEIGHT, z, PALETTE.canopyDark);
      } else {
        p.cone(0.16 + roll * 0.1, 0.34 + roll * 0.3, 5, x, TILE_HEIGHT, z, roll > 0.6 ? PALETTE.canopyDark : PALETTE.canopy);
      }
    }
  }
  void half;
}

/** Deterministic pseudo-random value in [0, 1), matching shared/decor.ts. */
function hash(seed: number): number {
  const s = Math.sin(seed * 12.9898) * 43758.5453123;
  return s - Math.floor(s);
}

/** Centre-line dashes along every street, and zebra crossings at each junction. */
function addRoadMarkings(p: Parts): void {
  const half = MAP_W / 2;
  const first = Math.min(...STREET_LINES);
  const last = Math.max(...STREET_LINES);
  const dashLength = 2.2;
  const gap = 2.6;

  for (const line of STREET_LINES) {
    const axis = line - half;
    for (let along = first + 3; along < last - 3; along += dashLength + gap) {
      const centre = along + dashLength / 2 - half;
      // Skip dashes that would run through a junction.
      const nearJunction = STREET_LINES.some((cross) => Math.abs(along + dashLength / 2 - cross) < 5.5);
      if (nearJunction) continue;
      p.box(0.24, 0.02, dashLength, axis, 0.02, centre, PALETTE.roadLine);
      p.box(dashLength, 0.02, 0.24, centre, 0.02, axis, PALETTE.roadLine);
    }
  }

  for (const x of STREET_LINES) {
    for (const z of STREET_LINES) {
      for (const [dx, dz] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ] as const) {
        for (let stripe = -1.2; stripe <= 1.2; stripe += 0.8) {
          const cx = x - half + dx * 3.2 + (dx === 0 ? stripe : 0);
          const cz = z - half + dz * 3.2 + (dz === 0 ? stripe : 0);
          const w = dx === 0 ? 0.42 : 1.5;
          const d = dx === 0 ? 1.5 : 0.42;
          p.box(w, 0.02, d, cx, 0.02, cz, PALETTE.roadLine);
        }
      }
    }
  }
}

// --- Cottages & trees ---------------------------------------------------------

function addCottage(batch: GeometryBatch, spec: CottageSpec): void {
  const p = new Parts(batch, frame(spec.x, spec.z, facingRotation(spec.facing), spec.scale));
  const wall = WALL_TINTS[spec.tint % WALL_TINTS.length] ?? PALETTE.stone;
  const roof = ROOF_TINTS[spec.tint % ROOF_TINTS.length] ?? PALETTE.chimney;
  const W = 4.4;
  const D = 3.8;
  const H = 2.7;
  const y0 = TILE_HEIGHT;
  p.box(W, H, D, 0, y0, 0, wall);
  p.box(W + 0.12, 0.16, D + 0.12, 0, y0, 0, PALETTE.stoneDark); // footing course
  p.gable(W + 0.6, D + 0.8, 2.1, 0, y0 + H - 0.02, 0, roof);
  p.box(W + 0.7, 0.14, D + 0.9, 0, y0 + H - 0.06, 0, PALETTE.windowFrame); // eaves board
  p.box(0.55, 1.7, 0.55, W * 0.26, y0 + H + 0.3, -D * 0.18, PALETTE.chimney);
  p.box(0.62, 0.16, 0.62, W * 0.26, y0 + H + 1.9, -D * 0.18, PALETTE.stoneDark); // chimney cap

  // Front door with a frame and a step down to the path.
  p.box(1.02, 1.62, 0.08, W * 0.22, y0, D / 2 + 0.02, PALETTE.windowFrame);
  p.box(0.85, 1.45, 0.12, W * 0.22, y0, D / 2 + 0.05, PALETTE.door);
  p.box(1.1, 0.14, 0.45, W * 0.22, y0, D / 2 + 0.22, PALETTE.stone);

  // Front window: glass in a painted frame, with a sill and a flower box.
  p.box(0.96, 0.9, 0.08, -W * 0.22, y0 + H * 0.4, D / 2 + 0.02, PALETTE.windowFrame);
  p.box(0.8, 0.75, 0.1, -W * 0.22, y0 + H * 0.42, D / 2 + 0.05, PALETTE.window);
  p.box(1.06, 0.1, 0.24, -W * 0.22, y0 + H * 0.38, D / 2 + 0.1, PALETTE.windowFrame);
  p.box(0.78, 0.22, 0.26, -W * 0.22, y0 + H * 0.38 + 0.1, D / 2 + 0.12, PALETTE.timber);
  p.blob(0.12, 0.1, 0.12, -W * 0.22 - 0.2, y0 + H * 0.38 + 0.34, D / 2 + 0.12, PALETTE.flowerA);
  p.blob(0.12, 0.1, 0.12, -W * 0.22 + 0.2, y0 + H * 0.38 + 0.34, D / 2 + 0.12, PALETTE.flowerB);

  // Side windows.
  p.box(0.1, 0.86, 0.9, W / 2 + 0.02, y0 + H * 0.45, 0, PALETTE.windowFrame);
  p.box(0.1, 0.7, 0.75, W / 2 + 0.05, y0 + H * 0.45, 0, PALETTE.window);
  p.box(0.1, 0.86, 0.9, -W / 2 - 0.02, y0 + H * 0.45, 0, PALETTE.windowFrame);
  p.box(0.1, 0.7, 0.75, -W / 2 - 0.05, y0 + H * 0.45, 0, PALETTE.window);

  // Garden path from the door to the kerb, with a hedge along the boundary.
  p.box(0.9, 0.04, 1.9, W * 0.22, y0, D / 2 + 1.1, PALETTE.paving);
  p.box(1.5, 0.5, 0.45, -W * 0.28, y0, D / 2 + 1.5, PALETTE.hedge);
}

function addTree(batch: GeometryBatch, spec: TreeSpec, seed: number): void {
  const lean = ((seed % 7) - 3) * 0.015;
  const p = new Parts(batch, frame(spec.x, spec.z, (seed % 9) * 0.7, spec.scale));
  const y0 = TILE_HEIGHT;
  if (spec.variant === "round") {
    p.cylinder(0.2, 0.34, 1.8, 7, 0, y0 - 0.05, 0, PALETTE.trunk);
    p.cylinder(0.14, 0.17, 0.9, 6, 0.28, y0 + 1.5, 0.1, PALETTE.trunk); // a low branch
    // Three overlapping blobs read as foliage rather than one ball.
    p.blob(1.45, 1.3, 1.4, lean * 8, y0 + 2.65, 0, PALETTE.canopy);
    p.blob(0.95, 0.9, 0.95, 0.62, y0 + 3.2, 0.3, PALETTE.canopyLight);
    p.blob(0.8, 0.78, 0.86, -0.6, y0 + 2.95, -0.35, PALETTE.canopyDark);
  } else {
    p.cylinder(0.18, 0.3, 1.3, 7, 0, y0 - 0.05, 0, PALETTE.trunk);
    p.cone(1.45, 1.9, 8, 0, y0 + 0.85, 0, PALETTE.pine);
    p.cone(1.18, 1.7, 8, 0, y0 + 1.95, 0, PALETTE.canopyDark);
    p.cone(0.86, 1.5, 8, 0, y0 + 2.95, 0, PALETTE.pine);
    p.cone(0.5, 1.1, 8, 0, y0 + 3.9, 0, PALETTE.canopy);
  }
}

// --- Signature buildings --------------------------------------------------------

interface SignatureExtras {
  water: GeometryBatch;
  glow: GeometryBatch;
  bell: THREE.Object3D | null;
}

function windowsRow(p: Parts, count: number, width: number, y: number, z: number, skipMiddle = false): void {
  for (let i = 0; i < count; i++) {
    if (skipMiddle && i === Math.floor(count / 2)) continue;
    const x = -width / 2 + (width / count) * (i + 0.5);
    p.box(0.7, 0.8, 0.1, x, y, z, PALETTE.window);
  }
}

function stripedAwning(p: Parts, width: number, y: number, z: number, color: number): void {
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    const x = -width / 2 + (width / stripes) * (i + 0.5);
    p.box(width / stripes, 0.14, 1.5, x, y, z, i % 2 === 0 ? color : PALETTE.windowFrame);
  }
}

function addSignature(batch: GeometryBatch, extras: SignatureExtras, spec: SignatureSpec): void {
  const base = frame(spec.x, spec.z);
  const p = new Parts(batch, base);
  const y0 = TILE_HEIGHT;

  switch (spec.style) {
    case "bakery": {
      p.box(7, 3.4, 5.6, 0, y0, 0, 0xf3e3c6);
      p.gable(7.6, 6.4, 2.6, 0, y0 + 3.38, 0, 0xc0603a);
      p.box(0.7, 2, 0.7, -2.2, y0 + 3.8, -1, PALETTE.chimney);
      p.box(1, 1.7, 0.12, 1.6, y0, 2.83, PALETTE.door);
      p.box(2.4, 1.1, 0.1, -1.4, y0 + 1.1, 2.83, PALETTE.window);
      stripedAwning(p, 5.6, y0 + 2.35, 3.5, 0xc0603a);
      p.box(0.9, 0.9, 0.9, -3.3, y0, 3.9, PALETTE.hay);
      break;
    }
    case "chapel": {
      p.box(5, 4, 8, 0, y0, -0.6, 0xefe7d6);
      p.gable(8.6, 5.6, 3, 0, y0 + 3.98, -0.6, ROOF_TINTS[2]!, Math.PI / 2);
      p.box(2.6, 7.4, 2.6, 0, y0, 3.2, 0xefe7d6);
      p.cone(2.05, 3.4, 4, 0, y0 + 7.4, 3.2, ROOF_TINTS[2]!, Math.PI / 4);
      p.box(0.12, 0.9, 0.12, 0, y0 + 10.8, 3.2, PALETTE.gold);
      p.box(1.1, 1.9, 0.12, 0, y0, 4.53, PALETTE.door);
      p.box(0.9, 0.9, 0.1, 0, y0 + 5, 4.53, PALETTE.window);
      for (const z of [-3.4, -1.2, 1]) {
        p.box(0.1, 1.4, 0.7, 2.53, y0 + 1.4, z, PALETTE.window);
        p.box(0.1, 1.4, 0.7, -2.53, y0 + 1.4, z, PALETTE.window);
      }
      break;
    }
    case "school": {
      p.box(8.4, 5.2, 5.6, 0, y0, 0, 0xf1e2c4);
      p.gable(9, 6.4, 2.4, 0, y0 + 5.18, 0, ROOF_TINTS[2]!);
      windowsRow(p, 4, 8.4, y0 + 1.1, 2.83, true);
      windowsRow(p, 4, 8.4, y0 + 3.3, 2.83);
      p.box(1.2, 1.9, 0.12, 0, y0, 2.83, PALETTE.door);
      p.box(1.3, 1.2, 1.3, 0, y0 + 6.6, 0, PALETTE.windowFrame);
      p.cone(1.1, 1.1, 4, 0, y0 + 7.8, 0, ROOF_TINTS[0]!, Math.PI / 4);
      // Fenced yard with a little tree already provided by decor.
      for (const x of [-4.8, -3.4, -2, 2, 3.4, 4.8]) p.box(0.14, 0.9, 0.14, x, y0, 5.4, PALETTE.windowFrame);
      p.box(9.8, 0.12, 0.1, 0, y0 + 0.7, 5.4, PALETTE.windowFrame);
      break;
    }
    case "market": {
      for (const [x, z] of [
        [-4.2, -2.6],
        [4.2, -2.6],
        [-4.2, 2.6],
        [4.2, 2.6],
      ] as const) {
        p.box(0.45, 3.2, 0.45, x, y0, z, PALETTE.timber);
      }
      p.gable(9.8, 6.8, 2, 0, y0 + 3.2, 0, ROOF_TINTS[0]!);
      p.box(9.2, 0.18, 6, 0, y0 + 3.05, 0, PALETTE.timber);
      const produce = [0xc8453a, 0x7aa84e, 0xe0b04a, 0xd9793a];
      [-2.8, 0, 2.8].forEach((x, i) => {
        p.box(2.2, 0.9, 1.3, x, y0, 0, PALETTE.timber);
        p.box(0.8, 0.4, 0.8, x - 0.5, y0 + 0.9, 0, produce[i % produce.length]!);
        p.box(0.8, 0.4, 0.8, x + 0.5, y0 + 0.9, 0, produce[(i + 1) % produce.length]!);
      });
      // Two open-air stalls on the square side.
      for (const x of [-3, 3]) {
        p.box(2.2, 0.9, 1.2, x, y0, 5.2, PALETTE.timber);
        for (const px of [-1, 1]) p.box(0.14, 2.3, 0.14, x + px, y0, 5.2, PALETTE.timber);
        const q = new Parts(batch, base.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0, 0)));
        stripedAwning(q, 2.6, y0 + 2.3, 5.2, x < 0 ? 0x3f7f7a : 0xc0603a);
      }
      break;
    }
    case "farm": {
      p.box(6, 3.8, 5.2, 2.8, y0, -2, 0xb24b35);
      p.gable(6.6, 6, 3, 2.8, y0 + 3.78, -2, 0x5a4636);
      p.box(2.2, 2.7, 0.12, 2.8, y0, 0.63, PALETTE.windowFrame);
      p.box(1.9, 2.5, 0.14, 2.8, y0, 0.66, 0x8d3a2b);
      for (let row = 0; row < 4; row++) {
        const z = 1.8 + row * 1.5;
        p.box(7.2, 0.25, 0.9, -1.2, y0, z, PALETTE.soil);
        for (let i = 0; i < 7; i++) p.blob(0.32, 0.36, 0.32, -4.4 + i * 1.05, y0 + 0.5, z, PALETTE.crop);
      }
      p.cylinder(0.75, 0.75, 1, 10, -4.6, y0, -3.8, PALETTE.hay);
      p.cylinder(0.75, 0.75, 1, 10, -3, y0, -4.4, PALETTE.hay);
      break;
    }
    case "clinic": {
      p.box(7.2, 3.8, 5.6, 0, y0, 0, 0xfbf8f1);
      p.gable(7.8, 6.4, 2.4, 0, y0 + 3.78, 0, 0x3f7f7a);
      p.box(1.2, 1.8, 0.12, 0, y0, 2.83, PALETTE.door);
      p.box(1.4, 0.36, 0.1, 0, y0 + 2.6, 2.86, PALETTE.cross);
      p.box(0.36, 1.4, 0.1, 0, y0 + 2.08, 2.86, PALETTE.cross);
      windowsRow(p, 4, 7.2, y0 + 1.3, 2.83, true);
      break;
    }
    case "library": {
      p.box(8.4, 4.6, 5.4, 0, y0, -0.6, PALETTE.stone);
      p.gable(9, 6, 1.8, 0, y0 + 4.58, -0.6, ROOF_TINTS[2]!);
      p.box(8.8, 0.35, 2.2, 0, y0, 3, PALETTE.stoneDark);
      for (const x of [-3, -1, 1, 3]) p.cylinder(0.32, 0.36, 3.9, 10, x, y0 + 0.35, 3.3, PALETTE.windowFrame);
      p.box(8.8, 0.45, 2.4, 0, y0 + 4.2, 3, PALETTE.stone);
      p.gable(8.8, 2.6, 1, 0, y0 + 4.63, 3, PALETTE.stone);
      p.box(1.3, 2.2, 0.12, 0, y0 + 0.35, 2.13, PALETTE.door);
      break;
    }
    case "tavern": {
      p.box(6.8, 2.6, 5.6, 0, y0, 0, 0xf3e8d2);
      p.box(7.1, 2.3, 5.9, 0, y0 + 2.6, 0, 0x9a6a47);
      p.gable(7.7, 6.8, 2.6, 0, y0 + 4.88, 0, 0x7d4a32);
      p.box(0.7, 2, 0.7, 2.4, y0 + 5.4, -1.2, PALETTE.chimney);
      p.box(1.1, 1.7, 0.12, -1.8, y0, 2.83, PALETTE.door);
      windowsRow(p, 3, 6.8, y0 + 0.9, 2.83, false);
      windowsRow(p, 3, 7.1, y0 + 3.3, 2.98);
      p.box(0.14, 3, 0.14, 3.9, y0, 3.6, PALETTE.timber);
      p.box(1.5, 0.12, 0.12, 3.25, y0 + 2.9, 3.6, PALETTE.timber);
      p.box(1.1, 0.8, 0.1, 3.1, y0 + 1.95, 3.6, PALETTE.gold);
      p.cylinder(0.45, 0.45, 0.9, 10, -3.8, y0, 3.8, PALETTE.timber);
      p.cylinder(0.45, 0.45, 0.9, 10, -2.8, y0, 4.2, PALETTE.timber);
      break;
    }
    case "forge": {
      p.box(6.4, 3.2, 5.2, 0, y0, 0, 0x8d8577);
      p.gable(7, 6, 2.4, 0, y0 + 3.18, 0, 0x4a4a4a);
      p.box(1.4, 6.8, 1.4, -2.2, y0, -1.2, PALETTE.stoneDark);
      p.box(2.6, 1.9, 0.12, 1, y0, 2.63, 0x2d2a26);
      p.box(0.8, 0.5, 0.5, 1, y0 + 0.6, 3.5, 0x3a3a3a);
      p.box(0.4, 0.6, 0.4, 1, y0, 3.5, 0x3a3a3a);
      new Parts(extras.glow, base).box(2.2, 1, 0.14, 1, y0 + 0.3, 2.66, PALETTE.ember);
      break;
    }
    case "docks": {
      // The block is mostly harbour water, with a quay, pier, boathouse and a boat.
      p.box(15.4, 0.1, 5, 0, y0 - 0.08, -5.2, PALETTE.stone);
      new Parts(extras.water, base).box(15.4, 0.25, 10.4, 0, 0, 2.6, PALETTE.water);
      p.box(2.2, 0.3, 8, 3, y0, 2.4, PALETTE.timber);
      for (const z of [-0.8, 2.4, 5.6]) {
        p.cylinder(0.2, 0.2, 1.6, 6, 1.95, -0.6, z, PALETTE.timber);
        p.cylinder(0.2, 0.2, 1.6, 6, 4.05, -0.6, z, PALETTE.timber);
      }
      p.box(5, 3, 3.8, -4.2, y0, -5.1, 0xe9dcc0);
      p.gable(5.6, 4.6, 2, -4.2, y0 + 2.98, -5.1, 0x7d4a32);
      p.box(1.6, 0.7, 3.8, -2.6, 0.05, 3, 0x9b6b45);
      p.box(0.12, 3, 0.12, -2.6, 0.7, 3, PALETTE.timber);
      p.box(0.9, 0.9, 0.9, 5.6, y0, -5.4, PALETTE.hay);
      p.box(0.9, 0.9, 0.9, 6.6, y0, -4.6, PALETTE.timber);
      break;
    }
    case "watchtower": {
      p.box(4.4, 1, 4.4, 0, y0, 0, PALETTE.stoneDark);
      p.box(3.4, 10, 3.4, 0, y0 + 1, 0, PALETTE.stone);
      p.box(0.9, 1.6, 0.12, 0, y0 + 1, 1.73, PALETTE.door);
      for (const y of [4, 7]) p.box(0.5, 0.9, 0.1, 0, y0 + y, 1.73, PALETTE.window);
      p.box(4, 0.35, 4, 0, y0 + 11, 0, PALETTE.stoneDark);
      for (const [x, z] of [
        [-1.7, -1.7],
        [1.7, -1.7],
        [-1.7, 1.7],
        [1.7, 1.7],
      ] as const) {
        p.box(0.35, 2.6, 0.35, x, y0 + 11.35, z, PALETTE.timber);
      }
      p.cone(3.2, 2.6, 4, 0, y0 + 13.9, 0, ROOF_TINTS[0]!, Math.PI / 4);
      p.box(0.1, 1.4, 0.1, 0, y0 + 16.4, 0, PALETTE.lamp);
      p.box(0.9, 0.5, 0.05, 0.45, y0 + 17.2, 0, PALETTE.cross);

      const bell = new THREE.Group();
      bell.name = "bell";
      bell.position.set(spec.x, y0 + 13.8, spec.z);
      const bellMaterial = new THREE.MeshLambertMaterial({ color: PALETTE.gold });
      const bellBody = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 1.3, 12), bellMaterial);
      bellBody.position.y = -0.8;
      bellBody.castShadow = true;
      bell.add(bellBody);
      extras.bell = bell;
      break;
    }
  }
}

// --- Plaza & parks ----------------------------------------------------------------

function addPlaza(batch: GeometryBatch, water: GeometryBatch): void {
  const base = frame(PLAZA_SPEC.x, PLAZA_SPEC.z);
  const p = new Parts(batch, base);
  const y0 = TILE_HEIGHT;
  p.cylinder(6.8, 6.8, 0.06, 40, 0, y0, 0, PALETTE.pavingDark);
  p.cylinder(3.6, 3.8, 0.7, 32, 0, y0, 0, PALETTE.stone);
  new Parts(water, base).cylinder(3.15, 3.15, 0.1, 32, 0, y0 + 0.62, 0, PALETTE.water);
  p.cylinder(0.45, 0.6, 1.9, 12, 0, y0 + 0.6, 0, PALETTE.stone);
  p.cylinder(1.3, 0.5, 0.45, 16, 0, y0 + 2.2, 0, PALETTE.stone);
  new Parts(water, base).cylinder(1.12, 1.12, 0.06, 16, 0, y0 + 2.6, 0, PALETTE.water);

  const ring = 5.4;
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bench = new Parts(
      batch,
      base.clone().multiply(
        new THREE.Matrix4().compose(
          new THREE.Vector3(Math.cos(angle) * ring, 0, Math.sin(angle) * ring),
          new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -angle - Math.PI / 2),
          new THREE.Vector3(1, 1, 1),
        ),
      ),
    );
    // Slatted seat and back on cast-iron legs.
    for (const dz of [-0.24, 0, 0.24]) bench.box(2, 0.1, 0.2, 0, y0 + 0.45, dz, PALETTE.bench);
    for (const dy of [0.62, 0.88]) bench.box(2, 0.18, 0.1, 0, y0 + dy, -0.3, PALETTE.bench);
    for (const dx of [-0.85, 0.85]) {
      bench.box(0.1, 0.45, 0.12, dx, y0, -0.24, PALETTE.lamp);
      bench.box(0.1, 0.45, 0.12, dx, y0, 0.22, PALETTE.lamp);
      bench.box(0.1, 0.12, 0.6, dx, y0 + 0.44, 0, PALETTE.lamp);
      bench.box(0.1, 0.55, 0.12, dx, y0 + 0.45, -0.3, PALETTE.lamp);
    }
  }
  for (const [x, z] of [
    [0, -7.2],
    [7.2, 0],
    [0, 7.2],
    [-7.2, 0],
  ] as const) {
    p.cylinder(0.1, 0.12, 2.6, 6, x, y0, z, PALETTE.lamp);
    p.blob(0.32, 0.32, 0.32, x, y0 + 2.8, z, 0xfff1c9);
  }
}

function addPond(batch: GeometryBatch, water: GeometryBatch, x: number, z: number): void {
  const base = frame(x, z);
  const p = new Parts(batch, base);
  const y0 = TILE_HEIGHT;
  p.cylinder(3.9, 4.1, 0.3, 28, 0, y0 - 0.1, 0, PALETTE.stone);
  new Parts(water, base).cylinder(3.45, 3.45, 0.12, 28, 0, y0 + 0.14, 0, PALETTE.water);
  p.blob(0.5, 0.35, 0.5, 2.2, y0 + 0.3, -1.4, PALETTE.stoneDark);
  p.box(1.8, 0.18, 0.6, 0, y0 + 0.45, 4.9, PALETTE.bench);
  p.box(1.8, 0.5, 0.12, 0, y0 + 0.6, 5.2, PALETTE.bench);
}

// --- Public builders --------------------------------------------------------------

export interface TownScenery {
  /** Everything that doesn't move, merged. */
  root: THREE.Group;
  /** The watchtower bell, pivoting at its hanger so it can swing. */
  bell: THREE.Object3D | null;
  /** Water droplets arcing out of the fountain, animated by the caller. */
  fountainJets: THREE.InstancedMesh;
  dispose: () => void;
}

export const FOUNTAIN_JET_COUNT = 36;

export function buildTownScenery(): TownScenery {
  const root = new THREE.Group();
  root.name = "scenery";

  const solid = new GeometryBatch();
  const water = new GeometryBatch();
  const glow = new GeometryBatch();
  const extras: SignatureExtras = { water, glow, bell: null };

  addGround(solid);
  for (const cottage of COTTAGE_SPECS) addCottage(solid, cottage);
  TREE_SPECS.forEach((tree, i) => addTree(solid, tree, i));
  for (const signature of SIGNATURE_SPECS) addSignature(solid, extras, signature);
  addPlaza(solid, water);
  for (const pond of POND_SPECS) addPond(solid, water, pond.x, pond.z);

  const solidMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const solidMesh = solid.build(solidMaterial, "town-solid");
  solidMesh.castShadow = true;
  solidMesh.receiveShadow = true;
  root.add(solidMesh);

  const waterMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.15,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
  });
  const waterMesh = water.build(waterMaterial, "town-water");
  waterMesh.receiveShadow = true;
  root.add(waterMesh);

  const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  root.add(glow.build(glowMaterial, "town-glow"));

  if (extras.bell) root.add(extras.bell);

  const jetMaterial = new THREE.MeshLambertMaterial({ color: 0xe6f6f7, transparent: true, opacity: 0.85 });
  const fountainJets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 6, 5), jetMaterial, FOUNTAIN_JET_COUNT);
  fountainJets.name = "fountain-jets";
  fountainJets.frustumCulled = false;
  root.add(fountainJets);

  return {
    root,
    bell: extras.bell,
    fountainJets,
    dispose: () => disposeObject(root),
  };
}

/** Plaza centre, where the fountain jets originate. */
export const FOUNTAIN_ORIGIN = new THREE.Vector3(PLAZA_SPEC.x, TILE_HEIGHT + 2.7, PLAZA_SPEC.z);

const jetMatrix = new THREE.Matrix4();

const jetScale = new THREE.Vector3();
const jetQuaternion = new THREE.Quaternion();
const jetPosition = new THREE.Vector3();

/**
 * Places each droplet on its parabolic arc for time `t` (seconds). Every
 * droplet gets its own offset along the arc, so the spray reads as a
 * continuous fall of water rather than a ring of beads moving in lockstep.
 */
export function updateFountainJets(jets: THREE.InstancedMesh, t: number): void {
  for (let i = 0; i < FOUNTAIN_JET_COUNT; i++) {
    const arc = i % 9;
    const angle = (arc / 9) * Math.PI * 2 + (i % 3) * 0.21;
    const offset = (i * 0.6180339887) % 1; // golden ratio: evenly spread, never repeating
    const phase = (t * 0.75 + offset) % 1;
    const reach = 2.5 * phase;
    const height = 1.7 * 4 * phase * (1 - phase) - phase * 1.9;
    jetPosition.set(
      FOUNTAIN_ORIGIN.x + Math.cos(angle) * reach,
      FOUNTAIN_ORIGIN.y + height,
      FOUNTAIN_ORIGIN.z + Math.sin(angle) * reach,
    );
    // Droplets stretch as they fall and shrink as they break up near the basin.
    const size = 0.75 + (1 - phase) * 0.5;
    jetScale.set(size, size * (0.8 + phase * 0.7), size);
    jetMatrix.compose(jetPosition, jetQuaternion, jetScale);
    jets.setMatrixAt(i, jetMatrix);
  }
  jets.instanceMatrix.needsUpdate = true;
}

// --- Citizens -----------------------------------------------------------------------

export interface CitizenFigure {
  group: THREE.Group;
  /** Bobs and leans while walking; the ground rings below stay put. */
  body: THREE.Group;
  /** Torso, head, hair and hat, baked into one smooth-shaded mesh. */
  upper: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>;
  /** Swing from the shoulder and hip during the walk cycle. */
  limbs: {
    armLeft: THREE.Object3D;
    armRight: THREE.Object3D;
    legLeft: THREE.Object3D;
    legRight: THREE.Object3D;
  };
  focusRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  pulseRing: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

const HAIR_COLORS = [0x3b2a20, 0x6b4a2e, 0xc9a26a, 0x2b2622, 0x8a4b2a, 0x9a9590, 0x5a3a28];
const SKIN_TONES = [0xf0d3b3, 0xe8c19a, 0xd9a877, 0xb98555, 0x8d5f3c, 0xf5ddc3];
const TROUSER_COLORS = [0x3f4a5a, 0x4a4036, 0x2f3a3f, 0x5a4a3a, 0x374152];
const SHOE_COLOR = 0x3a2f28;
const HAT_COLORS = [0x6b5a45, 0x8d6a4a, 0x4a4a52];

/** Deterministic pick so a citizen always looks the same. */
function pick<T>(list: readonly T[], seed: number): T {
  return list[Math.abs(Math.round(seed)) % list.length] as T;
}

function unitRandom(seed: number): number {
  const v = Math.sin(seed * 45.233) * 21893.15;
  return v - Math.floor(v);
}

/**
 * Body plan, in world units. Deliberately stylised at roughly four heads tall
 * rather than an adult's seven: at the default camera a citizen is only about
 * twenty pixels high, and a larger head is what makes them read as a person
 * and shows which way they are facing. Realistic proportions at this size
 * turn to mush, and clash with the low-poly buildings around them.
 */
const BODY = {
  height: 2.3,
  hipY: 0.86,
  shoulderY: 1.52,
  headY: 1.95,
  headRadius: 0.27,
  torsoTop: 0.235,
  torsoWaist: 0.195,
  /** Torsos and heads are deeper than they are wide by this factor. */
  depth: 0.8,
};

/**
 * Citizens are drawn about a third larger than their true scale against the
 * buildings. At the town-wide camera a true-to-scale figure is a speck, and the
 * whole point of the game is watching the crowd react, so legibility wins over
 * strict scale - the same trade the reference demo makes.
 */
export const CITIZEN_SCALE = 1.35;

/** Smooth-shaded parts keep their own normals, so limbs look rounded, not faceted. */
class SmoothBatch {
  private readonly parts: THREE.BufferGeometry[] = [];
  private readonly color = new THREE.Color();

  add(source: THREE.BufferGeometry, matrix: THREE.Matrix4, color: number): void {
    const geometry = source.clone();
    geometry.applyMatrix4(matrix);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    this.color.setHex(color);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }

  build(): THREE.BufferGeometry {
    const merged = this.parts.length > 0 ? mergeGeometries(this.parts, false) : new THREE.BufferGeometry();
    for (const part of this.parts) part.dispose();
    this.parts.length = 0;
    return merged ?? new THREE.BufferGeometry();
  }
}

// Shared source geometries: every citizen is assembled from transformed copies.
const CAPSULE = new THREE.CapsuleGeometry(1, 1, 5, 12);
const SPHERE = new THREE.SphereGeometry(1, 16, 12);
const TAPER = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false);
const DISC = new THREE.CylinderGeometry(1, 1, 1, 16);

const scratch = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

function place(x: number, y: number, z: number, sx: number, sy: number, sz: number, rotX = 0): THREE.Matrix4 {
  scratchPos.set(x, y, z);
  scratchQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), rotX);
  scratchScale.set(sx, sy, sz);
  return scratch.compose(scratchPos, scratchQuat, scratchScale);
}

/**
 * A pedestrian built from rounded, tapered parts: a torso that narrows at the
 * waist, shoulders and hips turned by spheres, capsule limbs with visible
 * hands and shoes, and a head that is an ovoid rather than a ball. Everything
 * that does not move independently is baked into one smooth-shaded mesh, so a
 * crowd of fifty stays at five draw calls each.
 */
export function createCitizenFigure(paletteIndex: number, seed: number): CitizenFigure {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const shirt = CITIZEN_PALETTE[paletteIndex % CITIZEN_PALETTE.length] ?? CITIZEN_PALETTE[0]!;
  const skin = pick(SKIN_TONES, seed * 7 + 1);
  const hair = pick(HAIR_COLORS, seed * 5 + 3);
  const trousers = pick(TROUSER_COLORS, seed * 11 + 5);
  const hasHat = seed % 6 === 0;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });

  // Height and build vary a little, so a crowd isn't fifty copies of one body.
  const stature = 0.93 + unitRandom(seed * 3 + 2) * 0.14;
  const build = 0.92 + unitRandom(seed * 13 + 7) * 0.18;
  body.scale.set(build * CITIZEN_SCALE, stature * CITIZEN_SCALE, build * CITIZEN_SCALE);

  const d = BODY.depth;
  const y0 = TILE_HEIGHT;

  const upperBatch = new SmoothBatch();
  // Torso: tapered from chest to waist, with a rounded chest and hips.
  upperBatch.add(
    TAPER,
    place(0, y0 + (BODY.hipY + BODY.shoulderY) / 2, 0, BODY.torsoTop, BODY.shoulderY - BODY.hipY, BODY.torsoTop * d),
    shirt,
  );
  upperBatch.add(SPHERE, place(0, y0 + BODY.shoulderY, 0, BODY.torsoTop, BODY.torsoTop * 0.8, BODY.torsoTop * d), shirt);
  upperBatch.add(SPHERE, place(0, y0 + BODY.hipY, 0, BODY.torsoWaist * 1.15, BODY.torsoWaist, BODY.torsoWaist * d), trousers);
  // Neck and head.
  upperBatch.add(CAPSULE, place(0, y0 + BODY.shoulderY + 0.09, 0, 0.075, 0.07, 0.075), skin);
  upperBatch.add(
    SPHERE,
    place(0, y0 + BODY.headY, 0, BODY.headRadius * 0.92, BODY.headRadius * 1.12, BODY.headRadius),
    skin,
  );
  // Hair: a skull cap that follows the head, slightly fuller at the back.
  upperBatch.add(
    SPHERE,
    place(0, y0 + BODY.headY + 0.035, -0.012, BODY.headRadius * 0.96, BODY.headRadius * 1.0, BODY.headRadius * 1.04),
    hair,
  );
  if (hasHat) {
    const hatColor = pick(HAT_COLORS, seed * 17 + 2);
    upperBatch.add(DISC, place(0, y0 + BODY.headY + 0.2, 0, 0.4, 0.03, 0.4), hatColor);
    upperBatch.add(DISC, place(0, y0 + BODY.headY + 0.3, 0, 0.235, 0.18, 0.235), hatColor);
  }

  const upper = new THREE.Mesh(upperBatch.build(), material);
  upper.castShadow = true;
  body.add(upper);

  /** Limbs hang from their pivot, so rotating the pivot swings them. */
  function limb(kind: "arm" | "leg", side: -1 | 1): THREE.Object3D {
    const pivot = new THREE.Object3D();
    const batch = new SmoothBatch();
    if (kind === "arm") {
      const upperArm = 0.26;
      const foreArm = 0.24;
      batch.add(SPHERE, place(0, 0, 0, 0.075, 0.075, 0.075), shirt); // shoulder joint
      batch.add(CAPSULE, place(0, -upperArm / 2 - 0.02, 0, 0.068, upperArm, 0.068), shirt);
      batch.add(CAPSULE, place(0, -upperArm - foreArm / 2 - 0.02, 0, 0.06, foreArm, 0.06), skin);
      batch.add(SPHERE, place(0, -upperArm - foreArm - 0.1, 0, 0.07, 0.085, 0.058), skin); // hand
      pivot.position.set(side * (BODY.torsoTop + 0.045), y0 + BODY.shoulderY - 0.03, 0);
    } else {
      const thigh = 0.36;
      const shin = 0.32;
      batch.add(SPHERE, place(0, 0, 0, 0.1, 0.1, 0.1), trousers); // hip joint
      batch.add(CAPSULE, place(0, -thigh / 2 - 0.02, 0, 0.095, thigh, 0.095), trousers);
      batch.add(SPHERE, place(0, -thigh - 0.04, 0, 0.082, 0.082, 0.082), trousers); // knee
      batch.add(CAPSULE, place(0, -thigh - shin / 2 - 0.06, 0, 0.082, shin, 0.082), trousers);
      batch.add(CAPSULE, place(0, -thigh - shin - 0.12, 0.045, 0.085, 0.13, 0.085, Math.PI / 2), SHOE_COLOR);
      pivot.position.set(side * 0.105, y0 + BODY.hipY - 0.02, 0);
    }
    const mesh = new THREE.Mesh(batch.build(), material);
    mesh.castShadow = true;
    pivot.add(mesh);
    body.add(pivot);
    return pivot;
  }

  const limbs = {
    armLeft: limb("arm", -1),
    armRight: limb("arm", 1),
    legLeft: limb("leg", -1),
    legRight: limb("leg", 1),
  };

  const focusRing = new THREE.Mesh(
    new THREE.RingGeometry(0.42 * CITIZEN_SCALE, 0.6 * CITIZEN_SCALE, 28),
    new THREE.MeshBasicMaterial({ color: FOCUS_COLOR, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  focusRing.rotation.x = -Math.PI / 2;
  focusRing.position.y = TILE_HEIGHT + 0.06;
  focusRing.visible = false;
  group.add(focusRing);

  const pulseRing = new THREE.Mesh(
    new THREE.RingGeometry(0.36 * CITIZEN_SCALE, 0.48 * CITIZEN_SCALE, 28),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }),
  );
  pulseRing.rotation.x = -Math.PI / 2;
  pulseRing.position.y = TILE_HEIGHT + 0.08;
  pulseRing.visible = false;
  group.add(pulseRing);

  return { group, body, upper, limbs, focusRing, pulseRing };
}

/** Height of a citizen's head above the ground, for badges and hit targets. */
export const CITIZEN_HEAD_HEIGHT = TILE_HEIGHT + (BODY.headY + BODY.headRadius) * CITIZEN_SCALE;

export function actionColor(action: string | null): number {
  if (!action) return 0x2b2620;
  return ACTION_COLOR[action] ?? 0x2b2620;
}

/** Recursively frees GPU resources for every geometry/material under `object`, including `object` itself. */
export function disposeObject(object: THREE.Object3D): void {
  object.traverse((child: THREE.Object3D) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else {
        material.dispose();
      }
    }
  });
}

export { TILE_HEIGHT };
