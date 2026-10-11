import {createHash} from 'node:crypto';
import {loadLlmConfiguration} from './llm.mjs';

export const PRICING={currency:'CNY',input_miss_per_million:2,input_hit_per_million:.04,output_per_million:8,
  checked_at:'2026-10-10',basis:'peak_price_upper_estimate',source:'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'};
function error(code,message=code){return Object.assign(new Error(message),{code});}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function createCognitiveBudget({persistence,now=()=>new Date(),configuration=null,fetchImpl=globalThis.fetch,
  limitCny=2,maxCalls=120,timeoutMs=45000,testProvider=null,namespace='cognition-stage2',approvalId='first-experiment',
  approvalSource='human:首轮最多 2 元',scope='stage2 cognition experiment only',onUsage=null}={}) {
  if(!persistence)throw error('budget_persistence_required');
  if(!/^[a-z0-9.-]+$/.test(namespace)||!approvalId||!approvalSource||!scope||(limitCny!==null&&(!Number.isFinite(limitCny)||limitCny<0))
    ||(maxCalls!==null&&(!Number.isSafeInteger(maxCalls)||maxCalls<1)))throw error('budget_configuration_invalid');
  if((limitCny===null||maxCalls===null)&&approvalSource==='human:首轮最多 2 元')throw error('unlimited_authorization_required');
  const NS=`${namespace}.calls`,BUDGET=`${namespace}.budget`;
  const approval=persistence.get(BUDGET,approvalId) ?? {id:approvalId,limit_cny:limitCny,max_calls:maxCalls,
    approved_at:now().toISOString(),approval_source:testProvider?'test_fixture':approvalSource,scope,pricing:PRICING};
  if(approval.limit_cny!==limitCny || approval.max_calls!==maxCalls)throw error('budget_configuration_changed');
  persistence.put(BUDGET,approval.id,approval);
  for(const row of persistence.list(NS)) if(['reserved','calling'].includes(row.status))persistence.put(NS,row.call_id,{...row,status:'interrupted',uncertain:true});
  let tail=Promise.resolve(),closed=false,queued=0;
  function status(){
    const calls=persistence.list(NS),used=calls.reduce((n,c)=>n+c.held_cny,0);
    return {approval,used_upper_cny:used,remaining_cny:approval.limit_cny===null?null:Math.max(0,approval.limit_cny-used),calls:calls.map(({response,...r})=>r),queued,
      billed_cost_cny:null,cost_note:'按峰时价格保守估算；失败且无用量的调用保留预留额度，不代表账户账单。',retrieval:'local lexical + recency; no paid embedding'};
  }
  async function execute(callId,request){
    if(closed)throw error('broker_closed');
    if(!Array.isArray(request.messages)||request.messages.length>12||request.messages.some(m=>!['user','system','assistant'].includes(m.role)||typeof m.content!=='string'))throw error('invalid_model_messages');
    const max_tokens=Math.min(1800,Math.max(256,Math.floor(request.max_tokens||900)));
    const body={model:'deepseek-flash',messages:request.messages,max_tokens,temperature:Math.min(1,Math.max(0,request.temperature??.55)),
      thinking:{type:'disabled'},...(request.json_mode?{response_format:{type:'json_object'}}:{})};
    const fingerprint=hash(body),existing=persistence.get(NS,callId);
    if(existing){if(existing.fingerprint!==fingerprint)throw error('call_id_conflict');if(existing.status==='completed')return existing.response;throw error('call_not_replayable');}
    const config=testProvider?null:configuration??loadLlmConfiguration();
    if(!testProvider&&(config.model!=='deepseek-flash'||new URL(config.base_url??'https://invalid.local').origin!=='https://api.deepseek.com'))throw error('unsupported_paid_configuration');
    // UTF-8 byte ceiling plus per-message/chat framing allowance. No tokenizer estimate billed as truth.
    const inputCeiling=Buffer.byteLength(JSON.stringify(body.messages),'utf8')+body.messages.length*256+1024;
    const reserved=testProvider?0:(inputCeiling*2+max_tokens*8)/1e6;
    let row={call_id:callId,fingerprint,scene:request.scene,stage:request.stage??request.scene,usage_source:testProvider?'test_fixture':'provider',mode:testProvider?'mock':'real',status:'reserved',held_cny:reserved,
      reserved_cny:reserved,input_token_ceiling:inputCeiling,output_token_ceiling:max_tokens,started_at:now().toISOString(),usage:null,latency_ms:null,uncertain:false};
    const reserve=()=>{
      if(persistence.get(NS,callId))throw error('call_not_replayable');
      const current=status();if(maxCalls!==null&&current.calls.length>=maxCalls)throw error('call_limit_reached');
      if(approval.limit_cny!==null&&current.used_upper_cny+reserved>approval.limit_cny+1e-10)throw error('budget_exhausted','已达到本轮额度，停止新调用。');
      persistence.put(NS,callId,row);
    };
    if(persistence.transaction)persistence.transaction(reserve);else reserve();
    const reportUsage=()=>onUsage?.({call_id:callId,category:`cognition.${request.phase??request.stage??request.scene??'unknown'}`,scope:request.usage_scope??'isolated_experiment',model:'deepseek-flash',
      status:row.status,started_at:row.started_at,usage:row.usage,latency_ms:row.latency_ms,error_code:row.error_code});
    const started=performance.now();row.status='calling';persistence.put(NS,callId,row);reportUsage();
    try{
      let payload;
      if(testProvider)payload=await testProvider(request);
      else{
        const endpoint=config.base_url.replace(/\/$/,'')+'/chat/completions';
        const res=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:`Bearer ${config.api_key}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
        if(!res.ok){
          // Keep a bounded, redacted diagnostic without logging request headers or local configuration.
          let diagnostic='';try{const body=await res.json();diagnostic=String(body.error?.message??body.message??'').replaceAll(config.api_key,'[redacted]').slice(0,300);}catch{}
          row.provider_error=diagnostic;
          throw Object.assign(error('provider_http_error',`DeepSeek HTTP ${res.status}${diagnostic?`: ${diagnostic}`:''}`),{status:res.status,retryable:res.status===408||res.status===429||res.status>=500});
        }
        payload=await res.json();
      }
      const usage=payload.usage;
      if(!testProvider && (!usage || !Number.isSafeInteger(usage.prompt_tokens)||!Number.isSafeInteger(usage.completion_tokens)||usage.prompt_tokens<0||usage.completion_tokens<0))throw error('provider_usage_missing');
      row.usage=usage??{prompt_tokens:0,completion_tokens:0,prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:0};
      const hit=Math.min(row.usage.prompt_tokens,Math.max(0,row.usage.prompt_cache_hit_tokens||0)),miss=row.usage.prompt_tokens-hit;
      const actual=(miss*2+hit*.04+row.usage.completion_tokens*8)/1e6;
      row.held_cny=testProvider?0:actual;
      row.latency_ms=Math.round(performance.now()-started);row.finish_reason=payload.choices?.[0]?.finish_reason;
      // Save usage before parsing: malformed/truncated JSON is still chargeable.
      persistence.put(NS,callId,row);
      const content=payload.choices?.[0]?.message?.content;
      if(row.finish_reason!=='stop'||!content)throw error('provider_incomplete_response');
      if(request.json_mode)JSON.parse(content);
      const response={content,model:payload.model??'deepseek-flash',input_tokens:row.usage.prompt_tokens,output_tokens:row.usage.completion_tokens};
      row={...row,status:'completed',response,finished_at:now().toISOString()};persistence.put(NS,callId,row);reportUsage();return response;
    }catch(e){if(!e.code&&!row.usage&&['TypeError','TimeoutError','AbortError'].includes(e.name))e=Object.assign(error('provider_transport_error'),{retryable:true});
      row={...row,status:'failed',error_code:e.code??'provider_response_invalid',uncertain:!row.usage,latency_ms:Math.round(performance.now()-started)};
      persistence.put(NS,callId,row);reportUsage();throw e;}
  }
  function complete(id,request){
    if(queued>=12)return Promise.reject(error('model_queue_full'));
    queued++;const promise=tail.then(()=>execute(id,request));tail=promise.catch(()=>{});
    return promise.finally(()=>queued--);
  }
  return {complete,status,close:async()=>{closed=true;await tail;}};
}
