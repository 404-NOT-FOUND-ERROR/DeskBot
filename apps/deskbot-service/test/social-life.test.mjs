import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld,getWorldMap} from '../src/persistent-world.mjs';
import {createAutonomousLife} from '../src/autonomous-life.mjs';
import {createWorldLife} from '../src/world-life.mjs';
import {createDeskBotServer} from '../src/app.mjs';
import {exchangeResidentResources,socialReadModel} from '../src/social-life.mjs';
const M=60000,BASE=Date.parse('2026-10-04T04:00:00Z'),mender='spare-mender-001',grower='wetland-grower-001',cook='pot-cook-001',own='shaping-001';
function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'deskbot-social-')),filename=join(directory,'world.sqlite');let time=BASE,p=createSqlitePersistence({filename}),world,loop;
  const now=()=>new Date(time);
  function restart(){world=createPersistentWorld({persistence:p,now,timeMode:'realtime'});loop=createAutonomousLife({world,now,enabled:true});}
  restart();createWorldLife({worldSnapshot:()=>world.get(),ingest:e=>world.ingest(e),now,enabled:true}).seedNpcs();
  const h={get world(){return world;},get persistence(){return p;},now,
    mutate(id,payload){return world.ingest({event_id:id,type:'world.mutation',source:'test',character_id:own,occurred_at:now().toISOString(),payload});},
    save(fn){const s=world.get();fn(s);p.put('canonical-world.states',s.world_id,s);restart();},
    install(){return this.mutate('install',{action:'install_resident_life'});},tick(){return loop.tick();},
    run(minutes){for(let i=0;i<minutes;i++){time+=M;world.syncWallClock();world.syncTasks();loop.tick();}},
    restart(){p.close();p=createSqlitePersistence({filename});restart();},
    scope(ids){this.save(s=>{for(const state of Object.values(s.autonomy.actors))state.paused=!ids.includes(state.actor_id);});},
  };t.after(()=>{p.close();rmSync(directory,{recursive:true,force:true});});return h;
}
test('installation preserves three identities, actual tasks and history; restart installs once',t=>{
  const h=fixture(t);h.mutate('legacy-task',{action:'start_activity',task_id:'already-working',actor_id:'pathfinder-001',kind:'care',title:'检查旧路标',duration_seconds:3600});
  h.save(s=>{s.npcs[0].relationship={trust:7,familiarity:11,encounters:4};s.life.recent_experiences=[{experience_id:'old-experience',summary:'以前实际发生的事'}];});
  const before=h.world.get();h.install();const after=h.world.get();
  assert.equal(after.npcs.length,12);assert.equal(Object.keys(after.autonomy.actors).length,13);assert.equal(after.npcs[0].display_name,'阿砾');
  assert.deepEqual(after.npcs[0].relationship,before.npcs[0].relationship);assert.equal(after.npcs[0].location_id,before.npcs[0].location_id);assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.living,before.living);assert.deepEqual(after.life,before.life);
  assert.equal(after.social.relationships&&Object.keys(after.social.relationships).length,0);h.restart();h.install();assert.deepEqual(h.world.get(),after);
  getWorldMap(after);socialReadModel(after);assert.deepEqual(h.world.get(),after);
});
test('cooperation makes and carries a real kit, hands it over, and only repair completion changes frame',t=>{
  const h=fixture(t);h.install();h.scope([mender,grower]);h.tick();assert.ok(h.world.get().social.commitments.some(c=>c.kind==='cooperate'));
  const before=h.world.get().living.objects['floating-frame'].condition;h.run(8);assert.ok(h.world.get().living.objects['floating-frame'].condition<=before);
  h.run(155);const s=h.world.get(),c=s.social.commitments.find(c=>c.key==='cooperate:frame');assert.equal(c.status,'completed');
  assert.ok(c.handed_at);assert.ok(s.tasks.some(t=>t.activity_id==='craft-frame-kit'&&t.origin==='social_life'&&t.status==='completed'));assert.ok(s.tasks.some(t=>t.activity_id==='repair-frame'&&t.actor_id===grower&&t.status==='completed'));
  assert.ok(s.living.objects['floating-frame'].condition>.9);assert.ok(s.living.objects['parts-drawers'].stock.wood<=6);assert.equal(s.living.inventories[grower].stock.frame_kit,0);assert.equal(s.social.relationships[[mender,grower].sort().join('|')].kept,1);
  h.restart();const completed=h.world.get();h.tick();assert.deepEqual(h.world.get(),completed);
});
test('reciprocal exchange conserves resources and is local, capacity checked and atomic',t=>{
  const h=fixture(t);h.install();h.save(s=>{s.protagonist.location_id='whisper-market';s.npcs.find(n=>n.npc_id===cook).location_id='whisper-market';s.living.inventories[own]={stock:{moss:2},capacity:24};s.living.inventories[cook]={stock:{rations:1},capacity:24};});
  const s=h.world.get(),c={id:'fixture-exchange',actors:[own,cook],location_id:'whisper-market',changes:[]};
  const offers=[{from:own,to:cook,resource:'moss',count:2},{from:cook,to:own,resource:'rations',count:1}];exchangeResidentResources(s,c,h.now().toISOString(),offers);
  assert.deepEqual(s.living.inventories[own].stock,{moss:0,rations:1});assert.deepEqual(s.living.inventories[cook].stock,{rations:0,moss:2});
  const bad=h.world.get();bad.living.inventories[cook].capacity=1;const original=structuredClone(bad.living.inventories);assert.throws(()=>exchangeResidentResources(bad,c,h.now().toISOString(),offers),e=>e.code==='exchange_bag_full');assert.deepEqual(bad.living.inventories,original);
  bad.npcs.find(n=>n.npc_id===cook).location_id='echo-waterside';assert.throws(()=>exchangeResidentResources(bad,c,h.now().toISOString(),offers),e=>e.code==='exchange_requires_presence');
});
test('busy participant gets an explicit delay and failure; no fabricated meeting after offline interval',t=>{
  const h=fixture(t);h.install();h.scope([mender,grower]);h.tick();h.run(1);
  const c=h.world.get().social.commitments.find(c=>c.key==='cooperate:frame');const traveller=h.world.get().tasks.find(t=>t.actor_id===mender&&t.status==='running');h.mutate('pause',{action:'control_task',task_id:traveller.task_id,operation:'pause'});
  h.run(184);const s=h.world.get(),actual=s.social.commitments.find(x=>x.id===c.id);assert.equal(actual.status,'failed');assert.equal(actual.delay_count,1);assert.equal(actual.met_at,undefined);assert.ok(s.social.recent.some(e=>e.kind==='delayed'));assert.equal(s.tasks.find(t=>t.task_id===traveller.task_id).status,'paused');
});
test('protagonist can decline an actual invitation without losing trust or receiving meals',t=>{
  const h=fixture(t);h.install();h.scope([own,cook]);h.save(s=>{s.living.objects['floating-frame'].condition=.99;s.living.objects['seedling-rack'].stock.trays=2;});h.tick();
  const c=h.world.get().social.commitments.find(c=>c.actors.includes(own));assert.equal(c.status,'proposed');h.mutate('decline',{action:'respond_social_invitation',invitation_id:c.id,operation:'decline'});
  const s=h.world.get();assert.equal(s.social.commitments.find(x=>x.id===c.id).status,'declined');assert.equal(s.living.objects['shared-table'].stock.rations,3);assert.equal(Object.keys(s.social.relationships).length,0);
});
test('explicit join while own autonomous scheduling is paused waits for presence, consumes real meals',t=>{
  const h=fixture(t);h.install();h.scope([own,cook]);h.save(s=>{s.protagonist.location_id='warm-pot-courtyard';s.living.objects['floating-frame'].condition=.99;s.living.objects['seedling-rack'].stock.trays=2;});h.tick();const c=h.world.get().social.commitments.find(c=>c.actors.includes(own));
  h.save(s=>{s.autonomy.actors[own].paused=true;s.autonomy.actors[own].plan=null;s.tasks=s.tasks.filter(t=>t.actor_id!==own);});
  h.mutate('join',{action:'respond_social_invitation',invitation_id:c.id,operation:'join'});h.run(30);const s=h.world.get();assert.equal(s.social.commitments.find(x=>x.id===c.id).status,'completed');assert.equal(s.living.objects['shared-table'].stock.rations,1);assert.equal(s.autonomy.actors[own].paused,true);
});
test('thirteen actors share rotating budget; no resident is starved and installed profiles stay distinct',t=>{
  const h=fixture(t);h.install();h.save(s=>{s.social.next_offer_at='2099-01-01T00:00:00Z';});h.tick();h.run(2);const s=h.world.get();assert.equal(s.npcs.length,12);assert.ok(Object.values(s.autonomy.actors).every(a=>a.plan));assert.equal(new Set(s.npcs.map(n=>n.color)).size,12);assert.ok(s.npcs.every(n=>n.project.status==='authored_goal'));
});
test('a participant leaving after eating cannot turn a partial dinner into a kept joint promise',t=>{
  const h=fixture(t);h.install();h.scope([own,cook]);h.save(s=>{s.protagonist.location_id='warm-pot-courtyard';s.living.objects['floating-frame'].condition=.99;s.living.objects['seedling-rack'].stock.trays=2;});h.tick();
  const c=h.world.get().social.commitments.find(c=>c.actors.includes(own));
  h.save(s=>{for(const id of [own,cook]){s.autonomy.actors[id].plan=null;const actor=id===own?s.protagonist:s.npcs.find(n=>n.npc_id===id);actor.location_id='warm-pot-courtyard';}s.tasks=s.tasks.filter(t=>![own,cook].includes(t.actor_id));});
  h.mutate('join-dinner',{action:'respond_social_invitation',invitation_id:c.id,operation:'join'});
  h.run(10);assert.equal(h.world.get().social.commitments.find(x=>x.id===c.id).status,'working');
  h.save(s=>{s.protagonist.location_id='whisper-market';});h.run(1);const s=h.world.get(),actual=s.social.commitments.find(x=>x.id===c.id);
  assert.equal(actual.status,'failed');assert.equal(s.social.relationships[[own,cook].sort().join('|')].kept,0);assert.ok(actual.last_note.includes('离开'));assert.ok(Date.parse(s.social.cooldowns[actual.key])>Date.parse(h.now())+300*M);
});
test('social HTTP reads do not mutate; response retries remain idempotent and cannot choose another actor',async t=>{
  const server=createDeskBotServer({now:()=>new Date(BASE),timeMode:'realtime',worldLifeEnabled:true,autonomousLifeEnabled:true,residentLifeEnabled:true,websocket:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const root=`http://127.0.0.1:${server.address().port}`;
  const before=server.persistentWorld.get(),read=await(await fetch(root+'/api/life/social')).json();assert.equal(read.residents.length,12);assert.deepEqual(server.persistentWorld.get(),before);
  const c=read.commitments.find(c=>c.actors.includes(own)),body=JSON.stringify({operation:'decline',invitation_id:c.id,event_id:'retry-social',actor_id:mender,offers:[{count:1000}]});
  const send=()=>fetch(root+'/api/life/social',{method:'POST',headers:{'content-type':'application/json'},body});assert.equal((await send()).status,200);const after=server.persistentWorld.get();assert.equal((await send()).status,200);assert.deepEqual(server.persistentWorld.get(),after);
  const forbidden=await fetch(root+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:'inject-residents',type:'world.mutation',payload:{action:'install_resident_life'}})});assert.equal(forbidden.status,403);
});
