import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildTownScenery, facingRotation, TILE_HEIGHT } from '../src/three/buildScene.ts';
import { COTTAGE_SPECS } from '../src/three/sceneSpec.ts';
import { mapToWorld } from '@shared/world.ts';
import type { DeskBotLocation } from '../src/deskbot/types.ts';

const content = JSON.parse(readFileSync(new URL('../../../world-content/companion-world/map.v1.json', import.meta.url), 'utf8'));
const locations: DeskBotLocation[] = content.locations;
const cottageSpecs = () => {
  const lots = locations.flatMap(place => place.presentation?.lot ? [mapToWorld(place.presentation.lot.x, place.presentation.lot.y)] : []);
  return COTTAGE_SPECS.filter(cottage => !lots.some(lot => Math.abs(lot.x - cottage.x) < 8 && Math.abs(lot.z - cottage.z) < 8));
};
const batches = (root: THREE.Group) => root.getObjectByName('background-domestic-lights')!.children as THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];

describe('background cottage window lighting', () => {
  it('adds at most four batches and exactly three aligned windows per remaining cottage', () => {
    const scene = buildTownScenery(locations), windows = batches(scene.root), cottages = cottageSpecs();
    expect(windows.length).toBeGreaterThan(0); expect(windows.length).toBeLessThanOrEqual(4);
    expect(windows.reduce((count, mesh) => count + mesh.count, 0)).toBe(cottages.length * 3);
    const cottage = cottages[0]!, window = windows.find(mesh => mesh.userData.variation === 0)!;
    const matrix = new THREE.Matrix4(), base = new THREE.Matrix4().compose(new THREE.Vector3(cottage.x, 0, cottage.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingRotation(cottage.facing)), new THREE.Vector3(cottage.scale, cottage.scale, cottage.scale));
    window.getMatrixAt(0, matrix);
    const expected = new THREE.Vector3(-4.4 * .22, TILE_HEIGHT + 2.7 * .42 + .75 / 2, 3.8 / 2 + .11).applyMatrix4(base);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).distanceTo(expected)).toBeLessThan(.00001);
    for (const [index, side] of [[1, 1], [2, -1]]) {
      window.getMatrixAt(index!, matrix);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      const expectedNormal = new THREE.Vector3(side!, 0, 0).transformDirection(base);
      expect(normal.distanceTo(expectedNormal)).toBeLessThan(.00001);
    }
    scene.dispose();
  });
  it('warms evening windows, dims rooms at different times and switches every background room off by midnight', () => {
    const scene = buildTownScenery(locations), windows = batches(scene.root);
    scene.updateDomesticLights!(1200, 1); expect(windows.every(mesh => mesh.visible && mesh.material.opacity > .8)).toBe(true);
    scene.updateDomesticLights!(1350, 1);
    expect(new Set(windows.map(mesh => mesh.material.opacity)).size).toBeGreaterThan(1);
    expect(windows.every(mesh => mesh.material.opacity > 0 && mesh.material.opacity < .86)).toBe(true);
    scene.updateDomesticLights!(60, 1); expect(windows.every(mesh => !mesh.visible && mesh.material.opacity === 0)).toBe(true);
    scene.updateDomesticLights!(720, 0); expect(windows.every(mesh => !mesh.visible)).toBe(true);
    scene.dispose();
  });
  it('shares geometry and a soft texture, releases each once, and creates no lights in generic Jev Town', () => {
    const scene = buildTownScenery(locations), windows = batches(scene.root);
    expect(new Set(windows.map(mesh => mesh.geometry)).size).toBe(1);
    expect(new Set(windows.map(mesh => mesh.material.map)).size).toBe(1);
    let geometryDisposals = 0, textureDisposals = 0;
    windows[0]!.geometry.addEventListener('dispose', () => geometryDisposals++);
    windows[0]!.material.map!.addEventListener('dispose', () => textureDisposals++);
    scene.dispose(); expect(geometryDisposals).toBe(1); expect(textureDisposals).toBe(1);
    const generic = buildTownScenery();
    expect(generic.root.getObjectByName('background-domestic-lights')).toBeUndefined(); expect(generic.updateDomesticLights).toBeUndefined();
    generic.dispose();
  });
});
