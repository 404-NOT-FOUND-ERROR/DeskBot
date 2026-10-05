import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createSqlitePersistence} from '../apps/deskbot-service/src/persistence.mjs';
import {createPersistentWorld} from '../apps/deskbot-service/src/persistent-world.mjs';
import {installResidentLife} from '../apps/deskbot-service/src/resident-life.mjs';
import {installRefraction} from '../apps/deskbot-service/src/input-refraction.mjs';
import {installLivedMemory,memoryReadModel} from '../apps/deskbot-service/src/lived-memory.mjs';
import {createRoleProposalStore} from '../apps/deskbot-service/src/role-proposals.mjs';
import {createRoleEvolution} from '../apps/deskbot-service/src/role-evolution.mjs';
import {computeFantasyPull} from '../apps/deskbot-service/src/fantasy-pull.mjs';
import {findWorldPath} from '../apps/deskbot-service/src/world-map-content.mjs';
import {ACTIVITIES} from '../apps/deskbot-service/src/living-resources.mjs';
import {syncLifeNeeds} from '../apps/deskbot-service/src/life-state.mjs';

// This is an authored prerequisite/lifecycle experiment, not an observation of
// spontaneous model choices. The fixture schedules choices and motivation at
// task start. Routes, durations, reservations and outcomes use the real engine.
// No result is inserted and no installed world, credential or provider is used.
const OWNER='shaping-001',START=Date.parse('2026-10-06T04:00:00Z');
mkdirSync(new URL('../tmp/',import.meta.url),{recursive:true});
const filename=fileURLToPath(new URL(`../tmp/role-wishes-${process.pid}-${Date.now()}.sqlite`,import.meta.url));
let time=START,sequence=0,persistence,world,roles,evolution;
const now=()=>new Date(time),iso=()=>now().toISOString();
const events=[];
function reload(){
  persistence?.close();
  persistence=createSqlitePersistence({filename,now});
  world=createPersistentWorld({persistence,now,timeMode:'realtime'});
  roles=createRoleProposalStore({persistence,now});
  evolution=createRoleEvolution({persistence,now,roles,inputStore:{list:()=>structuredClone(events)},computeFantasyPull,worldSnapshot:()=>world.get()});
}
reload();
const initial=world.get();
installResidentLife(initial,iso());installRefraction(initial,iso());
initial.protagonist.location_id='moss-sprout-garden';
Object.assign(initial.living.objects['seedling-rack'].stock,{water:12,seeds:8});
initial.living.objects['shared-table'].stock.rations=8;
initial.living.inventories[OWNER]={stock:{light_fruit:8},capacity:24};
for(const actor of Object.values(initial.autonomy.actors)){actor.paused=true;actor.energy=.8;actor.appetite=.1;}
initial.autonomy.actors[OWNER].paused=false;
installLivedMemory(initial,iso(),{plannerEnabled:false});
persistence.put('canonical-world.states',initial.world_id,initial);reload();
const samples=[],modelSamples=[];
function sample(id,label,summary,extra={}){
  const state=world.get(),read=evolution.snapshot({characterId:OWNER});
  samples.push({id,label,summary,now:iso(),memory:memoryReadModel(state),evolution:read,
    proposals:evolution.wishProposals({characterId:OWNER}),...extra});
  modelSamples.push({id,now:iso(),world:state,proposals:evolution.wishProposals({characterId:OWNER})});
}
function mutate(payload){return world.ingest({event_id:`review-wish-${sequence++}`,type:'world.mutation',source:'authored-wish-fixture',character_id:OWNER,occurred_at:iso(),payload});}
function jump(until){assert.ok(until>=time);time=until;
  const state=world.get();syncLifeNeeds(state,iso());persistence.put('canonical-world.states',state.world_id,state);reload();
  world.syncWallClock();world.syncTasks();}
function finish(){
  for(let i=0;i<40;i++){
    const task=world.get().tasks.find(t=>t.actor_id===OWNER&&t.status==='running');
    if(!task)return;
    jump(Date.parse(task.due_at));
  }
  throw Error('Task did not settle within the bounded fixture');
}
function move(location){
  const from=world.get().protagonist.location_id;if(from===location)return;
  const path=findWorldPath(world.get(),from,location);assert.ok(path?.length>1);
  mutate({action:'move_protagonist',location_id:path[1],destination_location_id:location,reason:'受控样本中的实际行程'});finish();
  assert.equal(world.get().protagonist.location_id,location);
}
function activity(activityId,{motivation='self_continuation',topic=null,sourceIds=[]}={}){
  const recipe=ACTIVITIES.find(a=>a.activity_id===activityId);
  if(recipe){const catalog=world.get().map_catalog,definition=catalog.objects.find(o=>o.object_id===recipe.target);assert.ok(definition);move(catalog.areas.find(a=>a.area_id===definition.area_id).location_id);}
  const taskId=`review-actual-${sequence++}`;
  mutate({action:'start_activity',task_id:taskId,actor_id:OWNER,...(recipe?{activity_id:activityId}:{kind:'care',title:activityId==='rest'?'实际休息':'受控样本中的观察',duration_seconds:activityId==='rest'?21600:900})});
  // Test-adapter metadata is assigned before completion. This records the
  // fixture's scheduled motivation and does not manufacture a settled result.
  const state=world.get(),task=state.tasks.find(t=>t.task_id===taskId);assert.ok(task);
  Object.assign(task,{origin:'autonomous_life',life_action:recipe?recipe.kind:activityId==='rest'?'rest':'observe',
    life_goal:recipe?`continue:${activityId}`:activityId==='rest'?'rest':`interest:${state.protagonist.location_id}`,
    life_motivation:{kind:motivation,basis_score:31},life_source_ids:sourceIds});
  if(topic)task.life_topic=topic;
  persistence.put('canonical-world.states',state.world_id,state);reload();finish();
  const completed=world.get().tasks.find(t=>t.task_id===taskId);assert.equal(completed.status,'completed',activityId);
  assert.ok(completed.completion);return taskId;
}
function suggestion(id){
  const event={event_id:id,type:'user.preference.life',source:'isolated-user',character_id:OWNER,occurred_at:iso(),received_at:iso(),payload:{suggestion:'tend',text:'可以多看看苗圃，试着做一只青蛙吗？'}};
  events.push(event);world.ingest(event,{attestedKind:'user',sourceLabel:'隔离样本中的主人建议'});
}
function run(){return evolution.sync({characterId:OWNER});}
const wishes=()=>roles.list({characterId:OWNER,limit:200}).filter(p=>p.origin==='lived_wish');
const form=()=>wishes().find(p=>p.direction_id==='wetland_frog');
suggestion('review-owner-suggestion');run();
sample('contact-only','建议还不是愿望','主人提了照料和青蛙的想法。仅有接触，没有实践和持续兴趣，因此不产生角色愿望。');
assert.equal(wishes().length,0);
const sourceIds=world.get().refraction.records.filter(r=>r.category==='dialogue').map(r=>r.id);
activity('tend-bed',{motivation:'invited',sourceIds});run();
sample('one-invited','做过一次，还在了解','主人促成的一次照料通过实际耗时和清水预留完成。它成为实践依据，但不等于主动持续喜欢，也不直接成为青蛙。');
assert.equal(wishes().length,0);
for(let day=0;day<3;day++){
  if(day){activity('rest',{motivation:'need'});jump(START+day*86400000);}
  activity('tend-bed');activity('collect-water');
  move('warm-pot-courtyard');activity('observe',{topic:'cook'});activity('cook-grove-stew');
  activity('share-meal',{motivation:'need'});
}
move('moss-sprout-garden');activity('rest',{motivation:'need'});
const stableRun=run();assert.ok(form(),'actual multisituation prerequisites should admit a form wish');
sample('stable-form','有依据的形态愿望','受控样本安排了三个上海日的实际照料、汲水和做饭。愿望规则读取相同结果根，在两种情境的主动继续和跨日练习上提出形态想法；外观仍保留原样。');
assert.equal(stableRun.created.length,1,'at most one announcement per global cooldown');
assert.equal(wishes().filter(p=>p.direction_id==='chef').length,0);
const oldAppearance=structuredClone(world.get().protagonist.appearance);
roles.choose(form().proposal_id,'try',{reason:'愿意陪你准备实际试做'});run();
assert.equal(form().status,'prepared');
assert.throws(()=>roles.startTrial(form().proposal_id),error=>error.code==='practical_trial_not_connected'&&error.statusCode===409);
sample('prepared','先准备试做','主人支持尝试，愿望保留为准备状态。尚未开始第五阶段的实际角色试用，对话不会增加试用成果，也没有外观或身份变化。');
const blocked=world.get(),beforeConditionBranch=structuredClone(blocked.living.objects);
blocked.living.objects['seedling-rack'].stock.water=0;
blocked.living.objects['floating-frame'].condition=.1;
Object.assign(blocked.living.objects['garden-bed'],{growth:.1,moisture:.58});
persistence.put('canonical-world.states',blocked.world_id,blocked);reload();run();
const unavailable=evolution.snapshot({characterId:OWNER}).wishes.directions.find(d=>d.direction_id==='wetland_frog');
assert.equal(unavailable.current_circumstance.practice_available,false);
assert.equal(unavailable.readiness.eligible,false);
sample('condition-blocked','条件变了，先缓一缓','受控条件反例中，苗圃清水不足、苗床尚未成熟，泉边设施也暂不能用。兴趣和做过的事仍保留，准备暂缓；不能把缺料说成不喜欢或做不到。');
// Restore this fixture's original finite stock for the independent lifecycle
// branch. This is declared counterfactual setup, never a production refill.
const restored=world.get();restored.living.objects=beforeConditionBranch;
persistence.put('canonical-world.states',restored.world_id,restored);reload();
jump(time+24*3600000);activity('share-meal',{motivation:'need'});activity('rest',{motivation:'need'});run();
const chef=wishes().find(p=>p.direction_id==='chef');assert.ok(chef,'vocation may coexist with prepared form');
assert.equal(chef.axis,'vocation');assert.equal(form().axis,'form');
sample('two-axes','形态和职业可以并存','全局冷却后，厨师方向也达到跨日兴趣、具体做饭和当前材料前提。它可以与青蛙形态愿望并存，仍然只是两个想尝试的方向。');
roles.choose(chef.proposal_id,'later',{reason:'先把眼前生活安排好'});run();
sample('deferred','暂缓之后不催促','主人选择晚一点。愿望记录保留，重新考虑需要冷却结束和新的实际经历；重复消息、重复读接口不会重提。');
const beforeCount=wishes().length;run();run();assert.equal(wishes().length,beforeCount);
const beforeWorld=world.get(),before=evolution.snapshot({characterId:OWNER}),beforeProposals=wishes();
reload();assert.deepEqual(world.get(),beforeWorld);assert.deepEqual(evolution.snapshot({characterId:OWNER}),before);
assert.deepEqual(wishes(),beforeProposals);assert.deepEqual(world.get().protagonist.appearance,oldAppearance);
sample('restart','重新载入，仍是同一段生活','SQLite 经真实加载器关闭并重新载入。愿望、主人选择、冷却和共同结果根都保留；外观与身份没有改变。',{restart_verified:true});
const document={schema:'deskbot.role-wishes-review.v1',simulated:true,live_world_untouched:true,
  experiment:{persistence:'sqlite',external_calls:0,actors_active:1,actors_total:13,choice_basis:'authored_prerequisite_schedule',
    counterfactual_resource_branch:true,spontaneous_model_choice_verified:false,appearance_changes:false,actual_role_trial:false},samples};
writeFileSync(new URL('../apps/jev-town-client/public/role-wishes-review.json',import.meta.url),JSON.stringify(document,null,2));
writeFileSync(new URL('../tmp/role-wishes-model-worlds.json',import.meta.url),JSON.stringify(modelSamples));
console.log(JSON.stringify({samples:samples.map(s=>s.id),roots:world.get().memory.development.records.length,
  proposals:wishes().map(p=>({direction:p.direction_id,axis:p.axis,status:p.status})),restart_verified:true,live_world_untouched:true}));
persistence.close();
