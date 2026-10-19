import {useEffect,useRef,useState} from 'react';

type Distribution={samples:number;p50:number|null;p95:number|null;max:number|null};
type Totals={attempts:number;usage_unknown:number;estimated_upper_cny:number;cost_known_attempts:number;calling:number;failed:number;fixture_attempts:number;
 input_tokens:number;output_tokens:number;attempt_latency_ms:Distribution;request_latency_ms:Distribution;queue_latency_ms:Distribution};
export type UsageReport={schema:string;available?:boolean;note:string;scope:string;pricing:{checked_at:string};totals:Totals;categories:Record<string,Totals>};
type Observation={profile:{scope:string;clock_scope:string;started_at:string}|null;storage:{database_bytes:number;wal_bytes:number;note:string}|null};
const categories:Record<string,string>={chat:'对话',life_choice:'生活选择',news_translation:'新闻翻译',connection_probe:'连接验证',unclassified:'未分类'};
const seconds=(value:number|null)=>value===null?'尚无样本':`${(value/1000).toFixed(2)} 秒`;

export function UsageSummary({report}:{report:UsageReport}) {
 if(report.available===false)return <p>{report.note}</p>;
 const t=report.totals;
 return <><p>本范围记录 {t.attempts} 次尝试，其中 {t.calling} 次进行中、{t.failed} 次失败或中断、{t.usage_unknown} 次用量未知。</p>
  <p>已知价格及用量的 {t.cost_known_attempts} 次合计估算 ¥{t.estimated_upper_cny.toFixed(4)}；价格配置日期 {report.pricing.checked_at}。{t.fixture_attempts?`另有 ${t.fixture_attempts} 次模拟提供者调用。`:''}</p>
  <p>单次模型请求 P50 / P95：{seconds(t.attempt_latency_ms.p50)} / {seconds(t.attempt_latency_ms.p95)}。包含重试或排队的请求 P95：{seconds(t.request_latency_ms.p95)}。</p>
  <ul>{Object.entries(report.categories).map(([key,c])=><li key={key}>{categories[key]??(key.startsWith('cognition.')?`认知 · ${key.slice(10)}`:key)}：{c.attempts} 次，用量未知 {c.usage_unknown} 次，{c.input_tokens.toLocaleString()} 输入 / {c.output_tokens.toLocaleString()} 输出 token</li>)}</ul>
  <small>{report.note}</small></>;
}
export function RuntimeDiagnostics({baseUrl}:{baseUrl:string}) {
 const [scope,setScope]=useState('live'),[data,setData]=useState<UsageReport|null>(null),[observation,setObservation]=useState<Observation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null),generation=useRef(0);
 useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
 async function load(nextScope=scope){
  request.current?.abort();const controller=new AbortController();request.current=controller;const id=++generation.current;
  setScope(nextScope);setBusy(true);setError('');setData(null);const timer=setTimeout(()=>controller.abort(),15000);
  try{
   const read=async(path:string)=>{const response=await fetch(`${baseUrl.replace(/\/+$/,'')}${path}`,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error(`读取失败（HTTP ${response.status}）`);return response.json();};
   const [usage,obs]=await Promise.all([read(`/api/life/model-usage?scope=${nextScope}`),read('/api/runtime/observability')]);
   if(usage.available!==false&&(usage.schema!=='deskbot.model-usage.v2'||!usage.totals))throw Error('调用记录格式不完整。');
   if(id===generation.current){setData(usage);setObservation(obs);}
  }catch(e){if(id===generation.current)setError(e instanceof Error?e.message:'暂时无法读取。');}
  finally{clearTimeout(timer);if(id===generation.current)setBusy(false);}
 }
 return <section className="runtime-diagnostics" aria-label="调用与存档观测"><h3>调用与存档观测</h3>
  <p>按需读取服务已记录的用量与延迟，读取本身不调用模型。</p>
  <div className="runtime-diagnostics__filters">{[['live','正式生活'],['lab','隔离实验'],['all','全部已记录']].map(([key,label])=><button key={key} type="button" aria-pressed={scope===key&&data!==null} disabled={busy} onClick={()=>void load(key)}>{label}</button>)}</div>
  {busy&&<p role="status">正在读取…</p>}{error&&<p role="alert">{error}</p>}
  {data&&<UsageSummary report={data}/>}
  {observation?.profile&&<p>此服务：{observation.profile.scope==='live'?'正式生活':'隔离实验'} · {observation.profile.clock_scope==='real_time'?'现实时间':'独立时钟'}。</p>}
  {observation?.storage&&<p>存档文件 {(observation.storage.database_bytes/1048576).toFixed(1)} MB · WAL 日志 {(observation.storage.wal_bytes/1048576).toFixed(1)} MB。<small>{observation.storage.note}</small></p>}
 </section>;
}
