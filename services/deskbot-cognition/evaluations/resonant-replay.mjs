// Authored isolated content replay. Every move and object change uses the live
// task executor; fixture weather and a test clock are explicitly not real life.
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {createPersistentWorld,getWorldMap} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {startActivityTask,startTravelTask,advanceWorldTask,applyRealTimeClock} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {findWorldPath} from '../../../apps/deskbot-service/src/world-map-content.mjs';
const arg=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const id='shaping-001',at='2026-10-11T01:00:00.000Z';
const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(at)});
api.ingest({event_id:'resonant-residents',type:'world.mutation',source:'fixture',character_id:id,payload:{action:'install_resident_life'}});
const w=api.get(),events=[],snapshots=[];w.living.inventories[id]={stock:{moss:2,trays:2},capacity:24};
function advance(at){advanceLivingResources(w,at,{force:true});applyRealTimeClock(w,at);}
function wait(hours){advance(new Date(Date.parse(w.clock.synced_at)+hours*3600000).toISOString());}
function finish(task){while(task.status==='running'){advance(task.due_at);advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},task.due_at);}if(task.status!=='completed')throw Error(`${task.title}:${task.failure_reason}`);events.push({task_id:task.task_id,title:task.title,at:task.finished_at,kind:task.kind,result:task.completion?.result});}
function travel(destination){if(w.protagonist.location_id===destination)return;const route=findWorldPath(w,w.protagonist.location_id,destination);if(!route)throw Error('No route');const result=startTravelTask(w,{eventId:`resonant-travel-${events.length}`,at:w.clock.synced_at,actorId:id,locationId:route[1],destinationId:destination});finish(w.tasks.find(t=>t.task_id===result.task_id));}
function perform(activity){const taskId=`resonant:${events.length}:${activity}`;startActivityTask(w,{actor_id:id,activity_id:activity,task_id:taskId},{eventId:taskId,at:w.clock.synced_at});finish(w.tasks.find(t=>t.task_id===taskId));}
function snapshot(key,title,detail,location,object){snapshots.push({key,title,detail,location,object,at:w.clock.synced_at,map:getWorldMap(w)});}
travel('spare-parts-house');perform('echo-craft-bell');travel('echo-waterside');perform('echo-set-bell');wait(.5);perform('echo-read-bell');
snapshot('water','水边第一次测记','在工坊耗用木料、扣件和布制作；沿通路带到水岸，架设后等半小时再测记。','echo-waterside','floating-frame');
// Explicit test weather intervention, never described as a model-created storm.
w.living.weather_window={from:w.clock.synced_at,until:'2026-10-12T00:00:00.000Z',wind_mps:12,rain_rate:0,humidity:.6,temperature_c:20,provider:'isolated-fixture'};wait(.5);perform('echo-read-bell');
snapshot('wind','风起之后','测试把风速设为每秒12米。回声受噪声影响，模型和动画都不能改写读数。','echo-waterside','floating-frame');
perform('echo-dampen-bell');wait(.5);perform('echo-read-bell');
snapshot('damped','给回声加一道挡风布','挡风布的状态来自实际操作。半小时后的再次测记可以与之前比较。','echo-waterside','floating-frame');
perform('echo-raise-bell');wait(.5);perform('echo-read-bell');
snapshot('raised','把浸水杯抬高一点','高度改变浸水深度与音调；图中挂杯的位置读取同一个状态。','echo-waterside','floating-frame');
travel('moss-sprout-garden');perform('glow-set-pair');wait(2);perform('glow-read-pair');perform('glow-press-study');perform('glow-take-study');travel('fog-lamp-square');
if(w.clock.synced_at<'2026-10-11T11:00:00.000Z')advance('2026-10-11T11:00:00.000Z');perform('night-mount-lantern');
snapshot('night','把今天的余辉带到广场','试验标本沿实际路线被携带和安装。灯保存原来的试验与测记出处，余辉会消耗。','fog-lamp-square','square-noticeboard');
wait(.5);perform('night-read-lantern');perform('night-close-shutter');
snapshot('closed','合上遮光片','灯熄下去，剩余蓄光仍然缓慢消退；不是到点自动补满的装饰灯。','fog-lamp-square','square-noticeboard');
wait(2);perform('night-open-shutter');
snapshot('reopened','过一会儿，再打开','经过两个测试小时，剩余的余辉照亮同一个灯盏。开合和消退有实际记录。','fog-lamp-square','square-noticeboard');
perform('night-pack-lantern');snapshot('packed','收好灯盏，回收托盘','耗尽或收起的作品能回收材料，给以后留下继续尝试的空间。','fog-lamp-square','square-noticeboard');
const evidence={schema:'deskbot.resonant-replay.v1',note:'固定规则回放，使用测试时间与虚构天气；不是模型自行选择或自然跨日生活。',model_calls:0,snapshots,events};
const output=resolve(arg('output')??'runtime/asamana-deployment/stage4b');mkdirSync(output,{recursive:true});writeFileSync(resolve(output,'engine-replay.json'),JSON.stringify(evidence,null,2));
const client=resolve(arg('client')??'apps/jev-town-client/src/deskbot/resonant-evidence.json');mkdirSync(dirname(client),{recursive:true});writeFileSync(client,JSON.stringify(evidence));
console.log(JSON.stringify({snapshots:snapshots.length,tasks:events.length,travel:events.filter(e=>e.kind==='travel').length,output}));
