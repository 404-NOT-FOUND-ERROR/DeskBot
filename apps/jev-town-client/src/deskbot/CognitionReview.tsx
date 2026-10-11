import {useCallback,useEffect,useRef,useState} from 'react';
import './cognition-review.css';

interface Event {event_id:string;text:string;visibility:string}
interface Actor {actor_id:string;name:string;role:string;version:number;cognition_sequence:number;practice:number}
interface Request {
 request_id:string;actor_id:string;status:string;error?:string;error_code?:string;
 context:{visible_events:Event[];known_objects:{object_id:string;name:string;version:number}[];context_digest:string;memories:{memory_id:string}[]};
 proposal?:{interpretation:string;goal:string;intent:{object_id:string;primitive:string};source_event_ids:string[]};
 result?:{root_id:string;execution_mode:string;practice_delta:number;observed_state:{moisture:number;light:number}};
 memory?:{memory_group_id:string;facts:string[];interpretation:string};index_error?:string;
}
interface Call {call_id:string;purpose:string;status:string;latency_ms?:number;input_tokens:number;output_tokens:number;actual_cost:number;usage_source:string}
export interface CognitionReport {
 schema:string;scope:string;upstream:{commit:string;license:string;files:number;invoked:string[]};runtime:{transport:string;active_sessions:number};
 actors:Actor[];requests:Request[];memories:unknown[];index_count:number;runs:{run_id:string;status:string}[];
 broker:{calls:Call[];max_calls_per_utc_day:number;paid_provider_enabled:boolean;queue_length:number;active:number};
}
const statusNames:Record<string,string>={adopted_isolated:'已采用 · 隔离存档',rejected:'已拒绝',interrupted:'已中断 · 不自动重发',thinking:'正在理解',proposal:'待核验',result:'待保存',completed:'完成',partially_rejected:'含拒绝结果',reserved:'已预留',calling:'调用中',failed:'失败'};
const labels:Record<string,string>={cognition:'理解与提案',embedding:'示例索引',user_dialogue:'用户交流',reflection:'反思'};
const stamp=(value?:number)=>value===undefined?'—':`${value} ms`;

export function CognitionReview({baseUrl='http://127.0.0.1:4311',initialReport}: {baseUrl?:string;initialReport?:CognitionReport}) {
 const [report,setReport]=useState<CognitionReport|undefined>(initialReport),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const mounted=useRef(true),pendingRun=useRef<string|undefined>(undefined);
 const read=useCallback(async()=>{
  const response=await fetch(`${baseUrl}/api/life/cognition/status`);
  const value=await response.json();if(!response.ok)throw new Error(value.error?.message??'读取失败');
  if(mounted.current)setReport(value);
 },[baseUrl]);
 useEffect(()=>{mounted.current=true;if(!initialReport)void read().catch(e=>setError(e.message));const timer=setInterval(()=>void read().catch(e=>{if(mounted.current)setError(e.message)}),5000);return()=>{mounted.current=false;clearInterval(timer)}},[read,initialReport]);
 async function act(kind:'run'|'rebuild-index') {
  setBusy(true);setError('');setNotice('');
  if(kind==='run')pendingRun.current??=crypto.randomUUID();
  try {
   const response=await fetch(`${baseUrl}/api/life/cognition/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(kind==='run'?{run_id:pendingRun.current}:{})});
   const value=await response.json();if(!response.ok)throw new Error(value.error?.message??'接口失败');
   if(kind==='run'){pendingRun.current=undefined;setNotice(value.status==='completed'?'三个角色的隔离交接已完成。':'已返回；请核对各角色的拒绝或中断记录。')}
   else setNotice(`重建 ${value.rebuilt} 条示例索引，保留 ${value.raw_memory_count} 条原文。`);
   await read();
  }catch(e){setError(e instanceof Error?e.message:'接口失败')}
  finally{if(mounted.current)setBusy(false)}
 }
 const latest=report?.runs.at(-1),requests=report?.requests.filter(r=>latest?.run_id&&r.request_id.startsWith(`${latest.run_id}:`))??[];
 const chatUrl=`/?mode=deskbot&deskbotUrl=${encodeURIComponent(baseUrl)}&view=journal`;
 return <main className="cognition-review">
  <header><div><p className="cognition-kicker">聚形域 / 开发观察 / 第一阶段</p><h1>同一件事，三份有边界的理解</h1><p>Node 保存世界与采用结果，Python 接收角色可见信息、回传提案。</p><a href="/cognitive-life-review.html">进入第二阶段：认知生活 →</a></div><a className="cognition-chat" href={chatUrl}>回到正式世界 · 和喵呜说话 ↗</a></header>
  <section className="cognition-boundary" aria-label="实验边界"><strong>隔离 mock · 工程互通验证</strong><p>人物和苗圃对象 ID 对应现有内容，事件、解释与观察结果都是程序设定的样例。这里验证权限、提交和恢复；尚未验证模型叙事质量、真实生活或跨日成长。正式人生存档独立运行。</p></section>
  <section className="cognition-toolbar"><button onClick={()=>void act('run')} disabled={busy}>{busy?'正在交接…':'运行三角色样例'}</button><button className="secondary" onClick={()=>void act('rebuild-index')} disabled={busy||!report?.memories.length}>重建示例索引</button><span>模拟额度 {report?.broker.calls.length??0} / {report?.broker.max_calls_per_utc_day??60} 次（UTC 日） · 付费调用禁用</span></section>
  {error?<p className="cognition-error" role="alert">{error} {pendingRun.current?'重试将使用同一请求编号，避免重复提交。':''}</p>:null}
  {notice?<p className="cognition-notice" role="status">{notice}</p>:null}
  <section className="cognition-stats" aria-label="运行基线"><div><strong>{report?.runtime.transport??'待读取'}</strong><span>Node ↔ Python 本地进程</span></div><div><strong>{report?.memories.length??0} / {report?.index_count??0}</strong><span>原文 / 可重建示例索引</span></div><div><strong>¥0 · mock</strong><span>token 0；字符数与计费分开</span></div><div><strong>{latest?statusNames[latest.status]??latest.status:'等待首轮'}</strong><span>完整认知循环留待第二阶段</span></div></section>
  <div className="cognition-actors">{report?.actors.map(actor=>{
   const item=requests.find(r=>r.actor_id===actor.actor_id);
   return <article key={actor.actor_id} className="cognition-actor"><div className="cognition-actor-head"><div><h2>{actor.name}</h2><p>{actor.role}</p></div><span>{item?statusNames[item.status]??item.status:'尚未运行'}</span></div>
    <ol className="cognition-flow">
     <li><h3>1 · 他能知道什么</h3>{item?item.context.visible_events.map(event=><p key={event.event_id}><span className={event.visibility==='public'?'tag':'tag private'}>{event.visibility==='public'?'共同可见':'仅此人可见'}</span>{event.text}</p>):<p>运行后查看公开事件和个人信息的差异。</p>}{item?<small>仅取自己的 {item.context.memories.length} 条已有经历。对象：{item.context.known_objects.map(o=>o.name).join('、')}。</small>:null}</li>
     <li><h3>2 · 如何理解，想做什么</h3><p>{item?.proposal?.interpretation??'等待提案'}</p><p className="cognition-goal">{item?.proposal?.goal}</p>{item?.proposal?<small>意图：{item.proposal.intent.primitive} → {item.proposal.intent.object_id}</small>:null}</li>
     <li><h3>3 · 核验后发生了什么</h3>{item?.result?<p>样例观察：水分 {item.result.observed_state.moisture}，蓄光 {item.result.observed_state.light}。实践次数 +{item.result.practice_delta}。</p>:<p>未提交观察结果。</p>}{item?.error?<p className="cognition-error">{item.error_code}：{item.error}</p>:null}<small>库存、正式技能与角色采用均不由提案改写。</small></li>
     <li><h3>4 · 保存为谁的经历</h3><p>{item?.memory?.facts.join(' ')??'尚无记忆提交。'}</p>{item?.memory?<small>共同根保持一致，个人分组各自独立。个人解释不会增加实践。</small>:null}{item?.index_error?<p>索引未完成：{item.index_error}；原文仍保留。</p>:null}</li>
    </ol><details><summary>查看交接依据</summary><p>认知版本 {actor.version} · 序列 {actor.cognition_sequence} · 实践 {actor.practice}</p>{item?<><code>{item.request_id}</code><p>共同根：{item.result?.root_id??'尚无'}</p><p>个人分组：{item.memory?.memory_group_id??'尚无'}</p><p>上下文校验：{item.context.context_digest}</p></>:null}</details>
   </article>;
  })}</div>
  <section className="cognition-ledger"><h2>调用与预留</h2><p>每次调用先占用额度，再进入优先队列。中断后保留记录，不自动重发。嵌入仅为哈希示例，不提供语义检索。</p><div className="cognition-table"><table><thead><tr><th>用途</th><th>状态</th><th>延迟</th><th>输入 / 输出 token</th><th>费用</th></tr></thead><tbody>{report?.broker.calls.slice(-12).map(call=><tr key={call.call_id}><td title={call.call_id}>{labels[call.purpose]??call.purpose}</td><td>{statusNames[call.status]??call.status}</td><td>{stamp(call.latency_ms)}</td><td>{call.input_tokens} / {call.output_tokens} · mock</td><td>¥{call.actual_cost}</td></tr>)}</tbody></table></div></section>
  <footer><p>Asamana {report?.upstream.commit.slice(0,12)??'待读取'} · {report?.upstream.license??'Apache-2.0'} · {report?.upstream.files??'—'} 个固定版本源文件。</p><details><summary>本阶段实际接入的上游组件</summary><ul>{report?.upstream.invoked.map(module=><li key={module}><code>{module}</code></li>)}</ul><p>决策、反思、真实 embedding、付费预算和正式用户对话共用队列尚待后续接入。</p></details></footer>
 </main>;
}
