import * as THREE from 'three';
import type {DeskBotLocation} from '../deskbot/types.ts';
import {canonicalPointForLocation} from '../deskbot/canonicalGeometry.ts';
import {sceneStandingSurfaceAt} from './sceneWorkplace.ts';

// Arrival positions are presentation only. The saved location and admitted
// travel endpoints remain at the authoritative place centres.
const placements:readonly [string,string,[number,number,number]][]=[
  ['windleaf-edge','windleaf-waymarker',[5,0,3]],
  ['windleaf-lowland','windleaf-canopy',[3,0,2]],
  ['windleaf-shelter','windleaf-rack',[0,0,3.3]],
  ['windleaf-return-platform','windleaf-return-table',[4.7,0,1.3]],
];
/** Store arrivals alongside work anchors so terrain projection transforms them
 * with the geometry, rather than applying an old offset after deformation. */
export function attachForestArrivalAnchors(objects:ReadonlyMap<string,THREE.Group>){
  for(const [,id,local] of placements){const object=objects.get(id);if(object)object.userData.arrival_anchor=[...local];}
}
export function forestArrivalAnchors(objects:ReadonlyMap<string,THREE.Group>|undefined,locations:readonly DeskBotLocation[]|undefined){
  return placements.flatMap(([id,objectId,local])=>{
    const object=objects?.get(objectId),place=locations?.find(p=>p.location_id===id);if(!object||!place)return [];
    object.updateWorldMatrix(true,true);
    const offset=(object.userData.arrival_anchor??local) as [number,number,number];
    return [{point:canonicalPointForLocation(place),standing:sceneStandingSurfaceAt(object,object.localToWorld(new THREE.Vector3(...offset)))}];
  });
}
export function forestIdleArrivalAt(anchors:ReturnType<typeof forestArrivalAnchors>,point:{x:number;y:number},walking:boolean,travelling:boolean){
  if(walking||travelling)return undefined;
  // The scene's resident projection spreads co-located figures by up to 2.85
  // units. Match that existing arrival footprint, not only its exact centre.
  return anchors.find(a=>Math.hypot(point.x-a.point.x,point.y-a.point.y)<=3)?.standing;
}
