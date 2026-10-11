import {useMemo,useState} from 'react';
import {TownMap} from '../components/TownMap';
import {sceneReviewCast} from './sceneShowcase';
import type {DeskBotWorldMap} from './types';
import evidence from './resonant-evidence.json';
import choices from './resonant-choice-evidence.json';
export function ResonantLifeReview(){
 const [selected,setSelected]=useState('water');
 const item=evidence.snapshots.find(s=>s.key===selected)??evidence.snapshots[0]!;
 const map=useMemo(()=>{const m=structuredClone(item.map) as unknown as DeskBotWorldMap;if(m.environment)m.environment.time.mode='simulation';return m;},[item]);
 const cast=useMemo(()=>sceneReviewCast(map,'actual',map.environment?.time.minute_of_day??720),[map]);
 const state=map.locations.flatMap(l=>l.areas??[]).flatMap(a=>a.objects??[]).find(o=>o.object_id===item.object)?.state;
 const bell=state?.echo_bells?.[0],lamp=state?.night_lanterns?.[0];
 return <section className="cgl-inquiry"><p className="cgl-eyebrow">4B / 水岸与夜间 / 同一世界的可测规律</p>
  <h2>听水的回声，把余辉带回夜里</h2><p>工坊的材料成为水边的回声杯；苗圃的试验留下余辉，沿路带到广场。调节、等候、再次观察，也可以收起作品，留待以后。</p>
  <p className="cgl-boundary">{evidence.note} 本回放有 {evidence.events.length} 项实际结算任务，含四次沿地图通路的移动。</p>
  <div className="cgl-inquiry-steps" role="group" aria-label="水岸与夜灯回放">{evidence.snapshots.map(s=><button key={s.key} aria-pressed={selected===s.key} className={selected===s.key?'selected':''} onClick={()=>setSelected(s.key)}>{s.title}</button>)}</div>
  <div className="cgl-inquiry-scene"><TownMap citizens={cast.citizens.map(c=>({...c,personality:'隔离规则回放中的人物'}))} sceneLocations={map.locations} environment={map.environment} activities={cast.activities}
   focusObjectId={item.object} focusLocationId={item.location} focusRequest={evidence.snapshots.indexOf(item)+1} positions={cast.positions} labels={[]}
   durations={new Map()} actions={new Map()} confidences={new Map()} focusedAction={null} onFocusAction={()=>{}}/></div>
  <div className="cgl-pair-columns"><article><h3>{item.title}</h3><p>{item.detail}</p><small>测试时钟 · {new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}).format(new Date(item.at))}</small></article>
   <article><h3>画面所读取的实际状态</h3>{bell?<><p>水位 {bell.measurement.water_level.toFixed(3)} · 浸水深度 {bell.measurement.immersion.toFixed(3)}</p><p>风速 {bell.measurement.wind_mps} m/s · 回声强度 {bell.measurement.resonance.toFixed(3)}</p><p>音调 {bell.measurement.tone} Hz · {bell.dampened?'已装挡风布':'未装挡风布'}</p></>:lamp?<><p>剩余蓄光 {lamp.charge.toFixed(3)} · 显色 {lamp.brightness.toFixed(3)}</p><p>{lamp.closed?'遮光片已合上':'遮光片已打开'}</p><small>来自实际测记：</small><code>{lamp.observation_root}</code></>:<p>作品已收起，托盘回到随身库存。</p>}</article></div>
  <details><summary>任务与出处</summary><p>模型可以选择已有方法和提出假说；风、水位、显色和资源归属由规则结算。动画时间只负责摆动，不能凭空造物。</p><ol>{evidence.events.map(e=><li key={e.task_id}>{e.title} · 已结算</li>)}</ol></details>
  <h2>条件变化以后，它也可以另作安排</h2><p>{choices.note} 其中七项意图完成实际任务，一项被时间条件挡住；没有强迫它始终围着研究转。</p>
  <div className="cgl-pair-columns">{choices.cases.map(c=><article key={c.id}><h3>{({'water-calm':'水岸 · 平静','water-wind':'水岸 · 风大','night-open':'夜间 · 灯打开','night-closed':'夜间 · 遮光片合上'} as Record<string,string>)[c.variant]}</h3>{c.turns.map((t,i)=><section key={i}><strong>{i+1}. {t.title} · {t.success?'实际完成':'未执行'}</strong><p>{t.reason}</p>{t.failure_reason&&<p>{t.failure_reason}</p>}<small>后续：{t.followup}</small></section>)}</article>)}</div>
  <details><summary>本轮局限与费用</summary><ul>{choices.limits.map(note=><li key={note}>{note}</li>)}</ul><p>本轮 {choices.calls} 次调用，峰时价格保守估算 ¥{choices.upper_cny.toFixed(3)}，并非账户账单。</p></details>
 </section>;
}
