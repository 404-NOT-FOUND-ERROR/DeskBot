// Same authored starts used by stage 5; no provider or production data.
import {createPersistentWorld} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {startActivityTask,advanceWorldTask} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,cognitiveActualResult,settleCognitiveTask} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {formedCareFixture,arrange,atDay} from './development-fixtures.mjs';
import {syncLivedMemory} from '../../../apps/deskbot-service/src/lived-memory.mjs';
const actors=['shaping-001','wetland-grower-001','lamp-keeper-001'],initial='2026-10-11T02:00:00.000Z';
function settle(w,task){
 while(task.status==='running'){
  const due=task.due_at;advanceLivingResources(w,due,{force:true});w.clock.synced_at=due;
  advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},due);
 }
 settleCognitiveTask(w,task,w.clock.synced_at);
}
export function continuityFixture(actor,variant){
 if(variant==='formed-care'||variant==='care-hold'){
  const w=formedCareFixture();arrange(w,atDay(4));
  if(variant==='care-hold')w.living.objects['seedling-rack'].stock.water=0;
  w.cognition.actors[actor].state={};return w;
 }

 const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(initial)});
 api.ingest({event_id:'residents',type:'world.mutation',source:'fixture',character_id:'shaping-001',payload:{action:'install_resident_life'}});
 const w=api.get();w.npcs=w.npcs.filter(n=>actors.includes(n.npc_id));
 const person=actor==='shaping-001'?w.protagonist:w.npcs.find(n=>n.npc_id===actor);
 w.living.inventories[actor]={stock:{moss:2,trays:2},capacity:24};
 function act(activity){const task_id=`authored-prior:${activity}`;startActivityTask(w,{actor_id:actor,task_id,activity_id:activity},{eventId:task_id,at:w.clock.synced_at});settle(w,w.tasks.find(t=>t.task_id===task_id));}
 function wait(hours){const at=new Date(Date.parse(w.clock.synced_at)+hours*3600000).toISOString();advanceLivingResources(w,at,{force:true});w.clock.synced_at=at;}
 let question,root;
 if(variant.startsWith('water')){
  person.location_id='spare-parts-house';act('echo-craft-bell');person.location_id='echo-waterside';act('echo-set-bell');
  w.living.weather_window={from:w.clock.synced_at,until:'2026-10-12T23:00:00Z',wind_mps:variant==='water-wind'?12:0,rain_rate:0,humidity:.6,temperature_c:20,provider:'isolated-fixture'};
  wait(.5);act('echo-read-bell');root='task:authored-prior:echo-read-bell';question='想弄清我架的回声杯在风和水位变化时怎样发声，选一个现在可以做的方法继续试试';
 }else{
  person.location_id='moss-sprout-garden';act('glow-set-pair');wait(2);act('glow-read-pair');act('glow-press-study');act('glow-take-study');person.location_id='fog-lamp-square';
  w.clock.synced_at='2026-10-11T11:00:00.000Z';advanceLivingResources(w,w.clock.synced_at,{force:true});act('night-mount-lantern');
  if(variant==='night-closed')act('night-close-shutter');wait(.5);act('night-read-lantern');root='task:authored-prior:night-read-lantern';question='想知道带到广场的余辉能留多久，遮光片和昼夜又会怎样影响它，选一个实际可行的方法继续';
 }
 const at=w.clock.synced_at,fact='隔离前史：我已实际制作和安装自己的试验物，并留下第一次测记，原始任务保存在本隔离世界。';
 w.cognition={schema:'deskbot.cognitive-life.v2',epoch:initial,clock_scope:'isolated_test_clock',actors:{[actor]:{actor_id:actor,version:0,state:{},memories:[],history:[],enabled:false,plan_count:0,
  last_result:{root_outcome_id:root,fact,occurred_at:at},followup:{status:'continue',question,reason:'自己的隔离试验还有未弄清的问题',from_root_outcome_id:root}}}};
 w.cognition.actors[actor].continuous=true;
 syncLivedMemory(w,w.clock.synced_at);
 return w;
}
