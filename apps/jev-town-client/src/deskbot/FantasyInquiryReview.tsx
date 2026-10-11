import {useMemo,useState} from 'react';
import {mapToWorld} from '@shared/world.ts';
import {canonicalPointForLocation} from './canonicalGeometry';
import {TownMap} from '../components/TownMap';
import {sceneReviewCast} from './sceneShowcase';
import type {DeskBotWorldMap} from './types';
import evidence from './fantasy-inquiry-evidence.json';
import choices from './fantasy-choice-evidence.json';

export function FantasyInquiryReview(){
 const [selected,setSelected]=useState('comparison'),[close,setClose]=useState(true);
 const item=evidence.snapshots.find(s=>s.key===selected)??evidence.snapshots[0]!;
 const map=useMemo(()=>{
   const result=structuredClone(item.map) as unknown as DeskBotWorldMap;
   // Freeze animation at this replay clock. It is not a current live task.
   if(result.environment)result.environment.time.mode='simulation';return result;
 },[item]);
 const cast=useMemo(()=>sceneReviewCast(map,'actual',map.environment?.time.minute_of_day??720),[map]);
 const state=map.locations.flatMap(l=>l.areas??[]).flatMap(a=>a.objects??[]).find(o=>o.object_id==='seedling-rack')?.state;
 const trial=state?.glow_trials?.[0],study=state?.glow_studies?.[0];
 return <section className="cgl-inquiry">
  <span className="cgl-eyebrow">3B · 凝光苔 · 规则与现场</span><h2>光留下来，也会慢慢消散</h2>
  <p>同一片苔芽，光照、含水与风都会改变显色。一次试验需要真实的材料、时间和选择。</p>
  <p className="cgl-boundary">{evidence.note} 下方 {evidence.snapshots.length} 个片段来自同一份隔离存档，使用正式执行器结算；没有调用模型。</p>
  <div className="cgl-inquiry-steps" role="group" aria-label="凝光苔回放片段">{evidence.snapshots.map(s=><button key={s.key} aria-pressed={selected===s.key} className={selected===s.key?'selected':''} onClick={()=>setSelected(s.key)}>{s.title}</button>)}</div>
  <button onClick={()=>setClose(v=>!v)}>{close?'看整座苗圃':'看试盘近景'}</button>
  <div className="cgl-inquiry-scene">
   <TownMap citizens={cast.citizens.map(c=>({...c,personality:'隔离规则回放中的人物'}))} sceneLocations={map.locations} environment={map.environment}
    activities={cast.activities} focusObjectId={close?'seedling-rack':null} focusLocationId="moss-sprout-garden" focusRequest={1} positions={cast.positions} labels={map.locations.map(p=>{const point=p.presentation?.lot??canonicalPointForLocation(p),w=mapToWorld(point.x,point.y);return {id:p.location_id,label:p.name,x:w.x,z:w.z,height:8,kind:'landmark'};})}
    durations={new Map()} actions={new Map()} confidences={new Map()} focusedAction={null} onFocusAction={()=>{}}/>
  </div>
  <div className="cgl-pair-columns"><article><h3>{item.title}</h3><p>{item.detail}</p><small>实验时钟 · {new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit'}).format(new Date(item.at))}</small>
   <p>随身托盘：{map.living?.inventory.stock.trays??0} · 苔芽：{map.living?.inventory.stock.moss??0} · 遮风罩：{map.living?.inventory.stock.shade_hood??0}</p></article>
   <article><h3>同一存档的实测值</h3>{trial?<><div className="cgl-table"><table><thead><tr><th>试盘</th><th>蓄光</th><th>含水</th><th>显色</th></tr></thead><tbody>{trial.samples.map(s=><tr key={s.id}><td>{s.id} · {s.light>.5?'明处':'遮光格'}</td><td>{s.charge.toFixed(3)}</td><td>{s.moisture.toFixed(3)}</td><td>{s.brightness.toFixed(3)}</td></tr>)}</tbody></table></div><p>已测记 {trial.read_count} 次 · {trial.sheltered?'已装遮风罩':'未装遮风罩'}</p></>:study?<><p>余辉标本 · 当前显色 {study.brightness.toFixed(3)}</p><p>保留实际试验与测记出处。</p><code>{study.observation_root}</code></>:<p>此时没有试盘。</p>}</article></div>
  <details><summary>为什么这些变化有据可查</summary><p>固定规律决定蓄光、湿度对显色的抑制，以及风对凝聚状态的影响。模型能提出解释和方法，不能把解释写成产物。测记至少间隔两小时，改动条件后重新等待；取样、试验、回收都有实际消耗。</p><ol>{evidence.events.map(e=><li key={e.task_id}>{e.title} · 已结算</li>)}</ol></details>
  <section><h2>模型怎样选择下一步</h2><p>另用 DeepSeek 运行七个隔离案例：三个人物各面对普通、过湿两种试盘，连续安排两回合；另一次在思考期间损坏设施，检验旧计划能否被挡住。</p><p className="cgl-boundary">{choices.limitation}</p>
   <p>六组正常案例完成 12 次真实任务；第二步出现再测记、对调、补水、遮风四种方法。三组配对中，两个人物在不同前态下改变第二步方法。受阻案例没有产出测记结果，下一回合选择移动。</p>
   <div className="cgl-pair-columns">{choices.cases.map(c=><article key={c.id}><h3>{({'shaping-001':'喵呜','wetland-grower-001':'苔团','lamp-keeper-001':'灯穗'} as Record<string,string>)[c.actor]} · {c.variant==='wet'?'过湿试盘':c.variant==='ready'?'普通试盘':'中途受阻'}</h3>{c.turns.map((t,i)=><div key={i}><strong>{i+1}. {t.title} · {t.success?'实际完成':'未执行'}</strong><p>{t.reason}</p>{t.failure_reason&&<p>{t.failure_reason}</p>}<small>后续：{t.followup?.question}</small></div>)}</article>)}</div>
   <details><summary>费用与修复记录</summary><p>本阶段含失败与修复验证共 {choices.paid_stage3b.attempts} 次 API 尝试，峰时价格估算 ¥{choices.paid_stage3b.upper_cny.toFixed(3)}，并非账户账单。早期实验暴露活动序号混淆和基础动作编号混淆，原始失败保留；当前采用精确活动 ID 与冻结引用复核。</p></details>
  </section>
 </section>;
}
