import { createHash } from 'node:crypto';
import { localWorldDate } from './realtime-world.mjs';
import { ACTIVITIES } from './living-resources.mjs';

export const MEMORY_VERSION = 'deskbot.lived-memory.v1';
export const TOPICS = { care:'照料', craft:'制作', repair:'修缮', cook:'做饭', explore:'观察小镇', connection:'与人相处' };
const digest = s => createHash('sha256').update(s).digest('hex').slice(0,24);
const clip = s => String(s ?? '').slice(0,400);
const people = w => [w.protagonist, ...w.npcs].map(p => p.character_id ?? p.npc_id);
export function installLivedMemory(w, at, { plannerEnabled = false } = {}) {
  if(w.memory)return {accepted:true,duplicate:true};
  if(!w.autonomy || w.clock?.mode !== 'real_time')return {accepted:false,reason:'requires_autonomous_real_time_world'};
  w.memory={schema:MEMORY_VERSION,installed_at:at,episodes:[],seen:[],actors:{},revision:0,
    planner:{enabled:plannerEnabled,requests:{},attempts:[],recent:[],policy:'bounded_model_choice_v1'}};
  syncLivedMemory(w,at);
  return {accepted:true,version:MEMORY_VERSION,imported_records:w.memory.episodes.length};
}
export function goalTopic(goal='') {
  if(/water|drain|tend|harvest|sow/.test(goal))return 'care';
  if(/repair|stitch/.test(goal))return 'repair';
  if(/tray|craft/.test(goal))return 'craft';
  if(/cook/.test(goal))return 'cook';
  if(goal.startsWith('interest:'))return 'explore';
  return null;
}
export function remember(w,record) {
  const memory=w.memory;if(!memory)return false;
  const id=`memory:${digest(record.origin_id)}`;
  if(memory.seen.includes(id))return false;
  memory.seen.push(id);memory.seen=memory.seen.slice(-4096);
  memory.episodes.push({id,...record,text:clip(record.text)});memory.episodes.sort((a,b)=>a.at.localeCompare(b.at));memory.episodes=memory.episodes.slice(-1024);memory.revision++;
  // Growth uses independent executed outcomes, never accounts, choices or model prose.
  if(record.kind!=='world_fact'||!record.independent_evidence||!record.topic)return true;
  const date=localWorldDate(record.at,w.clock.time_zone).date;
  for(const actorId of record.actor_ids) {
    const actor=memory.actors[actorId]??={actor_id:actorId,interests:{}};
    const interest=actor.interests[record.topic]??={topic:record.topic,days:[],daily:{},contexts:[],successes:0,setbacks:0,evidence_ids:[],stage:'noticing',changed_at:record.at};
    // Repeating the same easy activity all afternoon cannot manufacture a new personality.
    const daily=interest.daily[date]??={successes:0,setbacks:0};
    if(record.outcome==='completed' && daily.successes<2){daily.successes++;interest.successes++;}
    else if(record.outcome==='failed' && daily.setbacks<2){daily.setbacks++;interest.setbacks++;}
    if(!interest.days.includes(date))interest.days.push(date);
    const context=`${record.source.activity_id??record.source.kind}:${record.location_id??''}`;
    if(record.outcome==='completed'&&!interest.contexts.includes(context))interest.contexts.push(context);
    interest.evidence_ids=[...interest.evidence_ids,id].slice(-16);
    const days=interest.days.length, net=interest.successes-interest.setbacks*2;
    const diverse=interest.contexts.length>=2;
    const stage=diverse&&days>=7&&net>=12?'familiar':diverse&&days>=3&&net>=5?'trying':'noticing';
    if(stage!==interest.stage){interest.stage=stage;interest.changed_at=record.at;}
    interest.bonus=stage==='familiar'?12:stage==='trying'?6:0;
    interest.days=interest.days.slice(-90);
    for(const old of Object.keys(interest.daily).sort().slice(0,-90))delete interest.daily[old];
  }
  return true;
}
export function syncLivedMemory(w,at) {
  if(!w.memory)return;
  for(const id of people(w))w.memory.actors[id]??={actor_id:id,interests:{}};
  for(const task of [...(w.tasks??[])].sort((a,b)=>String(a.finished_at).localeCompare(String(b.finished_at)))) {
    if(!['completed','failed','cancelled'].includes(task.status))continue;
    const date=task.completion?.due_at??task.finished_at;
    if(!date||date>at)continue;
    const goal=task.life_goal??task.activity_id??'', topic=goalTopic(goal);
    remember(w,{origin_id:`task:${task.task_id}:${task.status}`,kind:'world_fact',actor_ids:[task.actor_id],at:date,
      text:task.status==='completed'?(task.completion?.result?.text??`${task.title}完成了。`):`${task.title}${task.status==='cancelled'?'已取消':'未完成'}：${task.failure_reason??'活动停下了'}。`,
      topic,location_id:task.to_location_id??task.location_id??task.destination_location_id??null,outcome:task.status,
      source:{kind:'canonical_task',task_id:task.task_id,activity_id:task.activity_id??null,plan_id:task.life_plan_id??null},
      model_safe:['autonomous_life','social_life'].includes(task.origin),
      model_text:`镇内${task.kind==='travel'?'旅行':ACTIVITIES.find(a=>a.activity_id===task.activity_id)?.title??(task.life_action==='rest'?'休息':'观察活动')}：${task.status==='completed'?'完成':task.status==='failed'?'未完成':'取消'}。`,
      independent_evidence:task.status!=='cancelled'&&task.kind!=='travel'&&task.life_action!=='rest'&&Boolean(topic)&&!(task.life_source_ids?.length)});
  }
  for(const c of w.social?.commitments??[]) {
    if(!['completed','failed','withdrawn','declined'].includes(c.status)||!c.finished_at||c.finished_at>at)continue;
    remember(w,{origin_id:`commitment:${c.id}:${c.status}`,kind:'world_fact',actor_ids:c.actors,at:c.finished_at,
      text:`${c.title}：${c.last_note}`,topic:'connection',location_id:c.location_id,outcome:c.status,
      source:{kind:'canonical_commitment',commitment_id:c.id,task_ids:Object.values(c.tasks??{})},
      model_safe:true,model_text:`镇内${c.kind==='meal'?'共餐':c.kind==='cooperate'?'协作':c.kind==='exchange'?'交换':'见面'}约定：${c.status}。`,
      independent_evidence:['completed','failed'].includes(c.status)});
  }
  for(const r of w.refraction?.records??[]) {
    if(!r.attested||r.received_at>at||r.category==='weather')continue;
    const body=r.category==='body';
    if(body&&!r.body&&r.meaning!=='attention')continue;
    remember(w,{origin_id:`input:${r.origin_id}:${r.category}:${r.source_label}`,kind:body?'world_fact':'hearsay',
      actor_ids:[w.protagonist.character_id],at:r.received_at,text:body?r.summary:`${r.source_label}：${r.text||r.summary}`,
      topic:null,outcome:'received',source:{kind:r.category,record_id:r.id,label:r.source_label,url:r.source_url,published_at:r.published_at},
      expires_at:r.expires_at,independent_evidence:false});
  }
}
export function influenceRememberedChoices(w,state,choices) {
  const interests=w.memory?.actors[state.actor_id]?.interests??{};
  return choices.map(c=>{
    const preference=interests[goalTopic(c.goal)],bonus=preference?.bonus??0;
    return {...c,score:c.score+bonus,memory_bonus:bonus,memory_ids:bonus?preference.evidence_ids:[],
      reason:bonus?`${c.reason} 这些天的实际经历让我想继续试试${TOPICS[preference.topic]}。`:c.reason};
  }).sort((a,b)=>b.score-a.score);
}
export function retrieveLivedMemory(w,{actorId=w.protagonist.character_id,query='',limit=8,at=w.clock?.synced_at??w.updated_at}={}) {
  const tokens=String(query).match(/[a-z0-9_-]+|[\u4e00-\u9fff]{2,4}/gi)??[];
  return (w.memory?.episodes??[]).filter(e=>e.actor_ids.includes(actorId)).map((e,index)=>({e,index,
    score:tokens.reduce((n,t)=>n+(e.text.includes(t)||TOPICS[e.topic]?.includes(t)?5:0),0)+(e.kind==='world_fact'?2:0)}))
    .sort((a,b)=>b.score-a.score||b.index-a.index).slice(0,limit).map(({e})=>({...structuredClone(e),expired:Boolean(e.expires_at&&e.expires_at<=at)}));
}
// Automatic external reasoning receives fictional town records and public news only.
// Private user accounts and physical reports remain in the local read model.
export function retrieveModelMemory(w,options={}) {
  const actorId=options.actorId??w.protagonist.character_id;
  const safe={...w,memory:w.memory?{...w.memory,episodes:w.memory.episodes.filter(e=>e.model_safe===true||
    (e.kind==='hearsay'&&e.source.kind==='external'&&/^https:\/\/science\.nasa\.gov\//.test(e.source.url??'')))}:null};
  return retrieveLivedMemory(safe,{...options,actorId}).map(e=>({id:e.id,kind:e.kind,at:e.at,text:e.model_text??e.text,
    topic:e.topic,outcome:e.outcome,expired:e.expired,evidence_ids:e.evidence_ids??[],source_kind:e.source.kind}));
}
export function memoryReadModel(w) {
  if(!w.memory)return null;
  const m=w.memory;
  return {schema:m.schema,installed_at:m.installed_at,revision:m.revision,identity_preserved:true,owner_id:w.protagonist.character_id,
    counts:Object.fromEntries(['world_fact','personal_interpretation','hearsay'].map(kind=>[kind,m.episodes.filter(e=>e.kind===kind).length])),
    actors:Object.values(m.actors).map(a=>({...structuredClone(a),display_name:a.actor_id===w.protagonist.character_id?w.protagonist.display_name:w.npcs.find(n=>n.npc_id===a.actor_id)?.display_name})),
    recent:structuredClone(m.episodes.slice(-48).reverse()),own:structuredClone(m.episodes.filter(e=>e.actor_ids.includes(w.protagonist.character_id)).slice(-24).reverse()),
    planner:{enabled:m.planner.enabled,policy:m.planner.policy,limits:{per_hour:6,per_day:72,actor_cooldown_minutes:120},
      requests:structuredClone(Object.values(m.planner.requests)),recent:structuredClone(m.planner.recent.slice(-20)),
      attempts_last_hour:m.planner.attempts.filter(a=>Date.parse(a.at)>Date.parse(w.clock.synced_at)-3600000).length}};
}
