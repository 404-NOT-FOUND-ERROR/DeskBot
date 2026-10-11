// Paid only with --real. Every world and memory below is an isolated authored fixture.
import {mkdirSync,readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createPersistentWorld} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {startActivityTask,advanceWorldTask} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,cognitiveActualResult,settleCognitiveTask} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';
import {createCognitiveBudget} from '../../../apps/deskbot-service/src/cognitive-budget.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {createModelUsage} from '../../../apps/deskbot-service/src/model-usage.mjs';
import {loadLlmConfiguration} from '../../../apps/deskbot-service/src/llm.mjs';
import {formedCareFixture,arrange,atDay} from './development-fixtures.mjs';
import {syncLivedMemory} from '../../../apps/deskbot-service/src/lived-memory.mjs';
import {cognitiveOpportunityWindow} from '../../../apps/deskbot-service/src/cognitive-development.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('output')??'runtime/asamana-deployment/stage5');mkdirSync(output,{recursive:true});
const actors=['shaping-001','wetland-grower-001','lamp-keeper-001'],initial='2026-10-11T02:00:00.000Z';
function settle(w,task){
 while(task.status==='running'){
  const due=task.due_at;advanceLivingResources(w,due,{force:true});w.clock.synced_at=due;
  advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},due);
 }
 settleCognitiveTask(w,task,w.clock.synced_at);
}
function seed(actor,variant){
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
const cases=Array.from({length:2},(_,repeat)=>['water-calm','water-wind','night-open','night-closed','formed-care','care-hold'].map(variant=>({id:`${variant}:repeat-${repeat+1}`,actor:'shaping-001',variant,repeat:repeat+1}))).flat();
writeFileSync(join(output,'outbound-development-fixtures.json'),JSON.stringify(cases.map(c=>({id:c.id,context:cognitiveContext(seed(c.actor,c.variant),c.actor,seed(c.actor,c.variant).clock.synced_at)})),null,2));
if(!process.argv.includes('--real')){console.log(JSON.stringify({prepared:cases.length,paid_calls:0}));process.exit(0);}
const ledger=createSqlitePersistence({filename:join(output,'../stages3-5-budget.sqlite')}),usage=createModelUsage({persistence:ledger});
const budget=createCognitiveBudget({persistence:ledger,configuration:loadLlmConfiguration({env:{DESKBOT_LLM_PROVIDER:'deepseek'},configPath:arg('config')}),namespace:'cognition-stage3-5',approvalId:'stages3-5',approvalSource:'human:不限制金额，节省着用就行',scope:'Stages 3–5; isolated fictional characters, world, inputs and experiment memories; exclude formal chat and sensor records',limitCny:null,maxCalls:null,onUsage:usage.record});
const version=createHash('sha256').update(readFileSync(fileURLToPath(new URL('../life_worker.py',import.meta.url)))).update(readFileSync(fileURLToPath(new URL('../../../apps/deskbot-service/src/resonant-life.mjs',import.meta.url)))).update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0,12);
const file=join(output,`choices-${version}.json`),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).results:[],bridge=createCognitionBridge({workerFile:'life_worker.py',timeoutMs:180000,maxFrames:60,mode:'real'});
let calls=0,failures=0,processed=0;
const save=()=>writeFileSync(file,JSON.stringify({version,results,budget:budget.status(),usage:usage.status(),limitations:'Twelve authored starts, two real model choices each. Follow-ups generated after actual first task are revisited in test time. Resource and prior interest fixtures are explicitly authored; not natural multi-day life.'},null,2));
try{
 for(const c of cases){
  if(results.some(r=>r.id===c.id)||arg('case')&&arg('case')!==c.id||processed>=Number(arg('take')??6)||failures>=2)continue;
  const w=seed(c.actor,c.variant),episode={...c,turns:[]},started=performance.now();
  try{
   for(let turn=1;turn<=2;turn++){
    const record={turn,at:w.clock.synced_at,prior_followup:structuredClone(w.cognition.actors[c.actor].followup??null),opportunity:cognitiveOpportunityWindow(w,c.actor,w.clock.synced_at)};episode.turns.push(record);
    async function run(phase){
     const at=w.clock.synced_at,job=`5:${version}:${c.id}:${turn}:${phase}`;
     applyCognitiveMutation(w,{actor_id:c.actor,operation:'claim',phase,job_id:job,clock_scope:'isolated_test_clock'},at,job+':claim');
     const context=cognitiveContext(w,c.actor,at,phase);context.mode='real';
     if(phase==='feedback'){context.result=cognitiveActualResult(w,c.actor,at);context.action=w.cognition.actors[c.actor].pending.action;}
     let n=0;const proposal=await bridge.session(context,request=>{
      if(++calls>400)throw Error('batch_guard');appendFileSync(join(output,'outbound-development-trace.jsonl'),JSON.stringify({case:c.id,version,turn,phase,messages:request.messages})+'\n');
      return budget.complete(`${job}:${++n}`,{...request,phase,usage_scope:'isolated_test_clock'});
     });
     if(c.variant==='rack-race'&&turn===1&&phase==='plan'){w.living.objects['seedling-rack'].condition=.3;record.fixture_intervention='模型思考期间，隔离设施条件改为损坏；不代表自然世界事件';}
     applyCognitiveMutation(w,{actor_id:c.actor,operation:phase,phase,job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,c.actor),...(phase==='feedback'?{result:context.result}:{})},at,job+':adopt');
    }
    if(turn===1)await run('perceive');await run('plan');
    let life=w.cognition.actors[c.actor];record.compiled=structuredClone(life.compiled);record.reason=life.reason;
    const task=w.tasks.find(t=>t.task_id===life.pending?.task_id);record.task_id=task?.task_id??null;
    if(task)settle(w,task);syncLivedMemory(w,w.clock.synced_at);
    if(life.pending){record.actual_result=cognitiveActualResult(w,c.actor,w.clock.synced_at);await run('feedback');}
    life=w.cognition.actors[c.actor];record.followup=structuredClone(life.followup);record.activity_id=task?.activity_id??null;
    record.fantasy_result=task?.completion?.result?.fantasy_result??null;
    let later=life.followup?.next_review_at??new Date(Date.parse(w.clock.synced_at)+3600000).toISOString();
    // Match the continuous scheduler's awake-window policy, not wall-clock acceleration in production.
    const hour=(new Date(later).getUTCHours()+8)%24;if(hour>=23||hour<6)later=new Date(Date.parse(later)+(hour>=23?33-hour:9-hour)*3600000).toISOString();
    advanceLivingResources(w,later,{force:true});w.clock.synced_at=later;syncLivedMemory(w,later);
    console.log(JSON.stringify({case:c.id,turn,operation:record.compiled.operation,activity:record.activity_id,success:record.actual_result?.success}));save();
   }
   episode.latency_ms=Math.round(performance.now()-started);episode.final_world=w;
  }catch(error){failures++;episode.error=error.code??error.message;episode.message=error.message;console.log(JSON.stringify({case:c.id,error:episode.error}));}
  results.push(episode);processed++;save();
 }
}finally{bridge.close();await budget.close();save();ledger.close();}
console.log(JSON.stringify({report:file,calls,failures,processed}));
