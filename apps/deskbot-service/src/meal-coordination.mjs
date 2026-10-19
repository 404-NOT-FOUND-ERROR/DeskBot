// Authored facilities have finite simultaneous use, separate from stock capacity.
export const COORDINATION_VERSION='morrowmere-meal-coordination-v3';
export function installMealCoordination(world,at) {
  if(!world.living||world.living.coordination?.schema===COORDINATION_VERSION)return false;
  world.living.coordination={dining_seats:6,wake_waiters:true,chain_instant_steps:true,...world.living.coordination,
    schema:COORDINATION_VERSION,installed_at:at,fair_meals:true,parallel_preparation:true,
    source:'authored_world_rule',preserves_stocks_and_durations:true};
  // A declared empty ingredient shelf beside the stove; no food is granted.
  if(world.living.objects['trial-stove']?.stock)world.living.objects['trial-stove'].stock.light_fruit??=0;
  // Give an already admitted legacy meal a stable seat without re-admitting it
  // or touching its portion, clock, pause status or completion effect.
  for(const task of world.tasks??[])if(['running','paused'].includes(task.status)&&task.activity_id==='share-meal'&&task.reservation&&task.reservation.facility_slot===undefined)
    task.reservation.facility_slot=nextDiningSlot(world,task.task_id);
  return true;
}
export function nextDiningSlot(world,exceptTaskId=null) {
  const peers=(world.tasks??[]).filter(t=>t.task_id!==exceptTaskId&&['running','paused'].includes(t.status)&&t.target_object_id==='shared-table');
  const used=new Set(peers.map(t=>t.reservation?.facility_slot).filter(n=>Number.isInteger(n)&&n>=0));
  for(const t of peers)if(t.reservation?.facility_slot===undefined)for(let slot=0;slot<diningSeats(world);slot++)if(!used.has(slot)){used.add(slot);break;}
  for(let slot=0;slot<diningSeats(world);slot++)if(!used.has(slot))return slot;
  return null;
}
export function diningSeats(world) {
  const n=world.living?.coordination?.dining_seats;
  return Number.isInteger(n)&&n>=1&&n<=6?n:1;
}
export function freeDiningSeats(world) {
  return Math.max(0,diningSeats(world)-(world.tasks??[]).filter(t=>['running','paused'].includes(t.status)&&t.target_object_id==='shared-table').length);
}
