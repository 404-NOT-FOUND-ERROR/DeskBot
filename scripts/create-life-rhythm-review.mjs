import fs from 'node:fs';
import { createPersistentWorld, getWorldMap } from '../apps/deskbot-service/src/persistent-world.mjs';
import { installResidentLife } from '../apps/deskbot-service/src/resident-life.mjs';
import { installLivedMemory, syncLivedMemory } from '../apps/deskbot-service/src/lived-memory.mjs';
import { syncLifeRhythm } from '../apps/deskbot-service/src/life-rhythm.mjs';
import { advanceAutonomousLife } from '../apps/deskbot-service/src/autonomous-life.mjs';
import { applyRealTimeClock, advanceWorldTask } from '../apps/deskbot-service/src/realtime-world.mjs';
import { advanceLivingResources, LIVING_RULE_VERSION } from '../apps/deskbot-service/src/living-resources.mjs';
const OWN='shaping-001',START='2026-10-05T04:00:00.000Z',DAY=86400000;
const at=n=>new Date(Date.parse(START)+n*DAY).toISOString();
const w=createPersistentWorld({timeMode:'realtime',now:()=>new Date(START)}).get();
installResidentLife(w,START);installLivedMemory(w,START,{plannerEnabled:false});
for(const state of Object.values(w.autonomy.actors))state.paused=state.actor_id!==OWN;
const frames={};
function clock(time){applyRealTimeClock(w,time);advanceLivingResources(w,time,{force:true});Object.assign(w.autonomy.actors[OWN],{updated_at:time,energy:.85,appetite:.2});}
function save(key,label){syncLifeRhythm(w,w.clock.synced_at);frames[key]={label,map:getWorldMap(w)};}
function result(id,n,activity,motivation='self_continuation'){
 clock(at(n));w.tasks.push({task_id:id,actor_id:OWN,status:'completed',kind:'care',life_action:'activity',activity_id:activity,life_goal:'water',origin:'autonomous_life',
  life_source_ids:[],life_motivation:{kind:motivation},location_id:'moss-sprout-garden',finished_at:at(n),completion_effect:LIVING_RULE_VERSION,completion:{due_at:at(n),effect:LIVING_RULE_VERSION}});
 syncLivedMemory(w,at(n));
}
w.memory.development.contacts.push({actor_id:OWN,topic:'care',at:START,source_record_id:'sample:initial-contact'});
save('begin','一天的好奇');
result('rhythm-sample-water',0,'water-bed');result('rhythm-sample-tend',1,'tend-bed');result('rhythm-sample-repeat',2,'water-bed');
save('invested','跨日投入');
clock(at(6));w.autonomy.actors[OWN].appetite=.95;save('held','先顾眼前，投入还在');
clock(at(10));save('parked','暂时搁置');
w.memory.development.contacts.push({actor_id:OWN,topic:'care',at:at(10),expires_at:at(11),source_record_id:'sample:new-care-contact'});save('reawakened','又有些好奇');
result('rhythm-sample-invitation',10,'tend-bed','invited');
clock(at(11));w.protagonist.location_id='moss-sprout-garden';
Object.assign(w.living.objects['garden-bed'],{growth:.2,moisture:.6,health:.98,quantity:10});
Object.assign(w.living.objects['seedling-rack'].stock,{water:8,seeds:8,trays:2});w.living.objects['trial-stove'].stock.water=8;w.living.objects['shared-table'].stock.rations=10;
syncLivedMemory(w,at(11));save('followup','昨天的事，今天再看');
advanceAutonomousLife(w,at(11),{eventId:'rhythm-sample:choose'});
const task=w.tasks.find(t=>t.status==='running'&&t.actor_id===OWN);
if(!task?.life_followup)throw Error('Sample follow-up was not selected through the actual scheduler');
save('doing','自己选择继续');
clock(task.due_at);advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},task.due_at);syncLivedMemory(w,task.due_at);
save('settled','实际任务接上后续');
const output=new URL('../apps/jev-town-client/public/rhythm-review-fixtures.json',import.meta.url);
fs.writeFileSync(output,JSON.stringify({schema:'deskbot.life-rhythm-review.v1',description:'独立设计案例：起始条件与前三日活动史为构造样本；最后的复看由实际排程和任务执行器产生。与正式喵呜存档分开。',frames},null,2));
console.log(JSON.stringify({frames:Object.keys(frames),file:output.pathname}));
