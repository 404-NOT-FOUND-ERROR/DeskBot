import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {memoryNamespace,prepareCognitiveArchive,persistCognitiveArchive,retrieveCognitiveMemories,rebuildCognitiveMemoryIndex} from '../src/cognitive-memory-archive.mjs';
import {cognitiveWorkingState} from '../src/cognitive-continuity.mjs';
const actor='shaping-001';
function store(t){const dir=mkdtempSync(join(tmpdir(),'deskbot-memory-archive-')),p=createSqlitePersistence({filename:join(dir,'world.sqlite')});
 t.after(()=>{p.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+'\\deskbot-memory-archive-'));rmSync(dir,{recursive:true});});return p;}
function memory(i,owner=actor){return {id:`${owner}:${String(i).padStart(6,'0')}`,root_outcome_id:`task:${i}`,occurred_at:new Date(1760000000000+i*60000).toISOString(),payload:{agent_id:owner,stream:'factual',kind:'event',raw_content:i===17?'潮汐石回声测记：旧问题仍待核验。':'普通观察 '+i,stored_content:i===17?'潮汐石回声测记：旧问题仍待核验。':'普通观察 '+i,source_ids:[],importance:.2}};}
test('6000 authored records retain immutable originals with bounded snapshots and actor-scoped cold retrieval',t=>{
 const p=store(t),w={world_id:'w',cognition:{actors:{
  [actor]:{memories:Array.from({length:6000},(_,i)=>memory(i))},
  other:{memories:[{...memory(9,'other'),payload:{...memory(9,'other').payload,stored_content:'潮汐石 PRIVATE_CANARY'}}]},
 }}};
 const entries=prepareCognitiveArchive(w);p.transaction(()=>persistCognitiveArchive(p,entries));
 assert.ok(w.cognition.actors[actor].memories.length<=128);assert.equal(p.count(memoryNamespace('w',actor)),6000);
 assert.equal(p.searchMemory(memoryNamespace('w',actor),[],8).length,8);
 const cold=retrieveCognitiveMemories(p,w,actor,'潮汐石回声');assert.ok(cold.some(m=>m.id===memory(17).id));assert.ok(!JSON.stringify(cold).includes('PRIVATE_CANARY'));
 const context=cognitiveWorkingState({...w.cognition.actors[actor],memories:cold},'潮汐石回声');assert.ok(context.memories.length<=80);assert.ok(JSON.stringify(context.memories).length<96000);
 assert.equal(rebuildCognitiveMemoryIndex(p,'w',actor),6000);assert.equal(p.get(memoryNamespace('w',actor),memory(17).id).payload.raw_content,memory(17).payload.raw_content);
});
test('source dependencies load with summaries; rewriting an original rolls back the whole archive transaction',t=>{
 const p=store(t),first=memory(0),w={world_id:'w',cognition:{actors:{[actor]:{memories:[first]}}}};
 p.transaction(()=>persistCognitiveArchive(p,prepareCognitiveArchive(w)));
 w.cognition.actors[actor].memories=[{...memory(1),payload:{...memory(1).payload,kind:'insight',stream:'experiential',source_ids:[first.id],stored_content:'由旧记录想到的新问题'}}];
 p.transaction(()=>persistCognitiveArchive(p,prepareCognitiveArchive(w)));
 const restored=retrieveCognitiveMemories(p,w,actor,'新问题');assert.ok(restored.some(m=>m.id===first.id));
 const conflicting=[
  {namespace:memoryNamespace('w',actor),memory:memory(2)},
  {namespace:memoryNamespace('w',actor),memory:{...first,payload:{...first.payload,raw_content:'伪造结果'}}},
 ];
 assert.throws(()=>p.transaction(()=>persistCognitiveArchive(p,conflicting)),{code:'archived_memory_conflict'});
 assert.equal(p.count(memoryNamespace('w',actor)),2);assert.equal(p.get(memoryNamespace('w',actor),memory(2).id),null);
});
test('existing snapshots migrate on restart, retain pending outcome and retrieve without loading all history',t=>{
 const p=store(t),now=()=>new Date('2026-10-11T02:00:00Z'),api=createPersistentWorld({persistence:p,now,timeMode:'realtime'}),w=api.get();
 w.cognition={actors:{[actor]:{actor_id:actor,memories:Array.from({length:400},(_,i)=>memory(i)),pending:{task_id:'unfinished'},followup:{question:'潮汐石回声'}}}};p.put('canonical-world.states',w.world_id,w);
 const restored=createPersistentWorld({persistence:p,now,timeMode:'realtime'});assert.equal(restored.get().cognition.actors[actor].pending.task_id,'unfinished');assert.equal(restored.get().cognition.actors[actor].memories.length,128);
 assert.ok(restored.cognitionView(actor).cognition.actors[actor].memories.some(m=>m.id===memory(17).id));
 assert.equal(p.count(memoryNamespace(w.world_id,actor)),400);
});
