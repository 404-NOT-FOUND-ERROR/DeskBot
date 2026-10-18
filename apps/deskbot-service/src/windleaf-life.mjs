// Authored Shaping Field physics, not a claim about real botany or consciousness.
import {advanceWindTrace,WIND_TRACE_LAW} from './windleaf-story.mjs';
export const WINDLEAF_RULE='windleaf-life-v1';
export const WINDLEAF_LAW=Object.freeze({leaf_capacity:8,leaves_per_daylight_hour:.3,comparison_seconds:1800,max_frames:3,
  charge_per_daylight_hour:.14,night_decay_per_hour:.018,pattern_per_wind_hour:.045,rain_quenching:.7,wear_per_storm_hour:.006});
const clamp=n=>Math.min(1,Math.max(0,n));
const own=(world,id)=>world.living?.objects['windleaf-rack']?.leaf_frames?.find(f=>f.owner_id===id);
const input=(resource,count)=>({container:'bag',resource,count});
const recipe=(activity_id,title,target,seconds,inputs=[],output=null)=>({activity_id,title,target,seconds,inputs,kind:activity_id.includes('craft')?'craft':'care',windleaf_rule:WINDLEAF_RULE,...(output?{output}:{})});
export const WINDLEAF_ACTIVITIES=Object.freeze([
  recipe('leaf-observe-lowland','测记林间低地的光叶条件','windleaf-observation-stone',180),
  recipe('leaf-gather','采下两片已凝聚的光叶','windleaf-canopy',600,[{container:'windleaf-canopy',resource:'light_leaf',count:2}],input('light_leaf',2)),
  recipe('leaf-craft-kit','制作可拆光叶收集架','repair-bench',1200,[{container:'parts-drawers',resource:'wood',count:2},{container:'parts-drawers',resource:'cloth',count:1},{container:'parts-drawers',resource:'fasteners',count:2},input('trays',1)],input('leaf_frame_kit',1)),
  recipe('leaf-install','在风口安置自己的光叶架','windleaf-rack',600,[input('leaf_frame_kit',1),input('light_leaf',2)]),
  recipe('leaf-open','展开自己的收集架遮片','windleaf-rack',180),
  recipe('leaf-half-close','把自己的遮片调到半合','windleaf-rack',180),
  recipe('leaf-close','合上自己的收集架遮片','windleaf-rack',180),
  recipe('leaf-turn-lee','把自己的架子转向避风侧','windleaf-rack',300),
  recipe('leaf-turn-wind','把自己的架子转向迎风侧','windleaf-rack',300),
  recipe('leaf-read','测记自己光叶架的纹路变化','windleaf-rack',180),
  recipe('leaf-repair','给自己的光叶架缝补布片','windleaf-rack',600,[input('cloth',1),input('fasteners',1)]),
  recipe('leaf-pack','收起自己的架子带回镇内','windleaf-rack',300,[],input('leaf_frame_kit',1)),
]);
export function installWindleafLife(world,at) {
  if(!world.living || world.windleaf_life?.rule_version===WINDLEAF_RULE || !world.map_catalog?.windleaf_revision)return false;
  const initial={
    'windleaf-canopy':{kind:'windleaf_source',stock:{light_leaf:0},capacity:WINDLEAF_LAW.leaf_capacity,charge:0,moisture:.45,pattern:0},
    'windleaf-observation-stone':{kind:'windleaf_observation'},
    'windleaf-rack':{kind:'windleaf_rack',condition:1,leaf_frames:[]},
    'windleaf-rain-basin':{kind:'windleaf_basin',water_level:0},
    'windleaf-return-table':{kind:'store',stock:{wood:0,cloth:0,fasteners:0,light_leaf:0,leaf_frame_kit:0},capacity:24},
    'windleaf-waymarker':{kind:'windleaf_waymarker'}
  };
  for(const [id,state]of Object.entries(initial))world.living.objects[id]??={object_id:id,updated_at:at,...structuredClone(state)};
  world.windleaf_life={rule_version:WINDLEAF_RULE,installed_at:at,notes:{},completed:[],packed_kits:{}};
  world.living.revision++;
  return true;
}
export function advanceWindleafLife(world,start,end,{daylight,rain,evaporation,wind=0,weather_source=null}) {
  const rule=world.windleaf_life;if(!rule)return;
  const hours=Math.max(0,end-Math.max(start,Date.parse(rule.installed_at)))/3600000;if(!hours)return;
  const l=world.living.objects,source=l['windleaf-canopy'];
  // Sample the actual leaves already present before this interval grows more.
  advanceWindTrace(world,start,end,{wind,weather_source});
  source.moisture=clamp(source.moisture+hours*(rain-evaporation));
  source.charge=clamp(source.charge+hours*(daylight?WINDLEAF_LAW.charge_per_daylight_hour:-WINDLEAF_LAW.night_decay_per_hour));
  source.pattern=clamp(source.pattern+hours*wind*.016);
  // Reserved leaves still occupy the source's capacity. No growth before installation.
  const held=(world.tasks??[]).filter(t=>t.reservation?.status==='held').flatMap(t=>t.reservation.inputs).filter(i=>i.container==='windleaf-canopy'&&i.resource==='light_leaf').reduce((n,i)=>n+i.count,0);
  source.stock.light_leaf=Math.min(source.capacity-held,source.stock.light_leaf+hours*(daylight?WINDLEAF_LAW.leaves_per_daylight_hour:0)*(1-source.moisture*.4));
  l['windleaf-rain-basin'].water_level=clamp(l['windleaf-rain-basin'].water_level+hours*(rain*3-evaporation*.35));
  for(const frame of l['windleaf-rack'].leaf_frames) {
    const openness=frame.shutter==='open'?1:frame.shutter==='half'?.5:.08,exposure=frame.exposure==='windward'?1:.3;
    frame.moisture=clamp(frame.moisture+hours*(rain*openness-evaporation*.65));
    frame.charge=clamp(frame.charge+hours*(daylight?WINDLEAF_LAW.charge_per_daylight_hour*openness:-WINDLEAF_LAW.night_decay_per_hour));
    frame.pattern=clamp(frame.pattern+hours*(wind*exposure*openness*WINDLEAF_LAW.pattern_per_wind_hour-.005));
    frame.condition=clamp(frame.condition-hours*(.0004+Math.max(0,wind-5)*openness*exposure*WINDLEAF_LAW.wear_per_storm_hour));
    frame.brightness=clamp(frame.charge*frame.condition*(1-frame.moisture*WINDLEAF_LAW.rain_quenching));
    frame.updated_at=new Date(end).toISOString();
  }
}
export function windleafActivityReason(world,recipe,actorId,at,{completion=false,task=null}={}) {
  if(!recipe.windleaf_rule)return null;
  if(world.windleaf_life?.rule_version!==recipe.windleaf_rule)return '风语林生活规则尚未安装';
  const id=recipe.activity_id,frame=own(world,actorId),frames=world.living.objects['windleaf-rack'].leaf_frames;
  if(id==='leaf-craft-kit')return world.living.objects['repair-bench'].condition<.4?'工作台需要先修好':null;
  if(['leaf-gather','leaf-observe-lowland'].includes(id))return null;
  if(id==='leaf-install')return frame?'先收起自己已有的架子':frames.length>=WINDLEAF_LAW.max_frames?'架位已满，最多三套':null;
  if(!frame || completion&&task?.windleaf_frame_id!==frame.frame_id)return '没有与本次活动匹配的自己的光叶架';
  if(id==='leaf-read'&&Date.parse(at)-Math.max(Date.parse(frame.changed_at),Date.parse(frame.last_read_at??frame.installed_at))<WINDLEAF_LAW.comparison_seconds*1000)return '改变条件或上次测记后，需要再等实际三十分钟';
  const wanted={'leaf-open':'open','leaf-half-close':'half','leaf-close':'closed'}[id];
  if(wanted===frame.shutter)return '遮片已经处于这个位置';
  if(id==='leaf-turn-lee'&&frame.exposure==='leeward'||id==='leaf-turn-wind'&&frame.exposure==='windward')return '架子已经朝向这一侧';
  if(id==='leaf-repair'&&frame.condition>.9)return '布片完整，暂时不需要缝补';
  if(!['leaf-repair','leaf-pack','leaf-close'].includes(id)&&frame.condition<.3)return '自己的布片已损坏，先修补或收起';
  return null;
}
export function windleafActivityBinding(world,recipe,actorId) {
  return recipe.windleaf_rule?{windleaf_rule:WINDLEAF_RULE,windleaf_frame_id:own(world,actorId)?.frame_id??null}:{};
}
const reading=f=>({shutter:f.shutter,exposure:f.exposure,charge:f.charge,moisture:f.moisture,pattern:f.pattern,condition:f.condition,brightness:f.brightness});
export function applyWindleafActivity(world,recipe,task,at) {
  if(!recipe.windleaf_rule)return null;
  const id=recipe.activity_id,rule=world.windleaf_life,rack=world.living.objects['windleaf-rack'];
  const root=`task:${task.task_id}`,base={rule_version:WINDLEAF_RULE,root_outcome_id:root,method:id};let frame=own(world,task.actor_id);
  if(id==='leaf-observe-lowland') {
    const source=world.living.objects['windleaf-canopy'];
    const observation={at,root_outcome_id:root,kind:'lowland',readings:{charge:source.charge,moisture:source.moisture,pattern:source.pattern,available_leaves:source.stock.light_leaf,wind_trace:structuredClone(source.wind_trace??null)},interpretation:'低地现场实际读数，不代表风口或未来条件。留风折面是此刻有限现象，不证明旧引光线路的来历。'};
    rule.notes[task.actor_id]=[...(rule.notes[task.actor_id]??[]),observation].slice(-24);return {...base,observation};
  }
  if(['leaf-gather','leaf-craft-kit'].includes(id))return base;
  if(id==='leaf-install') {
    const packed=rule.packed_kits?.[task.actor_id]?.shift();
    const slot=[0,1,2].find(i=>!rack.leaf_frames.some(f=>f.slot===i));
    frame={frame_id:packed?.frame_id??`leaf-frame:${task.task_id}`,slot,owner_id:task.actor_id,setup_root:packed?.setup_root??root,installation_root:root,sample_set_root:root,created_at:packed?.created_at??at,installed_at:at,changed_at:at,updated_at:at,shutter:'half',exposure:'windward',condition:packed?.condition??1,patches:packed?.patches??0,charge:0,moisture:.4,pattern:0,brightness:0,read_count:packed?.read_count??0,batch_read_count:0};
    rack.leaf_frames.push(frame);return {...base,frame_id:frame.frame_id,readings:reading(frame),text:'光叶架实际安置完毕，尚无之后的对照读数。'};
  }
  if(id==='leaf-read') {
    const observation={at,root_outcome_id:root,frame_id:frame.frame_id,setup_root:frame.setup_root,installation_root:frame.installation_root,sample_set_root:frame.sample_set_root,changed_at:frame.changed_at,from_at:frame.last_read_at??frame.installed_at,readings:reading(frame),interpretation:'这些是本次实际测记，变化相关性不自动成为因果结论。重新安置的新光叶批次不冒充以前的样品。'};
    frame.last_read_at=at;frame.read_count++;frame.batch_read_count=(frame.batch_read_count??0)+1;frame.last_read_root=root;
    rule.notes[task.actor_id]=[...(rule.notes[task.actor_id]??[]),observation].slice(-24);return {...base,observation};
  }
  if(id==='leaf-pack') {
    rule.packed_kits??={};rule.packed_kits[task.actor_id]=[...(rule.packed_kits[task.actor_id]??[]),{frame_id:frame.frame_id,setup_root:frame.setup_root,created_at:frame.created_at??frame.installed_at,condition:frame.condition,patches:frame.patches,read_count:frame.read_count,packed_at:at,packing_root:root}];
    rack.leaf_frames=rack.leaf_frames.filter(f=>f!==frame);
    rule.completed=[...rule.completed,{frame_id:frame.frame_id,owner_id:task.actor_id,setup_root:frame.setup_root,root_outcome_id:root,finished_at:at,final_readings:reading(frame),read_count:frame.read_count}].slice(-48);
    return {...base,frame_id:frame.frame_id,text:'可拆架回收到随身袋；两片已使用光叶归入林地腐叶，不额外生成新的光叶。'};
  }
  const shutter={'leaf-open':'open','leaf-half-close':'half','leaf-close':'closed'}[id];if(shutter)frame.shutter=shutter;
  if(id==='leaf-turn-lee')frame.exposure='leeward';if(id==='leaf-turn-wind')frame.exposure='windward';
  if(id==='leaf-repair'){frame.condition=clamp(frame.condition+.4);frame.patches++;}
  frame.changed_at=at;return {...base,frame_id:frame.frame_id,readings:reading(frame)};
}
export function windleafPersonalContext(world,id) {
  if(!world.windleaf_life)return null;
  const person=world.protagonist.character_id===id?world.protagonist:world.npcs.find(p=>p.npc_id===id);
  return {rule_version:WINDLEAF_RULE,law:structuredClone(WINDLEAF_LAW),wind_trace_law:structuredClone(WIND_TRACE_LAW),notes:structuredClone(world.windleaf_life.notes[id]??[]),own_packed_kits:structuredClone(world.windleaf_life.packed_kits?.[id]??[]),own_frame:person?.location_id==='windleaf-shelter'?structuredClone(own(world,id)??null):null,comparison_seconds:WINDLEAF_LAW.comparison_seconds,
    rule:'只有实际安置、完成调节和测记才形成经历。光叶与材料有限；自己的旧架子可以后来复看、修补或明确收起。不直接授予角色身份。'};
}

// Local presentation opportunities, grounded in actual objects. They do not schedule or settle anything.
export function windleafSceneTemplates(world,locationId){
  if(!world.windleaf_life || !locationId.startsWith('windleaf-'))return null;
  const objects=world.living.objects,frame=own(world,world.protagonist.character_id);
  const scene=(id,title,narration,cue,opportunity)=>[{id,bands:['morning','day','evening','night'],title,narration,cue,opportunity}];
  if(locationId==='windleaf-edge')return scene('windleaf-edge-return','林缘留着回镇的方向','路牌一面朝向镇里的灯，一面指向林间。继续深入、停一会儿，或回去准备材料，都可以是今天的安排。','林缘的风带只显示此刻的风','先看通路和自己的余力，不必把出门变成一个必做任务');
  if(locationId==='windleaf-lowland'){
    const count=Math.floor((objects['windleaf-canopy'].stock.light_leaf??0)*10)/10;
    const trace=objects['windleaf-canopy'].wind_trace;
    const phenomenon=trace?.active?`刚才的风在枝间留下一道正在消退的折面，最多延续到 ${trace.expires_at}。`:'此刻没有仍在延续的留风折面。';
    return scene(`windleaf-lowland-${Math.floor(count)}-${trace?.active?'trace':'quiet'}`,'留风树下的光叶慢慢凝聚',`枝簇记录着 ${count} 片可采光叶。${phenomenon}这里是低地现场，风口的读数要亲自过去测记；没有采下的光叶还不在随身袋里。`,'分叉树冠、暂留的折面和测记石','先观察、实际采集已凝聚的光叶，或留一点安静时间；用途可以以后再定');
  }
  if(locationId==='windleaf-shelter'){
    if(!frame)return scene('windleaf-shelter-empty','风口棚还有未使用的架位',`当前有 ${objects['windleaf-rack'].leaf_frames.length}/3 套架子安置在这里。自己的架子还没有留下；材料可以在镇内准备，也可以先观察别人的公开造物。`,'工作棚前部敞开，遮片和使用痕迹能被看见','准备可拆架和两片光叶之后，再决定是否实际安置');
    const mode={open:'展开',half:'半合',closed:'合上'}[frame.shutter];
    return scene(`windleaf-shelter-${frame.shutter}-${frame.read_count}-${frame.patches}-${Math.floor(frame.condition*10)}`,'自己留下的光叶架还在风口',`同一套架子仍在原架位，遮片${mode}。架体累计完成 ${frame.read_count} 次测记，本批光叶完成 ${frame.batch_read_count??frame.read_count} 次，留下 ${frame.patches} 处修补；布片完好 ${Math.round(frame.condition*100)}%。这些是实际对象状态，下一次比较还要看等待条件。`,'遮片、样品和修补保留在同一件物件上',frame.condition<.9?'检查是否要修补、改变遮片或明确收起':'复看旧问题，选择改变办法、稍后再测记或收起带回');
  }
  return scene('windleaf-return-platform','归枝台留着整理东西的位置','空篮子不会替人准备材料。随身带回来的东西、实际存下的备料和在场居民的话，才会影响下一次出门。','归枝台的物件读取有限库存','整理随身材料，和在场人交流，或者沿路返回镇里');
}
