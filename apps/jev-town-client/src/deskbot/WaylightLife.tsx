import type {DeskBotWorldMap,Waylight} from './types';
const percent=(n:number)=>`${Math.round(n*100)}%`;
export function WaylightState({lamp}:{lamp:Waylight|null}){
  if(!lamp)return <p>水岸还是一个空挂点。光叶要实际采回，材料要带到这里，居民也可以先忙别的事。</p>;
  return <><p><strong>{lamp.mode==='hooded'?'罩片朝向归路':'光叶敞开'} · {lamp.use_count?'已借灯取水':'尚待第一次使用'}</strong></p>
    <p>蓄光 {percent(lamp.charge)} · 此刻亮度 {percent(lamp.brightness)} · 完好 {percent(lamp.condition)}</p>
    <p>同一盏灯净滤取水 {lamp.use_count} 次 · 留下 {lamp.patches} 处修补</p>
    {lamp.last_use?<small>上次实际使用：{new Date(lamp.last_use.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}，净滤 {lamp.last_use.water_units} 份水。</small>:<small>新灯不会凭制作完成就发光，要先等白昼蓄光。</small>}</>;
}
export function WaylightLife({map,onPlace}:{map:DeskBotWorldMap|null;onPlace:(id:string)=>void}){
  const state=map?.objects?.find(o=>o.object_id==='floating-frame')?.state;
  if(!state||!Object.hasOwn(state,'waylight'))return null;
  const lamp=state.waylight??null;
  const tasks=map?.tasks?.filter(t=>t.activity_id?.startsWith('waylight-')&&['running','paused'].includes(t.status))??[];
  return <details className='deskbot-mode__story waylight-story' aria-label='水岸归途灯的后续'>
    <summary><span>水岸留下的一件小事</span><strong>{lamp?`归途灯 · ${lamp.use_count} 次实际使用`:'一盏归途灯的念头'}</strong></summary>
    <div className='deskbot-mode__story-scene'><h2>借一点林间的光，留一条回来的路</h2><WaylightState lamp={lamp}/>
      {tasks.map(t=><p key={t.task_id}>{t.title} · {t.status==='paused'?'暂时停下':'正在做，还没完成'}</p>)}
      <details><summary>这件事可以怎样继续</summary><p>灯穗想让晚归的路清楚些，苔团希望水岸一侧留暗。敞亮的灯更亮、也更容易沾雨；加罩需要额外的材料，夜里耗光较慢。它们可以商量帮忙，拒绝或改天再做。</p><small>这些是设定中的取向与可行方法；当前实际进展以上面的物件和任务为准。</small></details>
      <div className='deskbot-mode__header-actions'><button type='button' onClick={()=>onPlace('echo-waterside')}>看看水岸</button><a href='/waylight-review.html'>查看隔离演示</a></div>
    </div>
  </details>;
}
