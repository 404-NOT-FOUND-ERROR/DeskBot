// Read-only art review. Presets alter the renderer, never the service or its clock.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { TownMap } from "./components/TownMap.tsx";
import { mapToWorld } from "@shared/world.ts";
import { canonicalPointForLocation } from "./deskbot/canonicalGeometry.ts";
import { sceneReviewCast } from "./deskbot/sceneShowcase.ts";
import { sceneTimePhaseAt } from "./three/sceneLife.ts";
import type { DeskBotEnvironment, DeskBotWorldMap } from "./deskbot/types.ts";
import "./styles.css";
import "./deskbot/deskbot.css";
import "./scene-review.css";

const TIMES=[['dawn','晨光',375],['day','白昼',780],['dusk','傍晚',1095],['evening','入夜',1215],['late','深夜',1365],['midnight','午夜',90]] as const;
const PLACES=[['moss-sprout-garden','苔芽圃'],['echo-waterside','回声水岸'],['backlit-grove','逆光林地'],['whisper-market','低语集市'],['spare-parts-house','零件屋'],['warm-pot-courtyard','暖锅小院']] as const;
function Review() {
  const [map,setMap]=useState<DeskBotWorldMap>();
  const [error,setError]=useState('');
  const [time,setTime]=useState('dusk');
  const [weather,setWeather]=useState('clear');
  const [place,setPlace]=useState<string|null>('moss-sprout-garden');
  const [focusRequest,setFocusRequest]=useState(0);
  const [castMode,setCastMode]=useState<'actual'|'routine'|'gallery'>('routine');
  const [nightWork,setNightWork]=useState(false);
  const [sample,setSample]=useState('live');
  const [fixtures,setFixtures]=useState<{samples:Record<string,{label:string;description:string;map:DeskBotWorldMap}>}>();
  useEffect(()=>{void fetch('http://127.0.0.1:4311/api/world/map').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(setMap).catch(e=>setError(String(e)));},[]);
  useEffect(()=>{void fetch('/living-review-fixtures.json').then(r=>{if(!r.ok)throw Error(`回放样本 HTTP ${r.status}`);return r.json();}).then(setFixtures).catch(e=>setError(String(e)));},[]);
  const displayed=sample==='live'?map:fixtures?.samples[sample]?.map;
  const minute=TIMES.find(item=>item[0]===time)?.[2]??780;
  const cast=displayed?sceneReviewCast(displayed,castMode,minute,nightWork):undefined;
  const selected=displayed?.locations.find(location=>location.location_id===place);
  const observedAt=new Date().toISOString();
  const environment:DeskBotEnvironment={schema:'deskbot.world-environment.v1',projected_at:observedAt,
    time:{mode:'simulation',time_zone:'Asia/Shanghai',minute_of_day:minute,phase:sceneTimePhaseAt(minute).id,synced_at:null,lighting_convention:'fixed-local-dawn-dusk-v1'},
    weather:{status:'fresh',location:'场景预览',condition:weather==='rain'?'雨':weather==='wind'?'有风':'晴',provider:'local-preview',
      observed_at:observedAt,expires_at:new Date(Date.now()+3600000).toISOString(),temperature_c:20,
      wind_mps:weather==='wind'?12:weather==='rain'?6:1.5,precipitation:weather==='rain'?'rain':'none',cloud_cover:weather==='rain'?.82:weather==='wind'?.4:.12,intensity:weather==='rain'?.65:0}};
  function focus(id:string|null){setPlace(id);setFocusRequest(n=>n+1);}
  return <main className='deskbot-mode scene-review'>
    <header className='scene-review__header'><div><span className='deskbot-mode__eyebrow'>THE SHAPING FIELD · 场景工坊</span><h1>让日子看得见</h1><p>光粒凝成居民，灯火随日常渐亮、渐息。</p></div><div className='scene-review__notice'>独立美术预览<span>时间、天气与演示动作不写入正式世界</span></div></header>
    <div className='scene-review__toolbar'>
      <div role='group' aria-label='昼夜预览'>{TIMES.map(([id,label])=><button key={id} aria-pressed={time===id} onClick={()=>setTime(id)}>{label}</button>)}</div>
      <div role='group' aria-label='天气预览'>{[['clear','晴'],['rain','雨'],['wind','风']].map(([id,label])=><button key={id} aria-pressed={weather===id} onClick={()=>setWeather(id!)}>{label}</button>)}</div>
      <div role='group' aria-label='居民预览'><button aria-pressed={castMode==='actual'} onClick={()=>setCastMode('actual')}>实际活动</button><button aria-pressed={castMode==='routine'} onClick={()=>setCastMode('routine')}>动作演示</button><button aria-pressed={castMode==='gallery'} onClick={()=>{setCastMode('gallery');focus(cast?.squareId??'fog-lamp-square');}}>居民近景</button><button aria-pressed={nightWork&&castMode==="routine"} onClick={()=>{setCastMode("routine");setTime("midnight");focus("warm-pot-courtyard");setNightWork(v=>!v);}}>夜间炉火</button></div>
    </div>
    <div className='scene-review__places' role='group' aria-label='查看地点'>{PLACES.map(([id,label])=><button key={id} aria-pressed={place===id} onClick={()=>focus(id)}>{label}</button>)}<button onClick={()=>focus(null)}>解除聚焦</button></div>
    {error?<p role='alert'>{error}</p>:null}
    <section className='deskbot-mode__stage scene-review__stage'>
      {displayed&&cast?<TownMap citizens={cast.citizens} labels={displayed.locations.map(p=>{const point=p.presentation?.lot??canonicalPointForLocation(p),w=mapToWorld(point.x,point.y);return {id:p.location_id,label:p.name,x:w.x,z:w.z,height:8,kind:'landmark'};})}
        sceneLocations={displayed.locations} environment={environment} activities={cast.activities} focusLocationId={place} focusRequest={focusRequest} positions={cast.positions} durations={new Map()} actions={new Map()} confidences={new Map()} focusedAction={null} onFocusAction={()=>{}} onPlaceClick={focus}/>:<p>正在搭建聚形域…</p>}
      <div className='scene-review__caption' aria-label='场景预览说明'><span>{sceneTimePhaseAt(minute).label} · {String(Math.floor(minute/60)).padStart(2,'0')}:{String(minute%60).padStart(2,'0')}</span><strong>{castMode==='gallery'?'十三位光粒居民':selected?.name??'雾灯镇'}</strong><p>{sceneTimePhaseAt(minute).detail}</p><small>{castMode==='actual'?'任务来自实际存档；画面时间为预览':castMode==='gallery'?'造型陈列，不代表发生了聚会':'动作编排演示，不代表实际活动结果'}</small></div>
    </section>
    <details className='scene-review__rules'><summary>持续设施状态回放</summary><p>设施读数来自选定存档；光粒、动作与灯光是它的视觉表达。</p><div><button aria-pressed={sample==='live'} onClick={()=>setSample('live')}>实际存档状态</button>{Object.entries(fixtures?.samples??{}).map(([id,value])=><button key={id} aria-pressed={sample===id} onClick={()=>setSample(id)}>{value.label}</button>)}</div><p>{sample==='live'?'读取实际持久状态。':fixtures?.samples[sample]?.description}</p>{selected?.areas?.flatMap(a=>a.objects??[]).filter(o=>o.state).map(o=><p key={o.object_id}>{o.name}：{o.status_text}</p>)}</details>
  </main>;
}
const reviewRoot=import.meta.hot?.data.reviewRoot??createRoot(document.getElementById('root')!);
if(import.meta.hot)import.meta.hot.data.reviewRoot=reviewRoot;
reviewRoot.render(<Review/>);
