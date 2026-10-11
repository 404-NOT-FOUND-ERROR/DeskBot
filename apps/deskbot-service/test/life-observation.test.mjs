import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifeObservation} from '../src/life-observation.mjs';
import {createChatOrchestrator} from '../src/chat-orchestrator.mjs';
import {createDeskBotServer} from '../src/app.mjs';
const START='2026-10-07T15:59:30.000Z';
function fixture() {
 let at=START;
 const w={world_id:'test',protagonist:{character_id:'shaping-001'},npcs:[],tasks:[],autonomy:{actors:{'shaping-001':{actor_id:'shaping-001',energy:.8,appetite:.2}}},
  memory:{development:{records:[],rhythm:{actors:{},opportunities:[]}}},refraction:{records:[]}};
 const store=new Map(),persistence={get:(ns,id)=>structuredClone(store.get(`${ns}:${id}`)??null),put:(ns,id,v)=>store.set(`${ns}:${id}`,structuredClone(v))};
 const options={worldSnapshot:()=>w,persistence,now:()=>new Date(at)};
 return {w,options,advance:seconds=>at=new Date(Date.parse(at)+seconds*1000).toISOString()};
}
function result(at,{id='task:one',practice=true,motivation='self_continuation',sources=[]}={}) {
 return {root_outcome_id:id,at,actor_ids:['shaping-001'],outcome:'completed',title:'照料一株苗',topic:'care',effect:{practice},
  source:{kind:'canonical_task',task_kind:'care'},causes:{motivation:{kind:motivation},sources}};
}
test('actual heartbeat time splits at Shanghai midnight; rereading never mutates the world or audit',()=>{
 const f=fixture(),observer=createLifeObservation(f.options);observer.start();
 f.advance(60);observer.sample();const report=observer.read();
 assert.deepEqual(report.days.map(d=>[d.date,d.online_seconds]),[['2026-10-07',30],['2026-10-08',30]]);
 const before=JSON.stringify(f.w);assert.deepEqual(observer.read(),report);assert.equal(JSON.stringify(f.w),before);
});
test('a real completed recipe preserves motivation and source, and a repeated projection is counted once',()=>{
 const f=fixture(),observer=createLifeObservation(f.options);observer.start();f.advance(30);
 f.w.memory.development.records.push(result(f.options.now().toISOString(),{motivation:'invited',sources:[{attested:true,category:'user'}]}));
 observer.sample();f.advance(60);observer.sample();
 const c=observer.read().days.at(-1).actors['shaping-001'];assert.equal(c.completed,1);assert.equal(c.practice,1);assert.equal(c.invited,1);assert.equal(c.self_continuation,0);assert.equal(c.input_linked,1);
});
test('old history, downtime and startup recovery never masquerade as observed continuous life',()=>{
 const f=fixture();f.w.memory.development.records.push(result('2026-10-07T12:00:00Z',{id:'old'}));
 let observer=createLifeObservation(f.options);observer.start();assert.deepEqual(observer.read().days[0].actors,{});
 f.advance(600);f.w.memory.development.records.push(result(f.options.now().toISOString()));
 observer=createLifeObservation(f.options);observer.start();
 let report=observer.read();assert.equal(report.days.reduce((n,d)=>n+d.online_seconds,0),0);assert.equal(report.days.reduce((n,d)=>n+d.unobserved_seconds,0),600);
 assert.equal(report.days.at(-1).reconciled_roots,1);assert.deepEqual(report.days.at(-1).actors,{});
 f.advance(60);observer.sample();report=observer.read();assert.equal(report.days.at(-1).online_seconds,60);assert.deepEqual(report.days.at(-1).actors,{});
 assert.equal(report.historical_24h.actors['shaping-001'].completed,2);
});
test('a long stalled scheduler interval is unobserved; an old outcome arriving later remains reconciliation',()=>{
 const f=fixture(),observer=createLifeObservation(f.options);observer.start();f.advance(120);
 f.w.memory.development.records.push(result(f.options.now().toISOString()));observer.sample();
 f.advance(60);f.w.memory.development.records.push(result('2026-10-07T12:00:00Z',{id:'late-old'}));observer.sample();
 const d=observer.read().days.at(-1);assert.equal(d.online_seconds,60);assert.equal(observer.read().days.reduce((n,d)=>n+d.unobserved_seconds,0),120);assert.deepEqual(d.actors,{});assert.equal(d.reconciled_roots,2);
});
test('duplicate source origins do not turn a replayed report into new multi-source input',()=>{
 const f=fixture(),observer=createLifeObservation(f.options);observer.start();f.advance(30);
 const input={id:'a',category:'external',source_label:'science',origin_id:'story-1',received_at:f.options.now().toISOString(),attested:true};
 f.w.refraction.records.push(input);observer.sample();f.advance(60);f.w.refraction.records.push({...input,id:'b',received_at:f.options.now().toISOString()});observer.sample();
 assert.equal(observer.read().days.reduce((n,d)=>n+(d.inputs['external:attested']??0),0),1);
});
test('conversation history survives persistence and respects removed-memory boundaries, without provider internals',()=>{
 const make=(id,at)=>({turn_id:id,input_event:{character_id:'shaping-001',occurred_at:at,payload:{text:'今天怎么样'}},reply_event:{occurred_at:at,payload:{text:'我还在照料苗床。'}},trace:{secret:'do-not-expose'}});
 const persistence={list:ns=>ns==='chat.turns'?[make('old','2026-10-06T12:00:00Z'),make('new','2026-10-07T12:00:00Z')]:[]};
 const history=createChatOrchestrator({persistence,conversationHistoryAfter:()=> '2026-10-07T00:00:00Z'}).history('shaping-001');
 assert.deepEqual(history.map(m=>m.id),['new:user','new:assistant']);assert.ok(history.every(m=>!('trace' in m)));assert.deepEqual(createChatOrchestrator({persistence}).history('different'),[]);
});
test('observation and conversation routes are read-only against the formal server contract',async()=>{
 const server=createDeskBotServer({worldLifeEnabled:false,autonomousLifeEnabled:false});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const base=`http://127.0.0.1:${server.address().port}`,before=JSON.stringify(server.persistentWorld.get());
  for(const p of ['/api/life/observation','/api/chat/history']) {const response=await fetch(base+p);assert.equal(response.status,200);const body=await response.json();assert.ok(body.schema);}
  assert.equal(JSON.stringify(server.persistentWorld.get()),before);
 }finally {await new Promise(resolve=>server.close(resolve));}
});
