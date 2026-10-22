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
if(a.version!==b.version)differences.push({error:'replay_version_mismatch'});
if(a.results.length!==b.results.length)differences.push({error:'replay_case_count_mismatch'});
const statesMatched=a.results.filter(original=>{const replay=b.results.find(r=>r.key===original.key);return replay&&replay.initial_hash===original.initial_hash&&replay.final_hash===original.final_hash;}).length;
const terminationsMatched=a.results.filter(original=>b.results.some(r=>r.key===original.key&&r.error===original.error)).length;
const errors=a.results.filter(r=>r.error).length;
const report={status:differences.length?'fail':'pass',summary:`世界初态/终态 ${statesMatched}/${a.results.length} 条一致；停止原因 ${terminationsMatched}/${a.results.length} 条一致；新增调用 ${b.cache?.provider_returns??'未知'}。严格回放${differences.length?'未通过':'通过'}${errors?`（含 ${errors} 条原停止，不计作行为成功）`:''}。`,
  original_version:a.version,replay_version:b.version,cached_responses:b.cache?.hits,state_matches:statesMatched,termination_matches:terminationsMatched,differences};
writeFileSync(join(dir,'replay-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
if(report.status!=='pass')process.exitCode=1;
