import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,cases,OWNER,plus} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {cognitiveContext,applyCognitiveMutation} from '../src/cognitive-life-state.mjs';
import {freezeCognitiveReferences,cognitiveInputs} from '../src/cognitive-continuity.mjs';
import {adoptPositionKnowledge,selfPositionDisclosure} from '../src/cognitive-position-knowledge.mjs';
const seed=()=>fixture(cases.find(c=>c.id==='resources-1-off'));

test('thinking latency does not re-date a position disclosure or change its chosen identity',()=>{
 const w=seed(),at=w.clock.synced_at;
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:'position-latency'},at,'position-latency');
 const c=cognitiveContext(w,OWNER,at),later=cognitiveContext(w,OWNER,plus(at,3));
 const select=c=>c.choice_catalogue.choices.filter(e=>e.binding.contact_purpose?.key==='share-position');
 assert.ok(select(c).length);assert.deepEqual(select(c),select(later));
 assert.equal(select(later)[0].binding.disclosures[0].observed_at,at);
});

test('only committed same-place sightings persist; age degrades knowledge without reading private remote positions',()=>{
 const w=seed(),at=w.clock.synced_at,c=cognitiveContext(w,OWNER,at),peer=c.visible_people[0].actor_id;
 const before=JSON.stringify(w);assert.equal(c.event_evidence.people.find(p=>p.actor_id===peer).basis,'seen_here');
 assert.equal(JSON.stringify(w),before);const life=w.cognition.actors[OWNER];
 adoptPositionKnowledge(life,freezeCognitiveReferences(c));
 w.npcs.find(n=>n.npc_id===peer).location_id='moss-sprout-garden';
 let record=cognitiveContext(w,OWNER,plus(at,31)).event_evidence.people.find(p=>p.actor_id===peer);
 assert.equal(record.location_id,c.location.id);assert.equal(record.basis,'seen_before');assert.equal(record.freshness,'stale');assert.equal(record.current_verified,false);
 record=cognitiveContext(w,OWNER,plus(at,24*60+1)).event_evidence.people.find(p=>p.actor_id===peer);
 assert.equal(record.location_id,null);assert.equal(record.status,'unknown');assert.ok(record.source_id);
 assert.ok(!cognitiveContext(w,OWNER,at).event_evidence.people.some(p=>p.location_id==='moss-sprout-garden'));
});

test('only actually received structured self-position reports provide a clue, never prose or a signature',()=>{
 const w=seed(),at=w.clock.synced_at,c=cognitiveContext(w,OWNER,at),peer=c.visible_people[0].actor_id;
 const source=selfPositionDisclosure(c),life={position_knowledge:[]};
 // No delivered source: a selected/unsent disclosure changes nothing.
 adoptPositionKnowledge(life,{},[]);assert.deepEqual(life.position_knowledge,[]);
 const receiver=w.cognition.actors[peer]??={state:{},inbox:[]};
 w.cognition.admitted_actors=[OWNER,peer];
 receiver.inbox=[{message_id:'actual:received',sender_id:OWNER,at:plus(at,1),source_kind:'heard_message',text:source.text,disclosures:[source]}];
 adoptPositionKnowledge(receiver,{},cognitiveInputs(w,peer,plus(at,1)));
 assert.equal(receiver.position_knowledge[0].basis,'reported');assert.equal(receiver.position_knowledge[0].source_id,'actual:received');
 const before=structuredClone(receiver.position_knowledge);
 adoptPositionKnowledge(receiver,{},[{id:'signed-letter',sender_is_agent:false,sender_id:OWNER,epistemic:'reported',occurred_at:plus(at,2),position_reports:[{...source,location_id:'invented'}]},
  {id:'just-text',sender_is_agent:true,sender_id:OWNER,epistemic:'heard',occurred_at:plus(at,2),content:'我在月球'}]);
 assert.deepEqual(receiver.position_knowledge,before);
 w.protagonist.location_id='moss-sprout-garden';
 const report=cognitiveContext(w,peer,plus(at,2)).event_evidence.people.find(p=>p.actor_id===OWNER);
 assert.equal(report.location_id,c.location.id);assert.equal(report.status,'historical_clue');assert.equal(report.current_verified,false);
});

test('actual sighting wins over an equally dated report and known names alone have no positions',()=>{
 const w=seed(),c=cognitiveContext(w,OWNER,w.clock.synced_at),life=w.cognition.actors[OWNER],peer=c.visible_people[0].actor_id;
 life.known_people=[{actor_id:'remote-known',name:'只知道名字的居民'}];
 life.position_knowledge=[{actor_id:peer,location_id:'old-place',observed_at:c.at,basis:'reported',source_id:'message:old'}];
 adoptPositionKnowledge(life,freezeCognitiveReferences(c));
 assert.equal(life.position_knowledge[0].basis,'seen_before');assert.equal(life.position_knowledge[0].location_id,c.location.id);
 assert.ok(!cognitiveContext(w,OWNER,c.at).event_evidence.people.some(p=>p.actor_id==='remote-known'));
});
