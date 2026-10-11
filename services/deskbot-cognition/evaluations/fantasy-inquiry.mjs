// Deterministic engine replay, explicitly not a spontaneous model life or natural days.
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createPersistentWorld,getWorldMap} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {startActivityTask,advanceWorldTask,applyRealTimeClock} from '../../../apps/deskbot-service/src/realtime-world.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const at='2026-10-11T02:00:00.000Z',id='shaping-001';
const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(at)});
api.ingest({event_id:'fixture-residents',type:'world.mutation',source:'fixture',character_id:id,payload:{action:'install_resident_life'}});
const w=api.get();w.protagonist.location_id='moss-sprout-garden';w.living.inventories[id]={stock:{moss:0,trays:2,shade_hood:1},capacity:24};
w.npcs=w.npcs.filter(n=>['wetland-grower-001','lamp-keeper-001'].includes(n.npc_id));for(const n of w.npcs)n.location_id='moss-sprout-garden';
const snapshots=[],events=[];
function snapshot(key,title,detail){applyRealTimeClock(w,w.clock.synced_at);snapshots.push({key,title,detail,at:w.clock.synced_at,map:getWorldMap(w),world:structuredClone(w)});}
function perform(activity,{hours=0,during=false}={}){
 const when=new Date(Date.parse(w.clock.synced_at)+hours*3600000).toISOString();advanceLivingResources(w,when,{force:true});w.clock.synced_at=when;
 const taskId=`fixture-glow:${events.length}:${activity}`;
 startActivityTask(w,{actor_id:id,task_id:taskId,activity_id:activity},{eventId:taskId,at:when});
 const task=w.tasks.find(t=>t.task_id===taskId);
 if(during)snapshot('reading','正在测记','角色动作与放大镜来自执行中的测记任务，结果尚未写入。');
 advanceLivingResources(w,task.due_at,{force:true});w.clock.synced_at=task.due_at;advanceWorldTask(w,{task_id:taskId,expected_task_revision:task.revision},task.due_at);
 if(task.status!=='completed')throw Error(JSON.stringify(task));events.push({task_id:taskId,at:task.due_at,title:task.title,result:task.completion.result});return task;
}
perform('glow-take-cuttings');perform('glow-set-pair');snapshot('setup','刚摆好两盘','A、B 使用等量苔芽；托盘与样本已消耗。此时尚无对照结论。');
perform('glow-read-pair',{hours:2,during:true});snapshot('comparison','光照留下了差异','两个实际小时后读取 A、B 的蓄光、含水和亮度。同一规律产生不同读数。');
perform('glow-water-pair');perform('glow-water-pair');snapshot('wet','补水后的变暗','两盘等量补水到偏湿状态，含水抑制显色；蓄光仍然存在。');
perform('glow-drain-pair');snapshot('drained','换一种照料方法','排湿后显色恢复。每次改变条件都会重新开始两小时对照窗口。');
perform('glow-shelter-pair');snapshot('sheltered','装上可拆遮风罩','实际消耗随身遮风罩后才显示罩体；后续风雨按遮蔽条件结算。');
perform('glow-unshelter-pair');perform('glow-read-pair',{hours:2});perform('glow-press-study');snapshot('study','留下一个余辉标本','两份苔样和一个托盘成为可追溯标本，另一个托盘回收；余辉会随时间消退。');
const night='2026-10-11T11:00:00.000Z';advanceLivingResources(w,night,{force:true});w.clock.synced_at=night;snapshot('night','入夜后的余辉','傍晚后蓄光开始消退；标本并非永久光源，画面亮度仍来自实际规则状态。');
const output=resolve(arg('output')??'runtime/asamana-deployment/stage3b');mkdirSync(output,{recursive:true});
writeFileSync(resolve(output,'engine-replay.json'),JSON.stringify({schema:'deskbot.fantasy-inquiry-replay.v1',source:'isolated_engine_replay',model_calls:0,events,snapshots},null,2));
const evidence={schema:'deskbot.fantasy-inquiry-evidence.v1',source:'isolated_engine_replay',model_calls:0,
  note:'这是固定前态的规则回放，不是模型自行生活，也不是自然跨日记录。',
  snapshots:snapshots.map(({world,...s})=>s),events:events.map(e=>({task_id:e.task_id,at:e.at,title:e.title,root_outcome_id:`task:${e.task_id}`}))};
const client=resolve(arg('client')??'apps/jev-town-client/src/deskbot/fantasy-inquiry-evidence.json');mkdirSync(dirname(client),{recursive:true});writeFileSync(client,JSON.stringify(evidence));
console.log(JSON.stringify({snapshots:snapshots.length,events:events.length,model_calls:0,output,client}));
