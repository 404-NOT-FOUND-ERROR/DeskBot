import * as THREE from 'three';
import type { SceneLifeContext } from './sceneLifeEffects.ts';
import { hasSceneTaskEffect } from './sceneLife.ts';

/** Cosmetic work in progress. Inventory and completed products always come from the service. */
export function createResourceSupplyEffects(parent: THREE.Group, kind: string) {
  if (kind === 'grove') return createForestFoodEffects(parent);
  if (kind !== 'waterside' && kind !== 'nursery') return null;
  const water = kind === 'waterside';
  const root = new THREE.Group(); root.name = water ? 'spring-water-supply' : 'nursery-seed-saving'; parent.add(root);
  const particles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(water ? .09 : .055, 0),
    new THREE.MeshBasicMaterial({ color: water ? 0x9fe4e5 : 0xe3c786, transparent: true, opacity: .8 }), 12);
  particles.name = water ? 'collect-water-flow' : 'save-seeds-work-grains';
  particles.visible = false; particles.frustumCulled = false; root.add(particles);
  // An unlit reservoir grid encodes available stock, not water height or an inferred measurement.
  const stock = new THREE.InstancedMesh(new THREE.BoxGeometry(water ? .31 : .105, water ? .3 : .08, water ? .23 : .1),
    new THREE.MeshLambertMaterial({ color: water ? 0x78b5b3 : 0xc5a36b }), 12);
  stock.name = water ? 'raw-water-stock-grid' : 'saved-seeds-stock-tray';
  stock.frustumCulled = false; stock.visible = false; root.add(stock);
  if (water) {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.08, .46),
      new THREE.MeshStandardMaterial({ color: 0xb8d9cb, transparent: true, opacity: .19, roughness: .3, depthWrite: false }));
    glass.name = 'spring-raw-water-reservoir'; glass.position.set(5.2, 1.17, -5.2); root.add(glass);
  }
  const matrix = new THREE.Object3D();
  return {
    root,
    update(seconds: number, reducedMotion: boolean, context?: SceneLifeContext) {
      const object = parent.getObjectByName(water ? 'object:floating-frame' : 'object:seedling-rack');
      const state = object?.userData.state;
      const resource = water ? 'raw_water' : 'seeds';
      const quantity = state?.stock?.[resource];
      const capacity = state?.capacity;
      const known = Number.isFinite(quantity) && Number.isFinite(capacity) && capacity > 0;
      const amount = known ? Math.max(0, quantity) : 0;
      const perCell = known ? capacity / 12 : 1;
      stock.visible = known && amount > 0;
      stock.userData = { object_id: water ? 'floating-frame' : 'seedling-rack', resource, quantity: known ? amount : null, capacity: known ? capacity : null };
      matrix.rotation.set(0, 0, 0);
      for (let i = 0; i < 12; i++) {
        const fullness = Math.min(1, Math.max(0, (amount - i * perCell) / perCell));
        matrix.position.set(water ? 4.15 + (i % 6) * .42 : -4.5 + (i % 6) * .4,
          water ? .87 + Math.floor(i / 6) * .43 : 1.35,
          water ? -5.18 : -.98 + Math.floor(i / 6) * .35);
        matrix.scale.set(1, fullness, 1); matrix.updateMatrix(); stock.setMatrixAt(i, matrix.matrix);
      }
      stock.instanceMatrix.needsUpdate = true;
      particles.visible = hasSceneTaskEffect(water ? 'water-collection' : 'seed-saving', context?.activities ?? []);
      particles.userData.activity_id = water ? 'collect-water' : 'save-seeds';
      const time = reducedMotion ? 0 : seconds;
      if (particles.visible) for (let i = 0; i < 12; i++) {
        const cycle = (time * (water ? .65 : .3) + i / 12) % 1;
        if (water) {
          // Down through the layered filter, then into the waiting collection pot.
          matrix.position.set(5.2 + Math.sin(i * 7) * .11, 2.38 - cycle * 1.35, -.75);
          matrix.scale.set(.5, .95, .5);
        } else {
          // The batch is still in process; this never increments saved seed stock.
          matrix.position.set(-4.5 + (i % 6) * .4, 1.43 + Math.sin(cycle * Math.PI) * .36,
            -.98 + Math.floor(i / 6) * .35);
          matrix.scale.setScalar(.6 + Math.sin(cycle * Math.PI) * .4);
        }
        matrix.rotation.set(0, cycle * Math.PI, 0); matrix.updateMatrix(); particles.setMatrixAt(i, matrix.matrix);
      }
      particles.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Fruit matures in the saved ecology stock; a gather animation cannot grow or award any. */
function createForestFoodEffects(parent: THREE.Group) {
  const object = parent.getObjectByName('object:light-fruit-bough');
  if (!object) return null;
  const root = new THREE.Group(); root.name = 'forest-light-fruit-supply'; object.add(root);
  const fruit = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.26, 1),
    new THREE.MeshBasicMaterial({ color: 0xf2dc93 }), 12);
  fruit.name = 'light-fruit-on-bough'; fruit.visible = false; fruit.frustumCulled = false; root.add(fruit);
  const work = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.05, 0),
    new THREE.MeshBasicMaterial({ color: 0xe7cf87, transparent: true, opacity: .7 }), 8);
  work.name = 'gather-light-fruit-work'; work.visible = false; work.frustumCulled = false; root.add(work);
  const matrix = new THREE.Object3D();
  return { root, update(seconds: number, reducedMotion: boolean, context?: SceneLifeContext) {
    const state = object.userData.state;
    const amount = Number.isFinite(state?.stock?.light_fruit) ? Math.max(0, state.stock.light_fruit) : null;
    fruit.visible = amount !== null && amount > 0;
    fruit.userData = { object_id: 'light-fruit-bough', resource: 'light_fruit', quantity: amount, capacity: state?.capacity ?? null };
    const time = reducedMotion ? 0 : seconds;
    for (let i = 0; i < 12; i++) {
      const fullness = amount === null ? 0 : Math.min(1, Math.max(0, amount - i));
      matrix.position.set(-6.25 + (i % 6) * .55, 2.68 - (i % 3) * .15 + Math.sin(time * .8 + i) * .035, 3.0 + Math.floor(i / 6) * .65);
      matrix.rotation.set(0, .17 * i, 0); matrix.scale.setScalar(Math.cbrt(fullness)); matrix.updateMatrix(); fruit.setMatrixAt(i, matrix.matrix);
    }
    fruit.instanceMatrix.needsUpdate = true;
    work.visible = (context?.activities ?? []).some(task => task.status === 'running' && task.kind !== 'travel' &&
      task.activityId === 'gather-light-fruit' && task.targetObjectId === 'light-fruit-bough' && task.locationId === parent.userData.location_id);
    work.userData = { activity_id: 'gather-light-fruit', effect: 'work_in_progress' };
    if (work.visible) for (let i = 0; i < 8; i++) {
      const cycle = (time * .28 + i / 8) % 1;
      matrix.position.set(-4.75 + Math.sin(i * 3) * .2, 2.7 - cycle * 1.6, 3.5 + cycle * .8);
      matrix.rotation.set(0, 0, 0); matrix.scale.setScalar(.5 + cycle * .5); matrix.updateMatrix(); work.setMatrixAt(i, matrix.matrix);
    }
    work.instanceMatrix.needsUpdate = true;
  } };
}
