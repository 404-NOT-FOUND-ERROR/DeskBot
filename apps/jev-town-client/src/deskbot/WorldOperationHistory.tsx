import {useEffect,useRef,useState} from 'react';
import type {RuntimeActor} from './worldObserver.ts';

type Trace={trace_id:string;kind:string;actor_id?:string;title?:string;status?:string;goal?:string;reason?:string|null;
  reason_code?:string|null;container?:string;resource?:string;before?:number;after?:number;task_id?:string;
  decision?:{source?:string}|null;wait_context?:{reason?:string;available_portions?:number;free_seats?:number}|null;
  wakeup?:{reason:string};inputs?:{container:string;resource:string;count:number}[];portions?:number;due_at?:string};
type Operation={operation_id:string;sequence:number;at:string;action:string;records:Trace[];replay_sequence:number};
type Page={schema:'deskbot.world-operation-page.v1';head_sequence:number;legacy_records:number;operations:Operation[];next_cursor:string|null};
const kinds:Record<string,string>={task_admitted:'开始活动',task_completed:'完成活动',task_failed:'活动受阻',task_cancelled:'活动停止',task_paused:'活动暂停',task_resumed:'继续活动',task_arrived:'走完一段路',reservation_held:'材料已预留',reservation_consumed:'材料已消耗',reservation_returned:'材料已归还',stock_changed:'库存变化',plan_changed:'安排变化',meal_wait:'等这一餐',model_choice:'选择进展',supply_promise:'正在准备补给',supply_promise_ended:'补给安排结束或暂停'};
const resources:Record<string,string>={rations:'饭食',water:'清水',light_fruit:'光果',moss:'鲜苔芽',raw_water:'原水',seeds:'种子'};
export function traceDescription(record:Trace) {
  if(record.kind==='meal_delivered')return `实际送到长桌 ${record.portions} 份饭食；用餐仍需预留并完成。`;
  if(record.kind==='meal_need_recorded')return '这一餐开始计入持续的需要顺序；计划更换不会清空顺序。';
  if(record.kind==='stock_changed')return `${resources[record.resource??'']??record.resource}：${Number(record.before?.toFixed(2))} → ${Number(record.after?.toFixed(2))}（本次净变化）`;
  if(record.wakeup)return `${record.title??'等饭'}：已有饭食和座位，提前结束等待。`;
  if(record.kind==='meal_wait'&&record.wait_context)return `${record.wait_context.reason??record.reason??'还在等饭'} · 当前 ${record.wait_context.available_portions??0} 份饭，${record.wait_context.free_seats??0} 个空位`;
  if(record.inputs)return record.inputs.map(i=>`${resources[i.resource]??i.resource} × ${i.count}`).join('、');
  return [record.title??record.goal,record.reason].filter(Boolean).join(' · ')||record.status||'状态已记录';
}

export function WorldOperationHistory({baseUrl,actors}:{baseUrl:string;actors:RuntimeActor[]}) {
  const [page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[verified,setVerified]=useState<Record<string,string>>({});
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  async function read(path:string) {
    request.current?.abort();const controller=new AbortController();request.current=controller;
    const timer=setTimeout(()=>controller.abort(),10000);
    try{const r=await fetch(`${baseUrl.replace(/\/+$/,'')}${path}`,{cache:'no-store',signal:controller.signal});const data=await r.json();if(!r.ok)throw Error(data.message??`HTTP ${r.status}`);return data;}
    finally{clearTimeout(timer);}
  }
  async function load(cursor?:string|null) {
    const id=++generation.current;setBusy(true);setError('');
    try{const data=await read(`/api/world/operations?order=desc&limit=12${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`) as Page;
      if(data.schema!=='deskbot.world-operation-page.v1'||!Array.isArray(data.operations))throw Error('生活轨迹格式不完整。');
      if(id===generation.current){setPage(data);setVerified({});}
    }catch(e){if(id===generation.current)setError(e instanceof Error?e.message:'轨迹暂时无法读取。');}
    finally{if(id===generation.current)setBusy(false);}
  }
  async function verify(op:Operation) {
    const id=++generation.current;setBusy(true);setError('');
    try{const data=await read(`/api/world/replay?sequence=${op.replay_sequence}`);
      if(data.schema!=='deskbot.world-replay.v1'||data.sequence!==op.sequence||data.verified!==true||data.read_only!==true)throw Error('回放版本未通过校验。');
      if(id===generation.current)setVerified(v=>({...v,[op.operation_id]:`已从记录 ${data.checkpoint_sequence} 的锚点重建，经过 ${data.applied_records} 次变化，内容校验一致。当前生活未回退。`}));
    }catch(e){if(id===generation.current)setError(e instanceof Error?e.message:'回放核对失败。');}
    finally{if(id===generation.current)setBusy(false);}
  }
  return <section className="world-operation-history" aria-label="生活轨迹">
    <h3>生活轨迹</h3><p>看看安排为什么开始、在哪里受阻，材料去了哪里。这里读取历史，当前生活照常继续。</p>
    <button type="button" disabled={busy} onClick={()=>void load()}>查看最近记录</button>
    {error&&<p role="alert">{error}</p>}
    {page&&<><p>本页固定在记录 {page.head_sequence}。{page.legacy_records>0?`此前 ${page.legacy_records} 条旧审计记录保留，未冒充可校验回放。`:''}</p>
      {!page.operations.length&&<p>这一版还没有新的生活轨迹，等下一次实际变化后再看。</p>}
      <ol>{page.operations.map(op=><li key={op.operation_id}><details>
        <summary>{new Date(op.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})} · {op.records.find(r=>r.title)?.title??(op.records.some(r=>r.kind==='stock_changed')?'环境与库存变化':'世界时钟与状态')} · {op.records.length} 项记录</summary>
        <ul>{op.records.map(r=><li key={r.trace_id}><strong>{r.actor_id?`${actors.find(a=>a.actor_id===r.actor_id)?.display_name??r.actor_id} · `:''}{({meal_need_recorded:'用餐需要',meal_delivered:'饭食送达'} as Record<string,string>)[r.kind]??kinds[r.kind]??r.kind}</strong><span>{traceDescription(r)}</span></li>)}</ul>
        <button type="button" disabled={busy} onClick={()=>void verify(op)}>核对这一刻的存档</button>
        {verified[op.operation_id]&&<p role="status">{verified[op.operation_id]}</p>}
      </details></li>)}</ol>
      {page.next_cursor&&<button type="button" disabled={busy} onClick={()=>void load(page.next_cursor)}>更早的记录</button>}
    </>}
    {busy&&<p role="status">正在读取与核对…</p>}
  </section>;
}
