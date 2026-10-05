// Three-day policy replay uses an isolated in-memory canonical world, never live SQLite.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createPersistentWorld,getWorldMap} from '../../deskbot-service/src/persistent-world.mjs';
import {createWorldLife} from '../../deskbot-service/src/world-life.mjs';
import {createAutonomousLife} from '../../deskbot-service/src/autonomous-life.mjs';
let time=Date.parse('2026-10-04T04:00:00Z');const now=()=>new Date(time),records=new Map();
const persistence={get(ns,id){return structuredClone(records.get(ns+':'+id)??null);},list(ns){return [...records.entries()].filter(([k])=>k.startsWith(ns+':')).map(([,v])=>structuredClone(v));},put(ns,id,v){records.set(ns+':'+id,structuredClone(v));},insert(ns,id,v){this.put(ns,id,v);},transaction(fn){return fn();}};
let world=createPersistentWorld({now,persistence,timeMode:'realtime'});
createWorldLife({now,worldSnapshot:()=>world.get(),ingest:event=>world.ingest(event),enabled:true}).seedNpcs();
world.ingest({event_id:'install-replay-residents',type:'world.mutation',source:'replay',occurred_at:now().toISOString(),payload:{action:'install_resident_life'}});
let loop=createAutonomousLife({world,now,enabled:true});const frames={},seen=new Set(),outcomes=[];
function save(id,label){frames[id]={label,map:getWorldMap(world.get())};}
loop.tick();save('begin','第一天 · 自己安排');
for(let minutes=5;minutes<=72*60;minutes+=5){
  time+=300000;world.syncWallClock();world.syncTasks();loop.tick();
  for(const task of world.get().tasks){if(task.status!=='completed'||seen.has(task.task_id))continue;seen.add(task.task_id);outcomes.push({actor_id:task.actor_id,activity_id:task.activity_id,title:task.title,due_at:task.completion.due_at});
    if(task.activity_id==='water-bed'&&!frames.water)save('water','第一次照料完成');
    if(task.activity_id==='craft-tray'&&!frames.craft)save('craft','第一次制作完成');
    if(task.activity_id==='harvest-bed'&&!frames.harvest)save('harvest','第一次收获完成');
  }
  const social=world.get().social;
  if(!frames.cooperation&&social.commitments.some(c=>c.kind==='cooperate'&&c.status==='completed'))save('cooperation','第一次合作办成');
  if(!frames.delay&&social.recent.some(e=>e.kind==='delayed'))save('delay','有人改了约');
  if(!frames.report&&social.notices.length)save('report','簌簌有出处的小报');
  if(minutes===12*60)save('night','夜里 · 留出休息');
  if(minutes===24*60)save('day2','第二天 · 接着生活');
  if(minutes===36*60){world=createPersistentWorld({now,persistence,timeMode:'realtime'});loop=createAutonomousLife({world,now,enabled:true});loop.tick();}
}
save('day3','第三天结束 · 有限补给');
assert.ok(frames.water);assert.ok(frames.craft);assert.ok(frames.harvest);
assert.ok(world.get().living.objects['parts-drawers'].stock.wood<8);
assert.equal(Object.keys(world.get().autonomy.actors).length,13);
assert.ok(world.get().tasks.some(task=>task.life_action==='rest'&&task.status==='completed'));
// Separate scoped samples verify handoff and delay; they are labelled independently of the natural replay.
function focusedSample(paused) {
  let sampleTime=Date.parse('2026-10-04T04:00:00Z');const sampleNow=()=>new Date(sampleTime),sampleRecords=new Map();
  const store={get(ns,id){return structuredClone(sampleRecords.get(ns+':'+id)??null);},list(ns){return [...sampleRecords.entries()].filter(([k])=>k.startsWith(ns+':')).map(([,v])=>structuredClone(v));},put(ns,id,v){sampleRecords.set(ns+':'+id,structuredClone(v));},insert(ns,id,v){this.put(ns,id,v);},transaction(fn){return fn();}};
  let sampleWorld=createPersistentWorld({now:sampleNow,persistence:store,timeMode:'realtime'});
  createWorldLife({now:sampleNow,worldSnapshot:()=>sampleWorld.get(),ingest:e=>sampleWorld.ingest(e),enabled:true}).seedNpcs();
  sampleWorld.ingest({event_id:'sample-install',type:'world.mutation',source:'replay',occurred_at:sampleNow().toISOString(),payload:{action:'install_resident_life'}});
  const initial=sampleWorld.get();for(const actor of Object.values(initial.autonomy.actors))actor.paused=!['spare-mender-001','wetland-grower-001'].includes(actor.actor_id);
  store.put('canonical-world.states',initial.world_id,initial);sampleWorld=createPersistentWorld({now:sampleNow,persistence:store,timeMode:'realtime'});
  const scheduler=createAutonomousLife({world:sampleWorld,now:sampleNow,enabled:true});scheduler.tick();let interrupted=false;
  for(let minute=1;minute<=190;minute++){
    sampleTime+=60000;sampleWorld.syncWallClock();sampleWorld.syncTasks();scheduler.tick();
    const snapshot=sampleWorld.get(),commitment=snapshot.social.commitments.find(c=>c.key==='cooperate:frame');
    if(paused&&!interrupted){const task=snapshot.tasks.find(t=>t.actor_id==='spare-mender-001'&&t.status==='running');if(task){sampleWorld.ingest({event_id:'sample-pause',type:'world.mutation',source:'replay',occurred_at:sampleNow().toISOString(),payload:{action:'control_task',task_id:task.task_id,operation:'pause'}});interrupted=true;}}
    if(paused&&commitment?.delay_count){frames.delay={label:'延期专项 · 暂停后明确改约',map:getWorldMap(snapshot)};return;}
    if(!paused&&commitment?.status==='completed'){frames.cooperation={label:'协作专项 · 交接后维修完成',map:getWorldMap(snapshot)};return;}
  }
  throw Error('Focused social sample did not reach its expected real result');
}
if(!frames.cooperation)focusedSample(false);if(!frames.delay)focusedSample(true);
writeFileSync(new URL('../public/life-review-fixtures.json',import.meta.url),JSON.stringify({schema:'deskbot.autonomy-review.v1',description:'独立三天生活回放及协作、延期专项样本；专项仅开放两位参与者。无历史天气注入，不改变正式存档。',frames,outcomes},null,2));
console.log(JSON.stringify({frames:Object.keys(frames),completed_tasks:outcomes.length,activities:outcomes.filter(o=>o.activity_id).length,actors:13,cooperations:world.get().social.commitments.filter(c=>c.kind==='cooperate'&&c.status==='completed').length,failed:world.get().social.commitments.filter(c=>c.status==='failed').length,notices:world.get().social.notices.length,final_stock:world.get().living.objects['seedling-rack'].stock}));
