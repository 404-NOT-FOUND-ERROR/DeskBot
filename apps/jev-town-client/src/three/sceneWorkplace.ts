import * as THREE from 'three';

/** Resolve a forest standing point against floors, excluding overhead roofs. */
export function sceneStandingSurfaceAt(object:THREE.Object3D,anchor:THREE.Vector3):THREE.Vector3{
  let forest:THREE.Object3D|null=object;
  while(forest&&forest.name!=='windleaf-full-region')forest=forest.parent;
  if(forest){
    const floors:THREE.Object3D[]=[];
    forest.traverse(child=>{if(['windleaf-terrain','windleaf-route-surface','windleaf-work-clearings','wind-shelter'].includes(child.name))floors.push(child);});
    forest.updateWorldMatrix(true,true);
    const hit=new THREE.Raycaster(anchor.clone().add(new THREE.Vector3(0,.55,0)),new THREE.Vector3(0,-1,0),0,5).intersectObjects(floors,false)[0];
    if(hit)anchor.y=hit.point.y;
  }
  return anchor;
}

/** Resolve a committed task's visible workstation before the first render. */
export function sceneWorkAnchor(object: THREE.Object3D, road: THREE.Vector3, activityId?: string, facilitySlot?:number): THREE.Vector3 {
  object.updateWorldMatrix(true, true);
  // Forest fixtures carry their own transform (including a raised deck and
  // a reversible frame); their local working point must not use the lot parent.
  const local = object.userData.work_anchor;
  if(local){
    const anchor=object.localToWorld(new THREE.Vector3(...local as [number,number,number]));
    // An attachment's origin is not its standing surface (a personal frame is
    // raised above the deck). Resolve only floor geometry, below the work point,
    // so an overhead roof or a workbench cannot become a resident's floor.
    return sceneStandingSurfaceAt(object,anchor);
  }
  const station=activityId?object.userData.workstations?.[activityId]:undefined;
  const point = (Number.isInteger(facilitySlot)?station?.standing_by_slot?.[facilitySlot!]:undefined)??station?.standing;
  if (point && object.parent) {
    const anchor = object.parent.localToWorld(new THREE.Vector3(...point as [number, number, number]));
    return anchor;
  }
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const towardRoad = new THREE.Vector3(road.x - center.x, 0, road.z - center.z).normalize();
  center.addScaledVector(towardRoad, Math.min(3, Math.max(size.x, size.z) * .45) + 1.1);
  center.y = object.parent?.getWorldPosition(new THREE.Vector3()).y??0;
  return center;
}

/** A task-specific facing point keeps a worker looking into its actual tool. */
export function sceneWorkTarget(object: THREE.Object3D, activityId?: string): THREE.Vector3 | null {
  if(object.userData.work_anchor&&object.userData.inspection_anchor){object.updateWorldMatrix(true,true);return object.localToWorld(new THREE.Vector3(...object.userData.inspection_anchor as [number,number,number]));}
  const point = activityId ? object.userData.workstations?.[activityId]?.facing : undefined;
  if (!point || !object.parent) return null;
  object.updateWorldMatrix(true, true);
  return object.parent.localToWorld(new THREE.Vector3(...point as [number, number, number]));
}
