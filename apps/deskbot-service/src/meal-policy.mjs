import {ACTIVITIES} from './living-resources.mjs';

const MINUTE=60000;
const active=t=>['running','paused'].includes(t?.status);
const stock=(w,id,r)=>w.living?.objects?.[id]?.stock?.[r]??0;
const bag=(w,id,r)=>w.living?.inventories?.[id]?.stock?.[r]??0;
export const mealPolicyEnabled=w=>w.living?.coordination?.fair_meals===true;

// A need episode survives new plans and restarts. A legacy saturated appetite
// has no recoverable onset: observe it now, never invent hours of online wait.
export function syncMealNeeds(world,at) {
  if(!mealPolicyEnabled(world))return;
  for(const s of Object.values(world.autonomy?.actors??{})) {
    if(s.appetite<=.6){s.meal_need=null;continue;}
    if(s.meal_need)continue;
    const sequence=(world.living.coordination.need_sequence??0)+1;
    world.living.coordination.need_sequence=sequence;
    s.meal_need={sequence,observed_at:at,due_at:new Date(Date.parse(at)+Math.max(0,(.9-s.appetite)/.025)*3600000).toISOString(),
      basis:'observed_need_not_reconstructed_history'};
  }
}

export function compareMealNeeds(a,b) {
  const deadline=s=>Date.parse(s.meal_need?.due_at??'')||Infinity;
  const observed=s=>Date.parse(s.meal_need?.observed_at??'')||Infinity;
  return deadline(a)-deadline(b)||observed(a)-observed(b)
    ||(a.meal_need?.sequence??Infinity)-(b.meal_need?.sequence??Infinity)
    ||b.appetite-a.appetite||a.actor_id.localeCompare(b.actor_id);
}

// Planning commitments are contingent, not inventory. Completed current steps
// are excluded before the scheduler has advanced their plan index.
export function mealSupplyReadModel(world,at=world.clock?.synced_at) {
  const commitments=[];
  for(const s of Object.values(world.autonomy?.actors??{})) {
    const p=s.plan,task=(world.tasks??[]).find(t=>t.actor_id===s.actor_id&&active(t));
    if(s.paused||world.cognition?.actors?.[s.actor_id]?.enabled||!['planned','executing'].includes(p?.status)||task?.status==='paused')continue;
    if(!task&&Date.parse(at)-Date.parse(p.created_at)>=120*MINUTE)continue;
    const current=(world.tasks??[]).find(t=>t.task_id===p.task_id);
    if(current&&['failed','cancelled'].includes(current.status))continue;
    const steps=p.steps.slice(p.index+(current?.status==='completed'?1:0));
    const cooks=steps.map(step=>ACTIVITIES.find(a=>a.activity_id===step.activity_id)).filter(a=>a?.output?.resource==='rations');
    const delivering=steps.filter(step=>step.kind==='transfer'&&step.operation==='store');
    const food=delivering.filter(step=>step.resource==='rations').reduce((n,s)=>n+s.count,0);
    const ingredients=delivering.filter(step=>['light_fruit','moss'].includes(step.resource)).reduce((n,s)=>n+s.count,0);
    if(!food&&!ingredients)continue;
    const onHand=Math.min(food,bag(world,s.actor_id,'rations'));
    const cooking=task?.status==='running'&&ACTIVITIES.find(a=>a.activity_id===task.activity_id)?.output?.resource==='rations';
    commitments.push({actor_id:s.actor_id,plan_id:p.plan_id,task_id:task?.task_id??null,
      stage:onHand?'carrying_food':cooking?'cooking':'preparing',
      carried_portions:onHand,potential_portions:Math.min(food,onHand+cooks.reduce((n,a)=>n+a.output.count,0)),
      ingredient_units:ingredients,task_due_at:task?.due_at??null,
      arrival_at:null,certainty:'contingent_plan_not_stock'});
  }
  const hungry=Object.values(world.autonomy?.actors??{}).filter(s=>!s.paused&&s.appetite>.6&&!world.cognition?.actors?.[s.actor_id]?.enabled
    &&!(world.tasks??[]).some(t=>active(t)&&t.actor_id===s.actor_id&&t.activity_id==='share-meal')).length;
  const available=stock(world,'shared-table','rations');
  const promised=commitments.reduce((n,c)=>n+c.potential_portions,0);
  return {available_portions:available,potential_portions:promised,uncovered_needs:Math.max(0,hungry-available-promised),
    commitments,note:'任务到期不是饭食到达；未入库的份数不能领取。'};
}

// One hungry provider may serve themselves from a just-delivered real batch.
// The remaining portions still use the persistent queue. It is neither a
// perpetual privilege nor a reservation of food that has not arrived.
export function hasProviderMeal(world,id,at) {
  const s=world.autonomy?.actors?.[id],receipt=s?.meal_delivery;
  return mealPolicyEnabled(world)&&s.appetite>.6&&!s.paused&&receipt?.portions>=2&&!receipt.used
    &&Date.parse(at)>=Date.parse(receipt.at)&&Date.parse(at)-Date.parse(receipt.at)<=10*MINUTE;
}
