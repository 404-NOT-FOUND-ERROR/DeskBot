import {useEffect,useState} from 'react';
import './life-observation.css';
export interface ObservationCounts {completed:number;failed:number;cancelled:number;need:number;self_continuation:number;invited:number;unknown:number;practice:number;observation:number;travel:number;rest:number;input_linked:number;followups:number}
export interface ObservationReport {
 schema:'deskbot.life-observation.v1';started_at:string|null;last_observed_at:string|null;sampled_status:string;protagonist_id:string;
 days:{date:string;online_seconds:number;unobserved_seconds:number;samples:number;reconciled_roots?:number;inputs:Record<string,number>;choices:Record<string,number>;actors:Record<string,ObservationCounts>;
 results:{root_id:string;at:string;actor_ids:string[];title:string;outcome:string;topic:string|null;practice:boolean;motivation:string;sources:string[];prior_root:string|null}[];
 changes:{at:string;actor_id:string;primary_from:string|null;primary_to:string|null;topics:{label:string;status:string;reason:string}[]}[]}[];
 current:{actor_id:string;name:string;energy:number;appetite:number;paused:boolean;goal:string|null;title:string|null;primary_topic:string|null;pending_followups:number;topics:{topic:string;label:string;status:string;formed_at:string|null;reason:string}[]}[];
 historical_24h:{scope:string;actors:Record<string,ObservationCounts>};
}
const zero:ObservationCounts={completed:0,failed:0,cancelled:0,need:0,self_continuation:0,invited:0,unknown:0,practice:0,observation:0,travel:0,rest:0,input_linked:0,followups:0};
const names:Record<string,string>={dialogue:'你的对话与建议',weather:'上海天气',external:'外界消息',body:'身体感受',agent:'其他 agent',user:'你的建议',rules:'规则安排',llm:'模型选择',model:'模型选择'};
const local=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
export const duration=(seconds:number)=>seconds<60?`${Math.floor(seconds)} 秒`:`${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分钟`;
export function LifeObservation({baseUrl,initial}:{baseUrl:string;initial?:ObservationReport}) {
 const [report,setReport]=useState(initial),[error,setError]=useState(''),[selected,setSelected]=useState<string|null>(null),[all,setAll]=useState(false);
 useEffect(()=>{let active=true;const controller=new AbortController();
  const read=async()=>{try {const r=await fetch(`${baseUrl}/api/life/observation`,{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error(`HTTP ${r.status}`);const data=await r.json() as ObservationReport;if(data.schema!=='deskbot.life-observation.v1')throw Error('观察报告格式不匹配');if(active){setReport(data);setError('');}}catch(e){if(active)setError(e instanceof Error?e.message:'读取失败');}};
  void read();const timer=setInterval(()=>void read(),30000);return()=>{active=false;controller.abort();clearInterval(timer);};
 },[baseUrl]);
 const day=report?.days.find(d=>d.date===selected)??report?.days.at(-1),own=report?.protagonist_id;
 const tally={...zero};for(const [id,c] of Object.entries(day?.actors??{}))if(all||id===own)for(const k of Object.keys(tally) as (keyof ObservationCounts)[])tally[k]+=c[k]??0;
 const recent=day?.results.filter(r=>all||r.actor_ids.includes(own!)).slice(-8).reverse()??[];
 const current=report?.current.find(a=>a.actor_id===own),history=report?.historical_24h.actors[own!];
 return <section className="life-observation life-block" aria-label="真实运行观察">
  <p><a href="/cognition-review.html" target="_blank" rel="noreferrer">第一阶段：认知接口与隔离实验 ↗</a> · 工程 mock；正式生活仍在本页观察。</p>
  <p><a href="/cognitive-life-review.html" target="_blank" rel="noreferrer">第二阶段：认知、实际行动与跨日后续 ↗</a> · 真实模型的隔离实验和正式接线状态。</p>
  <div className="life-block__head"><span className="deskbot-mode__eyebrow">回来看日子怎么接着过</span><h2>真实运行观察</h2><p>验收中。这里记录正式世界；独立回放不能替代这些记录。</p></div>
  {error?<p role="status">报告暂时读取失败：{error}。保留上次记录，不能据此判断现在在线。</p>:null}
  {report?<>
   <p className="life-observation__status">{error?'尚未重连':report.sampled_status==='collecting'?'服务正在采样':'未收到近期采样'} · {report.last_observed_at?`最近 ${local(report.last_observed_at)}`:'尚未开始'}</p>
   <p>从{report.started_at?local(report.started_at):'本次安装'}开始留存，按上海日期自动归档。关掉网页仍可记录；电脑关机或服务停止时，空白时间会单列。</p>
   <div className="life-observation__dates" aria-label="观察日期">{report.days.map(d=><button key={d.date} aria-pressed={d===day} onClick={()=>setSelected(d.date)}>{d.date.slice(5)}</button>)}</div>
   <div className="life-observation__coverage"><strong>{day?.date??'今天'} · 确认在线 {duration(day?.online_seconds??0)}</strong><span>未观测间隔 {duration(day?.unobserved_seconds??0)} · 启动或间隙补结算 {day?.reconciled_roots??0} 个结果</span></div>
   <div className="life-observation__scope"><button aria-pressed={!all} onClick={()=>setAll(false)}>喵呜</button><button aria-pressed={all} onClick={()=>setAll(true)}>全镇</button></div>
   <dl className="life-observation__metrics"><div><dt>实际完成</dt><dd>{tally.completed}</dd></div><div><dt>需要驱动结果</dt><dd>{tally.need}</dd></div><div><dt>主动继续结果</dt><dd>{tally.self_continuation}</dd></div><div><dt>受邀结果</dt><dd>{tally.invited}</dd></div><div><dt>配方实践完成</dt><dd>{tally.practice}</dd></div><div><dt>观察 / 出行完成</dt><dd>{tally.observation} / {tally.travel}</dd></div><div><dt>输入关联完成</dt><dd>{tally.input_linked}</dd></div><div><dt>后续完成</dt><dd>{tally.followups}</dd></div></dl>
   <small>按唯一实际结果统计；动机统计含失败与取消。配方实践可能属于需要或受邀，不能直接算成爱好。补结算不计入上述在线结果。</small>
   {tally.failed||tally.cancelled||tally.unknown?<p>未完成 {tally.failed} · 取消 {tally.cancelled} · 动机未知 {tally.unknown}。未知依据保持未知。</p>:null}
   <details><summary>今天收到哪些来源，采用了哪些选择</summary><p>{Object.entries(day?.inputs??{}).map(([k,n])=>`${names[k.split(':')[0]!]??k} ${n} 条${k.endsWith('unverified')?'（未确认）':''}`).join('；')||'采样期间暂未收到新来源。'}</p><p>{Object.entries(day?.choices??{}).map(([k,n])=>`${names[k]??k} ${n} 次`).join('；')||'采样期间暂未看到新安排。'}</p><p>收到消息与实际采用分开。天气的环境影响还应结合任务与现场记录核对。</p></details>
   <div className="life-observation__basis"><strong>喵呜眼下的依据</strong><p>{current?.paused?'自主安排已暂停。':current?.title?`正在：${current.title}`:'尚无进行中的安排。'}</p><p>{current?.primary_topic?`主要投入：${current.topics.find(t=>t.topic===current.primary_topic)?.label??current.primary_topic}`:'尚未形成主要投入。'} 待接续 {current?.pending_followups??0} 件。</p><p>{current&&current.energy<.4?'精神不足，兴趣活动可能被休息延后。':''} {current&&current.appetite>.6?'进食需要较高，先处理基本需要。':''}</p></div>
   <details><summary>这一天的关注变化</summary>{day?.changes.filter(c=>all||c.actor_id===own).length?day.changes.filter(c=>all||c.actor_id===own).map((c,i)=><p key={`${c.at}:${i}`}>{local(c.at)} · {report.current.find(a=>a.actor_id===c.actor_id)?.name??c.actor_id}<br/>{c.topics.map(t=>`${t.label}：${t.reason}`).join('；')}</p>):<p>采样期间暂未看到投入或关注状态改变。没有变化也如实保留。</p>}</details>
   {recent.length?<ol className="life-observation__results">{recent.map(r=><li key={r.root_id}><time>{local(r.at)}</time><strong>{r.title}</strong><span>{r.outcome==='completed'?'已完成':r.outcome==='failed'?'未完成':'已取消'} · {r.practice?'配方实践':'日常活动'} · {r.sources.map(s=>names[s]??s).join('、')||'没有显式外部来源关联'}</span><details><summary>核对实际依据</summary><code>{r.root_id}</code>{r.prior_root?<p>接续自 <code>{r.prior_root}</code></p>:null}</details></li>)}</ol>:<p className="life-empty">还没有采到这一天的实际结果。等待本身不算实践，安静的日子也会如实记录。</p>}
   <details><summary>存档里最近 24 小时的已有结果</summary><p>包含离线恢复与安装观察前的历史，只供定位问题。</p><p>喵呜：完成 {history?.completed??0}，需要驱动 {history?.need??0}，主动继续 {history?.self_continuation??0}，配方实践 {history?.practice??0}，输入关联 {history?.input_linked??0}，后续 {history?.followups??0}。</p></details>
   <p className="life-observation__gate">先确认基本需要能恢复，再看输入影响选择、实际实践留下兴趣与跨日后续。没有愿望或没有变形，可以是合理结果；目前没有自动判定验收通过。</p>
  </>:<p>正在读取正式世界记录…</p>}
 </section>;
}
