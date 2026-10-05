import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {buildCompanionScenery} from '../src/three/companionScenery.ts';
import type {DeskBotLocation} from '../src/deskbot/types.ts';
const fixtures=JSON.parse(readFileSync(new URL('../public/living-review-fixtures.json',import.meta.url),'utf8'));
const places=(id:string):DeskBotLocation[]=>fixtures.samples[id].map.locations;
describe('committed resource states change the actual facility meshes',()=>{
  it('raises water and its gauge, floats the frame and changes soil/growth/wilt without rebuilding the town',()=>{
    const scene=buildCompanionScenery(places('initial')),water=scene.root.getObjectByName('water-level:floating-frame')!;
    const initialWater=water.position.y,soil=scene.root.getObjectByName('soil-moisture') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>,dryColor=soil.material.color.clone();
    scene.applyState(places('storm'));expect(water.position.y).toBeGreaterThan(initialWater);
    expect(scene.objects.get('floating-frame')!.position.y).toBeCloseTo(water.position.y+.05);
    expect(scene.root.getObjectByName('water-level-pointer')!.position.y).toBe(water.position.y);
    expect(soil.material.color.equals(dryColor)).toBe(false);
    const plants=scene.root.getObjectByName('nursery-seedlings')!;scene.applyState(places('grown'));expect(plants.scale.y).toBeGreaterThan(3.9);
    scene.applyState(places('harvested'));expect(plants.visible).toBe(false);
    scene.applyState(places('dry'));expect(plants.visible).toBe(true);expect(plants.scale.y).toBeLessThan(.3);
    const plant=scene.root.getObjectByName('nursery-plant-bodies') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>;expect(plant.material.vertexColors).toBe(false);expect(plant.material.color.r).toBeGreaterThan(plant.material.color.g);
    scene.applyState(places('grown'));expect(plant.material.color.getHex()).toBe(0x7eab59);
  });
  it('shows torn canopy/loose frame, repaired geometry and reduced material stacks from the rule replay',()=>{
    const scene=buildCompanionScenery(places('storm')),frame=scene.objects.get('floating-frame')!,canopy=scene.objects.get('market-canopy')!;
    expect(frame.getObjectByName('frame-plank:1')!.visible).toBe(false);
    expect(canopy.getObjectByName('canopy-strip:-3.4:2')!.visible).toBe(false);
    const stock=scene.root.getObjectByName('stock:parts-drawers:wood:1')!;const woodBefore=stock.scale.y;
    scene.applyState(places('repaired'));expect(frame.getObjectByName('frame-plank:1')!.visible).toBe(true);
    expect(canopy.getObjectByName('canopy-strip:-3.4:2')!.visible).toBe(true);expect(stock.scale.y).toBeLessThan(woodBefore);
    expect(scene.objects.get('parts-drawers')!.userData.state_scope).toBe('persistent_living');
  });
});
