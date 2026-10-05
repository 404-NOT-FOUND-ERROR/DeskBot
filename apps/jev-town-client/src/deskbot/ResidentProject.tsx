import type { DeskBotResidentProject, DeskBotWorldMap } from './types.ts';

export function residentProjectFor(map: DeskBotWorldMap | null, actorId?: string) {
  if (!map || !actorId) return null;
  // npc.project.progress is only a stage summary; the full card requires the canonical read model.
  return map.projects?.projects.find(project => project.owner_id === actorId || project.actor_id === actorId) ?? null;
}
export function projectStateLabel(project: DeskBotResidentProject) {
  return project.status === 'completed' ? '已经做成' : project.status === 'setback' ? '遇到波折' : project.blocked_reason ? '还有一道坎' : '慢慢在做';
}
const at = (value:string) => new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});

export function ResidentProject({project,map,onPlace}:{project:DeskBotResidentProject;map:DeskBotWorldMap;onPlace:(id:string)=>void}) {
  const place=map.locations.find(location=>location.location_id===project.location_id);
  const name=(id:string)=>map.npcs.find(npc=>npc.npc_id===id)?.display_name??(id===map.protagonist.character_id?'喵呜':'居民');
  return <section className={`life-resident-project life-resident-project--${project.status}`} aria-label={`${project.name}的真实进展`}>
    <div className="life-row"><span className="deskbot-mode__eyebrow">一直惦记的事</span><span className="life-chip">{projectStateLabel(project)}</span></div>
    <h3>{project.name}</h3><p>{project.goal}</p>
    <dl className="life-project-phase"><div><dt>{project.status==='completed'?'已经走到':'眼下这一步'}</dt><dd>{project.stage_title}</dd></div><div><dt>返工记录</dt><dd>{project.retry_count>0?`已返工 ${project.retry_count} 次`:'初次推进，尚未返工'}</dd></div></dl>
    {project.blocked_reason?<p className="life-project-blocked"><strong>还需要</strong>{project.blocked_reason}</p>:null}
    {project.status!=='completed'&&project.ready_at?<small className="life-project-ready">最早可继续：{at(project.ready_at)}。时间到了，还要实际接着做。</small>:null}
    {project.completed_at?<small className="life-project-ready">做成于 {at(project.completed_at)}</small>:null}
    {place?<button className="life-place-link" onClick={()=>onPlace(place.location_id)}>去{place.name}看看 ↗</button>:null}
    {project.last_outcome?<div className={`life-project-outcome ${project.last_outcome.success?'':'is-setback'}`}><small>上一次留下的结果 · {at(project.last_outcome.at)}</small><p>{project.last_outcome.text}</p>{project.last_outcome.reason&&project.last_outcome.reason!==project.last_outcome.text?<small>{project.last_outcome.reason}</small>:null}</div>:<p className="life-empty">还没有完成一段实际工作，愿望先留在这里。</p>}
    {project.history.length?<details className="life-project-history"><summary>一步步发生的事 · {project.history.length}</summary><ol className="life-timeline">{project.history.slice(-6).reverse().map((event,index)=><li key={`${event.task_id}:${index}`}><time>{at(event.at)}</time><span>{event.text}<small>{name(event.actor_id)} · {event.success?'留下了成果':event.kind==='cancelled'?'这次停下':'遇到波折'}</small></span></li>)}</ol></details>:null}
    {project.evidence.length?<details className="life-project-evidence"><summary>实际做过的依据 · {project.evidence.length}</summary><ul>{project.evidence.slice(-4).reverse().map((e,index)=><li key={`${e.task_id}:${index}`}><span>{e.text}</span><small>{name(e.actor_id)} · {at(e.at)}</small></li>)}</ul></details>:null}
  </section>;
}
