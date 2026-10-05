import * as THREE from 'three';
import type { SceneLifeActivity } from '../deskbot/activityProjection.ts';
import { hasSceneTaskEffect } from './sceneLife.ts';

export interface SceneLifeContext {
  minute: number;
  daylight: number;
  activities: readonly SceneLifeActivity[];
}
interface DetailModel {
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): void;
  ball(r: number, x: number, y: number, z: number, color: number): void;
  cylinder(r: number, h: number, x: number, y: number, z: number, color: number): void;
  add(geometry: THREE.BufferGeometry, x: number, y: number, z: number, color: number): void;
}

const hash = (index: number) => { const n = Math.sin(index * 73.13 + 7.4) * 42715.72; return n - Math.floor(n); };
const palettes: Record<string, number> = { nursery: 0x9fedd1, grove: 0xe1deac, waterside: 0x8cdae6, square: 0xffd996, workshop: 0xe8b378, courtyard: 0xffc78c, home: 0xb1dcd5, homes: 0xb1dcd5, shelter: 0xc4ddcc, market: 0xf5c699 };

/** A tiny generated alpha falloff avoids a hard disk or square edge; no remote bitmap. */
export function createSoftLightTexture(size = 32) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
    const alpha = Math.pow(Math.max(0, 1 - r), 1.7);
    pixels.set([255, 255, 255, Math.round(alpha * 255)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  return texture;
}

/** Small authored details share the facility's merged material/draw call. */
export function addShapingDetails(parent: THREE.Group, model: DetailModel, kind: string) {
  const stone = 0xb8c3b1, dark = 0x5f7165, brass = 0xd3b17a, cream = 0xf0e5c9;
  const crystal = (x: number, y: number, z: number, r = .3, color = palettes[kind] ?? 0xc9d9cb) => {
    const geometry = new THREE.OctahedronGeometry(r, 0); geometry.scale(.75, 1.6, .75);
    model.add(geometry, x, y, z, color);
    model.cylinder(r * 1.2, .12, x, y - r * 1.6 - .12, z, dark);
  };
  const pot = (x: number, z: number, color = 0x8ca36c) => {
    model.cylinder(.35, .45, x, .3, z, 0xad7d5b); model.ball(.55, x, 1, z, color);
    model.ball(.24, x + .23, 1.45, z, cream);
  };
  // Low stone edging and a few irregular stepping stones anchor every lot in the same town.
  for (let i = 0; i < 6; i++) model.box(.8, .1, .58, 1.2 + (i % 2) * .8, .32, 6.3 - i * .6, stone);
  if (kind === 'nursery') {
    for (let row = 0; row < 3; row++) {
      const z = 1.9 + row * 1.8;
      model.box(10.2, .07, .12, -1, .76, z - .65, brass);
      model.box(10.2, .07, .12, -1, .76, z + .65, brass);
      model.box(.1, .4, .08, -5.8, .78, z + .4, dark);
      model.box(.5, .28, .08, -5.8, 1.1, z + .4, cream);
    }
    // Narrow pipes follow the already visible irrigation channel; no imagined water amount.
    model.box(.12, .12, 8.2, 4.7, .53, 1, brass);
    for (const z of [1.9, 3.7, 5.5]) model.box(1.4, .09, .09, 4.05, .66, z, brass);
    model.box(1, .15, .6, 5.9, .8, 5.8, cream);
    crystal(-5, 1.1, -5, .22); pot(6, -5); pot(-6, 6.6);
    model.box(1.8, .18, .8, 2, .35, -.4, 0xa87c59);
    for (let i = 0; i < 3; i++) model.ball(.23, 1.4 + i * .5, .75, -.4, 0xe5bd79);
  } else if (kind === 'waterside') {
    for (let i = 0; i < 10; i++) {
      const x = -5.9 + hash(i) * 1.4, z = -5 + i * 1.05;
      model.box(.07, .7 + hash(i + 20) * .6, .07, x, .4, z, 0x849673);
      model.ball(.12, x, 1.2 + hash(i + 20) * .6, z, 0xd1c391);
      model.ball(.32, -6.4, .45, z + .4, stone);
    }
    model.box(.18, 1, 4.6, 6.7, .4, .3, dark);
    for (const z of [-1.6, .3, 2.2]) model.box(.18, 1.5, .18, 6.7, .4, z, dark);
    crystal(6.8, 2.3, -1.6, .22);
    model.box(1.2, .3, .5, 5.8, .95, 6, 0xb99564);
  } else if (kind === 'grove') {
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2, x = Math.cos(angle) * (3.8 + hash(i)), z = Math.sin(angle) * (3.8 + hash(i));
      model.box(.08, .5, .08, x, .3, z, 0x718962);
      for (let p = 0; p < 3; p++) model.ball(.14, x + Math.sin(p * 2.1) * .15, .92, z + Math.cos(p * 2.1) * .15, i % 2 ? 0xe6c99a : 0xadcbc7);
    }
    for (const [x, z] of [[-3, -3], [3, -3], [4.5, 4.5]]) crystal(x!, .9, z!, .3);
    model.box(2.5, .14, .25, -5, .4, 5.8, dark);
    model.ball(.48, -4.4, .8, 5.8, 0xacc794);
  } else if (kind === 'square') {
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const geometry = new THREE.BoxGeometry(.16, .07, 2.6); geometry.rotateY(-a);
      model.add(geometry, Math.sin(a) * 4.1, .76, Math.cos(a) * 4.1, brass);
      crystal(Math.sin(a) * 5.7, 1.05, Math.cos(a) * 5.7, .24);
    }
    model.cylinder(.65, .3, 0, 6.7, 0, brass); crystal(0, 7.5, 0, .64);
    pot(-6.5, 2.3); pot(6.5, 2.3);
  } else if (kind === 'workshop') {
    for (let i = 0; i < 3; i++) model.box(.8, .18, .44, -4.8 + i * .2, .35 + i * .19, 5.8, 0xb4916c);
    const gear = new THREE.TorusGeometry(.6, .1, 5, 12); gear.rotateY(Math.PI / 2);
    model.add(gear, -4.1, 2.3, -1.2, brass);
    model.box(.85, .5, .75, 3.8, .35, 5.9, dark);
    for (const x of [-3.4, -1.4]) crystal(x, 2, 4, .18);
    model.box(3.4, .13, .1, -2, 2.1, 3, brass); pot(5, -5);
  } else if (kind === 'courtyard') {
    // The kettle body is always present; steam appears only for an actual running cook task.
    model.cylinder(.4, .55, -4, 1.65, 3, dark); model.cylinder(.45, .12, -4, 2.2, 3, brass);
    model.box(.14, .3, .14, -4, 2.31, 3, dark); model.box(.5, .18, .18, -3.5, 2.03, 3, brass);
    model.box(.18, .35, .18, -4.6, 1.9, 3, dark);
    for (const x of [.5, 2, 3.5]) { model.cylinder(.22, .2, x, 1.77, 4, cream); model.box(.45, .04, .1, x, 1.97, 4.5, brass); }
    pot(-6, -4); pot(6, -4); crystal(-5.8, 1.1, 5.8, .25);
  } else if (kind === 'market') {
    for (const x of [-3.4, 3.4]) {
      model.box(3.4, .08, .08, x, 3.8, 1.5, brass);
      for (let i = 0; i < 5; i++) model.box(.5, .4, .06, x - 1.2 + i * .6, 3.2, 1.55, i % 2 ? 0xbca690 : 0x8fb5a7);
      model.box(.8, .6, .8, x + 1.8, .3, 1.7, 0xa07c57);
      model.box(1.2, .65, .12, x, 2.1, 1.1, dark);
    }
    crystal(-3.4, 2.4, 1.2, .16); crystal(3.4, 2.4, 1.2, .16);
    model.box(2, .2, .4, -5.5, .35, 4.7, 0xbeb394);
  } else if (kind === 'home' || kind === 'homes') {
    for (const x of [-4.5, 4.5]) { pot(x, 3.5); crystal(x, 1.55, 3.5, .16); }
    model.box(1.5, .1, .9, 0, .59, .9, 0xc7b68f);
    for (let i = 0; i < 4; i++) model.box(.45, .5, .15, -5.5 + i * .5, .3, 5.8, 0x8ca18a);
    model.box(2.1, .12, .12, -4.75, .8, 5.8, 0x8ca18a);
  } else if (kind === 'shelter') {
    model.box(2, .12, .8, 0, 1.77, -1, 0xd5c8a9); crystal(-3.3, 3.1, 1, .25);
    model.box(.6, .9, .6, 4.5, .3, -3.5, 0xb6ad91);
    pot(6, -4, 0x7c9675);
  }
  parent.userData.shaping_details = 'authored-materials-v1';
}

/** Bounded, local visual effects; tasks only select effects and never mutate their outcomes. */
export function createSceneLifeEffects(parent: THREE.Group, kind: string, glowTexture = createSoftLightTexture()) {
  const root = new THREE.Group(); root.name = `shaping-life:${kind}`; parent.add(root);
  const count = kind === 'square' || kind === 'grove' ? 30 : 16;
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: palettes[kind] ?? 0xc9d9cb, map: glowTexture, size: .25, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending });
  const motes = new THREE.Points(geometry, material); motes.name = 'light-condensation-motes'; motes.frustumCulled = false; root.add(motes);
  const traces = new THREE.BufferGeometry(); const traceVertices: number[] = [];
  if (kind === 'square' || kind === 'grove') {
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      for (let j = 0; j < 8; j++) {
        const p = j / 8, q = (j + 1) / 8;
        traceVertices.push(Math.cos(a) * p * 5.6, .88 + Math.sin(p * Math.PI) * .9, Math.sin(a) * p * 5.6,
          Math.cos(a) * q * 5.6, .88 + Math.sin(q * Math.PI) * .9, Math.sin(a) * q * 5.6);
      }
    }
  }
  traces.setAttribute('position', new THREE.Float32BufferAttribute(traceVertices, 3));
  const threads = new THREE.LineSegments(traces, new THREE.LineBasicMaterial({ color: palettes[kind], transparent: true, opacity: .2, depthWrite: false }));
  threads.name = 'field-light-threads'; root.add(threads);
  const taskMaterial = new THREE.MeshBasicMaterial({ color: kind === 'courtyard' ? 0xe7ece4 : 0xffd49c, transparent: true, opacity: .16, depthWrite: false });
  const taskParticles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.13, 0), taskMaterial, 10);
  taskParticles.name = kind === 'courtyard' ? 'cook-task-steam' : kind === 'nursery' ? 'water-task-droplets' : 'work-task-light-shavings';
  taskParticles.visible = false; taskParticles.frustumCulled = false; root.add(taskParticles);
  const dummy = new THREE.Object3D();
  const ripples: THREE.LineLoop[] = [];
  if (kind === 'waterside') {
    for (let i = 0; i < 3; i++) {
      const points = Array.from({ length: 24 }, (_, j) => new THREE.Vector3(Math.cos(j / 24 * Math.PI * 2), 0, Math.sin(j / 24 * Math.PI * 2) * .6));
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xc4f1e8, transparent: true, opacity: .4, depthWrite: false }));
      ring.name = `water-ripple:${i}`; root.add(ring); ripples.push(ring);
    }
  }
  return {
    root,
    update(time: number, night: number, wind: number, reducedMotion: boolean, context?: SceneLifeContext) {
      const t = reducedMotion ? 0 : time;
      material.opacity = .3 + night * .35;
      (threads.material as THREE.LineBasicMaterial).opacity = .16 + night * .24;
      // Empty or dead planted beds do not produce a flourishing light halo.
      const bed = parent.getObjectByName('object:garden-bed');
      if (kind === 'nursery' && bed?.userData.state) {
        const state = bed.userData.state;
        motes.visible = (state.quantity ?? 0) > 0 && (state.health ?? 0) > .2;
      }
      for (let i = 0; i < count; i++) {
        const a = hash(i + 60) * Math.PI * 2 + t * .035;
        const radius = kind === 'square' ? 1 + hash(i + 100) * 3 : 1.5 + hash(i + 100) * 4;
        const height = kind === 'square' ? 1.2 + hash(i + 200) * 5.3 : .6 + hash(i + 200) * 2.3;
        positions.set([Math.cos(a) * radius + Math.sin(t * .15 + i) * Math.min(wind / 30, .3), height + Math.sin(t * .5 + i) * .18, Math.sin(a) * radius], i * 3);
      }
      geometry.getAttribute('position').needsUpdate = true;
      const activities = context?.activities ?? [];
      const action = kind === 'courtyard' ? hasSceneTaskEffect('steam', activities) : kind === 'nursery' ? hasSceneTaskEffect('irrigation', activities) : hasSceneTaskEffect('sparks', activities);
      taskParticles.visible = action && ['courtyard', 'nursery', 'workshop', 'waterside'].includes(kind);
      taskMaterial.color.set(kind === 'courtyard' ? 0xe7ece4 : kind === 'nursery' ? 0x98d9df : 0xffd49c);
      taskMaterial.opacity = kind === 'courtyard' ? .17 : .66;
      if (taskParticles.visible) for (let i = 0; i < 10; i++) {
        const cycle = (t * (kind === 'courtyard' ? .22 : .5) + i / 10) % 1;
        if (kind === 'courtyard') {
          dummy.position.set(-4 + Math.sin(i * 4 + t * .4) * cycle * .3, 2.35 + cycle * 1.9, 3 + Math.cos(i) * cycle * .3); dummy.scale.setScalar(.4 + cycle * 1.6);
        } else if (kind === 'nursery') {
          dummy.position.set(4.3 - cycle * 9.8, 1 + Math.sin(cycle * Math.PI) * 1.3, 1.9 + (i % 3) * 1.8); dummy.scale.set(.35, .7, .35);
        } else {
          dummy.position.set((kind === 'workshop' ? -2 : -1) + Math.sin(i * 7) * cycle * 1.2, (kind === 'workshop' ? 1.8 : .8) + Math.sin(cycle * Math.PI) * .75, (kind === 'workshop' ? 4 : 0) + Math.cos(i * 4) * cycle); dummy.scale.setScalar(.3 + (1 - cycle) * .4);
        }
        dummy.updateMatrix(); taskParticles.setMatrixAt(i, dummy.matrix);
      }
      taskParticles.instanceMatrix.needsUpdate = true;
      const surface = parent.getObjectByName('water-level:floating-frame');
      ripples.forEach((ring, i) => {
        const cycle = (t * .22 + i / 3) % 1;
        ring.position.set(-3 + i * 2.1, (surface?.position.y ?? .55) + .065, -2.5 + i * 2.5);
        ring.scale.setScalar(.2 + cycle * 1.8);
        (ring.material as THREE.LineBasicMaterial).opacity = reducedMotion ? .22 : (1 - cycle) * .38;
      });
    },
  };
}
