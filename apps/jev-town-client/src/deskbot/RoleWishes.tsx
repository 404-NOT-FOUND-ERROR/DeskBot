import {useState} from 'react';
import type {DeskBotLivedMemory,DeskBotRoleProposal,DeskBotRoleWishBasis,DeskBotRoleWishChoice,DeskBotRoleWishDirection,DeskBotRoleWishSnapshot,DeskBotRoleWishes,DeskBotPracticalRoleTrial,DeskBotPracticalTrialOperation} from './types.ts';

const statusLabels:Record<string,string>={proposed:'想试试看',prepared:'已准备试做',deferred:'先放一放',rejected:'这次不尝试',withdrawn:'这次已收回'};
const axisLabel=(axis:string|undefined)=>axis==='form'?'形态兴趣':axis==='vocation'?'职业愿望':'早期方向试行';
const date=(at:string)=>Number.isFinite(Date.parse(at))?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):null;
type PracticalControl=(id:string,operation:DeskBotPracticalTrialOperation,variant?:string)=>void;
const practicalLabels={running:'实际试做中',paused:'试做先停一停',blocked:'等生活条件允许',review:'这一段可以回看了',exited:'这次试做已退出'};
const resultLabel=(outcome:string,classification:string|null)=>outcome==='completed'?'核验完成':outcome==='cancelled'?'这次已取消':['resource','condition','route','coordination'].includes(classification??'')?'受条件影响，没办成':classification==='performance'?'操作还需要练习':outcome==='failed'?'未办成，原因尚不能归类':'结果仍待核验';
export function roleWishView(snapshot:DeskBotRoleWishSnapshot|null|undefined):DeskBotRoleWishes|null {
  const view=snapshot?.evolution?.wishes??snapshot?.evolution?.development?.role_wishes;
  return view?.schema==='deskbot.role-wishes.v1'&&view.enabled&&Array.isArray(view.directions)?view:null;
}
function Basis({basis,memory}:{basis:DeskBotRoleWishBasis|undefined;memory?:DeskBotLivedMemory|null}) {
  const roots=[...new Set(basis?.root_outcome_ids??[])];
  if(!roots.length)return null;
  return <details className="life-wish__basis"><summary>这些日子给了什么依据</summary>
    <p>自己主动继续、回应邀请和生活需要分别保留；这里读取同一件事的结果，多个记录视角不会叠加。</p>
    <ul>{roots.map(root=>{const record=memory?.development?.recent.find(value=>value.root_outcome_id===root);return <li key={root}><span>{record?.title??(record?.topic==='cook'?'一次实际做饭':'一段实际经历')}{record?.outcome==='failed'?' · 这次没办成':record?.outcome==='completed'?' · 已完成':''}</span><code>{root}</code></li>;})}</ul>
  </details>;
}
function Barriers({barriers}:{barriers:{id:string;label:string;scope?:string}[]}) {
  return barriers.length?<div className="life-wish__barriers"><small>眼下还差这些</small><ul>{barriers.map(value=><li key={`${value.scope}:${value.id}`}>{value.label}</li>)}</ul></div>:null;
}
export function RoleWishDirection({direction,memory}:{direction:DeskBotRoleWishDirection;memory?:DeskBotLivedMemory|null}) {
  return <article className={`life-wish-direction ${direction.readiness.eligible?'is-eligible':''}`}>
    <div className="life-row"><strong>{direction.label}</strong><span className="life-wish__axis">{axisLabel(direction.axis)}</span></div>
    <p>{direction.authored_reason}</p>
    <small>{direction.readiness.eligible?'已有经历可以考虑这个方向，仍要由生活里的选择提出。':'还在积累经历，暂未达到提出愿望的前提。'}</small>
    <Barriers barriers={direction.readiness.barriers}/>
    <Basis basis={direction.basis} memory={memory}/>
  </article>;
}
export function PracticalRoleTrial({trial,memory,busy=false,readOnly=false,onControl}:{trial:DeskBotPracticalRoleTrial;memory?:DeskBotLivedMemory|null;busy?:boolean;readOnly?:boolean;onControl?:PracticalControl}) {
  const [variant,setVariant]=useState(trial.variant_id);
  const disabled=busy||readOnly||!onControl;
  const allowed=(action:Exclude<DeskBotPracticalTrialOperation,'start'>)=>trial.allowed_actions.includes(action);
  const roots=[...new Map(trial.outcomes.map(value=>[value.root_outcome_id,value])).values()];
  const task=trial.active_task;
  const due=task?.due_at?date(task.due_at):null;
  return <section className={`life-practical life-practical--${trial.status}`} aria-label={`实际试做 · ${practicalLabels[trial.status]}`}>
    <div className="life-row"><strong>{practicalLabels[trial.status]}</strong><span className="life-wish__axis">{trial.variant_label}</span></div>
    <p>{trial.next_step}</p>
    {task?<div className="life-practical__task"><small>{task.step_role==='primary'?'正在做的主要实践':'为这次实践做准备'}</small><strong>{task.title}</strong><span>{task.status==='paused'?'活动已暂停':due?`预计 ${due} 核验结果`:'等待活动到期核验'}</span><small>开始与在路上都不提前算作做成。</small></div>:trial.status==='running'?<p className="life-practical__waiting">已保留试做安排，等这一轮生活调度开始实际任务。</p>:null}
    {trial.current_step?<small className="life-practical__step">当前步骤：{trial.current_step.kind==='travel'?'去往实际活动地点':trial.current_step.kind==='activity'?'动手进行实际活动':'准备实际活动'} · {trial.current_step.step_role==='primary'?'主要实践':'准备与补给'}</small>:null}
    <Barriers barriers={trial.blockers.map(value=>({id:value.code,label:value.label}))}/>
    <p className="life-practical__progress">已核验 {trial.progress.successful_primary} 次主要实践，分布在 {trial.progress.primary_days.length} 个上海日期。{trial.progress.support_roots.length?'途中补给等准备结果另行保留。':''}</p>
    {trial.review.ready?<p className="life-practical__review">{trial.review.summary}</p>:null}
    <small className="life-practical__unknown">做成、做得熟练和愿意继续分别判断；目前不能从这次试做认定喜欢、作品质量或职业资格。</small>
    {roots.length?<details className="life-practical__results"><summary>实际留下的结果 · {roots.length}</summary><ul>{roots.map(value=>{const record=memory?.development?.recent.find(item=>item.root_outcome_id===value.root_outcome_id);return <li key={value.root_outcome_id}><span>{record?.title??'一次实际活动'} · {value.step_role==='primary'?'主要实践':'准备与补给'}</span><strong>{resultLabel(value.outcome,value.classification)}</strong><small>{date(value.at)}</small><code>{value.root_outcome_id}</code></li>;})}</ul><p>这些结果与生活记忆共用编号，同一件事只计算一次。</p></details>:null}
    <div className="life-actions">
      {allowed('pause')?<button type="button" disabled={disabled} onClick={()=>onControl?.(trial.proposal_id,'pause')}>先暂停试做</button>:null}
      {allowed('resume')?<button type="button" className="life-primary" disabled={disabled} onClick={()=>onControl?.(trial.proposal_id,'resume')}>继续实际试做</button>:null}
      {allowed('exit')?<button type="button" disabled={disabled} onClick={()=>onControl?.(trial.proposal_id,'exit')}>退出这次试做</button>:null}
    </div>
    {allowed('adjust')?<div className="life-practical__adjust"><label>接下来采用的实际做法<select value={variant} disabled={disabled} onChange={event=>setVariant(event.target.value)}>{trial.variant_choices.map(value=><option key={value.id} value={value.id}>{value.label}</option>)}</select></label><button type="button" disabled={disabled||!trial.variant_choices.some(value=>value.id===variant)} onClick={()=>onControl?.(trial.proposal_id,'adjust',variant)}>{trial.status==='review'?'按这个做法继续试做':'调整试做安排'}</button></div>:null}
    {trial.status==='paused'?<small>暂停只取消这次试做任务、退回预留材料；日常生活继续。恢复时会重新检查条件。</small>:null}
  </section>;
}
export function RoleWishCard({proposal,direction,memory,busy=false,readOnly=false,onChoose,onPracticalTrial}:{proposal:DeskBotRoleProposal;direction?:DeskBotRoleWishDirection;memory?:DeskBotLivedMemory|null;busy?:boolean;readOnly?:boolean;onChoose?:(id:string,choice:DeskBotRoleWishChoice)=>void;onPracticalTrial?:PracticalControl}) {
  const gate=proposal.current_gate??direction?.readiness;
  const barriers=[...(gate?.barriers??[]),...(['deferred','rejected','withdrawn'].includes(proposal.status)?proposal.proposal_gate?.barriers??[]:[])];
  const ready=gate?.eligible===true;
  const cooldown=proposal.cooldown_until?date(proposal.cooldown_until):null;
  return <article className={`life-wish life-wish--${proposal.status}`} aria-label={`${proposal.label??direction?.label??'角色愿望'} · ${statusLabels[proposal.status]??proposal.status}`}>
    <div className="life-row"><span className="life-wish__axis">{axisLabel(proposal.axis??direction?.axis)}</span><span className="life-chip">{statusLabels[proposal.status]??proposal.status}</span></div>
    <h3>{proposal.label??direction?.label??'一个新方向'}</h3>
    <p className="life-wish__reason">{proposal.authored_reason??direction?.authored_reason??'先让实际经历慢慢留下，再看这个方向是否适合。'}</p>
    {!proposal.practical_trial?<Barriers barriers={barriers}/>:null}
    {proposal.status==='proposed'?<>
      <p className="life-wish__next">{proposal.next_step??direction?.next_step??'先准备一次实际试做，再看结果。'}</p>
      <div className="life-actions"><button className="life-primary" type="button" disabled={busy||readOnly||!onChoose||!ready} onClick={()=>onChoose?.(proposal.proposal_id,'try')}>准备实际试做</button><button type="button" disabled={busy||readOnly||!onChoose} onClick={()=>onChoose?.(proposal.proposal_id,'later')}>以后再说</button><button type="button" disabled={busy||readOnly||!onChoose} onClick={()=>onChoose?.(proposal.proposal_id,'reject')}>这次不尝试</button></div>
      <small>这次回应先记录准备；实际试做尚未开始。</small>
    </>:proposal.practical_trial?<PracticalRoleTrial key={`${proposal.practical_trial.trial_id}:${proposal.practical_trial.variant_id}`} trial={proposal.practical_trial} memory={memory} busy={busy} readOnly={readOnly} onControl={onPracticalTrial}/>:proposal.status==='prepared'?<><p className="life-wish__next">已经记录试做意向。还没有开始实际试做。{proposal.practical_trial_available?'可以准备进入实际生活任务；已有日常安排和身体需要会先被照顾。':'等实际行动与结果连接后再开始。'}</p>{proposal.practical_trial_available?<button className="life-primary" type="button" disabled={busy||readOnly||!onPracticalTrial} onClick={()=>onPracticalTrial?.(proposal.proposal_id,'start')}>开始实际试做</button>:null}</>
      :['deferred','rejected'].includes(proposal.status)?<p className="life-wish__next">{cooldown?`${cooldown} 后再考虑；`:'先留一段时间；'}还需要有新的实际经历，再决定要不要重新提出。</p>
        :<p className="life-wish__next">这次愿望已收回，留下的经历仍会保留。</p>}
    <Basis basis={proposal.wish_basis??direction?.basis} memory={memory}/>
    <small className="life-wish__identity">目前没有变身，也没有认定职业资格。</small>
  </article>;
}
export function RoleWishes({snapshot,memory,busy=false,readOnly=false,onChoose,onPracticalTrial}:{snapshot:DeskBotRoleWishSnapshot|null|undefined;memory?:DeskBotLivedMemory|null;busy?:boolean;readOnly?:boolean;onChoose?:(id:string,choice:DeskBotRoleWishChoice)=>void;onPracticalTrial?:PracticalControl}) {
  const view=roleWishView(snapshot);
  if(!view)return null;
  const proposals=(snapshot?.proposals??[]).filter(value=>value.origin==='lived_wish').reverse();
  const history=(snapshot?.proposals??[]).filter(value=>value.origin!=='lived_wish'&&!value.trial?.started_at&&['proposed','deferred','trying'].includes(value.status)).slice(-4).reverse();
  const current=proposals.filter(value=>['proposed','prepared'].includes(value.status));
  const past=proposals.filter(value=>!['proposed','prepared'].includes(value.status)).slice(0,6);
  return <section className="life-block life-wishes" aria-label="生活里的形态兴趣与职业愿望">
    <div className="life-row"><h2>想成为的下一种自己</h2><span aria-hidden="true">✧</span></div>
    <p className="life-wishes__intro">形态兴趣与职业愿望可以一起长出来：想成为青蛙，也可以继续学习做饭。都要从已有经历和眼下条件开始。</p>
    {current.length?current.map(proposal=><RoleWishCard key={proposal.proposal_id} proposal={proposal} direction={view.directions.find(value=>value.direction_id===proposal.direction_id)} memory={memory} busy={busy} readOnly={readOnly} onChoose={onChoose} onPracticalTrial={onPracticalTrial}/>):<p className="life-empty">还没有正在准备的愿望。感兴趣、真正做过，再慢慢判断想成为什么。</p>}
    <details className="life-wishes__directions"><summary>这些方向，眼下走到了哪里</summary>{view.directions.map(direction=><RoleWishDirection key={direction.direction_id} direction={direction} memory={memory}/>)}</details>
    {past.length?<details className="life-wishes__past"><summary>先放下的想法</summary>{past.map(proposal=><RoleWishCard key={proposal.proposal_id} proposal={proposal} direction={view.directions.find(value=>value.direction_id===proposal.direction_id)} memory={memory} readOnly/>)}</details>:null}
    {history.length?<details className="life-wishes__past"><summary>早期留下的方向记录</summary>{history.map(value=><article className="life-wish-direction" key={value.proposal_id}><strong>{value.label??value.direction_id}</strong><p>历史方向记录；新尝试需要实际生活依据。</p><small>这条记录还没有开始试行。先让新的生活经历形成愿望，形态和身份保持当前。</small></article>)}</details>:null}
  </section>;
}
