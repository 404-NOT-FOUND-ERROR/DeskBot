import type {DeskBotLifeRhythm} from './types.ts';
import './life-rhythm.css';
const labels:Record<string,string>={invested:'持续投入',held:'先顾眼前',quiet:'暂未继续',parked:'暂时搁置',reawakened:'又有些好奇',trying:'正在尝试',attention:'留意中'};
const followups:Record<string,string>={waiting_day:'留到明天',available:'有空再去',in_progress:'正在接着做',completed:'留下了后续',failed:'这次没能继续',expired:'这次窗口已过'};
const date=(at:string)=>new Date(at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'});
const values:Record<string,string>={moisture:'湿度',growth:'生长',health:'健康',quantity:'在种数量',condition:'设施状态'};
export function LifeRhythm({rhythm,actorId}:{rhythm?:DeskBotLifeRhythm|null;actorId:string}){
 const actor=rhythm?.actors.find(a=>a.actor_id===actorId);if(!actor)return null;
 const focus=[actor.primary_topic,...actor.side_topics].filter((x):x is string=>Boolean(x));
 const other=Object.values(actor.topics).filter(t=>!focus.includes(t.topic));
 const opportunities=(rhythm?.opportunities??[]).filter(o=>o.actor_id===actorId);
 const pending=opportunities.filter(o=>['waiting_day','available','in_progress'].includes(o.status)).slice(-3);
 const settled=opportunities.filter(o=>['completed','failed','expired'].includes(o.status)).slice(-3).reverse();
 return <section className="life-rhythm" aria-label="持续投入与生活后续">
  <div className="life-row"><h3>还惦记着的事</h3><small>{actor.primary_topic?'一份主要投入':'慢慢找自己的兴趣'}</small></div>
  {focus.length?<div className="life-rhythm__topics">{focus.map(id=>{const t=actor.topics[id];if(!t)return null;return <article key={id} className={id===actor.primary_topic?'is-primary':''}>
   <div className="life-row"><strong>{t.label}</strong><span className="life-chip">{labels[t.status]??t.status}</span></div>
   <p>{t.reason}</p>{t.last_active_at?<small>上次自己继续 · {date(t.last_active_at)}</small>:<small>先留意，等实际尝试</small>}
  </article>;})}</div>:<p className="life-empty">暂时没有正在投入的方向。原来的经历仍记着，今天也可以安静地过。</p>}
  {pending.length?<div className="life-rhythm__followups"><h4>昨天的事，今天有后续</h4>{pending.map(o=><article key={o.id}>
   <div className="life-row"><strong>{o.title}</strong><small>{followups[o.status]}</small></div><p>{o.reason}</p>
   <small>{date(o.not_before)} 起可以考虑 · {o.kind==='retry'?'再试原活动':'回原现场复看'}</small>
   <details><summary>这件后续从哪里来</summary><p>来自已有实际活动的结果。安排只是意图，开始和完成会另留下记录。</p><small>原结果：{o.source_root_id}</small>{o.result_root_id?<small>后续结果：{o.result_root_id}</small>:null}</details>
  </article>)}</div>:null}
  {settled[0]?<div className="life-rhythm__followups"><h4>最近接上的一件小事</h4><article>
   <div className="life-row"><strong>{settled[0].title}</strong><small>{followups[settled[0].status]}</small></div>
   <p>{settled[0].status==='completed'?'实际任务完成了这次后续。':settled[0].reason}</p>
   {settled[0].inspection?.finished?<small>这次复看 · {settled[0].inspection.finished.name}：{Object.entries(settled[0].inspection.finished.values).map(([key,n])=>`${values[key]??key} ${key==='quantity'?Math.round(n):Math.round(n*100)+'%'}`).join(' · ')}</small>:null}
  </article></div>:null}
  {other.length||settled.length?<details className="life-rhythm__archive"><summary>暂时放着与已经接上的事</summary>
   {other.map(t=><p key={t.topic}><strong>{t.label} · {labels[t.status]??t.status}</strong><br/>{t.reason}</p>)}
   {settled.map(o=><p key={o.id}><strong>{followups[o.status]} · {o.title}</strong><br/>{o.status==='completed'?'实际任务完成了这次后续。':o.reason}
    {o.inspection?.finished?<small>这次复看 · {o.inspection.finished.name}：{Object.entries(o.inspection.finished.values).map(([key,n])=>`${values[key]??key} ${key==='quantity'?Math.round(n):Math.round(n*100)+'%'}`).join(' · ')}</small>:null}
    <small>原结果：{o.source_root_id}{o.result_root_id?<><br/>后续结果：{o.result_root_id}</>:null}</small></p>)}
  </details>:null}
 </section>;
}
