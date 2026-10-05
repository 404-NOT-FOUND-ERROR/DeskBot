// Frozen, isolated input samples. No network calls and no production DB reads.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createPersistentWorld,getWorldMap} from '../../deskbot-service/src/persistent-world.mjs';
import {createAutonomousLife} from '../../deskbot-service/src/autonomous-life.mjs';
import {createWorldLife} from '../../deskbot-service/src/world-life.mjs';
import {getWorldEnvironment} from '../../deskbot-service/src/world-environment.mjs';
import {refractionReadModel} from '../../deskbot-service/src/input-refraction.mjs';
const frames={},base=Date.parse('2026-10-05T04:00:00Z');
function sample(){
  let at=base;const now=()=>new Date(at),records=new Map();
  const persistence={get(ns,id){return structuredClone(records.get(ns+':'+id)??null);},list(ns){return [...records.entries()].filter(([k])=>k.startsWith(ns+':')).map(([,v])=>structuredClone(v));},put(ns,id,v){records.set(ns+':'+id,structuredClone(v));},insert(ns,id,v){this.put(ns,id,v);},transaction(fn){return fn();}};
  let world=createPersistentWorld({now,persistence,timeMode:'realtime'});
  const event=(id,type,payload,adapter={})=>world.ingest({event_id:id,type,source:'independent-input-sample',character_id:'shaping-001',occurred_at:now().toISOString(),payload},adapter);
  createWorldLife({now,worldSnapshot:()=>world.get(),ingest:e=>world.ingest(e),enabled:true}).seedNpcs();event('residents','world.mutation',{action:'install_resident_life'});event('refraction','world.mutation',{action:'install_input_refraction'});
  const save=fn=>{const w=world.get();fn(w);persistence.put('canonical-world.states',w.world_id,w);world=createPersistentWorld({now,persistence,timeMode:'realtime'});};
  save(w=>{for(const actor of Object.values(w.autonomy.actors))actor.paused=actor.actor_id!=='shaping-001';delete w.social;w.protagonist.location_id='moss-sprout-garden';w.living.objects['garden-bed'].moisture=.55;w.living.objects['garden-bed'].health=.9;w.living.objects['garden-bed'].growth=.2;w.living.objects['seedling-rack'].stock.trays=2;});
  return {get world(){return world;},save,event,tick(){createAutonomousLife({world,now,enabled:true}).tick();},run(minutes){for(let i=0;i<minutes;i++){at+=60000;world.syncWallClock();world.syncTasks();this.tick();}},
    frame(id,label){const w=world.get(),map=getWorldMap(w);map.environment=getWorldEnvironment(w,{now:now()});map.refraction=refractionReadModel(w,{now:now()});frames[id]={label,map};}};
}
const accepted=sample();accepted.event('suggest-tend','user.preference.life',{suggestion:'tend'},{attestedKind:'user',sourceLabel:'专项样本 · 用户建议'});accepted.frame('begin','建议送达 · 尚未行动');accepted.tick();accepted.run(2);assert.equal(accepted.world.get().refraction.records[0].status,'chosen');accepted.frame('chosen','采纳建议 · 实际照料中');accepted.run(16);assert.equal(accepted.world.get().refraction.records[0].status,'completed');accepted.frame('completed','做完以后 · 材料与苗况变化');
const tired=sample();tired.save(w=>{w.autonomy.actors['shaping-001'].energy=.1;});tired.event('suggest','user.preference.life',{suggestion:'tend'},{attestedKind:'user',sourceLabel:'专项样本 · 用户建议'});tired.tick();tired.run(2);assert.equal(tired.world.get().refraction.records[0].status,'deferred');tired.frame('deferred','暂缓建议 · 先恢复精神');
const wet=sample();wet.save(w=>{w.living.objects['garden-bed'].moisture=.72;});wet.event('water','user.preference.life',{suggestion:'water'},{attestedKind:'user',sourceLabel:'专项样本 · 用户建议'});wet.tick();wet.run(2);assert.match(wet.world.get().refraction.records[0].last_note,/不缺水/);wet.frame('wet','暂缓浇水 · 苗床已经湿润');
const rain=sample();rain.event('rain','world.mutation',{action:'update_weather',snapshot:{location:'上海',condition:'小雨',temperature_c:20,wind_mps:4,observed_at:new Date(base).toISOString(),provider:'independent-sample'}},{attestedKind:'provider',sourceLabel:'专项样本 · 模拟雨天'});rain.tick();rain.run(2);assert.equal(rain.world.get().autonomy.actors['shaping-001'].plan.goal,'weather:shelter');rain.frame('rain','模拟雨天 · 自己决定避雨');
const body=sample();body.event('direction','sensor.microphone_direction',{angle_degrees:45},{attestedKind:'device',sourceLabel:'专项样本 · 模拟设备'});body.event('shell','shell.install.detected',{shell_id:'frog-shell'},{attestedKind:'device',sourceLabel:'专项样本 · 模拟设备'});assert.equal(body.world.get().tasks.length,0);body.frame('body','模拟感知 · 有方向，没有身份猜测');
writeFileSync(new URL('../public/input-review-fixtures.json',import.meta.url),JSON.stringify({schema:'deskbot.autonomy-review.v1',description:'独立固定时钟专项；仅观察喵呜的安排，其他居民暂停自发安排。天气与设备数据明确为模拟，无网络请求，不写入正式存档。',frames},null,2));
console.log(JSON.stringify({frames:Object.keys(frames),verified:true,production_writes:0}));
