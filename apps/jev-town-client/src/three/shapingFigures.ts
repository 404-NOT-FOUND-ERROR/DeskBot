import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { CitizenFigure } from "./buildScene.ts";
import { FOCUS_COLOR } from "./palette.ts";

/** Authored first forms, keyed by identity. Appearance never implies a new memory or evolution. */
export const SHAPING_FORMS = {
  "shaping-001": { shell: 0xf3e5cf, accent: 0xc48fbd, light: 0xffe8ae, feature: "seed-crown" },
  "pathfinder-001": { shell: 0xc99a75, accent: 0x738987, light: 0xffd4a1, feature: "route-map" },
  "shade-collector-001": { shell: 0x8fa47c, accent: 0x4e7764, light: 0xc3edc7, feature: "light-tube" },
  "echo-postcarrier-001": { shell: 0x91b6c2, accent: 0x507b8e, light: 0xc0e9f3, feature: "mail-bag" },
  "wetland-grower-001": { shell: 0x99b480, accent: 0x607a48, light: 0xd8edb4, feature: "seed-pouch" },
  "pot-cook-001": { shell: 0xedc48e, accent: 0xb17b51, light: 0xffe7ab, feature: "pot-lid" },
  "spare-mender-001": { shell: 0xa3adb9, accent: 0x5c7780, light: 0xc8eef0, feature: "button-box" },
  "market-trader-001": { shell: 0xd5a88c, accent: 0x926c57, light: 0xffe1bd, feature: "trade-jar" },
  "thread-tailor-001": { shell: 0xc8a1bb, accent: 0x916986, light: 0xf3cfea, feature: "patch-ears" },
  "lamp-keeper-001": { shell: 0xd2be7b, accent: 0x877754, light: 0xffdf83, feature: "lamp-fruit" },
  "sound-player-001": { shell: 0xc19983, accent: 0x7d5f56, light: 0xffd4ae, feature: "drum-buds" },
  "town-reporter-001": { shell: 0xa7b7a4, accent: 0x657c76, light: 0xdfedca, feature: "paper-leaves" },
  "drifting-visitor-001": { shell: 0xb0c2d3, accent: 0x748c9c, light: 0xd1e7ff, feature: "island-pebble" },
} as const;

const Y0 = 0.35;
const SCALE = 1.35;
const MOTE_COUNT = 7;
const EYE_COLOR = 0x293c43;
type Form = (typeof SHAPING_FORMS)[keyof typeof SHAPING_FORMS];

// Only the source primitives are shared. Each resulting geometry/material has one figure's lifetime.
const ball = new THREE.SphereGeometry(1, 14, 10);
const box = new THREE.BoxGeometry(1, 1, 1);
const cylinder = new THREE.CylinderGeometry(1, 1, 1, 14);
const cone = new THREE.ConeGeometry(1, 1, 10);
const torus = new THREE.TorusGeometry(1, 0.14, 5, 18);

class FigureParts {
  private readonly parts: THREE.BufferGeometry[] = [];
  add(source: THREE.BufferGeometry, color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, rz = 0): void {
    const geometry = source.clone();
    // Keep a consistent attribute layout when merging toruses, boxes and spheres.
    geometry.deleteAttribute("uv");
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz));
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(sx, sy, sz)));
    const tint = new THREE.Color(color);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = tint.r; colors[i * 3 + 1] = tint.g; colors[i * 3 + 2] = tint.b; }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.parts.push(geometry);
  }
  mesh(material: THREE.Material, name: string): THREE.Mesh {
    const geometry = mergeGeometries(this.parts, false) ?? new THREE.BufferGeometry();
    this.parts.forEach(part => part.dispose());
    this.parts.length = 0;
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = true;
    return mesh;
  }
}

/** Props are deliberately substantial silhouettes, rather than tiny label ornaments. */
function addIdentity(p: FigureParts, f: Form): void {
  const top = Y0 + 2.02;
  const ivory = 0xf4ead5;
  switch (f.feature) {
    case "seed-crown":
      p.add(ball, f.accent, -.27, top + .06, -.02, .16, .22, .10, 0, -.4);
      p.add(ball, f.shell, .29, top + .03, -.02, .18, .14, .11, 0, .5);
      p.add(torus, f.accent, .03, Y0 + .9, .37, .12, .12, .18);
      break;
    case "route-map":
      for (const side of [-1, 1]) p.add(cone, f.accent, side * .28, top + .07, -.03, .10, .27, .10, 0, -side * .25);
      p.add(box, ivory, .35, Y0 + .88, .35, .36, .38, .035, 0, -.18);
      p.add(box, f.accent, .34, Y0 + .87, .375, .025, .29, .012, 0, -.18);
      p.add(box, f.accent, .33, Y0 + .88, .38, .23, .018, .012, 0, .36);
      break;
    case "light-tube":
      for (const side of [-1, 1]) p.add(ball, f.accent, side * .18, top + .13, 0, .13, .24, .05, 0, -side * .52);
      p.add(cylinder, f.accent, .4, Y0 + .83, .20, .13, .50, .13, 0, -.18);
      p.add(torus, ivory, .43, Y0 + 1.07, .20, .13, .13, .12, Math.PI / 2, -.18);
      break;
    case "mail-bag":
      p.add(box, f.accent, -.35, top + .07, 0, .22, .26, .09, 0, .30);
      p.add(box, f.shell, .32, top + .1, 0, .23, .32, .10, 0, -.28);
      p.add(ball, f.accent, .34, Y0 + .79, .18, .26, .31, .18);
      p.add(box, ivory, .36, Y0 + .93, .36, .22, .14, .024, 0, -.2);
      p.add(box, f.accent, -.16, Y0 + 1.1, .32, .06, .65, .028, 0, -.48);
      break;
    case "seed-pouch":
      p.add(ball, f.accent, .04, top + .03, -.02, .40, .10, .32, 0, -.18);
      p.add(ball, f.shell, .18, top + .15, 0, .14, .19, .05, 0, -.65);
      p.add(ball, f.accent, -.35, Y0 + .77, .18, .19, .22, .15);
      p.add(ball, ivory, -.37, Y0 + .83, .325, .055, .075, .02);
      break;
    case "pot-lid":
      p.add(cylinder, f.accent, 0, top + .03, 0, .49, .08, .42, 0, -.13);
      p.add(ball, f.accent, .02, top + .12, 0, .10, .06, .08);
      p.add(box, ivory, 0, Y0 + .85, .34, .49, .48, .055);
      p.add(box, f.accent, .04, Y0 + .71, .379, .27, .13, .012);
      p.add(cylinder, f.accent, .40, Y0 + .91, .29, .035, .42, .035, 0, -.23);
      p.add(ball, f.accent, .45, Y0 + 1.13, .29, .09, .14, .04, 0, -.23);
      break;
    case "button-box":
      p.add(torus, ivory, -.16, Y0 + 1.0, .34, .17, .17, .18);
      p.add(torus, f.accent, .16, Y0 + .76, .35, .14, .14, .18);
      p.add(box, f.accent, .32, Y0 + .85, -.28, .38, .47, .19);
      p.add(box, ivory, .33, Y0 + .95, -.395, .24, .22, .035);
      p.add(cylinder, f.accent, -.28, top + .08, -.02, .12, .15, .12);
      break;
    case "trade-jar":
      p.add(cylinder, f.accent, 0, top, 0, .40, .09, .37);
      p.add(cylinder, ivory, 0, top + .09, 0, .24, .11, .24);
      for (const side of [-1, 1]) p.add(box, ivory, side * .19, Y0 + .88, .37, .14, .22, .025, 0, side * .24);
      p.add(torus, f.accent, .33, Y0 + 1.06, .1, .14, .14, .18);
      break;
    case "patch-ears":
      p.add(ball, f.accent, -.30, top + .13, 0, .15, .28, .09, 0, -.19);
      p.add(ball, ivory, .31, top + .04, 0, .17, .18, .09, 0, .43);
      p.add(box, ivory, -.18, Y0 + .82, .345, .19, .24, .035, 0, .2);
      for (let i = 0; i < 4; i++) p.add(box, f.accent, -.28 + i * .06, Y0 + .82, .37, .023, .042, .012, 0, .55);
      p.add(torus, f.accent, .40, Y0 + .83, .16, .13, .13, .24);
      break;
    case "lamp-fruit":
      p.add(cylinder, f.accent, 0, top + .09, 0, .043, .30, .043, 0, -.18);
      p.add(ball, f.accent, .06, top + .17, -.03, .13, .05, .11);
      p.add(ball, ivory, -.34, Y0 + .85, .1, .14, .23, .13);
      p.add(torus, f.accent, -.34, Y0 + .91, .1, .16, .16, .15, Math.PI / 2);
      break;
    case "drum-buds":
      for (const side of [-1, 1]) { p.add(cylinder, f.accent, side * .27, top + .1, -.02, .16, .20, .16); p.add(cylinder, ivory, side * .27, top + .21, -.02, .17, .025, .17); }
      p.add(cylinder, f.accent, 0, Y0 + .83, .36, .28, .17, .28, Math.PI / 2);
      p.add(cylinder, ivory, 0, Y0 + .83, .46, .25, .025, .25, Math.PI / 2);
      p.add(cylinder, ivory, .34, Y0 + 1.02, .31, .029, .35, .029, 0, -.45);
      break;
    case "paper-leaves":
      p.add(box, ivory, -.29, top + .10, 0, .24, .30, .05, 0, -.35);
      p.add(box, f.accent, .30, top + .07, 0, .23, .25, .05, 0, .43);
      p.add(box, ivory, -.05, Y0 + .86, .36, .41, .36, .04, 0, -.07);
      for (let i = 0; i < 3; i++) p.add(box, f.accent, -.06, Y0 + .93 - i * .07, .389, .25, .018, .01, 0, -.07);
      p.add(cylinder, f.accent, .37, Y0 + .93, .25, .029, .41, .029, 0, -.25);
      break;
    case "island-pebble":
      p.add(ball, f.accent, 0, top - .03, 0, .43, .12, .34);
      p.add(ball, ivory, .17, top + .09, -.01, .12, .10, .095);
      p.add(ball, f.accent, -.32, Y0 + .78, .16, .19, .25, .14);
      p.add(box, ivory, -.33, Y0 + .83, .30, .15, .095, .018);
      break;
  }
}

/**
 * Common recognition anchors: pear shell, seed eyes, a suspended chest pearl,
 * stubby feet and light grains settling towards the same body. No licensed character silhouettes.
 */
export function createShapingFigure(style: string, seed: number): CitizenFigure {
  const form = SHAPING_FORMS[style as keyof typeof SHAPING_FORMS] ?? SHAPING_FORMS["shaping-001"];
  const own = style === "shaping-001";
  const group = new THREE.Group(); group.name = `shaping-being:${style}`;
  group.userData.shaping_form = form.feature;
  group.userData.visual_only = true;
  const body = new THREE.Group(); body.name = "shaping-body"; group.add(body);
  body.scale.setScalar(SCALE);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const parts = new FigureParts();
  parts.add(ball, form.shell, 0, Y0 + .88, -.015, .43, .56, .35);
  parts.add(ball, form.shell, 0, Y0 + 1.68, .015, own ? .55 : .50, .47, .44);
  // A small lower lip and cheeks give the face a readable front without painted textures.
  parts.add(ball, 0xf5eddc, 0, Y0 + 1.50, .33, .22, .11, .12);
  for (const side of [-1, 1]) parts.add(ball, form.accent, side * .29, Y0 + 1.59, .372, .066, .027, .019);
  addIdentity(parts, form);
  const upper = parts.mesh(material, "condensed-shell") as CitizenFigure["upper"]; body.add(upper);

  function limb(kind: "arm" | "leg", side: -1 | 1): THREE.Object3D {
    const pivot = new THREE.Group(); pivot.name = `${kind}:${side < 0 ? "left" : "right"}`;
    const p = new FigureParts();
    if (kind === "arm") {
      p.add(ball, form.shell, 0, -.15, 0, .13, .23, .125);
      p.add(ball, 0xf3e6d1, 0, -.33, .02, .115, .12, .11);
      pivot.position.set(side * .42, Y0 + 1.12, 0);
    } else {
      p.add(ball, form.accent, 0, -.10, .025, .16, .18, .19);
      p.add(ball, form.shell, 0, -.15, .12, .17, .12, .20);
      pivot.position.set(side * .22, Y0 + .30, 0);
    }
    pivot.add(p.mesh(material, `rounded-${kind}`)); body.add(pivot); return pivot;
  }
  const limbs = { armLeft: limb("arm", -1), armRight: limb("arm", 1), legLeft: limb("leg", -1), legRight: limb("leg", 1) };

  const face = new THREE.Group(); face.name = "seed-eyes"; face.position.set(0, Y0 + 1.73, .446);
  const eyeParts = new FigureParts();
  for (const side of [-1, 1]) eyeParts.add(ball, EYE_COLOR, side * .15, 0, 0, .047, .070, .027, 0, side * -.12);
  face.add(eyeParts.mesh(new THREE.MeshBasicMaterial({ vertexColors: true }), "eye-shapes")); body.add(face);
  const glowParts = new FigureParts();
  glowParts.add(ball, form.light, 0, Y0 + 1.0, .355, .11, .12, .065);
  for (const side of [-1, 1]) glowParts.add(ball, form.light, side * .12, Y0 + 1.35, .33, .025, .030, .025);
  if (form.feature === "lamp-fruit") glowParts.add(ball, form.light, -.02, Y0 + 2.32, 0, .13, .17, .12);
  const glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .8 });
  const core = glowParts.mesh(glowMaterial, "condensed-light-core"); body.add(core);

  // One seven-instance mesh per character; no per-particle lights or postprocessing.
  const moteMaterial = new THREE.MeshBasicMaterial({ color: form.light, transparent: true, opacity: .42, depthWrite: false });
  const motes = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.035, 0), moteMaterial, MOTE_COUNT);
  motes.name = "settling-light-grains"; motes.frustumCulled = false; body.add(motes);
  const moteMatrix = new THREE.Matrix4(), motePosition = new THREE.Vector3(), moteScale = new THREE.Vector3(), moteRotation = new THREE.Quaternion();
  const phase = ((seed * .6180339887) % 1) * Math.PI * 2;
  const ring = (inner: number, outer: number, color: number): CitizenFigure["focusRing"] => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .85, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = Y0 + .06; mesh.visible = false; group.add(mesh); return mesh;
  };
  const focusRing = ring(.64, .79, FOCUS_COLOR), pulseRing = ring(.56, .68, form.light);

  function updateLife(seconds: number, kind: string, walking: boolean, reducedMotion: boolean, night = 0, activityId?: string): void {
    const time = Number.isFinite(seconds) ? seconds : 0;
    const resting = kind === "rest" && !walking;
    const breath = reducedMotion ? 0 : Math.sin(time * 1.6 + phase);
    upper.scale.y = 1 + breath * (resting ? .008 : .004);
    upper.rotation.z = resting ? .06 : 0;
    // A deterministic brief blink, offset per identity. Sleep is a sustained soft closed eye.
    const blinkPhase = ((time + seed * .41) % 5.6 + 5.6) % 5.6;
    const blink = !reducedMotion && blinkPhase < .18 ? Math.abs(blinkPhase / .09 - 1) : 1;
    face.scale.y = resting ? .16 : Math.max(.12, blink);
    glowMaterial.opacity = (resting ? .46 : .75) + Math.max(0, Math.min(1, night)) * .16 + breath * .035;
    moteMaterial.opacity = resting ? .12 : .30 + Math.max(0, Math.min(1, night)) * .22;
    if (walking) {
      // The caller owns the gait's x rotation. Clear any earlier stationary gesture.
      limbs.armLeft.rotation.y = 0; limbs.armLeft.rotation.z = 0;
      limbs.armRight.rotation.y = 0; limbs.armRight.rotation.z = 0;
    } else {
      const beat = reducedMotion ? 0 : Math.sin(time * 2.1 + phase);
      limbs.armLeft.rotation.set(0, 0, 0); limbs.armRight.rotation.set(0, 0, 0);
      limbs.legLeft.rotation.x = 0; limbs.legRight.rotation.x = 0;
      if (resting) { limbs.armLeft.rotation.z = -.14; limbs.armRight.rotation.z = .14; }
      else if (kind === "eat") { limbs.armRight.rotation.x = -.8 - beat * .10; limbs.armLeft.rotation.x = -.25; }
      else if (kind === "social") { limbs.armLeft.rotation.z = -.3; limbs.armRight.rotation.x = -.55 + beat * .20; }
      else if (kind === "care") { limbs.armRight.rotation.x = -.65 + beat * .14; limbs.armLeft.rotation.x = -.35; }
      else if (kind === "craft") { limbs.armLeft.rotation.x = -.7 + beat * .08; limbs.armRight.rotation.x = -.7 - beat * .10; }
      else if (kind === "observe") { limbs.armLeft.rotation.x = -.2; limbs.armRight.rotation.z = .1; }
      else if (!reducedMotion) { limbs.armLeft.rotation.z = breath * .035; limbs.armRight.rotation.z = -breath * .035; }
    }
    for (let i = 0; i < MOTE_COUNT; i++) {
      const a = i * 2.39996 + phase;
      const drift = reducedMotion ? 0 : Math.sin(time * .55 + a) * .065;
      const height = Y0 + .62 + (i % 4) * .32 + drift;
      const radius = .47 + (i % 2) * .13;
      motePosition.set(Math.cos(a) * radius, height, Math.sin(a) * radius);
      moteScale.setScalar((resting ? .65 : 1) * (1 + (reducedMotion ? 0 : Math.sin(time + a) * .12)));
      moteMatrix.compose(motePosition, moteRotation, moteScale); motes.setMatrixAt(i, moteMatrix);
    }
    motes.instanceMatrix.needsUpdate = true;
    // Debug provenance is presentation only; no persistent state is mutated here.
    group.userData.life_pose = walking ? "travel" : kind;
    group.userData.activity_id = activityId ?? null;
  }
  updateLife(0, "idle", false, true);
  return { group, body, upper, limbs, focusRing, pulseRing, updateLife };
}
