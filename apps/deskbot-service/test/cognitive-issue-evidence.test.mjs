import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cases,settle} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {developmentFixture,policyChoice,OWNER,BASE} from '../../../services/deskbot-cognition/evaluations/development-fixtures.mjs';
import {cognitiveContext} from '../src/cognitive-life-state.mjs';
import {prepareCognitiveFollowup,cognitiveResultFollowup,validateFollowupTransition,duplicateUnansweredMessage} from '../src/cognitive-continuation.mjs';
import {issueResolutionEvidence,issueContactBasis} from '../src/cognitive-issue-evidence.mjs';
import {startActivityTask} from '../src/realtime-world.mjs';
import {exchangeResidentResources} from '../src/social-life.mjs';
const close=(kind,evidence_ids=[])=>({followup_decision:'none',followup_closure:{followup_id:'issue',kind,reason:'明确选择',evidence_ids}});
function bind(w,target){
 const life=w.cognition.actors[OWNER];life.followup={status:'continue',followup_id:'issue',question:'原问题',created_at:w.clock.synced_at};
 prepareCognitiveFollowup(life,{followup_decision:'continue',completion_target_id:target},cognitiveContext(w,OWNER,w.clock.synced_at).continuation,w.clock.synced_at);
 return life.followup;
}
test('closure certifies the bound installation on the exact asset, not a delivered message or older work',()=>{
 const w=fixture(cases.find(c=>c.id==='invitation-3-on')),issue=bind(w,'activity:waylight-fit-shade');
 const before=structuredClone(w.cognition.actors[OWNER]);
 assert.throws(()=>prepareCognitiveFollowup(w.cognition.actors[OWNER],close('resolved',['task:fixture-built-lamp']),cognitiveContext(w,OWNER,w.clock.synced_at).continuation,w.clock.synced_at),{code:'followup_resolution_without_result'});
 assert.deepEqual(w.cognition.actors[OWNER],before);
 const t=startActivityTask(w,{actor_id:OWNER,task_id:'shade',activity_id:'waylight-fit-shade'},{eventId:'shade',at:w.clock.synced_at}).task;
 settle(w,w.tasks.find(x=>x.task_id===t.task_id));
 assert.deepEqual(issueResolutionEvidence(w,OWNER,issue),['task:shade']);
 assert.deepEqual(issueResolutionEvidence(w,OWNER,{...issue,completion_target:{...issue.completion_target,asset_id:'another-lamp'}}),[]);
 assert.deepEqual(issueResolutionEvidence(w,OWNER,{...issue,target_bound_at:'2099-01-01T00:00:00Z'}),[]);
 prepareCognitiveFollowup(w.cognition.actors[OWNER],close('resolved',['task:shade']),cognitiveContext(w,OWNER,w.clock.synced_at).continuation,w.clock.synced_at);
 assert.equal(w.cognition.actors[OWNER].followup_archive[0].resolution.kind,'resolved');
});
test('handoff needs actual conserved transfer to the named peer, with the declared amount',()=>{
 const w=fixture(cases.find(c=>c.id==='resources-1-on')),peer='wetland-grower-001';
 w.living.inventories[OWNER].stock.water=4;
 const issue=bind(w,`handoff:give-water:${peer}`),c={id:'gift',actors:[OWNER,peer],status:'completed',location_id:w.protagonist.location_id,changes:[],offers:[{from:OWNER,to:peer,resource:'water',count:4}]};
 w.social.commitments.push(c);
 assert.deepEqual(issueResolutionEvidence(w,OWNER,issue),[]); // Status/terms alone are insufficient.
 exchangeResidentResources(w,c,w.clock.synced_at,c.offers);
 assert.deepEqual(issueResolutionEvidence(w,OWNER,issue),['commitment:gift']);
 assert.equal(w.living.inventories[OWNER].stock.water,0);
 for(const target of [{recipient_id:'lamp-keeper-001'},{resource:'trays'},{count:5}])
  assert.deepEqual(issueResolutionEvidence(w,OWNER,{...issue,completion_target:{...issue.completion_target,...target}}),[]);
});
test('subjective closure is recorded separately and cannot install a model-authored objective',()=>{
 const w=developmentFixture(),life=w.cognition.actors[OWNER];life.followup={status:'continue',followup_id:'issue',question:'听够了没有'};
 const context=cognitiveContext(w,OWNER,BASE).continuation,before=structuredClone(w.living);
 assert.throws(()=>validateFollowupTransition({...close('resolved'),completion_target:{kind:'made-up'}},context),{code:'followup_server_fields'});
 prepareCognitiveFollowup(life,close('satisfied'),context,BASE);
 assert.equal(life.followup_archive[0].resolution.kind,'satisfied');assert.deepEqual(w.living,before);
});
test('all eight deferred issues survive a full-queue switch, restart and explicit closure; overflow is atomic',()=>{
 let w=developmentFixture(),life=w.cognition.actors[OWNER];life.followup={status:'continue',followup_id:'current',question:'当前'};
 life.deferred_followups=Array.from({length:8},(_,i)=>({status:'postpone',followup_id:`q${i}`,question:`问题${i}`}));
 const before=structuredClone(life);
 assert.throws(()=>prepareCognitiveFollowup(life,{followup_decision:'new'},cognitiveContext(w,OWNER,BASE).continuation,BASE),{code:'followup_deferred_full'});
 assert.deepEqual(life,before);
 prepareCognitiveFollowup(life,{followup_decision:'continue',followup_id:'q3'},cognitiveContext(w,OWNER,BASE).continuation,BASE);
 assert.equal(life.followup.followup_id,'q3');assert.equal(life.deferred_followups.length,8);
 w=JSON.parse(JSON.stringify(w));life=w.cognition.actors[OWNER];
 const result=prepareCognitiveFollowup(life,{followup_id:'q6',followup_decision:'drop',followup_closure:{followup_id:'q6',kind:'abandoned',reason:'不再追问',evidence_ids:[]}},cognitiveContext(w,OWNER,BASE).continuation,BASE);
 assert.equal(result.preserved_current,true);assert.equal(life.followup.followup_id,'q3');assert.equal(life.deferred_followups.length,7);
 assert.equal(life.followup_archive[0].followup_id,'q6');
});
test('a bound target survives a task result and serialization without accepting an easier target',()=>{
 const w=developmentFixture(),issue=bind(w,'activity:water-bed'),life=w.cognition.actors[OWNER];
 policyChoice(w,{operation:'activity',activity_id:'water-bed',followup_id:'issue'});
 assert.deepEqual(life.followup.completion_target,issue.completion_target);
 const current=w.cognition.actors[OWNER],view=cognitiveContext(w,OWNER,w.clock.synced_at).continuation;
 assert.throws(()=>prepareCognitiveFollowup(current,{followup_decision:'continue',completion_target_id:'activity:tend-bed'},view,w.clock.synced_at),{code:'followup_target_changed'});
 assert.throws(()=>cognitiveResultFollowup(current,{status:'none',question:'',reason:'',delay_hours:1,completion_target:{}},view,BASE,'task:new'),{code:'followup_server_fields'});
 assert.ok(issueResolutionEvidence(JSON.parse(JSON.stringify(w)),OWNER,current.followup).length);
});
test('unrelated work and new unrelated sources cannot refresh an unanswered issue',()=>{
 const w=developmentFixture(),issue=bind(w,'activity:water-bed');
 const first=issueContactBasis(w,OWNER,issue);
 w.cognition.actors[OWNER].outbox=[{message_id:'sent:one',at:BASE,receiver_ids:['peer'],text:'第一问',contact_basis:first}];
 w.tasks.push({task_id:'unrelated',actor_id:OWNER,status:'completed',activity_id:'unrelated',target_object_id:'other-place',finished_at:'2026-10-01T03:00:00Z'});
 const basis=issueContactBasis(w,OWNER,issue,[{id:'news',content:'一条无关的新闻'}]);basis.source_ids=['news'];
 assert.ok(duplicateUnansweredMessage(w,OWNER,{receiver_ids:['peer'],text:'换个说法',contact_basis:basis}));
 w.tasks.push({task_id:'relevant',actor_id:OWNER,status:'completed',activity_id:'water-bed',target_object_id:'garden-bed',finished_at:'2026-10-01T03:00:00Z'});
 assert.equal(duplicateUnansweredMessage(w,OWNER,{receiver_ids:['peer'],text:'有新的实际动作',contact_basis:issueContactBasis(w,OWNER,issue)}),null);
});
