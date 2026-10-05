import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {syncDevelopmentEvidence,developmentReadModel} from '../src/development-evidence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {installAutonomy} from '../src/life-state.mjs';
import {installLivedMemory} from '../src/lived-memory.mjs';
import {LIVING_RULE_VERSION} from '../src/living-resources.mjs';

const START='2026-10-06T04:00:00.000Z',END='2026-10-06T05:00:00.000Z',OWN='shaping-001';
function empty(){return {protagonist:{character_id:OWN,display_name:'喵呜'},npcs:[],clock:{mode:'real_time',time_zone:'Asia/Shanghai',synced_at:END},tasks:[],memory:{episodes:[]}};}
const topic=(view,name)=>view.facets.actors[0].topics.find(t=>t.topic===name);
function task(id,activity,extra={}){return {task_id:id,actor_id:OWN,kind:'care',status:'completed',activity_id:activity,
  completion_effect:LIVING_RULE_VERSION,life_goal:'cook',life_action:activity?'activity':'observe',life_source_ids:[],origin:'autonomous_life',
  location_id:'moss-sprout-garden',finished_at:END,completion:{due_at:END,effect:LIVING_RULE_VERSION},...extra};}

test('the actual recipe keeps its topic across food plans and historical repeated views',()=>{
  const w=empty();w.tasks=[task('water','collect-water'),task('fruit','gather-light-fruit'),task('food','cook-grove-stew'),task('eat','share-meal')];
  syncDevelopmentEvidence(w,END);const view=developmentReadModel(w);
  assert.equal(topic(view,'care').capability.success_roots.length,2);
  assert.equal(topic(view,'cook').capability.success_roots.length,1);
  assert.equal(view.counts.practice,3,'eating cannot establish cooking competence');
  assert.ok(view.facets.actors[0].topics.every(t=>t.interest.bonus===0),'autonomous obligation alone is not liking');
  const before=structuredClone(view);w.tasks=[];syncDevelopmentEvidence(w,END);assert.deepEqual(developmentReadModel(w),before);
});

test('only admitted topical contact survives input pruning, without private text or practice',()=>{
  const w=empty();w.refraction={records:[
    {id:'owner',category:'dialogue',suggestion:'tend',attested:true,freshness:'fresh',received_at:START,text:'PRIVATE OWNER NOTE'},
    {id:'unverified',category:'agent',suggestion:'tray',attested:false,freshness:'fresh',received_at:START},
    {id:'truthy',category:'agent',suggestion:'tray',attested:'true',freshness:'fresh',received_at:START},
    {id:'stale',category:'external',meaning:'sourced_report',attested:true,freshness:'stale',received_at:START},
    {id:'future',category:'external',meaning:'sourced_report',attested:true,freshness:'fresh',received_at:'2027-01-01T00:00:00Z'}]};
  syncDevelopmentEvidence(w,END);const view=developmentReadModel(w);
  assert.equal(topic(view,'care').contact.count,1);assert.equal(view.counts.practice,0);
  assert.equal(view.facets.actors[0].topics.reduce((n,t)=>n+t.contact.count,0),1);
  assert.doesNotMatch(JSON.stringify(view),/PRIVATE/);
  assert.ok(view.facets.actors[0].topics.every(t=>t.interest.bonus===0&&t.capability.success_roots.length===0));
  w.refraction.records=[];syncDevelopmentEvidence(w,END);assert.deepEqual(developmentReadModel(w),view);
});

test('registered observation and canonical motivation survive archive views without adding a skill',()=>{
  const w=empty();w.tasks=[task('observe',null,{life_goal:'interest:moss-sprout-garden',life_topic:'care',life_motivation:{kind:'self_continuation',basis_score:30,facet_root_ids:[]}})];
  syncDevelopmentEvidence(w,END);const view=developmentReadModel(w);
  assert.deepEqual(topic(view,'care').interest.active_roots,['task:observe']);
  assert.equal(topic(view,'care').capability.success_roots.length,0);
  w.tasks=[];syncDevelopmentEvidence(w,END);assert.deepEqual(developmentReadModel(w),view);
});

test('an unknown observation cannot acquire an authored topic from its plan title',()=>{
  const w=empty();w.tasks=[task('unknown',null,{life_goal:'interest:new-unmapped-place',life_motivation:{kind:'self_continuation'}})];
  syncDevelopmentEvidence(w,END);const view=developmentReadModel(w);
  assert.equal(view.recent[0].topic,null);
  assert.ok(view.facets.actors[0].topics.every(t=>t.interest.active_roots.length===0));
});

test('SQLite execution records a damaged stove as a condition, ignores public psychology fields and refunds once',t=>{
  const directory=mkdtempSync(join(tmpdir(),'deskbot-facets-')),filename=join(directory,'world.sqlite');
  let time=Date.parse(START),persistence=createSqlitePersistence({filename});
  let world=createPersistentWorld({persistence,now:()=>new Date(time),timeMode:'realtime'});
  t.after(()=>{persistence.close();rmSync(directory,{recursive:true,force:true});});
  const initial=world.get();initial.protagonist.location_id='warm-pot-courtyard';
  installAutonomy(initial,START);installLivedMemory(initial,START);
  initial.living.inventories[OWN]={actor_id:OWN,stock:{moss:2},capacity:24};
  persistence.put('canonical-world.states',initial.world_id,initial);
  world=createPersistentWorld({persistence,now:()=>new Date(time),timeMode:'realtime'});
  const mutate=payload=>world.ingest({event_id:'actual-cook',type:'world.mutation',source:'isolated-rules',character_id:OWN,occurred_at:START,payload});
  mutate({action:'start_activity',activity_id:'cook-moss',task_id:'actual-cook',life_motivation:{kind:'self_continuation'},life_topic:'cook',failure_classification:'performance'});
  const running=world.get(),actual=running.tasks.find(task=>task.task_id==='actual-cook');
  assert.equal(actual.life_motivation,undefined,'public input cannot author a psychological cause');
  running.living.objects['trial-stove'].condition=.2;
  persistence.put('canonical-world.states',running.world_id,running);
  world=createPersistentWorld({persistence,now:()=>new Date(time),timeMode:'realtime'});
  time=Date.parse(actual.due_at);world.syncWallClock();world.syncTasks();
  const state=world.get(),finished=state.tasks.find(task=>task.task_id==='actual-cook');
  assert.equal(finished.status,'failed');assert.equal(finished.failure_code,'facility_damaged');assert.equal(finished.failure_classification,'condition');
  assert.equal(finished.reservation.status,'returned');assert.equal(state.living.inventories[OWN].stock.moss,2);
  const view=developmentReadModel(state),cook=topic(view,'cook');
  assert.deepEqual(cook.capability.condition_failure_roots,['task:actual-cook']);assert.equal(cook.capability.performance_failure_roots.length,0);
  assert.equal(cook.interest.bonus,0);assert.match(cook.self_assessment.summary,/不说明不会做/);
  persistence.close();persistence=createSqlitePersistence({filename});world=createPersistentWorld({persistence,now:()=>new Date(time),timeMode:'realtime'});
  assert.deepEqual(developmentReadModel(world.get()),view);world.syncTasks();assert.equal(world.get().living.inventories[OWN].stock.moss,2);
});
