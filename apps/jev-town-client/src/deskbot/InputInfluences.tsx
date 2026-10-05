import type {DeskBotRefraction} from './types.ts';
const stateNames:Record<string,string>={pending:'先记下',deferred:'暂缓',chosen:'已纳入安排',completed:'安排已完成',failed:'未办成',cancelled:'已取消',expired:'参考已过期',observed:'收到消息',record_only:'仅作记录'};
const sourceNames:Record<string,string>={connected:'已接通',configured:'已配置，待验证',error:'连接暂不可用',disabled:'未开启',fresh:'最近已刷新',stale:'参考过期',unavailable:'等待首条消息',awaiting_device:'等待设备上报',recent_report:'最近有上报',not_configured:'尚未配置',has_source_records:'已有来源记录'};
export function InputInfluences({inputs,busy=false,onSuggest,journal=false,replay=false}:{inputs:DeskBotRefraction|null|undefined;busy?:boolean;onSuggest?:(id:string)=>void;journal?:boolean;replay?:boolean}) {
  if(!inputs)return null;
  const eligible=inputs.records.filter(r=>r.attested),waiting=eligible.filter(r=>['pending','deferred','chosen'].includes(r.status));
  const latestKinds=['weather','sourced_report','environment_reference'].map(kind=>eligible.filter(r=>r.category===kind||r.meaning===kind).slice(-1)[0]).filter((r):r is DeskBotRefraction['records'][number]=>Boolean(r));
  const picked=[...waiting.slice(-1),...latestKinds,...eligible.slice(-1)];
  const records=journal?eligible.slice(-8).reverse():picked.filter((r,i)=>picked.findIndex(other=>other.id===r.id)===i).reverse();
  return <section className="life-block life-inputs" aria-label={journal?'消息与建议的去向':'现实带来的小事'}>
    <div className="life-row"><h2>{journal?'消息与建议的去向':'现实带来的小事'}</h2><small>{journal?'有出处，才有后续':'先听见，再考虑'}</small></div>
    {!journal?<><p className="life-inputs__intro">可以提个想法。喵呜会等手头的事结束，结合状态再安排。</p>{onSuggest&&!replay?<details className="life-inputs__suggest"><summary>给喵呜一个生活建议</summary><div className="life-inputs__choices">{inputs.suggestions.map(s=><button key={s.id} disabled={busy} onClick={()=>onSuggest(s.id)}>{s.title}</button>)}</div></details>:null}</>:null}
    {records.map(r=><article className="life-input" key={r.id}>
      <div className="life-row"><span>{r.source_label}</span><small>{stateNames[r.status]??r.status}</small></div>
      <p>{r.meaning==='sourced_report'&&r.text?r.text:r.category==='weather'&&r.status==='observed'&&!r.decisions.length?'收到上海的新天气观测，出门和照料时会参考。':r.last_note}</p>
      <details><summary>这件小事从哪里来</summary><p>{r.category==='weather'?'上海的天气观测，有效时用于出行与照料。':r.text||r.summary}</p>{r.original_text&&r.original_text!==r.text?<p>原标题：{r.original_text}</p>:null}<small>{new Date(r.observed_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 接收 · {r.meaning==='user_account'?'用户提供的信息，尚未核实':r.meaning==='sourced_report'?'来源报道，尚未亲历':r.meaning==='environment_reference'?'区域模型数据':'输入参考'}</small>{r.published_at?<small>{new Date(r.published_at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} 发布</small>:null}{r.source_url&&/^https?:\/\//.test(r.source_url)?<a href={r.source_url} target="_blank" rel="noreferrer">查看消息出处 ↗</a>:null}{r.decisions.length?<ol>{r.decisions.map((d,i)=><li key={i}>{d.reason}</li>)}</ol>:null}</details>
    </article>)}
    {!records.length?<p className="life-empty">还没有新的消息。小镇照常生活。</p>:null}
    {!journal?<details className="life-inputs__sources"><summary>看看正在接收什么</summary><ul>{inputs.source_status.map(s=><li key={s.id}><span>{s.name}</span><span>{sourceNames[s.status]??s.status}</span></li>)}</ul></details>:null}
  </section>;
}
