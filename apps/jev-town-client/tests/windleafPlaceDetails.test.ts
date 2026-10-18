import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {addWindleafPlaceDetails} from '../src/three/windleafPlaceDetails.ts';
import {disposeObject} from '../src/three/buildScene.ts';

const fixtures=()=>new Map(['windleaf-rack','windleaf-observation-stone','windleaf-return-table','windleaf-waymarker'].map(id=>{
  const g=new THREE.Group();g.name=id;g.userData.state={stock:{},leaf_frames:[]};return [id,g] as const;
}));
const downward=(root:THREE.Group,x:number,z:number)=>{
  root.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x,10,z),new THREE.Vector3(0,-1,0)).intersectObject(root,true);
};
describe('Windleaf communal fitting detail',()=>{
  it('keeps every installation bay and front approach clear',()=>{
    const objects=fixtures();addWindleafPlaceDetails(objects);const rack=objects.get('windleaf-rack')!;
    for(const slot of [-3.9,0,3.9])for(const dx of [-1.4,0,1.4])for(const z of [.6,2.35,3.3])expect(downward(rack,slot+dx,z)).toHaveLength(0);
    objects.forEach(disposeObject);
  });
  it('empty return containers remain genuinely open and do not imply contents',()=>{
    const objects=fixtures();addWindleafPlaceDetails(objects);const table=objects.get('windleaf-return-table')!;
    const hits=downward(table,-2,-2.6);expect(hits.length).toBeGreaterThan(0);expect(hits[0]!.point.y).toBeCloseTo(.1,4);
    objects.forEach(disposeObject);
  });
  it('adds no destinations, inventory, saved history or duplicate fittings',()=>{
    const objects=fixtures(),before=[...objects].map(([id,g])=>[id,structuredClone(g.userData)]);
    addWindleafPlaceDetails(objects);const meshes=[...objects.values()].map(g=>g.children.length);addWindleafPlaceDetails(objects);
    expect([...objects].map(([id,g])=>[id,g.userData])).toEqual(before);
    expect([...objects.values()].map(g=>g.children.length)).toEqual(meshes);
    expect([...objects.values()].every(g=>g.children[0]?.userData.presentationOnly===true)).toBe(true);
    objects.forEach(disposeObject);
  });
});
