import {useEffect,useRef,useState} from 'react';
import {BodyStatus} from './BodyStatus.tsx';
import {BodyTurnDetail} from './BodyTurnDetail.tsx';
import {fetchBodyPerception,runBodyReviewRound} from './bodyBridge.ts';
import {BODY_REVIEW_SCENARIOS} from './bodyTypes.ts';
import type {BodyReviewScenarioId,DeskBotBodyPerception} from './bodyTypes.ts';
import './body-review.css';

type BodyReviewMode='simulation'|'live';
/** One feed owns its requests; replacing or stopping it invalidates late replies. */
export function createBodyReviewFeed({mode,baseUrl,onBody,onError,onBusy,onRound}:{mode:BodyReviewMode;baseUrl:string;onBody:(body:DeskBotBodyPerception|null)=>void;onError:(message:string)=>void;onBusy:(busy:boolean)=>void;onRound?:()=>void}) {
  let active=true,reading=false,submitting=false,request=0;
  const controller=new AbortController();
  const current=(ticket:number)=>active&&ticket===request;
  const publish=(next:DeskBotBodyPerception)=>{onBody(next);onError('');};
  async function read(initial=false){
    if(!active||reading||submitting)return;
    reading=true;const ticket=++request;
    if(initial)onBusy(true);
    try{const next=await fetchBodyPerception(baseUrl,controller.signal);if(current(ticket))publish(next);}
    catch(e){if(current(ticket)){onBody(null);onError(e instanceof Error?e.message:'状态暂时无法读取。');}}
    finally{reading=false;if(initial&&current(ticket))onBusy(false);}
  }
  async function run(scenario:BodyReviewScenarioId){
    if(!active||mode!=='simulation'||submitting)return;
    submitting=true;const ticket=++request;onBusy(true);onError('');
    try{const result=await runBodyReviewRound(baseUrl,scenario);if(current(ticket)){publish(result.body);onRound?.();}}
    catch(e){if(current(ticket))onError(e instanceof Error?e.message:'隔离回合暂时无法运行。');}
    finally{submitting=false;if(current(ticket))onBusy(false);}
  }
  void read(true);
  // The fixture POST returns dispatch first; subsequent reads reveal its delayed ACK.
  const timer=setInterval(()=>void read(),mode==='simulation'?1000:5000);
  return {run,stop(){active=false;request++;controller.abort();clearInterval(timer);}};
}

export function BodyReviewPanel({simulationUrl='http://127.0.0.1:4313',liveUrl='http://127.0.0.1:4311'}:{simulationUrl?:string;liveUrl?:string}) {
  const [mode,setMode]=useState<BodyReviewMode>('simulation'),[body,setBody]=useState<DeskBotBodyPerception|null>(null);
  const [scenario,setScenario]=useState<BodyReviewScenarioId>('head_touch'),[turnId,setTurnId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[readAt,setReadAt]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
  const feed=useRef<ReturnType<typeof createBodyReviewFeed>|null>(null);
  const baseUrl=mode==='simulation'?simulationUrl:liveUrl;
  useEffect(()=>{
    setBody(null);setTurnId(null);setError('');setReadAt(null);
    const next=createBodyReviewFeed({mode,baseUrl,onBody:value=>{setBody(value);setReadAt(value?new Date().toISOString():null);},onError:setError,onBusy:setBusy,onRound:()=>setTurnId(null)});
    feed.current=next;
    return ()=>{next.stop();if(feed.current===next)feed.current=null;};
  },[baseUrl,mode,refresh]);
  async function runScenario(){
    if(mode!=='simulation'||busy)return;
    await feed.current?.run(scenario);
  }
  function switchMode(nextMode:BodyReviewMode){
    if(nextMode===mode)return;
    // Invalidate synchronously, before the next effect, so a late fixture reply cannot appear as live data.
    feed.current?.stop();feed.current=null;
    setBody(null);setTurnId(null);setReadAt(null);setError('');setBusy(false);setMode(nextMode);
  }
  const turns=[...(body?.turns??[])].sort((a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at));
  const turn=turns.find(t=>t.turn_id===turnId)??turns[0];
  const selectedScenario=BODY_REVIEW_SCENARIOS.find(item=>item.id===scenario)!;
  return <main className="body-review"><div className="body-review__content">
    <header className="body-review__header"><div><span className="body-review__eyebrow">聚形域 · 身体感知</span><h1>一次触碰，怎样成为回应</h1><p>沿着输入、身体感受、表达意图和设备回执，看看喵呜怎样留意现实桌边。</p></div><a href={`/?mode=deskbot&deskbotUrl=${encodeURIComponent(liveUrl)}`}>回到雾灯镇 ↗</a></header>
    <div className="body-review__mode" aria-label="联调数据模式"><button aria-pressed={mode==='simulation'} onClick={()=>switchMode('simulation')}>独立模拟回合</button><button aria-pressed={mode==='live'} onClick={()=>switchMode('live')}>正式身体记录 · 只读</button></div>
    <p className="body-review__boundary">{mode==='simulation'?'这里的输入与回执来自隔离模拟服务。完成回合只代表程序链路完成，实机动作仍待设备联调。':'这里读取正式服务的身体记录。感知、期望反应、设备回执和实际角度分别呈现。'}</p>
    <section className="body-review__controls" aria-label={mode==='simulation'?'独立回合场景':'只读记录控制'}>
      {mode==='simulation'?<><label>这次从哪一种输入开始<select value={scenario} disabled={busy} onChange={e=>setScenario(e.target.value as BodyReviewScenarioId)}>{BODY_REVIEW_SCENARIOS.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><small>{selectedScenario.description}</small></label><button className="body-review__primary" disabled={busy} onClick={()=>void runScenario()}>{busy?'读取回合…':'运行隔离模拟回合'}</button></>:<><p>每 5 秒读取一次，设备输入继续由设备上报。</p><button disabled={busy} onClick={()=>setRefresh(value=>value+1)}>{busy?'正在读取…':'刷新身体记录'}</button></>}
      {turns.length>1?<label>查看哪一轮<select value={turn?.turn_id??''} onChange={e=>setTurnId(e.target.value)}>{turns.map(item=><option key={item.turn_id} value={item.turn_id}>{item.source_label} · {new Date(item.received_at).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</option>)}</select></label>:null}
    </section>
    {error?<p className="body-review__error" role="alert">{error}{mode==='simulation'?` · 独立模拟服务：${simulationUrl}`:''}</p>:null}
    {body?<><div className="body-review__row" style={{marginBottom:14}}><BodyStatus body={body}/>{readAt?<small>状态读取于 {new Date(readAt).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</small>:null}</div><BodyTurnDetail body={body} turn={turn} isolated={mode==='simulation'}/></>:<section className="body-review__stage"><p className="body-review__empty">{busy?'正在读取身体状态…':'等待连接到身体状态服务。'}</p></section>}
    <div className="body-review__footer"><section className="body-review__notes"><h2>身体能感知什么</h2><p>头部触摸、触屏、声源相对方向与外壳读数。身体只有左右转头的一个自由度。</p><ul><li>声源方向不代表知道说话者是谁。</li><li>没有摄像头，也没有现实移动能力。</li><li>转头完成回执是设备报告；开环角度仍未实测。</li></ul></section><section className="body-review__notes"><h2>壳的认识</h2><p>{body?.shell?.reason??'还没有收到可用于识别外壳的读数。'}</p>{body?.shell?.last_known_shell_id&&body.shell.status!=='recognized'?<small>上次识别记录：{body.shell.last_known_shell_id}，只作历史参考。</small>:null}<p><small>{mode==='simulation'?'隔离模拟服务':'正式只读服务'}：<code>{baseUrl}</code></small></p></section></div>
  </div></main>;
}
