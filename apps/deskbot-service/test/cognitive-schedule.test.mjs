import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersistentWorld} from '../src/persistent-world.mjs';
import {createCognitiveLife} from '../src/cognitive-life.mjs';
import {scheduleCognitiveActor,cognitiveSleepWindow,fairCognitiveQueue} from '../src/cognitive-schedule.mjs';
import {syncLifeNeeds} from '../src/life-state.mjs';
const initial='2026-10-11T02:00:00Z';
const budget={status:()=>({}),complete:()=>{throw Error('No paid calls in scheduler test');}};
function fixture(t,session){
 let at=new Date(initial);const world=createPersistentWorld({now:()=>at,timeMode:'realtime'});
 world.ingest({event_id:'residents',type:'world.mutation',source:'fixture',character_id:'shaping-001',payload:{action:'install_resident_life'}});
 const bridge={close(){},session:session??(async c=>({schema:'deskbot.cognitive-life.proposal.v3',actor_id:c.actor.actor_id,phase:c.phase,state:{agent_id:c.actor.actor_id},memories:[],compiled:{operation:'wait',reason:'留时间做安静观察',followup_decision:'postpone'}}))};
 const life=createCognitiveLife({world,budget,now:()=>at,bridge,clockScope:'isolated_test_clock'});t.after(()=>life.close());
 return {world,life,setTime(value){at=new Date(value);},now:()=>at};
}
test('continuous mode is explicit, admits registered residents and progresses past the pilot limit',async t=>{
 const f=fixture(t);assert.equal(f.world.get().cognition,undefined);
 assert.throws(()=>f.life.configure('invented-person'),{code:'cognitive_actor_unknown'});
 f.life.configure('spare-mender-001');
 for(let i=0;i<6;i++){f.setTime(new Date(Date.parse(initial)+i*24*3600000));await f.life.tick();}
 const state=f.world.get().cognition.actors['spare-mender-001'];assert.equal(state.plan_count,6);assert.equal(state.enabled,true);assert.equal(state.pilot_plan_limit,null);
});
test('thirteen configured residents each get a dispatch without fixed actor-order starvation',async t=>{
 const f=fixture(t),w=f.world.get(),ids=[w.protagonist.character_id,...w.npcs.map(p=>p.npc_id)];assert.equal(ids.length,13);
 for(const id of ids)f.life.configure(id);
 for(let i=0;i<7;i++)await f.life.tick();
 for(const id of ids)assert.equal(f.world.get().cognition.actors[id].plan_count,1,id);
});
test('a slow resident does not prevent another slot from serving the next person',async t=>{
 let release,entered;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),seen=[];
 const f=fixture(t,async c=>{seen.push(c.actor.actor_id);if(c.actor.actor_id==='shaping-001'){entered();await gate;}
  return {schema:'deskbot.cognitive-life.proposal.v3',actor_id:c.actor.actor_id,phase:c.phase,state:{agent_id:c.actor.actor_id},memories:[],compiled:{operation:'wait',reason:'先留一个窗口'}};
 });
 for(const id of ['shaping-001','wetland-grower-001','lamp-keeper-001'])f.life.configure(id);
 // The protagonist is put first in the actual queue by earlier eligible dispatch time.
 const slow=f.life.run('shaping-001');await started;await f.life.tick();await f.life.tick();
 assert.ok(seen.includes('wetland-grower-001'));assert.ok(seen.includes('lamp-keeper-001'));release();await slow;
});
test('sleep is an actual rest task with zero model calls and busy inputs can still be perceived',async t=>{
 let calls=0;const f=fixture(t,async()=>{calls++;throw Error('night should not call');});f.life.configure('shaping-001');
 f.setTime('2026-10-11T16:00:00Z');await f.life.tick();const w=f.world.get(),task=w.tasks.find(t=>t.origin==='cognitive_rest');
 assert.ok(task);assert.equal(task.life_action,'rest');assert.equal(calls,0);
 const before=w.autonomy.actors['shaping-001'].energy;syncLifeNeeds(w,'2026-10-11T16:30:00Z');assert.ok(w.autonomy.actors['shaping-001'].energy>before);
 const choice=scheduleCognitiveActor(w,'shaping-001','2026-10-11T16:30:00Z',{perceptions:[{id:'heard'}]});assert.equal(choice.phase,'perceive');
 assert.equal(cognitiveSleepWindow(w,'lamp-keeper-001','2026-10-11T16:00:00Z'),false);
});
test('feedback and recovery retain priority; slow reviews require elapsed time and additional evidence',()=>{
 const at='2026-10-11T10:00:00Z',life={enabled:true,enabled_at:initial,memories:[{}],memory_sequence:2,schedule:{last_dispatch_at:initial},pending:{task_id:'owned'}};
 const w={clock:{time_zone:'Asia/Shanghai'},cognition:{actors:{a:life}},tasks:[]},context={perceptions:[],social:{commitments:[],relation_evidence:[]},refraction:{pending:[]}};
 assert.equal(scheduleCognitiveActor(w,'a',at,context,{actualResult:true}).phase,'feedback');
 life.pending=null;assert.equal(scheduleCognitiveActor(w,'a',at,context).phase,'reflect');life.maintenance={reflect:{at,memory_sequence:2}};
 assert.equal(scheduleCognitiveActor(w,'a',at,context),null);
 life.retry={retryable:true,phase:'feedback',at};assert.equal(scheduleCognitiveActor(w,'a',at,context).phase,'feedback');
 const queue=fairCognitiveQueue([{actor_id:'first',priority:40,last_dispatch_at:at},{actor_id:'old',priority:40,last_dispatch_at:initial}]);assert.equal(queue[0].actor_id,'old');
});

test('a future accepted agreement does not occupy the whole day before its actual window',()=>{
 const at='2026-10-11T02:00:00Z',life={enabled:true,continuous:true,memories:[],next_decision_at:at,schedule:{last_dispatch_at:'2026-10-11T01:00:00Z'}};
 const w={clock:{time_zone:'Asia/Shanghai'},cognition:{actors:{a:life}},tasks:[]};
 const agreement={status:'accepted',not_before_at:'2026-10-11T10:00:00Z'};
 const context={perceptions:[],social:{commitments:[agreement]},refraction:{pending:[]}};
 assert.equal(scheduleCognitiveActor(w,'a',at,context).phase,'plan');
 agreement.not_before_at='2026-10-11T02:10:00Z';assert.equal(scheduleCognitiveActor(w,'a',at,context),null);
});
