import {useState} from 'react';
import {DevelopmentEvidence} from './DevelopmentEvidence.tsx';
import type {DeskBotLivedMemory,DeskBotMemoryEpisode} from './types.ts';

const topics:Record<string,string>={care:'照料',craft:'制作',repair:'修缮',cook:'做饭',explore:'观察小镇',connection:'与人相处'};
const stages:Record<string,string>={noticing:'还在留意',trying:'经历在积累',familiar:'多次实践'};
const kinds={world_fact:'实际经历',personal_interpretation:'当时的想法',hearsay:'听来的消息'};
function groups(records:DeskBotMemoryEpisode[]) {
  const found=new Map<string,DeskBotMemoryEpisode[]>();
  for(const record of records) {
    const key=record.root_outcome_id??record.id;
    const related=found.get(key);if(related)related.push(record);else found.set(key,[record]);
  }
  return [...found.values()];
}
function day(at:string) {
  return Number.isFinite(Date.parse(at))?new Date(at).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric'}):'时间未记全';
}
export function LivedMemory({memory,actorId,journal=false}:{memory?:DeskBotLivedMemory|null;actorId:string;journal?:boolean}) {
  const [kind,setKind]=useState('all');if(!memory)return null;
  const actor=memory.actors.find(a=>a.actor_id===actorId),request=memory.planner.requests.find(r=>r.actor_id===actorId);
  const records=groups((actorId===memory.owner_id?memory.own:memory.recent)
    .filter(e=>e.actor_ids.includes(actorId)&&(kind==='all'||e.kind===kind))).slice(0,journal?12:3);
  const developmentReady=memory.development?.enabled&&memory.development.schema==='deskbot.development-evidence.v1';
  return <section className="life-block life-memory" aria-label={journal?'长期生活记忆':'兴趣相关经历'}>
    <div className="life-row"><h2>{journal?'记得的那些小事':'兴趣相关经历'}</h2><small>身份一直是自己</small></div>
    {!journal?<p className="life-memory__intro">把当时的选择、实际做过的事和结果连起来看。</p>:null}
    <DevelopmentEvidence development={memory.development} actorId={actorId} journal={journal}/>
    {!journal&&!developmentReady?<>
      <div className="life-memory__interests">{Object.values(actor?.interests??{}).map(i=><article key={i.topic}>
        <div className="life-row"><strong>{topics[i.topic]??i.topic}</strong><span className={`life-chip life-memory__stage--${i.stage}`}>{stages[i.stage]??'经历在积累'}</span></div>
        <small>{i.days.length} 天的经历 · 办成 {i.successes} 次 · 遇到困难 {i.setbacks} 次</small>
        <p>这些是既有经历，愿望与能力还要靠后续实践看。</p>
      </article>)}</div>
      {!Object.keys(actor?.interests??{}).length?<p className="life-empty">还没有足够的实际经历，先把日子过起来。</p>:null}
    </>:null}
    {!journal&&request&&['waiting','calling'].includes(request.status)?<p className="life-result">正在结合经历，想一想下一件小事。</p>:null}
    {journal?<div className="life-memory__filters" role="group" aria-label="记忆来源分类">{[['all','全部'],...Object.entries(kinds)].map(([id,label])=><button key={id} aria-pressed={kind===id} onClick={()=>setKind(id!)}>{label}</button>)}</div>:null}
    <ol className="life-memory__records">{records.map(([e,...related])=>e?<li key={e.root_outcome_id??e.id}>
      <div className="life-row"><span className={`life-chip life-memory__kind--${e.kind}`}>{kinds[e.kind]}</span><time>{day(e.at)}</time></div>
      <p>{e.text}</p>
      <details><summary>为什么记得{related.length?' · 同一经历的多个视角':''}</summary>
        <small>{e.source.task_id?'来自实际任务':e.source.commitment_id?'来自实际约定':e.source.kind==='model_choice'?'一次选择时的理解，行动尚需看结果':e.source.label??'带来源的生活记录'}{e.independent_evidence?' · 是兴趣相关的实际经历':' · 不单独改变兴趣'}</small>
        {e.source.url&&/^https:\/\//.test(e.source.url)?<a href={e.source.url} target="_blank" rel="noreferrer">查看原始出处 ↗</a>:null}
        {e.evidence_ids?.length?<small>参考了 {e.evidence_ids.length} 条已有记忆</small>:null}
        {e.root_outcome_id?<small>共同经历编号：{e.root_outcome_id} · 多个记录视角只计一次结果</small>:null}
        {related.length?<ul className="life-memory__related">{related.map(view=><li key={view.id}><span>{kinds[view.kind]}</span><p>{view.text}</p></li>)}</ul>:null}
      </details>
    </li>:null)}</ol>
    {journal&&!records.length?<p className="life-empty">这一类记忆还在慢慢积累。</p>:null}
  </section>;
}
