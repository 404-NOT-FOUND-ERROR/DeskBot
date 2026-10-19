import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {resolveRuntimeProfile,bindRuntimeStore,assertDistinctStores} from '../src/runtime-profile.mjs';
import {createModelUsage} from '../src/model-usage.mjs';
import {createDeskBotServer} from '../src/app.mjs';
import {createCognitiveRuntime} from '../src/cognitive-runtime.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {createCognitiveBudget} from '../src/cognitive-budget.mjs';

function fixture(t){const dir=mkdtempSync(join(tmpdir(),'deskbot-r1c-')),filename=join(dir,'world.sqlite'),p=createSqlitePersistence({filename});t.after(()=>{p.close();rmSync(dir,{recursive:true,force:true});});return {dir,p,filename};}
test('lab requires an explicit independent path and cannot reuse a live-bound or unclassified world, including a hard link',t=>{
 const {dir,p,filename}=fixture(t);assert.throws(()=>resolveRuntimeProfile({env:{DESKBOT_RUN_SCOPE:'lab'},defaultDatabase:filename}),{code:'lab_database_required'});
 assert.throws(()=>resolveRuntimeProfile({env:{DESKBOT_RUN_SCOPE:'lab',DESKBOT_DB_PATH:filename},defaultDatabase:filename}),{code:'runtime_store_collision'});
 const alias=join(dir,'alias.sqlite');linkSync(filename,alias);assert.throws(()=>assertDistinctStores({live:filename,lab:alias}),{code:'runtime_store_collision'});
 p.put('canonical-world.states','w',{world_id:'w'});assert.throws(()=>bindRuntimeStore(p,{scope:'lab'}),{code:'runtime_unclassified_save'});
 bindRuntimeStore(p,{scope:'live',allowLegacy:true});assert.throws(()=>bindRuntimeStore(p,{scope:'lab',allowLegacy:true}),{code:'runtime_store_scope_mismatch'});
});
test('experiment clock and approval cannot enable live cognition, and aliased lab paths fail before world changes',async t=>{
 const {dir,p,filename}=fixture(t),world=createPersistentWorld({persistence:p,timeMode:'realtime'}),before=world.get();
 assert.throws(()=>createCognitiveRuntime({world,worldFilename:filename,budgetFilename:join(dir,'budget.sqlite'),experimentFilename:filename}),{code:'runtime_store_collision'});
 const runtime=createCognitiveRuntime({world,worldFilename:filename,budgetFilename:join(dir,'budget.sqlite'),experimentFilename:join(dir,'experiment.sqlite')});
 assert.equal(runtime.status().live.enabled,false);
 await assert.rejects(runtime.run({scope:'live',actor_id:'shaping-001'}),{code:'live_cognition_not_enabled'});
 assert.deepEqual(await runtime.tick(),[]);assert.deepEqual(world.get(),before);assert.equal(runtime.status().experiment.budget.calls.length,0);await runtime.close();
});
test('usage retains failures and partial known costs on restart, distinguishes scope and fixtures, and counts retry latency once per logical request',t=>{
 const {p}=fixture(t);let usage=createModelUsage({persistence:p,runId:'first'});
 usage.record({call_id:'a',request_id:'r',scope:'live',category:'chat',status:'failed',latency_ms:20,request_elapsed_ms:20,model:'deepseek-flash',usage:{prompt_tokens:100,completion_tokens:10}});
 usage.record({call_id:'b',request_id:'r',scope:'live',category:'chat',status:'completed',latency_ms:30,request_elapsed_ms:51,model:'deepseek-flash',usage:{prompt_tokens:200,completion_tokens:10,prompt_cache_hit_tokens:100}});
 usage.record({call_id:'c',scope:'lab',status:'calling',model:'deepseek-flash'});
 usage.record({call_id:'mock',scope:'isolated_test_clock',status:'completed',provider_kind:'fixture',model:'deepseek-flash',usage:{prompt_tokens:999,completion_tokens:999},prompt:'SECRET'});
 usage=createModelUsage({persistence:p,runId:'second'});
 assert.equal(usage.status({scope:'live'}).totals.request_latency_ms.samples,1);assert.equal(usage.status({scope:'live'}).totals.request_latency_ms.p95,51);
 assert.equal(usage.status({scope:'live'}).totals.input_tokens,300);assert.equal(usage.status({scope:'lab'}).totals.estimated_upper_cny,0);
 assert.equal(usage.status({scope:'lab'}).totals.usage_unknown,1);assert.equal(usage.status().recent.find(r=>r.call_id==='c').status,'interrupted');
 assert.doesNotMatch(JSON.stringify(usage.status()),/SECRET/);assert.equal(usage.status().totals.cost_known_attempts,2);
});
test('serialized cognition records queue latency separately without charging idempotent replay',async t=>{
 const {p}=fixture(t),ledger=createModelUsage({persistence:p});let release,called=false;
 const gate=new Promise(r=>release=r),broker=createCognitiveBudget({persistence:p,onUsage:ledger.record,testProvider:async()=>{if(!called){called=true;await gate;}return {choices:[{finish_reason:'stop',message:{content:'{}'}}]};}});
 const request={messages:[{role:'user',content:'fictional'}],json_mode:true,phase:'plan',usage_scope:'lab'};
 const first=broker.complete('a',request),second=broker.complete('b',request);await new Promise(r=>setTimeout(r,25));release();await Promise.all([first,second]);await broker.complete('b',request);await broker.close();
 assert.equal(ledger.status().totals.attempts,2);assert.ok(ledger.status().recent.find(r=>r.call_id==='b').queue_ms>=20);
});
test('usage and storage HTTP routes are reachable, read-only, bounded by server scopes and do not start cognition',async t=>{
 const {p}=fixture(t),ledger=createModelUsage({persistence:p});let cognitionReads=0;
 const server=createDeskBotServer({persistence:p,modelUsage:ledger,cognitiveRuntime:{status:()=>{cognitionReads++;return {};},tick:async()=>[],close:async()=>{}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`,before=server.persistentWorld.get();
 assert.equal((await fetch(base+'/api/life/model-usage?scope=live')).status,200);assert.equal((await fetch(base+'/api/life/model-usage?scope=secret')).status,400);
 const obs=await(await fetch(base+'/api/runtime/observability')).json();assert.ok(obs.storage.allocated_bytes>0);assert.equal(obs.read_only,true);
 assert.equal(cognitionReads,0);assert.deepEqual(server.persistentWorld.get(),before);
});
