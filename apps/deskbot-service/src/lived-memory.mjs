import { createHash } from 'node:crypto';
import { localWorldDate } from './realtime-world.mjs';
import { ACTIVITIES } from './living-resources.mjs';
import { syncDevelopmentEvidence, developmentReadModel } from './development-evidence.mjs';
import { activityTopic, developmentFacetsReadModel } from './development-facets.mjs';
import { safePracticalTrialMetadata } from './role-practical-trials.mjs';

export const MEMORY_VERSION = 'deskbot.lived-memory.v1';
export const TOPICS = { care:'照料', craft:'制作', repair:'修缮', cook:'做饭', explore:'观察小镇', connection:'与人相处' };
const digest = s => createHash('sha256').update(s).digest('hex').slice(0,24);
const clip = s => String(s ?? '').slice(0,400);
const failureMetadata=task=>({
  ...(typeof task.failure_code==='string'&&/^[a-z][a-z0-9_]{0,79}$/.test(task.failure_code)?{failure_code:task.failure_code}:{}),
  ...(['resource','condition','route','coordination','performance','cancelled','unclassified'].includes(task.failure_classification)?{failure_classification:task.failure_classification}:{}),
});
const knownFailureReasons=Object.freeze({
  living_not_enabled:'生活资源规则尚未启用。',facility_missing:'需要的设施尚未安装。',
  activity_location_changed:'活动地点发生变化，没有在指定地点完成。',location_changed:'活动地点发生变化，没有在指定地点完成。',
  permission_required:'所需的住户使用同意尚未取得。',facility_busy:'设施有人使用，或仍有未结束的活动。',
  world_recovery_pending:'世界仍在补算此前经过的时间。',project_conditions_changed:'项目的可行条件发生变化，具体细节未记录。',
  crop_not_harvestable:'苔芽尚未达到可收获条件。',crop_present:'苗床仍有活苗，不宜再次播种。',
  crop_absent:'苗床已经空了，照料所需的苗木不在。',crop_already_wet:'苗床已经过湿，不宜重复浇水。',
  crop_not_waterlogged:'苗床没有积水，无需疏通排水。',water_level_high:'水位过高，安全条件不满足。',
  water_level_low:'水位过低，无法汲水。',facility_damaged:'需要的设施损坏，应先修缮。',
  facility_healthy:'设施状况良好，无需再次修缮。',material_shortage:'所需材料不足。',
  output_storage_full:'没有足够空间保存产物。',harvest_storage_full:'随身袋没有足够空间保存收获。',
  route_changed:'通行路线发生变化。',passage_closed:'原来的通道已关闭。',location_closed:'目的地已关闭。',
  location_not_reachable:'目的地无法经当前通路到达。',activity_cancelled:'这次活动已取消。',
});
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
  if(/floating-seedbed|seedbed-|float-bed/.test(goal))return 'care';
  if(/small-water-pump|pump-/.test(goal))return 'repair';
  if(/leaf-signature-soup|soup-/.test(goal))return 'cook';
  if(/water|drain|tend|harvest|sow|seed/.test(goal))return 'care';
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
  if(memory.development?.facets || record.kind!=='world_fact'||!record.independent_evidence||!record.topic)return true;
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
  // Install the common-root projection before adding views so legacy interest
  // counters remain an unchanged historical record after the stage-3 migration.
  syncDevelopmentEvidence(w,at);
  for(const id of people(w))w.memory.actors[id]??={actor_id:id,interests:{}};
  for(const task of [...(w.tasks??[])].sort((a,b)=>String(a.finished_at).localeCompare(String(b.finished_at)))) {
    if(!['completed','failed','cancelled'].includes(task.status))continue;
    const date=task.completion?.due_at??task.finished_at;
    if(!date||date>at)continue;
    const goal=task.life_goal??task.activity_id??'', topic=task.activity_id?activityTopic(task.activity_id)
      :task.life_action==='observe'?(Object.hasOwn(TOPICS,task.life_topic??'')?task.life_topic:null):goalTopic(goal);
    remember(w,{origin_id:`task:${task.task_id}:${task.status}`,kind:'world_fact',actor_ids:[task.actor_id],at:date,
      text:task.status==='completed'?(task.completion?.result?.text??`${task.title}完成了。`):`${task.title}${task.status==='cancelled'?'已取消':'未完成'}：${task.failure_reason??'活动停下了'}。`,
      topic,location_id:task.to_location_id??task.location_id??task.destination_location_id??null,outcome:task.status,
      source:{kind:'canonical_task',task_id:task.task_id,activity_id:task.activity_id??null,plan_id:task.life_plan_id??null,
        life_action:task.life_action??null,motivation:structuredClone(task.life_motivation??{kind:'unknown',facet_root_ids:[]}),
        ...(safePracticalTrialMetadata(task.role_trial)?{role_trial:safePracticalTrialMetadata(task.role_trial)}:{}),...failureMetadata(task)},
      model_safe:['autonomous_life','social_life'].includes(task.origin),
      model_text:`镇内${task.kind==='travel'?'旅行':ACTIVITIES.find(a=>a.activity_id===task.activity_id)?.title??(task.life_action==='rest'?'休息':'观察活动')}：${task.status==='completed'?'完成':task.status==='failed'?'未完成':'取消'}。`,
      independent_evidence:task.status!=='cancelled'&&task.kind!=='travel'&&task.life_action!=='rest'&&Boolean(topic)&&!(task.life_source_ids?.length)});
  }
  // A durable project milestone survives the short task-retention window. It is
  // a result of canonical tasks, not a second independent personality reward.
  for(const project of Object.values(w.resident_projects?.projects??{})) {
    for(const record of project.history??[]) {
      if(!record.at||record.at>at||!record.task_id||!['completed','failed','cancelled'].includes(record.outcome))continue;
      const taskEvidence=(project.evidence??[]).find(e=>e.task_id===record.task_id);
      const actorId=record.actor_id??taskEvidence?.actor_id??project.owner_id;
      remember(w,{origin_id:`project:${project.project_id}:${record.task_id}:${record.outcome}`,kind:'world_fact',actor_ids:[actorId],at:record.at,
        text:record.text??`${project.name}：${record.outcome==='completed'?'实际阶段完成':'这次尝试没有完成'}。`,
        topic:activityTopic(record.activity_id??taskEvidence?.activity_id)??goalTopic(project.project_id),location_id:record.location_id??null,outcome:record.outcome,
        source:{kind:'resident_project',project_id:project.project_id,task_id:record.task_id,stage_id:record.stage_id??null},
        model_safe:true,model_text:record.text??`${project.name}的实际阶段：${record.outcome}。`,independent_evidence:false});
    }
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
  syncDevelopmentEvidence(w, at);
}
export function influenceRememberedChoices(w,state,choices) {
  const model=developmentFacetsReadModel(w,{actorId:state.actor_id,at:w.clock?.synced_at??w.updated_at});
  const topics=model.enabled?model.actors.find(a=>a.actor_id===state.actor_id)?.topics??[]:[];
  const records=w.memory?.development?.records??[];
  return choices.map(c=>{
    const topic=Object.hasOwn(c,'development_topic')?c.development_topic:activityTopic(c.activity_id)??goalTopic(c.goal);
    const preference=topics.find(t=>t.topic===topic)?.interest;
    const baseScore=c.score-(c.memory_bonus??0),bonus=c.available&&Number.isFinite(preference?.bonus)?Math.max(0,Math.min(6,preference.bonus)):0;
    // Keep the full quantitative evidence in the shared ledger. A choice only
    // carries a small set that actually participated in the interest threshold.
    const roots=bonus?[...(preference.threshold_root_ids??[])].slice(-16):[];
    const memoryIds=[...new Set(records.filter(r=>roots.includes(r.root_outcome_id)).flatMap(r=>r.views?.memory_ids??[]))].slice(-8);
    return {...c,score:baseScore+bonus,memory_bonus:bonus,memory_ids:memoryIds,facet_root_ids:roots,
      development_topic:topic??null,
      reason:bonus?`${c.reason} 最近我还主动留意过${TOPICS[topic]}，想继续看看。`:c.reason};
  }).sort((a,b)=>b.score-a.score);
}

// Provider-facing summaries contain authored labels and numeric observations,
// never owner input text, private task titles, failure prose or source IDs.
export function modelDevelopmentContext(w,actorId=w?.protagonist?.character_id) {
  const model=developmentFacetsReadModel(w,{actorId,at:w?.clock?.synced_at??w?.updated_at});
  const actor=model.actors.find(a=>a.actor_id===actorId);
  const at=Date.parse(w?.clock?.synced_at??w?.updated_at??'');
  const recentActual=(w?.memory?.development?.records??[]).filter(r=>r.actor_ids?.includes(actorId)&&r.effect?.practice===true
    &&activityTopic(r.activity_id)&&['completed','failed','cancelled'].includes(r.outcome)&&Date.parse(r.at)<=at)
    .sort((a,b)=>a.at.localeCompare(b.at)||a.root_outcome_id.localeCompare(b.root_outcome_id)).slice(-4).reverse()
    .map(r=>({activity_id:r.activity_id,title:ACTIVITIES.find(a=>a.activity_id===r.activity_id).title,topic:activityTopic(r.activity_id),
      outcome:r.outcome,motivation:r.causes?.trigger==='invited'?'invited'
        :['self_continuation','need','invited'].includes(r.causes?.motivation?.kind)?r.causes.motivation.kind:'unknown',
      ...(r.outcome==='completed'?{}:{failure:{classification:['resource','condition','route','coordination','performance','cancelled'].includes(r.failure?.classification)?r.failure.classification:'unclassified',
        ...(Object.hasOwn(knownFailureReasons,r.failure?.code??'')?{known_reason:knownFailureReasons[r.failure.code]}:{})}})}));
  return {enabled:model.enabled,schema:model.schema,basis:'canonical_unique_root_outcomes',automatic_wishes:false,
    recent_actual_outcomes:recentActual,
    topics:(actor?.topics??[]).map(t=>({topic:t.topic,label:TOPICS[t.topic]??t.topic,
      contact_count:t.contact?.count??0,
      interest:{status:t.interest.status,active_days:t.interest.active_days?.length??0,
        active_continuations:t.interest.active_roots?.length??0,invited_practice:t.interest.invited_roots?.length??0,
        obligations:t.interest.obligation_roots?.length??0},
      capability:{status:t.capability.status,successful_practice:t.capability.success_roots?.length??0,
        condition_failures:t.capability.condition_failure_roots?.length??0,
        performance_failures:t.capability.performance_failure_roots?.length??0,unknown_failures:t.capability.unknown_failure_roots?.length??0,
        activities:(t.capability.activities??[]).filter(a=>ACTIVITIES.some(r=>r.activity_id===a.activity_id))
          .map(a=>({activity_id:a.activity_id,title:ACTIVITIES.find(r=>r.activity_id===a.activity_id).title,
            successes:a.successes,failures:a.failures,status:a.status}))},
      self_assessment:{status:t.self_assessment.status,basis:'rules'},
      wish:{status:'not_established',stable_interest:t.wish?.stable_interest===true}}))};
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
    development:developmentReadModel(w),
    counts:Object.fromEntries(['world_fact','personal_interpretation','hearsay'].map(kind=>[kind,m.episodes.filter(e=>e.kind===kind).length])),
    actors:Object.values(m.actors).map(a=>({...structuredClone(a),display_name:a.actor_id===w.protagonist.character_id?w.protagonist.display_name:w.npcs.find(n=>n.npc_id===a.actor_id)?.display_name})),
    recent:structuredClone(m.episodes.slice(-48).reverse()),own:structuredClone(m.episodes.filter(e=>e.actor_ids.includes(w.protagonist.character_id)).slice(-24).reverse()),
    planner:{enabled:m.planner.enabled,policy:m.planner.policy,limits:{per_hour:6,per_day:72,actor_cooldown_minutes:120},
      requests:structuredClone(Object.values(m.planner.requests)),recent:structuredClone(m.planner.recent.slice(-20)),
      attempts_last_hour:m.planner.attempts.filter(a=>Date.parse(a.at)>Date.parse(w.clock.synced_at)-3600000).length}};
}
