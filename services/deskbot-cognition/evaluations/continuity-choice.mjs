// Small fictional failure-case regression. Prior choices are replayed as actual
// tasks, not re-generated; previous latent need/goal state is not reconstructed.
import {mkdirSync,readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {continuityFixture} from './continuity-fixtures.mjs';
import {policyChoice,settle} from './development-fixtures.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveActualResult,cognitiveRelevantKey} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {syncLivedMemory} from '../../../apps/deskbot-service/src/lived-memory.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {createCognitiveBudget} from '../../../apps/deskbot-service/src/cognitive-budget.mjs';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';
import {loadLlmConfiguration} from '../../../apps/deskbot-service/src/llm.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const source=JSON.parse(readFileSync(resolve(arg('source')),'utf8'));
const output=resolve(arg('output'));mkdirSync(output,{recursive:true});
const chosen=['water-calm:repeat-1','night-open:repeat-1','night-closed:repeat-1','care-hold:repeat-1','water-wind:repeat-1'];
const note='Five targeted fictional starts from stage 5. The first chosen task and its generated follow-up are replayed; the prior model latent goals/need state is not reconstructed. One new real plan and feedback per case. This is failure-case regression, not randomized A/B evidence, natural days or an overall success-rate estimate.';
function prepare(c){
 const first=c.turns[0],w=continuityFixture(c.actor,c.variant);
 policyChoice(w,first.compiled,first.task_id?.replace(/^cognitive:/,'')??`6A-prior:${c.id}`);
 const at=c.turns[1].at;advanceLivingResources(w,at,{force:true});w.clock.synced_at=at;syncLivedMemory(w,at);
 const life=w.cognition.actors[c.actor];life.followup=structuredClone(first.followup);life.pending=null;
 life.state={agent_id:c.actor,short_term_goal_entities:[{id:'own-prior-question',text:first.followup.question,goal_type:'short_term',origin:'residue',status:'active',created_step:0}]};
 return w;
}
const fixtures=chosen.map(id=>{const c=source.results.find(r=>r.id===id);if(!c?.turns[1])throw Error('baseline_missing:'+id);return {c,w:prepare(c)};});
writeFileSync(join(output,'outbound-fictional-contexts.json'),JSON.stringify(fixtures.map(({c,w})=>({id:c.id,context:cognitiveContext(w,c.actor,w.clock.synced_at)})),null,2));
if(!process.argv.includes('--real')){console.log(JSON.stringify({prepared:fixtures.length,paid_calls:0,note}));process.exit(0);}
const version=createHash('sha256').update(readFileSync(fileURLToPath(new URL('../life_worker.py',import.meta.url)))).update(readFileSync(fileURLToPath(new URL('../../../apps/deskbot-service/src/cognitive-continuation.mjs',import.meta.url)))).update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0,12);
const ledger=createSqlitePersistence({filename:join(output,'stage6a-budget.sqlite')});
const budget=createCognitiveBudget({persistence:ledger,configuration:loadLlmConfiguration({env:{DESKBOT_LLM_PROVIDER:'deepseek'},configPath:arg('config')}),namespace:'cognition-stage6a',approvalId:'stage6a-fictional-regression',approvalSource:'human:不限制金额，节省着用就行；继续下一步',scope:'6A bounded isolated fictional regression; exclude formal chat and sensor records',limitCny:null,maxCalls:80});
const bridge=createCognitionBridge({workerFile:'life_worker.py',timeoutMs:120000,maxFrames:60,mode:'real'});
const file=join(output,`choices-${version}.json`),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).results:[];
let processed=0,failures=0;
const save=()=>writeFileSync(file,JSON.stringify({schema:'deskbot.continuity.regression.v1',version,note,results,budget:budget.status()},null,2));
try{
 for(const {c,w} of fixtures){
  if(processed>=Number(arg('take')??5)||results.some(r=>r.id===c.id)||failures>=2)continue;
  const record={id:c.id,variant:c.variant,at:w.clock.synced_at,prior_followup:structuredClone(w.cognition.actors[c.actor].followup),baseline_choice:c.turns[1].compiled,baseline_result:c.turns[1].actual_result};
  const begin=performance.now();
  try{
   async function run(phase){
    const at=w.clock.synced_at,job=`6A:${version}:${c.id}:${phase}`;
    applyCognitiveMutation(w,{actor_id:c.actor,operation:'claim',phase,job_id:job,clock_scope:'isolated_test_clock'},at,job+':claim');
    const context=cognitiveContext(w,c.actor,at,phase);context.mode='real';
    if(phase==='feedback'){context.result=cognitiveActualResult(w,c.actor,at);context.action=w.cognition.actors[c.actor].pending.action;}
    else if(phase==='plan')record.time_view=structuredClone(context.continuation);
    let n=0;const proposal=await bridge.session(context,request=>{
     appendFileSync(join(output,'outbound-fictional-trace.jsonl'),JSON.stringify({case:c.id,phase,messages:request.messages})+'\n');
     return budget.complete(`${job}:${++n}`,{...request,phase,usage_scope:'isolated_test_clock'});
    });
    applyCognitiveMutation(w,{actor_id:c.actor,operation:phase,phase,job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,c.actor),...(phase==='feedback'?{result:context.result}:{})},at,job+':adopt');
   }
   if(cognitiveContext(w,c.actor,w.clock.synced_at).perceptions.length)await run('perceive');
   await run('plan');let life=w.cognition.actors[c.actor];record.compiled=structuredClone(life.compiled);record.reason=life.reason;
   const task=w.tasks.find(t=>t.task_id===life.pending?.task_id);if(task)settle(w,task);
   if(life.pending){record.actual_result=cognitiveActualResult(w,c.actor,w.clock.synced_at);await run('feedback');}
   life=w.cognition.actors[c.actor];record.followup=structuredClone(life.followup);record.task_id=task?.task_id??null;
  }catch(e){failures++;record.error=e.code??e.message;}
  record.latency_ms=Math.round(performance.now()-begin);results.push(record);processed++;save();
  console.log(JSON.stringify({id:c.id,operation:record.compiled?.operation,activity:record.compiled?.activity_id,success:record.actual_result?.success,error:record.error}));
 }
}finally{bridge.close();await budget.close();save();ledger.close();}
console.log(JSON.stringify({file,processed,failures}));
