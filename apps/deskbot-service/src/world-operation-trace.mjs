import {canonicalJson} from './world-delta.mjs';
import {mealSupplyReadModel} from './meal-policy.mjs';

export const TRACE_SCHEMA='deskbot.world-operation-trace.v1';
const active=t=>['running','paused'].includes(t?.status);
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
const cooking=new Set(['cook-moss','cook-grove-stew','cook-leaf-soup']);
function promises(world) {
  if(world.living?.coordination?.fair_meals)return mealSupplyReadModel(world).commitments;
  return Object.values(world.autonomy?.actors??{}).flatMap(a=>{
    const p=a.plan;
    if(a.paused||!['planned','executing'].includes(p?.status))return [];
    const task=(world.tasks??[]).find(t=>t.actor_id===a.actor_id&&active(t));
    if(task?.status==='paused')return [];
    const steps=p.steps.slice(p.index);
    if(!steps.some(s=>cooking.has(s.activity_id)||s.kind==='transfer'&&s.operation==='store'&&s.resource==='rations'))return [];
    return [{actor_id:a.actor_id,plan_id:p.plan_id,task_id:p.task_id??null,
      activity_ids:steps.map(s=>s.activity_id).filter(Boolean),status:p.status}];
  });
}
function containers(w) {
  return new Map([...Object.entries(w.living?.objects??{}).map(([id,o])=>[id,o.stock??{}]),
    ...Object.entries(w.living?.inventories??{}).map(([id,o])=>[`bag:${id}`,o.stock??{}])]);
}

/** A factual receipt of one committed operation, never a second simulation.
 * It records state transitions, not a reconstructed story or model prompt. */
export function traceWorldOperation(before,after,mutation) {
  const records=[],push=(kind,fields)=>records.push({kind,...fields});
  const previousTasks=new Map((before.tasks??[]).map(t=>[t.task_id,t]));
  for(const task of after.tasks??[]) {
    const old=previousTasks.get(task.task_id);
    const identity={actor_id:task.actor_id,task_id:task.task_id,plan_id:task.life_plan_id??null,
      activity_id:task.activity_id??null,target_object_id:task.target_object_id??null,title:task.title,
      life_goal:task.life_goal??null,cause_event_id:task.cause_event_id??null};
    if(!old||old.status!==task.status||old.steps_completed!==task.steps_completed)
      push(!old?'task_admitted':task.status==='completed'?'task_completed':task.status==='failed'?'task_failed':task.status==='cancelled'?'task_cancelled':task.status==='paused'?'task_paused':old.status==='paused'?'task_resumed':'task_arrived',{
        ...identity,from_status:old?.status??null,status:task.status,due_at:task.due_at,
        reason_code:task.failure_code??null,reason:task.failure_reason??null,
        ...(task.wait_wakeup?{wakeup:task.wait_wakeup}:{}),decision:task.life_decision??null,
      });
    if(task.reservation?.status!==old?.reservation?.status)
      push(`reservation_${task.reservation.status}`,{...identity,inputs:structuredClone(task.reservation.inputs)});
  }
  const oldContainers=containers(before);
  for(const [id,stock] of containers(after)) {
    const old=oldContainers.get(id)??{};
    for(const resource of new Set([...Object.keys(old),...Object.keys(stock)])) {
      const from=old[resource]??0,to=stock[resource]??0;
      if(from!==to)push('stock_changed',{container:id,resource,before:from,after:to,delta:to-from,
        // A net receipt is not claimed as a gross transfer or inferred cause.
        accounting:'net_change_within_operation'});
    }
  }
  for(const a of Object.values(after.autonomy?.actors??{})) {
    const old=before.autonomy?.actors?.[a.actor_id],p=a.plan;
    if(!same(old?.meal_need,a.meal_need)&&a.meal_need)push('meal_need_recorded',{actor_id:a.actor_id,...a.meal_need});
    if(a.meal_delivery?.at&&a.meal_delivery.at!==old?.meal_delivery?.at)
      push('meal_delivered',{actor_id:a.actor_id,plan_id:a.meal_delivery.plan_id,portions:a.meal_delivery.portions,at:a.meal_delivery.at});
    if(p&&(old?.plan?.plan_id!==p.plan_id||old?.plan?.status!==p.status)) {
      push(p.goal==='wait-meal'?'meal_wait':'plan_changed',{actor_id:a.actor_id,plan_id:p.plan_id,goal:p.goal,title:p.title,status:p.status,
        decision:p.decision?{source:p.decision.source,request_id:p.decision.request_id??null,model:p.decision.model??null}:null,
        reason:p.failure_reason??p.reason,wait_context:p.wait_context??null,
        ...(old?.plan?.plan_id!==p.plan_id?{candidates:(a.last_candidates??[]).map(c=>({goal:c.goal,available:c.available,score:c.score,reason_code:c.blocked_code??null,reason:c.blocked_reason??null}))}:{}),
      });
    }
    const request=after.memory?.planner?.requests?.[a.actor_id],previous=before.memory?.planner?.requests?.[a.actor_id];
    if(request&&(request.id!==previous?.id||request.status!==previous?.status))
      push('model_choice',{actor_id:a.actor_id,request_id:request.id,status:request.status,goal:request.choice?.goal??null,model:request.model??null});
  }
  const oldPromises=new Map(promises(before).map(p=>[p.plan_id,p])),newPromises=new Map(promises(after).map(p=>[p.plan_id,p]));
  for(const [id,p] of newPromises)if(!same(oldPromises.get(id),p))push('supply_promise',{...p,claim:'soft_plan_not_reserved_stock'});
  for(const [id,p] of oldPromises)if(!newPromises.has(id))push('supply_promise_ended',{...p,reason:'plan_finished_paused_or_replaced'});
  return {schema:TRACE_SCHEMA,operation_id:mutation.mutation_id,sequence:mutation.sequence,
    event_id:mutation.event_id,event_source:mutation.event_source,correlation_id:mutation.correlation_id,
    action:mutation.action,world_id:after.world_id,before_revision:mutation.before_revision,after_revision:mutation.after_revision,
    at:mutation.committed_at,world_at:after.clock?.synced_at??null,
    observed_scope:'committed_world_operation',records:records.map((r,i)=>({...r,trace_id:`${mutation.mutation_id}:${i}`}))};
}
