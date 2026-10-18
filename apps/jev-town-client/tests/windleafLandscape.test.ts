import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {worldToMap} from '@shared/world.ts';
import {createWindleafLandscape,windleafClearingRadius,windleafRouteSurfaceSamples} from '../src/three/windleafLandscape.ts';
import {WINDLEAF_BLUEPRINT as B,windleafHeightAt,windleafPathDistanceAt,windleafStreamAt} from '../src/three/windleafLayout.ts';
import {disposeObject} from '../src/three/buildScene.ts';
import {projectShapingScenery,shapingWorldPoint} from '../src/three/shapingProjection.ts';
import catalog from '../../../world-content/companion-world/map.v1.json';

describe('Windleaf terrain follows the admitted map and remains traversable',()=>{
  it('keeps the rendered forest paths above the actual faceted ground after projection',()=>{
    const landscape=createWindleafLandscape();projectShapingScenery(landscape.root);landscape.root.updateMatrixWorld(true);
    const terrain=landscape.root.getObjectByName('windleaf-terrain')!,clearing=landscape.root.getObjectByName('windleaf-work-clearings')!,road=landscape.root.getObjectByName('windleaf-route-surface')!;
    const ray=new THREE.Raycaster(),blocked:{x:number;y:number;buried:number}[]=[];
    for(const route of windleafRouteSurfaceSamples())for(const p of route.points){
      if(p.x<122)continue;
      const w=shapingWorldPoint(p.x,p.y);ray.set(new THREE.Vector3(w.x,100,w.z),new THREE.Vector3(0,-1,0));
      const soil=ray.intersectObjects([terrain,clearing],false)[0],path=ray.intersectObject(road,false)[0];
      if(soil&&path&&soil.point.y>path.point.y+.015)blocked.push({...p,buried:soil.point.y-path.point.y});
    }
    expect(blocked).toEqual([]);disposeObject(landscape.root);
  });
  it('provides level work terraces, walkable crossings and distinct lowland and ridge levels',()=>{
    for(const place of catalog.locations){const p=place.presentation?.lot;if(!p)continue;
      const base=windleafHeightAt(p.x,p.y);for(const dx of [-6,0,6])for(const dy of [-6,0,6])expect(windleafHeightAt(p.x+dx,p.y+dy)).toBeCloseTo(base,5);
    }
    for(const [x,y] of [[112,50],[116,50],[120,50],[118,90]])expect(windleafHeightAt(x!,y!)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(windleafHeightAt(119.999,60)-windleafHeightAt(120.001,60))).toBeLessThan(.003);
    expect(windleafHeightAt(150,30)).toBeLessThan(0);
    expect(windleafHeightAt(190,65)).toBeGreaterThan(2.4);
    expect(windleafHeightAt(190,65)-windleafHeightAt(150,30)).toBeGreaterThan(3);
    for(const p of B.terrain.stream)expect(windleafHeightAt(p.x,p.y)).toBeLessThan(-.8);
  });
  it('renders precisely the six registered routes, with continuous slope and no implied creek crossing',()=>{
    const routes=windleafRouteSurfaceSamples();
    expect(routes.map(r=>r.passageId)).toEqual(B.passages.map(p=>p.passage_id));
    for(const route of routes){
      const admitted=B.passages.find(p=>p.passage_id===route.passageId)!;
      expect(route.points.at(-1)).toEqual(admitted.presentation_points.at(-1));
      if(admitted.presentation_points[0]!.x>=110)expect(route.points[0]).toEqual(admitted.presentation_points[0]);
      for(let i=0;i<route.points.length;i++){
        const p=route.points[i]!,stream=windleafStreamAt(p.x,p.y);
        expect(windleafPathDistanceAt(p.x,p.y)).toBeLessThan(.000001);
        expect(stream.distance-stream.width).toBeGreaterThan(5);
        if(i){const a=route.points[i-1]!;expect(Math.hypot(p.x-a.x,p.y-a.y)).toBeLessThanOrEqual(1.000001);expect(Math.abs(windleafHeightAt(p.x,p.y)-windleafHeightAt(a.x,a.y)),`slope at ${p.x},${p.y}`).toBeLessThan(.5);}
      }
    }
  });
  it('has non-circular work clearings, and road vertices use the same height function as character feet',()=>{
    for(let i=0;i<B.terrain.clearings.length;i++){
      const radii=Array.from({length:32},(_,j)=>windleafClearingRadius(i,j*Math.PI/16));
      expect(Math.max(...radii)-Math.min(...radii)).toBeGreaterThan(1.5);
    }
    const landscape=createWindleafLandscape(),road=landscape.root.getObjectByName('windleaf-route-surface') as THREE.Mesh;
    const position=road.geometry.getAttribute('position');
    for(let i=0;i<position.count;i++){
      const p=worldToMap(position.getX(i),position.getZ(i));
      expect(position.getY(i)-windleafHeightAt(p.x,p.y),`surface at ${p.x},${p.y}`).toBeCloseTo(.055,3);
    }
    const water=(landscape.root.getObjectByName('windleaf-creek') as THREE.Mesh).geometry.getAttribute('position');
    for(let i=0;i<water.count;i++){const p=worldToMap(water.getX(i),water.getZ(i));expect(p.x).toBeGreaterThanOrEqual(120);expect(p.x).toBeLessThanOrEqual(220);expect(p.y).toBeGreaterThanOrEqual(0);expect(p.y).toBeLessThanOrEqual(120);}
    disposeObject(landscape.root);
  });
  it('keeps plant trunks off paths and batches layered decorative plant families into bounded draw groups',()=>{
    const landscape=createWindleafLandscape(),plants=landscape.root.userData.plants as {x:number,y:number,decorativeOnly:boolean}[];
    expect(plants.length).toBeGreaterThan(160);
    for(const p of plants){expect(windleafPathDistanceAt(p.x,p.y)).toBeGreaterThanOrEqual(3.7);expect(p.decorativeOnly).toBe(true);}
    for(const name of ['windleaf-broadleaf-canopies','windleaf-fir-canopies','windleaf-fern-understory']){
      const plant=landscape.root.getObjectByName(name) as THREE.InstancedMesh;
      expect(plant.isInstancedMesh).toBe(true);expect(plant.count).toBeGreaterThan(0);
    }
    let meshCount=0;landscape.root.traverse(p=>{if(p instanceof THREE.Mesh){meshCount++;const positions=p.geometry.getAttribute('position');for(let i=0;i<positions.count;i++)expect(Number.isFinite(positions.getY(i))).toBe(true);}});
    expect(meshCount).toBeLessThanOrEqual(18);
    expect(landscape.root.userData.decorativeOnly).toBe(true);
    disposeObject(landscape.root);
  });
  it('wind changes foliage without moving roots, and reduced motion restores a stable pose',()=>{
    const landscape=createWindleafLandscape(),canopy=landscape.root.getObjectByName('windleaf-broadleaf-canopies') as THREE.InstancedMesh;
    const initial=Array.from(canopy.instanceMatrix.array);
    landscape.update(2,9,0,false);expect(Array.from(canopy.instanceMatrix.array)).not.toEqual(initial);
    landscape.update(6,9,.8,true);expect(Array.from(canopy.instanceMatrix.array)).toEqual(initial);
    landscape.update(200,14,0,true);expect(Array.from(canopy.instanceMatrix.array)).toEqual(initial);
    disposeObject(landscape.root);
  });
});
