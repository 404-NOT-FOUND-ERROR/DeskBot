import {useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TownMap} from './components/TownMap.tsx';
import {sceneReviewCast} from './deskbot/sceneShowcase.ts';
import {canonicalPointForLocation} from './deskbot/canonicalGeometry.ts';
import {mapToWorld} from '@shared/world.ts';
import {sceneTimePhaseAt} from './three/sceneLife.ts';
import type {DeskBotWorldMap,DeskBotEnvironment} from './deskbot/types.ts';
import fixtureData from './deskbot/windleafReviewFixtures.json';
import './styles.css';
import './deskbot/deskbot.css';
import './windleaf-review.css';
type Fixture={label:string;description:string;map:DeskBotWorldMap;at:string};
type Metrics={frames:number;p50_ms:number;p95_ms:number;draw_calls:number;triangles:number;geometries:number;textures:number};
type StoryEntry={id:string;epistemic:'authored_background'|'authored_viewpoint'|'hypothesis';source:{kind:string;reference:string;label:string};title:string;text:string;actor_id?:string;actor_name?:string};
type Story={location_id:string;entries:StoryEntry[];interpretation:string};
type WindTrace={active:boolean;intensity:number;formed_at:string;expires_at:string;weather_event_id:string};
type LeafInlay={active:boolean;installed_at:string;expires_at:string;strength:number};
const samples=(fixtureData as unknown as {samples:Record<string,Fixture>}).samples;
const TIMES=[['day','白天',840],['dusk','傍晚',1110],['midnight','午夜',90]] as const;
const WEATHER=[['clear','晴'],['wind','风'],['rain','雨']] as const;
const SITES=[['windleaf-edge','林缘'],['windleaf-lowland','留风树'],['windleaf-shelter','风口棚'],['windleaf-return-platform','归枝台'],['fog-lamp-square','旧夜灯 · 广场']] as const;
const WORLD_URL='/?mode=deskbot&deskbotUrl=http%3A%2F%2F127.0.0.1%3A4311';
function firstSample(){const id=new URLSearchParams(location.search).get('sample');return id==='live'||(id&&samples[id])?id:'installed';}
function percent(value:number|undefined){return typeof value==='number'?`${Math.round(value*100)}%`:'尚无记录';}
function Review(){
  const [sample,setSample]=useState(firstSample);
  const [lastReplay,setLastReplay]=useState(()=>sample==='live'?'installed':sample);
  const [live,setLive]=useState<DeskBotWorldMap|null>(null),[error,setError]=useState('');
  const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false);
  const [place,setPlace]=useState<string|null>(null),[focusRequest,setFocusRequest]=useState(1);
  const [detailObject,setDetailObject]=useState<string|null>(null);
  const [time,setTime]=useState('day'),[weather,setWeather]=useState('clear'),[metrics,setMetrics]=useState<Metrics|null>(null);
  const isLive=sample==='live';
  useEffect(()=>{const abort=new AbortController();setLoading(true);setError('');void fetch('http://127.0.0.1:4311/api/world/map',{signal:abort.signal,cache:'no-store'}).then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(setLive).catch(e=>{if(e.name!=='AbortError')setError(String(e));}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return ()=>abort.abort();},[refresh]);
  useEffect(()=>{const listener=(e:Event)=>setMetrics((e as CustomEvent<Metrics>).detail);window.addEventListener('deskbot-scene-metrics',listener);return ()=>window.removeEventListener('deskbot-scene-metrics',listener);},[]);
  const item=samples[isLive?lastReplay:sample]??samples.installed!,map=isLive?live:item.map;
  const minute=TIMES.find(t=>t[0]===time)?.[2]??840;
  const cast=useMemo(()=>map?sceneReviewCast(map,'actual',minute,false):null,[map,minute]);
  const environment:DeskBotEnvironment={schema:'deskbot.world-environment.v1',projected_at:new Date().toISOString(),time:{mode:'simulation',time_zone:'Asia/Shanghai',minute_of_day:minute,phase:sceneTimePhaseAt(minute).id,synced_at:null,lighting_convention:'fixed-local-dawn-dusk-v1'},weather:{status:'fresh',location:'独立画面预览',provider:'local-preview',condition:weather==='rain'?'雨':weather==='wind'?'风':'晴',observed_at:new Date().toISOString(),expires_at:new Date(Date.now()+3600000).toISOString(),temperature_c:20,wind_mps:weather==='wind'?12:weather==='rain'?8:1.5,precipitation:weather==='rain'?'rain':'none',cloud_cover:weather==='rain'?.8:.15,intensity:weather==='rain'?.7:0}};
  const labels=map?.locations.map(p=>{const point=p.presentation?.lot??canonicalPointForLocation(p),w=mapToWorld(point.x,point.y);return {id:p.location_id,label:p.name,x:w.x,z:w.z,height:8,kind:'landmark' as const};})??[];
  const rack=map?.objects?.find(o=>o.object_id==='windleaf-rack')?.state,frame=rack?.leaf_frames?.[0];
  const basin=map?.objects?.find(o=>o.object_id==='windleaf-rain-basin')?.state;
  const treeState=map?.objects?.find(o=>o.object_id==='windleaf-canopy')?.state;
  const trace=(treeState as (typeof treeState&{wind_trace?:WindTrace}))?.wind_trace;
  const nightLights=map?.objects?.find(o=>o.object_id==='square-noticeboard')?.state?.night_lanterns??[];
  const inlays=nightLights.flatMap(l=>{const inlay=(l as typeof l&{leaf_inlay?:LeafInlay}).leaf_inlay;return inlay?[inlay]:[];});
  const selectedPlace=map?.locations.find(p=>p.location_id===place);
  const focus=(id:string|null)=>{setPlace(id);setDetailObject(null);setFocusRequest(n=>n+1);};
  const inspect=()=>{const ids:Record<string,string>={'windleaf-edge':'windleaf-waymarker','windleaf-lowland':'windleaf-canopy','windleaf-shelter':'windleaf-rack','windleaf-return-platform':'windleaf-return-table','fog-lamp-square':'square-noticeboard'};if(place){setDetailObject(ids[place]??null);setFocusRequest(n=>n+1);}};
  const selectSample=(id:string)=>{setSample(id);if(id!=='live')setLastReplay(id);setMetrics(null);};
  const placeLabel=place?SITES.find(s=>s[0]===place)?.[1]??selectedPlace?.name??'聚落':'中央聚落与环绕地貌';
  const publicObjects=map?.objects?.filter(o=>map.areas?.some(a=>a.area_id===o.area_id&&a.location_id===(place??'windleaf-lowland')))??[];
  const storyEntries=[...new Map(publicObjects.flatMap(o=>((o.state as (typeof o.state&{place_story?:Story}))?.place_story?.entries??[])).map(e=>[e.id,e])).values()];
  const background=storyEntries.filter(e=>e.epistemic==='authored_background');
  const viewpoints=storyEntries.filter(e=>e.epistemic==='authored_viewpoint');
  const hypotheses=storyEntries.filter(e=>e.epistemic==='hypothesis');
  const entries=(items:StoryEntry[])=>items.map(e=><div key={e.id} className='windleaf-review__story-card'><p><strong>{e.actor_name?`${e.actor_name} · `:''}{e.title}</strong></p><p>{e.text}</p><small>{e.source.label}</small></div>);
  return <main className='deskbot-mode windleaf-review'>
    <header className='windleaf-review__header'><div className='windleaf-review__title'><span className='deskbot-mode__eyebrow'>THE SHAPING FIELD / 聚形域</span><h1>蜕壳原野</h1></div><p>灯火聚在中央，世界向四周生长。</p><a href={WORLD_URL}>回到喵呜的生活 <span aria-hidden='true'>↗</span></a></header>
    <div className='windleaf-review__layout'><div className='windleaf-review__world'>
      <nav className='windleaf-review__places' aria-label='查看空间'><button onClick={()=>focus(null)} aria-pressed={!place}>全景</button>{SITES.map(([id,label])=><button key={id} disabled={!map?.locations.some(p=>p.location_id===id)} aria-pressed={place===id} onClick={()=>focus(id)}>{label}</button>)}</nav>
      <section className='deskbot-mode__stage windleaf-review__stage' aria-label='聚形域运行场景'>
        {map&&cast?<TownMap sceneLocations={map.locations} labels={labels} environment={environment} activities={cast.activities} citizens={cast.citizens} positions={cast.positions} durations={new Map()} actions={new Map()} confidences={new Map()} focusedAction={null} onFocusAction={()=>{}} onPlaceClick={focus} focusLocationId={place} focusRequest={focusRequest} focusObjectId={detailObject}/>:<p className='windleaf-review__loading' role='status'>{error?'正式世界暂时无法读取，请检查服务后重试。':'正在读取世界…'}</p>}
        <div className='windleaf-review__caption'><span>{placeLabel}</span><strong>{isLive?'正式存档 · 只读':item.label}</strong><small>{isLive?'读取的物件状态 + 预览光照':'隔离执行回放 · 不写入正式世界'}</small></div>
      </section><div className='windleaf-review__world-note'><span>拖动平移 · 滚轮缩放 · Shift + 拖动旋转</span>{place&&<button className='windleaf-review__inspect' onClick={inspect}>近看物件</button>}<span>中心聚落 · 旧壳脊 / 折光湿地 / 风语林 / 星屑台地</span></div>
    </div><aside className='windleaf-review__panel' aria-label='场景核对'>
      <section className='windleaf-review__source'><div className='windleaf-review__section-heading'><span>01</span><h2>正在看什么</h2></div><div className='windleaf-review__modes' role='group' aria-label='世界数据来源'><button aria-pressed={!isLive} onClick={()=>selectSample(lastReplay)}>隔离回放</button><button aria-pressed={isLive} onClick={()=>selectSample('live')}>正式世界</button></div>
        {!isLive?<><label htmlFor='windleaf-sample'>生活阶段</label><select id='windleaf-sample' value={sample} onChange={e=>selectSample(e.target.value)}>{Object.entries(samples).map(([id,s])=><option key={id} value={id}>{s.label}</option>)}</select><p>{item.description}</p></>:<><p>只读取已保存的位置、活动和物件。光照预览不会推进时间或改变存档。</p><button className='windleaf-review__refresh' disabled={loading} onClick={()=>setRefresh(n=>n+1)}>{loading?'读取中…':'重新读取此刻'}</button>{error&&<p className='windleaf-review__error' role='alert'>读取失败。已有画面可能是上一次读取的状态。{error}</p>}</>}
      </section>
      <section><div className='windleaf-review__section-heading'><span>02</span><h2>换个天色看</h2></div><div className='windleaf-review__choices' role='group' aria-label='画面时间'>{TIMES.map(([id,label])=><button key={id} aria-pressed={time===id} onClick={()=>setTime(id)}>{label}</button>)}</div><div className='windleaf-review__choices' role='group' aria-label='画面天气'>{WEATHER.map(([id,label])=><button key={id} aria-pressed={weather===id} onClick={()=>setWeather(id)}>{label}</button>)}</div><small>预览光照、风和雨。物件的积水、磨损和纹路仍来自所选生活阶段。</small></section>
      <section><div className='windleaf-review__section-heading'><span>03</span><h2>物件留下的变化</h2></div><div className='windleaf-review__object-title'><h3>风口棚 · 光叶架</h3><button onClick={()=>focus('windleaf-shelter')}>靠近看</button></div>
        {frame?<dl><div><dt>遮片</dt><dd>{({open:'展开',half:'半合',closed:'合上'})[frame.shutter]}</dd></div><div><dt>朝向</dt><dd>{frame.exposure==='windward'?'迎风':'避风'}</dd></div><div><dt>布片完好</dt><dd>{percent(frame.condition)}</dd></div><div><dt>纹路</dt><dd>{percent(frame.pattern)}</dd></div><div><dt>修补</dt><dd>{frame.patches} 处</dd></div><div><dt>测记</dt><dd>{frame.read_count} 次</dd></div></dl>:<p className='windleaf-review__quiet'>现场尚未安置光叶架。</p>}
        <p className='windleaf-review__basin'>雨盆水位 <strong>{percent(basin?.water_level)}</strong><small>雨盆积水不会记入清水库存。</small></p>
        <div className='windleaf-review__connections'><button onClick={()=>focus('windleaf-lowland')}><span>留风树</span><strong>{trace?(trace.active?`余风折痕 ${percent(trace.intensity)}`:'此刻没有余风折痕'):'此阶段尚无风痕记录'}</strong></button><button onClick={()=>focus('fog-lamp-square')}><span>广场旧夜灯</span><strong>{nightLights.length?`${nightLights.length} 盏 · ${inlays.filter(i=>i.active).length} 份内衬生效`:'尚无居民安放的夜灯'}</strong></button></div>
      </section>
      <details className='windleaf-review__story'><summary>地方来历与此刻 <span>展开核对</span></summary><p className='windleaf-review__story-place'>{selectedPlace?.name??map?.locations.find(p=>p.location_id==='windleaf-lowland')?.name??'风语林'}</p>
        <div className='windleaf-review__story-entry'><span>作者背景</span>{background.length?entries(background):<p>{selectedPlace?.description??map?.locations.find(p=>p.location_id==='windleaf-lowland')?.description??'该生活阶段尚无此地的背景条目。'}</p>}<small>地点内容设定；不代表居民已亲历。</small></div>
        <div className='windleaf-review__story-entry'><span>居民的初始取舍</span>{viewpoints.length?entries(viewpoints):<p>该生活阶段没有居民立场条目。</p>}<small>作者给居民的初始倾向，尚不是实际说过的话。</small></div>
        {hypotheses.length>0&&<div className='windleaf-review__story-entry'><span>尚未证实的说法</span>{entries(hypotheses)}<small>保留为假说；不能当作已发现的历史。</small></div>}
        <div className='windleaf-review__story-entry'><span>真实状态</span>{publicObjects.some(o=>o.status_text)?publicObjects.filter(o=>o.status_text).map(o=><p key={o.object_id}><strong>{o.name}</strong> · {o.status_text}</p>):<p>尚无公开的物件状态描述。</p>}<small>{isLive?'来自读取的正式世界。':'来自当前隔离回放。'}光照按钮不会生成经历。</small></div>
      </details>
      <details className='windleaf-review__metrics'><summary>模型与运行测量 <span>开发核对</span></summary><p>静态物件合批，树冠实例化；动部件独立。场景使用实际几何。</p>{metrics?<dl><div><dt>帧间隔中位</dt><dd>{metrics.p50_ms.toFixed(1)} ms</dd></div><div><dt>帧间隔 P95</dt><dd>{metrics.p95_ms.toFixed(1)} ms</dd></div><div><dt>绘制调用</dt><dd>{metrics.draw_calls}</dd></div><div><dt>绘制三角形</dt><dd>{metrics.triangles}</dd></div><div><dt>活跃几何</dt><dd>{metrics.geometries}</dd></div><div><dt>纹理</dt><dd>{metrics.textures}</dd></div></dl>:<p>地址加 sceneMetrics=1 并保持页面可见即可采样；未测量时不显示估算帧率。</p>}</details>
    </aside></div>
  </main>;
}
const root=import.meta.hot?.data.windleafRoot??createRoot(document.getElementById('root')!);if(import.meta.hot)import.meta.hot.data.windleafRoot=root;root.render(<Review/>);
