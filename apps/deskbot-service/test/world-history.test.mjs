import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {createDeskBotServer} from '../src/app.mjs';
import {diffWorld,worldHash,applyWorldDelta,DELTA_SCHEMA} from '../src/world-delta.mjs';
import {traceWorldOperation} from '../src/world-operation-trace.mjs';
import {createWorldHistory} from '../src/world-history.mjs';

const now=()=>new Date('2026-10-19T04:00:00Z');
const event=id=>({event_id:id,type:'world.mutation',source:'fixture',payload:{action:'advance_time',minutes:1}});
const delta=(a,b)=>({changes:diffWorld(a,b),replay:{schema:DELTA_SCHEMA,before_hash:worldHash(a),after_hash:worldHash(b)}});
function store(t) {
  const dir=mkdtempSync(join(tmpdir(),'deskbot-world-history-')),p=createSqlitePersistence({filename:join(dir,'w.sqlite')});
  t.after(()=>{p.close();rmSync(dir,{recursive:true,force:true});});return p;
}

test('delta round trips array retention, reorder, nested edits, empty arrays and escaped JSON keys',()=>{
  const a={tasks:Array.from({length:100},(_,i)=>({task_id:`t${i}`,status:'completed',data:'x'.repeat(1000)})),recent:[1,2,3],empty:[],nil:null,'a/b':{'~':1},gone:true};
  const b=structuredClone(a);b.tasks=[b.tasks[98],...b.tasks.slice(1,98),b.tasks[99],{task_id:'new',status:'running'}];b.tasks[3].status='failed';
  b.recent=[2,3,4];b.empty=[1];b.nil={ready:true};b['a/b']['~']=2;delete b.gone;b.undefined=undefined;
  const d=delta(a,b),actual=applyWorldDelta(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(d)));
  assert.equal(worldHash(actual),worldHash(b));assert.deepEqual(actual,JSON.parse(JSON.stringify(b)));
  assert.ok(JSON.stringify(d).length<JSON.stringify({before:a,after:b}).length/20,'unchanged task bodies must not be repeated');
  assert.throws(()=>applyWorldDelta({...a,extra:1},d),/before-hash/);
  const broken=structuredClone(d);broken.replay.after_hash='corrupted';assert.throws(()=>applyWorldDelta(a,broken),/after-hash/);
  assert.deepEqual(applyWorldDelta(b,delta(b,{empty:[],tasks:[]})),{empty:[],tasks:[]});
});

test('checkpoint replay is exact across restart, freeze pagination excludes later commits, retries do not duplicate trace',t=>{
  const p=store(t);let w=createPersistentWorld({persistence:p,now});const original=w.get(),states=[];
  for(let i=0;i<4;i++){w.ingest(event(`e${i}`));states.push(w.get());}
  const page=w.listOperations({limit:2});assert.equal(page.head_sequence,4);assert.equal(page.operations.length,2);
  w.ingest(event('newer'));const after=w.get();
  assert.deepEqual(w.replayAt({sequence:0}).world,original);
  for(let i=1;i<=4;i++)assert.deepEqual(w.replayAt({sequence:i}).world,states[i-1]);
  w=createPersistentWorld({persistence:p,now});assert.deepEqual(w.get(),after);
  const second=w.listOperations({limit:2,cursor:page.next_cursor});assert.equal(second.head_sequence,4);assert.deepEqual(second.operations.map(o=>o.sequence),[3,4]);assert.equal(second.next_cursor,null);
  const recent=w.listOperations({limit:2,order:'desc'});assert.deepEqual(recent.operations.map(o=>o.sequence),[5,4]);
  assert.deepEqual(w.listOperations({limit:2,cursor:recent.next_cursor}).operations.map(o=>o.sequence),[3,2]);
  assert.equal(w.ingest(event('e1')).duplicate,true);assert.equal(w.listOperations().operations.length,5);
  assert.throws(()=>w.replayAt({sequence:-1}),{code:'invalid_history_cursor'});
  assert.throws(()=>w.listOperations({cursor:'bad'}),{code:'invalid_history_cursor'});
  assert.deepEqual(w.get(),after,'read and replay cannot advance current life');
});

test('checkpoint boundaries bound replay, and even a missing no-op record fails the sequence chain',()=>{
  const rows=[],checkpoints=new Map(),persistence={get:(_ns,id)=>checkpoints.get(id),put:(_ns,id,value)=>checkpoints.set(id,structuredClone(value))};
  const history=createWorldHistory({persistence,indexes:()=>rows,readMutation:r=>r,interval:2});
  let world={world_id:'fixture',world_revision:0,tasks:[]};
  for(let seq=1;seq<=7;seq++) {
    const after={...world,world_revision:seq},m={schema:'foundry.world-mutation-record.v0.2',sequence:seq,mutation_id:`m${seq}`,world_id:'fixture',changes:diffWorld(world,after)};
    const prepared=history.prepare(world,m,seq-1);history.persist(prepared.checkpoint);
    m.replay={schema:DELTA_SCHEMA,base_checkpoint_id:prepared.base_checkpoint_id,previous_sequence:seq-1,before_hash:worldHash(world),after_hash:worldHash(after)};
    prepared.commit(worldHash(after));rows.push(m);world=after;
  }
  const replay=history.replayAt({worldId:'fixture',sequence:7});assert.deepEqual(replay.world,world);assert.ok(replay.applied_records<=2);
  // Force a chain discontinuity even though the data hash still matches.
  rows[6].replay.previous_sequence=3;
  assert.throws(()=>history.replayAt({worldId:'fixture',sequence:7}),{code:'history_gap'});
});

test('legacy rows remain byte-for-byte readable; first v2 anchors only the known baseline',t=>{
  const p=store(t);let w=createPersistentWorld({persistence:p,now});const m=w.ingest(event('old')).mutation;
  const legacy={...m,schema:'foundry.world-mutation-record.v0.1',changes:[],replay:undefined,operation_trace:undefined};
  p.put('canonical-world.mutations',m.mutation_id,legacy);
  const saved=p.get('canonical-world.mutations',m.mutation_id),base=w.get();
  w=createPersistentWorld({persistence:p,now});w.ingest(event('new'));
  assert.deepEqual(p.get('canonical-world.mutations',m.mutation_id),saved);
  assert.equal(w.listOperations().legacy_records,1);assert.equal(w.listOperations().operations.length,1);
  assert.deepEqual(w.replayAt({sequence:1}).world,base);
  assert.throws(()=>w.replayAt({sequence:0}),{code:'history_before_checkpoint'});
});

test('failed SQLite append rolls back checkpoint, world and sequence together; corrupt history fails closed',t=>{
  const p=store(t);let failInsert=true;
  const wrapped={...p,insert(ns,id,value){if(failInsert&&ns==='canonical-world.mutations')throw Error('disk failure');return p.insert(ns,id,value);}};
  const w=createPersistentWorld({persistence:wrapped,now}),before=w.get();
  assert.throws(()=>w.ingest(event('retry')),/disk failure/);
  assert.deepEqual(w.get(),before);assert.equal(p.count('canonical-world.checkpoints'),0);assert.equal(p.count('canonical-world.mutations'),0);
  failInsert=false;const m=w.ingest(event('retry')).mutation;assert.equal(m.sequence,1);
  const checkpoint=p.get('canonical-world.checkpoints',m.replay.base_checkpoint_id);checkpoint.world.logical_time.day=999;p.put('canonical-world.checkpoints',checkpoint.checkpoint_id,checkpoint);
  assert.throws(()=>w.replayAt({sequence:1}),{code:'history_corrupt'});
});

test('trace correlates admission, finite reservation, net stock, decision, rejection reason and release without prompts',()=>{
  const before={world_id:'w',tasks:[],living:{objects:{table:{stock:{rations:2}}}},autonomy:{actors:{a:{plan:null}}}},after=structuredClone(before);
  after.living.objects.table.stock.rations=1;
  after.tasks=[{task_id:'t',actor_id:'a',status:'running',title:'吃饭',activity_id:'share-meal',reservation:{status:'held',inputs:[{container:'table',resource:'rations',count:1}]}}];
  after.autonomy.actors.a.plan={plan_id:'p',goal:'meal',status:'executing',steps:[],index:0,decision:{source:'rules'}};
  after.autonomy.actors.a.last_candidates=[{goal:'cook',available:false,blocked_code:'material_shortage'}];
  const trace=traceWorldOperation(before,after,{mutation_id:'m',sequence:1,event_id:'e',correlation_id:'turn'});
  assert.equal(trace.operation_id,'m');assert.equal(trace.correlation_id,'turn');
  assert.deepEqual(trace.records.map(r=>r.kind),['task_admitted','reservation_held','stock_changed','plan_changed']);
  assert.equal(trace.records.at(-1).candidates[0].reason_code,'material_shortage');
  const cancelled=structuredClone(after);cancelled.tasks[0].status='cancelled';cancelled.tasks[0].reservation.status='returned';cancelled.living.objects.table.stock.rations=2;
  assert.ok(traceWorldOperation(after,cancelled,{mutation_id:'m2'}).records.some(r=>r.kind==='reservation_returned'));
});

test('HTTP history and checked replay are read-only and reject malformed targets',async()=>{
  const s=createDeskBotServer({now});s.persistentWorld.ingest(event('http-fixture'));
  await new Promise(r=>s.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${s.address().port}`;
  try {
    const before=s.persistentWorld.get(),response=await fetch(`${base}/api/world/operations`),page=await response.json();
    assert.equal(response.status,200);assert.equal(page.operations.length,1);
    const replay=await (await fetch(`${base}/api/world/replay?sequence=${page.operations[0].sequence}`)).json();
    assert.equal(replay.verified,true);assert.deepEqual(replay.world,before);
    assert.equal((await fetch(`${base}/api/world/replay`)).status,400);
    assert.equal((await fetch(`${base}/api/world/operations?world_id=missing`)).status,404);
    assert.deepEqual(s.persistentWorld.get(),before);
  }finally{await new Promise(r=>s.close(r));}
});
