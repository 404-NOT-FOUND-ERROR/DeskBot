// Replay only a fictional social-choice result. Never read the formal world database.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {cognitiveContext,applyCognitiveMutation} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';
import {createCognitiveBudget} from '../../../apps/deskbot-service/src/cognitive-budget.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
import {loadLlmConfiguration} from '../../../apps/deskbot-service/src/llm.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('output')),input=JSON.parse(readFileSync(arg('input'),'utf8'));
const episode=input.results.find(r=>r.id===arg('case')&&!r.error);
if(!episode?.final_world)throw Error('fictional_episode_required');
const w=structuredClone(episode.final_world),at=w.clock.synced_at;
if(w.cognition.clock_scope!=='isolated_test_clock')throw Error('isolated_scope_required');
const contexts=['shaping-001','wetland-grower-001'].map(id=>cognitiveContext(w,id,at,'relate'));
writeFileSync(join(output,'outbound-relation-fixtures.json'),JSON.stringify(contexts,null,2));
if(!process.argv.includes('--real')){console.log('Prepared two fictional relation views; no calls.');process.exit(0);}
const ledger=createSqlitePersistence({filename:join(output,'../stages3-5-budget.sqlite')});
const budget=createCognitiveBudget({persistence:ledger,configuration:loadLlmConfiguration({env:{DESKBOT_LLM_PROVIDER:'deepseek'},configPath:arg('config')}),namespace:'cognition-stage3-5',approvalId:'stages3-5',approvalSource:'human:不限制金额，节省着用就行',scope:'Isolated fictional social evidence only',limitCny:null,maxCalls:null});
const bridge=createCognitionBridge({workerFile:'life_worker.py',timeoutMs:120000,maxFrames:10,mode:'real'});
const version=createHash('sha256').update(readFileSync(new URL('../relationship_review.py',import.meta.url))).update(JSON.stringify(contexts)).digest('hex').slice(0,12);
const before=JSON.stringify(w.relationships),results=[];
try{
 for(const c of contexts){
  const id=c.actor.actor_id,job=`4a-relate:${version}:${id}`;let calls=0;
  applyCognitiveMutation(w,{actor_id:id,operation:'claim',phase:'relate',job_id:job},at,job+':claim');
  const proposal=await bridge.session(c,request=>{
   if(++calls>2)throw Error('relation_call_guard');
   if(JSON.stringify(request).includes('PRIVATE_CANARY_LANTERN_71'))throw Error('private_prompt_leak');
   return budget.complete(`${job}:${calls}`,{...request,phase:'relate',usage_scope:'isolated_test_clock'});
  });
  applyCognitiveMutation(w,{actor_id:id,operation:'relate',proposal,job_id:job},at,job+':adopt');
  results.push({actor_id:id,calls,views:w.cognition.actors[id].relation_views});
 }
 if(JSON.stringify(w.relationships)!==before)throw Error('shared_relation_changed');
}finally{bridge.close();await budget.close();writeFileSync(join(output,`relation-${version}.json`),JSON.stringify({version,source_case:episode.id,results,shared_relationship_changed:false,budget:budget.status()},null,2));ledger.close();}
console.log(JSON.stringify({version,results}));
