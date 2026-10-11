import {findWorldPath} from './world-map-content.mjs';

// Public geography is known; off-site inventory, people and private state are not.
export function cognitiveDestinations(world, locationId) {
  return world.locations.flatMap(place => {
    if (place.location_id === locationId || place.visibility === 'hidden') return [];
    const path = findWorldPath(world, locationId, place.location_id);
    if (!path) return [];
    return [{id: place.location_id, name: place.name,
      description: place.description ?? place.arrival_text ?? '聚形域中的已知地点',
      travel_seconds: path.slice(1).reduce((sum, id) => sum + (world.locations.find(p => p.location_id === id)?.travel_cost ?? 10) * 60, 0)}];
  }).sort((a,b) => a.travel_seconds-b.travel_seconds || a.id.localeCompare(b.id));
}

export function resolveCognitiveRoute(world, refs, index) {
  const destination = Number.isSafeInteger(index) && index > 0 ? refs.destinations?.[index-1] : null;
  if (!destination) throw Object.assign(new Error('移动目标编号无效'), {code:'destination_reference_invalid'});
  const path = findWorldPath(world, refs.location_id, destination);
  if (!path || path.length < 2) throw Object.assign(new Error('原来的通路现在不可达，需要重新安排'), {code:'destination_route_unavailable'});
  return {locationId:path[1], destinationId:destination};
}
