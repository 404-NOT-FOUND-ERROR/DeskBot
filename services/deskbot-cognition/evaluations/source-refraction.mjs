// Explicit isolated experiment. Default prepares previews only; --real makes paid calls.
import {mkdirSync,writeFileSync,readFileSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';
import {createPersistentWorld} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {createCognitiveBudget} from '../../../apps/deskbot-service/src/cognitive-budget.mjs';
import {loadLlmConfiguration} from '../../../apps/deskbot-service/src/llm.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveRelevantKey} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {cognitiveSourceCases,caseSource} from '../../../apps/deskbot-service/test/fixtures/cognitive-source-cases.mjs';

const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('output')??'runtime/asamana-deployment/stage3a'),real=process.argv.includes('--real');mkdirSync(output,{recursive:true});
const at='2026-10-11T02:00:00.000Z',now=()=>new Date(at),actor='shaping-001';
const fixtureStore=createSqlitePersistence({filename:join(output,'fictional-fixture.sqlite'),now});
const fixture=createPersistentWorld({persistence:fixtureStore,timeMode:'realtime',now});
if(!fixture.get().npcs.some(n=>n.npc_id==='wetland-grower-001'))fixture.ingest({event_id:'fixture-residents',type:'world.mutation',source:'fixture',character_id:actor,payload:{action:'install_resident_life'}});
const initial=fixture.get();fixtureStore.close();initial.protagonist.location_id='moss-sprout-garden';
initial.npcs=initial.npcs.filter(n=>['wetland-grower-001','lamp-keeper-001'].includes(n.npc_id));for(const npc of initial.npcs)npc.location_id='moss-sprout-garden';
initial.living.objects['garden-bed'].moisture=.45;initial.cognition={schema:'deskbot.cognitive-life.v2',epoch:at,actors:{},clock_scope:'isolated_test_clock'};
initial.refraction={records:[]};initial.tasks=[];
function seed(entry){
 const w=structuredClone(initial),s=caseSource(entry,at);
 if(entry.category==='agent')w.cognition.actors[actor]={actor_id:actor,version:0,state:{},memories:[],history:[],plan_count:0,enabled:false,
  inbox:[{task_id:`fixture:${entry.id}`,message_id:s.id,sender_id:s.sender_id,sender_name:s.sender_name,text:s.content,at,root_outcome_id:`fixture:${entry.id}`} ]};
 else w.refraction.records=[{id:s.id,category:entry.category==='user'?'dialogue':entry.category,source_label:s.sender_name,text:s.content,observed_at:at,received_at:at,expires_at:s.expires_at,attested:true,freshness:'fresh',status:'observed'}];
 return w;
}
const contexts=cognitiveSourceCases.map(entry=>({case_id:entry.id,context:cognitiveContext(seed(entry),actor,at,'interpret')}));
writeFileSync(join(output,'outbound-fixture-contexts.json'),JSON.stringify({scope:'isolated fictional characters, sources and memories only',contexts},null,2));
writeFileSync(join(output,'prelabelled-cases.json'),JSON.stringify(cognitiveSourceCases,null,2));
if(!real){console.log(JSON.stringify({prepared:contexts.length,paid_calls:0,output}));process.exit(0);}
const config=loadLlmConfiguration({env:{DESKBOT_LLM_PROVIDER:'deepseek'},configPath:arg('config')});
const ledger=createSqlitePersistence({filename:join(output,'../stages3-5-budget.sqlite')});
const budget=createCognitiveBudget({persistence:ledger,configuration:config,namespace:'cognition-stage3-5',approvalId:'stages3-5',
 approvalSource:'human:不限制金额，节省着用就行',scope:'Stages 3–5; isolated fictional characters, world, inputs and experiment memories; exclude formal chat and sensor records',limitCny:null,maxCalls:null});
const bridge=createCognitionBridge({workerFile:'life_worker.py',timeoutMs:180000,maxFrames:45,mode:'real'});
const version=createHash('sha256').update(readFileSync(fileURLToPath(new URL('../input_refraction.py',import.meta.url)))).update(JSON.stringify(cognitiveSourceCases)).digest('hex').slice(0,12);
const file=join(output,`labels-${version}.json`),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).results:[];
let calls=0,processed=0,failures=0;
const checkpoint=()=>{const scored=results.filter(r=>!r.error);const groups=Object.fromEntries([...new Set(cognitiveSourceCases.map(c=>c.group))].map(g=>{const rows=results.filter(r=>r.group===g);return [g,{total:rows.length,correct:rows.filter(r=>r.correct).length}];}));
 const status=budget.status();writeFileSync(file,JSON.stringify({version,at,clock_scope:'isolated_test_clock',label_policy:'expected effects fixed before calling; labels not sent',results,
  score:{attempted:results.length,total:32,valid:scored.length,correct:results.filter(r=>r.correct).length,groups},budget:status},null,2));
 writeFileSync(join(output,'latest-labels.json'),JSON.stringify({file,version,completed:results.length,budget_upper_cny:status.used_upper_cny},null,2));};
try{
 for(const entry of cognitiveSourceCases){
  if(results.some(r=>r.id===entry.id))continue;
  if(processed>=Number(arg('take')??32)||failures>=2)break;
  const w=seed(entry),job=`stage3a-label-${version}-${entry.id}`;
  applyCognitiveMutation(w,{actor_id:actor,operation:'claim',phase:'interpret',job_id:job,clock_scope:'isolated_test_clock'},at,`${job}:claim`);
  const context=cognitiveContext(w,actor,at,'interpret');context.mode='real';let call=0;const started=performance.now();
  try{
   const proposal=await bridge.session(context,request=>{if(++calls>80)throw Error('experiment_batch_call_guard');
    appendFileSync(join(output,'outbound-model-trace.jsonl'),JSON.stringify({case_id:entry.id,version,scene:request.scene,messages:request.messages})+'\n');
    return budget.complete(`${job}:${++call}`,request);});
   const adoption=applyCognitiveMutation(w,{actor_id:actor,operation:'interpret',job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,actor)},at,`${job}:adopt`);
   const item=adoption.interpretations[0],correct=item?.effect===entry.expected_effect;
   results.push({id:entry.id,group:entry.group,expected:entry.expected_effect,correct,interpretation:item,calls:call,latency_ms:Math.round(performance.now()-started),tasks_after:w.tasks.length,world_unchanged:JSON.stringify(w.living)===JSON.stringify(initial.living)});
   console.log(JSON.stringify({case:entry.id,group:entry.group,effect:item?.effect,correct,calls:call}));
  }catch(e){failures++;results.push({id:entry.id,group:entry.group,correct:false,error:e.code??e.message,calls:call});console.log(JSON.stringify({case:entry.id,error:e.code??e.message,message:e.message}));}
  processed++;checkpoint();
 }
}finally{bridge.close();await budget.close();checkpoint();ledger.close();}
console.log(JSON.stringify({report:file,processed,calls,correct:results.filter(r=>r.correct).length,total:results.length}));
