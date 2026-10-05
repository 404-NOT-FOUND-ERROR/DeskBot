// Independent deterministic rule replay. It never opens the user's live SQLite.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createPersistentWorld, getWorldMap } from '../../deskbot-service/src/persistent-world.mjs';
const BASE=Date.parse('2026-10-04T04:00:00Z');
function fixture() {
  let time=BASE, counter=0, world;
  const records=new Map();
  const persistence={get(ns,id){return structuredClone(records.get(ns+':'+id)??null);},list(ns){return [...records.entries()].filter(([key])=>key.startsWith(ns+':')).map(([,value])=>structuredClone(value));},put(ns,id,value){records.set(ns+':'+id,structuredClone(value));},insert(ns,id,value){this.put(ns,id,value);},transaction(fn){return fn();}};
  const load=()=>world=createPersistentWorld({now:()=>new Date(time),persistence,timeMode:'realtime'});load();
  const mutate=payload=>world.ingest({event_id:`fixture-${++counter}`,type:'world.mutation',source:'isolated-rule-replay',source_kind:'world_engine',character_id:'shaping-001',occurred_at:new Date(time).toISOString(),payload});
  return {get world(){return world;},get time(){return time;},mutate,
    place(id){const state=world.get();state.protagonist.location_id=id;persistence.put('canonical-world.states',state.world_id,state);load();},
    advance(ms){time+=ms;world.syncWallClock();world.syncTasks();},
    rain(){const at=new Date(time).toISOString();world.ingest({event_id:`rain-${++counter}`,type:'world.mutation',source:'fixture-connector',source_kind:'external_provider',character_id:'shaping-001',occurred_at:at,
      provenance:{connector:'weather',manually_injected:false,fetched_at:at,expires_at:new Date(time+1800000).toISOString()},payload:{action:'update_weather',snapshot:{location:'独立规则回放',condition:'大雨',wind_mps:30,temperature_c:20,humidity:.8,observed_at:at,provider:'fixture'}}});},
    activity(id){return mutate({action:'start_activity',activity_id:id,task_id:`fixture-task-${++counter}`});},
    transfer(object_id,resource,count,operation='take'){return mutate({action:'transfer_resource',object_id,resource,count,operation});},
    travel(first,destination=first){mutate({action:'move_protagonist',location_id:first,destination_location_id:destination});this.advance(90*60000);assert.equal(world.get().protagonist.location_id,destination);},
  };
}
const samples={};
function save(id,label,h,description){samples[id]={label,description,map:getWorldMap(h.world.get())};}
const initial=fixture();save('initial','初始苗圃',initial,'新安装的初始资源，未改动真实存档。');
const growing=fixture();growing.place('moss-sprout-garden');
for(let i=0;i<72;i++){growing.advance(3600000);const bed=growing.world.get().living.objects['garden-bed'];
  if(bed.moisture<.3){growing.activity('water-bed');growing.advance(300000);}
}
assert.ok(growing.world.get().living.objects['garden-bed'].growth>=.85);save('grown','照料后的成熟苗',growing,'独立世界经过三天，完成真实耗时的浇水任务；苗木达到收获条件。');
growing.activity('harvest-bed');growing.advance(900000);assert.equal(growing.world.get().living.objects['garden-bed'].quantity,0);save('harvested','收获后的苗床',growing,'收获任务已完成，鲜苔芽进入随身袋，苗床空置。');
const storm=fixture();for(let i=0;i<24;i++){storm.rain();storm.advance(1800000);}
assert.ok(storm.world.get().living.objects['floating-frame'].water_level>.88);assert.ok(storm.world.get().living.objects['market-canopy'].condition<.4);
save('storm','连续风雨后的积水与损坏',storm,'独立世界连续十二小时收到有效风雨样本；高水位、积水、涝伤和雨棚破损均由规则计算。');
storm.advance(4*3600000);storm.place('spare-parts-house');storm.activity('craft-frame-kit');storm.advance(1500000);
storm.transfer('parts-drawers','cloth',2);storm.transfer('parts-drawers','fasteners',1);
storm.travel('tidal-old-road','echo-waterside');storm.activity('repair-frame');storm.advance(1200000);
storm.travel('whisper-market');storm.activity('stitch-canopy');storm.advance(1080000);
assert.ok(storm.world.get().living.objects['floating-frame'].condition>.5);assert.ok(storm.world.get().living.objects['market-canopy'].condition>.6);
save('repaired','修缮后的设施与库存',storm,'经过制作、携带、真实旅行和修缮，浮框与雨棚恢复；有限木料、布料、紧固件已消耗。');
const dry=fixture();dry.advance(7*86400000);assert.ok(dry.world.get().living.objects['garden-bed'].dead_quantity>0);save('dry','七天失水后的枯苗',dry,'独立世界经过七天，没有虚构历史雨水；土壤失水，苗木枯萎。');
const directory=new URL('../public/',import.meta.url);mkdirSync(directory,{recursive:true});
writeFileSync(new URL('living-review-fixtures.json',directory),JSON.stringify({schema:'deskbot.living-rule-review.v1',isolated:true,samples},null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(samples).map(([id,s])=>[id,{label:s.label,until:s.map.living.simulated_until,bed:s.map.objects.find(o=>o.object_id==='garden-bed').state,water:s.map.objects.find(o=>o.object_id==='floating-frame').state,inventory:s.map.living.inventory}]))));
