import {useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TownMap} from './components/TownMap';
import {sceneReviewCast} from './deskbot/sceneShowcase';
import {WaylightState} from './deskbot/WaylightLife';
import type {DeskBotWorldMap} from './deskbot/types';
import './styles.css';
import './deskbot/deskbot.css';
import './waylight-review.css';
type Frame={id:string;title:string;detail:string;at:string;map:DeskBotWorldMap};
function Review(){
  const [frames,setFrames]=useState<Frame[]>([]),[error,setError]=useState(''),[index,setIndex]=useState(0),[wide,setWide]=useState(false);
  useEffect(()=>{const controller=new AbortController();fetch('/waylight-review.json',{signal:controller.signal}).then(r=>{if(!r.ok)throw Error(`演示读取失败 ${r.status}`);return r.json();}).then(data=>setFrames(data.frames)).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[]);
  const item=frames[index],map=item?.map;
  const cast=useMemo(()=>map?sceneReviewCast(map,'actual',map.environment?.time.minute_of_day??720):null,[map]);
  const lamp=map?.objects?.find(o=>o.object_id==='floating-frame')?.state?.waylight??null;
  return <main className='deskbot-mode waylight-review'>
    <header><div><span className='deskbot-mode__eyebrow'>THE SHAPING FIELD · R2</span><h1>水岸归途灯</h1><p>林间采来的两片光叶，后来成了回来取水的理由。</p></div><a href='/?mode=deskbot&deskbotUrl=http%3A%2F%2F127.0.0.1%3A4311'>回到正式生活 ↗</a></header>
    <p className='waylight-review__notice'>隔离规则演示 · 五个实际结算的时刻 · 零模型调用。演示起点明确提供两片光叶；没有修改正式人生，也不是自然跨日观察。</p>
    <nav aria-label='归途灯的生活片段'>{frames.map((frame,i)=><button type='button' key={frame.id} aria-pressed={i===index} onClick={()=>setIndex(i)}><small>0{i+1}</small>{frame.title}</button>)}</nav>
    {error?<p role='alert'>{error}</p>:!map||!cast?<p role='status'>正在打开生活片段…</p>:<div className='waylight-review__layout'>
      <section className='waylight-review__scene' aria-label='归途灯实态画面'><TownMap citizens={cast.citizens} sceneLocations={map.locations} environment={map.environment} activities={cast.activities} positions={cast.positions}
        focusObjectId={wide?null:'floating-frame'} focusLocationId={wide?null:'echo-waterside'} focusRequest={index*2+(wide?1:0)+1}
        labels={[]} durations={new Map()} actions={new Map()} confidences={new Map()} focusedAction={null} onFocusAction={()=>{}}/>
        <button className='waylight-review__camera' type='button' onClick={()=>setWide(v=>!v)}>{wide?'靠近水岸':'看看整个伴生世界'}</button>
      </section>
      <aside><span className='deskbot-mode__eyebrow'>片段 {index+1} / {frames.length}</span><h2>{item!.title}</h2><p>{item!.detail}</p>
        <p className='waylight-review__time'>{new Date(item!.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})} · 实验时钟</p>
        <section className='waylight-review__readings'><WaylightState lamp={lamp}/></section>
        <h3>同一件事，留下不同余地</h3><p>敞亮的叶灯让刻线更清楚；多一片背水的罩，夜里耗光慢一些，水岸一侧也更暗。风雨、损耗和真实材料仍会限制下一次使用。</p>
        <details><summary>关于人物与实验</summary><p>这组片段执行了喵呜自行制作、安装和次日使用的路径。灯穗与苔团的合作、拒绝和延期由另外的社交合同测试验证；画面没有把作者设定当成已经发生的对话。</p><p>下一批还要比较真实认知、各种输入对选择的影响，之后再做自然多日观察。</p></details>
      </aside>
    </div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
