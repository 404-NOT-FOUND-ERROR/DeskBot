import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
const dir=resolve(process.argv.find(a=>a.startsWith('--input='))?.slice(8)??'');
const a=JSON.parse(readFileSync(join(dir,'results.json'))),b=JSON.parse(readFileSync(join(dir,'replay.json')));
const differences=[];
for(const original of a.results){
  const replay=b.results.find(r=>r.key===original.key);
  if(!replay||replay.error!==original.error||replay.initial_hash!==original.initial_hash||replay.final_hash!==original.final_hash)
    differences.push({key:original.key,missing:!replay,error:replay?.error??null,initial:replay?.initial_hash===original.initial_hash,final:replay?.final_hash===original.final_hash});
}
if(b.cache?.provider_returns!==0)differences.push({error:'replay_contacted_provider'});
const errors=a.results.filter(r=>r.error).length;
const report={status:differences.length?'fail':'pass',summary:`${a.results.length-differences.length}/${a.results.length} 条初态与终态一致，新增调用 ${b.cache?.provider_returns??'未知'}${errors?`（含 ${errors} 条原失败，不计作行为成功）`:''}`,
  original_version:a.version,replay_version:b.version,cached_responses:b.cache?.hits,differences};
writeFileSync(join(dir,'replay-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(report.status!=='pass')process.exitCode=1;
