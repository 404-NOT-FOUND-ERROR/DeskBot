import type {DeskBotDevelopmentEvidence,DeskBotDevelopmentRecord} from './types.ts';

const topics:Record<string,string>={care:'照料',craft:'制作',repair:'修缮',cook:'做饭',explore:'观察小镇',connection:'与人相处'};
const outcomes:Record<string,string>={completed:'做完了',fulfilled:'约定已履行',failed:'遇到困难',missed:'约定未能履行',cancelled:'这次停下了',withdrawn:'约定已撤回',declined:'没有参加'};
const sourceNames:Record<string,string>={user:'关联主人输入',dialogue:'关联主人输入',body:'现实中的招呼',weather:'天气参考',external:'外界消息',agent:'其他居民或 agent 的提议'};
const count=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.floor(value):0;
function when(at:string) {
  return Number.isFinite(Date.parse(at))?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}):'时间未记全';
}
function title(record:DeskBotDevelopmentRecord) {
  if(record.title?.trim())return record.title;
  return record.effect.relationship?'一次实际来往':record.source.task_kind==='travel'?'走过一段路':record.topic?`${topics[record.topic]??'小镇生活'}的一件小事`:'一件实际做过的小事';
}
function cause(record:DeskBotDevelopmentRecord) {
  const sources=record.causes.sources.filter(source=>source.attested);
  if(sources.some(source=>source.category==='user'||source.category==='dialogue'))return '参考了主人这边的输入，再结合自己的安排作了选择。';
  if(record.causes.trigger==='invited')return '回应了一次邀约，后来是否办成要看实际结果。';
  if(record.causes.trigger==='own')return record.causes.decision?.source==='model'?'结合已有经历，自行选了下一件事。':'按当时的状态，自行安排了这件事。';
  if(sources.length)return `参考了${[...new Set(sources.map(source=>sourceNames[source.category]??'带来源的信息'))].join('、')}；前因仍按记录保留。`;
  return '这段经历的前因没有记全，暂不推断为什么选择。';
}
function Trail({record,journal}:{record:DeskBotDevelopmentRecord;journal:boolean}) {
  const result=outcomes[record.outcome]??'结果已记录';
  const recordedOnly=record.effect.completion_effect==='record_activity_only';
  return <details className={`life-development__trail life-development__trail--${record.outcome}`} open={journal||undefined}>
    <summary><span><strong>{title(record)}</strong><time>{when(record.at)}</time></span><span className="life-chip">{result}</span></summary>
    <ol className="life-development__steps" aria-label="前因、实践与结果">
      <li><span>前因</span><p>{cause(record)}</p></li>
      <li><span>{record.effect.relationship?'约定':record.effect.practice?'实践':recordedOnly&&record.topic==='explore'?'观察事实':'实际活动'}</span><p>{record.effect.relationship?'这次约定的结果已记录。':record.outcome==='completed'?recordedOnly?`记录了「${title(record)}」的活动结果。`:`实际做了「${title(record)}」。`:`曾尝试「${title(record)}」，这次${record.outcome==='cancelled'?'中途停下':'没有做完'}。`}</p></li>
      <li><span>结果</span><p>{record.failure?.reason||`${result}，保留这次经历，后续还可以再试。`}</p></li>
    </ol>
    {record.project_ids.length||record.views.project_stages.length?<p className="life-development__same">任务和项目记的是同一段经历，只计一次结果。</p>:null}
    <details className="life-development__source">
      <summary>查看这段经历的来路</summary>
      <dl><div><dt>共同经历编号</dt><dd>{record.root_outcome_id}</dd></div>
        {record.causes.plan_id?<div><dt>当时的安排</dt><dd>{record.causes.plan_id}</dd></div>:null}
        {record.causes.decision?<div><dt>选择方式</dt><dd>{record.causes.decision.source==='model'?'结合记忆的模型选择':record.causes.decision.source==='needs'?'眼前需要优先':record.causes.decision.source==='fallback'?'按当前可行安排继续':'生活规则中的选择'}</dd></div>:null}
        {record.causes.sources.map(source=><div key={`${source.record_id}:${source.event_id}`}><dt>{sourceNames[source.category]??'带来源的信息'}{source.attested?'':' · 来源未确认'}</dt><dd>{source.record_id||source.event_id}</dd></div>)}
        {record.source.task_id?<div><dt>实际任务</dt><dd>{record.source.task_id}</dd></div>:null}
        {record.source.commitment_id?<div><dt>实际约定</dt><dd>{record.source.commitment_id}</dd></div>:null}
        {record.views.project_stages.map(stage=><div key={`${stage.project_id}:${stage.stage_id}`}><dt>项目中的同一结果</dt><dd>{stage.project_id}{stage.stage_id?` · ${stage.stage_id}`:''}</dd></div>)}
      </dl>
      {record.historical_import?<p>来自既有结果；没有补写当时未记录的选择。</p>:null}
      {record.causes.trigger==='unknown'?<p>选择前因未记全，不把结果反推成主人要求或自己的愿望。</p>:null}
    </details>
  </details>;
}

export function DevelopmentEvidence({development,actorId,journal=false}:{development?:DeskBotDevelopmentEvidence|null;actorId:string;journal?:boolean}) {
  if(!development)return <p className="life-development__empty">还没有可追溯的实践结果，先把日子过起来。</p>;
  if(development.schema!=='deskbot.development-evidence.v1'||!Array.isArray(development.actors)||!Array.isArray(development.recent))return <p className="life-development__empty">实践记录暂时不可用，已有日记仍会保留。</p>;
  const actor=development.actors.find(entry=>entry.actor_id===actorId);
  if(!actor||!development.enabled)return <p className="life-development__empty">还没有可追溯的实践结果，先把日子过起来。</p>;
  const seen=new Set<string>();
  const records=development.recent.filter(record=>record.actor_ids.includes(actorId)).filter(record=>{
    if(seen.has(record.root_outcome_id))return false;seen.add(record.root_outcome_id);return true;
  }).slice(0,journal?4:2);
  const related=Object.entries(actor.topics).filter(([,topic])=>count(topic.practice)>0);
  return <div className="life-development" aria-label="兴趣相关实践与结果">
    <div className="life-development__counts"><span><strong>{count(actor.practice)}</strong>次实际实践</span><span><strong>{count(actor.relationship)}</strong>次约定结果</span></div>
    <p className="life-development__note">这些是保留的经历数量，愿望与能力还要靠后续实践看。</p>
    {!journal&&related.length?<div className="life-development__topics">{related.map(([topic,value])=><article key={topic}><div className="life-row"><strong>{topics[topic]??'小镇生活'}</strong><span>{count(value.practice)} 次实践</span></div><small>做完 {count(value.completed)} 次 · 遇到困难 {count(value.failed)} 次{count(value.cancelled)?` · 停下 ${count(value.cancelled)} 次`:''}</small></article>)}</div>:null}
    {records.length?<div className="life-development__trails"><h3>{journal?'选择之后，日子怎样接着走':'最近的一件小事'}</h3>{records.map(record=><Trail key={record.root_outcome_id} record={record} journal={journal}/>)}</div>:<p className="life-development__empty">新的实际结果会慢慢留下；收到建议还不算做过。</p>}
    {journal&&development.coverage.limitations.length?<details className="life-development__coverage"><summary>这些记录能说明什么</summary><ul>{development.coverage.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul><p>次数统计按保留的唯一经历计算，任务与项目的多个视角不会叠加。</p></details>:null}
  </div>;
}
