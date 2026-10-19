// Offline diagnostic: read one checkpoint, run the existing finite executor in
// memory, print aggregate counts only. Never starts a service or a model worker.
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {advanceAutonomousLife} from '../apps/deskbot-service/src/autonomous-life.mjs';
import {advanceLivingResources} from '../apps/deskbot-service/src/living-resources.mjs';
import {advanceWorldTask,applyRealTimeClock} from '../apps/deskbot-service/src/realtime-world.mjs';

if(!process.argv[2])throw Error('Usage: node scripts/diagnose-life-wait.mjs checkpoint.sqlite');
const db=new DatabaseSync(resolve(process.argv[2]),{readOnly:true});
const world=JSON.parse(db.prepare("SELECT payload_json FROM records WHERE namespace='canonical-world.states' LIMIT 1").get().payload_json);db.close();
const start=Date.parse(world.clock.synced_at), minute=60000, completed=new Map(), hourly=[];
// Explicit ablation, not evidence of live model performance. Resources, needs,
// routes, pending tasks, roles and social promises all retain checkpoint values.
if(world.memory?.planner)world.memory.planner.enabled=false;
for(const actor of Object.values(world.cognition?.actors??{}))actor.enabled=false;
const sample=hour=>({hour,very_hungry:Object.values(world.autonomy.actors).filter(a=>a.appetite>.9).length,
  waiting:Object.values(world.autonomy.actors).filter(a=>a.plan?.goal==='wait-meal'&&['planned','executing'].includes(a.plan.status)).length,
  table:world.living.objects['shared-table'].stock.rations,
  completed_meals:[...completed.values()].filter(t=>t.activity_id==='share-meal').length});
hourly.push(sample(0));
for(let step=1;step<=72;step++){
  const at=start+step*5*minute;let task;
  while((task=world.tasks.filter(t=>t.status==='running'&&Date.parse(t.due_at)<=at).sort((a,b)=>a.due_at.localeCompare(b.due_at))[0])){
    advanceLivingResources(world,task.due_at,{force:true});applyRealTimeClock(world,task.due_at);
    advanceWorldTask(world,{task_id:task.task_id,expected_task_revision:task.revision},task.due_at);
    if(task.status==='completed')completed.set(task.task_id,{actor_id:task.actor_id,activity_id:task.activity_id,life_goal:task.life_goal});
  }
  const iso=new Date(at).toISOString();advanceLivingResources(world,iso,{force:true});applyRealTimeClock(world,iso);
  advanceAutonomousLife(world,iso,{eventId:`isolated-wait-diagnosis:${step}`});
  if(step%12===0)hourly.push(sample(step/12));
}
const tasks=[...completed.values()];
console.log(JSON.stringify({schema:'deskbot.wait-diagnosis.v1',scope:'accelerated_rules_from_checkpoint',model_calls:0,
  source_revision:world.world_revision,start_at:new Date(start).toISOString(),simulated_hours:6,scheduler_minutes:5,
  caveat:'Model selection and continuous cognition are disabled only in this in-memory counterfactual. It is not a natural online observation or a model-quality result.',
  hourly,completed_meals:tasks.filter(t=>t.activity_id==='share-meal').length,
  meals_by_actor:Object.fromEntries(Object.keys(world.autonomy.actors).map(id=>[id,tasks.filter(t=>t.actor_id===id&&t.activity_id==='share-meal').length])),
  completed_wait_checks:tasks.filter(t=>t.life_goal==='wait-meal').length,
  completed_cooking:tasks.filter(t=>['cook-moss','cook-grove-stew'].includes(t.activity_id)).length,
},null,2));
