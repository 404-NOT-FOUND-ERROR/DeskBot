import {useState} from 'react';
import evidence from './cognitive-social-evidence.json';
const names:Record<string,string>={'shaping-001':'喵呜','wetland-grower-001':'苔团'};
const states:Record<string,string>={proposed:'仍在商量',accepted:'双方接受',working:'共同进行中',completed:'实际履约',declined:'未成立',withdrawn:'主动退出',failed:'未能履约'};
const variants=[['ordinary','普通的一天'],['tired','有些疲倦'],['prior-misgiving','记得上次聊得太久']] as const;
export function CognitiveSocialReview(){
 const [variant,setVariant]=useState('ordinary');
 return <section className="cgl-inquiry">
  <p className="cgl-eyebrow">4A / 各自的安排，共同的生活</p>
  <h2>“一起聊聊？”之后，还要真的见上一面</h2>
  <p>邀请送到苔团手里。它可以先处理自己的事，也可以商量时间；喵呜再作自己的回应。双方确认后，共同活动才进入真实的任务队列。</p>
  <p className="cgl-boundary">{evidence.limitations}</p>
  <div className="cgl-inquiry-steps" role="group" aria-label="社交实验前史">{variants.map(([key,title])=><button key={key} aria-pressed={variant===key} className={variant===key?'selected':''} onClick={()=>setVariant(key)}>{title}</button>)}</div>
  <div className="cgl-pair-columns">{evidence.cases.filter(c=>c.variant===variant).map(c=><article key={c.id}>
   <p className="cgl-eyebrow">独立重复 {c.repeat} · 测试时钟</p><h3>{states[c.status]??c.status}</h3>
   {c.turns.map((turn,i)=><section key={i}><strong>{names[turn.actor]} · {turn.title}</strong><p>{turn.message??turn.reason}</p><small>留下的后续：{turn.followup?.question??'—'}</small></section>)}
   <p><strong>最后实际发生：</strong>{c.last_note??'仍待后续回应'}</p>
   {!!c.actual_shared_tasks.length&&<details><summary>共同活动的执行记录</summary><ul>{c.actual_shared_tasks.map((t,i)=><li key={i}>{names[t.actor]} · {t.title} · {t.status==='completed'?'完成':t.status}</li>)}</ul></details>}
   <details><summary>实验出处</summary><code>{c.source}</code></details>
  </article>)}</div>
  <h2>同一次见面，留下各自的印象</h2><p>以下来自一例已经完成的共同会面。每人只读取自己的来往和共同结果，用独立调用整理私人看法。</p>
  <div className="cgl-pair-columns">{evidence.relation_views.map(r=><article key={r.actor_id}><h3>{names[r.actor_id]}的私人印象</h3>{r.views.map(v=><div key={v.actor_id}><strong>关于{names[v.actor_id]} · {v.labels.join('、')}</strong><p>{v.summary}</p><small>{v.source_ids.length} 项自己的交流或共同结果作为依据。</small></div>)}</article>)}</div>
  <p className="cgl-boundary">{evidence.fact_boundary} 私人印象不改写对方想法，不自动成立友谊、师徒或其他身份。</p>
  <details><summary>合同验证、失败和费用</summary><p>确定性测试覆盖拒绝、延期再确认、退出、过期、回复关联、有限物资赠予、跨地点制作和交付，以及共同结果去重。</p><p>早期真实实验遇到问候名称、原文拼接、时间冲突与来源编号问题；失败保留并单独修复。当前记录含 {evidence.paid.attempts} 次 API 尝试，按峰时价格估算 ¥{evidence.paid.upper_cny.toFixed(3)}，并非账户账单。</p></details>
 </section>;
}
