import { createHash } from 'node:crypto';
import { classifyCompanionInput } from './companion-world-contract.mjs';
import { getWorldEnvironment } from './world-environment.mjs';
import { activitySteps } from './life-planning.mjs';
import { findWorldPath } from './world-map-content.mjs';

export const REFRACTION_VERSION = 'deskbot.input-refraction.v1';
export const LIFE_SUGGESTIONS = Object.freeze({
  water: { title: '有空看看苗床要不要浇水', activity: 'water-bed', interest: 'care' },
  tend: { title: '有空整理一下苗床', activity: 'tend-bed', interest: 'care' },
  tray: { title: '试着做一只育苗托盘', activity: 'craft-tray', interest: 'craft' },
  waterside: { title: '有空去水边听听声音', location: 'echo-waterside', interest: 'explore' },
  grove: { title: '有空去林间待一会儿', location: 'backlit-grove', interest: 'explore' },
  rest: { title: '有空歇一会儿', interest: 'care' },
});
const OUTDOORS = new Set(['moss-sprout-garden','echo-waterside','backlit-grove','tidal-old-road','fog-lamp-square']);
const digest = value => createHash('sha256').update(value).digest('hex').slice(0,24);
const clip = value => typeof value === 'string' ? value.trim().slice(0,400) : '';
const iso = (at,ms) => new Date(Date.parse(at)+ms).toISOString();
const publishedTime = sample => sample.payload?.published_at ?? sample.provenance?.published_at ?? null;

export function installRefraction(world,at) {
  if(world.clock?.mode!=='real_time'||!world.autonomy)return {accepted:false,reason:'requires_autonomous_real_time_world'};
  if(world.refraction)return {accepted:true,duplicate:true};
  world.refraction={schema:REFRACTION_VERSION,installed_at:at,revision:0,records:[],origin_keys:[],recent:[]};
  return {accepted:true,version:REFRACTION_VERSION};
}
function note(world,at,record,text,kind='input') {
  world.refraction.recent.push({at,kind,text,record_id:record.id,category:record.category,origin_id:record.origin_id});
  world.refraction.recent=world.refraction.recent.slice(-64);
}
// Deliberately a small, inspectable parser. Unsupported/negative/quoted text
// remains an attributed account; this is not a model understanding the request.
function suggestionFromText(text) {
  if(/[不别没莫]|[“”「」『』"]/.test(text.replaceAll('要不要','').replaceAll('不如',''))||!/你|喵呜|要不要|不如|有空|试试/.test(text))return null;
  if(/浇水/.test(text))return 'water';
  if(/整理.*苗床|照料.*苗床/.test(text))return 'tend';
  if(/做.*托盘/.test(text))return 'tray';
  if(/去.*水边/.test(text))return 'waterside';
  if(/去.*林间|去.*树林/.test(text))return 'grove';
  if(/休息|歇一会/.test(text))return 'rest';
  return null;
}
function interpreted(event,kind) {
  const p=event.payload??{},text=clip(p.text??p.summary??p.title);
  if(kind==='dialogue') {
    const key=Object.hasOwn(LIFE_SUGGESTIONS,p.suggestion)?p.suggestion:suggestionFromText(text);
    return {text:text||LIFE_SUGGESTIONS[key]?.title||'用户带来了一条消息',suggestion:key,meaning:key?'suggestion':'user_account',summary:key?`听到建议：${LIFE_SUGGESTIONS[key].title}。等手头的事结束，再结合状态考虑。`:'听到用户的说法，保留为用户提供的信息；还没有核实为小镇事实。'};
  }
  if(kind==='body') {
    if(event.type==='sensor.touch' && ['head','screen'].includes(p.region??p.target))return {text:'',meaning:'attention',summary:(p.region??p.target)==='head'?'头部被触碰，留意一下现实这边。':'屏幕被触碰，留意一下现实这边。'};
    if(event.type==='sensor.microphone_direction' && Number.isFinite(p.angle_degrees)&&p.angle_degrees>=-180&&p.angle_degrees<=180)return {text:'',meaning:'body_awareness',summary:`麦克风报告声音方向 ${p.angle_degrees}°；还不知道说话者是谁。`,body:{sound_direction_degrees:p.angle_degrees}};
    if(event.type==='shell.install.detected' && /^[a-zA-Z0-9_-]{1,64}$/.test(p.shell_id??''))return {text:'',meaning:'body_awareness',summary:`磁传感器报告壳标识 ${p.shell_id}，保持喵呜的身份。`,body:{shell_id:p.shell_id}};
    return {text:'',meaning:'unsupported',summary:'收到设备消息，尚无匹配的身体感受规则。'};
  }
  if(kind==='weather')return {text:'',meaning:'environment_opportunity',summary:'上海天气进入出行和照料的参考；雨水仍由原有环境规则结算。'};
  if(kind==='external'||kind==='agent') {
    if(kind==='external' && p.report_kind==='air_quality' && Number.isFinite(p.us_aqi) && p.us_aqi>=0 && p.us_aqi<=1000 && Number.isFinite(p.pm2_5) && p.pm2_5>=0 && p.pm2_5<=2000) {
      return {text,meaning:'environment_reference',summary:p.summary??'收到区域空气模型，作为露天活动参考。',
        environment:{kind:'air_quality',location:clip(p.location),us_aqi:p.us_aqi,pm2_5:p.pm2_5,data_kind:'regional_model'}};
    }
    if(kind==='external' && p.report_kind==='science_news')return {text,meaning:'sourced_report',summary:'读到一则自然与宇宙消息，可以聊起新话题；这不是喵呜亲历的事情。'};
    // Topic codes are supplied by configured server adapters, never extracted
    // from a provider's prose or accepted from the public event endpoint.
    const key=Object.hasOwn(LIFE_SUGGESTIONS,p.topic_code)?p.topic_code:null;
    return {text,suggestion:key,meaning:kind==='external'?'sourced_report':'agent_request',summary:key?`收到${kind==='external'?'有出处的消息':'其他 agent 的提议'}，可以考虑：${LIFE_SUGGESTIONS[key].title}。`:'保留消息及出处，目前没有可执行的生活机会。'};
  }
  return {text:'',meaning:'audit',summary:'仅保留审计记录，不作为生活或成长证据。'};
}

// adapter is explicit server context. Payload source_kind/provenance never
// authenticates itself. Installation does not backfill invented past inputs.
export function refractInput(world,event,at,{attestedKind=null,sourceLabel=null,sourceUrl=null,bodyObservation=null}={}) {
  if(!world.refraction)return {accepted:false,reason:'refraction_not_installed'};
  if(event.character_id && event.character_id!==world.protagonist.character_id)return {accepted:false,reason:'character_outside_default_world'};
  let sample=event;
  if(event.type==='world.mutation'&&event.payload?.action==='update_weather')sample={...event,type:'weather.observation',observed_at:event.payload.snapshot?.observed_at};
  const assessment=classifyCompanionInput(sample,{attestedKind,now:new Date(at)});
  if(!['dialogue','body','weather','external','agent'].includes(assessment.category))return {accepted:false,reason:'audit_only'};
  const origin=assessment.origin_id??event.event_id;
  const originKey=digest(`${assessment.category}:${sourceLabel??'unverified'}:${origin}`);
  if(world.refraction.origin_keys.includes(originKey))return {accepted:false,reason:'origin_already_considered'};
  let interpretation=interpreted(sample,assessment.category);
  if(assessment.category==='body' && world.body) {
    const turn=bodyObservation?.turn;
    interpretation={text:'',meaning:turn?.kind?.includes('touch')?'attention':'body_awareness',
      summary:turn?.summary??'身体输入尚未通过连接、能力或时效检查，保留来源记录。',
      body:bodyObservation?.usable?{turn_id:turn.turn_id,kind:turn.kind,shell_status:world.body.shell?.status??null}:null};
  }
  let eligible=assessment.attested&&assessment.freshness==='fresh';
  if(assessment.category==='body' && world.body)eligible=eligible&&bodyObservation?.usable===true;
  let expiry=iso(Number.isFinite(Date.parse(sample.observed_at??sample.occurred_at))?sample.observed_at??sample.occurred_at:at,assessment.category==='body'?300000:assessment.category==='weather'?3600000:86400000);
  if(assessment.category==='weather') {
    const environment=getWorldEnvironment(world,{now:new Date(at)});
    eligible=eligible&&environment.weather.status==='fresh'&&environment.weather.observed_at===sample.observed_at;
    expiry=environment.weather.expires_at??expiry;
  }
  if(['external','agent'].includes(assessment.category)&&!sourceLabel)eligible=false;
  if(interpretation.environment?.kind==='air_quality')expiry=iso(sample.observed_at??sample.occurred_at,7200000);
  const record={id:`refraction:${digest(event.event_id)}`,origin_id:origin,event_id:event.event_id,category:assessment.category,
    source_label:sourceLabel??'未确认来源',source_url:sourceUrl??null,observed_at:sample.observed_at??sample.occurred_at,received_at:at,expires_at:expiry,
    attested:assessment.attested,freshness:assessment.freshness,meaning:interpretation.meaning,text:interpretation.text,summary:interpretation.summary,
    suggestion:eligible?interpretation.suggestion??null:null,status:eligible?(interpretation.suggestion?'pending':'observed'):'record_only',
    last_note:eligible?interpretation.summary:assessment.attested?'观测已过期或不适用，留作来源记录。':'来源未经服务端接入口确认，未进入生活安排。',
    body:eligible?interpretation.body??null:null,environment:eligible?interpretation.environment??null:null,
    original_text:assessment.attested?clip(sample.payload?.original_title)||null:null,
    published_at:assessment.attested&&assessment.category==='external'&&Number.isFinite(Date.parse(publishedTime(sample)))?new Date(publishedTime(sample)).toISOString():null,
    decisions:[],direct_identity_change:false,independent_evidence:false};
  world.refraction.records.push(record);
  if(world.refraction.records.length>96){const discard=world.refraction.records.findIndex(r=>r.status!=='chosen');world.refraction.records.splice(discard<0?0:discard,1);}
  world.refraction.origin_keys.push(originKey);world.refraction.origin_keys=world.refraction.origin_keys.slice(-384);
  if(eligible)note(world,at,record,record.last_note);
  world.refraction.revision++;
  return {accepted:true,record_id:record.id,influence_eligible:eligible};
}
export function settleRefraction(world,at) {
  for(const r of world.refraction?.records??[]) {
    const before=r.status;
    if(r.status==='chosen') {
      const plan=world.autonomy.actors[r.actor_id]?.plan;
      if(plan?.plan_id===r.plan_id&&['completed','failed','cancelled'].includes(plan.status)){
        r.status=plan.status;r.last_note=plan.status==='completed'?'这条建议进入的安排已经做完，结果以实际任务为准。':`这条建议进入的安排${plan.status==='cancelled'?'取消了':'没能继续'}：${plan.failure_reason??'已记录结果'}`;
      }
    }else if(['pending','deferred','observed'].includes(r.status)&&r.expires_at<=at){r.status='expired';r.last_note='这条输入的参考时间已经过去，下一次安排不再采用。';}
    if(before!==r.status){note(world,at,r,r.last_note,'input_result');world.refraction.revision++;}
  }
}
function live(record,at){return record.attested&&record.expires_at>at&&['pending','deferred'].includes(record.status)&&record.suggestion;}
export function influenceLifeChoices(world,state,at,profile,choices) {
  if(!world.refraction)return choices;
  const id=state.actor_id;
  if(id===world.protagonist.character_id)for(const r of world.refraction.records.filter(r=>live(r,at))) {
    const s=LIFE_SUGGESTIONS[r.suggestion],goal=`input:${r.suggestion}`;
    if(Date.parse(state.cooldowns[goal]??'')>Date.parse(at))continue;
    let choice=choices.find(c=>c.goal===r.suggestion);
    if(!choice) {
      try{
        let steps;
        if(r.suggestion==='water'&&(world.living.objects['garden-bed'].quantity===0||world.living.objects['garden-bed'].moisture>=.65))throw Object.assign(new Error('苗床眼下不缺水，先不重复浇水。'),{code:'not_needed'});
        if(s.activity)steps=activitySteps(world,id,s.activity);
        else if(s.location){if(!findWorldPath(world,world.protagonist.location_id,s.location))throw new Error('这条路暂时不通。');steps=[{kind:'travel',location_id:s.location},{kind:'observe',title:s.title,duration_seconds:900}];}
        else steps=[{kind:'rest',title:'休息一会儿',duration_seconds:1800}];
        choice={goal,title:s.title,reason:`${r.source_label}带来了这个想法，手头状态允许，想试一试。`,score:profile.interests.includes(s.interest)?42:24,steps,available:true};choices.push(choice);
      }catch(error){choice={goal,title:s.title,reason:r.summary,score:42,available:false,blocked_reason:error.message};choices.push(choice);}
    }
    // Several reports of one topic never stack priority. A basic need or an
    // existing social commitment can still outweigh a suggestion.
    choice.score=Math.max(choice.score,42);choice.source_ids=[...(choice.source_ids??[]),r.id];
  }
  const environment=getWorldEnvironment(world,{now:new Date(at)}),weather=environment.weather;
  const outdoors=OUTDOORS.has((id===world.protagonist.character_id?world.protagonist:world.npcs.find(n=>n.npc_id===id))?.location_id);
  const weatherSources=world.refraction.records.filter(r=>r.category==='weather'&&r.attested&&r.status==='observed'&&r.expires_at>at&&r.observed_at===weather.observed_at);
  const badWeather=weather.status==='fresh'&&weatherSources.length>0&&(weather.precipitation!=='none'||(weather.wind_mps??0)>=8);
  const airSources=world.refraction.records.filter(r=>r.attested&&r.status==='observed'&&r.expires_at>at&&r.environment?.kind==='air_quality');
  const badAir=(airSources.at(-1)?.environment.us_aqi??0)>=151;
  if(badWeather||badAir) {
    for(const c of choices)if(c.goal.startsWith('interest:')&&OUTDOORS.has(c.goal.slice(9)))c.score=Math.min(c.score,12);
    if(outdoors) {
      const location=world.locations.some(l=>l.location_id===profile.rest)&&!OUTDOORS.has(profile.rest)?profile.rest:'warm-pot-courtyard';
      const goal=badWeather?'weather:shelter':'air:shelter';
      if(Date.parse(state.cooldowns[goal]??'')<=Date.parse(at)||!state.cooldowns[goal])if(findWorldPath(world,(id===world.protagonist.character_id?world.protagonist:world.npcs.find(n=>n.npc_id===id)).location_id,location))choices.push({goal,title:badWeather?'去屋里避一会儿风雨':'到屋里待一会儿',reason:badWeather?`上海的${weather.condition??'风雨'}让露天待着不太合适，先到屋里。`:'上海区域空气模型提示空气不太好，露天闲逛先放一放。',score:badWeather?60:55,available:true,steps:[{kind:'travel',location_id:location},{kind:'rest',title:'在屋里等一会儿',duration_seconds:1800}],source_ids:[...(badWeather?weatherSources.slice(-1):[]),...(badAir?airSources.slice(-1):[])].map(r=>r.id)});
    }
  }
  return choices.sort((a,b)=>b.score-a.score||a.goal.localeCompare(b.goal));
}
export function recordInputDecision(world,state,choices,choice,at) {
  if(!world.refraction||state.actor_id!==world.protagonist.character_id)return;
  for(const r of world.refraction.records.filter(r=>(r.category==='weather'||r.environment?.kind==='air_quality')&&choice?.source_ids?.includes(r.id))) {
    r.last_note=`这条${r.category==='weather'?'天气':'空气'}参考进入了安排：${choice.title}。`;r.decisions.push({at,selected:true,reason:r.last_note});r.decisions=r.decisions.slice(-6);note(world,at,r,r.last_note,'input_decision');world.refraction.revision++;
  }
  for(const r of world.refraction.records.filter(r=>live(r,at))) {
    const candidate=choices.find(c=>c.source_ids?.includes(r.id)),selected=choice?.source_ids?.includes(r.id)===true;
    r.status=selected?'chosen':'deferred';r.actor_id=state.actor_id;r.plan_id=selected?state.plan.plan_id:null;
    r.last_note=selected?`结合状态，决定${choice.title}；现在仍是安排，做完才算结果。`:candidate?.blocked_reason??(candidate?`先${choice?.title??'处理眼前的事'}，这个想法暂缓。`:'这个想法还在冷却时间，稍后再考虑。');
    if(r.decisions.at(-1)?.reason!==r.last_note){r.decisions.push({at,selected,reason:r.last_note});r.decisions=r.decisions.slice(-6);note(world,at,r,r.last_note,'input_decision');world.refraction.revision++;}
  }
}
export function refractionReadModel(world,{now=new Date()}={}) {
  if(!world.refraction)return null;
  const view=structuredClone(world);settleRefraction(view,now.toISOString());
  const result=view.refraction;delete result.origin_keys;
  return {...result,policy:'bounded_refraction_rules_v1',suggestions:Object.entries(LIFE_SUGGESTIONS).map(([id,s])=>({id,title:s.title})),
    source_status:[{id:'dialogue',name:'对话与建议',status:'connected'},{id:'weather',name:'上海天气',status:getWorldEnvironment(world,{now}).weather.status},
      {id:'body',name:'设备感受',status:result.records.some(r=>r.category==='body'&&r.attested&&r.body&&r.expires_at>now.toISOString())?'recent_report':'awaiting_device'},
      {id:'external',name:'外界消息',status:result.records.some(r=>r.category==='external'&&r.attested)?'has_source_records':'not_configured'},
      {id:'agent',name:'其他 agent',status:result.records.some(r=>r.category==='agent'&&r.attested)?'has_source_records':'not_configured'}]};
}
