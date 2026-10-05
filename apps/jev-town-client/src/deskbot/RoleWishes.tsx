import type {DeskBotLivedMemory,DeskBotRoleProposal,DeskBotRoleWishBasis,DeskBotRoleWishChoice,DeskBotRoleWishDirection,DeskBotRoleWishSnapshot,DeskBotRoleWishes} from './types.ts';

const statusLabels:Record<string,string>={proposed:'想试试看',prepared:'已准备试做',deferred:'先放一放',rejected:'这次不尝试',withdrawn:'这次已收回'};
const axisLabel=(axis:string|undefined)=>axis==='form'?'形态兴趣':axis==='vocation'?'职业愿望':'早期方向试行';
const date=(at:string)=>Number.isFinite(Date.parse(at))?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):null;
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
export function RoleWishCard({proposal,direction,memory,busy=false,readOnly=false,onChoose}:{proposal:DeskBotRoleProposal;direction?:DeskBotRoleWishDirection;memory?:DeskBotLivedMemory|null;busy?:boolean;readOnly?:boolean;onChoose?:(id:string,choice:DeskBotRoleWishChoice)=>void}) {
  const gate=proposal.current_gate??direction?.readiness;
  const barriers=[...(gate?.barriers??[]),...(['deferred','rejected','withdrawn'].includes(proposal.status)?proposal.proposal_gate?.barriers??[]:[])];
  const ready=gate?.eligible===true;
  const cooldown=proposal.cooldown_until?date(proposal.cooldown_until):null;
  return <article className={`life-wish life-wish--${proposal.status}`} aria-label={`${proposal.label??direction?.label??'角色愿望'} · ${statusLabels[proposal.status]??proposal.status}`}>
    <div className="life-row"><span className="life-wish__axis">{axisLabel(proposal.axis??direction?.axis)}</span><span className="life-chip">{statusLabels[proposal.status]??proposal.status}</span></div>
    <h3>{proposal.label??direction?.label??'一个新方向'}</h3>
    <p className="life-wish__reason">{proposal.authored_reason??direction?.authored_reason??'先让实际经历慢慢留下，再看这个方向是否适合。'}</p>
    <Barriers barriers={barriers}/>
    {proposal.status==='proposed'?<>
      <p className="life-wish__next">{proposal.next_step??direction?.next_step??'先准备一次实际试做，再看结果。'}</p>
      <div className="life-actions"><button className="life-primary" type="button" disabled={busy||readOnly||!onChoose||!ready} onClick={()=>onChoose?.(proposal.proposal_id,'try')}>准备实际试做</button><button type="button" disabled={busy||readOnly||!onChoose} onClick={()=>onChoose?.(proposal.proposal_id,'later')}>以后再说</button><button type="button" disabled={busy||readOnly||!onChoose} onClick={()=>onChoose?.(proposal.proposal_id,'reject')}>这次不尝试</button></div>
      <small>这次回应先记录准备；实际试做尚未开始。</small>
    </>:proposal.status==='prepared'?<p className="life-wish__next">已经记录试做意向。还没有开始实际试做，等下一阶段接上行动与结果。</p>
      :['deferred','rejected'].includes(proposal.status)?<p className="life-wish__next">{cooldown?`${cooldown} 后再考虑；`:'先留一段时间；'}还需要有新的实际经历，再决定要不要重新提出。</p>
        :<p className="life-wish__next">这次愿望已收回，留下的经历仍会保留。</p>}
    <Basis basis={proposal.wish_basis??direction?.basis} memory={memory}/>
    <small className="life-wish__identity">目前没有变身，也没有认定职业资格。</small>
  </article>;
}
export function RoleWishes({snapshot,memory,busy=false,readOnly=false,onChoose}:{snapshot:DeskBotRoleWishSnapshot|null|undefined;memory?:DeskBotLivedMemory|null;busy?:boolean;readOnly?:boolean;onChoose?:(id:string,choice:DeskBotRoleWishChoice)=>void}) {
  const view=roleWishView(snapshot);
  if(!view)return null;
  const proposals=(snapshot?.proposals??[]).filter(value=>value.origin==='lived_wish').reverse();
  const history=(snapshot?.proposals??[]).filter(value=>value.origin!=='lived_wish'&&!value.trial?.started_at&&['proposed','deferred','trying'].includes(value.status)).slice(-4).reverse();
  const current=proposals.filter(value=>['proposed','prepared'].includes(value.status));
  const past=proposals.filter(value=>!['proposed','prepared'].includes(value.status)).slice(0,6);
  return <section className="life-block life-wishes" aria-label="生活里的形态兴趣与职业愿望">
    <div className="life-row"><h2>想成为的下一种自己</h2><span aria-hidden="true">✧</span></div>
    <p className="life-wishes__intro">形态兴趣与职业愿望可以一起长出来：想成为青蛙，也可以继续学习做饭。都要从已有经历和眼下条件开始。</p>
    {current.length?current.map(proposal=><RoleWishCard key={proposal.proposal_id} proposal={proposal} direction={view.directions.find(value=>value.direction_id===proposal.direction_id)} memory={memory} busy={busy} readOnly={readOnly} onChoose={onChoose}/>):<p className="life-empty">还没有正在准备的愿望。感兴趣、真正做过，再慢慢判断想成为什么。</p>}
    <details className="life-wishes__directions"><summary>这些方向，眼下走到了哪里</summary>{view.directions.map(direction=><RoleWishDirection key={direction.direction_id} direction={direction} memory={memory}/>)}</details>
    {past.length?<details className="life-wishes__past"><summary>先放下的想法</summary>{past.map(proposal=><RoleWishCard key={proposal.proposal_id} proposal={proposal} direction={view.directions.find(value=>value.direction_id===proposal.direction_id)} memory={memory} readOnly/>)}</details>:null}
    {history.length?<details className="life-wishes__past"><summary>早期留下的方向记录</summary>{history.map(value=><article className="life-wish-direction" key={value.proposal_id}><strong>{value.label??value.direction_id}</strong><p>历史方向记录；新尝试需要实际生活依据。</p><small>这条记录还没有开始试行。先让新的生活经历形成愿望，形态和身份保持当前。</small></article>)}</details>:null}
  </section>;
}
