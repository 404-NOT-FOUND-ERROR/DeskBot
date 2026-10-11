import {activityTopic} from './development-facets.mjs';
// Canonical inputs and bounded personal working state. No model may write world facts here.
const copy=structuredClone;
const hashText=value=>String(value??'').trim();
export const COGNITIVE_CONTEXT_VERSION='deskbot.cognitive-life.context.v3';
export function cognitiveInputs(world,id,at){
  const life=world.cognition?.actors[id]??{},inputs=[];
  for(const message of life.inbox??[]){
    inputs.push({id:message.message_id??`message:${message.task_id}:${id}`,category:'agent',sender_id:message.sender_id,
      sender_name:message.sender_name??'居民',sender_is_agent:message.source_kind!=='joint_result',content:message.text,occurred_at:message.at,
      root_outcome_id:message.root_outcome_id,attested:true,epistemic:message.source_kind==='joint_result'?'shared_result':'heard',authority:'information',reply_to:message.reply_to??null});
  }
  // Device/user sources belong to the desk companion; residents learn them only through actual delivery.
  if(id===world.protagonist.character_id)for(const record of world.refraction?.records??[]){
    if(!record.attested||record.freshness!=='fresh'||record.status==='record_only'||!(record.expires_at>at)||record.received_at>at)continue;
    const text=hashText(record.text)||hashText(record.summary);if(!text)continue;
    inputs.push({id:record.id,category:record.category==='dialogue'?'user':record.category,sender_id:`source:${record.category}`,
      sender_name:record.source_label??'外界消息',sender_is_agent:false,content:text,occurred_at:record.observed_at??record.received_at,
      received_at:record.received_at,expires_at:record.expires_at,attested:true,epistemic:record.category==='body'?'body_observation':'reported',
      authority:record.category==='weather'?'environment_reference':'information',meaning:record.meaning,suggestion:record.suggestion,
      event_id:record.event_id,origin_id:record.origin_id,source_url:record.source_url,body:copy(record.body??null)});
  }
  return inputs.slice(-48);
}
export function perceptionFact(source){return `[消息] 来自${source.sender_name}的消息：${source.content}`;}

export function cognitiveWorkingState(life,query=''){
  const raw=life??{},all=raw.memories??[],byId=new Map(all.map(m=>[m.id,m])),selected=new Map();
  const words=new Set([...String(query)].filter(c=>!/[\s\p{P}\p{N}]/u.test(c)));
  function score(m,index){const text=m.payload.stored_content??m.payload.raw_content??'';return [...words].filter(c=>text.includes(c)).length+(m.payload.importance??0)*4+index/Math.max(1,all.length);}
  const candidates=[...all.slice(-20),...all.map((m,i)=>({m,score:score(m,i)})).sort((a,b)=>b.score-a.score).slice(0,28).map(x=>x.m)];
  let bytes=0;
  // Include insight dependencies together. Omit a large group rather than severing its provenance.
  for(const candidate of candidates){
    const group=new Map();const visit=m=>{if(!m||group.has(m.id)||selected.has(m.id))return;group.set(m.id,m);for(const key of m.payload.source_ids??[])visit(byId.get(key));};visit(candidate);
    const size=JSON.stringify([...group.values()]).length;if(bytes+size>96000||selected.size+group.size>80)continue;
    for(const [key,value]of group)selected.set(key,value);bytes+=size;
  }
  const {history,inbox,job,memories,...state}=raw;
  return {...copy(state),memories:copy([...selected.values()]),memory_window:{total:raw.memory_archive?.total??all.length,loaded:selected.size,originals_retained:true},
    // Transport IDs are not the canonical archive. Pending execution remains readable independently.
    job:job?{id:job.id,phase:job.phase,status:job.status}:null,history:copy((history??[]).slice(-4)),inbox:copy((inbox??[]).slice(-8))};
}

export function freezeCognitiveReferences(context){
  return {location_id:context.location.id,objects:context.objects.map(o=>o.id),activities:context.capabilities.activities.map(a=>a.activity_id),
    destinations:(context.capabilities.travel?.destinations??[]).map(p=>p.id),receivers:context.capabilities.share.receivers.map(r=>r.actor_id),sources:copy(context.inputs??[]),
    social:copy(context.social??{}),speech_evidence:copy(context.speech_evidence??[]),development:copy(context.development??null),
    perceptions:copy(context.perceptions??[]),interpretation_pending:copy(context.refraction?.pending??[]),known_people:copy(context.visible_people??[]),captured_at:context.at};
}

export function mergeMemoryMetadata(life,updates=[]){
  const entries=new Map(life.memories.map(m=>[m.id,m]));
  for(const update of updates){
    const old=entries.get(update.id);if(!old)continue;
    for(const key of ['retrieval_count','last_accessed_step'])if(Number.isSafeInteger(update[key])&&update[key]>=0)
      old.payload[key]=Math.max(old.payload[key]??-1,update[key]);
    if(Number.isFinite(update.decay_score)&&update.decay_score>=0&&update.decay_score<=1)old.payload.decay_score=update.decay_score;
  }
}

export function adoptPersonalContinuity(world,id,life,proposal,at,{perceptionSources=[]}={}){
  const known=new Map((life.known_people??[]).map(p=>[p.actor_id,p]));
  for(const person of life.job?.references?.known_people??[])known.set(person.actor_id,copy(person));
  for(const source of perceptionSources)if(source.sender_is_agent)known.set(source.sender_id,{actor_id:source.sender_id,name:source.sender_name});
  life.known_people=[...known.values()];
  const prior=new Map((life.relations??[]).map(r=>[r.to_id,r]));
  for(const relation of proposal.relations??[]){
    if(relation.world_id!==world.world_id||relation.from_id!==id||!known.has(relation.to_id))throw Object.assign(new Error('private relation scope invalid'),{code:'private_relation_scope_invalid'});
    const old=prior.get(relation.to_id),contacts=perceptionSources.filter(s=>s.sender_is_agent&&s.sender_id===relation.to_id).length;
    // At this phase only actual contact advances. Trust and labels require the later relation-review contract.
    if(relation.interaction_count!==(old?.interaction_count??0)+contacts||relation.trust_objective!==(old?.trust_objective??.5)||relation.affection_objective!==(old?.affection_objective??0)
      ||JSON.stringify(relation.labels??[])!==JSON.stringify(old?.labels??[])||(relation.history_summary??'')!==(old?.history_summary??''))
      throw Object.assign(new Error('unsupported relation change'),{code:'relation_change_without_event'});
    prior.set(relation.to_id,{...copy(relation),to_name:known.get(relation.to_id).name,updated_at:at});
  }
  life.relations=[...prior.values()];mergeMemoryMetadata(life,proposal.memory_updates);
  // Bounded transient attempts help the next process avoid repeating an impossible method; never count as practice.
  if(proposal.continuity)life.continuity=copy({recent_foiled:(proposal.continuity.recent_foiled??[]).slice(-12),foiled_misses:(proposal.continuity.foiled_misses??[]).slice(-24)});
}

export function cognitiveCause(world,id,compiled,refs,life){
  const sourceIds=[...new Set(compiled.source_ids??[])];
  if(!Array.isArray(compiled.source_ids??[])||sourceIds.some(s=>typeof s!=='string'||!refs.sources.some(r=>r.id===s)))throw Object.assign(new Error('unknown motivation source'),{code:'cognitive_source_unknown'});
  const sources=sourceIds.map(sourceId=>refs.sources.find(s=>s.id===sourceId));
  let kind=compiled.motivation??'unknown';
  if(!['need','self_exploration','self_continuation','invited','accepted_obligation','unknown'].includes(kind))throw Object.assign(new Error('invalid motivation'),{code:'cognitive_motivation_invalid'});
  const requested=compiled.prior_root_id??null;
  const oldResult=life.last_result,canonicalPrior=oldResult?.task_id?`task:${oldResult.task_id}`:oldResult?.root_outcome_id;
  const ownedRoots=(world.memory?.development?.records??[]).filter(r=>r.actor_ids.includes(id)).map(r=>r.root_outcome_id);
  const priorRoot=requested===oldResult?.root_outcome_id?canonicalPrior:requested;
  if(priorRoot&&!ownedRoots.includes(priorRoot)&&priorRoot!==canonicalPrior)throw Object.assign(new Error('unknown continuation root'),{code:'cognitive_prior_root_unknown'});
  if(kind==='self_continuation'){
    const previous=(world.memory?.development?.records??[]).find(r=>r.root_outcome_id===priorRoot&&r.actor_ids.includes(id));
    const selectedTopic=compiled.operation==='activity'?activityTopic(compiled.activity_id??refs.activities[(compiled.activity_index??0)-1]):compiled.operation==='observe'?'explore':null;
    // Continuation may cross methods within a topic. An unrelated meal cannot
    // bootstrap evidence of interest in every later experiment.
    if(!priorRoot||selectedTopic&&previous?.topic!==selectedTopic)kind=refs.development?.opportunity?.free?'self_exploration':'unknown';
  }
  if(kind==='self_exploration'&&!refs.development?.opportunity?.free)kind='unknown';
  const obligation=refs.social?.commitments?.find(c=>c.id===compiled.commitment_id&&['accepted','meeting','working'].includes(c.status));
  if(kind==='accepted_obligation'&&!obligation)kind='unknown';
  if(kind==='invited'&&!sources.some(s=>['user','agent'].includes(s.category)))kind='unknown';
  return {life_source_ids:sourceIds,life_source_context:sources.map(s=>({...copy(s),record_id:s.id})),
    life_motivation:{kind,facet_root_ids:priorRoot?[priorRoot]:[],...(obligation?{commitment_id:obligation.id}:{})},life_decision:{source:'asamana_cognition',request_id:life.job.id,memory_ids:[]},
    ...(priorRoot?{life_followup:{id:`continuation:${life.job.id}`,source_root_id:priorRoot}}:{})};
}
