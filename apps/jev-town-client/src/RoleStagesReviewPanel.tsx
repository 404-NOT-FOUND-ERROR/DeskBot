import {lazy,Suspense} from 'react';
import {RoleWishes} from './deskbot/RoleWishes.tsx';
import {LivedMemory} from './deskbot/LivedMemory.tsx';
import type {RoleStagesReviewSample} from './roleStagesReview.ts';
import {shapingAppearanceLabel} from './three/shapingAppearance.ts';
const Figure=lazy(()=>import('./deskbot/RoleAppearancePreview.tsx').then(value=>({default:value.RoleAppearancePreview})));
export function RoleStagesReviewPanel({sample}:{sample:RoleStagesReviewSample}) {
  const stages=sample.evolution.role_stages!,actual=stages.appearance;
  const task=sample.map?.tasks?.find(value=>value.actor_id===sample.memory.owner_id&&['running','paused'].includes(value.status));
  return <><section className="development-review__sample" aria-live="polite"><span className="development-review__eyebrow">这一段生活 · {sample.label}</span><h2>做过之后，选择下一种自己</h2><p>{sample.summary}</p>{sample.restart_verified?<small>重启已核对：当前阶段、造型组合与实际结果沿用原版本。</small>:null}</section>
    <div className="development-review__columns"><aside className="life-sidebar development-review__memory"><RoleWishes snapshot={{evolution:sample.evolution,proposals:sample.proposals}} memory={sample.memory} readOnly/></aside>
    <section className="development-review__direction development-review__appearance"><span className="development-review__eyebrow">样本中实际采用的形象</span><h2>{shapingAppearanceLabel(actual)}</h2><div className="life-stage-preview__figure"><Suspense fallback={<p>正在构建只读形象…</p>}><Figure appearance={actual} label="已保存的虚拟形象样本"/></Suspense></div>
      <p>这里展示样本的已保存状态；左侧“若采用”的独立预览不会改变它。形态与职业分别记录，也可以一起生活。</p>
      <dl><div><dt>虚拟形态</dt><dd>{stages.current.form?.label??'初生形态'}</dd></div><div><dt>生活方向</dt><dd>{stages.current.vocation?.label??'仍在探索'}</dd></div><div><dt>保留的阶段</dt><dd>{stages.history.length} 个</dd></div><div><dt>眼下实际活动</dt><dd>{task?.title??'此刻留些空闲'}</dd></div><div><dt>现实身体</dt><dd>原外壳与单轴能力</dd></div></dl>
      <p className="development-review__note">沿用种子眼、梨形体、胸口光核与光粒。采用生活方向后增加有限的实际选项；食材、工具、路线和耗时仍由原有生活规则核对。</p>
      <p className="development-review__note">这是跨日加速的隔离实验。正式世界仍按上海现实时间生活；样本中的选择不代表已发生在正式个体身上。</p><details><summary>原来的生活经历，继续留下</summary><LivedMemory memory={sample.memory} actorId={sample.memory.owner_id} journal/></details>
    </section></div><footer>隔离时钟：{new Date(sample.now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · 只读样本，不写入正式世界</footer></>;
}
