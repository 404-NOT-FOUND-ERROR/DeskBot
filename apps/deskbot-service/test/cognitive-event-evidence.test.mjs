import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture,cases,settle,tick,OWNER} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext,cognitiveActualResult,cognitiveRelevantKey,applyCognitiveMutation,settleCognitiveTask} from '../src/cognitive-life-state.mjs';
import {createCognitionBridge,findCognitionPython} from '../src/cognition-bridge.mjs';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {resultDisclosures,messageReceipt,validateCommunicationFeedback,validateObligationEvidence,eventEvidenceContext} from '../src/cognitive-event-evidence.mjs';

const vectors=JSON.parse(readFileSync(new URL('../../../contracts/fixtures/event-evidence.v1.json',import.meta.url),'utf8'));
const original=JSON.parse(readFileSync(new URL('../../../services/deskbot-cognition/evaluations/fixtures/r3a-event-evidence-20261031.json',import.meta.url),'utf8'));
const seed=()=>fixture(cases.find(c=>c.id==='resources-1-off'));
test('Node and Python share obligation and communication counterexamples',()=>{
 for(const r of vectors.obligation_cases){
  if(r.valid)validateObligationEvidence(r.payload,vectors.context);
  else assert.throws(()=>validateObligationEvidence(r.payload,vectors.context),{code:'cognitive_obligation_evidence_invalid'},r.name);
 }
 for(const r of vectors.communication_cases){
  if(r.valid)validateCommunicationFeedback(r.value,vectors.receipt);
  else assert.throws(()=>validateCommunicationFeedback(r.value,vectors.receipt),{code:'cognitive_communication_evidence_invalid'},r.name);
 }
 assert.throws(()=>validateObligationEvidence(original.selected,vectors.context),{code:'cognitive_obligation_evidence_invalid'});
 assert.throws(()=>validateCommunicationFeedback(original.adopted_followup,vectors.receipt),{code:'cognitive_communication_evidence_invalid'});
 for(const r of original.original_responses)assert.equal(createHash('sha256').update(r.content).digest('hex'),r.content_sha256);
});

test('only accepted live terms authorize an in-scope action; no private remote position',()=>{
 const w=seed(),c=cognitiveContext(w,OWNER,w.clock.synced_at);
 const destination=c.capabilities.travel.destinations[0];
 const a={id:'agreed',control:'cognitive',status:'accepted',actors:[OWNER,'lamp-keeper-001'],responses:{[OWNER]:'join','lamp-keeper-001':'join'},terms_revision:2,
  location_id:destination.id,deadline_at:'2026-10-21T11:00:00.000Z'};
 w.social.commitments=[a];
 assert.ok(eventEvidenceContext(w,OWNER,c).obligations[0].choice_ids.every(id=>c.choice_catalogue.choices.find(r=>r.id===id).binding.operation==='travel'));
 for(const status of ['proposed','withdrawn','expired','completed']){a.status=status;assert.deepEqual(eventEvidenceContext(w,OWNER,c).obligations,[]);}
 a.status='accepted';a.responses['lamp-keeper-001']='pending';assert.deepEqual(eventEvidenceContext(w,OWNER,c).obligations,[]);
 a.responses['lamp-keeper-001']='join';a.deadline_at='2026-10-19T11:00:00.000Z';assert.deepEqual(eventEvidenceContext(w,OWNER,c).obligations,[]);
 const context=cognitiveContext(seed(),OWNER,c.at);
 assert.ok(context.event_evidence.people.every(p=>p.location_id===context.location.id&&p.observed_at===c.at));
 assert.ok(!JSON.stringify(context.event_evidence.people).includes('inventory'));
});

test('extracts preserve recorded values and scope for any registered method, never private state',()=>{
 const method={id:'another-method',version:3,actor_id:OWNER,root_outcome_id:'task:sample',started_at:'2026-10-20T11:00:00Z',finished_at:'2026-10-20T11:03:00Z',
  before:{depth:.2},after:{depth:.3,private_note:'secret'},observations:[{field:'depth',label:'深度',unit:'米'}],conditions:{subject:'pool',axes:{season:'wet'}},scope:'task_interval_including_environment',limits:['不是因果证明'],stock_changes:[]};
 const task={actor_id:OWNER,status:'completed',activity_id:'another-method',target_object_id:'pool',completion:{result:{method_result:method}},private_reason:'private feeling'};
 const result={root_outcome_id:'task:sample',success:true,occurred_at:method.finished_at,effects:{verified_title:'测水深'},private_memory:'secret'};
 const [notice,extract]=resultDisclosures(result,task);
 assert.equal(notice.fields.length,1);assert.equal(extract.fields[0].value,.3);assert.equal(extract.fields[0].unit,'米');
 assert.ok(extract.text.includes('不是因果证明'));assert.ok(!JSON.stringify(extract).includes('secret'));assert.ok(!JSON.stringify(extract).includes('private'));
 task.completion.result.method_result={...method,root_outcome_id:'task:other'};assert.equal(resultDisclosures(result,task).length,1);
 assert.deepEqual(resultDisclosures({...result,success:false},task),[]);
});

test('Python bound obligation is rechecked against current Node terms before any adoption',()=>{
 const w=seed(),at=w.clock.synced_at,initial=cognitiveContext(w,OWNER,at);
 const destination=initial.capabilities.travel.destinations[0];
 w.social.commitments=[{id:'agreed',control:'cognitive',kind:'visit',status:'accepted',actors:[OWNER,'lamp-keeper-001'],
  responses:{[OWNER]:'join','lamp-keeper-001':'join'},terms_revision:2,location_id:destination.id,deadline_at:'2026-10-21T11:00:00Z'}];
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:'obligation'},at,'claim');
 const context=cognitiveContext(w,OWNER,at),evidence=context.event_evidence.obligations[0];assert.ok(evidence);
 const payload={act:true,choice_id:evidence.choice_ids[0],motivation:'accepted_obligation',obligation_ref:{commitment_id:'agreed',terms_revision:2},
  inner_monologue:'我接受了这份约定，现在沿路去约好的地方。',expected_outcome:'实际抵达',issue:{decision:'continue',id:'current'},source_ids:[]};
 const script=`import json,sys
from types import SimpleNamespace as NS
from catalogue_choice import bind_catalogue_choice
c,p=json.load(sys.stdin)
_,bound=bind_catalogue_choice(p,c,[NS(action_type=NS(value=k)) for k in ('work','physical','send_message','move','rest')],[r['actor_id'] for r in c['capabilities']['share']['receivers']])
json.dump(bound,sys.stdout,ensure_ascii=False)`;
 const proc=spawnSync(findCognitionPython(),['-c',script],{cwd:fileURLToPath(new URL('../../../services/deskbot-cognition/',import.meta.url)),input:JSON.stringify([context,payload]),encoding:'utf8',env:{...process.env,PYTHONUTF8:'1'},windowsHide:true});
 assert.equal(proc.status,0,proc.stderr);const compiled=JSON.parse(proc.stdout);
 const proposal={schema:'deskbot.cognitive-life.proposal.v3',goal_contract:'deskbot.goal-lifecycle.v1',goal_updates:[],actor_id:OWNER,phase:'plan',state:{},memories:[],compiled,action:{inner_monologue:compiled.reason},
  choice_binding:{contract:'choice-catalogue-v2',actor_payload:payload,compiled:structuredClone(compiled),model_compile_calls:0}};
 const adopt=world=>applyCognitiveMutation(world,{actor_id:OWNER,operation:'plan',phase:'plan',job_id:'obligation',proposal,relevant_key:cognitiveRelevantKey(world,OWNER)},at,'adopt');
 const binding=proposal.choice_binding;delete proposal.choice_binding;const noReceipt=structuredClone(w);
 assert.throws(()=>adopt(noReceipt),{code:'cognitive_obligation_evidence_invalid'});assert.deepEqual(noReceipt,w);proposal.choice_binding=binding;
 for(const change of [c=>c.terms_revision++,c=>c.status='withdrawn',c=>c.responses['lamp-keeper-001']='pending']){
  const changed=structuredClone(w);change(changed.social.commitments[0]);const before=structuredClone(changed);
  assert.throws(()=>adopt(changed),{code:'cognitive_obligation_evidence_invalid'});assert.deepEqual(changed,before);
 }
 const result=adopt(w);assert.equal(result.accepted,true);assert.ok(!result.blocked,JSON.stringify(result));
 const task=w.tasks.find(t=>t.task_id===result.task_id);assert.ok(task);
 assert.equal(task.life_motivation.kind,'accepted_obligation');
 assert.equal(task.life_motivation.commitment_id,'agreed');
});

test('failed delivery cannot disclose a prepared extract or prove acceptance',()=>{
 const task={task_id:'failed',actor_id:OWNER,cognitive_message:{evidence_contract:vectors.context.event_evidence.schema,receiver_ids:['peer'],text:'尚未送达的读数',disclosures:[{kind:'result_extract',fields:[{path:'brightness',value:.2}]}]}};
 const receipt=messageReceipt(task,'2026-11-01T00:00:00Z',false);
 assert.equal(receipt.delivered,false);assert.equal(receipt.text,null);assert.equal(receipt.text_sha256,null);
 assert.deepEqual(receipt.disclosures,[]);assert.deepEqual(receipt.delivery_message_ids,[]);assert.equal(receipt.acceptance_verified,false);
 validateCommunicationFeedback({reason:receipt.summary,communication_evidence_id:receipt.id},receipt);
 assert.throws(()=>validateCommunicationFeedback({reason:'数据已经送到',communication_evidence_id:receipt.id},receipt),{code:'cognitive_communication_evidence_invalid'});
});

test('real bridge: measure, notify, disclose; reject false feedback atomically and resume once after SQLite restart',async t=>{
 let w=seed(),turn=1,mode='good';
 const bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:30000,maxFrames:30});t.after(()=>bridge.close());
 const respond=async req=>{
  let v;
  if(req.stage==='perception')v={reason:'看看现场',emotion:'anticipation',intensity:.3,valence:.3,need_activation:{self_actualization:.4}};
  else if(req.stage==='motivation'){
   v={goal_updates:[]};
   if(turn===2){
    const view=JSON.parse(req.messages.at(-1).content),criterion=view.goals.criteria.find(k=>k.kind==='disclosure');
    assert.ok(criterion);
    v.goal_updates=[{operation:'new',goal_id:'goal:send-readings',text:'把这次真实读数告诉在场朋友',criterion_id:criterion.id,
     next_step:{kind:'opportunity',id:criterion.opportunity_ids[0]},reason:'完成通知不等于传达实际数据'}];
   }
  }
  else if(req.stage==='decision'){
   const view=JSON.parse(req.messages.at(-1).content);
   const row=view.choices.find(r=>turn===1?r.effect.activity_id==='measure-bank-light':
    turn===2?r.effect.contact_purpose?.key==='share-result':r.effect.contact_purpose?.key==='share-result-fields');
   assert.ok(row,'intended option exists');
   v={act:true,choice_id:row.id,inner_monologue:'我想记录实际变化，再把可以公开的部分告诉朋友。',expected_outcome:'留下真实记录',issue:{decision:'continue',id:'current'},motivation:'self_continuation',source_ids:[]};
  }else if(req.stage==='feedback')v=req.scene==='need_goal_generation'?{goal_updates:turn===3?[{operation:'complete',goal_id:'goal:send-readings',reason:'同一结果根的指定字段确已送达指定接收者'}]:[]}:{reason:'记录结果',emotion:'joy',intensity:.3,valence:.3};
  else if(req.stage==='memory')v=req.scene==='memory_importance'?{score:.8,reason:'实际结果'}:{focus_id:JSON.parse(req.messages.at(-1).content).facts[0].id,feeling:'curious',wish:'understand'};
  else if(req.stage==='followup'||req.stage==='followup_repair'){
   const receipt=cognitiveActualResult(w,OWNER,w.clock.synced_at)?.effects.communication;
   v={status:'continue',question:'之后怎样继续了解这里？',reason:receipt?.summary??'还想了解更多',delay_hours:1,next_step:null};
   if(receipt)v.communication_evidence_id=receipt.id;
   if(mode==='bad')v.reason=original.adopted_followup.reason;
  }else throw Error(req.stage);
  return JSON.stringify(v);
 };
 const run=async phase=>{
  const at=w.clock.synced_at,job=`evidence:${turn}:${phase}:${mode}`;
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase,job_id:job},at,job);
  const context=cognitiveContext(w,OWNER,at,phase);context.mode='mock';
  if(phase==='feedback'){context.result=cognitiveActualResult(w,OWNER,at);context.action=w.cognition.actors[OWNER].pending.action;}
  const proposal=await bridge.session(context,respond);
  const payload={actor_id:OWNER,operation:phase,phase,job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,OWNER),...(context.result?{result:context.result}:{})};
  if(phase==='feedback'&&context.result.effects.communication){
   const before=structuredClone(w),bad=structuredClone(payload);bad.proposal.followup.reason=original.adopted_followup.reason;
   assert.throws(()=>applyCognitiveMutation(w,bad,at,job),{code:'cognitive_communication_evidence_invalid'});assert.deepEqual(w,before);
  }
  applyCognitiveMutation(w,payload,at,job);
  return context;
 };
 await run('plan');settle(w,w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id));await run('feedback');
 const readings=structuredClone(w.cognition.actors[OWNER].last_result);
 turn=2;await run('plan');let task=w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id);settle(w,task);
 const receipt=task.cognitive_message.receipt;
 assert.equal(receipt.disclosures[0].kind,'completion_notice');assert.ok(!receipt.text.includes('蓄光'));
 assert.equal(cognitiveContext(w,OWNER,w.clock.synced_at).goal_lifecycle.goals.find(g=>g.goal_id==='goal:send-readings').evidence_ids.length,0);
 const taskCount=w.tasks.length,stock=structuredClone(w.living.inventories[OWNER]);
 mode='bad';await assert.rejects(run('feedback'),e=>e.failure?.cause_code==='cognitive_communication_evidence_invalid');
 // Close and reopen the same SQLite persistence used by the service. The
 // coordinator's failed job stays pending; resuming must not execute it again.
 const directory=mkdtempSync(join(tmpdir(),'deskbot-event-evidence-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const filename=join(directory,'world.sqlite');w.cognition.actors[OWNER].job.status='failed';
 const saved=createSqlitePersistence({filename});saved.put('canonical-world.states',w.world_id,w);saved.close();
 const reopened=createSqlitePersistence({filename});w=reopened.get('canonical-world.states',w.world_id);reopened.close();
 mode='good';await run('feedback');
 settleCognitiveTask(w,w.tasks.find(t=>t.task_id===task.task_id),w.clock.synced_at);
 assert.equal(w.tasks.length,taskCount);assert.deepEqual(w.living.inventories[OWNER],stock);
 assert.equal(w.cognition.actors[OWNER].outbox.filter(m=>m.receipt?.id===receipt.id).length,1);
 assert.ok(cognitiveContext(w,OWNER,w.clock.synced_at).speech_evidence.some(e=>e.id===readings.root_outcome_id&&e.disclosures?.some(d=>d.kind==='result_extract')));
 turn=3;await run('plan');task=w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id);settle(w,task);await run('feedback');
 const full=task.cognitive_message.receipt;assert.equal(full.disclosures[0].kind,'result_extract');assert.ok(full.text.includes('亮度'));
 assert.equal(full.text_sha256,createHash('sha256').update(full.text).digest('hex'));
 const peer=full.receiver_ids[0],received=w.cognition.actors[peer].inbox.find(m=>m.task_id===task.task_id);
 assert.deepEqual(received.receipt,full);assert.equal(received.contact_basis,undefined);
 assert.ok(w.cognition.actors[OWNER].followup.reason.includes('含回执列明的结果字段'));
 assert.equal(w.cognition.actors[OWNER].goal_bindings['goal:send-readings'].lifecycle_status,'completed');
});
