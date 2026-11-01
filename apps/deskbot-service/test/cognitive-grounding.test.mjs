import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cases} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext,cognitiveRelevantKey,applyCognitiveMutation} from '../src/cognitive-life-state.mjs';
import {cognitiveWorkingState,freezeCognitiveReferences} from '../src/cognitive-continuity.mjs';
import {validateDecisionContact} from '../src/cognitive-grounding.mjs';
import {cognitiveInvitationAvailable,proposeCognitiveCommitment} from '../src/social-life.mjs';
const own='shaping-001',peer='wetland-grower-001';
const world=()=>fixture(cases.find(c=>c.id==='resources-1-on'));

test('grounding keeps raw and filtered water distinct and identifies only the visible asset owner',()=>{
  const w=world(),before=JSON.stringify(w),c=cognitiveContext(w,own,w.clock.synced_at);
  assert.equal(c.grounding.resources.water,'清水');assert.equal(c.grounding.resources.raw_water,'泉水原水');
  assert.equal(c.grounding.assets[0].owner_id,own);assert.equal(c.grounding.assets[0].owner_name,'我');
  assert.match(c.grounding.quantities['waylight.charge'],/蓄光量/);
  const other=cognitiveContext(w,peer,w.clock.synced_at);
  assert.equal(other.grounding.assets[0].owner_name,w.protagonist.display_name);
  assert.equal(JSON.stringify(w),before);
  w.protagonist.location_id='moss-sprout-garden';
  assert.deepEqual(cognitiveContext(w,own,w.clock.synced_at).grounding.assets,[]);
});

test('an old vivid memory retains its factual event anchor without copying another event or rewriting either',()=>{
  const fact={id:'old-fact',payload:{agent_id:own,stream:'factual',event_group_id:'event:water',raw_content:'背包增加4份清水',stored_content:'背包增加4份清水',importance:0}};
  const unrelated={id:'other-fact',payload:{agent_id:own,stream:'factual',event_group_id:'other-event',raw_content:'另一件事',importance:0}};
  const fillers=Array.from({length:500},(_,i)=>({id:`m${i}`,payload:{agent_id:own,stream:'factual',raw_content:'日常',importance:0}}));
  const feeling={id:'feeling',payload:{agent_id:own,stream:'experiential',event_group_id:'event:water',raw_content:'有一点成就感',stored_content:'有一点成就感',importance:.9}};
  const life={memories:[fact,unrelated,...fillers,feeling]},original=JSON.stringify(life);
  const loaded=cognitiveWorkingState(life,'成就感');
  assert.deepEqual(loaded.memories.find(m=>m.id==='old-fact'),fact);
  assert.deepEqual(loaded.memories.find(m=>m.id==='feeling'),feeling);
  assert.ok(loaded.memories.length<=80);assert.equal(JSON.stringify(life),original);
  // If the event bundle alone exceeds the context cap, omit it as a whole.
  fact.payload.raw_content='原文'.repeat(60000);
  const bounded=cognitiveWorkingState(life,'成就感');
  assert.ok(!bounded.memories.some(m=>m.id==='feeling'));
});

test('compiler cannot turn a chosen question into a gift, change recipient, or introduce unchosen contact',()=>{
  const c=cognitiveContext(world(),own,'2026-10-20T11:00:00.000Z'),refs=freezeCognitiveReferences(c);
  const index=refs.receivers.indexOf(peer)+1,issue=c.continuation.current.followup_id;
  const decision_contact={kind:'message',receiver_ids:[peer],followup_id:issue,source_ids:[]};
  const compiled={operation:'share',receiver_indices:[index],source_ids:[],followup_id:issue,social:null,reply_to:null};
  validateDecisionContact({decision_contact,compiled},refs);
  for(const change of [{social:{operation:'invite',option_id:'give-water'}},{receiver_indices:[1,2]},{followup_id:'another'},{operation:'rest'}])
    assert.throws(()=>validateDecisionContact({decision_contact,compiled:{...compiled,...change}},refs),{code:'decision_contact_changed_by_compiler'});
  assert.throws(()=>validateDecisionContact({decision_contact:null,compiled},refs),{code:'decision_contact_changed_by_compiler'});
  validateDecisionContact({decision_contact:{...decision_contact,kind:'invite',option_id:'visit'},compiled:{...compiled,social:{operation:'invite',option_id:'visit'}}},refs);
});

test('altered communication choice fails before adoption or resource changes',()=>{
  const w=world(),at=w.clock.synced_at,job='changed-choice';
  applyCognitiveMutation(w,{actor_id:own,operation:'claim',phase:'plan',job_id:job},at,'claim');
  const c=cognitiveContext(w,own,at),index=c.capabilities.share.receivers.find(r=>r.actor_id===peer).receiver_index;
  const before=JSON.stringify(w);
  assert.throws(()=>applyCognitiveMutation(w,{actor_id:own,operation:'plan',job_id:job,relevant_key:cognitiveRelevantKey(w,own),proposal:{
    schema:'deskbot.cognitive-life.proposal.v3',goal_contract:'deskbot.goal-lifecycle.v1',goal_updates:[],actor_id:own,phase:'plan',state:{agent_id:own},memories:[],
    decision_contact:{kind:'message',receiver_ids:[peer],source_ids:[],followup_id:c.continuation.current.followup_id},
    compiled:{operation:'share',receiver_indices:[index],source_ids:[],followup_id:c.continuation.current.followup_id,reason:'改变主意',social:{operation:'invite',option_id:'visit'}},
  }},at,'adopt'),{code:'decision_contact_changed_by_compiler'});
  assert.equal(JSON.stringify(w),before);
});

test('invitation affordances use the same pending agreement and cooldown gate as actual proposals',()=>{
  const w=world(),at=w.clock.synced_at,c=cognitiveContext(w,own,at),option=c.social.options.find(o=>o.option_id==='visit');
  const definition={...option,actors:[own,peer]};
  assert.equal(cognitiveInvitationAvailable(w,at,definition),true);
  const promise=proposeCognitiveCommitment(w,at,definition,own,'fixture-message');
  assert.equal(cognitiveInvitationAvailable(w,at,definition),false);
  const next=cognitiveContext(w,own,at);
  assert.ok(next.social.invitation_availability.filter(v=>v.receiver_id===peer).every(v=>!v.available));
  promise.status='withdrawn';w.social.cooldowns[promise.key]='2026-10-20T12:00:00.000Z';
  assert.equal(cognitiveInvitationAvailable(w,at,definition),false);
  assert.equal(cognitiveInvitationAvailable(w,'2026-10-20T13:00:00.000Z',definition),true);
});

test('external signed input and an actual resident receipt have distinct response routes',()=>{
  const w=fixture(cases.find(c=>c.id==='invitation-3-on')),at=w.clock.synced_at;
  w.cognition.actors[own].inbox=[{message_id:'received:real-peer',sender_id:peer,sender_name:'苔团',text:'你准备怎样试？',at}];
  const context=cognitiveContext(w,own,at),external=context.inputs.find(i=>i.id.startsWith('refraction:'));
  assert.equal(external.response_route.kind,'no_reply_address');
  assert.notEqual(external.sender_id,'lamp-keeper-001');
  const receipt=context.inputs.find(i=>i.id==='received:real-peer');
  assert.deepEqual(receipt.response_route,{kind:'local_message',message_id:'received:real-peer',sender_actor_id:peer});
  assert.deepEqual(context.social.replies.map(r=>r.message_id),['received:real-peer']);
});
