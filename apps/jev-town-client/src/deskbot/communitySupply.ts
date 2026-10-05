import type { DeskBotWorldMap, DeskBotWorldTask } from './types.ts';

const portions = (value: number | undefined) => Number.isFinite(value) ? Math.max(0, Math.floor(value!)) : 0;
const cropTasks = new Set(['gather-light-fruit', 'harvest-bed', 'harvest-float-bed', 'sow-bed', 'sow-float-bed', 'save-seeds']);
const cookTasks = new Set(['cook-moss', 'cook-leaf-soup', 'cook-grove-stew']);
const foodCargo = (stock: Readonly<Record<string, number>> | undefined) => portions(stock?.rations) + portions(stock?.moss) + portions(stock?.light_fruit) + portions(stock?.seeds);

/** Current food and admitted work only. A planned recipe never becomes available food. */
export function communitySupplyAt(map: DeskBotWorldMap | null | undefined) {
  if (!map?.living || !map.autonomy) return null;
  const objects = map.locations.flatMap(place => (place.areas ?? []).flatMap(area => area.objects ?? []));
  const state = (id: string) => objects.find(object => object.object_id === id)?.state;
  const table = state('shared-table'), rack = state('seedling-rack'), stove = state('trial-stove'), fruit = state('light-fruit-bough');
  const sourceFruit = fruit?.stock?.light_fruit;
  const active = (map.tasks ?? []).filter(task => task.status === 'running' || task.status === 'paused');
  const eating = new Set(active.filter(task => task.status === 'running' && task.activity_id === 'share-meal').map(task => task.actor_id));
  const actors = [...new Map(map.autonomy.actors.map(actor => [actor.actor_id, actor])).values()];
  const carried = (actorId: string) => actorId === map.protagonist.character_id ? map.living!.inventory.stock : actors.find(actor => actor.actor_id === actorId)?.inventory;
  const needMeal = actors.filter(actor => Number.isFinite(actor.appetite) && actor.appetite > .6 && !eating.has(actor.actor_id));
  const work = active.filter(task => cropTasks.has(task.activity_id ?? '') || cookTasks.has(task.activity_id ?? '') ||
    task.kind === 'travel' && foodCargo(carried(task.actor_id)) > 0);
  const kind = (task: DeskBotWorldTask) => task.kind === 'travel' ? '带着补给在路上' : cookTasks.has(task.activity_id ?? '') ? '正在做饭' : '正在准备食材';
  const ready = table?.stock ? portions(table.stock.rations) : null;
  return {
    population: actors.length,
    needingMeal: needMeal.length,
    stronglyHungry: needMeal.filter(actor => actor.appetite > .9).length,
    eating: eating.size,
    ready,
    carried: actors.reduce((total, actor) => total + portions(carried(actor.actor_id)?.rations), 0),
    heldMeals: active.reduce((total, task) => total + (task.reservation?.status === 'held'
      ? task.reservation.inputs.filter(input => input.resource === 'rations').reduce((sum, input) => sum + portions(input.count), 0) : 0), 0),
    heldPausedMeals: active.reduce((total, task) => total + (task.status === 'paused' && task.reservation?.status === 'held'
      ? task.reservation.inputs.filter(input => input.resource === 'rations').reduce((sum, input) => sum + portions(input.count), 0) : 0), 0),
    needs: needMeal.map(actor => ({ actorId: actor.actor_id, name: actor.display_name })),
    ingredients: { moss: rack?.stock ? portions(rack.stock.moss) : null, fruit: rack?.stock ? portions(rack.stock.light_fruit) : null, water: stove?.stock ? portions(stove.stock.water) : null },
    source: typeof sourceFruit === 'number' && Number.isFinite(sourceFruit) ? { quantity: Math.max(0, sourceFruit), capacity: fruit?.capacity ?? null } : null,
    work: work.map(task => ({ id: task.task_id, title: task.title, actorId: task.actor_id,
      name: actors.find(actor => actor.actor_id === task.actor_id)?.display_name ?? '镇上居民',
      locationId: task.kind === 'travel' ? task.destination_location_id ?? task.to_location_id ?? task.location_id : task.location_id,
      status: task.status, kind: kind(task) })),
  };
}
