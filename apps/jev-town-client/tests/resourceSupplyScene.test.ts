import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { DeskBotLocation } from '../src/deskbot/types.ts';
import type { SceneLifeActivity } from '../src/deskbot/activityProjection.ts';
import { buildCompanionScenery } from '../src/three/companionScenery.ts';
import { hasSceneTaskEffect } from '../src/three/sceneLife.ts';
import { sceneWorkAnchor, sceneWorkTarget } from '../src/three/sceneWorkplace.ts';
import { disposeObject } from '../src/three/buildScene.ts';

const fixtures = JSON.parse(readFileSync(new URL('../public/living-review-fixtures.json', import.meta.url), 'utf8'));
function locations(rawWater = 12, seeds = 2, capacity = 24): DeskBotLocation[] {
  const places: DeskBotLocation[] = structuredClone(fixtures.samples.initial.map.locations);
  for (const place of places) for (const area of place.areas ?? []) for (const object of area.objects ?? []) {
    if (object.object_id === 'floating-frame' && object.state) { object.state.stock = { raw_water: rawWater }; object.state.capacity = capacity; }
    if (object.object_id === 'seedling-rack' && object.state) object.state.stock!.seeds = seeds;
  }
  return places;
}
const task = (overrides: Partial<SceneLifeActivity> = {}): SceneLifeActivity => ({ actorId: 'shaping-001', citizenId: 101, locationId: 'echo-waterside', taskId: 'task-supply', title: '汲水净滤', kind: 'care', activityId: 'collect-water', targetObjectId: 'floating-frame', status: 'running', dueAt: '2026-10-05T12:10:00Z', remainingMs: 600000, ...overrides });
const context = (activities: SceneLifeActivity[]) => ({ minute: 720, daylight: 1, activities });
function foodLocations(fruit = 4.5, meals = 5): DeskBotLocation[] {
  const places = locations(), grove = places.find(place => place.location_id === 'backlit-grove')!;
  grove.areas ??= []; grove.areas.push({ area_id: 'grove-edge', location_id: grove.location_id, name: '光果林缘', description: '', access: 'public', neighbor_area_ids: [],
    objects: [{ object_id: 'light-fruit-bough', area_id: 'grove-edge', name: '光果枝', description: '', object_kind: 'source', state_scope: 'persistent_living',
      state: { object_id: 'light-fruit-bough', kind: 'ecological_source', updated_at: '2026-10-05T12:00:00Z', stock: { light_fruit: fruit }, capacity: 12 } }] });
  for (const place of places) for (const area of place.areas ?? []) for (const object of area.objects ?? []) {
    if (object.object_id === 'shared-table' && object.state) object.state.stock = { rations: meals };
  }
  return places;
}

describe('resource supply scene follows canonical inventory and tasks', () => {
  it('encodes available raw water using actual source capacity, not water level or future output', () => {
    const scene = buildCompanionScenery(locations());
    const grid = scene.root.getObjectByName('raw-water-stock-grid') as THREE.InstancedMesh;
    scene.update(2, 0, 0, 0, true, context([]));
    expect(grid.userData).toMatchObject({ resource: 'raw_water', quantity: 12, capacity: 24 });
    const matrix = new THREE.Matrix4(); grid.getMatrixAt(5, matrix); expect(matrix.elements[5]).toBe(1);
    grid.getMatrixAt(6, matrix); expect(matrix.elements[5]).toBe(0);
    scene.applyState(locations(12, 2, 48)); scene.update(3, 0, 0, 0, true, context([]));
    grid.getMatrixAt(3, matrix); expect(matrix.elements[5]).toBe(0);
    scene.applyState(locations(0)); scene.update(4, 0, 0, 0, true, context([])); expect(grid.visible).toBe(false);
    expect(scene.root.getObjectByName('spring-raw-water-reservoir')).toBeDefined();
    disposeObject(scene.root);
  });
  it('starts and stops only exact local supply tasks, including pause, travel and wrong-target guards', () => {
    const scene = buildCompanionScenery(locations());
    const flow = scene.root.getObjectByName('collect-water-flow')!;
    const seeds = scene.root.getObjectByName('save-seeds-work-grains')!;
    let count = 0; scene.root.traverse(() => count++);
    scene.update(1, 0, 0, 0, false, context([task()])); expect(flow.visible).toBe(true); expect(seeds.visible).toBe(false);
    for (const change of [{ status: 'paused' as const }, { kind: 'travel' }, { targetObjectId: 'garden-bed' }, { locationId: 'moss-sprout-garden' }, { activityId: undefined, title: '想去取水' }]) {
      scene.update(2, 0, 0, 0, false, context([task(change)])); expect(flow.visible).toBe(false);
    }
    const save = task({ activityId: 'save-seeds', targetObjectId: 'seedling-rack', locationId: 'moss-sprout-garden' });
    scene.update(3, 0, 0, 0, true, context([save])); expect(seeds.visible).toBe(true);
    const visibleStock = scene.root.getObjectByName('saved-seeds-stock-tray')!; expect(visibleStock.userData.quantity).toBe(2);
    scene.update(4, 0, 0, 0, false, context([{ ...save, status: 'paused' }])); expect(seeds.visible).toBe(false); expect(visibleStock.userData.quantity).toBe(2);
    let after = 0; scene.root.traverse(() => after++); expect(after).toBe(count);
    expect(hasSceneTaskEffect('seed-saving', [task({ activityId: 'save-seeds' })])).toBe(false);
    disposeObject(scene.root);
  });
  it('freezes supply particles in reduced motion without inventing completed inventory', () => {
    const scene = buildCompanionScenery(locations());
    const flow = scene.root.getObjectByName('collect-water-flow') as THREE.InstancedMesh;
    scene.update(10, 0, 0, 0, true, context([task()])); const before = [...flow.instanceMatrix.array];
    scene.update(30, 0, 0, 0, true, context([task()])); expect([...flow.instanceMatrix.array]).toEqual(before);
    expect(scene.objects.get('floating-frame')!.userData.state.stock.raw_water).toBe(12);
    expect(scene.objects.get('floating-frame')!.userData.state.stock.water).toBeUndefined();
    disposeObject(scene.root);
  });
  it('places supply workers at bank and tray tools rather than inside the pond or rack', () => {
    const scene = buildCompanionScenery(locations());
    const frame = scene.objects.get('floating-frame')!;
    const anchor = sceneWorkAnchor(frame, new THREE.Vector3(), 'collect-water');
    const expected = frame.parent!.localToWorld(new THREE.Vector3(6.1, 0, .6)); expect(anchor).toEqual(expected);
    const target = sceneWorkTarget(frame, 'collect-water')!; expect(target.y).toBeCloseTo(1.8);
    frame.position.y = 2.5; expect(sceneWorkAnchor(frame, new THREE.Vector3(), 'collect-water')).toEqual(expected);
    expect(sceneWorkTarget(frame, 'repair-frame')).toBeNull();
    const rack = scene.objects.get('seedling-rack')!;
    expect(sceneWorkTarget(rack, 'save-seeds')).not.toBeNull();
    disposeObject(scene.root);
  });
  it('shows finite branch fruit and the exact admitted gathering task without awarding its future output', () => {
    const scene = buildCompanionScenery(foodLocations());
    const fruit = scene.root.getObjectByName('light-fruit-on-bough') as THREE.InstancedMesh;
    const gathering = scene.root.getObjectByName('gather-light-fruit-work')!;
    const active = task({ locationId: 'backlit-grove', activityId: 'gather-light-fruit', targetObjectId: 'light-fruit-bough' });
    scene.update(3, 0, 0, 0, true, context([active]));
    expect(fruit.userData).toMatchObject({ quantity: 4.5, capacity: 12 }); expect(gathering.visible).toBe(true);
    const matrix = new THREE.Matrix4(); fruit.getMatrixAt(5, matrix); expect(matrix.elements[0]).toBe(0);
    for (const wrong of [{ status: 'paused' as const }, { targetObjectId: 'garden-bed' }, { locationId: 'moss-sprout-garden' }, { kind: 'travel' }]) {
      scene.update(4, 0, 0, 0, true, context([{ ...active, ...wrong }])); expect(gathering.visible).toBe(false);
    }
    // The held fruit has already left the free stock. Work animation does not put it back on the branch.
    scene.applyState(foodLocations(0)); scene.update(5, 0, 0, 0, true, context([active]));
    expect(fruit.visible).toBe(false); expect(fruit.userData.quantity).toBe(0); expect(gathering.visible).toBe(true);
    const bough = scene.objects.get('light-fruit-bough')!;
    expect(sceneWorkAnchor(bough, new THREE.Vector3(), 'gather-light-fruit')).toEqual(bough.parent!.localToWorld(new THREE.Vector3(-4.75, 0, 5.3)));
    disposeObject(scene.root);
  });
  it('shows exactly the table-ready bowls and new cooking steam, with no bowl for held or future meals', () => {
    const scene = buildCompanionScenery(foodLocations(0, 5));
    const first = scene.root.getObjectByName('stock:shared-table:rations:0')!, second = scene.root.getObjectByName('stock:shared-table:rations:1')!;
    expect(first.children.filter(item => item.visible)).toHaveLength(4); expect(second.children.filter(item => item.visible)).toHaveLength(1);
    const cooking = task({ locationId: 'warm-pot-courtyard', kind: 'craft', activityId: 'cook-grove-stew', targetObjectId: 'trial-stove' });
    const steam = scene.root.getObjectByName('cook-task-steam')!;
    scene.applyState(foodLocations(0, 0)); scene.update(2, 0, 0, 0, true, context([cooking]));
    expect(first.visible).toBe(false); expect(second.visible).toBe(false); expect(steam.visible).toBe(true);
    scene.update(3, 0, 0, 0, true, context([{ ...cooking, status: 'paused' }])); expect(steam.visible).toBe(false);
    expect(hasSceneTaskEffect('steam', [{ ...cooking, targetObjectId: 'shared-table' }])).toBe(false);
    disposeObject(scene.root);
  });
});
