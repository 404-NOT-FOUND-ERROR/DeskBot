import * as THREE from 'three';

/** Resolve a committed task's visible workstation before the first render. */
export function sceneWorkAnchor(object: THREE.Object3D, road: THREE.Vector3, activityId?: string): THREE.Vector3 {
  object.updateWorldMatrix(true, true);
  const point = activityId ? object.userData.workstations?.[activityId]?.standing : undefined;
  if (point && object.parent) {
    const anchor = object.parent.localToWorld(new THREE.Vector3(...point as [number, number, number]));
    anchor.y = 0;
    return anchor;
  }
  const bounds = new THREE.Box3().setFromObject(object);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const towardRoad = new THREE.Vector3(road.x - center.x, 0, road.z - center.z).normalize();
  center.addScaledVector(towardRoad, Math.min(3, Math.max(size.x, size.z) * .45) + 1.1);
  center.y = 0;
  return center;
}

/** A task-specific facing point keeps a worker looking into its actual tool. */
export function sceneWorkTarget(object: THREE.Object3D, activityId?: string): THREE.Vector3 | null {
  const point = activityId ? object.userData.workstations?.[activityId]?.facing : undefined;
  if (!point || !object.parent) return null;
  object.updateWorldMatrix(true, true);
  return object.parent.localToWorld(new THREE.Vector3(...point as [number, number, number]));
}
