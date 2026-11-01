import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cases,settle,OWNER} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {createCognitionBridge} from '../src/cognition-bridge.mjs';
import {cognitiveContext,cognitiveActualResult,cognitiveRelevantKey,applyCognitiveMutation} from '../src/cognitive-life-state.mjs';

test('real Python worker binds one choice, executes two dependent steps and remembers actual outcomes without compiler calls',async t=>{
 const w=fixture(cases.find(c=>c.id==='resources-1-off'));
 const bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:30});t.after(()=>bridge.close());
 const requests=[];let turn=1;
 const respond=async request=>{
  if(request.json_mode)assert.ok(request.messages.some(m=>/json/i.test(m.content)),'JSON request must meet the provider admission contract before network access');
  requests.push({stage:request.stage,scene:request.scene});
  let value;
  if(request.stage==='perception')value={reason:'看实际灯况',emotion:'anticipation',intensity:.3,valence:.3,need_activation:{self_actualization:.4}};
  else if(request.stage==='motivation')value={goals:[{text:'实际试用归途灯',due_in_hours:null}]};
  else if(request.stage==='decision'){
   const view=JSON.parse(request.messages.at(-1).content);
   value={act:true,selected_index:view.action_menu.find(a=>a.type==='work').selected_index,
    inner_monologue:turn===1?'我带着罩片，先装上再看实际效果。':'装罩步骤已经完成，接下来实际试一次取水。',
    action_description:turn===1?'给归途灯装罩':'借带罩归途灯净滤取水',expected_outcome:'了解灯的实际效果',
    activity_id:turn===1?'waylight-fit-shade':'waylight-use',
    issue_choice:{followup_decision:'continue',followup_id:'current',completion_target_id:'selected_activity',
     step_review:turn===1?null:{reason:'装罩已由执行记录证明，接着试用'},followup_closure:null},
    production_purpose:turn===1?null:{kind:'experiment',reason:'验证带罩时取水是否可行'},
    motivation:'self_continuation',source_ids:[],prior_root_id:view.prior_result_root};
  }else if(request.stage==='feedback')value=request.scene==='need_goal_generation'?{goals:[],residue:[]}:{reason:'实际完成一步',emotion:'joy',intensity:.4,valence:.4};
  else if(request.stage==='memory'&&request.scene==='memory_importance')value={score:.8,reason:'自己的实际结果'};
  else if(request.stage==='memory'&&request.scene==='memory_summarization'){
   const view=JSON.parse(request.messages.at(-1).content);value={focus_id:view.facts[0].id,feeling:'curious',wish:'try'};
  }else if(request.stage==='followup'){
   const view=JSON.parse(request.messages.at(-1).content);
   const target=view.use_context.production.find(p=>p.activity_id==='waylight-use').experiment.completion_target_id;
   const use=view.continuation.next_options.find(o=>o.kind==='opportunity'&&o.completion_target_id===target&&o.requires_issue===view.continuation.current.followup_id);
   if(turn===1)assert.ok(use,'the next step must retain the concrete experiment purpose');
   value={status:'continue',question:'下次再看看实际灯况',reason:'还想了解日常使用情况',delay_hours:1,
    next_step:turn===1?{kind:'opportunity',id:use.id}:null,wait_for:null};
  }
  else throw Error('Unexpected model stage: '+request.stage+'/'+request.scene);
  return JSON.stringify(value);
 };
 async function phase(name){
  const at=w.clock.synced_at,job=`single:${turn}:${name}`;
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:name,job_id:job},at,job+':claim');
  const context=cognitiveContext(w,OWNER,at,name);context.mode='mock';context.choice_contract='single-choice-v1';
  if(name==='feedback'){context.result=cognitiveActualResult(w,OWNER,at);context.action=w.cognition.actors[OWNER].pending.action;}
  const proposal=await bridge.session(context,respond);
  applyCognitiveMutation(w,{actor_id:OWNER,operation:name,phase:name,job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,OWNER),
   ...(name==='feedback'?{result:context.result}:{})},at,job+':adopt');
  return proposal;
 }
 for(turn=1;turn<=2;turn++){
  const proposal=await phase('plan');assert.equal(proposal.choice_binding.model_compile_calls,0);
  assert.equal(proposal.compiled.activity_id,turn===1?'waylight-fit-shade':'waylight-use');
  const task=w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id);settle(w,task);
  assert.equal(task.status,'completed');
  const feedback=await phase('feedback');assert.ok(feedback.memory_anchor_checks.every(c=>c.status==='anchored'));
 }
 assert.equal(w.cognition.actors[OWNER].followup.completed_steps.length,1);
 assert.equal(w.cognition.actors[OWNER].followup.followup_id,'task:fixture-built-lamp');
 assert.ok(cognitiveContext(w,OWNER,w.clock.synced_at).continuation.current.resolution_evidence_ids.length);
 assert.equal(requests.filter(r=>r.stage.startsWith('compile')).length,0);
 assert.equal(requests.filter(r=>r.stage==='decision').length,2);
 assert.equal(w.living.inventories[OWNER].stock.water,4);
});
