import type {DeskBotObjectState} from './types.ts';

const seedbedStatuses:Record<string,string>={prototype:'试种中，尚未验收',growing:'还在生长',ready:'苗已成熟',empty:'收获后空着',dead:'这一批枯萎了'};
const pumpStatuses:Record<string,string>={assembled:'样机已组装',moved:'样机已经移走',installed_trial:'已安装，等待试机和验收',ready:'已经验收',broken:'需要修理'};
const batchStatuses:Record<string,string>={carried:'已经煮好，尚未端到长桌',served:'这批试汤已端到长桌',awaiting_taste:'留在长桌，等待实际试菜',tasted:'已经留下试菜反馈',expired:'这批样品已经过期'};
const percent=(n:number)=>Number.isFinite(n)?`${Math.round(Math.min(1,Math.max(0,n))*100)}%`:'待记录';
export function ProjectFacilityState({state,names,compact=false}:{state?:DeskBotObjectState;names?:Record<string,string>;compact?:boolean}) {
  if(!state)return null;
  const bed=state.project_assets?.floating_seedbed,pump=state.project_assets?.small_water_pump;
  const recipe=state.recipe_book?.['leaf-signature-soup'],draft=state.project_drafts?.['leaf-signature-soup'],batch=state.project_batches?.['leaf-signature-soup'];
  if(!bed&&!pump&&!recipe&&!draft&&!batch)return null;
  const inputs=(items:{resource:string;count:number}[])=>items.map(item=>`${names?.[item.resource]??item.resource} ${item.count} 份`).join(' + ');
  return <div className={`life-facility-projects${compact?' life-facility-projects--compact':''}`} aria-label="这里实际留下的项目成果">
    {bed?<p><strong>水岸浮圃 · {seedbedStatuses[bed.status]??bed.status}</strong><span>{bed.quantity} 株 · 生长 {percent(bed.growth)} · 苗况 {percent(bed.health)} · 湿润 {percent(bed.moisture)}</span>{!compact?<small>{bed.accepted_at?'已经实际验收；之后还要照料和收获。':'有了试作，不等于已经验收。'}</small>:null}</p>:null}
    {pump?<p><strong>小水泵 · {pumpStatuses[pump.status]??pump.status}</strong>{pump.condition!==undefined?<span>完好 {percent(pump.condition)}{pump.use_count!==undefined?` · 实际汲水 ${pump.use_count} 次`:''}</span>:null}</p>:null}
    {recipe?<p><strong>{recipe.name} · 已存入配方簿</strong>{!compact?<span>{inputs(recipe.inputs)} → 每锅 {recipe.yield_count} 份</span>:null}</p>:draft?<p><strong>叶芽汤 · 记下的试作配比</strong>{!compact?<span>{inputs(draft.inputs)} · 计划每锅 {draft.yield_count} 份，等待实际试菜与确认。</span>:null}</p>:null}
    {batch?<p><strong>试汤 · {batchStatuses[batch.status]??batch.status}</strong><span>这批剩下 {batch.remaining_portions} 份{batch.feedback?.length?` · 已有 ${batch.feedback.length} 条实际反馈`:''}</span></p>:null}
  </div>;
}
