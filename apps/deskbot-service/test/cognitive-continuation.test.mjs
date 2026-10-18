import test from 'node:test';
import assert from 'node:assert/strict';
import {cognitiveTime,cognitiveContinuationContext,cognitiveWaitFollowup,cognitiveResultFollowup,archiveCognitiveFollowup,duplicateUnansweredMessage} from '../src/cognitive-continuation.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveRelevantKey} from '../src/cognitive-life-state.mjs';
import {scheduleCognitiveActor} from '../src/cognitive-schedule.mjs';
import {installResidentLife} from '../src/resident-life.mjs';
import {developmentFixture,policyChoice,OWNER,BASE} from '../../../services/deskbot-cognition/evaluations/development-fixtures.mjs';
const later=(at,minutes)=>new Date(Date.parse(at)+minutes*60000).toISOString();
function wetland(){
 const w=developmentFixture();w.protagonist.location_id='floating-garden';
 const frame=w.living.objects['floating-frame'];
 frame.echo_bells=[{bell_id:'actual-bell',owner_id:OWNER,height:.5,changed_at:BASE,last_read_at:null}];
 return w;
}
const menu=[{activity_id:'echo-read-bell',title:'实际测记',available:false,reason:'半小时冷却'}];
test('local dates and canonical UTC represent the same instant across midnight',()=>{
 const t=cognitiveTime('2026-10-11T18:04:37.000Z');
 assert.equal(t.local,'2026-10-12 02:04:37');assert.equal(t.utc,'2026-10-11T18:04:37.000Z');
});
test('method readiness uses actual law durations and stays distinct from other blockers',()=>{
 const w=wetland(),rack=w.living.objects['seedling-rack'];rack.glow_trials=[{owner_id:OWNER,trial_id:'trial',changed_at:BASE,started_at:BASE}];
 const view=cognitiveContinuationContext(w,OWNER,later(BASE,10),[...menu,{activity_id:'glow-read-pair',available:false}]);
 assert.equal(view.wait_options[0].minutes_until_clock_ready,20);
 assert.equal(view.wait_options[1].minutes_until_clock_ready,110);
 const after=cognitiveContinuationContext(w,OWNER,later(BASE,40),menu);
 assert.equal(after.wait_options[0].minutes_until_clock_ready,0);assert.equal(after.wait_options[0].available,false);
});
test('waiting preserves the original question and root and reviews at the real cooldown',()=>{
 const w=wetland(),life=w.cognition.actors[OWNER];
 life.followup={status:'continue',question:'风起后杯声会怎样变化',from_root_outcome_id:'task:actual-prior',created_at:BASE};
 const at=later(BASE,5),view=cognitiveContinuationContext(w,OWNER,at,menu);
 life.followup=cognitiveWaitFollowup(life,{reason:'等待浮铃稳定',followup_decision:'continue',wait_for:{kind:'activity',id:'echo-read-bell'},review_after_minutes:60},view,at);
 assert.equal(life.followup.question,'风起后杯声会怎样变化');assert.equal(life.followup.from_root_outcome_id,'task:actual-prior');
 assert.equal(life.followup.next_review_at,later(BASE,30));assert.equal(life.followup.wait_count,1);
});
test('only a delivered own message and a correlated actual reply satisfy reply waiting',()=>{
 const w=developmentFixture(),life=w.cognition.actors[OWNER];
 life.outbox=[{message_id:'delivered',at:BASE,receiver_ids:['lamp-keeper-001'],text:'一起观察吗'}];
 life.inbox=[{message_id:'unrelated',reply_to:'other-message',sender_id:'lamp-keeper-001',at:BASE,text:'你好'}];
 life.followup={status:'postpone',question:'商量一次观察',wait_for:{kind:'reply',id:'delivered'},created_at:BASE,wait_started_at:BASE};
 assert.equal(cognitiveContinuationContext(w,OWNER,later(BASE,30)).current.condition,'waiting');
 life.inbox.push({message_id:'actual-reply',reply_to:'delivered',sender_id:'lamp-keeper-001',at:later(BASE,31),text:'我今天没空'});
 const current=cognitiveContinuationContext(w,OWNER,later(BASE,31)).current;
 assert.equal(current.condition,'ready');assert.equal(life.followup.status,'postpone'); // No fabricated acceptance.
});
test('rewriting a wait does not renew its six-hour review boundary, explicit postponement can release it',()=>{
 const w=developmentFixture(),life=w.cognition.actors[OWNER];life.outbox=[{message_id:'own-message',at:BASE,receiver_ids:['lamp-keeper-001'],text:'有空吗'}];
 life.followup={status:'postpone',question:'想听灯穗对余辉的意见',from_root_outcome_id:'task:sent',wait_for:{kind:'reply',id:'own-message'},created_at:BASE,wait_started_at:BASE};
 const at=later(BASE,300),view=cognitiveContinuationContext(w,OWNER,at);
 life.followup=cognitiveWaitFollowup(life,{reason:'再等一次',followup_decision:'continue',wait_for:{kind:'reply',id:'own-message'}},view,at);
 const serialized=JSON.parse(JSON.stringify(w)); // Same state a persistence reload receives.
 assert.equal(cognitiveContinuationContext(serialized,OWNER,later(BASE,361)).current.condition,'review_required');
 assert.equal(life.followup.wait_started_at,BASE);
 life.followup=cognitiveWaitFollowup(life,{reason:'先留着这个问题，今天做别的',followup_decision:'postpone',wait_for:null},cognitiveContinuationContext(w,OWNER,later(BASE,361)),later(BASE,361));
 assert.equal(life.followup.wait_for,null);assert.equal(life.followup.question,'想听灯穗对余辉的意见');
});
test('unknown wait references reject before mutating personal state or resources',()=>{
 const w=developmentFixture(),at=w.clock.synced_at,job='bad-wait';
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:job},at,job+':claim');const before=structuredClone(w);
 assert.throws(()=>applyCognitiveMutation(w,{actor_id:OWNER,operation:'plan',job_id:job,relevant_key:cognitiveRelevantKey(w,OWNER),proposal:{schema:'deskbot.cognitive-life.proposal.v3',actor_id:OWNER,phase:'plan',state:{},compiled:{operation:'wait',reason:'偷看私信',wait_for:{kind:'reply',id:'private-other-message'}}}},at,job+':adopt'),{code:'followup_condition_unknown'});
 assert.deepEqual(w,before);
});
test('duplicate unanswered messages are blocked as non-executed attempts, without another delivery',()=>{
 const w=developmentFixture();installResidentLife(w,BASE);
 const npc=w.npcs.find(n=>n.npc_id==='lamp-keeper-001');npc.location_id=w.protagonist.location_id;
 policyChoice(w,{operation:'share',receiver_indices:[1],message:'你好',motivation:'unknown'});
 const life=w.cognition.actors[OWNER],sent=structuredClone(life.outbox),stock=structuredClone(w.living.inventories[OWNER]);
 policyChoice(w,{operation:'share',receiver_indices:[1],message:'你好',motivation:'unknown'});
 assert.equal(life.last_result.not_executed,true);assert.match(life.last_result.failure_reason??life.last_result.fact,/重复|相同|同样|duplicate/);
 assert.deepEqual(life.outbox,sent);assert.deepEqual(w.living.inventories[OWNER],stock);
});
test('new actual replies allow another message; no passive waiting creates practice or an accepted promise',()=>{
 const w=developmentFixture(),life=w.cognition.actors[OWNER],outgoing={text:'你好',receiver_ids:['lamp-keeper-001']};
 life.outbox=[{...outgoing,message_id:'m',at:BASE}];assert.ok(duplicateUnansweredMessage(w,OWNER,outgoing));
 life.inbox=[{message_id:'r',reply_to:'m',sender_id:'lamp-keeper-001'}];assert.equal(duplicateUnansweredMessage(w,OWNER,outgoing),null);
 const before=structuredClone(w.memory.development),f=cognitiveResultFollowup(life,{status:'drop',question:'今天先放下',reason:'没有想继续的事',delay_hours:24},cognitiveContinuationContext(w,OWNER,BASE),BASE,'task:actual');
 life.followup={status:'continue',question:'原问题'};archiveCognitiveFollowup(life,BASE,f.reason);life.followup=f;
 assert.equal(life.followup_archive[0].question,'原问题');assert.equal(f.from_root_outcome_id,'task:actual');assert.deepEqual(w.memory.development,before);
});
test('condition review wakes an idle actor but never takes over sleep or a running task',()=>{
 const w=developmentFixture(),at=later(BASE,60),life=w.cognition.actors[OWNER];life.enabled=true;life.next_decision_at=later(BASE,120);life.schedule={last_dispatch_at:BASE};
 const context={perceptions:[],social:{commitments:[]},refraction:{pending:[]},continuation:{urgent_review:true}};
 assert.equal(scheduleCognitiveActor(w,OWNER,at,context).reason,'followup_condition_review');
 w.tasks.push({actor_id:OWNER,status:'running'});assert.equal(scheduleCognitiveActor(w,OWNER,at,context),null);w.tasks=[];
 assert.equal(scheduleCognitiveActor(w,OWNER,'2026-10-11T16:00:00Z',context).phase,'rest_window');
});
test('actual continuation retains the original issue while new work has a distinct root',()=>{
 const life={followup:{status:'continue',question:'原问题',followup_id:'issue-old',from_root_outcome_id:'task:old'}},context={wait_options:[]};
 const next=cognitiveResultFollowup(life,{status:'continue',question:'实际结果后的新问题',reason:'继续',delay_hours:1},context,BASE,'task:new','continue');
 assert.equal(next.followup_id,'issue-old');assert.equal(next.origin_root_outcome_id,'task:old');assert.equal(next.from_root_outcome_id,'task:new');
 const separate=cognitiveResultFollowup(life,{status:'continue',question:'另一件事',reason:'换方向',delay_hours:1},context,BASE,'task:other','new');
 assert.equal(separate.followup_id,'task:other');
});
test('an actual changed commitment permits a renewed invitation without inventing a message reply',()=>{
 const w=developmentFixture(),life=w.cognition.actors[OWNER],outgoing={text:'我想邀请你一起看灯',receiver_ids:['lamp-keeper-001']};
 life.outbox=[{...outgoing,message_id:'m',commitment_id:'c',at:BASE}];w.social??={};w.social.commitments=[{id:'c',status:'proposed',responses:{'lamp-keeper-001':'pending'}}];
 assert.ok(duplicateUnansweredMessage(w,OWNER,outgoing));w.social.commitments[0].status='declined';
 assert.equal(duplicateUnansweredMessage(w,OWNER,outgoing),null);
});
