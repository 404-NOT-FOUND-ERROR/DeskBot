import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { communitySupplyAt } from '../src/deskbot/communitySupply.ts';
import { CommunitySupply } from '../src/deskbot/CommunitySupply.tsx';
import type { DeskBotWorldMap, DeskBotWorldTask } from '../src/deskbot/types.ts';

const fixtures = JSON.parse(readFileSync(new URL('../public/life-review-fixtures.json', import.meta.url), 'utf8'));
function sample(): DeskBotWorldMap {
  const map: DeskBotWorldMap = structuredClone(fixtures.frames.begin.map);
  const own = map.protagonist.character_id, others = map.autonomy!.actors.filter(actor => actor.actor_id !== own).slice(0, 2);
  map.autonomy!.actors = [map.autonomy!.actors.find(actor => actor.actor_id === own)!, ...others];
  map.autonomy!.actors.forEach(actor => { actor.appetite = .95; actor.inventory = { rations: 0 }; });
  // The owner's bag is provided separately; counting both would invent carried meals.
  map.autonomy!.actors[0]!.inventory = { rations: 99 };
  map.living!.inventory.stock = { rations: 2 };
  map.autonomy!.actors[1]!.inventory = { rations: 1, light_fruit: 2 };
  const objects = map.locations.flatMap(place => (place.areas ?? []).flatMap(area => area.objects ?? []));
  objects.find(object => object.object_id === 'shared-table')!.state!.stock = { rations: 1 };
  objects.find(object => object.object_id === 'seedling-rack')!.state!.stock = { moss: 4, light_fruit: 2 };
  objects.find(object => object.object_id === 'trial-stove')!.state!.stock = { water: 3 };
  map.tasks = [];
  return map;
}
const task = (map: DeskBotWorldMap, override: Partial<DeskBotWorldTask> = {}): DeskBotWorldTask => ({
  task_id: 'cook-actual', actor_id: map.protagonist.character_id, title: '煮一锅林间光果餐', kind: 'craft', status: 'running',
  activity_id: 'cook-grove-stew', target_object_id: 'trial-stove', location_id: 'warm-pot-courtyard',
  due_at: '2026-10-06T12:00:00Z', remaining_ms: 1200000, ...override,
});

describe('community food follows canonical stocks and admitted work', () => {
  it('separates table-ready, carried, hungry and reserved meals without predicting cooked output', () => {
    const map = sample(), eater = map.autonomy!.actors[2]!;
    map.tasks = [task(map), task(map, { task_id: 'meal', actor_id: eater.actor_id, kind: 'care', activity_id: 'share-meal', target_object_id: 'shared-table',
      reservation: { status: 'held', inputs: [{ container: 'shared-table', resource: 'rations', count: 1 }] } })];
    const before = JSON.stringify(map), view = communitySupplyAt(map)!;
    expect(view).toMatchObject({ population: 3, needingMeal: 2, stronglyHungry: 2, ready: 1, carried: 3, heldMeals: 1, eating: 1 });
    expect(view.work).toHaveLength(1); expect(view.work[0]!.title).toBe('煮一锅林间光果餐');
    const html = renderToStaticMarkup(createElement(CommunitySupply, { map, onPlace: () => {} }));
    expect(html).toContain('长桌还不够'); expect(html).toContain('1 位正在用餐，1 份已经留给这次用餐');
    expect(html).toContain('长桌可取'); expect(html).not.toContain('>99</strong>'); expect(html).not.toContain('预计做出');
    expect(JSON.stringify(map)).toBe(before);
  });
  it('does not call plans, completed tasks or an empty trip active food transport', () => {
    const map = sample(); map.autonomy!.actors[0]!.plan = { plan_id: 'future', title: '将来想做饭', reason: '', status: 'planned', index: 0, task_id: null, steps: [{ kind: 'activity' }] };
    map.tasks = [task(map, { status: 'completed' }), task(map, { task_id: 'empty-trip', actor_id: map.autonomy!.actors[2]!.actor_id, kind: 'travel', activity_id: undefined })];
    expect(communitySupplyAt(map)!.work).toEqual([]);
    map.tasks.push(task(map, { task_id: 'actual-cargo', actor_id: map.autonomy!.actors[1]!.actor_id, kind: 'travel', status: 'paused', activity_id: undefined, to_location_id: 'moss-sprout-garden' }));
    const view = communitySupplyAt(map)!; expect(view.work).toHaveLength(1); expect(view.work[0]).toMatchObject({ status: 'paused', locationId: 'moss-sprout-garden' });
    const html = renderToStaticMarkup(createElement(CommunitySupply, { map, onPlace: () => {} })); expect(html).toContain('暂时停下');
  });
  it('keeps missing stocks unknown and source stock separate from prepared meals', () => {
    const map = sample(), grove = map.locations.find(place => place.location_id === 'backlit-grove')!;
    grove.areas ??= []; grove.areas.push({ area_id: 'fruit', location_id: grove.location_id, name: '林缘', description: '', access: 'public', neighbor_area_ids: [],
      objects: [{ object_id: 'light-fruit-bough', area_id: 'fruit', name: '光果枝', description: '', object_kind: 'source', state_scope: 'persistent_living',
        state: { object_id: 'light-fruit-bough', kind: 'ecological_source', updated_at: '2026-10-06T12:00:00Z', stock: { light_fruit: 7.5 }, capacity: 12 } }] });
    const table = map.locations.flatMap(place => (place.areas ?? []).flatMap(area => area.objects ?? [])).find(object => object.object_id === 'shared-table')!;
    delete table.state;
    expect(communitySupplyAt(map)).toMatchObject({ ready: null, source: { quantity: 7.5, capacity: 12 }, carried: 3 });
    expect(communitySupplyAt({ ...map, living: null })).toBeNull();
    expect(communitySupplyAt(null)).toBeNull();
  });
  it('keeps paused eaters hungry and shows their held meal separately from active eating or free food', () => {
    const map = sample();
    map.tasks = [task(map, { task_id: 'paused-meal', kind: 'care', status: 'paused', activity_id: 'share-meal', target_object_id: 'shared-table',
      reservation: { status: 'held', inputs: [{ container: 'shared-table', resource: 'rations', count: 1 }] } }),
      task(map, { task_id: 'paused-gather', actor_id: map.autonomy!.actors[1]!.actor_id, kind: 'care', status: 'paused', activity_id: 'gather-light-fruit', target_object_id: 'light-fruit-bough', location_id: 'backlit-grove' })];
    const before = JSON.stringify(map), view = communitySupplyAt(map)!;
    expect(view).toMatchObject({ needingMeal: 3, eating: 0, ready: 1, heldMeals: 1, heldPausedMeals: 1 });
    const html = renderToStaticMarkup(createElement(CommunitySupply, { map, onPlace: () => {} }));
    expect(html).toContain('1 份饭食已预留，对应用餐暂时停下');
    expect(html).toContain('暂时停下'); expect(html).not.toContain('正在用餐'); expect(html).not.toContain('正在准备食材');
    expect(JSON.stringify(map)).toBe(before);
  });
});
