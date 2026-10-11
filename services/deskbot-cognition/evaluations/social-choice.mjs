// All authored situations below are fictional; --real opts into the user's stage3–5 budget.
import {readFileSync,writeFileSync,mkdirSync,appendFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createPersistentWorld} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,settleCognitiveTask,cognitiveActualResult} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {advanceWorldTask,applyRealTimeClock} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {advanceSocialLife} from '../../../apps/deskbot-service/src/social-life.mjs';
import {deliverCognitiveSocialResults} from '../../../apps/deskbot-service/src/cognitive-social.mjs';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';
import {createCognitiveBudget} from '../../../apps/deskbot-service/src/cognitive-budget.mjs';
import {createModelUsage} from '../../../apps/deskbot-service/src/model-usage.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {loadLlmConfiguration} from '../../../apps/deskbot-service/src/llm.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('output')??'runtime/asamana-deployment/stage4a');mkdirSync(output,{recursive:true});
const own='shaping-001',other='wetland-grower-001',at='2026-10-11T02:00:00.000Z';
const cases=['ordinary','tired','prior-misgiving'].flatMap(variant=>[1,2,3].map(repeat=>({id:`${variant}:${repeat}`,variant,repeat})));
const proposal=(id,phase,extra={})=>({schema:'deskbot.cognitive-life.proposal.v3',actor_id:id,phase,state:{agent_id:id},memories:[],...extra});
function settle(w,task){while(task.status==='running'){advanceLivingResources(w,task.due_at,{force:true});applyRealTimeClock(w,task.due_at);advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},task.due_at);}settleCognitiveTask(w,task,w.clock.synced_at);}
function seed(c){
 const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(at)});
 api.ingest({event_id:'residents',type:'world.mutation',source:'fixture',character_id:own,payload:{action:'install_resident_life'}});
 const w=api.get();w.protagonist.location_id='moss-sprout-garden';for(const p of w.npcs)p.location_id='moss-sprout-garden';
 w.social.next_offer_at='2099-01-01T00:00:00Z';for(const s of Object.values(w.autonomy.actors)){s.paused=true;s.plan=null;}
 w.cognition={actors:{},epoch:at,clock_scope:'isolated_test_clock'};
 // Authored invitation is submitted through the same delivery contract, not a model decision.
 const ctx=cognitiveContext(w,own,at),compiled={operation:'share',receiver_indices:[ctx.capabilities.share.receivers.findIndex(r=>r.actor_id===other)+1],message:'',message_parts:[{kind:'question',text:'现在方便一起聊聊凝光苔吗？如果想先做自己的事也没关系。'}],social:{operation:'invite',option_id:'visit'},reason:'固定实验前史',title:'商量聊一会儿'};
 applyCognitiveMutation(w,{actor_id:own,operation:'claim',phase:'plan',job_id:'authored-invitation'},at,'fixture:claim');
 applyCognitiveMutation(w,{actor_id:own,operation:'plan',phase:'plan',job_id:'authored-invitation',relevant_key:cognitiveRelevantKey(w,own),proposal:proposal(own,'plan',{compiled,action:{agent_id:own}})},at,'fixture:adopt');
 settle(w,w.tasks.find(t=>t.task_id===w.cognition.actors[own].pending.task_id));
 const result=cognitiveActualResult(w,own,w.clock.synced_at);applyCognitiveMutation(w,{actor_id:own,operation:'claim',phase:'feedback',job_id:'fixture-feedback'},w.clock.synced_at,'fixture:fclaim');
 applyCognitiveMutation(w,{actor_id:own,operation:'feedback',phase:'feedback',job_id:'fixture-feedback',result,proposal:proposal(own,'feedback',{followup:{status:'continue',question:'等苔团自己回复这次邀请',reason:'仅送达，尚未答应',delay_hours:1}})},w.clock.synced_at,'fixture:fadopt');
 w.autonomy.actors[other].energy=c.variant==='tired'?.1:.85;
 w.autonomy.actors[other].appetite=.15;
 if(c.variant==='prior-misgiving'){
  const content='隔离角色前史：上次闲聊拖得太久，我错过自己安排的安静测记。这次希望先保留独处时间，晚些再商量见面。';
  w.cognition.actors[other].memories=[{id:'fictional-personal-preference',root_outcome_id:'fixture:prior-misgiving',payload:{agent_id:other,stream:'experiential',kind:'experience',raw_content:content,stored_content:content,importance:.8,step:0,source_ids:[]}}];
 }
 // This canary belongs solely to a non-participant's private memory.
 w.cognition.actors['lamp-keeper-001']={actor_id:'lamp-keeper-001',private_diary:'PRIVATE_CANARY_LANTERN_71',memories:[],state:{}};
 return w;
}
writeFileSync(join(output,'outbound-social-fixtures.json'),JSON.stringify(cases.map(c=>({id:c.id,context:cognitiveContext(seed(c),other,seed(c).clock.synced_at)})),null,2));
if(!process.argv.includes('--real')){console.log(JSON.stringify({prepared:cases.length,paid_calls:0}));process.exit(0);}
const ledger=createSqlitePersistence({filename:join(output,'../stages3-5-budget.sqlite')}),usage=createModelUsage({persistence:ledger});
const budget=createCognitiveBudget({persistence:ledger,configuration:loadLlmConfiguration({env:{DESKBOT_LLM_PROVIDER:'deepseek'},configPath:arg('config')}),namespace:'cognition-stage3-5',approvalId:'stages3-5',approvalSource:'human:不限制金额，节省着用就行',scope:'Stages 3–5; isolated fictional characters, world, inputs and experiment memories; exclude formal chat and sensor records',limitCny:null,maxCalls:null,onUsage:usage.record});
const version=createHash('sha256').update(readFileSync(fileURLToPath(new URL('../life_worker.py',import.meta.url)))).update(readFileSync(fileURLToPath(new URL('../input_refraction.py',import.meta.url)))).update(readFileSync(fileURLToPath(new URL('../relationship_review.py',import.meta.url)))).update(readFileSync(fileURLToPath(new URL('../../../apps/deskbot-service/src/cognitive-social.mjs',import.meta.url)))).update(readFileSync(fileURLToPath(import.meta.url))).digest('hex').slice(0,12);
const file=join(output,`choices-${version}.json`),results=existsSync(file)?JSON.parse(readFileSync(file,'utf8')).results:[],bridge=createCognitionBridge({workerFile:'life_worker.py',timeoutMs:180000,maxFrames:60,mode:'real'});
let calls=0,failures=0,processed=0;
const save=()=>writeFileSync(file,JSON.stringify({version,results,budget:budget.status(),limitations:'Authored delivered invitation; two model turns; isolated test clock. Responding freely is allowed, agreement rate is not a success metric.'},null,2));
try{
 for(const c of cases){
  if(results.some(r=>r.id===c.id)||arg('case')&&arg('case')!==c.id||arg('variant')&&arg('variant')!==c.variant||processed>=Number(arg('take')??3)||failures>=2)continue;
  const w=seed(c),episode={...c,turns:[]};
  try{
   for(const [i,id]of [other,own].entries()){
    const record={actor_id:id,turn:i+1,at:w.clock.synced_at};episode.turns.push(record);
    async function run(phase){
     const now=w.clock.synced_at,job=`4a:${version}:${c.id}:${i}:${phase}`;
     applyCognitiveMutation(w,{actor_id:id,operation:'claim',phase,job_id:job,max_plans:4},now,job+':claim');
     const context=cognitiveContext(w,id,now,phase);context.mode='real';
     if(phase==='feedback'){context.result=cognitiveActualResult(w,id,now);context.action=w.cognition.actors[id].pending.action;}
     const serialized=JSON.stringify(context);if(serialized.includes('PRIVATE_CANARY_LANTERN_71'))throw Error('private_context_leak');
     let n=0;const value=await bridge.session(context,request=>{
      if(++calls>90)throw Error('batch_call_guard');if(JSON.stringify(request).includes('PRIVATE_CANARY_LANTERN_71'))throw Error('private_prompt_leak');
      appendFileSync(join(output,'outbound-social-trace.jsonl'),JSON.stringify({case:c.id,version,actor:id,phase,messages:request.messages})+'\n');
      return budget.complete(`${job}:${++n}`,{...request,phase,usage_scope:'isolated_test_clock'});
     });
     applyCognitiveMutation(w,{actor_id:id,operation:phase,phase,job_id:job,proposal:value,relevant_key:context.relevant_key,...(phase==='feedback'?{result:context.result}:{})},now,job+':adopt');
    }
    if(cognitiveContext(w,id,w.clock.synced_at).perceptions.length)await run('perceive');await run('plan');
    let life=w.cognition.actors[id];record.compiled=structuredClone(life.compiled);
    const task=w.tasks.find(t=>t.task_id===life.pending?.task_id);if(task)settle(w,task);
    if(life.pending){record.result=cognitiveActualResult(w,id,w.clock.synced_at);await run('feedback');}
    record.sent_message=task?.cognitive_message?.text??null;record.followup=structuredClone(w.cognition.actors[id].followup);record.contract=structuredClone(w.social.commitments[0]);
    console.log(JSON.stringify({case:c.id,actor:id,operation:record.compiled.operation,social:record.compiled.social,status:record.contract.status}));
   }
   for(let i=0;i<360&&['accepted','meeting','working'].includes(w.social.commitments[0].status);i++){
    const now=new Date(Date.parse(w.clock.synced_at)+60000).toISOString();advanceLivingResources(w,now,{force:true});applyRealTimeClock(w,now);
    for(const task of w.tasks.filter(t=>t.status==='running'&&t.due_at<=now))advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},now);
    advanceSocialLife(w,now,{eventId:`social-eval:${now}`,reservedActors:[own,other]});deliverCognitiveSocialResults(w,now);
   }
   episode.contract=structuredClone(w.social.commitments[0]);episode.final_world=w;
  }catch(error){failures++;episode.error=error.code??error.message;episode.message=error.message;console.log(JSON.stringify({case:c.id,error:episode.error,message:error.message}));}
  results.push(episode);processed++;save();
 }
}finally{bridge.close();await budget.close();save();ledger.close();}
console.log(JSON.stringify({report:file,processed,calls,failures}));
