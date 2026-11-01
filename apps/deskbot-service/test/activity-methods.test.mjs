import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fixture,cases,OWNER,settle,tick,plus} from '../../../services/deskbot-cognition/evaluations/r3-fixtures.mjs';
import {ACTIVITIES} from '../src/living-resources.mjs';
import {methodView,validateMethodRegistry} from '../src/activity-methods.mjs';
import {startActivityTask,controlWorldTask} from '../src/realtime-world.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveRelevantKey,cognitiveActualResult} from '../src/cognitive-life-state.mjs';
import {validateProductionUse} from '../src/cognitive-grounding.mjs';
import {activityTopic} from '../src/development-facets.mjs';
import {issueResolutionEvidence} from '../src/cognitive-issue-evidence.mjs';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {findCognitionPython} from '../src/cognition-bridge.mjs';
const seed=()=>fixture(cases.find(c=>c.id==='resources-1-off'));
const view=(w,id)=>methodView(w,OWNER,id,w.clock.synced_at);
const context=w=>cognitiveContext(w,OWNER,w.clock.synced_at);
function start(w,activity,id=activity){
 startActivityTask(w,{actor_id:OWNER,activity_id:activity,task_id:id},{eventId:id,at:w.clock.synced_at});
 return w.tasks.find(t=>t.task_id===id);
}
const document=JSON.parse(readFileSync(new URL('../../../contracts/activity-methods.v1.json',import.meta.url)));

test('registry admits only bounded selectors, known executors, finite recipes and explicit topics',()=>{
 assert.deepEqual(validateMethodRegistry(document),[]);
 for(const mutate of [d=>d.methods.push(d.methods[0]),d=>d.methods[0].executor='eval',
  d=>d.methods[0].conditions[0].field='inventories.someone_else.stock.water',d=>d.methods[0].recipe.inputs[0].count=-1,
  d=>d.methods[0].topic='invented-profession',d=>d.methods[2].recipe.output={container:'bag',resource:'water',count:100},
  d=>d.methods[1].experiment.axes.push('waylight.charge')]){
   const bad=structuredClone(document);mutate(bad);assert.ok(validateMethodRegistry(bad).length);
 }
 assert.equal(new Set(ACTIVITIES.map(a=>a.activity_id)).size,ACTIVITIES.length);
 for(const m of document.methods)assert.equal(activityTopic(m.id),m.topic);
});

test('ordinary water uses the registered recipe and cannot masquerade as a light experiment',()=>{
 const w=seed(),water=start(w,'collect-water');
 assert.equal(water.duration_ms,600000);assert.equal(water.method_binding.conditions,null);
 settle(w,water);assert.equal(water.status,'completed');
 assert.equal(w.living.inventories[OWNER].stock.water,4);
 assert.equal(water.completion.result.method_result.condition_key,null);
 assert.equal(view(w,'collect-water').experiment,null);
 assert.ok(!context(w).choice_catalogue.choices.some(r=>r.binding.activity_id==='collect-water'));
 assert.equal(w.living.method_evidence,undefined);
});

test('a condition proof survives issue rename and task rotation; actual hood change permits a new trial',()=>{
 const w=seed(),initial=view(w,'waylight-use').experiment;
 assert.ok(initial.available);
 settle(w,start(w,'waylight-use','open-use'));
 const proof=view(w,'waylight-use').experiment;
 assert.equal(proof.available,false);assert.deepEqual(proof.prior_roots,['task:open-use']);
 w.cognition.actors[OWNER].followup.question='换个措辞继续做水';
 w.cognition.actors[OWNER].followup.followup_id='renamed';w.tasks=[];
 tick(w,plus(w.clock.synced_at,121));
 assert.equal(view(w,'waylight-use').experiment.condition_key,initial.condition_key,'natural charge drift and time do not mint a condition');
 assert.ok(!context(w).choice_catalogue.choices.some(r=>r.binding.activity_id==='waylight-use'));
 settle(w,start(w,'waylight-fit-shade','fit'));
 const changed=view(w,'waylight-use').experiment;
 assert.ok(changed.available);assert.notEqual(changed.condition_key,initial.condition_key);
 assert.ok(context(w).choice_catalogue.choices.some(r=>r.binding.activity_id==='waylight-use'&&r.binding.production_use.kind==='experiment'));
 settle(w,start(w,'waylight-use','hooded-use'));
 assert.equal(w.living.inventories[OWNER].stock.water,8);
 assert.equal(Object.keys(w.living.method_evidence[OWNER]).length,2);
 assert.equal(view(w,'waylight-use').experiment.available,false);
});

test('condition changes and cancellation refund resources and never create proof',()=>{
 for(const condition of ['subject','hood','version','cancel']){
  const w=seed(),before=w.living.objects['floating-frame'].stock.raw_water,t=start(w,'waylight-use','interrupted');
  if(condition==='cancel')controlWorldTask(w,{task_id:t.task_id,operation:'cancel'},w.clock.synced_at);
  else {
   if(condition==='subject')w.living.objects['floating-frame'].waylight.asset_id='replacement';
   if(condition==='hood')w.living.objects['floating-frame'].waylight.mode='hooded';
   if(condition==='version')t.method_binding.definition_hash='old-version';
   settle(w,t);
   assert.equal(t.status,'failed');assert.ok(['method_conditions_changed','method_rules_changed'].includes(t.failure_code));
  }
  assert.equal(t.reservation.status,'returned');
  assert.ok(w.living.objects['floating-frame'].stock.raw_water>=before);
  assert.equal(w.living.inventories[OWNER].stock.water??0,0);assert.equal(w.living.method_evidence,undefined);
 }
});

test('material shortage, day and full storage do not offer an executable trial',()=>{
 const missing=seed();missing.living.objects['floating-frame'].stock.raw_water=0;
 assert.throws(()=>start(missing,'waylight-use'),e=>e.blocker_code==='material_shortage');
 const full=seed();full.living.inventories[OWNER].stock.water=24;
 assert.throws(()=>start(full,'waylight-use'),e=>e.blocker_code==='output_storage_full');
 const day=seed();tick(day,'2026-10-21T00:00:00.000Z');
 assert.throws(()=>start(day,'measure-bank-light'),e=>e.blocker_code==='method_requires_night');
 assert.ok(!context(day).choice_catalogue.choices.some(r=>r.binding.activity_id==='measure-bank-light'));
});

test('sample extension uses the original executor and common evidence without producing resources or changing light',()=>{
 const w=seed(),baseline=structuredClone(w),inventory=structuredClone(w.living.inventories[OWNER]);
 const t=start(w,'measure-bank-light','measure');settle(w,t);tick(baseline,w.clock.synced_at);
 assert.equal(t.status,'completed');assert.deepEqual(w.living.inventories[OWNER],inventory);
 assert.deepEqual(w.living.objects['floating-frame'].waylight,baseline.living.objects['floating-frame'].waylight);
 const result=t.completion.result.method_result;
 assert.equal(result.topic,'explore');assert.equal(result.causal_claim,false);assert.deepEqual(result.stock_changes,[]);
 assert.ok(result.before['waylight.brightness']>result.after['waylight.brightness']);
 const record=w.memory.development.records.find(r=>r.root_outcome_id==='task:measure');
 assert.equal(record.topic,'explore');assert.equal(record.outcome,'completed');assert.ok(record.effect.practice);
 assert.throws(()=>start(w,'measure-bank-light','duplicate'),e=>e.blocker_code==='method_condition_already_observed');
 assert.ok(context(w).choice_catalogue.choices.some(r=>r.binding.operation==='observe'),'ordinary observation remains available');
});

test('registered task and proof persist through SQLite restart and settle exactly once',t=>{
 const dir=mkdtempSync(join(tmpdir(),'deskbot-methods-')),filename=join(dir,'world.sqlite');
 let persistence=createSqlitePersistence({filename});
 t.after(()=>{persistence.close();rmSync(dir,{recursive:true,force:true});});
 let w=seed();w.world_id='deskbot-small-world';const task=start(w,'waylight-use','restore-method');
 const due=task.due_at,initial=structuredClone(task.method_binding);
 persistence.put('canonical-world.states',w.world_id,w);persistence.close();
 persistence=createSqlitePersistence({filename});
 let api=createPersistentWorld({persistence,timeMode:'realtime',now:()=>new Date(due)});
 // Restore the stored world with its existing identity and no model process.
 api.syncTasks();w=api.get();
 const finished=w.tasks.find(x=>x.task_id==='restore-method');assert.ok(finished);
 assert.equal(finished.status,'completed');assert.deepEqual(finished.method_binding,initial);
 const before=structuredClone(w.living.method_evidence);api.syncTasks();assert.deepEqual(api.get().living.method_evidence,before);
 persistence.close();persistence=createSqlitePersistence({filename});
 api=createPersistentWorld({persistence,timeMode:'realtime',now:()=>new Date(due)});
 assert.deepEqual(api.get().living.method_evidence,before);
});

test('old pending activities keep their old settlement and do not gain fabricated method evidence',()=>{
 const w=seed(),t=start(w,'waylight-use','legacy');delete t.method_binding;
 settle(w,t);assert.equal(t.status,'completed');assert.equal(t.completion.result.method_result,undefined);
 assert.equal(w.living.method_evidence,undefined);assert.equal(w.living.inventories[OWNER].stock.water,4);
});

test('new condition-specific targets bind in Python, Node executes, and factual memory keeps the method',()=>{
 const w=seed(),at=w.clock.synced_at,job='sample-choice';
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:job},at,'claim');
 const c=context(w),row=c.choice_catalogue.choices.find(r=>r.binding.activity_id==='measure-bank-light');
 const payload={act:true,choice_id:row.id,inner_monologue:'想用实际记录了解这盏灯的明暗变化',expected_outcome:'获得一次观察',issue:{decision:'continue',id:'current'},motivation:'self_exploration',source_ids:[]};
 const script=`import json,sys
from types import SimpleNamespace as NS
from catalogue_choice import bind_catalogue_choice
from life_semantics import production_errors
from life_worker import valid_life_compilation,valid_continuation_binding
c,p=json.load(sys.stdin)
_,b=bind_catalogue_choice(p,c,[NS(action_type=NS(value=k)) for k in ('work','physical','send_message','move','rest')],[])
assert valid_life_compilation(b) and valid_continuation_binding(b,c) and not production_errors(b,c)
json.dump(b,sys.stdout,ensure_ascii=False)`;
 const py=spawnSync(findCognitionPython(),['-c',script],{cwd:fileURLToPath(new URL('../../../services/deskbot-cognition/',import.meta.url)),
  input:JSON.stringify([c,payload]),encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}});
 assert.equal(py.status,0,py.stderr);const compiled=JSON.parse(py.stdout);
 assert.equal(compiled.completion_target_id,row.step_target_id);
 const proposal={schema:'deskbot.cognitive-life.proposal.v3',goal_contract:'deskbot.goal-lifecycle.v1',goal_updates:[],actor_id:OWNER,phase:'plan',state:{},action:{inner_monologue:compiled.reason},compiled,
  decision_method:compiled.activity_id,decision_production:null,choice_binding:{contract:'choice-catalogue-v2',actor_payload:payload,compiled:structuredClone(compiled),model_compile_calls:0}};
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'plan',job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,OWNER)},at,'adopt');
 const t=w.tasks.find(t=>t.task_id===w.cognition.actors[OWNER].pending.task_id);settle(w,t);
 assert.ok(cognitiveActualResult(w,OWNER,w.clock.synced_at).memory_frame.facts.find(f=>f.id==='method'));
 const issue=w.cognition.actors[OWNER].pending;
 assert.ok(issueResolutionEvidence(w,OWNER,issue).includes(`task:${t.task_id}`));
 const wrong=structuredClone(issue);wrong.completion_target.method_condition_key='another-condition';wrong.completion_proofs=[];
 assert.deepEqual(issueResolutionEvidence(w,OWNER,wrong),[]);
});

test('production trial purpose cannot bypass the recorded condition or batch size',()=>{
 const w=seed();w.living.inventories[OWNER].stock.water=4;const c=context(w);
 const row=c.choice_catalogue.choices.find(r=>r.binding.activity_id==='waylight-use'&&r.binding.production_use.kind==='experiment');
 const bound={...row.binding,production_use:{...row.binding.production_use,reason:'记录条件'},followup_decision:'continue',followup_id:row.requires_issue,completion_target_id:row.step_target_id};
 validateProductionUse(bound,c);
 assert.throws(()=>validateProductionUse({...bound,production_use:{...bound.production_use,target_stock:12}},c),/production_use_invalid/);
 settle(w,start(w,'waylight-use','proof'));
 assert.throws(()=>validateProductionUse(bound,context(w)),/production_use_invalid/);
 const remote=structuredClone(w);remote.protagonist.location_id='town-square';
 assert.equal(view(remote,'waylight-use'),null,'remote local conditions are not projected');
});

test('Node and Python agree on valid trials, stale condition, invented method and excess batch',()=>{
 const w=seed();w.living.inventories[OWNER].stock.water=4;const c=context(w);
 const row=c.choice_catalogue.choices.find(r=>r.binding.activity_id==='waylight-use'&&r.binding.production_use.kind==='experiment');
 const valid={...row.binding,production_use:{...row.binding.production_use,reason:'在实际条件下记录'},followup_decision:'continue',followup_id:row.requires_issue,completion_target_id:row.step_target_id};
 const pairs=[[valid,c]];
 for(const edit of [v=>v.production_use.target_stock=12,v=>v.completion_target_id='activity:waylight-use',
  v=>{v.activity_id='collect-water';v.production_use.activity_id='collect-water';}]){
  const v=structuredClone(valid);edit(v);pairs.push([v,c]);
 }
 const stale=structuredClone(c);stale.use_context.production.find(p=>p.activity_id==='waylight-use').experiment.available=false;
 pairs.push([valid,stale]);
 const expected=pairs.map(([v,c])=>{try{validateProductionUse(v,c);return true;}catch{return false;}});
 assert.deepEqual(expected,[true,false,false,false,false]);
 const py=spawnSync(findCognitionPython(),['-c','import json,sys; from life_semantics import production_errors; print(json.dumps([not production_errors(v,c) for v,c in json.load(sys.stdin)]))'],
  {cwd:fileURLToPath(new URL('../../../services/deskbot-cognition/',import.meta.url)),input:JSON.stringify(pairs),encoding:'utf8',windowsHide:true});
 assert.equal(py.status,0,py.stderr);assert.deepEqual(JSON.parse(py.stdout),expected);
});
