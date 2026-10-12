import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { installResidentLife } from '../src/resident-life.mjs';
import { advanceSocialLife } from '../src/social-life.mjs';

const BASE='2026-10-04T04:00:00.000Z',cook='pot-cook-001',sound='sound-player-001';
const at=minutes=>new Date(Date.parse(BASE)+minutes*60000).toISOString();
function world() {
  const w=createPersistentWorld({now:()=>new Date(BASE),timeMode:'realtime'}).get();
  installResidentLife(w,BASE);
  w.social.next_offer_at=BASE;
  w.living.objects['floating-frame'].condition=1;
  w.living.objects['seedling-rack'].stock.trays=2;
  w.living.objects['shared-table'].stock.rations=0;
  for(const inventory of Object.values(w.living.inventories))inventory.stock={};
  for(const state of Object.values(w.autonomy.actors)){state.energy=.8;state.appetite=.2;state.plan=null;state.paused=false;}
  w.memory={episodes:[],maintenance:{actors:{}}};
  return w;
}
function view(w,actorId,targetId,label='grateful_to',overrides={}) {
  const id=`joint:${actorId}:${targetId}`;
  w.memory.episodes.push({id,at:BASE,kind:'world_fact',actor_ids:[actorId,targetId],model_safe:true,
    source:{kind:'canonical_commitment',commitment_id:id},outcome:'completed'});
  const state=w.memory.maintenance.actors[actorId]??={relations:[]};
  state.relations.push({actor_id:targetId,label,authority:'subjective_view',source_ids:[id],at:BASE,
    expires_at:at(60),...overrides});
  return id;
}

test('a grounded subjective view changes offer order without creating a new partner, resources, history or numeric relation',()=>{
  const base=world(),preferred=structuredClone(base);
  const sourceId=view(preferred,cook,sound);
  const history=structuredClone(preferred.memory),stock=structuredClone(preferred.living),npcs=structuredClone(preferred.npcs);
  advanceSocialLife(base,BASE,{eventId:'base-offer'});
  advanceSocialLife(preferred,BASE,{eventId:'preferred-offer'});
  assert.notEqual(base.social.commitments[0].actors[0],cook);
  assert.deepEqual(preferred.social.commitments[0].actors,[cook,sound]);
  assert.equal(preferred.social.commitments[0].preference_score,3);
  assert.deepEqual(preferred.social.commitments[0].preference_source_ids,[sourceId]);
  assert.equal(preferred.social.commitments[0].preference_views[0].authority,'subjective_view');
  assert.deepEqual(preferred.social.relationships,{});
  assert.deepEqual(preferred.memory,history);assert.deepEqual(preferred.living,stock);assert.deepEqual(preferred.npcs,npcs);
});

for(const [name,overrides,change]of[
  ['expired',{expires_at:BASE}],
  ['future',{at:at(1)}],
  ['unattested',{authority:'world_fact'}],
  ['missing source',{source_ids:['missing']}],
  ['source is interpretation',{},w=>{w.memory.episodes[0].kind='personal_interpretation';}],
  ['source misses partner',{},w=>{w.memory.episodes[0].actor_ids=[cook];}],
  ['future source',{},w=>{w.memory.episodes[0].at=at(1);}],
])test(`${name} relation view does not bias offers or fabricate a relationship`,()=>{
  const base=world(),candidate=structuredClone(base);
  view(candidate,cook,sound,'grateful_to',overrides);change?.(candidate);
  advanceSocialLife(base,BASE,{eventId:'base'});advanceSocialLife(candidate,BASE,{eventId:'candidate'});
  assert.deepEqual(candidate.social.commitments.map(c=>c.actors),base.social.commitments.map(c=>c.actors));
  assert.ok(candidate.social.commitments.every(c=>!c.preference_source_ids));assert.deepEqual(candidate.social.relationships,{});
});

test('wary and positive views stay bounded and canonical needs keep their priority',()=>{
  const w=world();
  view(w,cook,sound,'grateful_to');view(w,sound,cook,'comfortable_with');
  w.living.objects['floating-frame'].condition=.5;
  advanceSocialLife(w,BASE,{eventId:'need-first'});
  assert.equal(w.social.commitments[0].key,'cooperate:frame');
  assert.equal(w.social.commitments[1].preference_score,3,'mutual views cannot multiply the bounded bonus');
  const cautious=world();view(cautious,'pathfinder-001','echo-postcarrier-001','wary_of');
  advanceSocialLife(cautious,BASE,{eventId:'cautious'});
  assert.notEqual(cautious.social.commitments[0].actors[0],'pathfinder-001');
  assert.deepEqual(cautious.social.relationships,{});
});

for(const [name,prepare,reservedActors]of[
  ['paused',w=>{w.autonomy.actors[cook].paused=true;}],
  ['hungry',w=>{w.autonomy.actors[cook].appetite=.95;}],
  ['busy',w=>{w.tasks.push({task_id:'busy',actor_id:cook,status:'running',kind:'care'});} ],
  ['reserved',()=>{},[cook]],
  ['unreachable',w=>{w.npcs.find(n=>n.npc_id===cook).location_id='missing-place';}],
])test(`a ${name} preferred participant is not admitted by preference scoring`,()=>{
  const w=world();view(w,cook,sound);prepare(w);
  advanceSocialLife(w,BASE,{eventId:'blocked-preference',reservedActors});
  assert.ok(w.social.commitments.every(c=>!c.actors.includes(cook)));assert.deepEqual(w.social.relationships,{});
});

test('world messages due before a social cancellation deliver once and do not alter relationship evidence',()=>{
  const w=world();w.social.next_offer_at=at(100);
  const c={id:'due-invitation',key:'due-invitation',kind:'visit',actors:[cook,sound],title:'先聊一会儿',reason:'已有安排',
    location_id:'warm-pot-courtyard',status:'proposed',created_at:BASE,updated_at:BASE,respond_after:BASE,
    deadline_at:at(90),responses:{[cook]:'join',[sound]:'pending'},arrivals:{},tasks:{},phase:'meeting',changes:[],delay_count:0};
  w.social.commitments.push(c);w.autonomy.actors[sound].paused=true;
  const result=advanceSocialLife(w,at(1),{eventId:'delivery'});
  assert.equal(result.message_transport.queued,1);assert.equal(result.message_transport.delivered,1);
  assert.equal(w.social.message_transport.records[0].status,'delivered');
  assert.equal(w.social.commitments[0].status,'declined');assert.deepEqual(w.social.relationships,{});
  const messages=structuredClone(w.social.message_transport);
  const again=advanceSocialLife(w,at(1),{eventId:'delivery'});
  assert.equal(again.message_transport.changed,false);assert.deepEqual(w.social.message_transport,messages);
});
