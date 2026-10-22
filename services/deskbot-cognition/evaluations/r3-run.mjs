// Preparation is free. Paid runs require --real; --replay never falls back to a provider.
import {mkdirSync,readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';
import {createCognitiveBudget} from '../../../apps/deskbot-service/src/cognitive-budget.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {loadLlmConfiguration} from '../../../apps/deskbot-service/src/llm.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,cognitiveActualResult} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {advanceAutonomousLife,applyLifeChoice} from '../../../apps/deskbot-service/src/autonomous-life.mjs';
import {lifeChoicePrompt} from '../../../apps/deskbot-service/src/life-choice.mjs';
import {cases,personaCases,fixture,hash,plus,tick,settle,digest,opportunity} from './r3-fixtures.mjs';
import {interestCases,interestFixture} from './r3-interest-fixtures.mjs';

const arg=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const dir=resolve(arg('output')??'../runtime/r3-20261020'),real=process.argv.includes('--real'),replay=process.argv.includes('--replay');
if(real&&replay)throw Error('choose_real_or_replay');
const turns=Number(arg('turns')??2),maxCalls=Number(arg('max-calls')??120);
if(!Number.isSafeInteger(turns)||turns<2||turns>6)throw Error('turns_must_be_2_to_6');
if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>900)throw Error('max_calls_must_be_1_to_900');
mkdirSync(dir,{recursive:true});
const base=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const relevant=['services/deskbot-cognition/life_worker.py','services/deskbot-cognition/evaluations/r3-fixtures.mjs',
  'apps/deskbot-service/src/cognitive-life-state.mjs','apps/deskbot-service/src/cognitive-continuity.mjs',
  'apps/deskbot-service/src/cognitive-development.mjs','apps/deskbot-service/src/waylight-life.mjs',
  'apps/deskbot-service/src/cognitive-social.mjs',
  'apps/deskbot-service/src/cognitive-issue-evidence.mjs','services/deskbot-cognition/context_projection.py',
  'apps/deskbot-service/src/cognitive-budget.mjs',
  'apps/deskbot-service/src/cognitive-continuation.mjs','apps/deskbot-service/src/cognitive-schedule.mjs',
  'apps/deskbot-service/src/social-life.mjs','services/deskbot-cognition/continuation_contract.py',
  'apps/deskbot-service/src/autonomous-life.mjs','apps/deskbot-service/src/life-choice.mjs'];
const interests=process.argv.includes('--interests');
if(interests)relevant.push('services/deskbot-cognition/evaluations/r3-interest-fixtures.mjs','services/deskbot-cognition/evaluations/development-fixtures.mjs');
const runnerHash=hash(readFileSync(fileURLToPath(import.meta.url),'utf8'));
const version=hash({files:relevant.map(p=>[p,hash(readFileSync(join(base,p),'utf8'))]),runner:runnerHash,turns}).slice(0,12);
const runDir=join(dir,version);mkdirSync(runDir,{recursive:true});mkdirSync(join(runDir,'calls'),{recursive:true});mkdirSync(join(runDir,'worlds'),{recursive:true});
const frozenPath=join(runDir,'frozen-sources.json.gz');
if(!existsSync(frozenPath))writeFileSync(frozenPath,gzipSync(JSON.stringify(Object.fromEntries(
  [...relevant,'services/deskbot-cognition/evaluations/r3-run.mjs','services/deskbot-cognition/evaluations/r3-interest-fixtures.mjs']
    .map(p=>[p,readFileSync(join(base,p),'utf8')])))));
const seed=interests?interestFixture:fixture;
const select=interests?interestCases:process.argv.includes('--personas')?personaCases:cases;
const all=select.map(c=>{const w=seed(c);return {...c,start_hash:hash(w),context:cognitiveContext(w,c.actor,w.clock.synced_at)};});
writeFileSync(join(runDir,interests?'manifest-interest.json':process.argv.includes('--personas')?'manifest-personas.json':'manifest.json'),JSON.stringify({version,files:relevant,runner_hash:runnerHash,fixtures:all.map(({context,...c})=>c),scope:'Only authored fixtures; no production database',turns},null,2));
writeFileSync(join(runDir,process.argv.includes('--personas')?'outbound-personas.json.gz':'outbound-fixtures.json.gz'),gzipSync(JSON.stringify(all)));
if(!real&&!replay&&!process.argv.includes('--rules')){console.log(JSON.stringify({version,prepared:all.length,runDir,paid_calls:0}));process.exit(0);}
if(real){
 const path=arg('validation');
 if(!path||!existsSync(path))throw Error('paid_run_requires_local_validation_report');
 const checked=JSON.parse(readFileSync(path,'utf8'));
 if(checked.version!==version||!['backend','python','frontend'].every(k=>checked.checks?.[k]?.passed===true))
  throw Error('validation_not_for_current_frozen_version');
 if(!Array.isArray(checked.cases)||!checked.cases.length)throw Error('validation_requires_small_case_list');
 const selected=(arg('cases')??'').split(',').filter(Boolean);
 const selectedArms=(arg('arms')??'cognition,bounded,rules').split(',');
 if(!selected.length||selected.some(id=>!checked.cases.includes(id))||maxCalls>checked.max_calls
  ||selectedArms.some(arm=>!checked.arms?.includes(arm)))
  throw Error('paid_batch_exceeds_validated_scope');
}
const arms=(arg('arms')??(real||replay?'cognition,bounded,rules':'rules')).split(',');
if(arms.some(a=>!['cognition','bounded','rules'].includes(a)))throw Error('unknown_arm');
const ledger=real?createSqlitePersistence({filename:join(runDir,'calls.sqlite')}):null;
const budget=real?createCognitiveBudget({persistence:ledger,
  configuration:loadLlmConfiguration({env:{DESKBOT_LLM_PROVIDER:'deepseek'},configPath:arg('config')??join(base,'config/llm_config.json')}),
  namespace:'r3-cognition',approvalId:'r3',approvalSource:'human:不限制金额，节省着用就行；开始R3',
  scope:'R3 isolated fictional characters, world, inputs and experiment memories only; exclude formal chats and sensors',
  limitCny:null,maxCalls}):null;
const bridge=createCognitionBridge({workerFile:'life_worker.py',timeoutMs:180000,maxFrames:60,mode:'real'});
const file=join(runDir,replay?'replay.json':'results.json');
const report=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{version,results:[],limitations:[
  '声明的虚构起点与模拟推进，不是自然跨日观察；其他居民保持在初始位置。',
  '比较三条产品路径：旧计划可能包含多步骤，新认知每轮执行一个当前能力；不直接比较任务条数。',
  '邀请经 agent 来源接入口送达，未预先建立双方承诺；初始库存明确编排。',
  '自动判据只是筛查；合理改法与关键事实错误需要逐例语义审查。',
]};
function save(){
  if(budget)report.budget=budget.status();
  const temp=file+'.tmp';writeFileSync(temp,JSON.stringify(report,null,2));renameSync(temp,file);
}
let processed=0,consecutiveFailures=0,cached=0,network=0;
const failureLimit=process.argv.includes('--stop-on-error')?1:2;
async function call(id,request){
  const key=hash(id),path=join(runDir,'calls',key+'.json.gz'),fingerprint=hash(request);
  if(existsSync(path)){
    const item=JSON.parse(gunzipSync(readFileSync(path)));
    if(item.id!==id||item.fingerprint!==fingerprint)throw Error('replay_request_mismatch');
    cached++;return item.response;
  }
  if(replay||!real)throw Error('replay_cache_missing');
  const response=await budget.complete(id,request);
  network++;writeFileSync(path,gzipSync(JSON.stringify({id,fingerprint,request,response})));return response;
}
async function cognitive(w,c,record,turn){
  async function phase(phase){
    const at=w.clock.synced_at,job=`r3:${version}:${c.id}:${turn}:${phase}`;
    applyCognitiveMutation(w,{actor_id:c.actor,operation:'claim',phase,job_id:job,clock_scope:'isolated_test_clock'},at,job+':claim');
    const context=cognitiveContext(w,c.actor,at,phase);context.mode='real';
    if(phase==='feedback'){context.result=cognitiveActualResult(w,c.actor,at);context.action=w.cognition.actors[c.actor].pending.action;}
    let n=0;
    const proposal=await bridge.session(context,request=>call(`${job}:${++n}`,{...request,phase,usage_scope:'isolated_test_clock'}));
    record[`${phase}_proposal`]=proposal;
    applyCognitiveMutation(w,{actor_id:c.actor,operation:phase,phase,job_id:job,proposal,
      relevant_key:cognitiveRelevantKey(w,c.actor),...(phase==='feedback'?{result:context.result}:{})},at,job+':adopt');
  }
  if(turn===1)await phase('perceive');
  await phase('plan');
  let life=w.cognition.actors[c.actor];
  record.compiled=structuredClone(life.compiled);record.reason=life.reason;
  const task=w.tasks.find(t=>t.task_id===life.pending?.task_id);
  if(task)settle(w,task);
  record.task=task?structuredClone(task):null;
  if(task?.status==='running'){record.truncated=true;return;}
  if(life.pending){record.actual_result=cognitiveActualResult(w,c.actor,w.clock.synced_at);await phase('feedback');}
  life=w.cognition.actors[c.actor];
  record.followup=structuredClone(life.followup??null);
  record.issues={current:structuredClone(life.followup??null),deferred:structuredClone(life.deferred_followups??[]),closed:structuredClone(life.followup_archive??[])};
}
async function oldPolicy(w,c,record,turn,arm){
  w.memory.planner.enabled=arm==='bounded';
  const reservedActors=Object.keys(w.autonomy.actors).filter(id=>id!==c.actor);
  const until=plus(w.clock.synced_at,120),prior=w.tasks.length;
  let planId=null;
  for(let step=0;step<80;step++){
    const at=w.clock.synced_at;
    advanceAutonomousLife(w,at,{eventId:`r3:${arm}:${c.id}:${turn}:${step}`,reservedActors});
    const request=w.memory.planner.requests[c.actor],state=w.autonomy.actors[c.actor];
    if(arm==='bounded'&&request?.status==='waiting'){
      const claimed=applyLifeChoice(w,at,{action:'claim_life_choice',actor_id:c.actor,request_id:request.id});
      if(claimed.claimed){
        const response=await call(`r3:${version}:${arm}:${c.id}:${turn}:choice`,{scene:'bounded_choice',phase:'plan',messages:[{role:'user',content:lifeChoicePrompt(w,request)}],json_mode:true,max_tokens:900,usage_scope:'isolated_test_clock'});
        applyLifeChoice(w,at,{action:'resolve_life_choice',actor_id:c.actor,request_id:request.id,text:response.content,model:response.model});
        record.model_response=response.content;continue;
      }
    }
    const plan=state.plan;
    if(plan&&!planId){planId=plan.plan_id;record.plan=structuredClone(plan);record.reason=plan.reason;record.candidates=structuredClone(state.last_candidates);}
    if(planId&&plan?.plan_id!==planId)break;
    const task=w.tasks.find(t=>t.actor_id===c.actor&&t.status==='running');
    if(task){
      settle(w,task,until);
      if(task.status==='running'){record.truncated=true;break;}
    }else if(plan&&['completed','failed','cancelled'].includes(plan.status))break;
    else {
      const later=state.next_decision_at>at?state.next_decision_at:plus(at,1);
      if(later>until){record.truncated=true;break;}
      tick(w,later);
    }
  }
  record.tasks=structuredClone(w.tasks.slice(prior).filter(t=>t.actor_id===c.actor));
  record.final_plan=structuredClone(w.autonomy.actors[c.actor].plan);
  record.followup={status:record.final_plan?.status,reason:w.autonomy.actors[c.actor].last_feedback?.text};
}
try{
  for(const c of select){
    if(arg('case')&&!c.id.includes(arg('case')))continue;
    if(arg('cases')&&!arg('cases').split(',').includes(c.id))continue;
    for(const arm of arms){
      const key=`${arm}:${c.id}`;
      if(report.results.some(r=>r.key===key)||processed>=Number(arg('take')??1000)||consecutiveFailures>=failureLimit)continue;
      const w=seed(c),episode={...c,key,arm,initial_hash:hash(w),initial:digest(w,c.actor),turns:[]},started=performance.now();
      try{
        for(let turn=1;turn<=turns;turn++){
          const record={turn,at:w.clock.synced_at,prior_followup:structuredClone(w.cognition.actors[c.actor].followup??null),
            opportunity:opportunity(w,c.actor),inputs:cognitiveContext(w,c.actor,w.clock.synced_at).inputs,before:digest(w,c.actor)};
          episode.turns.push(record);
          const t=performance.now();
          if(arm==='cognition')await cognitive(w,c,record,turn);else await oldPolicy(w,c,record,turn,arm);
          record.latency_ms=Math.round(performance.now()-t);record.after=digest(w,c.actor);
          console.log(JSON.stringify({key,turn,op:record.compiled?.operation??record.plan?.goal,activity:record.compiled?.activity_id,followup:record.followup?.status}));
          if(record.truncated)break;
          if(turn<turns){
            let next=record.followup?.next_review_at??plus(w.clock.synced_at,60);
            if(next<w.clock.synced_at)next=w.clock.synced_at;
            const hour=(new Date(next).getUTCHours()+8)%24;
            if(hour>=23||hour<6)next=plus(next,(hour>=23?33-hour:9-hour)*60);
            tick(w,next);
          }
        }
        consecutiveFailures=0;
      }catch(e){
        episode.error=e.code??e.message;episode.error_detail=e.message;consecutiveFailures++;
        console.log(JSON.stringify({key,error:episode.error,detail:e.message}));
      }
      episode.latency_ms=Math.round(performance.now()-started);
      episode.final_hash=hash(w);episode.final=digest(w,c.actor);
      writeFileSync(join(runDir,'worlds',hash(key)+(replay?'-replay':'')+'.json.gz'),gzipSync(JSON.stringify(w)));
      report.results.push(episode);processed++;report.cache={hits:cached,provider_returns:network};save();
    }
  }
}finally{bridge.close();if(budget)await budget.close();save();ledger?.close();}
console.log(JSON.stringify({runDir,version,processed,consecutiveFailures,cached,network,report:file}));
if(consecutiveFailures>=failureLimit)process.exitCode=2;
