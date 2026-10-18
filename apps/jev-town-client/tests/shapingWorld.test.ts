import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {projectShapingPoint,unprojectShapingPoint,shapingWorldPoint,projectShapingScenery} from '../src/three/shapingProjection.ts';
import {createShapingRender} from '../src/three/shapingRender.ts';
import {createMoltedShellLandscape} from '../src/three/moltedShellLandscape.ts';
import {canonicalPointForLocation,canonicalRouteBetween} from '../src/deskbot/canonicalGeometry.ts';
import {buildTownScenery,disposeObject} from '../src/three/buildScene.ts';
import {sceneWorkAnchor} from '../src/three/sceneWorkplace.ts';
import {windleafHeightAt} from '../src/three/windleafLayout.ts';
import samples from '../src/deskbot/windleafReviewFixtures.json';
import type {DeskBotWorldMap} from '../src/deskbot/types.ts';
const map=(samples as unknown as {samples:{installed:{map:DeskBotWorldMap}}}).samples.installed.map;

describe('central settlement and surrounding terrain projection',()=>{
  it('round-trips all live places and their routes, including both sides of the old boundary',()=>{
    const before=JSON.stringify(map);
    for(const place of map.locations){
      const p=canonicalPointForLocation(place),q=projectShapingPoint(p.x,p.y),back=unprojectShapingPoint(q.x,q.y);
      expect(Math.hypot(back.x-p.x,back.y-p.y)).toBeLessThan(.0001);
      for(const id of place.neighbors??[]){const to=map.locations.find(p=>p.location_id===id)!;if(!to)continue;
        const route=canonicalRouteBetween(place,to);
        for(let i=1;i<route.length;i++){const a=route[i-1]!,b=route[i]!,steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*2);let last=projectShapingPoint(a.x,a.y);
          for(let j=1;j<=steps;j++){const p={x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps},q=projectShapingPoint(p.x,p.y);expect(Math.hypot(q.x-last.x,q.y-last.y)).toBeLessThan(1);last=q;}
        }
      }
    }
    for(const y of [-50,0,60,120,190]){const a=projectShapingPoint(112-.0001,y),b=projectShapingPoint(112+.0001,y);expect(Math.hypot(a.x-b.x,a.y-b.y)).toBeLessThan(.001);}
    expect(JSON.stringify(map)).toBe(before);
    const town=map.locations.filter(p=>p.presentation?.lot).map(p=>projectShapingPoint(p.presentation!.lot!.x,p.presentation!.lot!.y));
    expect(town.every(p=>Math.hypot(p.x-141,p.y-140)<65)).toBe(true);
  });
  it('projects animated instances once per rewrite rather than accumulating distortion',()=>{
    const root=new THREE.Group(),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshLambertMaterial(),1),matrix=new THREE.Matrix4().makeTranslation(90,2,-30);
    mesh.setMatrixAt(0,matrix);root.add(mesh);const project=projectShapingScenery(root),expected=shapingWorldPoint(150,30);
    const actual=()=>{root.updateMatrixWorld(true);mesh.getMatrixAt(0,matrix);return new THREE.Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);};
    expect(actual().x).toBeCloseTo(expected.x,4);const first=actual().clone();project.update();expect(actual().distanceTo(first)).toBeLessThan(.00001);
    mesh.visible=false;mesh.instanceMatrix.needsUpdate=true;project.update();expect(actual().distanceTo(first)).toBeLessThan(.00001);mesh.visible=true;
    mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(91,2,-30));mesh.instanceMatrix.needsUpdate=true;project.update();expect(actual().x).toBeCloseTo(shapingWorldPoint(151,30).x,4);disposeObject(root);
  });
  it('keeps state handles and work anchors on transformed, elevated facilities',()=>{
    const scene=buildTownScenery(map.locations),objects=scene.companion!.objects,ids=[...objects.keys()];
    const projection=projectShapingScenery(scene.root);projection.update();
    expect([...objects.keys()]).toEqual(ids);expect(ids.length).toBeGreaterThanOrEqual(27);
    const rack=objects.get('windleaf-rack')!,p=rack.getWorldPosition(new THREE.Vector3()),expected=shapingWorldPoint(190,65);
    expect(p.x).toBeCloseTo(expected.x);expect(p.z).toBeCloseTo(expected.z);
    const anchor=sceneWorkAnchor(rack,new THREE.Vector3(),'leaf-read');expect(anchor.y).toBeCloseTo(windleafHeightAt(190,65)+.18,4);
    const seed=objects.get('seedling-rack')!,townAnchor=sceneWorkAnchor(seed,new THREE.Vector3(),'save-seeds');
    expect(townAnchor.y).toBeGreaterThan(.5);expect(townAnchor.y).toBeCloseTo(windleafHeightAt(20,100),4);
    scene.dispose();
  });
});

describe('shared toon rendering with live state',()=>{
  it('updates home lights immediately with reduced motion while most homes sleep after midnight',()=>{
    const scene=createMoltedShellLandscape(map.locations),windows:THREE.Mesh[]=[];
    scene.root.traverse(o=>{if(o instanceof THREE.Mesh&&o.name==='shell-house-window')windows.push(o);});
    const lit=()=>windows.filter(o=>(o.material as THREE.MeshBasicMaterial).opacity>.5).length;
    scene.update(0,1,1200,true);expect(lit()).toBe(windows.length);expect(lit()).toBeGreaterThan(8);
    scene.update(0,1,90,true);expect(lit()).toBeLessThan(windows.length*.2);
    scene.update(0,0,840,true);expect(lit()).toBe(0);disposeObject(scene.root);
  });
  it('preserves live colours, emissive changes and wind shaders',()=>{
    const source=new THREE.MeshLambertMaterial({color:0x55aa77}),shader=()=>{};source.onBeforeCompile=shader;
    const root=new THREE.Group(),mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(2,0),source);root.add(mesh);
    const style=createShapingRender();style.attach(root);
    const target=mesh.material as unknown as THREE.MeshToonMaterial;
    expect(target.isMeshToonMaterial).toBe(true);expect(target.gradientMap).toBe(style.gradient);expect(target.onBeforeCompile).toBe(shader);
    source.color.setHex(0xaabbcc);source.emissiveIntensity=.7;style.update();expect(target.color.getHex()).toBe(0xaabbcc);expect(target.emissiveIntensity).toBe(.7);
    const count=mesh.children.length;style.attach(root);expect(mesh.children.length).toBe(count);disposeObject(root);style.dispose();
  });
});
