import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export class WorldMapError extends Error {
  constructor(code, message, statusCode = 400) { super(message); this.code = code; this.statusCode = statusCode; }
}
const fail = (message, code = 'invalid_map_content') => { throw new WorldMapError(code, message); };
const id = (value, label) => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,159}$/.test(value)) fail(`${label} must be a stable ID`);
};
const text = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) fail(`${label} requires bounded text`);
};
const point = (value, label, min = 0, max = 100) => {
  if (!value || !['x','y'].every(key => Number.isFinite(value[key]) && value[key] >= min && value[key] <= max)) fail(`${label} requires finite coordinates`);
};
const equal = isDeepStrictEqual;
function entries(content, key, idKey, maximum) {
  if (!Array.isArray(content[key]) || !content[key].length || content[key].length > maximum) fail(`${key} requires 1 to ${maximum} entries`);
  const result = new Map();
  for (const entry of content[key]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(`${key} requires objects`);
    id(entry[idKey], idKey); text(entry.name, `${idKey}.name`);
    if (result.has(entry[idKey])) fail(`Duplicate ${idKey}: ${entry[idKey]}`);
    result.set(entry[idKey], entry);
  }
  return result;
}

// Validate the entire candidate before any canonical write. Authored content
// describes possible places and objects; it never declares an executed task,
// stock count, resident owner, or a new character trait.
export function validateWorldMapContent(content) {
  if (content?.schema !== 'deskbot.world-map-content.v1' || content.settlement_id !== 'morrowmere'
    || content.setting_id !== 'shaping-field-v2.1' || content.objects_have_simulated_state !== false) fail('Map must belong to the current setting and declare catalog-only objects');
  id(content.content_id, 'content_id'); text(content.version, 'version');
  const regions = entries(content, 'regions', 'region_id', 100);
  const locations = entries(content, 'locations', 'location_id', 200);
  const areas = entries(content, 'areas', 'area_id', 1000);
  const objects = entries(content, 'objects', 'object_id', 2000);
  const passages = entries(content, 'passages', 'passage_id', 1000);
  for (const region of regions.values()) {
    if (region.settlement_id !== content.settlement_id) fail('Region belongs to another settlement');
    text(region.description, 'region.description');
    if (!/^#[0-9a-f]{6}$/i.test(region.color)) fail('Region color must be a hex color');
  }
  for (const location of locations.values()) {
    if (!regions.has(location.region_id) || location.settlement_id !== content.settlement_id) fail('Location region or settlement is unknown');
    text(location.description, 'location.description'); point(location, 'location');
    if (!Number.isSafeInteger(location.travel_cost) || location.travel_cost < 1 || location.travel_cost > 10080) fail('Travel cost must be positive minutes');
    if (!['visible','hidden'].includes(location.visibility)) fail('Invalid location visibility');
    if (!Array.isArray(location.neighbors) || new Set(location.neighbors).size !== location.neighbors.length || !location.neighbors.length) fail('Location requires unique neighbors');
    for (const neighborId of location.neighbors) {
      if (neighborId === location.location_id || !locations.has(neighborId) || !locations.get(neighborId).neighbors?.includes(location.location_id)) fail('Neighbors must exist and connect in both directions');
    }
    if (location.presentation?.space !== 'jev-town-map-v1') fail('Unknown presentation space');
    point(location.presentation.point, 'presentation.point', 10, 110);
    if (location.presentation.lot) {
      point(location.presentation.lot, 'presentation.lot', 20, 100);
      if (![20,40,60,80,100].includes(location.presentation.lot.x) || ![20,40,60,80,100].includes(location.presentation.lot.y)
        || !['home','homes','nursery','waterside','grove','shelter','square','market','courtyard','workshop'].includes(location.presentation.model)) fail('Scene binding requires an authored lot and model');
    }
  }
  if (!locations.has('shaping-field-desk')) fail('Map must preserve the protagonist home');
  const seen = new Set(['shaping-field-desk']), queue = ['shaping-field-desk'];
  while (queue.length) for (const next of locations.get(queue.shift()).neighbors) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  if (seen.size !== locations.size) fail('Every admitted location needs a geographic connection');
  for (const area of areas.values()) {
    if (!locations.has(area.location_id) || !['public','resident'].includes(area.access)) fail('Area location or access is invalid');
    text(area.description, 'area.description'); point(area, 'area');
    if (!Array.isArray(area.neighbor_area_ids) || new Set(area.neighbor_area_ids).size !== area.neighbor_area_ids.length) fail('Area requires unique connections');
    for (const neighborId of area.neighbor_area_ids) {
      const neighbor = areas.get(neighborId);
      if (!neighbor || neighborId === area.area_id || neighbor.location_id !== area.location_id || !neighbor.neighbor_area_ids?.includes(area.area_id)) fail('Area connections must stay within their location and be reciprocal');
    }
  }
  for (const locationId of locations.keys()) if (![...areas.values()].some(area => area.location_id === locationId)) fail('Every location requires an internal area');
  for (const object of objects.values()) {
    if (!areas.has(object.area_id) || object.state_scope !== 'catalog_only') fail('Object area or state scope is invalid');
    text(object.description, 'object.description'); id(object.object_kind, 'object_kind');
    if (!equal(object.capabilities, ['inspect'])) fail('Only catalog inspection is currently implemented');
  }
  const edges = new Set();
  for (const passage of passages.values()) {
    const from = locations.get(passage.from_location_id), to = locations.get(passage.to_location_id);
    if (!from || !to || !from.neighbors.includes(to.location_id)) fail('Passage endpoints must be neighbors');
    const edge = [from.location_id, to.location_id].sort().join('--');
    if (edges.has(edge)) fail('Duplicate geographic passage');
    edges.add(edge);
    if (passage.default_status !== 'open' || passage.presentation_space !== 'jev-town-map-v1'
      || !Array.isArray(passage.presentation_points) || passage.presentation_points.length < 2 || passage.presentation_points.length > 20) fail('Invalid passage presentation or default access');
    passage.presentation_points.forEach(p => point(p, 'passage.point', 10, 110));
    if (!equal(passage.presentation_points[0], from.presentation.point) || !equal(passage.presentation_points.at(-1), to.presentation.point)) fail('Passage presentation must match its endpoints');
  }
  for (const location of locations.values()) for (const neighbor of location.neighbors) {
    if (!edges.has([location.location_id,neighbor].sort().join('--'))) fail('Each geographic connection requires a passage');
  }
  return structuredClone(content);
}

const authored = validateWorldMapContent(JSON.parse(readFileSync(new URL('../../../world-content/companion-world/map.v1.json', import.meta.url), 'utf8')));
export function loadWorldMapContent() { return structuredClone(authored); }

// Explicit, versioned correction of the imported scene layout. This is not an
// expansion and cannot be requested by public observations. Stable identities,
// topology, travel deadlines and ownership remain attached to their IDs.
export function upgradeAuthoredScene(world, at) {
  if (world.map_catalog?.version !== '2026-10-04.1' || authored.scene_revision !== 'morrowmere-authored-scene-v1') return false;
  const old = world.map_catalog;
  const semantic = place => { const { x,y,presentation,...rest }=place; return rest; };
  const existingObjectIds=new Set(old.objects.map(o=>o.object_id));
  const expectedObjects=authored.objects.filter(o=>existingObjectIds.has(o.object_id));
  if (!equal(old.locations.map(semantic),authored.locations.map(semantic))
    || !equal(old.areas,authored.areas) || !equal(old.objects,expectedObjects)
    || authored.objects.some(o=>!existingObjectIds.has(o.object_id)&&o.object_id!=='light-fruit-bough')) fail('Scene migration cannot rewrite world semantics');
  for (const place of world.locations) {
    const definition=authored.locations.find(item=>item.location_id===place.location_id);
    if(definition) {place.x=definition.x;place.y=definition.y;place.presentation=structuredClone(definition.presentation);}
  }
  // Keep object admission separate from the presentation correction. The later
  // supply migration records its own added object instead of hiding it here.
  world.map_catalog={...loadWorldMapContent(),objects:structuredClone(old.objects)};
  const previous=world.world_revision;world.world_revision++;
  world.schema_migrations=[...(world.schema_migrations??[]),{id:'morrowmere-authored-scene-v1',applied_at:at,
    before_revision:previous,after_revision:world.world_revision,from_version:old.version,to_version:authored.version,
    scope:'presentation-only',preserved_location_ids:old.locations.map(p=>p.location_id)}];
  return true;
}

// Add one authored resource place without replacing expanded catalogs or any
// physical state. Inventory is installed separately and starts at zero.
export function upgradeCommunitySupplyMap(world, at) {
  const catalog=world.map_catalog;
  if(!catalog || catalog.objects.some(o=>o.object_id==='light-fruit-bough'))return false;
  if(!catalog.areas.some(a=>a.area_id==='grove-edge'))return false;
  const source=authored.objects.find(o=>o.object_id==='light-fruit-bough');
  const candidate={...structuredClone(catalog),objects:[...structuredClone(catalog.objects),structuredClone(source)],
    version:catalog.version==='2026-10-04.2'?authored.version:catalog.version,supply_revision:'morrowmere-community-supply-v1'};
  world.map_catalog=validateWorldMapContent(candidate);
  world.schema_migrations=[...(world.schema_migrations??[]),{id:'morrowmere-community-supply-map-v1',applied_at:at,
    scope:'additive_object',added_object_ids:['light-fruit-bough'],preserved_existing_tasks:true}];
  world.world_revision++;
  return true;
}

// Installation is additive. Existing dynamic fields, physical locations,
// object state, NPC home references and task deadlines stay attached to IDs.
export function installWorldMapContent(world, candidate, at, { expansion = false } = {}) {
  const content = validateWorldMapContent(candidate);
  if (expansion && world.map_catalog) {
    if (content.content_id !== world.map_catalog.content_id || content.version === world.map_catalog.version) fail('Expansion requires the same content ID and a new version');
    for (const [key,idKey] of [['regions','region_id'],['locations','location_id'],['areas','area_id'],['objects','object_id'],['passages','passage_id']]) {
      for (const old of world.map_catalog[key]) {
        const next = content[key].find(item => item[idKey] === old[idKey]);
        // Expansion may attach a new neighbor to an existing location. Other
        // definitions and existing links remain stable; relocation is separate.
        if (!next || (key !== 'locations' && !equal(old, next))) fail(`Expansion must preserve ${old[idKey]}`, 'map_identity_conflict');
        if (key === 'locations') {
          const { neighbors: previousNeighbors, ...previousFields } = old;
          const { neighbors: nextNeighbors, ...nextFields } = next;
          if (!equal(previousFields, nextFields) || previousNeighbors.some(neighbor => !nextNeighbors.includes(neighbor))) fail(`Expansion cannot rewrite ${old.location_id}`, 'map_identity_conflict');
        }
      }
    }
  }
  const before = world.locations ?? [];
  const oldIds = new Set(before.map(place => place.location_id));
  world.locations = before.map(place => {
    const definition = content.locations.find(item => item.location_id === place.location_id);
    return definition ? { ...structuredClone(definition), ...place, neighbors: [...new Set([...(place.neighbors ?? []),...definition.neighbors])], presentation: structuredClone(definition.presentation) } : place;
  });
  for (const place of content.locations) if (!oldIds.has(place.location_id)) world.locations.push(structuredClone(place));
  world.map_catalog = content;
  world.passage_states ??= {};
  for (const passage of content.passages) world.passage_states[passage.passage_id] ??= {
    status: passage.default_status, reason: null, revision: 0, updated_at: at, cause_event_id: null,
  };
  return { content_id: content.content_id, version: content.version, added_location_ids: content.locations.filter(place => !oldIds.has(place.location_id)).map(place => place.location_id) };
}

export function passageFor(world, fromId, toId) {
  return world.map_catalog?.passages.find(passage => (passage.from_location_id === fromId && passage.to_location_id === toId)
    || (passage.to_location_id === fromId && passage.from_location_id === toId)) ?? null;
}

export function worldHopAccess(world, fromId, toId, { ignoreGlobalEvent = false } = {}) {
  const from = world.locations.find(place => place.location_id === fromId), to = world.locations.find(place => place.location_id === toId);
  const passage = passageFor(world, fromId, toId);
  if (!from || !to || !from.neighbors?.includes(toId) || to.visibility === 'hidden') return { allowed: false, code: 'location_not_reachable', reason: '地点不可达或尚未开放', passage_id: passage?.passage_id ?? null };
  if (!ignoreGlobalEvent && world.active_event?.blocks_travel) return { allowed: false, code: 'travel_blocked', reason: `事件阻断：${world.active_event.title || world.active_event.event_id}`, passage_id: passage?.passage_id ?? null };
  const state = passage && world.passage_states?.[passage.passage_id];
  if (state?.status === 'closed') return { allowed: false, code: 'passage_closed', reason: state.reason || '这段通路暂时封闭', passage_id: passage.passage_id };
  return { allowed: true, code: null, reason: null, passage_id: passage?.passage_id ?? null };
}

export function setPassageAccess(world, payload, eventId, at) {
  const passage = world.map_catalog?.passages.find(item => item.passage_id === payload.passage_id);
  if (!passage) throw new WorldMapError('passage_not_found', 'Unknown passage', 404);
  if (!['open','closed'].includes(payload.status)) fail('Passage status must be open or closed');
  text(payload.reason, 'reason');
  const previous = world.passage_states[passage.passage_id];
  if (!Number.isSafeInteger(payload.expected_passage_revision) || previous.revision !== payload.expected_passage_revision) throw new WorldMapError('passage_revision_conflict', 'Passage changed before this action', 409);
  if (Date.parse(at) < Date.parse(previous.updated_at)) throw new WorldMapError('passage_time_conflict', 'Passage state cannot move backwards', 409);
  const state = { status: payload.status, reason: payload.reason, revision: previous.revision + 1, updated_at: at, cause_event_id: eventId };
  world.passage_states[passage.passage_id] = state;
  return { passage_id: passage.passage_id, before: structuredClone(previous), after: structuredClone(state) };
}

export function findWorldPath(world, fromId, toId, options = {}) {
  const places = new Map(world.locations.map(place => [place.location_id, place]));
  if (!places.has(fromId) || !places.has(toId) || places.get(toId).visibility === 'hidden') return null;
  const costs = new Map([[fromId,0]]), paths = new Map([[fromId,[fromId]]]), remaining = new Set([fromId]), settled = new Set();
  const pathKey = path => path.join('\0');
  while (remaining.size) {
    const current = [...remaining].sort((a,b) => costs.get(a)-costs.get(b) || (pathKey(paths.get(a)) < pathKey(paths.get(b)) ? -1 : 1))[0];
    if (current === toId) return paths.get(current);
    remaining.delete(current); settled.add(current);
    for (const neighborId of places.get(current).neighbors ?? []) {
      if (settled.has(neighborId) || !worldHopAccess(world,current,neighborId,options).allowed) continue;
      const cost = costs.get(current) + (places.get(neighborId).travel_cost ?? 10), path = [...paths.get(current),neighborId];
      if (!costs.has(neighborId) || cost < costs.get(neighborId) || (cost === costs.get(neighborId) && pathKey(path) < pathKey(paths.get(neighborId)))) {
        costs.set(neighborId,cost); paths.set(neighborId,path); remaining.add(neighborId);
      }
    }
  }
  return null;
}

export function presentationRouteFor(world, fromId, toId) {
  const passage = passageFor(world,fromId,toId);
  if (!passage) return null;
  const points = structuredClone(passage.presentation_points);
  return passage.from_location_id === fromId ? points : points.reverse();
}
