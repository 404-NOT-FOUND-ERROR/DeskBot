import {useState} from 'react';
import evidence from './cognitive-source-evidence.json';

const groupNames:Record<string,string>={knowledge:'知识报道',question:'问题与建议',invitation:'共同邀请',weather:'天气参照',body:'身体接触',negation:'否定',quotation:'引用',irrelevant:'无关信息',hypothesis:'假说',social:'问候'};
const effectNames:Record<string,string>={inquiry:'可探索的问题',offer:'可以回应的邀请',condition:'环境参考',attention:'留意一下',none:'没有生成行动机会'};
const actionNames:Record<string,string>={observe:'观察',share:'交谈',activity:'实际活动',rest:'休息',wait:'等待'};

export function CognitiveInputEvidence(){
 const [group,setGroup]=useState('all'),[pairIndex,setPairIndex]=useState(0);
 const pair=evidence.pairs[pairIndex],rows=evidence.label_cases.filter(r=>group==='all'||r.group===group);
 if(!pair)return <p role="status">此对照样本暂不可用。</p>;
 return <section className="cgl-input-evidence" aria-label="多源输入验收证据">
  <p className="cgl-eyebrow">3A / 多源理解与选择 / {evidence.date} 固定实验记录</p>
  <h2>一句外界消息，接下来改变了什么</h2>
  <p>这些结果来自虚构输入和真实 DeepSeek 调用。原始消息、个人理解与实际安排分开展示。</p>
  <div className="cgl-evidence-stats"><div><strong>{evidence.labels_correct} / {evidence.labels_total}</strong><span>输入作用符合预标注</span></div><div><strong>{evidence.source_cited} / {evidence.pairs.length}</strong><span>输入进入安排的原因</span></div><div><strong>{evidence.coarse_action_changed} / {evidence.pairs.length}</strong><span>行动类别发生变化</span></div></div>
  <div className="cgl-pair-head"><h3>相同前态 · 有消息与没有消息</h3><select aria-label="选择对照样本" value={pairIndex} onChange={event=>setPairIndex(Number(event.target.value))}>{evidence.pairs.map((p,i)=><option key={p.id} value={i}>{groupNames[p.group]} · 第 {p.repeat} 次</option>)}</select></div>
  <blockquote>{pair.source}</blockquote>
  <div className="cgl-pair-columns">{([{value:pair.before,title:'没有这条输入'},{value:pair.after,title:'收到这条输入'}] as const).map(({value,title})=><article key={title}><p className="cgl-eyebrow">{title}</p><h3>{actionNames[value.compiled.operation]} · {value.compiled.title}</h3><p>{value.compiled.reason}</p>{value.compiled.message&&<p className="cgl-utterance">“{value.compiled.message}”</p>}<small>{value.task?`已提交任务：${value.task.title}`:'没有提交实际任务'} · 此处尚不表示完成</small></article>)}</div>
  <p className="cgl-muted">首轮 {evidence.pair_first_pass}/{evidence.pair_total_runs} 个回合有效；其中 1 个在语义合同修正后单独重测。相同行动类别也可能在问题、对象和表达上不同。本组没有增加实践或改变身份。</p>
  <details><summary>查看全部 32 条预标注输入，以及失败记录的边界</summary>
   <nav aria-label="输入类别"><button className={group==='all'?'selected':''} onClick={()=>setGroup('all')}>全部</button>{Object.entries(groupNames).map(([key,name])=><button key={key} className={group===key?'selected':''} onClick={()=>setGroup(key)}>{name}</button>)}</nav>
   <div className="cgl-case-list">{rows.map(r=><article key={r.id}><div><small>{groupNames[r.group]}</small><strong>{effectNames[r.interpretation.effect]}</strong></div><p>{r.source}</p><p className="cgl-muted">{r.interpretation.reason}</p>{r.interpretation.question&&<p>留下的问题：{r.interpretation.question}</p>}</article>)}</div>
   <p>本轮实验与修正累计 {evidence.expense_snapshot.calls} 次请求，按峰时价保守估算 ¥{evidence.expense_snapshot.used_upper_cny.toFixed(3)}，其中 {evidence.expense_snapshot.unknown_usage_calls} 次用量未知，仍保留预留估算。</p>
   <ul>{evidence.limits.map(text=><li key={text}>{text}</li>)}</ul>
  </details>
 </section>
}
