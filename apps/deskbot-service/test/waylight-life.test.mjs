import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld,getWorldMap} from '../src/persistent-world.mjs';
import {startActivityTask,advanceWorldTask,controlWorldTask} from '../src/realtime-world.mjs';
import {advanceLivingResources,livingReadModel} from '../src/living-resources.mjs';
import {activitySteps} from '../src/life-planning.mjs';
import {installWaylightLife,advanceWaylightLife,waylightCandidates,waylightPersonalContext,waylightSocialOffers} from '../src/waylight-life.mjs';
import {proposeCognitiveCommitment,respondCognitiveCommitment,advanceSocialLife} from '../src/social-life.mjs';
import {activityTopic} from '../src/development-facets.mjs';

const start='2026-10-20T00:00:00.000Z',own='shaping-001',grower='wetland-grower-001',keeper='lamp-keeper-001';
const plus=(at,min)=>new Date(Date.parse(at)+min*60000).toISOString();
function fixture(){
  const api=createPersistentWorld({timeMode:'realtime',now:()=>new Date(start)});
  api.ingest({event_id:'r2-residents',type:'world.mutation',source:'fixture',payload:{action:'install_resident_life'}});
  const w=api.get();w.protagonist.location_id='echo-waterside';
  w.living.inventories[own]={stock:{light_leaf:4,wood:2,cloth:4,fasteners:3,waylight_shade:0},capacity:24};
  for(const id of [own,grower,keeper])Object.assign(w.autonomy.actors[id],{energy:.9,appetite:.1,paused:false,plan:null});
  return w;
}
function perform(w,activity,at=w.clock.synced_at,id=own){
  advanceLivingResources(w,at,{force:true});w.clock.synced_at=at;
  const tid=`r2:${activity}:${w.tasks.length}`;
  startActivityTask(w,{actor_id:id,task_id:tid,activity_id:activity},{eventId:tid,at});
  const task=w.tasks.find(t=>t.task_id===tid);advanceLivingResources(w,task.due_at,{force:true});w.clock.synced_at=task.due_at;
  advanceWorldTask(w,{task_id:tid,expected_task_revision:task.revision},task.due_at);return task;
}
test('additive installation leaves an empty hook, preserves stocks and existing life, and is idempotent',()=>{
  const w=fixture(),before=structuredClone(w);
  assert.equal(w.living.objects['floating-frame'].waylight,null);
  assert.equal(installWaylightLife(w,plus(start,100)),false);assert.deepEqual(w,before);
  assert.equal(w.waylight_life.records.length,0);
  assert.ok(livingReadModel(w).activities.find(a=>a.activity_id==='waylight-build-open').available);
  assert.throws(()=>activitySteps(w,own,'waylight-craft-shade'), /水岸还没有灯/);
});
test('two real methods consume different materials, no light is granted before daylight, cancellation refunds exactly',()=>{
  const open=fixture(),hooded=fixture(),cancel=fixture(),inventory=structuredClone(cancel.living.inventories[own]);
  const a=perform(open,'waylight-build-open'),b=perform(hooded,'waylight-build-hooded');
  assert.equal(a.status,'completed');assert.equal(b.status,'completed');
  assert.equal(open.living.inventories[own].stock.cloth-hooded.living.inventories[own].stock.cloth,1);
  assert.equal(open.living.objects['floating-frame'].waylight.charge,0);
  assert.equal(open.living.objects['floating-frame'].waylight.setup_root,`task:${a.task_id}`);
  assert.throws(()=>perform(open,'waylight-build-hooded'),{code:'activity_unavailable'});
  startActivityTask(cancel,{actor_id:own,task_id:'cancel',activity_id:'waylight-build-open'},{eventId:'cancel',at:start});
  controlWorldTask(cancel,{task_id:'cancel',operation:'cancel'},start);
  assert.deepEqual(cancel.living.inventories[own],inventory);assert.equal(cancel.living.objects['floating-frame'].waylight,null);
});
test('material planning reaches real forest leaves and town materials; no free source or repeated frame',()=>{
  const w=fixture();w.living.inventories[own].stock={};w.living.objects['windleaf-canopy'].stock.light_leaf=2;
  const before=JSON.stringify(w),steps=activitySteps(w,own,'waylight-build-open');
  assert.ok(steps.some(s=>s.kind==='travel'&&s.location_id==='windleaf-lowland'));
  assert.ok(steps.some(s=>s.activity_id==='leaf-gather'));
  assert.ok(steps.some(s=>s.kind==='travel'&&s.location_id==='spare-parts-house'));
  assert.equal(steps.at(-1).activity_id,'waylight-build-open');assert.equal(JSON.stringify(w),before);
  w.living.objects['windleaf-canopy'].stock.light_leaf=0;assert.throws(()=>activitySteps(w,own,'waylight-build-open'));
});
test('the same lamp serves another evening after serialization; water and light are actually consumed',()=>{
  let w=fixture();perform(w,'waylight-build-hooded');const asset=w.living.objects['floating-frame'].waylight.asset_id;
  const night='2026-10-20T11:00:00.000Z';advanceLivingResources(w,night,{force:true});w.clock.synced_at=night;
  const water=w.living.inventories[own].stock.water??0,first=perform(w,'waylight-use');assert.equal(first.status,'completed');
  assert.equal(w.living.inventories[own].stock.water,water+4);assert.throws(()=>perform(w,'waylight-use'),{code:'activity_unavailable'});
  w=JSON.parse(JSON.stringify(w));const second=perform(w,'waylight-use','2026-10-21T11:00:00.000Z');
  assert.equal(second.status,'completed');const lamp=w.living.objects['floating-frame'].waylight;
  assert.equal(lamp.asset_id,asset);assert.equal(lamp.use_count,2);assert.equal(lamp.last_use.root_outcome_id,`task:${second.task_id}`);
  assert.equal(activityTopic('waylight-use'),'care');assert.equal(activityTopic('waylight-open'),null);
  assert.equal(getWorldMap(w).objects.find(o=>o.object_id==='floating-frame').state.waylight.asset_id,asset);
});
test('rain and wind produce different physical outcomes; no fabricated past weather and low light blocks use',()=>{
  const a=fixture(),b=fixture();perform(a,'waylight-build-open');perform(b,'waylight-build-hooded');
  const la=a.living.objects['floating-frame'].waylight,lb=b.living.objects['floating-frame'].waylight;
  la.charge=lb.charge=.8;const t=Date.parse('2026-10-20T10:00:00Z');
  advanceWaylightLife(a,t,t+4*3600000,{daylight:false,rain:.12,evaporation:.01,wind:12});
  advanceWaylightLife(b,t,t+4*3600000,{daylight:false,rain:.12,evaporation:.01,wind:12});
  assert.ok(la.moisture>lb.moisture);assert.ok(la.condition<lb.condition);assert.ok(la.charge<lb.charge);assert.ok(la.dark_bank_hours<lb.dark_bank_hours);
  la.charge=0;la.brightness=0;a.clock.synced_at='2026-10-20T14:00:00.000Z';a.living.simulated_until=a.clock.synced_at;
  assert.throws(()=>perform(a,'waylight-use'),{code:'activity_unavailable'});
});
test('weather or asset change during an admitted use fails with all raw water refunded, never mints clean water',()=>{
  const w=fixture();perform(w,'waylight-build-open');advanceLivingResources(w,'2026-10-20T11:00:00.000Z',{force:true});w.clock.synced_at='2026-10-20T11:00:00.000Z';
  const frame=w.living.objects['floating-frame'],water=frame.stock.raw_water,tid='blocked-use';
  startActivityTask(w,{actor_id:own,task_id:tid,activity_id:'waylight-use'},{eventId:tid,at:w.clock.synced_at});
  const t=w.tasks.find(t=>t.task_id===tid);advanceLivingResources(w,t.due_at,{force:true});const beforeRefund=frame.stock.raw_water;
  frame.waylight.brightness=0;advanceWorldTask(w,{task_id:tid,expected_task_revision:t.revision},t.due_at);
  assert.equal(t.status,'failed');assert.equal(frame.stock.raw_water,beforeRefund+4);assert.ok(frame.stock.raw_water>=water);assert.equal(w.living.inventories[own].stock.water??0,0);
});
test('hood persists, adjustment cooldown prevents oscillation, repair preserves origin and wear history',()=>{
  const w=fixture();perform(w,'waylight-build-hooded');const l=w.living.objects['floating-frame'].waylight;
  assert.throws(()=>perform(w,'waylight-open'),{code:'activity_unavailable'});
  perform(w,'waylight-open',plus(w.clock.synced_at,361));assert.equal(l.mode,'open');assert.throws(()=>perform(w,'waylight-shade'),{code:'activity_unavailable'});
  l.condition=.5;const origin=l.setup_root;perform(w,'waylight-repair');assert.equal(l.setup_root,origin);assert.equal(l.patches,1);assert.ok(l.condition<1);
});
test('needs remain first, blocked people do not gain opportunity, and private context cannot see distant live state',()=>{
  const w=fixture();assert.equal(waylightCandidates(w,own,start).length,2);
  w.autonomy.actors[own].appetite=.8;assert.deepEqual(waylightCandidates(w,own,start),[]);
  w.protagonist.location_id='fog-lamp-square';assert.equal(waylightPersonalContext(w,own).local_asset,null);
  assert.deepEqual(waylightCandidates(w,'pot-cook-001',start),[]);
});
test('help can be declined or delayed without changing the shared lamp or creating materials',()=>{
  const w=fixture();perform(w,'waylight-build-open');const offer=waylightSocialOffers(w)[0],before=JSON.stringify(w.living.objects['floating-frame'].waylight);
  const c=proposeCognitiveCommitment(w,w.clock.synced_at,offer,keeper,'request');
  respondCognitiveCommitment(w,w.clock.synced_at,c.id,grower,'delay',{revision:1,messageId:'later',delayMinutes:60});
  assert.equal(c.status,'proposed');assert.equal(c.terms_revision,2);
  respondCognitiveCommitment(w,w.clock.synced_at,c.id,keeper,'decline',{revision:2,messageId:'decline'});
  assert.equal(c.status,'declined');assert.equal(JSON.stringify(w.living.objects['floating-frame'].waylight),before);
  assert.equal(w.waylight_life.records.length,1);
});
test('accepted help requires real travel, craft, handoff and installation; restart does not duplicate the hood',()=>{
  let w=fixture();perform(w,'waylight-build-open');const c=proposeCognitiveCommitment(w,w.clock.synced_at,waylightSocialOffers(w)[0],keeper,'join-request');
  respondCognitiveCommitment(w,w.clock.synced_at,c.id,grower,'accept',{revision:1,messageId:'accept'});
  w.social.next_offer_at='2099-01-01T00:00:00.000Z';const startMs=Date.parse(w.clock.synced_at);
  for(let i=1;i<=180;i++){
    const at=new Date(startMs+i*60000).toISOString();advanceLivingResources(w,at,{force:true});w.clock.synced_at=at;
    for(const t of w.tasks.filter(t=>t.status==='running'&&t.due_at<=at))advanceWorldTask(w,{task_id:t.task_id,expected_task_revision:t.revision},at);
    advanceSocialLife(w,at,{eventId:`r2-social:${i}`});
    if(i===45)w=JSON.parse(JSON.stringify(w));
    if(!['accepted','meeting','working'].includes(w.social.commitments.find(x=>x.id===c.id).status))break;
  }
  const done=w.social.commitments.find(x=>x.id===c.id);assert.equal(done.status,'completed',done.last_note);
  assert.equal(w.living.objects['floating-frame'].waylight.has_hood,true);
  assert.equal(w.waylight_life.records.filter(r=>r.activity_id==='waylight-fit-shade').length,1);
  assert.ok(w.tasks.some(t=>t.actor_id===keeper&&t.activity_id==='waylight-craft-shade'&&t.status==='completed'));
  assert.ok(w.tasks.some(t=>t.actor_id===grower&&t.activity_id==='waylight-fit-shade'&&t.status==='completed'));
});
