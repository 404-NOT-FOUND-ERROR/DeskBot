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
      while(carried(projected,actorId,'water')<count)append('collect-water',depth+1);
    } else if(resource==='seeds') {
      while(carried(projected,actorId,'seeds')<count)append('save-seeds',depth+1);
    } else if(resource==='frame_kit') {
      while(carried(projected,actorId,'frame_kit')<count)append('craft-frame-kit',depth+1);
    } else if(resource==='moss') {
      transfer('seedling-rack','moss',Math.min(missing,Math.floor(stock(projected,'seedling-rack','moss'))));
      if(carried(projected,actorId,'moss')<count)append('harvest-bed',depth+1);
    } else transfer('parts-drawers',resource,missing);
    if(carried(projected,actorId,resource)<count)throw planError('这次收获还不足以完成安排，留出补给的时间。');
  }
  function replenish(id,resource,count,depth=0) {
    // Rain collection can leave fractional clean water in a shared tank, while
    // transfers carry whole units. Round the deficit up without losing that stock.
    const missing=Math.ceil(count-stock(projected,id,resource));
    if(missing<=0)return;
    if(resource==='rations') {
      while(carried(projected,actorId,'rations')<missing)append('cook-moss',depth+1);
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
    const result=completeLivingActivity(projected,{...prepared,actor_id:actorId,task_id:'projection-only'},at);
    if(!result.success)throw planError(result.reason);
    steps.push({kind:'activity',activity_id:id});
  }
  return {projected,steps,append,replenish,transfer};
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
export function depositSteps(world,actorId,objectId,resource) {
  const plan=materialPlanner(world,actorId);
  plan.transfer(objectId,resource,carried(plan.projected,actorId,resource),'store');return plan.steps;
}
