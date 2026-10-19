// Storage/latency load experiment, not an accelerated-life or narrative test.
// Uses a local frozen world's full-sized working set in a NEW marked lab DB.
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,statSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createSqlitePersistence} from '../apps/deskbot-service/src/persistence.mjs';
import {createPersistentWorld} from '../apps/deskbot-service/src/persistent-world.mjs';
import {worldHash} from '../apps/deskbot-service/src/world-delta.mjs';
import {bindRuntimeStore,assertDistinctStores} from '../apps/deskbot-service/src/runtime-profile.mjs';

const [source,destination,target='10000']=process.argv.slice(2),maximum=Number(target);
if(!source||!destination||![1000,10000].includes(maximum))throw Error('Usage: checkpoint.sqlite new-output-directory [1000|10000]');
const output=resolve(destination),filename=join(output,'storage-lab.sqlite');assertDistinctStores({source,lab:filename});mkdirSync(output,{recursive:false});
const db=new DatabaseSync(resolve(source),{readOnly:true}),row=db.prepare("SELECT payload_json FROM records WHERE namespace='canonical-world.states' LIMIT 1").get();db.close();
const seed=JSON.parse(row.payload_json),sourceHash=worldHash(seed);let at=new Date(seed.clock.synced_at);
let p=createSqlitePersistence({filename,now:()=>at});bindRuntimeStore(p,{scope:'lab'});p.put('canonical-world.states',seed.world_id,seed);
let world=createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at});
const samples=[],latencies=[],started=performance.now(),pct=(values,q)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*q)-1];
const report=()=>({schema:'deskbot.history-growth.v1',scope:'isolated_storage_workload',source_hash:sourceHash,model_calls:0,
 workload:'Full frozen world and fixed world clock. Each commit updates one of 40 synthetic external-context items through authoritative ingest, including trace, hashes, checkpoint, current state and SQLite FULL/WAL. No life scheduler or model invoked. Not projected days of natural life.',samples});
for(let i=1;i<=maximum;i++){
 // Hold the world clock fixed: isolate persistence from startup wall-clock catch-up.
 const start=performance.now();
 world.ingest({event_id:`storage-lab:${i}`,type:'world.mutation',source:'isolated-storage-fixture',occurred_at:at.toISOString(),payload:{action:'record_external_context',item:{item_id:`fixture:${i%40}`,title:`隔离存储样例 ${i}`,summary:'仅用于有限上下文保留、增量记录与重启量测。',category:'lab',observed_at:at.toISOString()}}});
 latencies.push(performance.now()-start);
 if(i%250===0)console.log(JSON.stringify({records:i,elapsed_seconds:Math.round((performance.now()-started)/1000)}));
 if([1000,10000].includes(i)){
  const before=world.get(),hash=worldHash(before),storage=p.storageStats({logical:true}),replays=[];
  for(const sequence of [i,i-1,i-12]){const begin=performance.now(),result=world.replayAt({sequence});replays.push({sequence,ms:performance.now()-begin,applied_records:result.applied_records,verified:result.verified});if(sequence===i&&result.hash!==hash)throw Error('replay hash mismatch');}
  const bytesBeforeClose=statSync(filename).size;p.close();const closedBytes=statSync(filename).size;
  const restart=performance.now();p=createSqlitePersistence({filename,now:()=>at});world=createPersistentWorld({persistence:p,timeMode:'realtime',now:()=>at});
  const restartedMs=performance.now()-restart;if(worldHash(world.get())!==hash)throw Error('restart changed authoritative state');
  const pageStarted=performance.now(),page=world.listOperations({limit:12,order:'desc'}),pageMs=performance.now()-pageStarted;
  if(page.head_sequence!==i)throw Error('lost history at restart');
  samples.push({records:i,write_ms:{p50:pct(latencies,.5),p95:pct(latencies,.95),max:Math.max(...latencies)},storage,replays,restart_ms:restartedMs,
    latest_page_ms:pageMs,bytes_before_close:bytesBeforeClose,bytes_after_close:closedBytes,restart_hash:hash,restart_verified:true});
  writeFileSync(join(output,'report.json'),JSON.stringify(report(),null,2));console.log(JSON.stringify(samples.at(-1)));
 }
}
p.close();writeFileSync(join(output,'report.json'),JSON.stringify({...report(),elapsed_seconds:(performance.now()-started)/1000},null,2));
