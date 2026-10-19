// Isolates the history/storage pipeline from domain reducers. This measures
// SQLite growth and reconstruction, not narrative execution or natural days.
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,statSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createSqlitePersistence} from '../apps/deskbot-service/src/persistence.mjs';
import {createPersistentWorld} from '../apps/deskbot-service/src/persistent-world.mjs';
import {createWorldHistory} from '../apps/deskbot-service/src/world-history.mjs';
import {worldHash,diffWorld,DELTA_SCHEMA} from '../apps/deskbot-service/src/world-delta.mjs';
import {traceWorldOperation} from '../apps/deskbot-service/src/world-operation-trace.mjs';
import {bindRuntimeStore,assertDistinctStores} from '../apps/deskbot-service/src/runtime-profile.mjs';

const [source,destination]=process.argv.slice(2);if(!destination)throw Error('Usage: checkpoint.sqlite new-output-directory');
const output=resolve(destination),filename=join(output,'history-store-lab.sqlite');assertDistinctStores({source,lab:filename});mkdirSync(output,{recursive:false});
const db=new DatabaseSync(resolve(source),{readOnly:true}),seed=JSON.parse(db.prepare("SELECT payload_json FROM records WHERE namespace='canonical-world.states' LIMIT 1").get().payload_json);db.close();
let p=createSqlitePersistence({filename});bindRuntimeStore(p,{scope:'lab'});p.put('canonical-world.states',seed.world_id,seed);
let world=createPersistentWorld({persistence:p,now:()=>new Date(seed.clock.synced_at)}).get(),hash=worldHash(world),indexes=[];
const history=createWorldHistory({persistence:{get:(...args)=>p.get(...args),put:(...args)=>p.put(...args)},indexes:()=>indexes,readMutation:index=>p.get('canonical-world.mutations',index.mutation_id)});
const samples=[],latencies=[],started=performance.now(),pct=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const report=()=>({schema:'deskbot.history-store-load.v1',scope:'isolated_storage_contract',source_hash:worldHash(seed),model_calls:0,
 workload:'Full real-size frozen world retained. A synthetic bounded 40-item external-context working set changes each commit. Uses actual diff, canonical hashes, operation trace, 24-record checkpoint and FULL/WAL transaction storing current state and history; excludes domain reducers and autonomous scheduling. Load cost is not end-to-end live tick latency.',samples});
for(let i=1;i<=10000;i++) {
 const begin=performance.now(),at=new Date(Date.parse(seed.updated_at)+i*1000).toISOString();
 const next={...world,world_revision:world.world_revision+1,updated_at:at,
  external_context:{...world.external_context,items:[...(world.external_context?.items??[]).slice(-39),{item_id:`storage:${i}`,title:`隔离存储样例 ${i}`,observed_at:at,category:'lab'}]}};
 const afterHash=worldHash(next),mutation={schema:'foundry.world-mutation-record.v0.2',mutation_id:`storage-mutation:${i}`,event_id:`storage:${i}`,
  world_id:world.world_id,sequence:i,action:'record_external_context',event_source:'isolated-storage-fixture',before_revision:world.world_revision,after_revision:next.world_revision,committed_at:at,changes:diffWorld(world,next)};
 const prepared=history.prepare(world,mutation,i-1,hash);
 mutation.replay={schema:DELTA_SCHEMA,base_checkpoint_id:prepared.base_checkpoint_id,previous_sequence:i-1,before_hash:hash,after_hash:afterHash};
 mutation.operation_trace=traceWorldOperation(world,next,mutation);
 p.transaction(()=>{history.persist(prepared.checkpoint);p.put('canonical-world.states',world.world_id,next);p.insert('canonical-world.mutations',mutation.mutation_id,mutation);});
 prepared.commit(afterHash);indexes.push({mutation_id:mutation.mutation_id,event_id:mutation.event_id,world_id:world.world_id,sequence:i,schema:mutation.schema});world=next;hash=afterHash;latencies.push(performance.now()-begin);
 if(i%1000===0)console.log(JSON.stringify({records:i,elapsed_seconds:Math.round((performance.now()-started)/1000)}));
 if([1000,10000].includes(i)){
  const storage=p.storageStats({logical:true}),replays=[];
  for(const sequence of [i,i-1,i-12]){const start=performance.now(),result=history.replayAt({worldId:world.world_id,sequence});replays.push({sequence,ms:performance.now()-start,applied_records:result.applied_records,verified:result.verified});if(sequence===i&&result.hash!==hash)throw Error('replay hash mismatch');}
  p.close();const closedBytes=statSync(filename).size,restart=performance.now();p=createSqlitePersistence({filename});const reloaded=createPersistentWorld({persistence:p,now:()=>new Date(world.clock.synced_at)}),restartMs=performance.now()-restart;
  if(worldHash(reloaded.get())!==hash)throw Error('restart changed state');const pageStart=performance.now(),page=reloaded.listOperations({limit:12,order:'desc'}),pageMs=performance.now()-pageStart;
  if(page.head_sequence!==i)throw Error('missing history on restart');
  samples.push({records:i,write_ms:{p50:pct(latencies,.5),p95:pct(latencies,.95),max:Math.max(...latencies)},storage,replays,restart_ms:restartMs,latest_page_ms:pageMs,bytes_after_close:closedBytes,restart_verified:true,restart_hash:hash});
  writeFileSync(join(output,'report.json'),JSON.stringify(report(),null,2));console.log(JSON.stringify(samples.at(-1)));
 }
}
p.close();writeFileSync(join(output,'report.json'),JSON.stringify({...report(),elapsed_seconds:(performance.now()-started)/1000},null,2));
