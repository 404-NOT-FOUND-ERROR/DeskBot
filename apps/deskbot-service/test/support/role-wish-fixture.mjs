import { loadWorldMapContent } from '../../src/world-map-content.mjs';
import { installLivingResources } from '../../src/living-resources.mjs';
import { installAutonomy } from '../../src/life-state.mjs';
import { DEVELOPMENT_FACETS_VERSION } from '../../src/development-facets.mjs';

export const OWNER = 'shaping-001';
export const WISH_AT = '2026-10-09T04:00:00.000Z';
const days = ['2026-10-06T04:00:00.000Z', '2026-10-07T04:00:00.000Z', '2026-10-08T04:00:00.000Z'];
// Canonical fixture records exercise integration gates; the public experiment
// separately produces each root through actual route and recipe execution.
export function wishRoot(id, { at = days[0], activity = 'water-bed', location = 'moss-sprout-garden', topic = 'care', motivation = 'self_continuation', observe = false } = {}) {
  return { root_outcome_id: `task:${id}`, actor_ids: [OWNER], at, outcome: 'completed', activity_id: observe ? null : activity,
    location_id: location, topic, source: { kind: 'canonical_task', task_kind: observe ? 'observe' : 'care', life_action: observe ? 'observe' : null },
    causes: { trigger: 'own', motivation: { kind: motivation }, sources: [] }, views: {}, effect: { practice: !observe }, failure: null };
}
export function readyWishWorld({ chef = false } = {}) {
  const catalog = loadWorldMapContent();
  const records = days.map((at, index) => wishRoot(`frog-${index}`, { at, activity: index === 1 ? 'tend-bed' : 'water-bed' }));
  if (chef) records.push(...days.flatMap((at, index) => [wishRoot(`chef-observe-${index}`, { at, observe: true, topic: 'cook', location: 'warm-pot-courtyard' }),
    wishRoot(`chef-cook-${index}`, { at: new Date(Date.parse(at) + 20 * 60_000).toISOString(), activity: 'cook-moss', location: 'warm-pot-courtyard', topic: 'cook' })]));
  const world = { protagonist: { character_id: OWNER, display_name: '喵呜', location_id: 'shaping-field-desk', form: 'anchor' },
    npcs: [], clock: { mode: 'real_time', time_zone: 'Asia/Shanghai', synced_at: WISH_AT },
    map_catalog: catalog, locations: structuredClone(catalog.locations), passage_states: {}, tasks: [],
    memory: { actors: {}, development: { schema: 'deskbot.development-evidence.v1', installed_at: days[0], revision: 1, records, contacts: [],
      facets: { schema: DEVELOPMENT_FACETS_VERSION, installed_at: days[0], revision: 1 } } } };
  installLivingResources(world, days[0]); installAutonomy(world, days[0]);
  world.living.inventories[OWNER] = { stock: { moss: 5, light_fruit: 4 }, capacity: 24 };
  return world;
}
export function mapPersistence() {
  const records = new Map(), writes = [];
  return { records, writes,
    list: namespace => [...records.entries()].filter(([key]) => key.startsWith(`${namespace}:`)).map(([, value]) => structuredClone(value)),
    put(namespace, id, value) { records.set(`${namespace}:${id}`, structuredClone(value)); writes.push({ namespace, id }); },
    remove(namespace, id) { records.delete(`${namespace}:${id}`); },
    transaction(operation) { return operation(); },
  };
}
