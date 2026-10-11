// Usage-only ledger: no prompt, answer, private memory, sensor payload or credential.
const NS='model-usage.attempts';
export const USAGE_PRICING={model:'deepseek-flash',currency:'CNY',input_miss:2,input_hit:.04,output:8,per:1000000,checked_at:'2026-10-11',basis:'peak_upper_estimate',source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'};
export function createModelUsage({persistence,now=()=>new Date()}={}){
 const volatile=new Map();
 function record(event){
  const id=event.call_id;if(typeof id!=='string'||!id)throw Error('usage_call_id_required');
  const old=persistence?.get(NS,id)??volatile.get(id)??{};
  const raw=event.usage,usage=raw&&Number.isSafeInteger(raw.prompt_tokens)&&raw.prompt_tokens>=0&&Number.isSafeInteger(raw.completion_tokens)&&raw.completion_tokens>=0
   ?{prompt_tokens:raw.prompt_tokens,completion_tokens:raw.completion_tokens,prompt_cache_hit_tokens:Math.min(raw.prompt_tokens,Math.max(0,Number(raw.prompt_cache_hit_tokens)||0))}:old.usage??null;
  const model=event.model??old.model??'unknown';
  const cost=usage&&['deepseek-flash','deepseek-v4.1-flash'].includes(model)
   ?((usage.prompt_tokens-usage.prompt_cache_hit_tokens)*2+usage.prompt_cache_hit_tokens*.04+usage.completion_tokens*8)/1e6:null;
  const row={call_id:id,category:event.category??old.category??'unclassified',scope:event.scope??old.scope??'live',model,
   status:event.status??old.status??'unknown',started_at:old.started_at??event.started_at??now().toISOString(),updated_at:now().toISOString(),
   attempt:event.attempt??old.attempt??1,latency_ms:event.latency_ms??old.latency_ms??null,error_code:event.error_code??old.error_code??null,
   usage,estimated_upper_cny:cost,usage_known:usage!==null};
  if(persistence)persistence.put(NS,id,row);else volatile.set(id,row);
  return row;
 }
 function status(){
  const rows=persistence?persistence.list(NS):[...volatile.values()];
  const aggregate=items=>({attempts:items.length,usage_known:items.filter(i=>i.usage_known).length,usage_unknown:items.filter(i=>!i.usage_known).length,
   estimated_upper_cny:items.reduce((sum,i)=>sum+(i.estimated_upper_cny??0),0),input_tokens:items.reduce((sum,i)=>sum+(i.usage?.prompt_tokens??0),0),output_tokens:items.reduce((sum,i)=>sum+(i.usage?.completion_tokens??0),0)});
  return {schema:'deskbot.model-usage.v1',since:rows[0]?.started_at??null,pricing:USAGE_PRICING,totals:aggregate(rows),
   categories:Object.fromEntries([...new Set(rows.map(r=>r.category))].sort().map(c=>[c,aggregate(rows.filter(r=>r.category===c))])),
   scopes:Object.fromEntries([...new Set(rows.map(r=>r.scope))].sort().map(c=>[c,aggregate(rows.filter(r=>r.scope===c))])),recent:rows.slice(-80),
   note:'从安装后逐次记录；历史未观测调用不补造。失败且缺失提供者用量的调用单列未知，估算不是账户账单。'};
 }
 return {record,status};
}
