// Fictional, isolated rules only. No credentials, HTTP, models or formal save.
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createPersistentWorld,getWorldMap} from '../apps/deskbot-service/src/persistent-world.mjs';
import {installResidentLife} from '../apps/deskbot-service/src/resident-life.mjs';
import {advanceLivingResources,transferLivingResource} from '../apps/deskbot-service/src/living-resources.mjs';
import {applyRealTimeClock,startActivityTask,startTravelTask,advanceWorldTask} from '../apps/deskbot-service/src/realtime-world.mjs';
import {activitySteps} from '../apps/deskbot-service/src/life-planning.mjs';
import {advanceAutonomousLife} from '../apps/deskbot-service/src/autonomous-life.mjs';
import {worldHash} from '../apps/deskbot-service/src/world-delta.mjs';
import {findWorldPath} from '../apps/deskbot-service/src/world-map-content.mjs';
const output=resolve(process.argv[2]??'../runtime/r2-20261020/waylight-experiment');mkdirSync(output,{recursive:false});
const start='2026-10-20T00:00:00.000Z',own='shaping-001',M=60000;
function fresh(){const w=createPersistentWorld({timeMode:'realtime',now:()=>new Date(start)}).get();installResidentLife(w,start);if(w.memory?.planner)w.memory.planner.enabled=false;return w;}
function settle(w,at,onTask=()=>{}){
  let t;while((t=w.tasks.filter(t=>t.status==='running'&&t.due_at<=at).sort((a,b)=>a.due_at.localeCompare(b.due_at))[0])){
    const due=t.due_at;advanceLivingResources(w,due,{force:true});applyRealTimeClock(w,due);advanceWorldTask(w,{task_id:t.task_id,expected_task_revision:t.revision},due);
    if(t.status!=='running')onTask(t);
  }
  advanceLivingResources(w,at,{force:true});applyRealTimeClock(w,at);
}
const narrative=fresh(),frames=[],events=[];
// Explicit fixture provision: two already-condensed leaves. All other materials
// come from the authored town inventory; nothing is supplied during execution.
narrative.living.objects['windleaf-canopy'].stock.light_leaf=2;
function snapshot(id,title,detail){const map=getWorldMap(narrative);if(map.environment)map.environment.time.mode='simulation';frames.push({id,title,detail,at:narrative.clock.synced_at,map});}
function execute(activity){
  const steps=activitySteps(narrative,own,activity);
  for(const [index,step]of steps.entries()){
    const at=narrative.clock.synced_at,eventId=`r2-demo:${events.length}:${index}:${activity}`;
    if(step.kind==='transfer'){const result=transferLivingResource(narrative,{...step,actor_id:own},at);events.push({at,kind:'transfer',text:result.text});continue;}
    let t;
    if(step.kind==='travel'){
      if(narrative.protagonist.location_id===step.location_id)continue;
      const hop=findWorldPath(narrative,narrative.protagonist.location_id,step.location_id)?.[1];
      t=startTravelTask(narrative,{actorId:own,eventId,at,locationId:hop,destinationId:step.location_id}).task;
    }else t=startActivityTask(narrative,{actor_id:own,activity_id:step.activity_id,task_id:eventId},{eventId,at}).task;
    const actual=narrative.tasks.find(task=>task.task_id===t.task_id);
    while(actual.status==='running')settle(narrative,actual.due_at);
    if(actual.status!=='completed')throw Error(actual.failure_reason);
    events.push({at:actual.finished_at,kind:actual.kind,activity_id:actual.activity_id,task_id:actual.task_id,title:actual.title});
  }
}
snapshot('empty','水岸还没有灯','隔离演示起点：林地明确放入两片可采光叶；其他材料来自镇内初始库存。尚无任何造物或使用经历。');
execute('waylight-build-open');snapshot('woven','光叶沿路带回来了','实际走到林地采叶、到镇内取料、到水岸编灯。新灯从零蓄光开始。');
settle(narrative,'2026-10-20T11:00:00.000Z');execute('waylight-use');snapshot('first-evening','第一晚，借光取水','白昼实际蓄光后，借这盏灯用五分钟净滤四份原水。公开库存减少，随身清水增加。');
execute('waylight-fit-shade');snapshot('hooded','多一片罩，水岸留暗','喵呜这次选择自行到镇内备料缝罩，再回水岸安装。另有经过测试的双方合作、拒绝和延期路径。');
settle(narrative,'2026-10-21T11:00:00.000Z');execute('waylight-use');snapshot('next-evening','第二晚，还是这一盏','序列化与次日再用另有合同测试；此处同一物件保留制作出处、罩片和两次净滤记录。等待区间只结算环境，没有补造人物行动。');
writeFileSync(join(output,'guided-events.json'),JSON.stringify(events,null,2));
writeFileSync(new URL('../apps/jev-town-client/public/waylight-review.json',import.meta.url),JSON.stringify({schema:'deskbot.waylight-review.v1',scope:'isolated_rules',model_calls:0,frames},null,2));
const seed=fresh();seed.living.objects['shared-table'].stock.rations=20;seed.living.objects['seedling-rack'].stock.light_fruit=8;
const runs=[];
for(const enabled of [false,true]){
  let w=structuredClone(seed);if(!enabled)delete w.waylight_life;
  const sourceHash=worldHash(w),events=[],hourly=[];let hungrySamples=0;
  for(let minute=5;minute<=2880;minute+=5){
    const at=new Date(Date.parse(start)+minute*M).toISOString();
    settle(w,at,t=>events.push({at:t.finished_at,actor_id:t.actor_id,activity_id:t.activity_id??null,status:t.status,reason:t.failure_reason??null}));
    advanceAutonomousLife(w,at,{eventId:`r2-autonomy:${enabled}:${minute}`});
    hungrySamples+=Object.values(w.autonomy.actors).filter(s=>s.appetite>.9).length;
    if(minute===1440)w=JSON.parse(JSON.stringify(w));
    if(minute%360===0){hourly.push({minute,lamp:w.living.objects['floating-frame'].waylight??null});console.log(JSON.stringify({scenario:enabled?'r2':'baseline',minute}));}
    for(const o of [...Object.values(w.living.objects),...Object.values(w.living.inventories)])for(const n of Object.values(o.stock??{}))if(!Number.isFinite(n)||n<-.000001||n>(o.capacity??24)+.000001)throw Error('stock bound violated');
  }
  const run={enabled,source_hash:sourceHash,simulated_hours:48,cadence_minutes:5,model_calls:0,stock_bounds_verified:true,
    very_hungry_person_minutes_estimate:hungrySamples*5,meals:events.filter(e=>e.activity_id==='share-meal'&&e.status==='completed').length,
    waylight_events:events.filter(e=>e.activity_id?.startsWith('waylight-')),lamp:w.living.objects['floating-frame'].waylight,
    social:w.social.commitments.filter(c=>c.produce_activity==='waylight-craft-shade'),hourly};
  runs.push(run);writeFileSync(join(output,enabled?'r2-events.json':'baseline-events.json'),JSON.stringify(events,null,2));
}
const report={schema:'deskbot.waylight-experiment.v1',scope:'isolated_rule_simulation',model_calls:0,runs,
  caveats:['Five-minute sampling of authored rules, not natural cross-day observation or model quality.','Same initial 20 rations and 8 fruit; no supplies injected during runs.','Guided review is a separately provisioned, executed demonstration; no state is copied to live.']};
writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({completed:true,runs:runs.map(r=>({enabled:r.enabled,meals:r.meals,waylight_events:r.waylight_events.length,lamp:r.lamp}))}));
