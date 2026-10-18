import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import samples from '../src/deskbot/windleafReviewFixtures.json';
import type {DeskBotWorldMap} from '../src/deskbot/types.ts';
import {createWindleafScene} from '../src/three/windleafScene.ts';
import {buildTownScenery,disposeObject} from '../src/three/buildScene.ts';
import {worldSceneBounds,windleafHeightAt} from '../src/three/windleafLayout.ts';
import {canonicalPointForLocation,canonicalRouteBetween} from '../src/deskbot/canonicalGeometry.ts';
import {resolveTravelRoute} from '../src/deskbot/routeVisual.ts';
const maps=samples as unknown as {samples:Record<string,{map:DeskBotWorldMap}>};
const sample=(id:string)=>maps.samples[id]!.map;
describe('Windleaf authoritative state projection and retained town',()=>{
 it('expands bounds without moving town anchors or clipping forest coordinates',()=>{
  const map=sample('installed'),ridge=map.locations.find(p=>p.location_id==='windleaf-shelter')!,edge=map.locations.find(p=>p.location_id==='windleaf-edge')!;
  expect(worldSceneBounds(map.locations).max_x).toBe(302);expect(canonicalPointForLocation(ridge)).toEqual({x:190,y:65});expect(windleafHeightAt(80,68)).toBeGreaterThan(0);expect(windleafHeightAt(190,65)).toBeGreaterThan(windleafHeightAt(150,30)+2);
  const route=canonicalRouteBetween(edge,ridge);const actual=canonicalRouteBetween(edge,map.locations.find(p=>p.location_id==='windleaf-lowland')!);expect(actual[0]).toEqual({x:125,y:50});expect(actual.at(-1)).toEqual({x:150,y:30});
  expect(resolveTravelRoute(actual,{x:125,y:50},{x:150,y:30},route,'jev-town-map-v2')).toEqual(actual);
 });
 it('uninstalled frames are absent; actual shutter, patch, readings, water and packing use same stable origin',()=>{
  const empty=createWindleafScene(sample('empty').locations)!;expect(empty.root.getObjectByName('leaf-frame-slot:0')!.visible).toBe(false);disposeObject(empty.root);
  const scene=createWindleafScene(sample('installed').locations)!;const frame=scene.root.getObjectByName('leaf-frame-slot:0')!,shutter=frame.getObjectByName('cloth-shutter')!.parent!;
  scene.update(0,0,0,0,true,{minute:840,daylight:1,activities:[]});expect(frame.visible).toBe(true);const root=frame.userData.frame_id;const angle=shutter.rotation.x;
  scene.applyState(sample('rain').locations);scene.update(0,1,8,.7,true,{minute:90,daylight:0,activities:[]});expect(frame.userData.frame_id).toBe(root);expect(shutter.rotation.x).toBe(0);expect(angle).toBeLessThan(0);
  scene.applyState(sample('patched').locations);expect(frame.userData.frame_id).toBe(root);expect(frame.getObjectByName('repair-tool')!.parent!.visible).toBe(false);
  scene.applyState(sample('packed').locations);expect(frame.visible).toBe(false);disposeObject(scene.root);
 });
 it('keeps admitted places while replacing the terrain with a larger continuous landscape',()=>{
  const extended=buildTownScenery(sample('installed').locations),town=buildTownScenery(sample('installed').locations.filter(p=>p.presentation?.space!=='jev-town-map-v2'));
  const inventory=(root:THREE.Group)=>{let meshes=0,triangles=0,instances=0;const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();root.traverse(o=>{if(o instanceof THREE.Mesh){meshes++;geometries.add(o.geometry);const count=o instanceof THREE.InstancedMesh?o.count:1;if(o instanceof THREE.InstancedMesh)instances+=o.count;triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position')?.count??0)/3*count;for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});return {meshes,triangles,instances,unique_geometries:geometries.size,unique_materials:materials.size};};
  const base=inventory(town.root),expanded=inventory(extended.root);expect(extended.root.getObjectByName('town-ground')).toBeDefined();expect(extended.root.getObjectByName('windleaf-terrain')).toBeDefined();expect(expanded.triangles).toBeGreaterThan(base.triangles);
  town.dispose();extended.dispose();
 });
 it('midnight work uses its lamp; rest, paused work and daylight do not simulate a working shelter',()=>{
  const s=createWindleafScene(sample('installed').locations)!,lamp=s.root.getObjectByName('windleaf-work-lamp') as THREE.Mesh<THREE.BoxGeometry,THREE.MeshBasicMaterial>;
  const task={actorId:'shaping-001',citizenId:1,locationId:'windleaf-shelter',taskId:'test-work',title:'测记',kind:'observe',activityId:'leaf-read',targetObjectId:'windleaf-rack',status:'running' as const,dueAt:'2026-10-13T18:00:00Z',remainingMs:1000};
  s.update(0,1,0,0,true,{minute:90,daylight:0,activities:[task]});expect(lamp.material.color.getHex()).toBe(0xf0cf84);
  s.update(0,1,0,0,true,{minute:90,daylight:0,activities:[{...task,kind:'rest'}]});expect(lamp.material.color.getHex()).toBe(0x463f34);
  s.update(0,1,0,0,true,{minute:90,daylight:0,activities:[{...task,status:'paused'}]});expect(lamp.material.color.getHex()).toBe(0x463f34);
  s.update(0,0,0,0,true,{minute:840,daylight:1,activities:[task]});expect(lamp.material.color.getHex()).toBe(0x463f34);disposeObject(s.root);
 });
 it('a downward sightline reaches actual water, and dry basin has no water surface',()=>{
  const map=structuredClone(sample('rain')),s=createWindleafScene(map.locations)!,basin=s.objects.get('windleaf-rain-basin')!;
  const state=map.locations.flatMap(p=>p.areas??[]).flatMap(a=>a.objects??[]).find(o=>o.object_id==='windleaf-rain-basin')!.state!;
  for(const level of [.1,.95]){
   state.water_level=level;s.applyState(map.locations);s.root.updateMatrixWorld(true);
   const center=basin.getWorldPosition(new THREE.Vector3()),ray=new THREE.Raycaster(center.clone().add(new THREE.Vector3(0,10,0)),new THREE.Vector3(0,-1,0));
   expect(ray.intersectObject(basin,true)[0]!.object.name).toBe('actual-basin-water');
  }
  state.water_level=0;s.applyState(map.locations);expect(basin.getObjectByName('actual-basin-water')!.visible).toBe(false);disposeObject(s.root);
 });
 it('visible wear and repaired patches survive inspection without replacing the frame',()=>{
  const map=structuredClone(sample('installed')),s=createWindleafScene(map.locations)!,frame=s.root.getObjectByName('leaf-frame-slot:0')!;
  const state=map.locations.flatMap(p=>p.areas??[]).flatMap(a=>a.objects??[]).find(o=>o.object_id==='windleaf-rack')!.state!.leaf_frames![0]!;
  const id=frame.userData.frame_id;state.condition=.25;state.patches=0;s.applyState(map.locations);
  expect(frame.getObjectByName('cloth-wear:2')!.visible).toBe(true);expect(frame.getObjectByName('cloth-shutter')!.visible).toBe(false);
  state.condition=.9;state.patches=2;s.applyState(map.locations);expect(frame.userData.frame_id).toBe(id);expect(frame.getObjectByName('cloth-shutter')!.visible).toBe(true);
  expect(frame.getObjectByName('retained-patch:0')!.visible).toBe(true);expect(frame.getObjectByName('retained-patch:1')!.visible).toBe(true);expect(frame.getObjectByName('retained-patch:2')!.visible).toBe(false);disposeObject(s.root);
 });
 it('animation cannot invent a retained gust or consume its saved evidence',()=>{
  const map=structuredClone(sample('installed')),s=createWindleafScene(map.locations)!,fold=s.root.getObjectByName('retained-wind-fold:0')!;
  s.update(9999,1,12,1,false);expect(fold.visible).toBe(false);
  const state=map.locations.flatMap(p=>p.areas??[]).flatMap(a=>a.objects??[]).find(o=>o.object_id==='windleaf-canopy')!.state!;
  state.wind_trace={rule_version:'test',active:true,intensity:.6,formed_at:'2026-10-12T10:00:00Z',expires_at:'2026-10-12T10:30:00Z',weather_event_id:'isolated-wind',last_sample_at:'2026-10-12T10:12:00Z',eligible_seconds:0,cooldown_until:null,generation:1};
  const before=JSON.stringify(state);s.applyState(map.locations);s.update(999999,1,0,0,true);expect(fold.visible).toBe(true);expect(JSON.stringify(state)).toBe(before);
  state.wind_trace.active=false;s.applyState(map.locations);s.update(0,1,12,1,true);expect(fold.visible).toBe(false);disposeObject(s.root);
 });
});
