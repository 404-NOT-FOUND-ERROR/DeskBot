import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {worldToMap} from '@shared/world.ts';
import {createWindleafVegetation,windleafWorkFootprintContains} from '../src/three/windleafVegetation.ts';
import {windleafClearingRadius} from '../src/three/windleafLandscape.ts';
import {WINDLEAF_BLUEPRINT as B,windleafPathDistanceAt,windleafStreamAt} from '../src/three/windleafLayout.ts';
import {COTTAGE_SPECS,SIGNATURE_SPECS} from '../src/three/sceneSpec.ts';
import {disposeObject} from '../src/three/buildScene.ts';

const inClearing=(x:number,y:number,margin:number)=>B.terrain.clearings.some((p,i)=>Math.hypot(x-p.x,y-p.y)<windleafClearingRadius(i,Math.atan2(y-p.y,x-p.x))+margin);
const create=()=>createWindleafVegetation({inClearing});

describe('Windleaf layered vegetation',()=>{
  it('forms a dense, deterministic forest with a town-edge transition and bounded draw groups',()=>{
    const first=create(),second=create(),plants=first.root.userData.plants as {x:number,y:number,size:number,kind:string}[];
    expect(plants).toEqual(second.root.userData.plants);
    expect(plants.length).toBeGreaterThanOrEqual(160);expect(plants.length).toBeLessThanOrEqual(200);
    expect(plants.filter(p=>p.x<130).length).toBeGreaterThan(10);
    expect(new Set(plants.map(p=>p.kind)).size).toBe(3);
    expect(Math.max(...plants.map(p=>p.size))-Math.min(...plants.map(p=>p.size))).toBeGreaterThan(.6);
    const population=first.root.userData.population;
    expect(population.shrubs).toBeGreaterThan(400);expect(population.grass).toBeGreaterThan(700);
    expect(population.reeds).toBeGreaterThan(40);expect(population.rockClusters).toBeGreaterThan(180);
    let count=0;first.root.traverse(p=>{if(p instanceof THREE.Mesh)count++;});expect(count).toBeLessThanOrEqual(14);
    disposeObject(first.root);disposeObject(second.root);
  });
  it('keeps trunks, understory and decorative inventory out of admitted walking routes and buildings',()=>{
    const forest=create(),plants=forest.root.userData.plants as {x:number,y:number,decorativeOnly:boolean}[];
    const houses=[...COTTAGE_SPECS.map(p=>({...worldToMap(p.x,p.z),r:4.9*p.scale})),...SIGNATURE_SPECS.map(p=>({...worldToMap(p.x,p.z),r:7.5}))];
    for(const p of plants){
      expect(p.decorativeOnly).toBe(true);expect(windleafPathDistanceAt(p.x,p.y)).toBeGreaterThanOrEqual(3.75);
      expect(inClearing(p.x,p.y,.45)).toBe(false);
      const stream=windleafStreamAt(p.x,p.y);expect(stream.distance-stream.width).toBeGreaterThanOrEqual(2.8);
      if(p.x<122)for(const house of houses)expect(Math.hypot(p.x-house.x,p.y-house.y)).toBeGreaterThan(house.r);
    }
    for(const p of forest.root.userData.understory){expect(windleafPathDistanceAt(p.x,p.y)).toBeGreaterThanOrEqual(1.95);expect(p.decorativeOnly).toBe(true);}
    expect(forest.root.userData.decorativeOnly).toBe(true);expect(forest.root.userData.stock).toBeUndefined();
    disposeObject(forest.root);
  });
  it('moves foliage with wind and returns to the identical stable pose for reduced motion',()=>{
    const forest=create(),canopy=forest.root.getObjectByName('windleaf-broadleaf-canopies') as THREE.InstancedMesh,initial=Array.from(canopy.instanceMatrix.array),plants=JSON.stringify(forest.root.userData.plants);
    forest.update(3,9,0,false);expect(Array.from(canopy.instanceMatrix.array)).not.toEqual(initial);
    forest.update(5,9,.8,true);expect(Array.from(canopy.instanceMatrix.array)).toEqual(initial);
    forest.update(9,9,.8,true);expect(Array.from(canopy.instanceMatrix.array)).toEqual(initial);
    expect(JSON.stringify(forest.root.userData.plants)).toBe(plants);
    forest.root.traverse(p=>{if(p instanceof THREE.InstancedMesh){for(const n of p.instanceMatrix.array)expect(Number.isFinite(n)).toBe(true);}});
    disposeObject(forest.root);
  });
  it('places close planting islands around real fittings while preserving their approach and work surfaces',()=>{
    const forest=create(),designed=forest.root.userData.designedUnderstory as {x:number,y:number,place:string,layer:string,decorativeOnly:boolean}[];
    for(const place of ['shelter','edge','canopy','return'])expect(designed.filter(p=>p.place===place&&p.layer==='shrub').length).toBeGreaterThan(15);
    // The vegetation now enters the old empty clearing rings, rather than merely increasing the far forest count.
    expect(designed.filter(p=>inClearing(p.x,p.y,-1.45)).length).toBeGreaterThan(150);
    for(const p of designed){
      expect(windleafWorkFootprintContains(p.x,p.y,.35)).toBe(false);
      expect(windleafPathDistanceAt(p.x,p.y)).toBeGreaterThanOrEqual(1.95);
      expect(p.decorativeOnly).toBe(true);
    }
    disposeObject(forest.root);
  });
});
