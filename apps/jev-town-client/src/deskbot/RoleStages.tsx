import {lazy,Suspense,useEffect,useState} from 'react';
import type {DeskBotRoleProposal,DeskBotRoleStage,DeskBotRoleStagePreview,DeskBotRoleStageOperation,DeskBotRoleStages} from './types.ts';
import {shapingAppearanceLabel} from '../three/shapingAppearance.ts';

const Figure=lazy(()=>import('./RoleAppearancePreview.tsx').then(value=>({default:value.RoleAppearancePreview})));
export type StageControl=(proposalId:string,operation:DeskBotRoleStageOperation,binding:string)=>void;
export type StagePreview=(proposalId:string)=>Promise<DeskBotRoleStagePreview>;
const date=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function RoleStageRecord({stage,busy=false,readOnly=false,onControl}:{stage:DeskBotRoleStage;busy?:boolean;readOnly?:boolean;onControl?:StageControl}) {
  return <section className={`life-stage-record ${stage.current?'is-current':''}`} aria-label={`${stage.label}角色阶段`}>
    <div className="life-row"><strong>{stage.label}</strong><span className="life-chip">{stage.status==='rolled_back'?'已经回退':stage.current?'当前生活方向':'历史生活阶段'}</span></div>
    <p>{stage.life_changes.summary}</p><small>采用于 {date(stage.accepted_at)}{stage.rolled_back_at?` · ${date(stage.rolled_back_at)} 回退`:''}</small>
    <details><summary>这一阶段的实际依据与版本</summary><p>{stage.primary_root_ids.length} 件主要实践，跨 {stage.primary_days.length} 个上海日期。</p><code>{stage.stage_id}</code><ul>{stage.primary_root_ids.map(root=><li key={root}><code>{root}</code></li>)}</ul></details>
    {stage.current&&stage.allowed_actions.includes('rollback')?<button type="button" disabled={busy||readOnly||!onControl} onClick={()=>onControl?.(stage.proposal_id,'rollback',stage.stage_id)}>回退{stage.axis==='form'?'这个虚拟形态':'这个职业方向'}</button>:null}
    <small>同一位喵呜继续生活。实际做过的事和关系会留下；形象配件不赠送物品，也不认定职业资格。</small>
  </section>;
}
export function RoleStageCard({proposal,busy=false,readOnly=false,onPreview,onControl}:{proposal:DeskBotRoleProposal;busy?:boolean;readOnly?:boolean;onPreview?:StagePreview;onControl?:StageControl}) {
  const [preview,setPreview]=useState<DeskBotRoleStagePreview|null>(readOnly?proposal.role_stage_preview??null:null),[opening,setOpening]=useState(false),[error,setError]=useState('');
  // A refresh can invalidate the reviewed basis. Only an explicitly re-opened live preview can be accepted.
  useEffect(()=>{setPreview(readOnly?proposal.role_stage_preview??null:null);setError('');},[proposal.role_stage_preview?.preview_fingerprint,proposal.role_stage?.stage_id,proposal.role_stage?.current,readOnly]);
  const stage=proposal.role_stage;
  if(stage)return <RoleStageRecord stage={stage} busy={busy} readOnly={readOnly} onControl={onControl}/>;
  if(!proposal.role_stage_preview||proposal.status!=='prepared')return null;
  async function open(){setOpening(true);setError('');try{const next=onPreview?await onPreview(proposal.proposal_id):readOnly?proposal.role_stage_preview:null;if(next)setPreview(next);}catch(value){setError(value instanceof Error?value.message:'预览暂时不可用');}finally{setOpening(false);}}
  return <section className="life-stage-preview" aria-label="下一阶段形象与生活预览">
    <div className="life-row"><strong>下一种自己，会怎样生活</strong><span className="life-wish__axis">虚拟形象</span></div>
    {!preview?<><p>可以先看看这个方向的形象和生活选项。预览期间，小镇里的喵呜保持现在的样子。</p><button type="button" disabled={busy||opening||(!onPreview&&!readOnly)} onClick={()=>void open()}>{opening?'正在读取依据…':'查看形象与生活预览'}</button></>:<>
      <div className="life-stage-preview__figure"><Suspense fallback={<p className="life-empty">正在构建独立形象预览…</p>}><Figure appearance={preview.appearance_preview}/></Suspense></div>
      <div className="life-stage-preview__comparison"><span>此刻<small>{shapingAppearanceLabel(preview.appearance_before)}</small></span><i aria-hidden="true">→</i><span>若采用<small>{shapingAppearanceLabel(preview.appearance_preview)}</small></span></div>
      <p>{preview.options[0]?.summary??'这个方向尚无可采用的形象。'}</p><p className="life-stage-preview__life">{preview.life_changes?.summary}</p>
      <small>已有 {preview.basis.primary_root_ids.length} 件核验主要实践，跨 {preview.basis.primary_days.length} 个上海日期。</small>
      {preview.barriers.length?<div className="life-wish__barriers"><small>采用前，还需要</small><ul>{preview.barriers.map(value=><li key={value.id}>{value.label}</li>)}</ul></div>:null}
      <p className="life-stage-preview__boundary">这是独立预览。明确采用后才改变虚拟形象和生活选项；现实外壳、声音和单轴身体能力保持当前。</p>
      <div className="life-actions">{preview.eligible?<button className="life-primary" type="button" disabled={busy||opening||readOnly||!onControl} onClick={()=>onControl?.(proposal.proposal_id,'accept',preview.preview_fingerprint)}>采用这个{preview.axis==='form'?'虚拟形态':'生活方向'}</button>:null}{!readOnly?<button type="button" disabled={busy||opening} onClick={()=>setPreview(null)}>收起预览</button>:null}</div>
      <small>成功不直接证明喜欢、作品质量或职业资格。可以回退当前这一轴，已发生的生活保留。</small>
    </>}
    {error?<p role="alert" className="life-stage-error">{error}<button type="button" disabled={busy||opening} onClick={()=>void open()}>重新读取预览</button></p>:null}
  </section>;
}
export function RoleStagesSummary({stages}:{stages:DeskBotRoleStages|undefined|null}) {
  if(stages?.schema!=='deskbot.role-stages.v1'||!stages.enabled)return null;
  const active=[stages.current.form,stages.current.vocation].filter((value):value is DeskBotRoleStage=>Boolean(value));
  return <section className="life-stage-current" aria-label="目前采用的生活阶段"><div className="life-row"><strong>仍是喵呜，正在成为</strong><span aria-hidden="true">✦</span></div><p>{shapingAppearanceLabel(stages.appearance)}</p><small>{active.length?'地图与这张卡读取同一份已采用形象。':'目前已回到初生虚拟形象。实际经历继续保留。'}</small><details><summary>形象版本与保留的日子 · {stages.history.length}</summary>{stages.history.slice().reverse().map(stage=><div key={stage.stage_id}><strong>{stage.label} · {stage.current?'当前':stage.status==='rolled_back'?'已回退':'历史'}</strong><small>{date(stage.accepted_at)}</small><code>{stage.stage_id}</code></div>)}</details></section>;
}
