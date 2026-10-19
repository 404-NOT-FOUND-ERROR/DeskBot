// Read-only checkpoint -> isolated deterministic counterfactuals. No service,
// network, model calls, injected food or writes to the original world.
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdirSync,writeFileSync} from 'node:fs';
import {traceWorldOperation} from '../apps/deskbot-service/src/world-operation-trace.mjs';
import {COORDINATION_VERSION} from '../apps/deskbot-service/src/meal-coordination.mjs';
import {diffWorld,worldHash,applyWorldDelta,DELTA_SCHEMA} from '../apps/deskbot-service/src/world-delta.mjs';

const [database,baselineRoot,destination,selectedCases='all',cadence='5']=process.argv.slice(2);
if(!destination)throw Error('Usage: node scripts/compare-meal-coordination.mjs checkpoint.sqlite frozen-source-root new-output-directory');
const db=new DatabaseSync(resolve(database),{readOnly:true});
const source=JSON.parse(db.prepare("SELECT payload_json FROM records WHERE namespace='canonical-world.states' LIMIT 1").get().payload_json);db.close();
const output=resolve(destination);mkdirSync(output,{recursive:false});
const current=resolve(import.meta.dirname,'..'),M=60000,schedulerMinutes=Number(cadence);
if(![1,5].includes(schedulerMinutes))throw Error('cadence must be 1 or 5 minutes');
const cases=[{id:'baseline',root:resolve(baselineRoot)},
  {id:'seats_only',root:current,seats:6,wake:false,chain:false},
  {id:'wakeup_only',root:current,seats:1,wake:true,chain:false},
  {id:'dispatch_only',root:current,seats:1,wake:false,chain:true},
  {id:'combined',root:current,seats:6,wake:true,chain:true}];
const sourceHash=worldHash(source),reports=[];
for(const variant of cases.filter(c=>selectedCases==='all'||selectedCases.split(',').includes(c.id))) {
  const module=name=>import(pathToFileURL(join(variant.root,'apps/deskbot-service/src',name)).href);
  const [{advanceAutonomousLife},{advanceLivingResources},{applyRealTimeClock,advanceWorldTask}]=await Promise.all([
    module('autonomous-life.mjs'),module('living-resources.mjs'),module('realtime-world.mjs')]);
  const w=structuredClone(source),start=Date.parse(w.clock.synced_at),done=new Map(),trace=[],hourly=[],actorMinutes={};
  const ids=Object.keys(w.autonomy.actors),firstMeals={};
  for(const id of ids)actorMinutes[id]={very_hungry:0,waiting:0,discretionary:0};
  if(w.memory?.planner)w.memory.planner.enabled=false;
  for(const a of Object.values(w.cognition?.actors??{}))a.enabled=false;
  if(variant.id!=='baseline')w.living.coordination={schema:COORDINATION_VERSION,dining_seats:variant.seats,wake_waiters:variant.wake,chain_instant_steps:variant.chain,scope:'isolated_ablation'};
  const initial=structuredClone(w),deltas=[],samples=[];let previous=structuredClone(w),seq=0,legacyBytes=0;
  function capture(action,at) {
    const m={mutation_id:`lab:${variant.id}:${++seq}`,sequence:seq,event_id:`step:${seq}`,event_source:'isolated_rules_experiment',correlation_id:variant.id,
      action,world_id:w.world_id,before_revision:previous.world_revision,after_revision:w.world_revision,committed_at:at};
    const op=traceWorldOperation(previous,w,m);trace.push(op);
    if(variant.id==='combined') {
      const changes=diffWorld(previous,w),replay={schema:DELTA_SCHEMA,before_hash:worldHash(previous),after_hash:worldHash(w)};
      deltas.push({sequence:seq,changes,replay});
      // Compare the former full-array before/after representation for exactly
      // the same transitions; this is not a whole-database size prediction.
      function legacy(a,b,path='') {
        if(JSON.stringify(a)===JSON.stringify(b))return [];
        if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)||Array.isArray(b))return [{field_path:path,old_value:a,new_value:b}];
        return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>legacy(a[k],b[k],`${path}/${k}`));
      }
      legacyBytes+=Buffer.byteLength(JSON.stringify(legacy(previous,w)));
    }
    previous=structuredClone(w);
  }
  function sample(hour) {
    const s={hour,very_hungry:ids.filter(id=>w.autonomy.actors[id].appetite>.9).length,
      waiting:ids.filter(id=>w.autonomy.actors[id].plan?.goal==='wait-meal'&&['planned','executing'].includes(w.autonomy.actors[id].plan.status)).length,
      meals:[...done.values()].filter(t=>t.activity_id==='share-meal').length,rations:w.living.objects['shared-table'].stock.rations};
    hourly.push(s);
  }
  sample(0);
  for(let step=1;step<=360/schedulerMinutes;step++) {
    const at=start+step*schedulerMinutes*M;let task;
    while((task=w.tasks.filter(t=>t.status==='running'&&Date.parse(t.due_at)<=at).sort((a,b)=>a.due_at.localeCompare(b.due_at))[0])) {
      const due=task.due_at;
      advanceLivingResources(w,due,{force:true});applyRealTimeClock(w,due);
      advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},due);
      if(task.status==='completed') {
        done.set(task.task_id,structuredClone(task));
        if(task.activity_id==='share-meal')firstMeals[task.actor_id]??=(Date.parse(due)-start)/M;
      }
      capture('task_due',due);
    }
    const iso=new Date(at).toISOString();advanceLivingResources(w,iso,{force:true});applyRealTimeClock(w,iso);
    advanceAutonomousLife(w,iso,{eventId:`isolated-wait-diagnosis:${step}`});capture('life_tick',iso);
    for(const id of ids) {
      const s=w.autonomy.actors[id],p=s.plan;
      if(s.appetite>.9)actorMinutes[id].very_hungry+=schedulerMinutes;
      if(p?.goal==='wait-meal'&&['planned','executing'].includes(p.status))actorMinutes[id].waiting+=schedulerMinutes;
      if((p?.goal?.startsWith('interest:')||p?.motivation?.kind==='self_continuation')&&['planned','executing'].includes(p.status))actorMinutes[id].discretionary+=schedulerMinutes;
    }
    if((step*schedulerMinutes)%60===0)sample(step*schedulerMinutes/60);
    for(const o of [...Object.values(w.living.objects),...Object.values(w.living.inventories)])
      for(const count of Object.values(o.stock??{}))if(!Number.isFinite(count)||count<-.000001||count>(o.capacity??24)+.000001)throw Error('stock bounds violated');
  }
  const tasks=[...done.values()],records=trace.flatMap(t=>t.records),counts=kind=>records.filter(r=>r.kind===kind).length;
  const report={variant:variant.id,source_hash:sourceHash,model_calls:0,simulated_hours:6,scheduler_minutes:schedulerMinutes,hourly,
    meals:tasks.filter(t=>t.activity_id==='share-meal').length,meals_by_actor:Object.fromEntries(ids.map(id=>[id,tasks.filter(t=>t.actor_id===id&&t.activity_id==='share-meal').length])),
    first_meal_minutes:firstMeals,actor_sampled_minutes:actorMinutes,
    completed_wait_checks:tasks.filter(t=>t.life_goal==='wait-meal').length,
    completed_cooking:tasks.filter(t=>['cook-moss','cook-grove-stew','cook-leaf-soup'].includes(t.activity_id)).length,
    wakeups:records.filter(r=>r.kind==='task_cancelled'&&r.wakeup).length,
    failures:counts('task_failed'),stock_bounds:'passed'};
  if(variant.id==='combined') {
    let replayed=structuredClone(initial);
    for(const d of deltas)replayed=applyWorldDelta(replayed,d);
    if(worldHash(replayed)!==worldHash(w))throw Error('experiment replay differs');
    const deltaBytes=Buffer.byteLength(JSON.stringify(deltas));
    report.replay={verified:true,records:deltas.length,final_hash:worldHash(w),delta_bytes:deltaBytes,legacy_change_bytes:legacyBytes,
      comparison:'same transitions; delta envelopes included; checkpoint/state/trace overhead excluded'};
    writeFileSync(join(output,'replay.json'),JSON.stringify({schema:'deskbot.isolated-replay.v1',scope:'lab',initial,deltas,final_hash:worldHash(w)}));
  }
  writeFileSync(join(output,`${variant.id}-operations.jsonl`),trace.map(x=>JSON.stringify(x)).join('\n'));
  reports.push(report);console.log(JSON.stringify(report));
}
writeFileSync(join(output,'comparison.json'),JSON.stringify({schema:'deskbot.meal-comparison.v1',scope:'accelerated_rules_from_checkpoint',source_hash:sourceHash,
  caveat:`Same frozen source and six-hour interval. ${schedulerMinutes}-minute sampled person-minutes are approximate. This is not natural online time or model-quality evidence. No new food, growth rate or activity duration was granted.`,reports},null,2));
