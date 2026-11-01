import {authoredFollowup} from '../../../services/deskbot-cognition/evaluations/authored-followup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation,settleCognitiveTask,cognitiveActualResult} from '../src/cognitive-life-state.mjs';
import {advanceWorldTask,applyRealTimeClock} from '../src/realtime-world.mjs';
import {advanceLivingResources} from '../src/living-resources.mjs';
import {advanceSocialLife,reservedSocialActors,respondCognitiveCommitment} from '../src/social-life.mjs';
import {deliverCognitiveSocialResults} from '../src/cognitive-social.mjs';
import {syncDevelopmentEvidence} from '../src/development-evidence.mjs';
const own='shaping-001',other='wetland-grower-001',third='lamp-keeper-001',BASE='2026-10-11T02:00:00.000Z';
function fixture(){
 const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(BASE)});
 api.ingest({event_id:'residents',type:'world.mutation',source:'fixture',character_id:own,payload:{action:'install_resident_life'}});
 const w=api.get();w.protagonist.location_id='moss-sprout-garden';for(const p of w.npcs)p.location_id='moss-sprout-garden';
 w.social.next_offer_at='2099-01-01T00:00:00Z';for(const s of Object.values(w.autonomy.actors)){s.paused=true;s.plan=null;}
 w.cognition={actors:{},epoch:BASE};w.memory??={episodes:[]};return w;
}
let seq=0;
function proposal(id,phase,fields={}){return {schema:'deskbot.cognitive-life.proposal.v3',goal_contract:'deskbot.goal-lifecycle.v1',goal_updates:[],actor_id:id,phase,state:{agent_id:id},memories:[],...fields};}
function share(w,id,receiver,fields={}){
 const at=w.clock.synced_at,job=`test-social-${++seq}`,context=cognitiveContext(w,id,at);
 const compiled={operation:'share',receiver_indices:[context.capabilities.share.receivers.findIndex(r=>r.actor_id===receiver)+1],message:'',message_parts:[],reason:'实验选择',title:'商量事情',...fields};
 applyCognitiveMutation(w,{actor_id:id,phase:'plan',operation:'claim',job_id:job},at,job+':claim');
 applyCognitiveMutation(w,{actor_id:id,phase:'plan',operation:'plan',job_id:job,relevant_key:cognitiveRelevantKey(w,id),proposal:proposal(id,'plan',{compiled,action:{agent_id:id}})},at,job+':plan');
 return w.tasks.find(t=>t.task_id===w.cognition.actors[id].pending.task_id);
}
function finish(w,task){
 const at=task.due_at;advanceLivingResources(w,at,{force:true});applyRealTimeClock(w,at);
 advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},at);settleCognitiveTask(w,task,at);
}
function feedback(w,id){
 const at=w.clock.synced_at,job=`test-feedback-${++seq}`,result=cognitiveActualResult(w,id,at);
 applyCognitiveMutation(w,{actor_id:id,phase:'feedback',operation:'claim',job_id:job},at,job+':claim');
 const receipt=result.effects?.communication;
 applyCognitiveMutation(w,{actor_id:id,phase:'feedback',operation:'feedback',job_id:job,result,proposal:proposal(id,'feedback',authoredFollowup(cognitiveContext(w,id,at,'feedback'),{status:'none',delay_hours:2}))},at,job+':adopt');
}
function perform(w,fields){
 const at=w.clock.synced_at,job=`test-action-${++seq}`;
 applyCognitiveMutation(w,{actor_id:own,phase:'plan',operation:'claim',job_id:job},at,job+':claim');
 applyCognitiveMutation(w,{actor_id:own,phase:'plan',operation:'plan',job_id:job,relevant_key:cognitiveRelevantKey(w,own),
  proposal:proposal(own,'plan',{compiled:{reason:'本地回归的实际行动',followup_decision:'continue',...fields},action:{agent_id:own}})},at,job+':plan');
 const task=w.tasks.find(t=>t.task_id===w.cognition.actors[own].pending.task_id);finish(w,task);feedback(w,own);
 return task;
}
function invite(w,option='visit'){const task=share(w,own,other,{social:{operation:'invite',option_id:option}});assert.equal(w.social.commitments.length,0);finish(w,task);feedback(w,own);return w.social.commitments[0];}
function reply(w,id,receiver,response,extra={}){
 const c=w.social.commitments[0];const task=share(w,id,receiver,{reply_to:w.cognition.actors[id].inbox.findLast(m=>m.sender_id===receiver)?.message_id??null,social:{operation:'respond',commitment_id:c.id,response,...extra}});finish(w,task);feedback(w,id);return task;
}
function tick(w,minutes=1){const at=new Date(Date.parse(w.clock.synced_at)+minutes*60000).toISOString();advanceLivingResources(w,at,{force:true});applyRealTimeClock(w,at);
 for(const t of w.tasks.filter(t=>t.status==='running'&&t.due_at<=at))advanceWorldTask(w,{task_id:t.task_id,expected_task_revision:t.revision},at);
 advanceSocialLife(w,at,{eventId:`tick:${at}`,reservedActors:[own,other,third]});deliverCognitiveSocialResults(w,at);
}

test('delivered invitation does not auto-accept, reserve unwilling recipient or survive expiry as success',()=>{
 const w=fixture();invite(w);for(let i=0;i<8;i++)tick(w,10);
 assert.equal(w.social.commitments[0].status,'proposed');assert.ok(!reservedSocialActors(w).includes(other));
 assert.equal(w.tasks.filter(t=>t.origin==='social_life').length,0);tick(w,11);
 assert.equal(w.social.commitments[0].status,'declined');assert.equal(Object.keys(w.social.relationships).length,0);
 assert.equal(w.cognition.actors[own].inbox.filter(m=>m.source_kind==='joint_result').length,1);
});
test('explicit accept executes shared time, one shared root, individual task roots and no duplicate practice on reload',()=>{
 let w=fixture();invite(w);reply(w,other,own,'accept');
 for(let i=0;i<20;i++)tick(w);
 const c=w.social.commitments[0];assert.equal(c.status,'completed');
 assert.equal(w.social.relationships[[own,other].sort().join('|')].kept,1);
 const inputs=[own,other].map(id=>w.cognition.actors[id].inbox.find(m=>m.source_kind==='joint_result'));
 assert.equal(inputs[0].root_outcome_id,inputs[1].root_outcome_id);
 assert.ok(!w.cognition.actors[third]?.inbox?.some(m=>m.source_kind==='joint_result'));
 syncDevelopmentEvidence(w,w.clock.synced_at);const shared=w.memory.development.records.filter(r=>r.root_outcome_id===inputs[0].root_outcome_id);
 assert.equal(shared.length,1);assert.equal(shared[0].effect.practice,false);assert.equal(shared[0].effect.relationship,true);
 const before=structuredClone(w.memory.development.records);w=JSON.parse(JSON.stringify(w));deliverCognitiveSocialResults(w,w.clock.synced_at);syncDevelopmentEvidence(w,w.clock.synced_at);
 assert.deepEqual(w.memory.development.records,before);assert.equal(w.cognition.actors[other].inbox.filter(m=>m.source_kind==='joint_result').length,1);
});
test('delay is a counteroffer that requires both actors to agree again and does not start early',()=>{
 const w=fixture();invite(w);reply(w,other,own,'delay',{delay_minutes:60});let c=w.social.commitments[0];assert.equal(c.status,'proposed');assert.equal(c.terms_revision,2);
 assert.throws(()=>respondCognitiveCommitment(w,w.clock.synced_at,c.id,own,'accept',{revision:1,messageId:'stale'}),{code:'commitment_terms_changed'});
 reply(w,own,other,'accept');tick(w,30);assert.equal(w.social.commitments[0].status,'accepted');assert.equal(w.tasks.filter(t=>t.origin==='social_life').length,0);
 tick(w,31);assert.equal(w.social.commitments[0].status,'working');
});
test('rejection and withdrawal are explicit, cause no invented relationship penalty, and preserve pending work',()=>{
 for(const response of ['decline','withdraw']){const w=fixture();invite(w);reply(w,other,own,response);assert.equal(w.social.commitments[0].status,response==='decline'?'declined':'withdrawn');tick(w);assert.equal(Object.keys(w.social.relationships).length,0);}
});
test('social delivery rechecks frozen terms and receiver presence atomically',()=>{
 const w=fixture();invite(w);const c=w.social.commitments[0];
 const task=share(w,other,own,{social:{operation:'respond',commitment_id:c.id,response:'accept'}});w.social.commitments[0].terms_revision++;
 const before=w.cognition.actors[own].inbox?.length??0;finish(w,task);assert.equal(task.status,'failed');assert.equal(w.social.commitments[0].responses[other],'pending');assert.equal(w.cognition.actors[own].inbox?.length??0,before);
});
test('reply links refer only to actually received messages and are recorded only after delivery',()=>{
 const w=fixture();invite(w);assert.throws(()=>share(w,other,own,{reply_to:'private-third-party',message_parts:[{kind:'greeting',text:'你好'}]}),{code:'reply_reference_invalid'});
 // Direct function mutation is normally rolled back by the canonical transaction.
 const fresh=fixture();invite(fresh);const source=fresh.cognition.actors[other].inbox[0];const task=reply(fresh,other,own,'decline');
 assert.equal(task.cognitive_message.reply_to,source.message_id);assert.equal(fresh.cognition.actors[other].outbox[0].reply_to,source.message_id);
});

test('a real recipient receipt wakes the sender waiting on its own outbox ID, without leaking private pacing state',()=>{
 const w=fixture();const first=share(w,own,other,{message_parts:[{kind:'question',text:'你愿意来看看吗？'}]});finish(w,first);feedback(w,own);
 const life=w.cognition.actors[own],sent=life.outbox[0],receipt=w.cognition.actors[other].inbox[0];
 assert.equal(receipt.contact_basis,undefined);
 life.followup={status:'postpone',followup_id:'visit-question',question:'等一条实际回复',wait_for:{kind:'reply',id:sent.message_id},created_at:BASE};
 life.inbox=[{message_id:'forged',sender_id:third,reply_to:receipt.message_id,at:BASE,text:'不是本次收件人的消息'}];
 assert.equal(cognitiveContext(w,own,w.clock.synced_at).continuation.current.condition,'waiting');
 const answer=share(w,other,own,{reply_to:receipt.message_id,message_parts:[{kind:'question',text:'你想看哪个地方？'}]});
 finish(w,answer);feedback(w,other);
 assert.equal(cognitiveContext(w,own,w.clock.synced_at).continuation.current.condition,'ready');
 assert.equal(w.social.commitments.length,0);
});

test('saved R3 paraphrase pattern cannot reset an unanswered issue by narrowing recipients, including after reload',()=>{
 let w=fixture();w.living.inventories[own]={stock:{water:4},capacity:24};
 perform(w,{operation:'observe',object_index:1});
 w.cognition.actors[own].followup={status:'continue',followup_id:'water-question',question:'清水如何交接',created_at:BASE};
 const context=cognitiveContext(w,own,w.clock.synced_at),indices=[other,third].map(id=>context.capabilities.share.receivers.findIndex(r=>r.actor_id===id)+1);
 const fields={followup_decision:'continue',followup_id:'water-question'};
 const first=share(w,own,other,{...fields,receiver_indices:indices,message_parts:[{kind:'question',text:'你们想不想一起看取水够不够亮？'}]});
 finish(w,first);feedback(w,own);w=JSON.parse(JSON.stringify(w));
 const outbox=structuredClone(w.cognition.actors[own].outbox),stock=structuredClone(w.living.inventories);
 const second=share(w,own,other,{...fields,message_parts:[{kind:'question',text:'我想当面问问，你愿意看一下清水怎么用吗？'}]});
 assert.equal(second,undefined);assert.equal(w.cognition.actors[own].pending.blocked.code,'duplicate_message_without_reply');
 assert.deepEqual(w.cognition.actors[own].outbox,outbox);assert.deepEqual(w.living.inventories,stock);
 feedback(w,own);
 // A concrete finite handoff is a different capability; no acceptance is invented.
 const offer=share(w,own,other,{...fields,social:{operation:'invite',option_id:'give-water'}});
 finish(w,offer);feedback(w,own);
 assert.equal(w.social.commitments[0].status,'proposed');assert.deepEqual(w.living.inventories,stock);
});

test('new actual observation permits a renewed contact but failed attempts and rest do not',()=>{
 const w=fixture(),observed=perform(w,{operation:'observe',object_index:1});
 w.cognition.actors[own].followup={status:'continue',followup_id:'observation-question',question:'一起看观察结果',from_root_outcome_id:observed.root_outcome_id,created_at:BASE};
 const fields={followup_decision:'continue',followup_id:w.cognition.actors[own].followup.followup_id};
 const first=share(w,own,other,{...fields,message_parts:[{kind:'question',text:'一起看看水边吗？'}]});finish(w,first);feedback(w,own);
 perform(w,{operation:'rest'});
 assert.equal(share(w,own,other,{...fields,message_parts:[{kind:'question',text:'过来看看如何？'}]}),undefined);feedback(w,own);
 perform(w,{operation:'observe',object_index:1});
 const next=share(w,own,other,{...fields,message_parts:[{kind:'question',text:'想讨论这次观察吗？'}]});finish(w,next);
 assert.equal(next.status,'completed');assert.equal(w.cognition.actors[own].outbox.length,2);
});
test('private views omit partner memories and ungrounded completion quotes are rejected',()=>{
 const w=fixture();invite(w);w.cognition.actors[other].secret='PRIVATE_DIARY_CANARY';w.cognition.actors[other].memories=[{id:'secret',payload:{stored_content:'PRIVATE_DIARY_CANARY'}}];
 const context=cognitiveContext(w,own,w.clock.synced_at);assert.ok(!JSON.stringify(context).includes('PRIVATE_DIARY_CANARY'));
 const evidence=context.speech_evidence[0];assert.throws(()=>share(w,own,other,{message_parts:[{kind:'evidence',evidence_id:evidence.id,quote:'我已经给苗床浇过水了'}]}),{code:'speech_evidence_mismatch'});
 const fresh=fixture();assert.throws(()=>share(fresh,own,other,{message_parts:[{kind:'question',text:'我已经修好苗架了，你觉得呢？'}]}),{code:'speech_unverified_completion'});
});
test('a gift commits finite inventory only after explicit agreement and actual local handoff',()=>{
 const w=fixture();w.living.inventories[own]={stock:{trays:1},capacity:24};w.living.inventories[other]={stock:{trays:0},capacity:24};
 invite(w,'give-tray');assert.equal(w.living.inventories[own].stock.trays,1);reply(w,other,own,'accept');tick(w);tick(w);
 assert.equal(w.social.commitments[0].status,'completed');assert.equal(w.living.inventories[own].stock.trays,0);assert.equal(w.living.inventories[other].stock.trays,1);
});

test('four water portions use the existing invitation, acceptance and handoff path without duplication on reload',()=>{
 let w=fixture();w.living.inventories[own]={stock:{water:4},capacity:24};w.living.inventories[other]={stock:{water:0},capacity:24};
 invite(w,'give-water');
 assert.equal(w.living.inventories[own].stock.water,4);
 assert.equal(w.social.commitments[0].status,'proposed');
 reply(w,other,own,'accept');assert.equal(w.living.inventories[own].stock.water,4);
 tick(w);tick(w);assert.equal(w.social.commitments[0].status,'completed');
 assert.equal(w.living.inventories[own].stock.water,0);assert.equal(w.living.inventories[other].stock.water,4);
 const before=structuredClone(w.living.inventories);
 w=JSON.parse(JSON.stringify(w));tick(w);
 assert.deepEqual(w.living.inventories,before);
 assert.equal(w.social.commitments[0].changes.filter(x=>x.offers).length,1);
});

test('declining, silence, insufficient stock and full recipient bag cannot manufacture a water handoff',()=>{
 for(const scenario of ['decline','silence','short','full']){
  const w=fixture();w.living.inventories[own]={stock:{water:4},capacity:24};w.living.inventories[other]={stock:{water:0},capacity:scenario==='full'?2:24};
  invite(w,'give-water');
  if(scenario==='decline')reply(w,other,own,'decline');
  else if(scenario!=='silence')reply(w,other,own,'accept');
  if(scenario==='short')w.living.inventories[own].stock.water=1;
  tick(w,scenario==='silence'?92:1);tick(w);
  assert.notEqual(w.social.commitments[0].status,'completed',scenario);
  assert.equal(w.living.inventories[other].stock.water,0,scenario);
  assert.equal(w.living.inventories[own].stock.water,scenario==='short'?1:4,scenario);
 }
});
test('agreed assistance travels, uses finite materials and delivers the actual tray',()=>{
 const w=fixture(),before=w.living.objects['parts-drawers'].stock.wood;
 invite(w,'ask-tray-help');reply(w,other,own,'accept');
 for(let i=0;i<90&&w.social.commitments[0].status!=='completed';i++)tick(w);
 const c=w.social.commitments[0];assert.equal(c.status,'completed',JSON.stringify({note:c.last_note,steps:c.worker_steps,tasks:w.tasks.map(t=>({kind:t.kind,title:t.title,status:t.status,due:t.due_at}))}));
 const task=w.tasks.find(t=>t.activity_id==='craft-tray');assert.equal(task.actor_id,other);assert.equal(task.status,'completed');assert.equal(task.accepted_obligation.commitment_id,c.id);
 assert.ok(w.living.objects['parts-drawers'].stock.wood<before);assert.ok(c.changes.some(r=>r.offers?.some(o=>o.resource==='trays')));
});
test('personal relation review preserves shared trust and the partner perspective, rejects invented bonds',()=>{
 const w=fixture();invite(w);reply(w,other,own,'decline');
 const at=w.clock.synced_at,job='review',context=cognitiveContext(w,own,at),sources=context.social.relation_evidence.find(e=>e.actor_id===other).sources;
 const peer=structuredClone(w.cognition.actors[other]),shared=structuredClone(w.social.relationships);
 applyCognitiveMutation(w,{actor_id:own,operation:'claim',phase:'relate',job_id:job},at,'r:claim');
 const p=proposal(own,'relate',{relation_views:[{actor_id:other,labels:['暂时保留'],summary:'我想给对方留一点自己的时间。',source_ids:sources.map(s=>s.id)}]});
 applyCognitiveMutation(w,{actor_id:own,operation:'relate',phase:'relate',job_id:job,proposal:p},at,'r:adopt');
 assert.deepEqual(w.social.relationships,shared);assert.deepEqual(w.cognition.actors[other],peer);assert.equal(w.cognition.actors[own].relation_views[0].epistemic,'personal_impression');
 p.relation_views[0].labels=['师徒'];assert.throws(()=>applyCognitiveMutation(w,{actor_id:own,operation:'relate',phase:'relate',job_id:job,proposal:p},at,'r:bad'),{code:'relation_view_content_invalid'});
});
