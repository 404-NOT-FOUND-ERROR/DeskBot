import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import samples from '../src/deskbot/windleafReviewFixtures.json';
import type {DeskBotWorldMap} from '../src/deskbot/types.ts';
import {buildTownScenery} from '../src/three/buildScene.ts';
import {windleafHeightAt} from '../src/three/windleafLayout.ts';

const map=(samples as unknown as {samples:{installed:{map:DeskBotWorldMap}}}).samples.installed.map;

describe('Town and Windleaf form one traversable landscape',()=>{
  it('exposes the road surface across both old perimeter exits, above every ground layer',()=>{
    const scene=buildTownScenery(map.locations);scene.root.updateMatrixWorld(true);
    const surfaces=['town-ground','windleaf-terrain','windleaf-route-surface','windleaf-work-clearings'].map(name=>scene.root.getObjectByName(name)!);
    for(const [x,y] of [[112,50],[116,50],[120,50],[118,90],[124,92.5]]){
      const p=mapToWorld(x!,y!),ray=new THREE.Raycaster(new THREE.Vector3(p.x,20,p.z),new THREE.Vector3(0,-1,0));
      const hits=ray.intersectObjects(surfaces,false);
      expect(hits[0]!.object.name).toBe('windleaf-route-surface');
      expect(Math.abs(hits[0]!.point.y-windleafHeightAt(x!,y!)-.055)).toBeLessThan(.025);
    }
    scene.dispose();
  });
  it('replaces the slab with continuous ground and hides the obsolete internal forest wall',()=>{
    const scene=buildTownScenery(map.locations),ground=scene.root.getObjectByName('shaping-town-terrain') as THREE.Mesh;
    ground.geometry.computeBoundingBox();
    expect(ground.geometry.getAttribute('position').count).toBeGreaterThan(10000);
    expect(ground.geometry.boundingBox!.max.y-ground.geometry.boundingBox!.min.y).toBeGreaterThan(15);
    expect(scene.root.getObjectByName('windleaf-terrain-edge')!.visible).toBe(false);
    const side=(scene.root.getObjectByName('windleaf-terrain-edge') as THREE.Mesh).geometry.getAttribute('position');
    for(let i=0;i<side.count;i+=3){
      const oldSeam=[0,1,2].every(j=>Math.abs(side.getX(i+j)-60)<.001);
      expect(oldSeam).toBe(false);
    }
    scene.dispose();
  });
});
