import { loadCompanionWorldContract } from './companion-world-contract.mjs';
import { installAutonomy } from './life-state.mjs';

export const RESIDENT_VERSION = 'morrowmere-residents-v1';
export const RESIDENTS = loadCompanionWorldContract().catalog.residents;
const homes = 'lamp-street-homes';
// Locations here are admitted map places, rather than imaginary off-map rooms.
export const RESIDENT_PROFILES = {
  'pathfinder-001': { interests:['explore','repair'], places:['tidal-old-road','echo-waterside','fog-lamp-square'], rest:homes, quiet:'检查路标，记下不好走的地方', role_label:'巡路员', color:'#bd7954' },
  'shade-collector-001': { interests:['care','explore'], places:['backlit-grove','moss-sprout-garden'], rest:homes, quiet:'比一比今天采到的光色', role_label:'光色采集者', color:'#7f9363' },
  'echo-postcarrier-001': { interests:['explore','cook'], places:['echo-waterside','warm-pot-courtyard',homes], rest:homes, quiet:'整理邮袋与下一趟投递路线', role_label:'邮差', color:'#6e9eae' },
  'wetland-grower-001': { interests:['care','cook'], places:['moss-sprout-garden','echo-waterside'], rest:homes, quiet:'记下苗况，留一点时间晒太阳', role_label:'湿地照料者', color:'#77935d' },
  'pot-cook-001': { interests:['cook'], places:['warm-pot-courtyard','whisper-market'], rest:homes, quiet:'核对食材，琢磨下一餐的配比', role_label:'时令厨师', color:'#d79a59' },
  'spare-mender-001': { interests:['craft','repair'], places:['spare-parts-house','echo-waterside'], rest:homes, quiet:'分类旧零件，查看待修的小东西', role_label:'修理匠', color:'#9296a6' },
  'market-trader-001': { interests:['trade','explore'], places:['whisper-market','spare-parts-house'], rest:homes, quiet:'整理交换条件，清点手头物品', role_label:'交换摊主', color:'#c78f77' },
  'thread-tailor-001': { interests:['repair','craft'], places:['whisper-market','backlit-grove'], rest:homes, quiet:'比对布料，给自己的试做留时间', role_label:'布件制作者', color:'#b987a7' },
  'lamp-keeper-001': { interests:['repair','explore'], places:['fog-lamp-square','tidal-old-road'], rest:homes, quiet:'巡看灯街，记下需要维护的地方', role_label:'雾灯维护者', color:'#c7ab61' },
  'sound-player-001': { interests:['perform','explore'], places:['fog-lamp-square','backlit-grove'], rest:homes, quiet:'在广场轻声练一段节奏', role_label:'声音表演者', color:'#a47b69' },
  'town-reporter-001': { interests:['report','explore'], places:['whisper-market','moss-sprout-garden','echo-waterside'], rest:homes, quiet:'整理亲眼见闻，核对消息出处', role_label:'小报记者', color:'#7c9390' },
  'drifting-visitor-001': { interests:['explore'], places:['backlit-grove','echo-waterside','tidal-old-road'], rest:'backlit-grove', quiet:'看看可走的路，整理明天的行李', role_label:'漂游访客', color:'#86a5bd' },
};
export function residentDesign(id) { return RESIDENTS.find(r=>r.npc_id===id) ?? null; }
export function residentPersona(id) {
  const r=residentDesign(id); if(!r)return null;
  return {persona_id:id,display_name:r.display_name,role:r.role,visual_anchor:r.appearance,premise:r.temperament,
    desires:r.desires,likes:r.likes,aversions:r.aversions,fears:r.flaws,
    speech:{rhythm:r.speech.rhythm,catchphrases:[r.speech.example],triggers:['结合实际任务回应，不把计划说成结果']},
    scene_openers:[`${r.display_name}留意了一下手边的事情。`],dialogue_examples:[r.speech.example],
    conversation_moves:r.daily_life,behavior_rules:['有自己的事务和偏好；忙碌时说明原因。','不能靠对白转移材料、瞬移或宣布任务完成。'],
    relationships:Object.fromEntries(r.relationships.map(link=>[link.npc_id,`${link.connection}；${link.tension}`])),
    toy_profile:{collection:'雾灯镇居民',signature_object:r.home_area,social_role:r.daily_life[0]},
  };
}
export function installResidentLife(world, at) {
  if(world.resident_life?.version===RESIDENT_VERSION)return {installed:false,duplicate:true};
  if(world.clock?.mode!=='real_time'||!world.living)throw Object.assign(new Error('居民生活需要现实时间与资源地图。'),{code:'resident_prerequisites_missing',statusCode:409});
  for(const r of RESIDENTS) {
    const profile=RESIDENT_PROFILES[r.npc_id];
    if([profile.rest,...profile.places].some(id=>!world.locations.some(l=>l.location_id===id)))throw new Error(`Missing admitted resident location: ${r.npc_id}`);
  }
  const migrated=[];
  for(const [index,r] of RESIDENTS.entries()) {
    const old=world.npcs.find(n=>n.npc_id===r.npc_id), profile=RESIDENT_PROFILES[r.npc_id];
    const npc={...old,npc_id:r.npc_id,display_name:r.display_name,role:r.role,
      location_id:old?.location_id??profile.places[0],status:old?.status??'刚安顿下来，先看一看今天能做的事',
      bio:r.appearance,temperament:r.temperament,speech_style:r.speech.rhythm,
      relationship:old?.relationship??{familiarity:0,trust:0,encounters:0},last_action:old?.last_action??null,
      resident_version:RESIDENT_VERSION,home_location_id:profile.rest,role_label:profile.role_label,
      color:profile.color,palette:index,desires:structuredClone(r.desires),flaws:structuredClone(r.flaws),
      project:{...structuredClone(r.project),status:'authored_goal'},authored_connections:structuredClone(r.relationships)};
    if(old){world.npcs[world.npcs.indexOf(old)]=npc;migrated.push({npc_id:r.npc_id,previous_name:old.display_name});}
    else world.npcs.push(npc);
  }
  installAutonomy(world,at);
  world.resident_life={version:RESIDENT_VERSION,installed_at:at,count:RESIDENTS.length,migration:{preserved_ids:migrated,new_residents:RESIDENTS.length-migrated.length,past_events_created:0}};
  world.social={schema:'deskbot.social-life.v1',installed_at:at,revision:0,sequence:0,commitments:[],relationships:{},recent:[],notices:[],cooldowns:{},next_offer_at:at};
  return {installed:true,count:RESIDENTS.length,migrated};
}
// Deterministic fallback dialogue is grounded in current records. It cannot execute requests.
export function residentResponse(world, npc, intent, idea) {
  const r=residentDesign(npc.npc_id); if(!r)return null;
  const task=world.tasks.find(t=>t.actor_id===npc.npc_id&&['running','paused'].includes(t.status));
  const brief=RESIDENT_PROFILES[npc.npc_id].quiet;
  const project=Object.values(world.resident_projects?.projects??{}).find(p=>p.owner_id===npc.npc_id);
  const progress=project?`${project.goal}${project.status==='completed'?'已经验收好了':'还在慢慢做'}。${project.last_outcome?.text??'还没有完成过实际阶段。'}`:`${r.desires[0]}，还得慢慢做。`;
  if(intent==='observe')return `${npc.display_name}：我${task?`正在${task.title}`:`在${brief}`}。${progress}`;
  if(intent==='invite'||intent==='help')return `${npc.display_name}：${task?`我这会儿还在${task.title}，等忙完再看。`:'可以先看看咱们手头的事。'}要做成约定，得先说清地点、材料和时间。`;
  if(intent==='suggest')return `${npc.display_name}：${idea?`“${idea.slice(0,80)}”我听到了。`:''}${r.speech.example}先当作一个想法，还没实际开始。`;
  if(intent==='greet')return `${npc.display_name}：来了？${task?`我手上还有${task.title}，先不走开。`:r.speech.example}`;
  return `${npc.display_name}：${r.speech.example}${idea?'你说的事我听着，但得结合我手头的安排。':''}`;
}
