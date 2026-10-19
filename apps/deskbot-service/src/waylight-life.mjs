// R2: one shared, finite work of light, used by the existing life executor.
// All laws below describe the Shaping Field, not real plants or lighting safety.
export const WAYLIGHT_VERSION='waterside-waylight-v1';
export const WAYLIGHT_ACTORS=['shaping-001','lamp-keeper-001','wetland-grower-001'];
export const WAYLIGHT_LAW=Object.freeze({day_charge_per_hour:.14,open_drain_per_hour:.04,hooded_drain_per_hour:.025,
  minimum_use_brightness:.16,minimum_use_gap_seconds:7200,change_gap_seconds:21600});
const clamp=n=>Math.max(0,Math.min(1,n));
const copy=structuredClone;
const lamp=w=>w.living?.objects['floating-frame']?.waylight;
const bag=(r,n)=>({container:'bag',resource:r,count:n});
const recipe=(id,title,target,seconds,inputs=[],output=null)=>({activity_id:id,title,target,seconds,inputs,kind:id==='waylight-use'?'care':'craft',waylight_rule:WAYLIGHT_VERSION,...(output?{output}:{})});
const materials=[bag('light_leaf',2),bag('wood',1),bag('fasteners',1),bag('cloth',1)];
export const WAYLIGHT_ACTIVITIES=Object.freeze([
  recipe('waylight-build-open','编一盏敞亮的归途灯','floating-frame',1200,materials),
  recipe('waylight-build-hooded','编一盏有遮罩的归途灯','floating-frame',1500,[...materials,bag('cloth',1)]),
  recipe('waylight-craft-shade','缝制归途灯的遮光罩','repair-bench',900,[bag('cloth',1),bag('fasteners',1)],bag('waylight_shade',1)),
  recipe('waylight-fit-shade','给归途灯装上遮光罩','floating-frame',600,[bag('waylight_shade',1)]),
  recipe('waylight-open','重新展开归途灯的罩片','floating-frame',300),
  recipe('waylight-shade','把归途灯的罩片合到背水侧','floating-frame',300),
  recipe('waylight-repair','缝补同一盏归途灯','floating-frame',900,[bag('cloth',1),bag('fasteners',1)]),
  recipe('waylight-use','借归途灯净滤一桶晚归的水','floating-frame',300,[{container:'floating-frame',resource:'raw_water',count:4}],bag('water',4)),
]);
export function installWaylightLife(w,at){
  if(!w.windleaf_life||!w.living?.objects['floating-frame']||w.waylight_life?.version===WAYLIGHT_VERSION)return false;
  w.waylight_life={version:WAYLIGHT_VERSION,installed_at:at,records:[],last_used:{}};
  w.living.objects['floating-frame'].waylight=null; // An empty hook, not a completed gift.
  w.living.revision++;return true;
}
function night(w,at){
  const h=Number(new Intl.DateTimeFormat('en',{timeZone:w.clock?.time_zone??'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(new Date(at)));
  return h>=18||h<6;
}
function refresh(l,isNight){l.brightness=isNight?clamp(l.charge*l.condition*(1-l.moisture*.6)*(l.mode==='hooded'?.62:1)):0;}
export function advanceWaylightLife(w,start,end,{daylight,rain,evaporation,wind=0}){
  const l=lamp(w);if(!l)return;
  const h=Math.max(0,end-Math.max(start,Date.parse(l.created_at)))/3600000;if(!h)return;
  const sheltered=l.mode==='hooded';
  l.moisture=clamp(l.moisture+h*(rain*(sheltered?.25:1)-evaporation));
  l.condition=clamp(l.condition-h*(.0005+Math.max(0,wind-8)*(sheltered?.0007:.003)));
  l.charge=clamp(l.charge+h*(daylight?WAYLIGHT_LAW.day_charge_per_hour*(sheltered?.8:1):-(sheltered?WAYLIGHT_LAW.hooded_drain_per_hour:WAYLIGHT_LAW.open_drain_per_hour)));
  refresh(l,!daylight);
  // This is a local light exposure record, not an invented feeling or memory.
  if(!daylight){l.lit_hours+=h*l.brightness;l.dark_bank_hours+=h*(1-l.brightness*(sheltered?.2:1));}
  l.updated_at=new Date(end).toISOString();
}
export function waylightActivityReason(w,r,id,at,{completion=false,task=null}={}){
  if(!r.waylight_rule)return null;
  if(w.waylight_life?.version!==WAYLIGHT_VERSION)return '归途灯的生活规则尚未安装';
  if(!WAYLIGHT_ACTORS.includes(id))return '这次归途灯试作由喵呜、灯穗和苔团商量照看';
  const a=r.activity_id,l=lamp(w),frame=w.living.objects['floating-frame'];
  if(a==='waylight-craft-shade'){
    if(!l)return '水岸还没有灯，先决定是否制作，再考虑为它缝罩';
    if(w.living.objects['repair-bench'].condition<.4)return '工作台需要先修好';
    return l?.has_hood?'已有可复用的罩片，不需要再缝一份':null;
  }
  if(frame.condition<.4||frame.water_level<.15||frame.water_level>.88)return '浮框或水位暂时不适合操作，先等条件恢复';
  if(a.startsWith('waylight-build-'))return l?'这里已有同一盏归途灯，可以改法、修补或以后再用':null;
  if(!l||completion&&task?.waylight_asset_id!==l.asset_id)return '这次活动对应的归途灯已变化，需要重新决定';
  if(a==='waylight-repair')return l.condition>.85?'灯的布片还完整，不必为了留记录反复修补':null;
  if(a==='waylight-fit-shade')return l.has_hood?'这盏灯已经有可复用的罩片':null;
  if(a==='waylight-use'){
    if(!night(w,at))return '白天可以普通汲水，暂时不需要借归途灯';
    if(l.brightness<WAYLIGHT_LAW.minimum_use_brightness||l.condition<.4)return '光或完好程度不足以照见滤水刻线，仍可以按普通方法汲水';
    if(!completion&&Date.parse(at)-Date.parse(w.waylight_life.last_used[id]??0)<WAYLIGHT_LAW.minimum_use_gap_seconds*1000)return '刚取过一桶水，先带去使用，至少两小时后再来';
    return null;
  }
  if(!l.has_hood)return '需要先装上实际制作的罩片';
  if(a==='waylight-open'&&l.mode==='open'||a==='waylight-shade'&&l.mode==='hooded')return '罩片已经在这个位置';
  if(Date.parse(at)-Date.parse(l.changed_at)<WAYLIGHT_LAW.change_gap_seconds*1000)return '这次做法至少留六小时再改，不围着罩片反复开合';
  return null;
}
export function waylightActivityBinding(w,r){return r.waylight_rule?{waylight_rule:WAYLIGHT_VERSION,waylight_asset_id:lamp(w)?.asset_id??null}:{};}
export function applyWaylightActivity(w,r,task,at){
  if(!r.waylight_rule)return null;
  const root=`task:${task.task_id}`,a=r.activity_id;let l=lamp(w);
  let text;
  if(a.startsWith('waylight-build-')){
    const hooded=a.endsWith('hooded');
    l={asset_id:`waylight:${task.task_id}`,setup_root:root,owner_id:task.actor_id,created_at:at,changed_at:at,updated_at:at,
      mode:hooded?'hooded':'open',has_hood:hooded,charge:0,moisture:0,condition:1,brightness:0,patches:0,use_count:0,lit_hours:0,dark_bank_hours:0,last_use:null};
    w.living.objects['floating-frame'].waylight=l;
    text=hooded?'光叶编成有罩的归途灯；先等白昼蓄光，水岸一侧留得更暗。':'光叶编成敞亮的归途灯；先等白昼蓄光，夜里照得更开，也更容易沾雨。';
  } else if(a==='waylight-craft-shade')text='一份实际遮罩缝好了，还需要带到水岸安装。';
  else if(a==='waylight-use'){
    l.use_count++;l.charge=clamp(l.charge-.04);l.last_use={actor_id:task.actor_id,at,root_outcome_id:root,water_units:4};
    w.waylight_life.last_used[task.actor_id]=at;text='借同一盏归途灯看清滤水刻线，五分钟净滤四份原水；清水仍要实际送去使用。';
  } else if(a==='waylight-repair'){l.condition=clamp(l.condition+.4);l.patches++;text='布片补好了，原来的灯、蓄光和使用经历保留下来。';}
  else {l.mode=a==='waylight-open'?'open':'hooded';if(a==='waylight-fit-shade')l.has_hood=true;l.changed_at=at;text=l.mode==='open'?'罩片展开，夜路会更亮，蓄光也消耗得更快。':'罩片朝向归路，水岸一侧留暗，夜里的光也能留得久些。';}
  if(l){refresh(l,night(w,at));l.updated_at=at;}
  const record={at,root_outcome_id:root,actor_id:task.actor_id,activity_id:a,asset_id:l?.asset_id??null,text};
  w.waylight_life.records=[...w.waylight_life.records,record].slice(-32);
  return {...record,rule_version:WAYLIGHT_VERSION,setup_root:l?.setup_root??null};
}
export function waylightCandidates(w,id,at){
  const need=w.autonomy?.actors[id];
  if(!w.waylight_life||!WAYLIGHT_ACTORS.includes(id)||need?.energy<.55||need?.appetite>.5)return [];
  const l=lamp(w),out=[];
  const add=(activity_id,reason,score)=>out.push({activity_id,reason,score});
  if(!l){
    // A new authored opportunity stays below a lived follow-up (34) or an
    // adopted role practice (36+). Existing history must retain its influence.
    add('waylight-build-open','把林间光叶带到水岸，让晚归取水的人能看清刻线。',id==='wetland-grower-001'?32:33);
    add('waylight-build-hooded','多用一份布，让归路有光，也给浮圃一侧留下暗处。',id==='wetland-grower-001'?33:32);
  }else{
    if(l.condition<.65)add('waylight-repair','之前留下的灯受了磨损，修好后还可以继续使用。',44);
    if(id==='wetland-grower-001'&&l.has_hood&&l.mode==='open')add('waylight-shade','想把光留给归路，让浮圃这一侧暗下来。',33);
    if(night(w,at)&&l.brightness>=WAYLIGHT_LAW.minimum_use_brightness){
      const destination=(w.living.objects['seedling-rack'].stock.water??0)<6?'seedling-rack':(w.living.objects['trial-stove'].stock.water??0)<4?'trial-stove':null;
      if(destination&&(w.living.inventories[id]?.stock.water??0)<4){add('waylight-use','那盏旧灯还有光，借它净滤一桶水，再送到实际缺水的地方。',47);out.at(-1).delivery_target=destination;}
    }
  }
  return out;
}
// Reuse the existing explicit agreement, finite craft/handoff/use and refusal path.
export function waylightSocialOffers(w){
  const l=lamp(w);if(!l||l.has_hood||!w.waylight_life)return [];
  return [{kind:'cooperate',key:`waylight-shade:${l.asset_id}`,actors:['lamp-keeper-001','wetland-grower-001'],
    location_id:'echo-waterside',title:'给归途灯商量一片背水的罩',reason:'苔团希望浮圃一侧留暗，灯穗可以缝一片定向的罩；只有双方答应、交接并安装，灯才会改变。',
    produce_activity:'waylight-craft-shade',resource:'waylight_shade',use_activity:'waylight-fit-shade'}];
}
export function waylightPersonalContext(w,id){
  if(!w.waylight_life)return null;
  const person=id===w.protagonist.character_id?w.protagonist:w.npcs.find(n=>n.npc_id===id);
  return {version:WAYLIGHT_VERSION,law:copy(WAYLIGHT_LAW),local_asset:person?.location_id==='echo-waterside'?copy(lamp(w)):null,
    own_records:copy(w.waylight_life.records.filter(r=>r.actor_id===id)),
    authored_preference:id==='wetland-grower-001'?'关心浮圃夜里有暗处':id==='lamp-keeper-001'?'希望晚归的人看得清道路':'想把林间见到的光叶用到日常里',
    rule:'初始取向不是已经发生的发言或承诺；只能据现场、自己的经历和实际收到的消息决定。灯从实际材料编成，能改法、修补、次日再用，不直接授予兴趣或身份。'};
}
