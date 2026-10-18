import type {DeskBotWorldMap} from './types.ts';
export function WindleafKeepsakes({map,onPlace}:{map:DeskBotWorldMap|null;onPlace:(id:string)=>void}){
  const frames=map?.objects?.find(o=>o.object_id==='windleaf-rack')?.state?.leaf_frames??[];
  const own=frames.find(f=>f.owner_id===map?.protagonist.character_id);
  if(!map?.locations.some(p=>p.location_id==='windleaf-edge'))return null;
  const when=(at:string)=>new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  return <section className='life-block life-forest'><div className='life-row'><h2>{own?'林里留下的东西':'镇外的风语林'}</h2><button className='life-place-link' onClick={()=>onPlace(own?'windleaf-shelter':'windleaf-edge')}>{own?'看看光叶架':'看看林缘'} ↗</button></div>
    {own?<><p>同一套光叶架，从 {when(own.installed_at)} 留到现在。{own.shutter==='closed'?'遮片合着':own.shutter==='half'?'遮片半合':'遮片展开'}，{own.exposure==='windward'?'朝向风口':'转向避风侧'}。</p><p>{own.last_read_at?`上次测记：${when(own.last_read_at)}。`:'还没有完成之后的测记。'}{own.patches?`布片上留下了 ${own.patches} 处修补。`:''}</p></>:<p>从林缘到低地、风口，再回归枝台。可以先看看条件，准备好材料后再留下自己的造物。</p>}
    <small>{frames.length} / 3 套架位已使用 · 材料、行走与测记都需要实际完成</small>
  </section>;
}
