import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LivedMemory} from './deskbot/LivedMemory.tsx';
import type {DeskBotLivedMemory} from './deskbot/types.ts';
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
        <section className="development-review__direction"><span className="development-review__eyebrow">角色方向读取</span><h2>经历开始有了关联</h2><p>照料苗圃与“荷叶青蛙”方向相关，但只有做过，尚不能说明想成为它。</p><div className="development-review__stat"><strong>{direction?.root_outcome_ids.length??0}</strong><span>件相关的实际经历</span></div><dl><div><dt>做完</dt><dd>{direction?.counts.completed??0} 次</dd></div><div><dt>未办成</dt><dd>{direction?.counts.failed??0} 次</dd></div><div><dt>主人促成</dt><dd>{direction?.counts.owner_linked??0} 次</dd></div><div><dt>角色愿望</dt><dd>尚未提出</dd></div><div><dt>外观与身份</dt><dd>保持当前形态</dd></div></dl><p className="development-review__note">先连接经历，下一阶段稳住生活供给，再细分兴趣、能力与自评，逐步形成主动愿望和实际试用。</p>{result?<details><summary>同一件事的编号</summary><code>{result.root_outcome_id}</code><p>任务、记忆、项目或约定只是它的不同视角，不会叠加成多次实践。</p></details>:null}</section>
      </div>
      <footer>隔离时钟：{new Date(data.now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}（样本时间） · 正式世界继续使用上海现实时间</footer>
    </>:<p className="development-review__note">正在连接隔离验收服务……</p>}
  </main>;
}
const root=import.meta.hot?.data.developmentReviewRoot??createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.developmentReviewRoot=root;
root.render(<DevelopmentReview/>);
