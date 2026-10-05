import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LivedMemory} from './deskbot/LivedMemory.tsx';
import type {DeskBotLivedMemory} from './deskbot/types.ts';
import {facetsReviewCounts,readDevelopmentFacetsReview} from './developmentFacetsReview.ts';
import type {DevelopmentFacetsReviewFixture} from './developmentFacetsReview.ts';
import {readRoleWishesReview} from './roleWishesReview.ts';
import type {RoleWishesReviewFixture} from './roleWishesReview.ts';
import {RoleWishes,RoleWishDirection,roleWishView} from './deskbot/RoleWishes.tsx';
import './styles.css';
import './deskbot/life-sidebar.css';
import './development-review.css';

interface Review {
  simulated:true;phase:string;now:string;task_id:string|null;decision_policy:string;live_world_untouched:true;restart_verified:boolean;
  memory:DeskBotLivedMemory;
  evolution:{development:{directions:{direction_id:string;label:string;status:string;root_outcome_ids:string[];counts:{completed:number;failed:number;owner_linked:number};unlocked:boolean}[]}};
}
const samples=[['suggestion','听到建议'],['executing','开始照料'],['completed','核验完成'],['failed','事情没办成'],['restart','重复与重启']] as const;
const fixtureUrl=new URLSearchParams(location.search).get('developmentReviewUrl')??'http://127.0.0.1:4314';
const facetMode=new URLSearchParams(location.search).get('sample')==='facets';
const wishMode=new URLSearchParams(location.search).get('sample')==='wishes';
function WishesReview() {
  const [fixture,setFixture]=useState<RoleWishesReviewFixture|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState('');
  async function load() {
    setError('');
    try {
      const response=await fetch('/role-wishes-review.json');
      if(!response.ok)throw Error();
      const value=readRoleWishesReview(await response.json());
      if(!value)throw Error();
      setFixture(value);setSelected(value.samples[0]!.id);
    } catch {setError('愿望验收样本暂时不可用，重新载入后再试。');}
  }
  useEffect(()=>{void load();},[]);
  const sample=fixture?.samples.find(value=>value.id===selected)??fixture?.samples[0];
  const snapshot=sample?{evolution:sample.evolution,proposals:sample.proposals}:null;
  const view=roleWishView(snapshot);
  const focal=view?.directions.find(value=>value.basis.root_outcome_ids.length>0)??view?.directions[0];
  const current=sample?.proposals.filter(value=>value.origin==='lived_wish'&&['proposed','prepared'].includes(value.status))??[];
  return <main className="development-review development-review--wishes">
    <header><div><span className="development-review__eyebrow">聚形域 · 发展管线 04</span><h1>想成为的下一种自己</h1><p>从持续关注和实际经历，走到一个有理由、也能暂缓的愿望。</p></div><span className="development-review__badge">受控前提与生命周期样本</span></header>
    <nav aria-label="角色愿望与回应样本">{fixture?.samples.map(value=><button key={value.id} aria-pressed={sample?.id===value.id} onClick={()=>setSelected(value.id)}>{value.label}</button>)}</nav>
    {error?<p role="alert" className="development-review__error">{error}<button onClick={()=>void load()}>重试</button></p>:null}
    {sample?<>
      <section className="development-review__sample" aria-live="polite"><span className="development-review__eyebrow">这一段生活 · {sample.label}</span><h2>{current.length?'经历带来了一个想法':'先让日子继续积累'}</h2><p>{sample.summary}</p>{sample.restart_verified?<small>重启与重复处理已核对：沿用同一份经历与回应。</small>:null}</section>
      <div className="development-review__columns">
        <aside className="life-sidebar development-review__memory"><RoleWishes snapshot={snapshot} memory={sample.memory} readOnly/>{!current.length&&focal?<RoleWishDirection direction={focal} memory={sample.memory}/>:null}</aside>
        <section className="development-review__direction"><span className="development-review__eyebrow">形态与生活方向</span><h2>两个方向，可以一起长出来</h2><p>想亲近湿地、尝试青蛙的形态，也可以想学做饭。前一个关乎怎么成为光粒造物，后一个关乎想做什么。</p><p>提出愿望需要已有经历、持续关注和眼下可行的条件。主人可以参与实践；收到一句要求不会直接替代这些前提。</p><p className="development-review__note">“准备实际试做”只记录下一步意向。实际试做将在第五阶段接入，现在没有变身，也没有认定职业资格。</p><details><summary>这些想法之前，实际发生了什么</summary><LivedMemory memory={sample.memory} actorId={sample.memory.owner_id} journal/></details></section>
      </div>
      <footer>隔离时钟：{new Date(sample.now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · 只读受控样本，不写入正式世界</footer>
    </>:!error?<p className="development-review__note">正在载入愿望验收样本……</p>:null}
  </main>;
}
function FacetsReview() {
  const [fixture,setFixture]=useState<DevelopmentFacetsReviewFixture|null>(null),[selected,setSelected]=useState(''),[error,setError]=useState('');
  async function load() {
    setError('');
    try {
      const response=await fetch('/development-facets-review.json');
      if(!response.ok)throw Error();
      const value=readDevelopmentFacetsReview(await response.json());
      if(!value)throw Error();
      setFixture(value);setSelected(value.samples[0]!.id);
    } catch {setError('隔离验收样本暂时不可用，重新载入后再试。');}
  }
  useEffect(()=>{void load();},[]);
  const sample=fixture?.samples.find(value=>value.id===selected)??fixture?.samples[0];
  const counts=sample?facetsReviewCounts(sample):null;
  return <main className="development-review development-review--facets">
    <header><div><span className="development-review__eyebrow">聚形域 · 发展管线 03</span><h1>做过、喜欢、做得到</h1><p>同一段生活，分别留下兴趣、实际能力和对自己的暂时判断。</p></div><span className="development-review__badge">隔离样本 · 不写入正式生活</span></header>
    <nav aria-label="兴趣、能力与自评样本">{fixture?.samples.map(value=><button key={value.id} aria-pressed={sample?.id===value.id} onClick={()=>setSelected(value.id)}>{value.label}</button>)}</nav>
    {error?<p role="alert" className="development-review__error">{error}<button onClick={()=>void load()}>重试</button></p>:null}
    {sample&&counts?<>
      <section className="development-review__sample" aria-live="polite"><span className="development-review__eyebrow">这一段生活 · {sample.label}</span><h2>经历怎样影响判断</h2><p>{sample.summary}</p>{sample.restart_verified?<small>重复处理与重启已核对：仍读取同一份经历。</small>:null}</section>
      <div className="development-review__columns">
        <aside className="life-sidebar development-review__memory"><LivedMemory memory={sample.memory} actorId={sample.memory.owner_id} journal/></aside>
        <section className="development-review__direction"><span className="development-review__eyebrow">各自有依据</span><h2>把三个问题分开看</h2><p>听到消息可以带来接触。实际做过，才能进一步观察能力；自己愿意再做，才可能形成持续兴趣。</p>
          <div className="development-review__stat"><strong>{counts.actual}</strong><span>件共同的实际经历</span></div>
          <dl><div><dt>相关接触</dt><dd>{counts.contact} 条</dd></div><div><dt>核验做成</dt><dd>{counts.successful} 件</dd></div><div><dt>受条件影响</dt><dd>{counts.conditions} 件</dd></div><div><dt>操作待练习</dt><dd>{counts.performance} 件</dd></div><div><dt>角色愿望</dt><dd>{counts.ongoing?'出现持续倾向，尚未提出愿望':'尚未建立'}</dd></div><div><dt>外观与身份</dt><dd>保持当前形态</dd></div></dl>
          <p className="development-review__note">主人促成的实践也算真实经历。缺料、环境变化和操作失误分别保留，做成不直接等于喜欢。</p><p className="development-review__note">下一阶段会在这些依据上设计主动角色愿望，再通过实际试用判断是否合适。</p>
        </section>
      </div>
      <footer>隔离时钟：{new Date(sample.now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（样本时间） · 正式世界继续使用上海现实时间</footer>
    </>:!error?<p className="development-review__note">正在载入隔离验收样本……</p>:null}
  </main>;
}
function DevelopmentReview() {
  const [data,setData]=useState<Review|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(phase?:string) {
    setBusy(true);setError('');
    try {
      const response=await fetch(`${fixtureUrl}/api/life/development/review`,phase?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({phase})}:undefined);
      if(!response.ok)throw Error();
      const sample=await response.json() as Review;
      if(sample.simulated!==true||sample.live_world_untouched!==true||!sample.memory?.development)throw Error();
      setData(sample);
    } catch {setError('隔离样本尚未连接。先运行 scripts/review-development-evidence.mjs，再重试。');}
    finally {setBusy(false);}
  }
  useEffect(()=>{void load();},[]);
  const result=data?.memory.development?.recent.find(r=>r.source.task_id===data.task_id);
  const direction=data?.evolution.development.directions.find(d=>d.direction_id==='wetland_frog');
  const phase=data?.phase??'completed';
  return <main className="development-review">
    <header><div><span className="development-review__eyebrow">聚形域 · 发展管线 01</span><h1>选择，慢慢成为经历</h1><p>从主人一句建议，到自己考虑、实际动手，再留下可追溯的结果。</p></div><span className="development-review__badge">隔离样本 · 不写入正式生活</span></header>
    <nav aria-label="经历链路样本">{samples.map(([id,label])=><button key={id} disabled={busy} aria-pressed={phase===id} onClick={()=>void load(id)}>{label}</button>)}</nav>
    {error?<p role="alert" className="development-review__error">{error}<button onClick={()=>void load()}>重试</button></p>:null}
    {data?<>
      <section className="development-review__chain" aria-label="建议到结果">
        <article><span>01 · 前因</span><h2>主人提了一个想法</h2><p>有空整理一下苗床。</p><small>这时还没有实践结果。</small></article>
        <article><span>02 · 选择与行动</span><h2>{phase==='suggestion'?'留待自己考虑':'喵呜决定去照料'}</h2><p>{phase==='suggestion'?'结合需要、当前任务和材料，等下一次安排。':'沿用现有生活循环；预留一份清水，开始有耗时的照料。'}</p><small>样本使用有限规则选择；没有调用模型。</small></article>
        <article><span>03 · 实际结果</span><h2>{phase==='suggestion'?'尚未开始':phase==='executing'?'正在照料':phase==='failed'?'苗床变了，这次没办成':'照料完成，留下一个结果'}</h2><p>{phase==='failed'?'到期核验时，原有苗木已不在；保留失败原因，不推断讨厌照料。':result?'任务与记忆共享编号，方向观察读取同一件事。':'计划和开始都不会提前算成完成。'}</p><small>{data.restart_verified?'重复输入与重启后：仍是同一个结果。':'每次切换样本都会重新建立隔离世界。'}</small></article>
      </section>
      <div className="development-review__columns">
        <aside className="life-sidebar development-review__memory"><LivedMemory memory={data.memory} actorId={data.memory.owner_id} journal/></aside>
      <section className="development-review__direction"><span className="development-review__eyebrow">角色方向读取</span><h2>经历开始有了关联</h2><p>照料苗圃与“荷叶青蛙”方向相关，但只有做过，尚不能说明想成为它。</p><div className="development-review__stat"><strong>{direction?.root_outcome_ids.length??0}</strong><span>件相关的实际经历</span></div><dl><div><dt>做完</dt><dd>{direction?.counts.completed??0} 次</dd></div><div><dt>未办成</dt><dd>{direction?.counts.failed??0} 次</dd></div><div><dt>主人促成</dt><dd>{direction?.counts.owner_linked??0} 次</dd></div><div><dt>角色愿望</dt><dd>尚未提出</dd></div><div><dt>外观与身份</dt><dd>保持当前形态</dd></div></dl><p className="development-review__note">共同经历与生活供给已连接。现在分别观察兴趣、能力和自评，再为主动愿望与实际试用建立依据。</p>{result?<details><summary>同一件事的编号</summary><code>{result.root_outcome_id}</code><p>任务、记忆、项目或约定只是它的不同视角，不会叠加成多次实践。</p></details>:null}</section>
      </div>
      <footer>隔离时钟：{new Date(data.now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（样本时间） · 正式世界继续使用上海现实时间</footer>
    </>:<p className="development-review__note">正在连接隔离验收服务……</p>}
  </main>;
}
const root=import.meta.hot?.data.developmentReviewRoot??createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.developmentReviewRoot=root;
root.render(wishMode?<WishesReview/>:facetMode?<FacetsReview/>:<DevelopmentReview/>);
