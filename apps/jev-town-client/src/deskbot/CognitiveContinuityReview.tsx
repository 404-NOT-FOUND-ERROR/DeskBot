import {useState} from 'react';
import evidence from './continuity-evidence.json';
const labels:Record<string,string>={waiting:'条件尚未满足',ready:'条件已可复查',review_required:'等待期限已到',unbound:'明确暂缓，保留问题'};
const time=(at:string|null)=>at?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(at)):'—';
export function CognitiveContinuityReview({initialTrace='timed-reading'}:{initialTrace?:string}={}){
 const [selected,setSelected]=useState(initialTrace),trace=evidence.traces.find(t=>t.id===selected)??evidence.traces[0]!;
 return <section className="cgl-inquiry"><p className="cgl-eyebrow">6A / 时间、等待与旧事项</p>
  <h2>昨天留下的事，今天怎样接着做</h2><p>复查的时候知道条件有没有到，也知道还在等什么。可以继续、换办法、明确暂缓或放下；原问题和经历有出处。</p>
  <p className="cgl-boundary">{evidence.note}</p>
  <div className="cgl-inquiry-steps" role="group" aria-label="后续规则回放">{evidence.traces.map(t=><button key={t.id} onClick={()=>setSelected(t.id)} aria-pressed={selected===t.id} className={selected===t.id?'selected':''}>{t.title}</button>)}</div>
  <h3>{trace.title}</h3><div className="cgl-pair-columns"><article><strong>原来的问题</strong><p>{trace.previous_behavior}</p></article><article><strong>本次修正</strong><p>{trace.new_behavior}</p></article></div>
  <div className="cgl-interest-timeline">{trace.rows.map((row,i)=><article key={i}><small>{time(row.at)} · 测试日期</small><h3>{row.label}</h3><strong>{row.condition?labels[row.condition]??row.condition:'已有实际结果'}</strong><p>{row.question}</p><dl><div><dt>复查时间</dt><dd>{time(row.next_review)}</dd></div><div><dt>正式测记</dt><dd>{row.notes}</dd></div><div><dt>实际送达</dt><dd>{row.outbox_count}</dd></div></dl><small>UTC：{row.time.utc} · {row.time.zone}</small></article>)}</div>
  <h2>五次真实模型复查</h2><p>{evidence.model.note}</p><p>实际任务 {evidence.model.successful_actual_tasks}/{evidence.model.cases.length} · 提供者调用 {evidence.model.provider_calls} 次 · 保守费用约 ¥{evidence.model.upper_cny.toFixed(2)}。全例含安排、实际结算与反馈的中位耗时约 {(evidence.model.complete_case_median_ms/1000).toFixed(1)} 秒；不是单次聊天延迟。</p>
  <div className="cgl-pair-columns">{evidence.model.cases.map(c=><article key={c.id}><h3>{c.title}</h3><p><strong>原后续：</strong>{c.prior}</p><p><strong>历史样本选择：</strong>{c.before_action}</p><p><strong>本轮实际安排：</strong>{c.after_action}</p><p>{c.reason}</p><p>{c.actual_fact}</p><strong>{c.verdict}</strong><p className="cgl-boundary">{c.limit}</p><details><summary>本轮模型留下的后续</summary><p>{c.followup}</p><p>下次复查：{time(c.next_review_at)}</p><small>复查是再次决定，不代表此刻已安排或完成未来任务。</small></details></article>)}</div>
  <h2>聚形域向林深展开</h2><p className="cgl-boundary">{evidence.world.status}。这里是概念评审，尚不能进入新区域。</p><p>{evidence.world.candidate}：{evidence.world.idea}</p>
  <div className="cgl-pair-columns">{evidence.world.areas.map(a=><article key={a.name}><h3>{a.name}</h3><p>{a.purpose}</p></article>)}</div>
  <p>6B 将制作实际地形、道路、光叶与造物状态、有限方法、居民往来和现场痕迹，让它能前往、生活、留下问题并返回。</p>
  <details><summary>验收边界与后续问题</summary><ul>{evidence.limits.map(s=><li key={s}>{s}</li>)}</ul></details>
 </section>;
}
