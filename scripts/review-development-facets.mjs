import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createPersistentWorld} from '../apps/deskbot-service/src/persistent-world.mjs';
import {createSqlitePersistence} from '../apps/deskbot-service/src/persistence.mjs';
import {installResidentLife} from '../apps/deskbot-service/src/resident-life.mjs';
import {installRefraction} from '../apps/deskbot-service/src/input-refraction.mjs';
import {installLivedMemory,memoryReadModel} from '../apps/deskbot-service/src/lived-memory.mjs';
import {createAutonomousLife} from '../apps/deskbot-service/src/autonomous-life.mjs';
import {developmentReadModel} from '../apps/deskbot-service/src/development-evidence.mjs';

// Controlled-clock, fictional initial conditions. Every displayed task outcome
// is settled by the ordinary life/task engine; no installed database or provider.
const START=Date.parse('2026-10-06T04:00:00.000Z'),OWN='shaping-001';
let sequence=0;
function harness(){
  mkdirSync(new URL('../tmp/',import.meta.url),{recursive:true});
  const filename=fileURLToPath(new URL(`../tmp/development-facets-${process.pid}-${Date.now()}-${sequence++}.sqlite`,import.meta.url));
  let time=START;const now=()=>new Date(time);
  let persistence=createSqlitePersistence({filename,now}),world=createPersistentWorld({persistence,now,timeMode:'realtime'});
  const initial=world.get();installResidentLife(initial,now().toISOString());installRefraction(initial,now().toISOString());
  initial.protagonist.location_id='moss-sprout-garden';
  Object.assign(initial.living.objects['garden-bed'],{health:.9,growth:.2,moisture:.55});
  Object.assign(initial.living.objects['seedling-rack'].stock,{trays:2,seeds:4,water:12});
  initial.living.objects['shared-table'].stock.rations=8;
  for(const actor of Object.values(initial.autonomy.actors)){actor.paused=actor.actor_id!==OWN;actor.energy=.8;actor.appetite=.1;}
  installLivedMemory(initial,now().toISOString(),{plannerEnabled:false});persistence.put('canonical-world.states',initial.world_id,initial);
  const reload=()=>{persistence.close();persistence=createSqlitePersistence({filename,now});world=createPersistentWorld({persistence,now,timeMode:'realtime'});};reload();
  const life=()=>createAutonomousLife({world,now,enabled:true});
  return {get world(){return world;},now,reload,close(){persistence.close();},
    step(minutes=5){time+=minutes*60000;world.syncWallClock();world.syncTasks();life().tick();},
    finish(task){time=Date.parse(task.due_at);world.syncWallClock();world.syncTasks();},
    tick(){life().tick();},
    suggestion(id){world.ingest({event_id:id,type:'user.preference.life',source:'isolated-review-user',character_id:OWN,occurred_at:now().toISOString(),payload:{suggestion:'tend'}},{attestedKind:'user',sourceLabel:'隔离样本中的主人建议'});},
    removeCrop(){const state=world.get();state.living.objects['garden-bed'].quantity=0;persistence.put('canonical-world.states',state.world_id,state);reload();}};
}
const samples=[];
function sample(h,id,label,summary,extra={}){const state=h.world.get();assert.ok(state.memory.development.facets);
  // All records were constructed in this credential-free, fictional harness.
  assert.equal(state.user_turns?.length??0,0);
  samples.push({id,label,now:h.now().toISOString(),memory:memoryReadModel(state),summary,...extra});}
const h=harness();h.suggestion('review-owner-tend');
sample(h,'contact','只听到建议','主人提了照料苗床的建议。留下接触来源；还没有实践、能力或持续兴趣。');
h.tick();let actual=h.world.get().tasks.find(t=>t.activity_id==='tend-bed'&&t.status==='running');assert.ok(actual,'ordinary life must accept and start the real invited activity');
h.finish(actual);sample(h,'invited','主人促成的实践','照料耗时结束并消耗实际清水。能力有一次做成依据；受邀实践本身没有证明喜欢。');
const invitedCare=developmentReadModel(h.world.get()).facets.actors.find(a=>a.actor_id===OWN).topics.find(t=>t.topic==='care');
assert.equal(invitedCare.capability.success_roots.length,1);assert.equal(invitedCare.interest.active_roots.length,0);
for(let i=0;i<3*24*12;i++){h.step();if((i+1)%144===0)console.log(JSON.stringify({progress_simulated_hours:(i+1)/12}));}
sample(h,'continuation','后来怎样安排','接着推进三个模拟日，由正常需要、有限资源和自主候选安排实际生活。完成的自选关注与配方、义务和受邀实践分别记录。');
const own=developmentReadModel(h.world.get()).facets.actors.find(a=>a.actor_id===OWN);
assert.ok(own.topics.some(t=>t.interest.active_roots.length>0),'the normal loop must leave real discretionary outcomes');
const failure=harness();failure.suggestion('review-condition-tend');failure.tick();actual=failure.world.get().tasks.find(t=>t.activity_id==='tend-bed'&&t.status==='running');assert.ok(actual);
failure.removeCrop();failure.finish(actual);
sample(failure,'condition','苗床条件改变','隔离实验中，活动开始后移除了原有苗木。到期核验未通过，材料按规则归还；这次条件失败不表示讨厌照料或不会做。');
const failed=developmentReadModel(failure.world.get());assert.equal(failed.recent.find(r=>r.source.task_id===actual.task_id).failure.classification,'condition');
const before=developmentReadModel(h.world.get()),state=h.world.get();h.reload();assert.deepEqual(h.world.get(),state);assert.deepEqual(developmentReadModel(h.world.get()),before);
sample(h,'restart','存档重新载入','同一份生活存档经真实世界加载器重新载入，结果根、兴趣、能力和规则自评都保留；再次读取不增加次数。',{restart_verified:true});
const document={schema:'deskbot.development-facets-review.v1',simulated:true,live_world_untouched:true,
  experiment:{simulated_days:3,actors_active:1,actors_total:Object.keys(h.world.get().autonomy.actors).length,persistence:'sqlite',external_calls:0,initial_conditions:'fictional_authored_fixture',quality_scores_available:false},samples};
writeFileSync(new URL('../apps/jev-town-client/public/development-facets-review.json',import.meta.url),JSON.stringify(document,null,2));
console.log(JSON.stringify({samples:samples.map(s=>s.id),simulated:true,continuation:own.topics.map(t=>({topic:t.topic,active:t.interest.active_roots.length,invited:t.interest.invited_roots.length,obligation:t.interest.obligation_roots.length,success:t.capability.success_roots.length,bonus:t.interest.bonus,status:t.interest.status})),restart_verified:true}));
h.close();failure.close();
