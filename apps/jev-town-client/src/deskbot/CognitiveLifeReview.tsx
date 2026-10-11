import {useCallback,useEffect,useState} from 'react';
import '../styles.css';
import './cognitive-life-review.css';
import {FantasyInquiryReview} from './FantasyInquiryReview';
import {CognitiveInputEvidence} from './CognitiveInputEvidence';
import {CognitiveSocialReview} from './CognitiveSocialReview';
import {CognitiveDevelopmentReview} from './CognitiveDevelopmentReview';
import {ResonantLifeReview} from './ResonantLifeReview';

type Scope='live'|'experiment';
interface Goal {id:string;text:string;status:string}
interface ObjectState {id:string;name:string;state:{moisture?:number;health?:number;growth?:number;stock?:Record<string,number>}}
interface Result {fact:string;success:boolean;not_executed:boolean;occurred_at:string;root_outcome_id:string;before:ObjectState[];after:ObjectState[]}
interface Followup {status:string;question:string;reason:string;next_review_at:string}
interface Memory {id:string;root_outcome_id:string;epistemic?:string;source_record_id?:string;payload:{stream:string;kind:string;raw_content:string;stored_content:string}}
interface Life {enabled:boolean;reason:string;plan_count:number;job?:{status:string;error?:string};pending?:{task_id:string};last_result?:Result;followup?:Followup;memories:Memory[];
 perception_receipts?:{source_id:string;at:string;epistemic:string}[];relations?:{to_id:string;to_name:string;interaction_count:number;history_summary:string}[];
 retry?:{phase:string;retryable:boolean;at:string};
 interpretations?:{source_id:string;topic:string;question:string;effect:string;reason:string;source_content:string}[];
 state:{emotion?:{primary:string;intensity:number};short_term_goal_entities?:Goal[]};history:{phase:string;at:string;result?:Result;followup?:Followup;compiled?:{title:string;reason:string}}[]}
interface Actor {actor_id:string;name:string;location_id:string;location_name?:string;life:Life|null}
interface Task {task_id:string;actor_id:string;title:string;status:string;due_at:string;origin:string}
interface Call {call_id:string;scene:string;status:string;held_cny:number;latency_ms:number;usage?:{prompt_tokens:number;completion_tokens:number;prompt_cache_hit_tokens:number};uncertain:boolean}
interface Report {clock_scope:string;at:string;actors:Actor[];tasks:Task[];max_plans_per_actor:number;
 budget:{used_upper_cny:number;remaining_cny:number;approval:{limit_cny:number;max_calls:number};cost_note:string;calls:Call[]}}
interface Runtime {live:Report;experiment:Report}
const names:Record<string,string>={continue:'继续',postpone:'暂缓',drop:'放下',none:'没有新后续',calling:'思考中',completed:'已完成',failed:'受阻',running:'正在进行',cancelled:'已取消',active:'进行中',interrupted:'已中断',neutral:'平静',anticipation:'期待',joy:'喜悦',frustration:'烦躁',trust:'信任'};
const label=(s:string)=>names[s]??s;
const time=(s?:string)=>s?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(s)):'—';

export function CognitiveLifeReview({baseUrl='http://127.0.0.1:4311'}:{baseUrl?:string}){
 const [data,setData]=useState<Runtime>(),[scope,setScope]=useState<Scope>('experiment'),[busy,setBusy]=useState(''),[error,setError]=useState(''),[loadError,setLoadError]=useState('');
 const read=useCallback(async()=>{const response=await fetch(`${baseUrl}/api/life/cognitive-life/status`);const value=await response.json();if(!response.ok)throw new Error(value.error?.message??'读取失败');setData(value);setLoadError('');},[baseUrl]);
 useEffect(()=>{void read().catch(e=>setLoadError(e.message));const timer=setInterval(()=>void read().catch(e=>setLoadError(e.message)),4000);return()=>clearInterval(timer)},[read]);
 async function act(path:string,body:Record<string,string>){
  setBusy(body.actor_id??body.operation??'operation');setError('');
  try{const response=await fetch(`${baseUrl}/api/life/cognitive-life/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(value.error?.message??'操作失败');await read();}catch(e){setError(e instanceof Error?e.message:'操作失败')}finally{setBusy('')}
 }
 const report=data?.[scope],calls=report?.budget.calls??[],tasks=report?.tasks??[];
 return <main className="cgl-page">
  <header><div><p className="cgl-eyebrow">聚形域 / Asamana 认知迁移 / 多源理解与奇幻研究</p><h1>想做的事，怎样成为生活</h1><p>听见与看见 → 自己的理解 → 实际行动 → 经历与后续</p></div><a href={`/?mode=deskbot&deskbotUrl=${encodeURIComponent(baseUrl)}&view=journal`}>回到世界 · 和喵呜说话 ↗</a></header>
  <nav><a href="?sample=development">兴趣与角色愿望</a><a href="?sample=resonance">水岸回声与夜灯</a><a href="?sample=social">各自的安排与共同生活</a><a href="?sample=inquiry">凝光苔试验与现场</a><a href="?sample=inputs">多源输入对照</a></nav>
  {new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('sample')==='development'?<CognitiveDevelopmentReview/>:new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('sample')==='resonance'?<ResonantLifeReview/>:new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('sample')==='social'?<CognitiveSocialReview/>:new URLSearchParams(typeof window==='undefined'?'':window.location.search).get('sample')==='inquiry'?<FantasyInquiryReview/>:<CognitiveInputEvidence/>}
  <nav aria-label="观察范围"><button className={scope==='experiment'?'selected':''} onClick={()=>setScope('experiment')}>第二阶段留存实验</button><button className={scope==='live'?'selected':''} onClick={()=>setScope('live')}>正式世界 · 现实时间</button><a href="/cognition-review.html">第一阶段接口参照</a></nav>
  <section className="cgl-status"><div><span>{scope==='experiment'?'保留第二阶段原始记录及其叙述问题；测试时间不能证明真实跨日生活。':'与正式任务、存档和对话共享状态；时间 1:1，不提供加速。'}</span><strong>上海时间 {time(report?.at)}</strong></div><div><span>第二阶段原额度 ¥{report?.budget.approval.limit_cny??2} · {calls.length} / {report?.budget.approval.max_calls??120} 条调用记录</span><strong>保守费用 ¥{(report?.budget.used_upper_cny??0).toFixed(3)}</strong></div></section>
  <p className="cgl-boundary">认知使用 DeepSeek，观察和照料按实际世界规则执行。心情、解释与反思不会增加技能、实践次数或换形资格。每人首轮最多 {report?.max_plans_per_actor??4} 次安排，达到费用或回合限制后停止。</p>
  {(error||loadError)&&<p role="alert" className="cgl-error">{error||`暂时无法读取服务：${loadError}。正在重连。`}</p>}
  {busy&&<p role="status">正在处理认知阶段，已确定的世界任务继续运行…</p>}
  <div className="cgl-actors">{report?.actors.map(actor=>{
   const life=actor.life,task=tasks.find(t=>t.task_id===life?.pending?.task_id),result=life?.last_result;
   return <article key={actor.actor_id} className="cgl-actor"><div className="cgl-identity"><h2>{actor.name}</h2><span>{life?.job?.status==='calling'?'思考中':task?label(task.status):life?.state.emotion?label(life.state.emotion.primary):'尚未启用'}</span></div><p className="cgl-place">{actor.location_name??actor.location_id} · 已安排 {life?.plan_count??0} 次</p>
    <section><h3>为什么想做</h3><p>{life?.reason??'启用后，读取自己的需要、经历与眼前条件形成安排。'}</p><ul>{life?.state.short_term_goal_entities?.map(g=><li key={g.id}><span>{label(g.status)}</span> {g.text}</li>)}</ul></section>
    <section><h3>正在做什么</h3><p>{task?`${task.title} · ${label(task.status)} · ${time(task.due_at)} 到期`:'当前没有认知任务在执行。'}</p></section>
    <section><h3>实际发生什么</h3>{result?<><p>{result.not_executed?'意图未执行':result.success?'任务已核验完成':'任务未完成'} · {time(result.occurred_at)}</p><details><summary>结果原文与现场记录</summary><ObjectComparison result={result}/><details><summary>任务结果原文</summary><p>{result.fact}</p><code>{result.root_outcome_id}</code></details></details></>:<p>尚无实际结果。</p>}</section>
    <section><h3>还想继续什么</h3><p>{life?.followup?`${label(life.followup.status)}：${life.followup.question}`:'尚未形成后续。'}</p>{life?.followup&&<><p className="cgl-muted">{life.followup.reason}</p><p>下次检查：{time(life.followup.next_review_at)}</p></>}</section>
    <section><h3>听到了什么，和谁有来往</h3><p>已留下 {life?.perception_receipts?.length??0} 条来源记录。</p>{life?.memories.filter(m=>m.source_record_id).slice(-2).map(m=><p key={m.id}>{m.payload.stored_content}</p>)}{life?.relations?.filter(r=>r.interaction_count>0).map(r=><p key={r.to_id}>{r.to_name} · {r.interaction_count} 次已接收交流{r.history_summary?` · ${r.history_summary}`:''}</p>)}<small>听闻保留出处；收到消息不代表答应，也不增加实践。</small></section>
    {!!life?.interpretations?.length&&<section><h3>这些消息让它想到什么</h3>{life.interpretations.slice(-3).map((item,i)=><div key={`${item.source_id}:${i}`}><p><strong>{item.topic}</strong> · {item.question||'留意后继续自己的生活'}</p><p className="cgl-muted">{item.reason}</p></div>)}<small>个人理解可以修正；来源本身不能改写身份或世界事实。</small></section>}
    {life?.job?.error&&<p role="alert" className="cgl-error">本回合中断：{life.job.error}。没有用预写安排冒充模型结果。</p>}
    {life?.retry?.retryable&&<p role="status">已保留当前事项，将于 {time(life.retry.at)} 重试。</p>}
    {life?.job?.error&&life.pending&&task?.status!=='running'&&<button disabled={Boolean(busy)} onClick={()=>void act('run',{scope,actor_id:actor.actor_id,phase:'feedback'})}>重试理解已发生的结果 · 调用 API</button>}
    <details><summary>个人记忆与过程 · {life?.memories.length??0} 条</summary>{life?.memories.map(m=><div key={m.id}><small>{m.payload.kind==='insight'?'个人洞见':m.payload.stream==='factual'?'个人事件':'个人理解'}</small><p>{m.payload.stored_content||m.payload.raw_content}</p></div>)}{life?.history.map((h,i)=><p key={i}>{time(h.at)} · {h.phase==='plan'?'安排':'反馈'} · {h.compiled?.title??h.followup?.question}</p>)}</details>
    <button disabled={Boolean(busy)||Boolean(life?.pending)||life?.job?.status==='calling'||(life?.plan_count??0)>=(report?.max_plans_per_actor??4)||(report?.budget.remaining_cny??0)<=0} onClick={()=>void act('run',{scope,actor_id:actor.actor_id,phase:'plan'})}>{life?'再安排一件事 · 调用 API':'启用此人物 · 调用 API'}</button>
    {life?.memories.some(m=>m.payload.stream==='experiential')&&<button disabled={Boolean(busy)||Boolean(life.pending)} onClick={()=>void act('run',{scope,actor_id:actor.actor_id,phase:'reflect'})}>整理个人经历 · 调用 API</button>}
   </article>
  })}</div>
  {scope==='experiment'&&<section className="cgl-clock"><h2>隔离实验操作</h2><p>只推进测试存档。真实世界的昼夜、任务和人物位置不受影响；结算和复查会调用模型，受首轮额度限制。</p><button disabled={Boolean(busy)} onClick={()=>void act('test-clock',{operation:'finish_tasks'})}>测试时钟：结算当前任务</button><button disabled={Boolean(busy)} onClick={()=>void act('test-clock',{operation:'next_review'})}>测试时钟：下个复查窗口</button><button disabled={Boolean(busy)} onClick={()=>void act('test-clock',{operation:'next_day'})}>测试时钟：下一天并重新安排</button></section>}
  <details className="cgl-ledger"><summary>调用记录、token 与延迟</summary><p>{report?.budget.cost_note} 本额度覆盖第二阶段实验；原有聊天等调用另计。本地采用词项与近期记忆检索，没有付费 embedding。</p><div className="cgl-table"><table><thead><tr><th>阶段</th><th>状态</th><th>输入 / 输出</th><th>缓存命中</th><th>延迟</th><th>保守费用</th></tr></thead><tbody>{calls.map(c=><tr key={c.call_id}><td>{c.scene}</td><td>{c.status}{c.uncertain?' · 用量未知':''}</td><td>{c.usage?`${c.usage.prompt_tokens} / ${c.usage.completion_tokens}`:'未知'}</td><td>{c.usage?.prompt_cache_hit_tokens??'—'}</td><td>{c.latency_ms?`${(c.latency_ms/1000).toFixed(1)}s`:'—'}</td><td>¥{c.held_cny.toFixed(4)}</td></tr>)}</tbody></table></div></details>
 </main>
}
function ObjectComparison({result}:{result:Result}){return <div>{result.after?.map(o=>{const before=result.before?.find(b=>b.id===o.id);return <p key={o.id}><strong>{o.name}</strong>{(['moisture','health','growth'] as const).filter(k=>typeof o.state[k]==='number').map(k=><span key={k}> · {({moisture:'水分',health:'健康',growth:'生长'} as const)[k]} {Math.round((before?.state[k]??0)*100)}% → {Math.round((o.state[k]??0)*100)}%</span>)}{Object.entries(o.state.stock??{}).filter(([k,v])=>before?.state.stock?.[k]!==v).map(([k,v])=><span key={k}> · {({water:'清水',seeds:'苔种',moss:'苔材',trays:'托盘',light_fruit:'光果'} as Record<string,string>)[k]??k} {before?.state.stock?.[k]??'未知'} → {v}</span>)}</p>})}</div>}
