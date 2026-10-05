import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld,getWorldMap} from '../src/persistent-world.mjs';
import {installAutonomy} from '../src/life-state.mjs';
import {installRefraction,refractInput,settleRefraction,refractionReadModel} from '../src/input-refraction.mjs';
import {createAutonomousLife} from '../src/autonomous-life.mjs';
import {createDeskBotServer} from '../src/app.mjs';
import {normalizeEvent} from '../src/input-store.mjs';
import {createInputRuntime} from '../src/input-runtime.mjs';
import {composePrompt} from '../src/prompt-composer.mjs';
const BASE=Date.parse('2026-10-05T04:00:00Z'),M=60000;
function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'deskbot-refraction-')),filename=join(directory,'world.sqlite');let at=BASE,persistence=createSqlitePersistence({filename}),world;
  const restart=()=>{world=createPersistentWorld({persistence,now:()=>new Date(at),timeMode:'realtime'});};restart();
  const initial=world.get();installAutonomy(initial,new Date(at).toISOString());installRefraction(initial,new Date(at).toISOString());initial.protagonist.location_id='moss-sprout-garden';initial.living.objects['garden-bed'].moisture=.55;initial.living.objects['garden-bed'].health=.9;initial.living.objects['garden-bed'].growth=.2;initial.living.objects['seedling-rack'].stock.trays=2;
  persistence.put('canonical-world.states',initial.world_id,initial);restart();t.after(()=>{persistence.close();rmSync(directory,{recursive:true,force:true});});
  return {get world(){return world;},get persistence(){return persistence;},now:()=>new Date(at),save(fn){const s=world.get();fn(s);persistence.put('canonical-world.states',s.world_id,s);restart();},
    event(id,type,payload,adapter={attestedKind:'user',sourceLabel:'用户建议'},extra={}){return world.ingest({event_id:id,type,character_id:'shaping-001',source:'test',occurred_at:new Date(at).toISOString(),payload,...extra},adapter);},
    tick(){return createAutonomousLife({world,now:()=>new Date(at),enabled:true}).tick();},advance(minutes=1){at+=minutes*M;world.syncWallClock();world.syncTasks();},
    restart(){persistence.close();persistence=createSqlitePersistence({filename});restart();}};
}
const own=w=>w.autonomy.actors['shaping-001'];

test('real-model context uses actual life records, treats authored scenes as imagination and keeps news during travel',t=>{
  const h=fixture(t);
  h.save(w=>{w.life.current_scene={location_id:'moss-sprout-garden',title:'桌边纸片',narration:'喵呜把纸片和扣子排成一列。',sensory_cue:'触摸桌面上的纸片'};});
  h.event('news-context','news.item',{report_kind:'science_news',text:'森林与星空',published_at:h.now().toISOString()},{attestedKind:'provider',sourceLabel:'NASA Science'});
  const prompt=(query)=>composePrompt({worldSnapshot:h.world.get(),stateContext:'稳定',userText:query}).prompt;
  const ordinary=prompt('你今天自己安排了什么？最近读到什么新闻？');
  assert.match(ordinary,/森林与星空/);assert.match(ordinary,/用户在问喵呜自己的持续生活/);
  assert.doesNotMatch(ordinary,/把纸片和扣子排成一列|用户想一起安排下午/);
  const scene=prompt('桌边纸片这个场景是什么？');assert.match(scene,/尚未核验为实际行动/);
  h.event('air-context','external.air_quality',{report_kind:'air_quality',us_aqi:160,pm2_5:45},{attestedKind:'provider',sourceLabel:'上海空气'});h.tick();
  const travel=prompt('最近读到什么新闻？');assert.match(travel,/正在路上/);assert.match(travel,/森林与星空/);assert.doesNotMatch(travel,/把纸片和扣子排成一列/);
});

test('fresh regional air data changes the next outdoor choice, expires, and never preempts a running task', t => {
  const h=fixture(t);
  const report=()=>h.event('air-report','external.air_quality',{report_kind:'air_quality',location:'上海',us_aqi:160,pm2_5:45,data_kind:'regional_model',summary:'区域空气模型：美国 AQI 160'}, {attestedKind:'provider',sourceLabel:'上海空气 · Open-Meteo / CAMS'});
  const before=h.world.get();report();
  assert.deepEqual(h.world.get().living,before.living);
  h.tick();let world=h.world.get();
  assert.equal(own(world).plan.goal,'air:shelter');
  assert.equal(world.tasks.at(-1).kind,'travel');
  assert.match(world.refraction.records[0].last_note,/空气参考进入了安排/);
  assert.equal(world.refraction.records[0].independent_evidence,false);
  const task=world.tasks.at(-1).task_id;h.tick();
  assert.equal(h.world.get().tasks.at(-1).task_id,task);
  h.advance(121);
  assert.equal(refractionReadModel(h.world.get(),{now:h.now()}).records[0].status,'expired');
});
test('suggestion changes an idle choice, runs a real material transaction, and survives restart',t=>{
  const h=fixture(t),before=h.world.get();h.event('idea','user.preference.life',{suggestion:'tend'});
  assert.deepEqual(h.world.get().living,before.living);assert.equal(h.world.get().tasks.length,0);h.tick();
  let w=h.world.get();assert.equal(own(w).plan.goal,'input:tend');assert.equal(w.refraction.records[0].status,'chosen');assert.equal(w.tasks.at(-1).activity_id,'tend-bed');assert.equal(w.living.objects['seedling-rack'].stock.water,before.living.objects['seedling-rack'].stock.water-1);
  h.restart();assert.deepEqual(h.world.get(),w);for(let i=0;i<16;i++){h.advance();h.tick();}
  w=h.world.get();assert.equal(w.refraction.records[0].status,'completed');assert.ok(w.tasks.some(x=>x.activity_id==='tend-bed'&&x.status==='completed'));assert.ok(w.living.objects['garden-bed'].health>.94);
});
test('sleep overrides a suggestion; tasks including user-paused tasks are never preempted',t=>{
  const h=fixture(t);h.save(w=>{own(w).energy=.1;});h.event('idea','user.preference.life',{suggestion:'tend'});h.tick();let w=h.world.get();assert.equal(own(w).plan.goal,'rest');assert.equal(w.refraction.records[0].status,'deferred');
  const task=w.tasks.at(-1);h.event('pause','world.mutation',{action:'control_task',task_id:task.task_id,operation:'pause'},{});h.event('another','user.preference.life',{suggestion:'tray'});h.advance(15);h.tick();w=h.world.get();assert.equal(w.tasks.find(x=>x.task_id===task.task_id).status,'paused');assert.equal(own(w).plan.goal,'rest');assert.equal(w.refraction.records.at(-1).status,'pending');
});
test('wet bed and missing resources defer ideas without creating stock',t=>{
  const h=fixture(t);h.save(w=>{w.living.objects['garden-bed'].moisture=.72;w.living.objects['seedling-rack'].stock.water=0;w.living.objects['parts-drawers'].stock.wood=0;});const stock=structuredClone(h.world.get().living.objects);
  h.event('water','user.preference.life',{suggestion:'water'});h.event('tray','user.preference.life',{suggestion:'tray'});h.tick();const w=h.world.get();assert.equal(w.refraction.records[0].status,'deferred');assert.match(w.refraction.records[0].last_note,/不缺水/);assert.equal(w.refraction.records[1].status,'deferred');assert.ok(!w.tasks.some(x=>x.activity_id==='water-bed'||x.activity_id==='craft-tray'));assert.deepEqual(w.living.objects,stock);
});
test('closed passages prevent a suggested visit from becoming travel',t=>{
  const h=fixture(t);for(const p of h.world.get().map_catalog.passages)h.event(`close:${p.passage_id}`,'world.mutation',{action:'set_passage_access',passage_id:p.passage_id,status:'closed',reason:'测试维修',expected_passage_revision:0},{});
  h.event('visit','user.preference.life',{suggestion:'waterside'});h.tick();const w=h.world.get();assert.equal(w.refraction.records[0].status,'deferred');assert.match(w.refraction.records[0].last_note,/路.*不通/);assert.ok(!w.tasks.some(t=>t.kind==='travel'));
});
test('duplicate origins do not stack scores or create a second record; expiry only ends future reference',t=>{
  const h=fixture(t);h.event('first','user.preference.life',{suggestion:'tend'},undefined,{correlation_id:'same'});const before=h.world.get();const duplicate=h.event('second','user.preference.life',{suggestion:'tend'},undefined,{correlation_id:'same'});assert.equal(duplicate.reason,'origin_already_considered');assert.deepEqual(h.world.get(),before);h.advance(1441);h.tick();const w=h.world.get();assert.equal(w.refraction.records[0].status,'expired');assert.ok(!own(w).plan.source_ids.includes(w.refraction.records[0].id));
});
test('assistant replies, ASR stages and receipts cannot be reinterpreted as suggestions',t=>{
  const h=fixture(t);for(const [i,type] of ['conversation.reply','conversation.input.final','device.action.completed','voice.asr.final'].entries())h.event(`audit-${i}`,type,{role:'assistant',text:'你去水边吧',suggestion:'waterside'});assert.equal(h.world.get().refraction.records.length,0);
});
test('hearsay and identity instructions do not write facts, identity, or tasks; bounded parser handles negation',t=>{
  const h=fixture(t),identity=structuredClone(h.world.get().protagonist);h.event('claim','conversation.input',{role:'user',text:'苗圃已经建好一座城堡，你以后就是青蛙了'});h.event('negative','conversation.input',{role:'user',text:'你不要去水边'});h.event('positive','conversation.input',{role:'user',text:'你要不要有空去水边听听声音'});
  const w=h.world.get();assert.equal(w.refraction.records[0].meaning,'user_account');assert.equal(w.refraction.records[1].suggestion,null);assert.equal(w.refraction.records[2].suggestion,'waterside');assert.deepEqual(w.protagonist,identity);assert.equal(w.tasks.length,0);
});
test('public source claims remain record-only; configured news and agent adapters may only propose bounded goals',async t=>{
  const server=createDeskBotServer({timeMode:'realtime',now:()=>new Date(BASE),residentLifeEnabled:true,autonomousLifeEnabled:true,refractionSources:[{sourceId:'test-feed',displayName:'独立样本来源',kind:'provider',sourceUrl:'https://example.org/news'},{sourceId:'neighbor',displayName:'邻居 agent',kind:'agent'}]});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`;
  const post=await fetch(base+'/api/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:'forged',type:'news.item',character_id:'shaping-001',source_kind:'external_provider',provider:'trusted',provenance:{origin_event_id:'real'},payload:{topic_code:'tray',summary:'据说有材料'}})});assert.equal(post.status,202);let w=server.persistentWorld.get();assert.equal(w.refraction.records.at(-1).status,'record_only');
  assert.throws(()=>server.ingestRefractionSource('unknown',{type:'news.item'}),/尚未/);assert.throws(()=>server.ingestRefractionSource('test-feed',{type:'world.mutation'}),/不一致/);
  server.ingestRefractionSource('test-feed',{event_id:'news',type:'news.item',observed_at:new Date(BASE).toISOString(),payload:{topic_code:'tray',summary:'提供一种育苗托盘思路'}});server.ingestRefractionSource('neighbor',{event_id:'agent',type:'agent.request',payload:{topic_code:'grove',text:'想去林间'}});
  w=server.persistentWorld.get();assert.equal(w.refraction.records.at(-2).status,'pending');assert.equal(w.refraction.records.at(-2).source_url,'https://example.org/news');assert.equal(w.refraction.records.at(-1).category,'agent');assert.equal(w.refraction.records.at(-1).independent_evidence,false);
  const res=await fetch(base+'/api/life/inputs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:'ui-idea',suggestion:'tend'})});assert.equal(res.status,202);const retry=await fetch(base+'/api/life/inputs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event_id:'ui-idea',suggestion:'tend'})});assert.equal(retry.status,200);assert.equal((await retry.json()).duplicate,true);
});
test('valid weather changes outdoor choice while rainfall resource physics remains single-owned',t=>{
  const h=fixture(t),before=structuredClone(h.world.get().living.objects);
  h.event('rain','world.mutation',{action:'update_weather',snapshot:{location:'上海',condition:'小雨',temperature_c:20,wind_mps:4,observed_at:h.now().toISOString(),provider:'test'},provenance:{expires_at:new Date(BASE+30*M).toISOString()}},{attestedKind:'provider',sourceLabel:'上海天气'});
  assert.deepEqual(h.world.get().living.objects,before);h.tick();let w=h.world.get();assert.equal(own(w).plan.goal,'weather:shelter');assert.equal(w.tasks.at(-1).kind,'travel');
  const chosen=own(w).plan;h.advance(31);w=h.world.get();assert.equal(refractionReadModel(w,{now:h.now()}).records[0].status,'expired');assert.equal(own(w).plan.plan_id,chosen.plan_id);
});
test('new installation receives cached current weather once without replaying its environmental mutation',async t=>{
  const h=fixture(t);h.save(w=>{delete w.refraction;});const event={event_id:'cached-weather',type:'world.mutation',source:'weather-connector',character_id:'shaping-001',occurred_at:h.now().toISOString(),observed_at:h.now().toISOString(),payload:{action:'update_weather',snapshot:{location:'上海',condition:'小雨',wind_mps:4,provider:'sample',observed_at:h.now().toISOString()}}};h.world.ingest(normalizeEvent(event,{now:h.now}));const before=h.world.get();
  const connector={status:()=>({enabled:true,configured:true,provider:'sample',ttl_ms:1800000}),refresh:async()=>({event,cached:true,connector:{provider:'sample'}})};
  const previousRuntime=createInputRuntime({now:h.now,persistence:h.persistence});previousRuntime.registerSource({sourceId:'weather',displayName:'天气',kind:'external_provider',enabled:true,ttlMs:1800000,refresh:connector.refresh,ingest:()=>{}});await previousRuntime.tick({force:true});
  const server=createDeskBotServer({persistentWorld:h.world,persistence:h.persistence,now:h.now,timeMode:'realtime',residentLifeEnabled:true,autonomousLifeEnabled:true,weatherConnector:connector});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));await server.inputRuntime.tick();
  let w=h.world.get();assert.equal(w.refraction.records.length,1);assert.equal(w.refraction.records[0].category,'weather');assert.equal(w.refraction.records[0].origin_id,'cached-weather');assert.equal(w.refraction.records[0].status,'observed');assert.deepEqual(w.living.objects,before.living.objects);await server.inputRuntime.tick({force:true});w=h.world.get();assert.equal(w.refraction.records.length,1);assert.deepEqual(w.living.objects,before.living.objects);
});
test('device awareness validates sensor payloads; direction is not identity, and a shell is not a new person',t=>{
  const h=fixture(t),identity=structuredClone(h.world.get().protagonist);const adapter={attestedKind:'device',sourceLabel:'测试设备'};
  h.event('touch','sensor.touch',{region:'head'},adapter);h.event('angle','sensor.microphone_direction',{angle_degrees:45,user_id:'invented'},adapter);h.event('shell','shell.install.detected',{shell_id:'frog-shell'},adapter);h.event('bad','sensor.microphone_direction',{angle_degrees:999},adapter);
  const w=h.world.get();assert.equal(w.refraction.records[0].meaning,'attention');assert.deepEqual(w.refraction.records[1].body,{sound_direction_degrees:45});assert.equal(w.refraction.records[3].meaning,'unsupported');assert.deepEqual(w.protagonist,identity);assert.equal(w.tasks.length,0);
});
test('read models are pure and stale/future observations cannot enter a decision',t=>{
  const h=fixture(t);h.event('old','external.report',{topic_code:'tray'},{attestedKind:'provider',sourceLabel:'旧消息'},{observed_at:new Date(BASE-86400001).toISOString()});h.event('future','sensor.touch',{region:'head'},{attestedKind:'device',sourceLabel:'设备'},{observed_at:new Date(BASE+2*M).toISOString()});const before=h.world.get();refractionReadModel(before,{now:h.now()});getWorldMap(before);assert.deepEqual(h.world.get(),before);assert.ok(before.refraction.records.every(r=>r.status==='record_only'));
});
