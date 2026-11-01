import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import './r3-review.css';
type Lamp={mode:string;charge:number;brightness:number;use_count:number;has_hood:boolean};
type Turn={turn:number;at:string;op:string;activity:string|null;reason:string;followup:{status?:string;question?:string;reason?:string}|null;
  tasks:{id:string;title:string;activity:string;status:string;result:string|null}[];inputs:{id:string;category:string;name:string;text:string}[];
  before:{lamp:Lamp};after:{lamp:Lamp}|null;latency_ms:number|null;truncated:boolean;audit:{verdict?:string;note?:string;critical?:boolean}|null};
type Episode={key:string;id:string;group:string;repeat:number;on:boolean;actor:string;arm:string;error:string|null;turns:Turn[]};
type Report={version:string;status:string;scope:string;limitations:string[];gates:{id:string;title:string;status:string;value:string;note:string}[];
  counts:{episodes:number;errors:number;persona:number};usage:{calls:number;upper_cny:number;round_p50_ms:number;round_p95_ms:number;prompt_tokens:number;completion_tokens:number;note:string};
  audit:{summary:string;reviewer:string}|null;episodes:Episode[];
  supplement:{findings:{title:string;text:string}[];interest:{title:string;actions:string;note:string}[];
    remediation:{title:string;text:string}[];cost:{calls:number;upper_cny:number;batches:{label:string;calls:number;upper_cny:number}[]}}|null};
type Revision={status:string;changes:string[];checks:string;experiment:string;boundary:string;
  batch?:{version:string;calls:number;upper_cny:number;completed_windows:number;cases:{title:string;result:string;note:string}[]}};
type Issue={followup_id?:string;question?:string;original_question?:string;status?:string;reason?:string;communication_evidence_id?:string;last_reviewed_at?:string;completion_target?:{title:string};completion_proofs?:{evidence_id:string}[];resolution?:{kind:string;reason:string};completed_steps?:{target:{title:string};reason:string;evidence_ids:string[]}[]};
type R3A={version:string;status:string;summary:string;completed_windows:number;observed_windows:number;planned_windows:number;repairs:number;
  deterministic_choice_windows?:number;
  assessment?:{meaningful_windows?:number;entered_windows?:number;first_adopted?:number;decision_windows?:number;rule?:string}|null;
  campaign_usage?:{calls:number;upper_cny:number;estimated_known_cny:number;unknown_reservation_cny:number;unknown_calls:number}|null;
  usage:{calls:number;cost_cny:number;input:number;output:number;unknown:number};stages:{stage:string;calls:number;input:number;output:number;cost_cny:number;p50_ms:number|null;p95_ms:number|null}[];
  window_p50_ms:number|null;window_p95_ms:number|null;replay:{summary:string;status:string}|null;
  local_revision?:{version:string;checks:string;changes:string[];real_retested:boolean}|null;
  findings:string[];limitations:string[];cases:{id:string;error:string|null;error_detail:string|null;stop_kind?:'budget'|'error'|'review'|null;elapsed_ms:number;note:string;
    turns:{turn:number;at:string;action:string;actual_text:string|null;feedback_pending?:boolean;reason?:string|null;delivered_message?:string|null;latency_ms:number|null;prior_issue:Issue|null;followup:Issue|null;
      decision_contact?:{kind:string;receiver_ids:string[]}|null;recollections?:{feeling:string;fact:string|null}[];
      result?:{communication?:{id:string;delivered:boolean;summary:string;disclosures:{kind:string;fields:{label:string}[]}[]}}|null;
      production_use?:{kind:string;target_stock:number;reason:string}|null;memory_anchor_checks?:{status:string}[];
      decision_issue?:{followup_decision:string;completion_target_id:string|null;followup_closure:{kind:string;reason:string}|null}|null;
      issues:{current:Issue|null;deferred:Issue[];closed:Issue[]}|null;audit:{verdict:string;note:string}|null}[]}[]};
const stageNames:Record<string,string>={perception:'感知',motivation:'动机与目标',decision:'行动选择',decision_repair:'选择修复',feedback:'结果反馈',memory:'记忆',compile:'意图编译',compile_repair:'编译修复',followup:'后续选择',followup_repair:'后续修复',directive:'来源折射等指令'};
const issueStatus=(f:Issue)=>f.resolution?({resolved:'具体目标已完成',satisfied:'个人收束',abandoned:'明确放下'}[f.resolution.kind]??f.resolution.kind):({continue:'继续惦记',postpone:'暂缓',none:'暂无新后续',drop:'已收束'}[f.status??'']??'等待复查');
function IssueView({issue}:{issue:Issue}){return <div className="followup"><b>{issueStatus(issue)}</b><p>{issue.original_question??issue.question}</p>
  {issue.question&&issue.original_question&&issue.question!==issue.original_question&&<p>这次打算：{issue.question}</p>}
  {issue.reason&&<p>{issue.communication_evidence_id?'送达记录的事实依据':'它给出的理由'}：{issue.reason}</p>}
  {!!issue.completed_steps?.length&&<details><summary>已经做成的 {issue.completed_steps.length} 个步骤</summary>{issue.completed_steps.map((s,i)=><p key={i}><b>{s.target.title}</b> · {s.reason}<br/><small>执行证据：{s.evidence_ids.join('、')}</small></p>)}</details>}
  {issue.completion_target&&<p>绑定的小目标：{issue.completion_target.title}{!!issue.completion_proofs?.length?'（已有对应执行证据）':''}</p>}<small>事项 {issue.followup_id??'尚未绑定'}{issue.last_reviewed_at?` · 上次复查 ${new Date(issue.last_reviewed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`:''}</small>{issue.resolution&&<p>{issue.resolution.reason}</p>}</div>;}
function R3AView({data,historical=false}:{data:R3A;historical?:boolean}){return <section className="experiment" aria-label={historical?`R3-A 历史复验 ${data.version}`:'R3-A 当前冻结复验'}>
  <span className="badge">R3-A · {data.version} · 隔离样本</span><h2>{data.status}</h2><p>{data.summary}</p>
  <p>完成 {data.completed_windows} / 计划 {data.planned_windows} 个窗口；实际进入 {data.observed_windows} 个。{data.usage.calls} 次模型调用，含 {data.repairs} 次选择或合同修复；估算 ¥{data.usage.cost_cny.toFixed(3)}，未知用量 {data.usage.unknown} 次。</p>
  {data.campaign_usage&&<p>本轮连同请求失败批共 {data.campaign_usage.calls} 次请求；已知用量估算 ¥{data.campaign_usage.estimated_known_cny.toFixed(3)}，另保留未知用量预留 ¥{data.campaign_usage.unknown_reservation_cny.toFixed(3)}，合计上界 ¥{data.campaign_usage.upper_cny.toFixed(3)}。预留不是实际扣款。</p>}
  {!!data.deterministic_choice_windows&&<p>{data.deterministic_choice_windows} 个窗口采用单次角色选择，程序直接绑定执行；活动、用途与事项无需第二个模型重复编译。窗口完成数只说明执行链完整，生活连续性另看逐条审查。</p>}
  {data.assessment?.meaningful_windows!=null&&<p>逐条审查计入有效选择/推进 {data.assessment.meaningful_windows} / {data.assessment.entered_windows}；首答直接采用 {data.assessment.first_adopted} / {data.assessment.decision_windows}。{data.assessment.rule}</p>}
  {data.findings.map(f=><p key={f}>{f}</p>)}
  {data.local_revision&&<div className="actual"><b>实验后的本地修正 · {data.local_revision.version}</b><p>{data.local_revision.checks}</p><ul>{data.local_revision.changes.map(c=><li key={c}>{c}</li>)}</ul><p>{data.local_revision.real_retested?'已重新进行真实验证':'尚未追加真实模型复验；下面仍是原冻结版本的结果。'}</p></div>}
  <div className="pair">{data.cases.map(c=><article className="episode" key={c.id}><div className="episode-top"><b>{c.id.startsWith('resources')?(c.id.endsWith('-off')?'材料充足的对照':'缺材料时怎样接着生活'):(c.id.endsWith('-off')?'没有新增邀请的对照':'收到装罩邀请以后')}</b><small>{c.id}</small></div>
    <p>{c.note}</p>{c.error&&<p className="error">{c.stop_kind==='budget'?'已达本批调用上限，停止追加。最后一次行动已执行，后续反馈尚未采用；该窗口未计作完整完成。':c.stop_kind==='review'?`逐窗审阅停止：${c.error_detail??c.error} 这个窗口的执行与反馈已完成，但内容审查未通过；完成数和有效数分别记录。`:`本例停止：${c.error_detail??c.error}。失败窗口保留，未计作完成。`}</p>}
    {c.turns.map(t=><section className="turn" key={t.turn}><div className="turn-number">0{t.turn}<span>{new Date(t.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · 实验时间</span></div>
      <h3>{t.action}</h3><div className="actual">{t.actual_text??'这一窗口没有已完成的物件结果。'}</div>
      {t.feedback_pending&&<p className="error">动作结果已保存，个人反馈尚未采用。此窗口未完成；恢复时应先处理原结果，不能重复执行动作。</p>}
      {t.audit&&<p className="audit">{t.audit.verdict} · {t.audit.note}</p>}
      {t.reason&&<details><summary>它为什么这样安排</summary><blockquote>{t.reason}</blockquote></details>}
      {t.delivered_message&&<details><summary>实际送达的留言原文</summary><p style={{whiteSpace:'pre-wrap'}}>{t.delivered_message}</p></details>}
      {t.result?.communication&&<details><summary>{t.result.communication.delivered?'送达凭据与公开内容':'未送达的记录'}</summary><p>{t.result.communication.summary}</p>{t.result.communication.disclosures.map((d,i)=><p key={i}>{d.kind==='result_extract'?'结果摘录':'完成通知'}：{d.fields.map(f=>f.label).join('、')}</p>)}<small>{t.result.communication.id}</small></details>}
      {t.production_use&&<p>这次生产的用途：{({reserve:'留存备用',self_use:'实际自用',accepted_delivery:'已接受的交付',experiment:'未完成的实验'} as Record<string,string>)[t.production_use.kind]}，目标总量 {t.production_use.target_stock}。{t.production_use.reason}</p>}
      {!!t.memory_anchor_checks?.length&&<p><small>记忆中的事实：{t.memory_anchor_checks.every(c=>c.status==='anchored')?'已与执行记录绑定，个人感受单独保留。':'有感受输出未通过校验，已省略；原始事实仍保留。'}</small></p>}
      {t.decision_contact&&<p>本人选择：{({message:'递送留言',reply:'回复镇内消息',invite:'提出正式邀请',respond:'回应约定'} as Record<string,string>)[t.decision_contact.kind]??t.decision_contact.kind} → {t.decision_contact.receiver_ids.map(id=>actors[id]??id).join('、')}</p>}
      {t.decision_issue&&<p>对原问题的选择：{({continue:'继续',postpone:'暂缓',new:'先做另一件事',none:'眼下无关联',drop:'明确收束'} as Record<string,string>)[t.decision_issue.followup_decision]??t.decision_issue.followup_decision}{t.decision_issue.completion_target_id?'；行动前选定了具体小目标':''}{t.decision_issue.followup_closure?`；${t.decision_issue.followup_closure.reason}`:''}。</p>}
      {!!t.recollections?.length&&<details><summary>它怎样记住这件事 · 个人理解需核对</summary>{t.recollections.map((m,i)=><div key={i}><blockquote style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{m.feeling}</blockquote><details><summary>对应事实原文</summary><p style={{overflowWrap:'anywhere'}}>{m.fact??'此片段未附事实原文，不将感受作为完成证据。'}</p></details></div>)}</details>}
      {t.followup&&<IssueView issue={t.followup}/>}
      {t.issues&&<details><summary>暂存 {t.issues.deferred.length} 项 · 历史收束 {t.issues.closed.length} 项</summary>{[...t.issues.deferred,...t.issues.closed].map((f,i)=><IssueView key={`${f.followup_id}:${i}`} issue={f}/>)}</details>}
      <small>窗口耗时 {sec(t.latency_ms)}</small></section>)}
    <p>本例总耗时 {sec(c.elapsed_ms)}（包含未完成部分）</p></article>)}</div>
  <details><summary>成本、延迟与缓存回放</summary><p>完整窗口中位 {sec(data.window_p50_ms)} / P95 {sec(data.window_p95_ms)}。输入 {data.usage.input.toLocaleString()} / 输出 {data.usage.output.toLocaleString()} tokens。</p>
    <div style={{overflowX:'auto'}}><table><thead><tr><th>阶段</th><th>调用</th><th>输入</th><th>输出</th><th>估算费用</th><th>中位 / P95</th></tr></thead><tbody>{data.stages.map(s=><tr key={s.stage}><td>{stageNames[s.stage]??s.stage}</td><td>{s.calls}</td><td>{s.input.toLocaleString()}</td><td>{s.output.toLocaleString()}</td><td>¥{s.cost_cny.toFixed(3)}</td><td>{sec(s.p50_ms)} / {sec(s.p95_ms)}</td></tr>)}</tbody></table></div>
    <p>{data.replay?.summary??'尚未完成同版本缓存回放'}</p></details>
  {data.limitations.map(l=><p key={l}><small>{l}</small></p>)}</section>;}
const names:Record<string,string>={weather:'风雨',advice:'主人建议',knowledge:'公开知识',invitation:'他者邀请',touch:'头部轻触',resources:'材料短缺',persona:'人物交换'};
const arms:Record<string,string>={cognition:'新认知',bounded:'旧模型选择',rules:'生活规则'};
const actors:Record<string,string>={'shaping-001':'喵呜','lamp-keeper-001':'灯穗','wetland-grower-001':'苔团'};
const sec=(n:number|null)=>n==null?'—':`${(n/1000).toFixed(1)} 秒`;
function LampReadings({before,after}:{before:Lamp;after:Lamp|null}){
  const l=after??before;
  return <dl className="lamp-readings"><div><dt>罩片</dt><dd>{l.has_hood?'已安装':'未安装'}</dd></div>
    <div><dt>亮度</dt><dd>{before.brightness.toFixed(2)} → {l.brightness.toFixed(2)}</dd></div>
    <div><dt>实际取水</dt><dd>{before.use_count} → {l.use_count} 次</dd></div></dl>;
}
function App(){
  const [data,setData]=useState<Report|null>(null),[error,setError]=useState(''),[group,setGroup]=useState('weather'),[arm,setArm]=useState('cognition'),[repeat,setRepeat]=useState(1);
  const [revision,setRevision]=useState<Revision|null>(null);
  const [r3a,setR3a]=useState<R3A|null>(null);
  const [r3aHistory,setR3aHistory]=useState<R3A[]>([]);
  useEffect(()=>{const controller=new AbortController();fetch('/r3-review.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error(`实验报告读取失败（${r.status}）`);return r.json();}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[]);
  useEffect(()=>{const controller=new AbortController();fetch('/r3-hardening.json',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(setRevision).catch(()=>{});return()=>controller.abort();},[]);
  useEffect(()=>{const controller=new AbortController();fetch('/r3a-review.json',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(setR3a).catch(()=>{});return()=>controller.abort();},[]);
  useEffect(()=>{const controller=new AbortController();Promise.all(['/r3a-first-screening.json','/r3a-repair-screening.json','/r3a-grounded-screening.json','/r3a-current-screening.json','/r3a-protocol-screening.json','/r3a-semantics-screening.json','/r3a-format-screening.json','/r3a-single-choice-screening.json','/r3a-catalogue-screening.json','/r3a-fields-screening.json','/r3a-feedback-screening.json','/r3a-phases-screening.json'].map(path=>fetch(path,{signal:controller.signal}).then(r=>r.ok?r.json():null).catch(()=>null))).then(rows=>setR3aHistory(rows.filter(Boolean)));return()=>controller.abort();},[]);
  const episodes=data?.episodes.filter(e=>e.group===group&&e.arm===arm&&e.repeat===repeat)??[];
  return <main>
    <header><div className="kicker">THE SHAPING FIELD / R3</div><h1>同一盏灯，不同来由</h1><p>它听到了什么，又真正做了什么？</p>
      <nav><a href="/?mode=deskbot&deskbotUrl=http%3A%2F%2F127.0.0.1%3A4311">回到正式生活 ↗</a><a href="/waylight-review.html">看看归途灯 ↗</a></nav></header>
    {r3a&&<R3AView data={r3a}/>}
    {!!r3aHistory.length&&<details><summary>此前 R3-A 失败记录 · 保留原版本与费用</summary>{r3aHistory.filter(h=>h.version!==r3a?.version).map(h=><R3AView key={h.version} data={h} historical/>)}</details>}
    {revision&&<section className="intro" aria-label="此前代码修正"><span className="badge">此前 R3 修正记录 · 保留历史结果</span>
      <h2>{revision.status}</h2><ul>{revision.changes.map(change=><li key={change}>{change}</li>)}</ul>
      <p>{revision.checks}</p><p>{revision.experiment}</p><p>{revision.boundary}</p>
    </section>}
    {revision?.batch&&<section className="findings" aria-label="本次小批实验">
      <h2>小批复验：保留进展，也保留失败</h2>
      <p>冻结版本 {revision.batch.version} · {revision.batch.calls} 次 API 调用 · 峰时价格估算 ¥{revision.batch.upper_cny.toFixed(3)} · {revision.batch.completed_windows} 个完整计划与结果窗口。实际账单未知。</p>
      <div>{revision.batch.cases.map(c=><article key={c.title}><h3>{c.title}</h3><b>{c.result}</b><p>{c.note}</p></article>)}</div>
      <p>后续修正只做了本地回归。下面仍保留更早的完整矩阵，不能当作最新版重新跑过。</p>
    </section>}
    {error?<p role="alert">{error}</p>:!data?<p role="status">正在读取隔离实验…</p>:<>
      <section className="intro"><span className="badge">{data.scope}</span><h2>{data.status}</h2><p>每例从实际做成的同一盏灯开始，允许接受建议、换个办法或暂缓。这里的实验跳时没有为正式人生补造经历。</p>
        {data.audit&&<p>{data.audit.summary}</p>}
      </section>
      <section className="gates" aria-label="验收进度">{data.gates.map(g=><article key={g.id} data-status={g.status}><span>{g.status==='pass'?'已通过':g.status==='fail'?'未通过':'待核验'}</span><h3>{g.title}</h3><strong>{g.value}</strong><p>{g.note}</p></article>)}</section>
      {data.supplement&&<section className="findings" aria-label="本轮发现"><h2>能接着生活，还没有足够的差异</h2><div>{data.supplement.findings.map(f=><article key={f.title}><h3>{f.title}</h3><p>{f.text}</p></article>)}</div></section>}
      <section className="experiment"><div className="section-heading"><div><span className="kicker">CHOICE → CONSEQUENCE → RETURN</span><h2>对照两条生活片段</h2></div><span>同一重复内成对查看</span></div>
        <div className="filters">
          <label>输入来源<select value={group} onChange={e=>{setGroup(e.target.value);setRepeat(1);if(e.target.value==='persona')setArm('cognition');}}>{Object.entries(names).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          <label>决策路径<select value={arm} onChange={e=>setArm(e.target.value)} disabled={group==='persona'}>{Object.entries(arms).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
          <label>重复<select value={repeat} onChange={e=>setRepeat(Number(e.target.value))}>{[1,2,...(group==='persona'?[]:[3])].map(n=><option key={n} value={n}>第 {n} 次</option>)}</select></label>
        </div>
        <div className="pair">{episodes.length===0?<p>这个组合尚无完成记录；不会用其他病例代替。</p>:episodes.map(e=><article className="episode" key={e.key}>
          <div className="episode-top"><span>{group==='persona'?actors[e.actor]:e.on?'加入这一项输入':'无这一项干预'}</span><small>{e.id}</small></div>
          {e.error&&<p className="error">本例未跑通：{e.error}。已保存失败，未计作成功。</p>}
          {e.turns.map(t=><section className="turn" key={t.turn}>
            <div className="turn-number">0{t.turn} <span>{new Date(t.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · 实验时间</span></div>
            {t.inputs.length>0&&<details><summary>这次实际收到 {t.inputs.length} 条来源</summary>{t.inputs.map(i=><p key={i.id}><b>{i.name}</b> · {i.category}<br/>{i.text}</p>)}</details>}
            {t.audit&&<p className="audit" data-critical={t.audit.critical}>{t.audit.verdict} · {t.audit.note}</p>}
            <h3>{t.tasks[0]?.title??t.activity??t.op}</h3><small>原样本的计划标题与理由；是否做到以实际结算为准</small><blockquote>{t.reason||'没有生成选择理由。'}</blockquote>
            <div className="actual"><b>实际结算</b>{t.tasks.length?t.tasks.map(task=><p key={task.id}>{task.status==='completed'?'✓':task.status} {task.result??task.title}</p>):<p>这一窗口没有完成物件任务。</p>}</div>
            <LampReadings before={t.before.lamp} after={t.after?.lamp??null}/>
            {t.followup&&<div className="followup"><b>模型提出的后续 · {t.followup.status}</b><p>{t.followup.question??t.followup.reason}</p><details><summary>查看它对结果的解释（可能出错）</summary><p>{t.followup.reason}</p></details></div>}
            <small>整轮等待 {sec(t.latency_ms)}{t.truncated?' · 已到实验推进上限，仍在进行':''}</small>
          </section>)}
        </article>)}</div>
      </section>
      {data.supplement&&<section className="findings"><h2>兴趣与修复复验</h2><p>四种兴趣前史由实验编排，两轮选择由真实模型完成；不代表自然生活了数周。</p><div>{data.supplement.interest.map(f=><article key={f.title}><h3>{f.title}</h3><b>{f.actions}</b><p>{f.note}</p></article>)}</div>{data.supplement.remediation.map(f=><p key={f.title}><b>{f.title}：</b>{f.text}</p>)}</section>}
      <section className="cost"><h2>首轮矩阵的历史用量{revision?'（不含本次修正批次）':''}</h2><div><p><b>{data.counts.episodes}</b> 主对照及人物病例</p><p><b>{data.supplement?.cost.calls??data.usage.calls}</b> 累计 API 调用</p><p><b>¥{(data.supplement?.cost.upper_cny??data.usage.upper_cny).toFixed(3)}</b> 全批次峰时价格估算</p><p><b>{sec(data.usage.round_p50_ms)}</b> 新认知一轮中位等待</p><p><b>{sec(data.usage.round_p95_ms)}</b> 新认知一轮 P95</p></div><p>{data.usage.note} 包含失败试跑和无效夹具批次；实际账单未知。这里的调用频率不能直接外推成全镇一天的开销。</p>
        {data.supplement&&<details><summary>各批次用量</summary>{data.supplement.cost.batches.map(b=><p key={b.label}>{b.label} · {b.calls} 次 · ¥{b.upper_cny.toFixed(3)}</p>)}</details>}</section>
      <footer><p>版本 {data.version} · {data.counts.errors} 条协议/执行异常；叙述错误另列</p>{data.audit&&<p>{data.audit.reviewer}</p>}{data.limitations.map(l=><p key={l}>{l}</p>)}</footer>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
