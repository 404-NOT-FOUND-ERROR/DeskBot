import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,cases,settle,OWNER} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext,cognitiveActualResult,cognitiveRelevantKey,applyCognitiveMutation} from '../src/cognitive-life-state.mjs';
import {freezeCognitiveReferences} from '../src/cognitive-continuity.mjs';
import {compileCognitiveMessage,commitCognitiveMessage} from '../src/cognitive-social.mjs';
import {pendingContactPurpose,rememberContactPurpose} from '../src/cognitive-contact-purpose.mjs';
import {validateCatalogueSelection} from '../src/cognitive-choice-catalogue.mjs';
import {createCognitionBridge,findCognitionPython} from '../src/cognition-bridge.mjs';

const seed=()=>fixture(cases.find(c=>c.id==='resources-1-off'));
const context=w=>cognitiveContext(w,OWNER,w.clock.synced_at);
const rows=w=>context(w).choice_catalogue.choices;

test('all available fixture options bind in Python and pass the real Node executor',()=>{
 const worlds=['resources-1-off','resources-1-on','invitation-3-off','invitation-3-on'].map(id=>fixture(cases.find(c=>c.id===id)));
 const input=worlds.map(w=>{
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:'catalogue-all'},w.clock.synced_at,'claim');
  return context(w);
 });
 const script=`import json,sys
from types import SimpleNamespace as NS
from catalogue_choice import bind_catalogue_choice
from life_worker import valid_life_compilation, valid_social_compilation, valid_continuation_binding
from life_semantics import production_errors
result=[]
for c in json.load(sys.stdin):
 for row in c['choice_catalogue']['choices']:
  current=c['continuation'].get('current')
  sources=[s for s in row['binding'].get('speech_sources',[]) if any(i['id']==s for i in c['inputs'])]
  p={'act':True,'choice_id':row['id'],'inner_monologue':'按自己的兴趣实际尝试这一个选项','expected_outcome':'看看实际结果','issue':{'decision':'continue' if current else 'none','id':'current' if current else None},'motivation':'self_continuation','source_ids':sources}
  people=[r['actor_id'] for r in c['capabilities']['share']['receivers']]
  upstream,bound=bind_catalogue_choice(p,c,[NS(action_type=NS(value=k)) for k in ('work','physical','send_message','move','rest')],people)
  assert valid_life_compilation(bound),(row,bound)
  assert valid_social_compilation(bound,c),(row,bound)
  assert valid_continuation_binding(bound,c),(row,bound)
  assert not production_errors(bound,c),(row,bound)
  result.append({'world':c['fixture_index'],'payload':p,'compiled':bound})
json.dump(result,sys.stdout,ensure_ascii=False)
`;
 input.forEach((c,i)=>c.fixture_index=i);
 const r=spawnSync(findCognitionPython(),['-c',script],{cwd:fileURLToPath(new URL('../../../services/deskbot-cognition/',import.meta.url)),
  input:JSON.stringify(input),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},windowsHide:true,maxBuffer:4000000});
 assert.equal(r.status,0,r.stderr);
 const bound=JSON.parse(r.stdout);assert.ok(bound.length>30);
 for(const b of bound){
  const w=structuredClone(worlds[b.world]),c=b.compiled;
  const proposal={schema:'deskbot.cognitive-life.proposal.v3',goal_contract:'deskbot.goal-lifecycle.v1',goal_updates:[],actor_id:OWNER,phase:'plan',state:{},action:{inner_monologue:c.reason},compiled:c,
    decision_method:c.activity_id,decision_production:c.production_use,choice_binding:{contract:'choice-catalogue-v2',actor_payload:b.payload,compiled:structuredClone(c),model_compile_calls:0}};
  const result=applyCognitiveMutation(w,{actor_id:OWNER,operation:'plan',job_id:'catalogue-all',proposal,relevant_key:cognitiveRelevantKey(w,OWNER)},w.clock.synced_at,'adopt');
  assert.equal(result.accepted,true,JSON.stringify(b));
  assert.ok(!result.blocked,JSON.stringify({b,result}));
 }
});
function waterQuestion(w,peer='wetland-grower-001'){
 const c=context(w);return c.choice_catalogue.choices.find(r=>r.binding.contact_purpose?.key==='offer:water'
  &&r.binding.contact.kind==='message'&&c.capabilities.share.receivers[r.binding.receiver_indices[0]-1].actor_id===peer);
}
function sent(w,row){
 const c=context(w),b=row.binding,refs=freezeCognitiveReferences(c),receivers=b.receiver_indices.map(n=>refs.receivers[n-1]);
 const m=compileCognitiveMessage(w,OWNER,{message_parts:[{kind:'catalogue',choice_id:row.id}],receiver_indices:b.receiver_indices,source_ids:[]},refs,receivers,c.at);
 const task={task_id:'purpose-'+w.tasks.length,actor_id:OWNER,root_outcome_id:'task:purpose',cognitive_message:{...m,receiver_ids:receivers,receiver_names:receivers}};
 commitCognitiveMessage(w,task,c.at);w.tasks.push(task);return w.cognition.actors[OWNER].outbox.at(-1);
}

test('water query stays pending after unrelated lamp progress, issue rename, clock drift and outbox eviction',()=>{
 const w=seed();w.living.inventories[OWNER].stock.water=4;
 const row=waterQuestion(w);assert.ok(row);sent(w,row);
 assert.equal(waterQuestion(w),undefined);
 assert.ok(waterQuestion(w,'lamp-keeper-001'),'a different recipient is independent');
 const lamp=w.living.objects['floating-frame'].waylight;lamp.has_hood=true;lamp.mode='hooded';lamp.charge-=.02;
 w.cognition.actors[OWNER].followup.followup_id='another-research';
 w.cognition.actors[OWNER].outbox=[];
 const restored=JSON.parse(JSON.stringify(w));
 assert.equal(waterQuestion(restored),undefined);
 assert.ok(!rows(restored).some(r=>r.binding.contact?.kind==='invite'&&r.binding.contact.option_id==='give-water'
   &&r.binding.receiver_indices[0]===row.binding.receiver_indices[0]),'formal wrapper cannot bypass unanswered demand');
 restored.living.inventories[OWNER].stock.water=2;
 assert.ok(waterQuestion(restored),'different actual offer terms may be proposed');
});

test('only actual response unlocks a purpose; expiry and another message do not',()=>{
 const w=seed();w.living.inventories[OWNER].stock.water=4;
 const row=waterQuestion(w),receipt=sent(w,row),life=w.cognition.actors[OWNER];
 receipt.commitment_id='expired-offer';life.contact_purposes.at(-1).commitment_id='expired-offer';
 w.social.commitments.push({id:'expired-offer',status:'expired',responses:{'wetland-grower-001':'pending'}});
 life.inbox=[{message_id:'unrelated',sender_id:'wetland-grower-001',reply_to:'something-else'}];
 assert.ok(pendingContactPurpose(w,OWNER,'wetland-grower-001',row.binding.contact_purpose));
 life.inbox.push({message_id:'actual-reply',sender_id:'wetland-grower-001',reply_to:receipt.message_id});
 assert.equal(pendingContactPurpose(w,OWNER,'wetland-grower-001',row.binding.contact_purpose),null);
});

test('catalogue does not inspect another bag and rejects altered command and stale choice',()=>{
 const w=seed(),c=context(w),refs=freezeCognitiveReferences(c);
 w.living.inventories['wetland-grower-001']={stock:{water:999},capacity:2000};
 assert.deepEqual(context(w).choice_catalogue,c.choice_catalogue);
 const row=c.choice_catalogue.choices.find(r=>r.binding.activity_id==='waylight-fit-shade');
 const p={choice_binding:{contract:'choice-catalogue-v2',actor_payload:{choice_id:row.id,inner_monologue:'想自己试试'}},
  compiled:{...row.binding,source_ids:[]}};
 validateCatalogueSelection(p,c,refs);
 p.compiled.activity_id='waylight-use';assert.throws(()=>validateCatalogueSelection(p,c,refs),/catalogue_operation_changed/);
 p.compiled={...row.binding,source_ids:[]};const stale=structuredClone(c);stale.choice_catalogue.choices=stale.choice_catalogue.choices.filter(r=>r.id!==row.id);
 assert.throws(()=>validateCatalogueSelection(p,stale,refs),/choice_catalogue_changed/);
});

test('same output is not the same experiment; excess water cannot gain an invented research use',()=>{
 const w=seed();w.living.inventories[OWNER].stock.water=4;
 const c=context(w);
 assert.ok(!c.choice_catalogue.choices.some(r=>r.binding.activity_id==='collect-water'));
 const lamp=c.choice_catalogue.choices.find(r=>r.binding.activity_id==='waylight-use'&&r.binding.production_use.kind==='experiment');
 assert.ok(lamp);assert.equal(lamp.method.experiment.kind,'waylight-use');
 const producer=c.use_context.production.find(p=>p.activity_id==='collect-water');
 assert.equal(producer.experiment,null);
});

test('real Python and Node execute selected catalogue steps, keep proof, then send purpose-bound speech',async t=>{
 const w=seed(),bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:30});t.after(()=>bridge.close());
 let turn=1;const stages=[];
 const respond=async request=>{
  stages.push(request.stage);let v;
  if(request.stage==='perception')v={reason:'看实际灯况',emotion:'anticipation',intensity:.3,valence:.3,need_activation:{self_actualization:.4}};
  else if(request.stage==='motivation')v={goal_updates:[]};
  else if(request.stage==='decision'){
   const view=JSON.parse(request.messages.at(-1).content);
   const row=view.choices.find(r=>turn===1?r.effect.activity_id==='waylight-fit-shade':turn===2?
     r.effect.activity_id==='waylight-use'&&r.effect.production_use.kind==='experiment':
     r.effect.contact_purpose?.key==='offer:water'&&r.effect.contact.kind==='message');
   assert.ok(row,'desired grounded option exists');
   v={act:true,choice_id:row.id,inner_monologue:'我想逐步了解灯的使用，再确认这些水有没有用途。',expected_outcome:'多了解一点实际情况',
    issue:{decision:'continue',id:'current'},motivation:'self_continuation',source_ids:[]};
  }else if(request.stage==='feedback')v=request.scene==='need_goal_generation'?{goal_updates:[]}:{reason:'记录这一步',emotion:'joy',intensity:.4,valence:.4};
  else if(request.stage==='memory'&&request.scene==='memory_importance')v={score:.8,reason:'自己的结果'};
  else if(request.stage==='memory'&&request.scene==='memory_summarization'){
   const view=JSON.parse(request.messages.at(-1).content);v={focus_id:view.facts[0].id,feeling:'curious',wish:'understand'};
  }else if(request.stage==='followup'){
   v={status:'continue',basis_ids:JSON.parse(request.messages.at(-1).content).evidence.bases.map(b=>b.id),delay_hours:1,next_step:null,wait_for:null};
  }
  else throw Error('Unexpected stage '+request.stage+'/'+request.scene);
  return JSON.stringify(v);
 };
 for(turn=1;turn<=3;turn++)for(const phase of ['plan','feedback']){
  const at=w.clock.synced_at,job=`catalogue-${turn}-${phase}`;
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase,job_id:job},at,job+':claim');
  const c=cognitiveContext(w,OWNER,at,phase);c.mode='mock';
  if(phase==='feedback'){c.result=cognitiveActualResult(w,OWNER,at);c.action=w.cognition.actors[OWNER].pending.action;}
  const p=await bridge.session(c,respond);
  applyCognitiveMutation(w,{actor_id:OWNER,operation:phase,phase,job_id:job,proposal:p,relevant_key:cognitiveRelevantKey(w,OWNER),...(phase==='feedback'?{result:c.result}:{})},at,job+':adopt');
  if(phase==='plan'){
   assert.equal(p.choice_binding.contract,'choice-catalogue-v2');
   const task=w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id);settle(w,task);assert.equal(task.status,'completed');
  }else assert.ok(p.memory_anchor_checks.every(m=>m.status==='anchored'));
 }
 assert.equal(stages.filter(s=>s.includes('repair')||s.startsWith('compile')).length,0);
 assert.equal(w.cognition.actors[OWNER].followup.completed_steps.length,2);
 assert.equal(w.living.inventories[OWNER].stock.water,4,'message is not a transfer');
 assert.ok(w.cognition.actors[OWNER].outbox.at(-1).contact_purpose);
});
