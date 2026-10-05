import {useEffect,useRef,useState,type ReactNode,type CSSProperties} from 'react';
import type {DeskBotWorldMap,DeskBotSocialCommitment} from './types.ts';
import './life-sidebar.css';
import {InputInfluences} from './InputInfluences.tsx';
import {LivedMemory} from './LivedMemory.tsx';
import {activeActorTask,taskDisplayTitle} from './lifeGlance.ts';
import {residentProjectFor,projectStateLabel} from './ResidentProject.tsx';

const statuses:Record<string,string>={proposed:'待回应',accepted:'已约好',meeting:'正在赴约',working:'一起在忙',completed:'已办成',declined:'这次不参加',failed:'未办成',withdrawn:'已告知退出'};
const time=(at:string)=>new Date(at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'});
const active=(c:DeskBotSocialCommitment)=>['proposed','accepted','meeting','working'].includes(c.status);
const scrollBehavior=():ScrollBehavior=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
interface Props {
  map:DeskBotWorldMap|null;selectedNpcId:string|null;selectionRequest:number;busy:boolean;
  npcDetail:ReactNode;taskDetail:ReactNode;experienceDetail:ReactNode;
  onSelectNpc:(id:string)=>void;onPlace:(id:string)=>void;
  onAutonomy:()=>void;onRespond:(id:string,operation:'join'|'decline'|'withdraw')=>void;
  replay?:boolean;onSuggest?:(id:string)=>void;
}
export function LifeSidebar({map,selectedNpcId,selectionRequest,busy,npcDetail,taskDetail,experienceDetail,onSelectNpc,onPlace,onAutonomy,onRespond,onSuggest,replay=false}:Props) {
  const [tab,setTab]=useState('now'),[query,setQuery]=useState('');
  const tabRefs=useRef<(HTMLButtonElement|null)[]>([]),inputArea=useRef<HTMLDivElement>(null),residentDetail=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(selectionRequest){setTab('people');requestAnimationFrame(()=>residentDetail.current?.scrollIntoView({block:'nearest',behavior:scrollBehavior()}));}},[selectionRequest]);
  const own=map?.autonomy?.actors.find(a=>a.actor_id===map.protagonist.character_id),current=map?.locations.find(l=>l.current);
  const currentTask=activeActorTask(map,map?.protagonist.character_id);
  const promises=map?.social?.commitments??[],ongoing=promises.filter(active);
  const invites=ongoing.filter(c=>c.actors.includes(map?.protagonist.character_id??'')&&c.responses[map!.protagonist.character_id]==='pending');
  const tabs=[{id:'now',name:'喵呜'},{id:'people',name:'居民',count:map?.npcs.length},{id:'social',name:'约定',count:ongoing.length||undefined},{id:'journal',name:'记录'}];
  const recent=[...(map?.autonomy?.recent??[]).filter(e=>['completed','plan_completed','replan','transfer'].includes(e.kind)).map(e=>({...e,name:map?.autonomy?.actors.find(a=>a.actor_id===e.actor_id)?.display_name??'喵呜'})),...(map?.social?.recent??[]).map(e=>({...e,name:'镇上来往'})),...(map?.living?.recent_changes??[]).filter(e=>e.kind?.startsWith('environment')).map(e=>({...e,name:'小镇变化'}))].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,16);
  const name=(id:string)=>id===map?.protagonist.character_id?'喵呜':map?.npcs.find(n=>n.npc_id===id)?.display_name??id;
  const ownCommitment=ongoing.find(c=>c.actors.includes(map?.protagonist.character_id??'')&&c.responses[map!.protagonist.character_id]==='join');
  const currentPlan=own?.plan&&['planned','executing'].includes(own.plan.status)?own.plan:null;
  const completedSteps=Math.max(0,Math.min(currentPlan?.index??0,currentPlan?.steps.length??0));
  const selectedResident=map?.npcs.find(n=>n.npc_id===selectedNpcId);
  const selectResident=(id:string)=>{onSelectNpc(id);requestAnimationFrame(()=>residentDetail.current?.scrollIntoView({block:'nearest',behavior:scrollBehavior()}));};
  const choiceLabel=currentPlan?.decision?.source==='model'?'结合经历，自己选择':currentPlan?.decision?.source==='needs'?'照顾眼前的需要':currentPlan?.decision?.source==='fallback'?'按眼下条件安排':'顺着日常安排';
  function card(c:DeskBotSocialCommitment) {return <article className={`life-promise life-promise--${c.status}`} key={c.id}>
    <div className="life-row"><span className="life-chip">{statuses[c.status]??c.status}</span><small>{c.delay_count?'已改约 · ':''}{time(c.deadline_at)} 前</small></div>
    <h3>{c.title}</h3><small>{c.actors.map(name).join(' · ')}</small><p>{c.reason}</p><button className="life-place-link" onClick={()=>onPlace(c.location_id)}>{c.location_name} ↗</button>
    <p className="life-result">{c.last_note}</p>
    {c.actors.includes(map!.protagonist.character_id)&&c.status==='proposed'&&c.responses[map!.protagonist.character_id]==='pending'?<div className="life-actions"><button disabled={busy} className="life-primary" onClick={()=>onRespond(c.id,'join')}>愿意参加</button><button disabled={busy} onClick={()=>onRespond(c.id,'decline')}>这次不参加</button></div>:null}
    {c.actors.includes(map!.protagonist.character_id)&&['accepted','meeting','working'].includes(c.status)?<button disabled={busy} className="life-subtle" onClick={()=>onRespond(c.id,'withdraw')}>告诉对方，这次先退出</button>:null}
    {c.changes.length?<details><summary>查看实际进展 · {c.changes.length}</summary><ol className="life-timeline">{c.changes.slice(-6).map((e,i)=><li key={`${e.at}:${i}`}><time>{time(e.at)}</time><span>{e.text}</span></li>)}</ol></details>:null}
  </article>;}
  return <aside className="deskbot-mode__side life-sidebar" aria-label="雾灯镇生活侧栏">
    <div className="life-sidebar__identity"><div className="life-avatar life-avatar--own" aria-hidden="true"><i/><span>喵</span></div><div><strong>喵呜的小日子</strong><span>{current?.name??'正在连接小镇'}</span></div><span className="life-online"><i/>{replay?'回放中':map?'生活中':'连接中'}</span></div>
    <nav className="life-tabs" role="tablist" aria-label="生活视图">{tabs.map((item,index)=><button key={item.id} ref={el=>{tabRefs.current[index]=el;}} type="button" id={`life-tab-${item.id}`} role="tab" aria-selected={tab===item.id} aria-controls={`life-view-${item.id}`} tabIndex={tab===item.id?0:-1} onClick={()=>setTab(item.id)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;if(next!==null){event.preventDefault();setTab(tabs[next]!.id);tabRefs.current[next]?.focus();}}}>{item.name}{item.count?<span>{item.count}</span>:null}</button>)}</nav>
    {map?.refraction?<div className="life-input-entry"><button type="button" onClick={()=>{setTab('now');requestAnimationFrame(()=>inputArea.current?.scrollIntoView({block:'start',behavior:scrollBehavior()}));}}><span><i aria-hidden="true">✧</i> 现实带来的小事</span><small>{replay?'查看出处 ↗':'提个想法 ↗'}</small></button></div>:null}
    <div className="life-sidebar__body">
      <div role="tabpanel" id="life-view-now" aria-labelledby="life-tab-now" hidden={tab!=='now'}>
        <section className="life-now">
          <div className="life-row"><span className="deskbot-mode__eyebrow">正在过的这一刻</span><span className={`life-chip ${currentTask?.status==='paused'?'life-chip--paused':''}`}>{currentTask?.status==='paused'?'暂时停下':currentTask?.kind==='travel'?'在路上':currentTask?'正在忙':own?.paused?'留些空闲':'自己安排中'}</span></div>
          <h2>{currentTask?taskDisplayTitle(map,currentTask):ownCommitment?.title??currentPlan?.title??'留一点时间，想想下一件事'}</h2>
          <p className="life-now__reason">{currentPlan?.reason??ownCommitment?.reason??'看看手头能做什么，再慢慢决定。'}</p>
          {currentPlan?.decision?<details className={`life-choice-origin life-choice-origin--${currentPlan.decision.source}`}><summary><span aria-hidden="true">✦</span>{choiceLabel}</summary><p>{currentPlan.decision.source==='model'?`这次由 ${currentPlan.decision.model??'模型'} 结合已有经历选择；行动还要看实际结果。`:currentPlan.decision.reason}</p></details>:null}
          {currentPlan&&currentPlan.steps.length>1?<div className="life-plan-progress"><span>{currentPlan.title}</span><small>已走过 {completedSteps} / {currentPlan.steps.length} 步</small><progress aria-label="当前安排已完成的步骤" value={completedSteps} max={currentPlan.steps.length}/></div>:null}
          {taskDetail}
          {own?<div className="life-needs"><label>精神 <strong>{Math.round(own.energy*100)}%</strong><meter aria-label="精神" min={0} max={1} value={own.energy}/></label><label>食欲 <strong>{Math.round(own.appetite*100)}%</strong><meter aria-label="食欲" min={0} max={1} value={own.appetite}/></label></div>:null}
          {own?.last_feedback?<p className="life-result"><span>刚刚留下的小事</span>{own.last_feedback.text}</p>:null}
          <button className="life-subtle" disabled={busy||!own} onClick={onAutonomy}>{own?.paused?'恢复自发安排':'给下一次安排留点空闲'}</button>
        </section>
        {invites.length?<section className="life-block"><div className="life-row"><h2>有人约你</h2><button className="life-place-link" onClick={()=>setTab('social')}>全部约定 ↗</button></div>{card(invites[0]!)}</section>:null}
        {map?<LivedMemory memory={map.memory} actorId={map.protagonist.character_id}/>:null}
        <div ref={inputArea}><InputInfluences inputs={map?.refraction} busy={busy} onSuggest={onSuggest} replay={replay}/></div>
        <section className="life-block"><h2>随身带着</h2><div className="life-bag">{Object.entries(map?.living?.inventory.stock??{}).filter(([,n])=>n>=1).map(([r,n])=><span key={r}>{map?.living?.resource_names[r]??r}<strong>{Math.floor(n)}</strong></span>)}</div>{!Object.values(map?.living?.inventory.stock??{}).some(n=>n>=1)?<p className="life-empty">包里暂时空着，出门时再准备。</p>:null}{map?.living?.resource_renewal?<p className="life-supply-note">清水要去泉眼汲取净滤；收获的苔芽也可以留种。带回来，再补给苗圃和灶台。</p>:null}</section>
        <section className="life-block"><h2>去镇上看看</h2><div className="life-places">{map?.regions?.map(region=><div key={region.region_id}><small>{region.name}</small><div>{map.locations.filter(l=>l.region_id===region.region_id).map(l=><button key={l.location_id} className={l.current?'is-active':''} onClick={()=>onPlace(l.location_id)}>{l.name}</button>)}</div></div>)}</div></section>
      </div>
      <div role="tabpanel" id="life-view-people" aria-labelledby="life-tab-people" hidden={tab!=='people'}>
        <div className="life-block__head"><span className="deskbot-mode__eyebrow">镇上的来往</span><h2>大家各有安排</h2><p>{map?.npcs.length??0} 位居民，各自过着今天。</p></div>
        <label className="sr-only" htmlFor="life-resident-search">搜索居民</label><input id="life-resident-search" className="life-search" placeholder="找一位居民…" value={query} onChange={e=>setQuery(e.target.value)}/>
        <div className="life-residents">{map?.npcs.filter(n=>`${n.display_name}${n.role_label??n.role}`.includes(query)).map(n=>{const task=activeActorTask(map,n.npc_id),place=map.locations.find(l=>l.location_id===n.location_id),project=residentProjectFor(map,n.npc_id);return <button key={n.npc_id} className={selectedNpcId===n.npc_id?'is-selected':''} aria-pressed={selectedNpcId===n.npc_id} onClick={()=>selectResident(n.npc_id)}><span className="life-avatar" style={{'--resident-color':n.color??'#728d85'} as CSSProperties}>{n.display_name.slice(0,1)}</span><span className="life-resident-name"><strong>{n.display_name}</strong><small>{n.role_label??'镇上居民'}</small></span><span className="life-resident-state"><i className={task?.status==='paused'?'is-paused':task?'is-busy':''}/>{task?taskDisplayTitle(map,task):n.status||'留一点空闲'}</span>{project?<span className="life-resident-project-glance">{projectStateLabel(project)} · {project.stage_title}</span>:null}<span className="life-resident-place">{task?.kind==='travel'?'在路上 · 尚未抵达':place?.name??'镇上'}{task?.status==='paused'?' · 暂停中':''}</span></button>;})}</div>
        {map&&!map.npcs.some(n=>`${n.display_name}${n.role_label??n.role}`.includes(query))?<p className="life-empty">没有找到这位居民，试试名字或平日的工作。</p>:null}
        <div ref={residentDetail} className="life-resident-detail" aria-label={selectedResident?`${selectedResident.display_name}的生活近况`:'居民生活近况'}>{npcDetail}</div>
        {selectedNpcId?<LivedMemory memory={map?.memory} actorId={selectedNpcId}/>:null}
        {selectedNpcId?<section className="life-block"><h3>与大家的来往</h3>{Object.values(map?.social?.relationships??{}).filter(r=>r.actors.includes(selectedNpcId)).slice(0,4).map(r=><p key={r.actors.join('|')}>{r.actors.map(name).join(' · ')}<br/><small>见过 {r.encounters} 次 · 办成 {r.kept} 次 · 未办成 {r.missed} 次</small></p>)}</section>:null}
      </div>
      <div role="tabpanel" id="life-view-social" aria-labelledby="life-tab-social" hidden={tab!=='social'}><div className="life-block__head"><span className="deskbot-mode__eyebrow">有来有往</span><h2>说好的那些小事</h2><p>先答应，再见面，结果慢慢发生。</p></div>{ongoing.length?ongoing.map(card):<p className="life-empty">眼下没有未完成的约定。大家还在忙自己的事。</p>}<details className="life-settled"><summary>以前的约定 · {promises.length-ongoing.length}</summary>{promises.filter(c=>!active(c)).reverse().slice(0,8).map(card)}</details></div>
      <div role="tabpanel" id="life-view-journal" aria-labelledby="life-tab-journal" hidden={tab!=='journal'}><div className="life-block__head"><span className="deskbot-mode__eyebrow">一些留下来的光</span><h2>日子留下的痕迹</h2><p>真正做过的事、当时的想法、听来的消息。</p></div>{map?<LivedMemory memory={map.memory} actorId={map.protagonist.character_id} journal/>:null}<InputInfluences inputs={map?.refraction} journal replay={replay}/>{map?.social?.notices.length?<section className="life-block"><h3>簌簌的小报</h3>{map.social.notices.slice(-3).reverse().map(n=><article key={n.id} className="life-notice"><p>{n.text}</p><small>{time(n.at)} · 来自实际发生的来往</small><button className="life-place-link" onClick={()=>setTab('social')}>查看来往 ↗</button></article>)}</section>:null}<ol className="life-timeline">{recent.map((e,i)=><li key={`${e.at}:${i}`}><time>{time(e.at)}</time><div><strong>{e.name}</strong><p>{e.text}</p></div></li>)}</ol>{!recent.length?<p className="life-empty">今天的记录会随着生活逐渐留下。</p>:null}{experienceDetail}</div>
    </div>
    <div className="life-sidebar__foot"><span><i aria-hidden="true"/>{replay?'独立样本 · 不写入正式世界':map?.living?.recovery.pending?'正在接上离开时的日子':'与现实一起，慢慢过日子'}</span>{!replay?<a href="/life-review.html" target="_blank" rel="noreferrer">独立回放 ↗</a>:null}</div>
  </aside>;
}
