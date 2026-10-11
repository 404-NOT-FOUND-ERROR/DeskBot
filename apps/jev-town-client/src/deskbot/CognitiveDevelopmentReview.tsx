import {useState} from 'react';
import evidence from './development-cognitive-evidence.json';
import choices from './development-choice-evidence.json';
const names:Record<string,string>={invested:'持续投入',trying:'尝试中',attention:'留意',held:'暂缓，保留牵挂',quiet:'最近安静下来',parked:'暂时放下',reawakened:'重新想看看'};
export function CognitiveDevelopmentReview(){
 const [selected,setSelected]=useState('explore');const trajectory=evidence.trajectories.find(t=>t.id===selected)??evidence.trajectories[0]!;
 return <section className="cgl-inquiry"><p className="cgl-eyebrow">5 / 兴趣、有效机会与角色愿望</p>
  <h2>做过的事，慢慢成为自己的方向</h2><p>同一份经历连接个人记忆、兴趣、实践、试做与采用。喜欢可以发展、暂缓或改变；先有自己的选择，再考虑外观。</p>
  <p className="cgl-boundary">{evidence.note}</p>
  <div className="cgl-inquiry-steps" role="group" aria-label="兴趣轨迹">{evidence.trajectories.map(t=><button key={t.id} onClick={()=>setSelected(t.id)} aria-pressed={t.id===selected} className={t.id===selected?'selected':''}>{t.title}</button>)}</div>
  <h3>{trajectory.title}</h3><p>{trajectory.explanation}</p>
  <div className="cgl-interest-timeline">{trajectory.snapshots.map((s,i)=><article key={i}><small>{new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'short',day:'numeric'}).format(new Date(s.at))} · 测试日期</small><h3>{s.label}</h3><strong>{names[s.status]??s.status}</strong><p>{s.reason}</p><dl><div><dt>实际实践</dt><dd>{s.practice}</dd></div><div><dt>自主返回</dt><dd>{s.active}</dd></div><div><dt>受邀完成</dt><dd>{s.invited}</dd></div><div><dt>有效机会日</dt><dd>{s.opportunity_days}</dd></div></dl></article>)}</div>
  <h2>从愿望到试做，每一步都有出处</h2><ol className="cgl-role-path">{evidence.lifecycle.map(s=><li key={s.title}><strong>{s.title}</strong><p>{s.detail}</p></li>)}</ol>
  <details><summary>两次实际试做的共同结果</summary>{evidence.trial.roots.map(root=><p key={root}><code>{root}</code></p>)}<p>规则回放中的采用和撤回均保留这些结果。</p></details>
  <h2>模型留下的后续，后来怎样了</h2><p>{choices.note}</p>
  <div className="cgl-pair-columns">{choices.cases.map(c=><article key={c.id}><h3>{c.title}</h3><p><strong>原来想继续：</strong>{c.question}</p><p><strong>后来实际安排：</strong>{c.action}</p><p>{c.reason}</p><small>{c.verdict}</small></article>)}</div>
  <details><summary>验收口径与仍需观察的部分</summary><ul>{[...evidence.limits,...choices.limits].map(n=><li key={n}>{n}</li>)}</ul></details>
 </section>;
}
