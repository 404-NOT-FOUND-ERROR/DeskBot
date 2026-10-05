import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Citizen} from '@shared/citizens.ts';
import type {Action} from '@shared/actions.ts';
import {mapToWorld} from '@shared/world.ts';
import {TownMap} from './components/TownMap.tsx';
import {canonicalPointForLocation} from './deskbot/canonicalGeometry.ts';
import {projectSceneActivities} from './deskbot/activityProjection.ts';
import {LifeSidebar} from './deskbot/LifeSidebar.tsx';
import type {DeskBotWorldMap} from './deskbot/types.ts';
import './styles.css';
import './deskbot/deskbot.css';
function Review(){
 const [data,setData]=useState<{description:string;frames:Record<string,{label:string;map:DeskBotWorldMap}>}>(),[frame,setFrame]=useState('begin'),[error,setError]=useState(''),[place,setPlace]=useState<string|null>(null),[npcId,setNpcId]=useState<string|null>(null),[focusRequest,setFocusRequest]=useState(0);
 const [sample]=useState(()=>new URLSearchParams(location.search).get('sample'));
 useEffect(()=>{const file=sample==='memory'?'/memory-review-fixtures.json':sample==='inputs'?'/input-review-fixtures.json':sample==='supply'?'/supply-review-fixtures.json':'/life-review-fixtures.json';void fetch(file).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(setData).catch(e=>setError(String(e)));},[sample]);
 const focus=(id:string|null)=>{setPlace(id);setFocusRequest(n=>n+1);};
 const current=data?.frames[frame],map=current?.map,people=map?.autonomy?.actors??[],npc=map?.npcs.find(n=>n.npc_id===(npcId??map.npcs[0]?.npc_id));
 const selected=map?.locations.find(l=>l.location_id===(place??map.protagonist.location_id));
 const environment=map?.environment?{...map.environment,time:{...map.environment.time,mode:'simulation'}}:undefined;
 const citizens:Citizen[]=people.map((p,index)=>{const resident=map!.npcs.find(n=>n.npc_id===p.actor_id);return {id:index+1,name:p.display_name,role:resident?.role_label??'喵呜',personality:p.plan?.reason??'',homeId:'cottage_north',workId:'market',palette:resident?.palette??4,residentStyle:resident?.resident_version?resident.npc_id:p.actor_id===map?.protagonist.character_id?'shaping-001':undefined,leaning:{}};});
 const activities=projectSceneActivities(map).map(activity=>({...activity,citizenId:people.findIndex(p=>p.actor_id===activity.actorId)+1,realTime:false}));
 const positions=new Map(people.map((p,index)=>{const at=map!.locations.find(l=>l.location_id===p.location_id)!,point=canonicalPointForLocation(at),peers=people.filter(a=>a.location_id===p.location_id),rank=peers.findIndex(a=>a.actor_id===p.actor_id),angle=rank/peers.length*Math.PI*2;return [index+1,{x:point.x+Math.cos(angle)*3,y:point.y+Math.sin(angle)*3}];}));
 return <main className="deskbot-mode"><header style={{fontSize:12}}><h1 style={{fontSize:23,margin:'0 0 8px'}}>{sample==='supply'?'雾灯镇 · 十三人的日常供给':'雾灯镇 · 生活与来往回放'}</h1><p style={{margin:'5px 0 10px',color:'#80936d'}}>{data?.description??'读取独立回放…'}</p>{sample==='supply'?<p style={{margin:'5px 0 10px',fontSize:11,color:'#8b997f'}}>隔离世界中的实际规则推演与存档快照；不代表正式世界已经经过这些天。</p>:null}<div style={{display:'flex',flexWrap:'wrap',gap:6}}>{Object.entries(data?.frames??{}).map(([id,value])=><button key={id} aria-pressed={id===frame} onClick={()=>setFrame(id)} style={{fontSize:11,padding:'7px 9px'}}>{value.label}</button>)}<button style={{fontSize:11}} onClick={()=>focus('moss-sprout-garden')}>查看苗圃</button>{sample==='supply'?<><button style={{fontSize:11}} onClick={()=>focus('backlit-grove')}>查看林缘</button><button style={{fontSize:11}} onClick={()=>focus('warm-pot-courtyard')}>查看厨房</button><button style={{fontSize:11}} onClick={()=>focus('whole-town')}>查看全镇</button></>:null}<button style={{fontSize:11}} onClick={()=>focus(null)}>跟随喵呜</button></div></header>
 {error?<p>{error}</p>:null}{map?<div className="deskbot-mode__grid" style={{marginTop:16}}>
 <section className="deskbot-mode__stage" style={{height:'calc(100dvh - 180px)',minHeight:520}}><TownMap citizens={citizens} positions={positions} labels={map.locations.map(p=>{const point=p.presentation?.lot??canonicalPointForLocation(p),w=mapToWorld(point.x,point.y);return {id:p.location_id,label:p.name,x:w.x,z:w.z,height:8,kind:'landmark'};})} sceneLocations={map.locations} environment={environment} activities={activities} focusLocationId={place==='whole-town'?null:place??map.protagonist.location_id} focusRequest={focusRequest} durations={new Map()} actions={new Map(citizens.map(c=>[c.id,null as Action|null]))} confidences={new Map()} focusedAction={null} onFocusAction={()=>{}} onPlaceClick={focus} onCitizenClick={id=>{const p=people[id-1];if(p)setNpcId(p.actor_id);}}/>
 <div className="review-sample-label">{map.logical_time.date} · {Math.floor(map.logical_time.minute_of_day/60)}:{String(map.logical_time.minute_of_day%60).padStart(2,'0')}<br/>{current?.label} · 独立规则存档
 {selected?.areas?.flatMap(a=>a.objects??[]).filter(o=>o.state).map(o=><div key={o.object_id}>{o.name}：{o.status_text}{o.state?.stock?' · '+Object.entries(o.state.stock).map(([r,n])=>map.living?.resource_names[r]+' '+Math.floor(n)).join(' / '):''}</div>)}
 </div></section>
 <LifeSidebar replay map={map} selectedNpcId={npc?.npc_id??null} selectionRequest={0} busy onPlace={focus} onSelectNpc={setNpcId} onAutonomy={()=>{}} onRespond={()=>{}} taskDetail={<p className="life-result">{map.tasks?.find(t=>t.actor_id===map.protagonist.character_id&&['running','paused'].includes(t.status))?.title??'这一刻没有进行中的活动'}</p>} npcDetail={npc?<section className="life-block"><h2>{npc.display_name}</h2><p>{map.tasks?.find(t=>t.actor_id===npc.npc_id&&['running','paused'].includes(t.status))?.title??npc.status}</p><p>{npc.bio}</p><small>{npc.desires?.[0]}</small></section>:null} experienceDetail={null}/>
 </div>:null}</main>;
}
const reviewRoot=import.meta.hot?.data.reviewRoot??createRoot(document.getElementById('root')!);if(import.meta.hot)import.meta.hot.data.reviewRoot=reviewRoot;reviewRoot.render(<Review/>);
