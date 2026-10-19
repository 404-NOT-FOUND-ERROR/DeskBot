// Paired, isolated rule experiments. Never loads credentials or calls a service.
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {worldHash} from '../apps/deskbot-service/src/world-delta.mjs';
import {createPersistentWorld} from '../apps/deskbot-service/src/persistent-world.mjs';
import {installResidentLife} from '../apps/deskbot-service/src/resident-life.mjs';

const [database,baselineRoot,destination,selected='shortage,plentiful',versions='r1b,r1c']=process.argv.slice(2);
if(!destination)throw Error('Usage: checkpoint.sqlite frozen-R1B-source new-output-directory [shortage,plentiful] [r1b,r1c]');
const output=resolve(destination);mkdirSync(output,{recursive:false});
const db=new DatabaseSync(resolve(database),{readOnly:true});
const shortage=JSON.parse(db.prepare("SELECT payload_json FROM records WHERE namespace='canonical-world.states' LIMIT 1").get().payload_json);db.close();
const startAt='2026-10-19T04:00:00.000Z';
const plentiful=createPersistentWorld({timeMode:'realtime',now:()=>new Date(startAt)}).get();installResidentLife(plentiful,startAt);
// Explicit provisioning at the common starting fixture, never injected mid-run.
plentiful.living.objects['shared-table'].stock.rations=20;
plentiful.living.objects['seedling-rack'].stock.light_fruit=8;
const scenarios=[{id:'shortage',source:shortage,minutes:360},{id:'plentiful',source:plentiful,minutes:1440}],reports=[];
const M=60000,percentile=(values,q)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1]:null;
for(const scene of scenarios.filter(s=>selected.split(',').includes(s.id)))for(const version of versions.split(',')) {
 const root=version==='r1b'?resolve(baselineRoot):resolve(import.meta.dirname,'..');
 const module=name=>import(pathToFileURL(join(root,'apps/deskbot-service/src',name)).href);
 const [{advanceAutonomousLife},{advanceLivingResources,ACTIVITIES},{applyRealTimeClock,advanceWorldTask}]=await Promise.all([module('autonomous-life.mjs'),module('living-resources.mjs'),module('realtime-world.mjs')]);
 const w=structuredClone(scene.source),start=Date.parse(w.clock.synced_at),ids=Object.keys(w.autonomy.actors),actorMinutes={},events=[],hourly=[];
 if(w.memory?.planner)w.memory.planner.enabled=false;for(const a of Object.values(w.cognition?.actors??{}))a.enabled=false;
 // Each implementation installs its own policy from exactly the same fixture.
 delete w.living.coordination;
 const sourceHash=worldHash(w),initialNeed=ids.filter(id=>w.autonomy.actors[id].appetite>.6),initialFood=foodTotal(w);
 for(const id of ids)actorMinutes[id]={first_meal_minute:null,meals:0,very_hungry:0,waiting:0,max_wait:0,need_minutes:0,max_need_episode:0,open_need_episode:0,
   discretionary:0,available_minutes:0,max_available_window:0,open_available:0,open_wait:0};
 let production=0,consumed=0,failures=0,checks=0,wakeups=new Set(),completed=new Set();
 function foodTotal(world){return [...Object.values(world.living.objects),...Object.values(world.living.inventories)].reduce((n,o)=>n+(o.stock?.rations??0),0)
  +world.tasks.filter(t=>t.reservation?.status==='held').flatMap(t=>t.reservation.inputs).filter(i=>i.resource==='rations').reduce((n,i)=>n+i.count,0);}
 for(let minute=1;minute<=scene.minutes;minute++) {
  const at=start+minute*M;let task;
  while((task=w.tasks.filter(t=>t.status==='running'&&Date.parse(t.due_at)<=at).sort((a,b)=>a.due_at.localeCompare(b.due_at))[0])) {
   const due=task.due_at;advanceLivingResources(w,due,{force:true});applyRealTimeClock(w,due);advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},due);
   if(task.status==='running')continue; // Intermediate travel waypoint, not completion.
   if(completed.has(task.task_id))throw Error('duplicate completion');completed.add(task.task_id);
   if(task.status==='completed') {
    if(task.activity_id==='share-meal'){const a=actorMinutes[task.actor_id];a.first_meal_minute??=(Date.parse(due)-start)/M;a.meals++;consumed++;}
    const recipe=ACTIVITIES.find(a=>a.activity_id===task.activity_id);if(recipe?.output?.resource==='rations')production+=recipe.output.count;
    if(task.life_goal==='wait-meal')checks++;
   }else failures++;
   if(task.life_goal!=='wait-meal')events.push({at:due,actor_id:task.actor_id,status:task.status,activity_id:task.activity_id??task.life_action,goal:task.life_goal});
  }
  const iso=new Date(at).toISOString();advanceLivingResources(w,iso,{force:true});applyRealTimeClock(w,iso);advanceAutonomousLife(w,iso,{eventId:`r1c-lab:${minute}`});
  for(const t of w.tasks)if(t.wait_wakeup)wakeups.add(t.task_id);
  for(const id of ids){const s=w.autonomy.actors[id],a=actorMinutes[id],p=s.plan,active=['planned','executing'].includes(p?.status);
   if(s.appetite>.9)a.very_hungry++;
   if(s.appetite>.6){a.need_minutes++;a.open_need_episode++;a.max_need_episode=Math.max(a.max_need_episode,a.open_need_episode);}else a.open_need_episode=0;
   if(active&&p.goal==='wait-meal'){a.waiting++;a.open_wait++;a.max_wait=Math.max(a.max_wait,a.open_wait);}else a.open_wait=0;
   if(active&&(p.goal.startsWith('interest:')||p.goal.startsWith('project:')||p.motivation?.kind==='self_continuation'))a.discretionary++;
   if(s.appetite<=.6&&s.energy>=.4){a.available_minutes++;a.open_available++;a.max_available_window=Math.max(a.max_available_window,a.open_available);}else a.open_available=0;
  }
  for(const o of [...Object.values(w.living.objects),...Object.values(w.living.inventories)])for(const count of Object.values(o.stock??{}))
   if(!Number.isFinite(count)||count<-.000001||count>(o.capacity??24)+.000001)throw Error('stock bounds violated');
  if(minute%60===0)hourly.push({minute,very_hungry:ids.filter(id=>w.autonomy.actors[id].appetite>.9).length,food:foodTotal(w),produced:production,consumed,
   waiting:ids.filter(id=>w.autonomy.actors[id].plan?.goal==='wait-meal'&&['planned','executing'].includes(w.autonomy.actors[id].plan?.status)).length});
 }
 const first=initialNeed.map(id=>actorMinutes[id].first_meal_minute).filter(n=>n!==null),finalFood=foodTotal(w),foodLoss=initialFood+production-consumed-finalFood;
 if(Math.abs(foodLoss)>1e-6)throw Error(`unaccounted ration loss: ${foodLoss}`);
 const sum=key=>Object.values(actorMinutes).reduce((n,a)=>n+a[key],0);
 const report={scenario:scene.id,version,source_hash:sourceHash,minutes:scene.minutes,cadence_minutes:1,model_calls:0,initial_needing:initialNeed.length,
  first_meal_p50:percentile(first,.5),first_meal_p95:percentile(first,.95),first_meal_max:first.length?Math.max(...first):null,
  initially_needing_without_meal:initialNeed.filter(id=>actorMinutes[id].first_meal_minute===null),
  total_meals:sum('meals'),very_hungry_minutes:sum('very_hungry'),waiting_minutes:sum('waiting'),discretionary_minutes:sum('discretionary'),
  available_minutes:sum('available_minutes'),completed_wait_checks:checks,wakeups:wakeups.size,failures,
  food:{initial:initialFood,produced:production,consumed,remaining:finalFood,unaccounted_loss:foodLoss,spoilage_model:false},actor_minutes:actorMinutes,hourly};
 reports.push(report);writeFileSync(join(output,`${scene.id}-${version}-events.json`),JSON.stringify(events,null,2));
 writeFileSync(join(output,`${scene.id}-${version}-final.json`),JSON.stringify({at:w.clock.synced_at,actors:w.autonomy.actors,tasks:w.tasks.filter(t=>['running','paused'].includes(t.status)),stock:w.living.objects,inventories:w.living.inventories},null,2));
 writeFileSync(join(output,'comparison.json'),JSON.stringify({schema:'deskbot.meal-fairness-comparison.v1',scope:'isolated_rules',
  caveat:'One-minute endpoint sampling. First meal and need episodes are censored by observation end. Available means appetite<=0.6 and energy>=0.4, not meaningful fantasy activity. Plentiful is an explicitly provisioned fresh fixture. No natural cross-day or model-quality claim.',reports},null,2));
 console.log(JSON.stringify({...report,actor_minutes:undefined,hourly:undefined}));
}
