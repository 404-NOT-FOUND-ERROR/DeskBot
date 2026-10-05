import { ACTIVITIES, prepareLivingActivity, completeLivingActivity, transferLivingResource } from './living-resources.mjs';
import { findWorldPath } from './world-map-content.mjs';
function actor(world,id){return id===world.protagonist.character_id?world.protagonist:world.npcs.find(n=>n.npc_id===id);}
function object(world,id){const o=world.map_catalog.objects.find(o=>o.object_id===id);return o&&{...o,location_id:world.map_catalog.areas.find(a=>a.area_id===o.area_id)?.location_id};}
const stock=(w,id,r)=>w.living.objects[id]?.stock?.[r]??0;
const carried=(w,id,r)=>w.living.inventories[id]?.stock?.[r]??0;
const planError=message=>Object.assign(new Error(message),{code:'life_plan_unavailable',statusCode:409});
// A disposable projection verifies the material chain. Projected positions and
// results are candidates only; every actual step is validated again on execution.
export function activitySteps(world, actorId, activityId) {
  const projected = structuredClone(world), steps = [], at = world.clock.synced_at;
  function go(destination) {
    const person = actor(projected, actorId);
    if (person.location_id === destination) return;
    if (!findWorldPath(projected, person.location_id, destination)) throw planError('当前通路无法到达需要的地点。');
    steps.push({ kind: 'travel', location_id: destination }); person.location_id = destination;
  }
  function transfer(id, resource, count, operation='take') {
    go(object(projected,id)?.location_id);
    transferLivingResource(projected,{actor_id:actorId,object_id:id,resource,count,operation},at);
    steps.push({kind:'transfer',object_id:id,resource,count,operation});
  }
  function append(id, depth=0) {
    if(depth>4 || steps.length>18) throw planError('这次准备涉及太多步骤，先缓一缓。');
    const recipe=ACTIVITIES.find(r=>r.activity_id===id);
    for(const input of recipe.inputs) {
      if(input.container==='bag') {
        const missing=input.count-carried(projected,actorId,input.resource);
        if(missing<=0)continue;
        if(input.resource==='frame_kit')append('craft-frame-kit',depth+1);
        else if(input.resource==='moss' && stock(projected,'seedling-rack','moss')>=missing)transfer('seedling-rack','moss',missing);
        else if(input.resource==='moss')append('harvest-bed',depth+1);
        else transfer('parts-drawers',input.resource,missing);
      } else if(stock(projected,input.container,input.resource)<input.count) {
        const missing=input.count-stock(projected,input.container,input.resource);
        if(input.resource==='rations') {
          if(carried(projected,actorId,'rations')<missing)append('cook-moss',depth+1);
          transfer('shared-table','rations',missing,'store');
        } else throw planError(`这里的${input.resource==='water'?'清水':'材料'}不足，先等补给或换件事做。`);
      }
    }
    go(object(projected,recipe.target)?.location_id);
    const prepared=prepareLivingActivity(projected,id,actorId,at);
    const result=completeLivingActivity(projected,{...prepared,actor_id:actorId,task_id:'projection-only'},at);
    if(!result.success)throw planError(result.reason);
    steps.push({kind:'activity',activity_id:id});
  }
  append(activityId); return steps;
}
