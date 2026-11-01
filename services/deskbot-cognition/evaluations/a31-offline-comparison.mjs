// Same finite fixture/context, two protocol projections, stub responses only.
// This measures prompt characters and possible calls, never paid token savings.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fixture,cases,OWNER,settle} from './r3-fixtures.mjs';
import {cognitiveContext,cognitiveActualResult,cognitiveRelevantKey,applyCognitiveMutation} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {createCognitionBridge} from '../../../apps/deskbot-service/src/cognition-bridge.mjs';
const rows=[],bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:30});
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function run(base,protocol){
 const context=structuredClone(base),calls=[];
 if(protocol==='a2-contract'){delete context.evidence_refs;delete context.followup_intent;}
 const before=hash(context);
 const proposal=await bridge.session(context,async req=>{
  calls.push({stage:req.stage,scene:req.scene,characters:req.messages.reduce((n,m)=>n+m.content.length,0)});
  let v;
  if(req.stage==='perception')v={reason:'先看看',emotion:'anticipation',intensity:.3,valence:.3,need_activation:{self_actualization:.4}};
  else if(req.stage==='directive')v={interpretations:context.refraction.pending.map(s=>({source_id:s.id,kind:'report',stance:'uncertain',effect:'attention',topic:'公开线索',question:'之后留意这条信息',reason:'这是听闻，不是我的实践',evidence_quote:s.content.slice(0,80),target_object_ids:[],confidence:.5}))};
  else if(req.scene==='need_goal_generation')v={goal_updates:[]};
  else if(req.stage==='decision'){
   const view=JSON.parse(req.messages.at(-1).content),row=view.choices.find(r=>r.effect.activity_id==='measure-bank-light')??view.choices.find(r=>r.effect.operation==='rest');
   v={act:true,choice_id:row.id,inner_monologue:'在相同条件下做一次真实记录',expected_outcome:'得到当前条件的记录',issue:{decision:'continue',id:'current'},motivation:'self_exploration',source_ids:[]};
  }else if(req.stage==='feedback')v={reason:'记录实际结果',emotion:'joy',intensity:.3,valence:.3};
  else if(req.stage==='memory')v=req.scene==='memory_importance'?{score:.8,reason:'实际记录'}:{focus_id:JSON.parse(req.messages.at(-1).content).facts[0].id,feeling:'curious',wish:'understand'};
  else if(req.stage==='followup')v=protocol==='a31-contract'?{status:'continue',basis_ids:base.followup_intent.bases.map(b=>b.id),next_step:null,delay_hours:1}:
   {status:'continue',question:'以后再看新线索',reason:context.result.effects?.communication?.summary??'本次实际记录已保存',next_step:null,delay_hours:1,...(context.result.effects?.communication?{communication_evidence_id:context.result.effects.communication.id}:{})};
  else throw Error(`Unexpected stage ${req.stage}/${req.scene}`);
  return JSON.stringify(v);
 });
 assert.equal(hash(context),before,'prompt selection cannot mutate the full validator context');
 rows.push({case_id:base.case_id,phase:base.phase,protocol,context_sha256:hash(base),calls,
  goal_updates:proposal.goal_updates.length,goal_maintenance:proposal.goal_maintenance});
 return proposal;
}
try{
 for(const id of ['resources-1-off','resources-1-on','invitation-3-off','invitation-3-on']){
  const w=fixture(cases.find(c=>c.id===id));
  for(const phase of ['plan','feedback']){
   const at=w.clock.synced_at,job=`offline:${id}:${phase}`;
   applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase,job_id:job},at,job);
   const context=cognitiveContext(w,OWNER,at,phase);context.mode='mock';context.case_id=id;
   if(phase==='feedback'){context.result=cognitiveActualResult(w,OWNER,at);context.action=w.cognition.actors[OWNER].pending.action;}
   const before=hash(w),old=await run(context,'a2-contract'),current=await run(context,'a31-contract');
   assert.equal(hash(w),before);assert.deepEqual(old.goal_updates,current.goal_updates);
   assert.deepEqual(old.state.short_term_goal_entities,current.state.short_term_goal_entities);
   if(phase==='feedback'){
    assert.equal(current.goal_maintenance.reason,'no_live_goals');
    assert.deepEqual(current.followup_binding.actor_payload.basis_ids,context.followup_intent.bases.map(b=>b.id));
   }
   applyCognitiveMutation(w,{actor_id:OWNER,operation:phase,job_id:job,proposal:current,relevant_key:cognitiveRelevantKey(w,OWNER),...(context.result?{result:context.result}:{})},at,job);
   if(phase==='plan')settle(w,w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id));
  }
 }
}finally{bridge.close();}
const totals=Object.fromEntries(['a2-contract','a31-contract'].map(protocol=>{
 const calls=rows.filter(r=>r.protocol===protocol).flatMap(r=>r.calls),goals=calls.filter(c=>c.scene==='need_goal_generation');
 return [protocol,{calls:calls.length,characters:calls.reduce((n,c)=>n+c.characters,0),goal_calls:goals.length,empty_goal_calls:goals.length,
  by_stage:Object.fromEntries([...new Set(calls.map(c=>c.stage))].map(stage=>[stage,{calls:calls.filter(c=>c.stage===stage).length,characters:calls.filter(c=>c.stage===stage).reduce((n,c)=>n+c.characters,0)}]))}];
}));
const report={schema:'deskbot.a31-offline-comparison.v1',paid_calls:0,world_cases:4,fixed_context_pairs:8,
 comparison:'Current adapter with original A2 envelope versus A3.1 envelope on identical fixture snapshots. Not historical response replay or a real model sample.',
 characters:'JavaScript UTF-16 code units across messages; not token counts, billed cost or latency.',
 checks:{world_unchanged_by_workers:true,full_context_immutable:true,goal_queue_equal:true,result_basis_preserved:true,formation_calls_preserved:true},totals,rows};
const output=resolve(process.argv[2]??'../runtime/a31-offline-comparison.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,totals,paid_calls:0},null,2));
