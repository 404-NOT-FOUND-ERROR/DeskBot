import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sceneWorkAnchor } from '../src/three/sceneWorkplace.ts';

describe('task workplace projection', () => {
  it('uses the lot transform before the scene has ever rendered', () => {
    const lot = new THREE.Group(); lot.position.set(-40, 0, 30);
    const fixture = new THREE.Group(); lot.add(fixture);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(10, 1, 4)); bed.position.set(-1, .8, 4); fixture.add(bed);
    const anchor = sceneWorkAnchor(fixture, new THREE.Vector3(-41, 0, 45));
    expect(anchor.x).toBeCloseTo(-41); expect(anchor.z).toBeCloseTo(38.1); expect(anchor.y).toBe(0);
    bed.geometry.dispose();
  });
  it('keeps a rotated, scaled workstation in its own lot', () => {
    const lot = new THREE.Group(); lot.position.set(40, 0, -30); lot.rotation.y = Math.PI / 2; lot.scale.setScalar(2);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 1)); bench.position.set(0, .5, 3); lot.add(bench);
    const anchor = sceneWorkAnchor(bench, new THREE.Vector3(55, 0, -30));
    expect(anchor.x).toBeCloseTo(48.9); expect(anchor.z).toBeCloseTo(-30); expect(anchor.y).toBe(0);
    bench.geometry.dispose();
  });
});
