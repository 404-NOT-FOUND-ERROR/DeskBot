// Three repeats of each matched front state. No formal data is loaded.
import {mkdirSync,readFileSync,writeFileSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';
import {createPersistentWorld} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {createCognitiveBudget} from '../../../apps/deskbot-service/src/cognitive-budget.mjs';
import {loadLlmConfiguration} from '../../../apps/deskbot-service/src/llm.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {createModelUsage} from '../../../apps/deskbot-service/src/model-usage.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveRelevantKey,cognitiveDialogueContext} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {cognitiveSourceCases,caseSource} from '../../../apps/deskbot-service/test/fixtures/cognitive-source-cases.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('output')??'runtime/asamana-deployment/stage3a');mkdirSync(output,{recursive:true});
const at='2026-10-11T02:00:00.000Z',actor='shaping-001',now=()=>new Date(at),sources=[0,8,6].map(i=>cognitiveSourceCases[i]);
const p=createSqlitePersistence({filename:join(output,'pairs-fixture.sqlite'),now}),world=createPersistentWorld({persistence:p,now,timeMode:'realtime'});
if(!world.get().npcs.some(n=>n.npc_id==='wetland-grower-001'))world.ingest({event_id:'fixture-residents',type:'world.mutation',source:'fixture',character_id:actor,payload:{action:'install_resident_life'}});
const base=world.get();p.close();base.protagonist.location_id='moss-sprout-garden';base.npcs=base.npcs.filter(n=>['wetland-grower-001','lamp-keeper-001'].includes(n.npc_id));
for(const npc of base.npcs)npc.location_id='moss-sprout-garden';base.living.objects['garden-bed'].moisture=.45;base.tasks=[];base.refraction={records:[]};
base.cognition={schema:'deskbot.cognitive-life.v2',epoch:at,actors:{},clock_scope:'isolated_test_clock'};
function seed(entry,on){
 const w=structuredClone(base),s=caseSource(entry,at);if(!on)return w;
 if(s.sender_is_agent)w.cognition.actors[actor]={actor_id:actor,version:0,state:{},memories:[],history:[],plan_count:0,enabled:false,
  inbox:[{task_id:`fixture:${entry.id}`,message_id:s.id,sender_id:s.sender_id,sender_name:s.sender_name,text:s.content,at,root_outcome_id:`fixture:${entry.id}`}]};
 else w.refraction.records=[{id:s.id,category:entry.category==='user'?'dialogue':entry.category,source_label:s.sender_name,text:s.content,observed_at:at,received_at:at,expires_at:s.expires_at,attested:true,freshness:'fresh',status:'observed'}];
 return w;
}
writeFileSync(join(output,'outbound-choice-pairs.json'),JSON.stringify(sources.flatMap(entry=>[false,true].map(on=>({case_id:entry.id,input_on:on,context:cognitiveContext(seed(entry,on),actor,at)}))),null,2));
if(!process.argv.includes('--real')){console.log(JSON.stringify({prepared:18,paid_calls:0}));process.exit(0);}
const ledger=createSqlitePersistence({filename:join(output,'../stages3-5-budget.sqlite')}),modelUsage=createModelUsage({persistence:ledger});
const budget=createCognitiveBudget({persistence:ledger,configuration:loadLlmConfiguration({env:{DESKBOT_LLM_PROVIDER:'deepseek'},configPath:arg('config')}),
 namespace:'cognition-stage3-5',approvalId:'stages3-5',approvalSource:'human:不限制金额，节省着用就行',scope:'Stages 3–5; isolated fictional characters, world, inputs and experiment memories; exclude formal chat and sensor records',limitCny:null,maxCalls:null,onUsage:modelUsage.record});
const version=createHash('sha256').update(readFileSync(fileURLToPath(new URL('../input_refraction.py',import.meta.url)))).update(readFileSync(fileURLToPath(new URL('../life_worker.py',import.meta.url)))).update(readFileSync(fileURLToPath(new URL('../../../apps/deskbot-service/src/cognitive-budget.mjs',import.meta.url)))).digest('hex').slice(0,12);
const file=join(output,`pairs-${version}.json`),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).results:[],bridge=createCognitionBridge({workerFile:'life_worker.py',timeoutMs:180000,maxFrames:45,mode:'real'});
let calls=0,failures=0,processed=0;
const checkpoint=()=>{writeFileSync(file,JSON.stringify({version,at,repeats:3,results,budget:budget.status(),usage:modelUsage.status(),
 limitations:'Small matched-state screening, not significance testing. Different action is optional; inspect question, cause and actual task together.'},null,2));};
try{
 for(const entry of sources)for(let repeat=1;repeat<=3;repeat++)for(const on of [false,true]){
  const key=`${entry.id}:${repeat}:${on?'on':'off'}`;if(results.some(r=>r.id===key))continue;
  if(arg('case')&&entry.id!==arg('case')||arg('repeat')&&repeat!==Number(arg('repeat'))||arg('input')&&(on?'on':'off')!==arg('input'))continue;
  if(processed>=Number(arg('take')??18)||failures>=2)continue;
  const w=seed(entry,on),started=performance.now(),callStart=calls;
  try{
   for(const phase of on?['perceive','plan']:['plan']){
    const job=`stage3a-pair:${version}:${key}:${phase}`;
    applyCognitiveMutation(w,{actor_id:actor,operation:'claim',phase,job_id:job,clock_scope:'isolated_test_clock'},at,`${job}:claim`);
    const context=cognitiveContext(w,actor,at,phase);context.mode='real';let n=0;
    const proposal=await bridge.session(context,request=>{if(++calls>160)throw Error('experiment_batch_call_guard');
     appendFileSync(join(output,'outbound-choice-trace.jsonl'),JSON.stringify({id:key,version,phase,scene:request.scene,messages:request.messages})+'\n');
     return budget.complete(`${job}:${++n}`,{...request,phase,usage_scope:'isolated_test_clock'});});
    applyCognitiveMutation(w,{actor_id:actor,operation:phase,job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,actor)},at,`${job}:adopt`);
   }
   const life=w.cognition.actors[actor],task=w.tasks.find(t=>t.origin==='cognitive_life');
   results.push({id:key,source_id:entry.id,group:entry.group,repeat,input_on:on,calls:calls-callStart,latency_ms:Math.round(performance.now()-started),
    compiled:life.compiled,reason:life.reason,intent:life.intent,goals:life.state.short_term_goal_entities,interpretations:life.interpretations??[],
    dialogue:cognitiveDialogueContext(w,actor),task:task?{task_id:task.task_id,activity_id:task.activity_id,life_action:task.life_action,title:task.title,root_outcome_id:task.root_outcome_id,life_source_ids:task.life_source_ids,reservation:task.reservation}:null,
    no_identity_change:JSON.stringify(w.protagonist)===JSON.stringify(base.protagonist),no_invented_practice:JSON.stringify(w.memory?.development)===JSON.stringify(base.memory?.development)});
   console.log(JSON.stringify({id:key,operation:life.compiled.operation,source_ids:life.compiled.source_ids,calls:calls-callStart}));
  }catch(e){failures++;results.push({id:key,source_id:entry.id,group:entry.group,repeat,input_on:on,error:e.code??e.message,message:e.message,calls:calls-callStart});console.log(JSON.stringify({id:key,error:e.code??e.message,message:e.message}));}
  processed++;checkpoint();
 }
}finally{bridge.close();await budget.close();checkpoint();ledger.close();}
console.log(JSON.stringify({report:file,processed,calls,failures}));
