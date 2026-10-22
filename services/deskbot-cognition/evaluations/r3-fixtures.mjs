// All initial conditions below are authored, isolated fixtures. No production save is read.
import {createHash} from 'node:crypto';
import {createPersistentWorld} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {installLivedMemory,syncLivedMemory} from '../../../apps/deskbot-service/src/lived-memory.mjs';
import {installRefraction,refractInput} from '../../../apps/deskbot-service/src/input-refraction.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {startActivityTask,advanceWorldTask,applyRealTimeClock} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {syncLifeNeeds} from '../../../apps/deskbot-service/src/life-state.mjs';
import {settleCognitiveTask,cognitiveContext} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {cognitiveOpportunityWindow} from '../../../apps/deskbot-service/src/cognitive-development.mjs';

export const OWNER='shaping-001',ACTORS=[OWNER,'lamp-keeper-001','wetland-grower-001'];
export const START='2026-10-20T00:00:00.000Z',NIGHT='2026-10-20T11:00:00.000Z';
export const CLASSES=['weather','advice','knowledge','invitation','touch','resources'];
export const LABELS={weather:'风雨',advice:'主人建议',knowledge:'公开知识',invitation:'他者邀请',touch:'头部轻触',resources:'材料短缺',persona:'人物交换'};
export const plus=(at,min)=>new Date(Date.parse(at)+min*60000).toISOString();
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const cases=Array.from({length:3},(_,repeat)=>CLASSES.flatMap(group=>[false,true].map(on=>({
  id:`${group}-${repeat+1}-${on?'on':'off'}`,group,repeat:repeat+1,on,actor:OWNER
})))).flat();
export const personaCases=ACTORS.flatMap(actor=>[1,2].map(repeat=>({id:`persona-${actor}-${repeat}`,group:'persona',repeat,on:false,actor})));
export function tick(w,at){
  if(at<w.clock.synced_at)throw Error('fixture_clock_reversal');
  advanceLivingResources(w,at,{force:true});applyRealTimeClock(w,at);syncLifeNeeds(w,at);syncLivedMemory(w,at);
}
export function settle(w,task,until=plus(w.clock.synced_at,120)){
  let n=0;
  while(task?.status==='running'&&task.due_at<=until){
    if(++n>100)throw Error('task_did_not_settle');
    tick(w,task.due_at);advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},w.clock.synced_at);
  }
  if(task)settleCognitiveTask(w,task,w.clock.synced_at);
  syncLivedMemory(w,w.clock.synced_at);
  return task;
}
export function source(w,type,payload,kind,label,id='fixture-input',more={}){
  const at=w.clock.synced_at,event={event_id:id,type,source:'r3-isolated-adapter',character_id:OWNER,observed_at:at,occurred_at:at,payload,...more};
  const result=refractInput(w,event,at,{attestedKind:kind,sourceLabel:label});
  if(!result.accepted)throw Error(`fixture_input_rejected:${result.reason}`);
  return {event,result};
}
export function fixture(c){
  const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(START)});
  api.ingest({event_id:'fixture-residents',type:'world.mutation',source:'fixture',payload:{action:'install_resident_life'}});
  const w=api.get();installLivedMemory(w,START);installRefraction(w,START);
  w.world_id='r3-isolated-waylight';
  for(const person of [w.protagonist,...w.npcs]){
    const id=person.character_id??person.npc_id;
    if(ACTORS.includes(id))person.location_id='echo-waterside';
    Object.assign(w.autonomy.actors[id],{paused:id!==c.actor,energy:.9,appetite:.15,plan:null});
  }
  // This finite supply is declared initial stock, never described as self-crafted.
  w.living.inventories[c.actor]={stock:{light_leaf:4,wood:2,cloth:4,fasteners:4,waylight_shade:1},capacity:24};
  const taskId='fixture-built-lamp';
  startActivityTask(w,{actor_id:c.actor,task_id:taskId,activity_id:'waylight-build-open'},{eventId:taskId,at:START});
  settle(w,w.tasks.find(t=>t.task_id===taskId));tick(w,NIGHT);
  for(const s of Object.values(w.autonomy.actors))Object.assign(s,{energy:.88,appetite:.2,updated_at:NIGHT,next_decision_at:NIGHT});
  // Equal comfortable initial conditions; later needs, stock and clock are never reset.
  Object.assign(w.living.objects['garden-bed'],{moisture:.55,health:.97,growth:.2,quantity:10});
  Object.assign(w.living.objects['seedling-rack'].stock,{water:8,moss:8,trays:5,seeds:8});
  w.living.recovery.pending=false;
  w.memory.planner.enabled=false;
  w.cognition={schema:'deskbot.cognitive-life.v2',epoch:START,clock_scope:'isolated_test_clock',actors:{
    [c.actor]:{actor_id:c.actor,continuous:true,enabled:false,version:0,state:{},memories:[],history:[],plan_count:0,
      last_result:{root_outcome_id:`task:${taskId}`,task_id:taskId,success:true,occurred_at:w.tasks[0]?.completion?.due_at??START,
        fact:'隔离前史：我实际制作了这盏敞开的归途灯。当前随身材料以背包记录为准。'},
      followup:{status:'continue',question:'入夜后，这盏归途灯怎样兼顾取水的照明和水岸留暗？我还想在实际条件下试一试。',
        reason:'自己白天制作的灯还有一个问题',from_root_outcome_id:`task:${taskId}`}}
  }};
  if(c.on){
    if(c.group==='resources'){
      w.living.inventories[c.actor].stock.waylight_shade=0;
      w.living.inventories[c.actor].stock.cloth=0;
    }else if(c.group==='weather'){
      w.weather={status:'小雨',snapshot:{location:'隔离上海参考',condition:'小雨',temperature_c:19,wind_mps:10,humidity:85,observed_at:NIGHT,provider:'isolated-fixture'},provenance:{expires_at:plus(NIGHT,60)}};
      w.living.weather_window={from:NIGHT,until:plus(NIGHT,60),wind_mps:10,rain_rate:.12,humidity:.85,temperature_c:19,provider:'isolated-fixture'};
      source(w,'weather.observation',{condition:'小雨',wind_mps:10},'provider','隔离天气样本');
    }else if(c.group==='advice'){
      source(w,'conversation.input',{role:'user',text:'我觉得水岸留一点暗会舒服些。你可以考虑给灯装罩，不过想先试别的也可以。'},'user','虚构主人建议');
    }else if(c.group==='knowledge'){
      source(w,'external.report',{text:'隔离公开资料：定向灯罩能减少向旁边的散光，但也可能降低可用照明。这个经验在聚形域是否适用，需要按这里的规律试验。',published_at:NIGHT},'provider','虚构灯具资料');
    }else if(c.group==='invitation'){
      // Admitted once through the same agent input adapter as external agents.
      // An invitation is NOT a mutually accepted social commitment.
      source(w,'agent.request',{text:'我是灯穗，想邀请你一起考虑给归途灯加罩，好让路上有光、水岸留暗。你愿不愿意，或者想怎样试？'},'agent','灯穗的隔离来信');
    }else if(c.group==='touch'){
      source(w,'sensor.touch',{region:'head'},'device','隔离测试设备');
    }
  }
  syncLivedMemory(w,NIGHT);
  return w;
}
export function digest(w,id){
  return {
    at:w.clock.synced_at,location:(id===OWNER?w.protagonist:w.npcs.find(n=>n.npc_id===id)).location_id,
    lamp:structuredClone(w.living.objects['floating-frame'].waylight),
    bag:structuredClone(w.living.inventories[id]?.stock??{}),
    tasks:w.tasks.filter(t=>t.actor_id===id).map(t=>({id:t.task_id,activity:t.activity_id??null,kind:t.kind,status:t.status,root:t.root_outcome_id??`task:${t.task_id}`,result:t.completion?.result??null})),
    development:structuredClone(w.memory?.development??{}),
  };
}
export function opportunity(w,id){
  const raw=cognitiveOpportunityWindow(w,id,w.clock.synced_at);
  const ctx=cognitiveContext(w,id,w.clock.synced_at);
  const effects=new Set();
  for(const a of ctx.capabilities.activities.filter(a=>a.available)){
    const k=a.activity_id;
    effects.add(['waylight-use','collect-water'].includes(k)?'取水':/build|craft|fit|repair/.test(k)?'改变物件':/open|shade|close/.test(k)?'调整光照':/read|measure|observe/.test(k)?'测记':'其他生产照料');
  }
  if(ctx.capabilities.travel.destinations.length)effects.add('移动探索');
  if(ctx.capabilities.share.receivers.length)effects.add('交流');
  return {raw,meaningful_options:[...effects],strict_two:raw.free&&effects.size>=2};
}
