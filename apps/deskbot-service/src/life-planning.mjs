import { ACTIVITIES, prepareLivingActivity, completeLivingActivity, transferLivingResource } from './living-resources.mjs';
import { findWorldPath } from './world-map-content.mjs';
function actor(world,id){return id===world.protagonist.character_id?world.protagonist:world.npcs.find(n=>n.npc_id===id);}
function object(world,id){const o=world.map_catalog.objects.find(o=>o.object_id===id);return o&&{...o,location_id:world.map_catalog.areas.find(a=>a.area_id===o.area_id)?.location_id};}
const stock=(w,id,r)=>w.living.objects[id]?.stock?.[r]??0;
const carried=(w,id,r)=>w.living.inventories[id]?.stock?.[r]??0;
const planError=message=>Object.assign(new Error(message),{code:'life_plan_unavailable',statusCode:409});
// A disposable projection verifies the material chain. Projected positions and
// results are candidates only; every actual step is validated again on execution.
function materialPlanner(world, actorId) {
  const projected = structuredClone(world), steps = [], at = world.clock.synced_at;
  function go(destination) {
    const person = actor(projected, actorId);
    if (!destination) throw planError('所需设施还没有安装。');
    if (person.location_id === destination) return;
    if (!findWorldPath(projected, person.location_id, destination)) throw planError('当前通路无法到达需要的地点。');
    steps.push({ kind: 'travel', location_id: destination }); person.location_id = destination;
  }
  function transfer(id, resource, count, operation='take') {
    if(count<=0)return;
    go(object(projected,id)?.location_id);
    transferLivingResource(projected,{actor_id:actorId,object_id:id,resource,count,operation},at);
    steps.push({kind:'transfer',object_id:id,resource,count,operation});
  }
  function carry(resource,count,depth) {
    const missing=count-carried(projected,actorId,resource);
    if(missing<=0)return;
    if(resource==='water') {
      // Gather at the real source; do not drain the nursery's shared reserve.
      const pump=projected.living.objects['floating-frame']?.project_assets?.small_water_pump;
      const pumpReady=projected.resident_projects?.projects?.['small-water-pump']?.status==='completed' && pump?.condition>=.4;
      while(carried(projected,actorId,'water')<count)append(pumpReady?'pump-water':'collect-water',depth+1);
    } else if(resource==='seeds') {
      while(carried(projected,actorId,'seeds')<count)append('save-seeds',depth+1);
    } else if(resource==='frame_kit') {
      while(carried(projected,actorId,'frame_kit')<count)append('craft-frame-kit',depth+1);
    } else if(resource==='light_fruit') {
      transfer('seedling-rack','light_fruit',Math.min(missing,Math.floor(stock(projected,'seedling-rack','light_fruit'))));
      while(carried(projected,actorId,'light_fruit')<count)append('gather-light-fruit',depth+1);
    } else if(resource==='moss') {
      transfer('seedling-rack','moss',Math.min(missing,Math.floor(stock(projected,'seedling-rack','moss'))));
      if(carried(projected,actorId,'moss')<count) {
        const bed=projected.living.objects['garden-bed'];
        const floatBed=projected.living.objects['floating-frame']?.project_assets?.floating_seedbed;
        const floatingReady=projected.resident_projects?.projects?.['floating-seedbed']?.status==='completed' && floatBed?.quantity>0 && floatBed.growth>=.85;
        append(bed?.quantity>0&&bed.growth>=.85?'harvest-bed':floatingReady?'harvest-float-bed':'harvest-bed',depth+1);
      }
    } else transfer('parts-drawers',resource,missing);
    if(carried(projected,actorId,resource)<count)throw planError('这次收获还不足以完成安排，留出补给的时间。');
  }
  function tryCooking(depth=0) {
    const soupReady=projected.resident_projects?.projects?.['leaf-signature-soup']?.status==='completed';
    let lastError;
    for(const activity of [soupReady?'cook-leaf-soup':'cook-moss','cook-grove-stew']) {
      if(!ACTIVITIES.some(recipe=>recipe.activity_id===activity))continue;
      // A failed alternative may have taken partial materials on the disposable
      // projection. Roll them back before trying another finite food source.
      const checkpoint=structuredClone(projected), length=steps.length;
      try { append(activity,depth+1);return; }
      catch(error) {
        for(const key of Object.keys(projected))delete projected[key];
        Object.assign(projected,checkpoint);steps.splice(length);lastError=error;
      }
    }
    throw lastError??planError('现在没有可做的一餐，先等实际补给。');
  }
  function storeMeals() {
    const table=projected.living.objects['shared-table'];
    const held=projected.tasks.filter(task=>task.reservation?.status==='held').flatMap(task=>task.reservation.inputs)
      .filter(input=>input.container==='shared-table'&&input.resource==='rations').reduce((total,input)=>total+input.count,0);
    const room=Math.max(0,Math.floor((table.capacity??24)-stock(projected,'shared-table','rations')-held));
    const count=Math.min(room,carried(projected,actorId,'rations'));
    if(count>0)transfer('shared-table','rations',count,'store');
  }
  function replenish(id,resource,count,depth=0) {
    // Rain collection can leave fractional clean water in a shared tank, while
    // transfers carry whole units. Round the deficit up without losing that stock.
    const missing=Math.ceil(count-stock(projected,id,resource));
    if(missing<=0)return;
    if(resource==='rations') {
      while(carried(projected,actorId,'rations')<missing)tryCooking(depth+1);
      // Cooking produces a batch. Put every portion that fits on the actual
      // common table rather than keeping the leftovers hidden in the cook's bag.
      storeMeals();return;
    } else if(resource==='water'||resource==='seeds')carry(resource,missing,depth);
    else throw planError('这里的材料不足，先等补给或换件事做。');
    transfer(id,resource,missing,'store');
  }
  function append(id, depth=0) {
    if(depth>5 || steps.length>24) throw planError('这次准备涉及太多步骤，先缓一缓。');
    const recipe=ACTIVITIES.find(r=>r.activity_id===id);
    if(!recipe)throw planError('这项生活活动还没有安装。');
    for(const input of recipe.inputs) {
      if(input.container==='bag')carry(input.resource,input.count,depth);
      else replenish(input.container,input.resource,input.count,depth);
    }
    go(object(projected,recipe.target)?.location_id);
    const prepared=prepareLivingActivity(projected,id,actorId,at);
    const result=completeLivingActivity(projected,{...prepared,actor_id:actorId,task_id:'projection-only',project_projection:true},at);
    if(!result.success)throw planError(result.reason);
    steps.push({kind:'activity',activity_id:id});
  }
  return {projected,steps,append,replenish,transfer,tryCooking,storeMeals};
}
export function activitySteps(world,actorId,activityId) {
  const plan=materialPlanner(world,actorId);plan.append(activityId);return plan.steps;
}
export function waterSupplySteps(world,actorId,objectId,target=4) {
  const plan=materialPlanner(world,actorId);plan.replenish(objectId,'water',target);return plan.steps;
}
export function seedSupplySteps(world,actorId,target=4) {
  const plan=materialPlanner(world,actorId);plan.replenish('seedling-rack','seeds',target);return plan.steps;
}
export function cookAndStoreSteps(world,actorId) {
  const plan=materialPlanner(world,actorId);plan.tryCooking();plan.storeMeals();return plan.steps;
}
export function fruitSupplySteps(world,actorId,target=2) {
  const plan=materialPlanner(world,actorId);
  const missing=Math.max(0,Math.ceil(target-stock(plan.projected,'seedling-rack','light_fruit')));
  while(carried(plan.projected,actorId,'light_fruit')<missing)plan.append('gather-light-fruit');
  if(missing>0)plan.transfer('seedling-rack','light_fruit',missing,'store');return plan.steps;
}
export function depositSteps(world,actorId,objectId,resource) {
  const plan=materialPlanner(world,actorId);
  const held=plan.projected.tasks.filter(task=>task.reservation?.status==='held').flatMap(task=>task.reservation.inputs)
    .filter(input=>input.container===objectId&&input.resource===resource).reduce((total,input)=>total+input.count,0);
  const count=Math.min(carried(plan.projected,actorId,resource),Math.max(0,Math.floor((plan.projected.living.objects[objectId]?.capacity??24)-stock(plan.projected,objectId,resource)-held)));
  if(count<=0)throw planError('公共库存现在没有存放余地，先保留在随身袋里。');
  plan.transfer(objectId,resource,count,'store');return plan.steps;
}
