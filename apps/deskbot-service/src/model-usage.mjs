import {randomUUID} from 'node:crypto';
// Usage-only ledger: no prompt, answer, private memory, sensor payload or credential.
const NS='model-usage.attempts';
export const USAGE_PRICING={model:'deepseek-flash',currency:'CNY',input_miss:2,input_hit:.04,output:8,per:1000000,checked_at:'2026-10-11',basis:'dated_configured_upper_estimate',source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'};
const scopeOf=s=>['real_time','live'].includes(s)?'live':['lab','isolated_test_clock','isolated_experiment','isolated_fictional_test_clock'].includes(s)?'lab':'unclassified';
const duration=n=>Number.isFinite(n)&&n>=0?n:null;
const distribution=values=>{
 const sorted=values.filter(n=>n!==null).sort((a,b)=>a-b),pct=q=>sorted.length?sorted[Math.ceil(sorted.length*q)-1]:null;
 return {samples:sorted.length,p50:pct(.5),p95:pct(.95),max:sorted.at(-1)??null};
};
export function createModelUsage({persistence,now=()=>new Date(),runId=`run:${randomUUID()}`,defaultScope='live',recoverInterrupted=true}={}){
 const rows=new Map((persistence?.list(NS)??[]).map(row=>[row.call_id,{...row,scope:scopeOf(row.scope)}]));
 function save(row){if(persistence)persistence.put(NS,row.call_id,row);rows.set(row.call_id,row);return row;}
 if(recoverInterrupted)for(const row of rows.values())if(['calling','reserved'].includes(row.status))save({...row,status:'interrupted',error_code:'process_restarted',updated_at:now().toISOString()});
 function record(event){
  const id=event.call_id;if(typeof id!=='string'||!id)throw Error('usage_call_id_required');
  const old=rows.get(id)??{},raw=event.usage;
  const usage=raw&&Number.isSafeInteger(raw.prompt_tokens)&&raw.prompt_tokens>=0&&Number.isSafeInteger(raw.completion_tokens)&&raw.completion_tokens>=0
   ?{prompt_tokens:raw.prompt_tokens,completion_tokens:raw.completion_tokens,prompt_cache_hit_tokens:Number.isSafeInteger(raw.prompt_cache_hit_tokens)?Math.min(raw.prompt_tokens,Math.max(0,raw.prompt_cache_hit_tokens)):0}:old.usage??null;
  const model=event.model??old.model??'unknown',providerKind=event.provider_kind??old.provider_kind??'provider';
  const cost=providerKind==='provider'&&usage&&['deepseek-flash','deepseek-v4.1-flash'].includes(model)
   ?((usage.prompt_tokens-usage.prompt_cache_hit_tokens)*USAGE_PRICING.input_miss+usage.prompt_cache_hit_tokens*USAGE_PRICING.input_hit+usage.completion_tokens*USAGE_PRICING.output)/1e6:null;
  return save({call_id:id,request_id:event.request_id??old.request_id??id,run_id:old.run_id??event.run_id??runId,
   category:event.category??old.category??'unclassified',scope:scopeOf(event.scope??old.scope??defaultScope),model,provider_kind:providerKind,
   status:event.status??old.status??'unknown',started_at:old.started_at??event.started_at??now().toISOString(),updated_at:now().toISOString(),
   attempt:event.attempt??old.attempt??1,latency_ms:duration(event.latency_ms??old.latency_ms),
   queue_ms:duration(event.queue_ms??old.queue_ms),request_elapsed_ms:duration(event.request_elapsed_ms??old.request_elapsed_ms),
   error_code:event.error_code??old.error_code??null,usage,estimated_upper_cny:cost,usage_known:usage!==null,pricing_date:cost===null?null:USAGE_PRICING.checked_at});
 }
 function status({scope='all',run_id=null}={}){
  const selected=[...rows.values()].filter(r=>(scope==='all'||r.scope===scope)&&(!run_id||r.run_id===run_id));
  function aggregate(items){
   const settled=items.filter(i=>!['calling','reserved'].includes(i.status)),requests=new Map();
   for(const item of settled){const key=item.request_id??item.call_id,elapsed=item.request_elapsed_ms??null;if(elapsed!==null)requests.set(key,Math.max(requests.get(key)??0,elapsed));}
   return {attempts:items.length,usage_known:items.filter(i=>i.usage_known).length,usage_unknown:items.filter(i=>!i.usage_known).length,
    provider_attempts:items.filter(i=>i.provider_kind!=='fixture').length,fixture_attempts:items.filter(i=>i.provider_kind==='fixture').length,
    calling:items.length-settled.length,failed:items.filter(i=>['failed','interrupted'].includes(i.status)).length,
    cost_known_attempts:items.filter(i=>i.estimated_upper_cny!=null).length,
    estimated_upper_cny:items.reduce((sum,i)=>sum+(i.estimated_upper_cny??0),0),input_tokens:items.reduce((sum,i)=>sum+(i.usage?.prompt_tokens??0),0),output_tokens:items.reduce((sum,i)=>sum+(i.usage?.completion_tokens??0),0),
    attempt_latency_ms:distribution(settled.map(i=>i.latency_ms??null)),queue_latency_ms:distribution(settled.map(i=>i.queue_ms??null)),request_latency_ms:distribution([...requests.values()])};
  }
  const group=key=>Object.fromEntries([...new Set(selected.map(r=>r[key]??'unclassified'))].sort().map(k=>[k,aggregate(selected.filter(r=>(r[key]??'unclassified')===k))]));
  return {schema:'deskbot.model-usage.v2',scope,run_id:runId,filter_run_id:run_id,since:selected[0]?.started_at??null,pricing:USAGE_PRICING,totals:aggregate(selected),
   categories:group('category'),scopes:group('scope'),recent:selected.slice(-80),
   note:'仅含已接入此服务账本的调用。历史未观测调用不补造；缺用量、未知价格、测试调用分别标注。金额按标注日期配置估算，不是账户账单；请求延迟包含重试或代理排队，不含整轮角色思考。'};
 }
 return {record,status};
}
