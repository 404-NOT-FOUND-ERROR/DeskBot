import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld,getWorldMap} from '../src/persistent-world.mjs';
import {createAutonomousLife} from '../src/autonomous-life.mjs';
import {installAutonomy} from '../src/life-state.mjs';
import {createDeskBotServer} from '../src/app.mjs';
import {createWorldLife} from '../src/world-life.mjs';
const BASE=Date.parse('2026-10-04T04:00:00Z'),M=60000;
function fixture(t,{location='moss-sprout-garden',all=false}={}){
  const directory=mkdtempSync(join(tmpdir(),'deskbot-autonomy-')),filename=join(directory,'world.sqlite');
  let time=BASE,persistence=createSqlitePersistence({filename}),world=createPersistentWorld({persistence,now:()=>new Date(time),timeMode:'realtime'}),loop;
  createWorldLife({worldSnapshot:()=>world.get(),ingest:event=>world.ingest(event),now:()=>new Date(time),enabled:true}).seedNpcs();
  const initial=world.get();initial.protagonist.location_id=location;installAutonomy(initial,new Date(time).toISOString());
  if(!all)for(const s of Object.values(initial.autonomy.actors))if(s.actor_id!=='shaping-001')s.paused=true;
  persistence.put('canonical-world.states',initial.world_id,initial);
  function restart(){world=createPersistentWorld({persistence,now:()=>new Date(time),timeMode:'realtime'});loop=createAutonomousLife({world,now:()=>new Date(time),enabled:true});}
  restart();t.after(()=>{persistence.close();rmSync(directory,{recursive:true,force:true});});
  return {get world(){return world;},get loop(){return loop;},get persistence(){return persistence;},now:()=>new Date(time),
    advance(ms){time+=ms;world.syncWallClock();world.syncTasks();},tick(){return loop.tick();},
    save(fn){const state=world.get();fn(state);persistence.put('canonical-world.states',state.world_id,state);restart();},
    restart(){persistence.close();persistence=createSqlitePersistence({filename});restart();},
    mutate(id,payload){return world.ingest({event_id:id,type:'world.mutation',source:'test',character_id:'shaping-001',occurred_at:new Date(time).toISOString(),payload});},
    run(minutes){for(let i=0;i<minutes;i++){this.advance(M);this.tick();}}
  };
}
const own=world=>world.autonomy.actors['shaping-001'];
test('same cycle is atomic and idempotent after SQLite restart; reads cannot start tasks',t=>{
  const h=fixture(t);h.save(s=>{s.living.objects['garden-bed'].moisture=.2;});h.tick();
  const first=h.world.get(),task=first.tasks.find(t=>t.actor_id==='shaping-001');assert.equal(task.activity_id,'water-bed');assert.equal(first.living.objects['seedling-rack'].stock.water,9);
  h.restart();h.tick();assert.deepEqual(h.world.get(),first);getWorldMap(h.world.get());assert.deepEqual(h.world.get(),first);
  h.advance(5*M);h.tick();assert.equal(h.world.get().tasks.find(t=>t.task_id===task.task_id).status,'completed');assert.ok(h.world.get().living.objects['garden-bed'].moisture>.42);
  h.restart();h.tick();assert.equal(h.world.get().living.objects['seedling-rack'].stock.water,9);
});
test('material chain travels, crafts and carries an actual tray to the nursery',t=>{
  const h=fixture(t);h.tick();assert.equal(own(h.world.get()).plan.goal,'tray');h.run(115);
  const world=h.world.get();assert.equal(world.living.objects['parts-drawers'].stock.wood,7);assert.equal(world.living.objects['parts-drawers'].stock.fasteners,11);
  assert.equal(world.living.objects['seedling-rack'].stock.trays,1);assert.ok(world.tasks.some(t=>t.activity_id==='craft-tray'&&t.status==='completed'));
  assert.ok(world.tasks.filter(t=>t.kind==='travel'&&t.origin==='autonomous_life').length>=2);
});
test('finite stock prevents fabrication and records blocked alternatives',t=>{
  const h=fixture(t);h.save(s=>{s.living.objects['seedling-rack'].stock.water=0;s.living.objects['garden-bed'].moisture=.2;s.living.objects['parts-drawers'].stock.wood=0;});h.tick();
  const state=own(h.world.get());assert.ok(state.last_candidates.find(c=>c.goal==='water'&&!c.available));assert.ok(state.last_candidates.find(c=>c.goal==='tray'&&!c.available));
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water,0);assert.notEqual(state.plan.goal,'water');
});

test('repair plan makes a finite kit, carries it to the water and consumes it on repair',t=>{
  const h=fixture(t,{location:'spare-parts-house'});h.save(s=>{s.living.objects['floating-frame'].condition=.2;});h.tick();
  assert.equal(own(h.world.get()).plan.goal,'repair:floating-frame');h.run(120);
  const world=h.world.get();
  assert.ok(world.tasks.some(task=>task.activity_id==='craft-frame-kit'&&task.status==='completed'));
  assert.ok(world.tasks.some(task=>task.activity_id==='repair-frame'&&task.status==='completed'));
  assert.ok(world.living.objects['floating-frame'].condition>.54);
  assert.equal(world.living.inventories['shaping-001'].stock.frame_kit,0);
  assert.ok(world.living.objects['parts-drawers'].stock.wood<=6);
  assert.ok(world.living.objects['parts-drawers'].stock.fasteners<=9);
});
test('shared facilities are mutually exclusive across protagonist and residents',t=>{
  const h=fixture(t,{all:true});h.save(s=>{s.living.objects['garden-bed'].moisture=.15;for(const n of s.npcs)n.location_id='moss-sprout-garden';});h.tick();
  const tasks=h.world.get().tasks.filter(t=>t.activity_id==='water-bed');assert.equal(tasks.length,1);assert.equal(h.world.get().living.objects['seedling-rack'].stock.water,9);
  assert.equal(Object.keys(h.world.get().autonomy.actors).length,4);
});
test('user pause is preserved; cancelled autonomy waits before choosing again',t=>{
  const h=fixture(t);h.save(s=>{s.living.objects['garden-bed'].moisture=.2;});h.tick();const task=h.world.get().tasks.find(t=>t.actor_id==='shaping-001');
  h.mutate('pause',{action:'control_task',task_id:task.task_id,operation:'pause'});h.run(12);assert.equal(h.world.get().tasks.find(t=>t.task_id===task.task_id).status,'paused');
  h.mutate('cancel',{action:'control_task',task_id:task.task_id,operation:'cancel'});h.advance(M);h.tick();assert.equal(own(h.world.get()).plan.status,'cancelled');
  assert.equal(h.world.get().living.objects['seedling-rack'].stock.water,12);const count=h.world.get().tasks.length;h.run(10);assert.equal(h.world.get().tasks.length,count);
});
test('failed wetness predicate refunds, records feedback and chooses drainage',t=>{
  const h=fixture(t);h.save(s=>{s.living.objects['garden-bed'].moisture=.2;});h.tick();h.save(s=>{s.living.objects['garden-bed'].moisture=.99;});
  h.advance(5*M);h.tick();assert.equal(own(h.world.get()).plan.status,'failed');assert.equal(h.world.get().living.objects['seedling-rack'].stock.water,12);
  h.advance(M);h.tick();assert.equal(own(h.world.get()).plan.goal,'drain');assert.ok(h.world.get().autonomy.recent.some(r=>r.kind==='replan'));
});
test('failed construction step cannot partially consume reserved materials',t=>{
  const h=fixture(t,{location:'spare-parts-house'});h.save(s=>{s.tasks=Array.from({length:100},(_,i)=>({task_id:`fixture-${i}`,actor_id:`outside-${i}`,status:'paused',kind:'care'}));});h.tick();
  assert.equal(h.world.get().living.objects['parts-drawers'].stock.wood,8);assert.equal(h.world.get().living.objects['parts-drawers'].stock.fasteners,12);assert.equal(own(h.world.get()).plan.status,'failed');
});
test('night rest recovers energy through actual elapsed time without stopping ecology',t=>{
  const h=fixture(t,{location:'shaping-field-desk'});h.advance(12*60*M);h.tick();assert.equal(own(h.world.get()).plan.goal,'rest');
  const task=h.world.get().tasks.find(t=>t.actor_id==='shaping-001'&&t.status==='running');assert.equal(task.life_action,'rest');const energy=own(h.world.get()).energy;
  h.advance(120*M);h.tick();assert.ok(own(h.world.get()).energy>energy+.3);assert.ok(h.world.get().living.objects['garden-bed'].moisture<.58);
});
test('offline recovery completes only already-started affairs and resumes planning now',t=>{
  const h=fixture(t);h.save(s=>{s.living.objects['garden-bed'].moisture=.2;});h.tick();const started=h.world.get().tasks[0];h.advance(24*60*M);h.restart();h.tick();
  const world=h.world.get();assert.equal(world.tasks.find(t=>t.task_id===started.task_id).status,'completed');
  assert.ok(world.tasks.filter(t=>t.task_id!==started.task_id).every(t=>Date.parse(t.started_at)>=h.now().getTime()));
  assert.ok(world.autonomy.recent.find(r=>r.task_id===started.task_id&&r.kind==='completed'));
});
test('closed paths block remote plans; no teleport or remote repair',t=>{
  const h=fixture(t,{location:'shaping-field-desk'});h.save(s=>{for(const p of s.map_catalog.passages)s.passage_states[p.passage_id]={status:'closed',reason:'fixture'};s.living.objects['floating-frame'].condition=.2;});h.tick();
  assert.equal(h.world.get().protagonist.location_id,'shaping-field-desk');assert.equal(own(h.world.get()).plan.goal,'quiet-rest');assert.equal(h.world.get().living.objects['floating-frame'].condition,.2);
});
test('hungry resident uses finite food and changes appetite only when meal completes',t=>{
  const h=fixture(t,{location:'warm-pot-courtyard'});h.save(s=>{own(s).appetite=.8;});h.tick();assert.equal(own(h.world.get()).plan.goal,'meal');assert.equal(h.world.get().living.objects['shared-table'].stock.rations,2);assert.equal(own(h.world.get()).appetite,.8);
  h.advance(10*M);h.tick();assert.ok(own(h.world.get()).appetite<.2);assert.equal(h.world.get().living.objects['shared-table'].stock.rations,2);
});
test('autonomy read/control is scoped and public events cannot manufacture life state',async t=>{
  const server=createDeskBotServer({timeMode:'realtime',worldLifeEnabled:true,autonomousLifeEnabled:true,websocket:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const before=server.persistentWorld.get(),read=await(await fetch(`${root}/api/life/autonomy`)).json();assert.equal(read.actors.length,4);assert.deepEqual(server.persistentWorld.get(),before);
  const body=JSON.stringify({event_id:'retry-pause',operation:'pause',actor_id:'pathfinder-001',energy:999});
  const result=await fetch(`${root}/api/life/autonomy`,{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(result.status,200);
  const after=server.persistentWorld.get();assert.equal(own(after).paused,true);assert.equal(after.autonomy.actors['pathfinder-001'].paused,false);assert.ok(own(after).energy<=1);
  const retry=await fetch(`${root}/api/life/autonomy`,{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(retry.status,200);
  assert.deepEqual(server.persistentWorld.get(),after);
  const forbidden=await fetch(`${root}/api/event`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:'inject-life',type:'world.mutation',payload:{action:'advance_autonomous_life'}})});assert.equal(forbidden.status,403);
});
