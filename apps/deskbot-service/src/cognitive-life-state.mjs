import {createHash} from 'node:crypto';
import {activeWorldTask,startActivityTask,startTravelTask} from './realtime-world.mjs';
import {livingReadModel,advanceLivingResources} from './living-resources.mjs';
import {residentDesign} from './resident-life.mjs';
import {COGNITIVE_CONTEXT_VERSION,cognitiveInputs,perceptionFact,cognitiveWorkingState,freezeCognitiveReferences,adoptPersonalContinuity,cognitiveCause} from './cognitive-continuity.mjs';
import {interpretationWindow,adoptInterpretations,refractionDialogue} from './cognitive-refraction.mjs';

import {fantasyPersonalContext} from './fantasy-inquiry.mjs';
import {resonantPersonalContext} from './resonant-life.mjs';
import {cognitiveDestinations,resolveCognitiveRoute} from './cognitive-travel.mjs';
import {cognitiveSocialContext,cognitiveSpeechEvidence,compileCognitiveMessage,commitCognitiveMessage,adoptCognitiveRelationViews} from './cognitive-social.mjs';
import {cognitiveDevelopmentContext,adoptCognitiveDevelopment,cognitiveTrialLink,attachCognitiveTrial} from './cognitive-development.mjs';

export const COGNITIVE_ACTORS=['shaping-001','wetland-grower-001','lamp-keeper-001'];
export const cognitiveActorIds=world=>[...new Set([...COGNITIVE_ACTORS,...(world.cognition?.admitted_actors??[])])].filter(id=>cognitivePerson(world,id));
const copy=structuredClone;
function fail(code,message=code){throw Object.assign(new Error(message),{code,statusCode:409});}
export function cognitivePerson(world,id){return world.protagonist.character_id===id?world.protagonist:world.npcs.find(p=>p.npc_id===id);}
export function cognitiveRelevantKey(world,id){
  const p=cognitivePerson(world,id);return createHash('sha256').update(JSON.stringify([p?.location_id,world.cognition?.actors[id]?.version??0,
    activeWorldTask(world,id)?.task_id??null])).digest('hex');
}
export function cognitiveContext(world,id,at,phase='plan'){
  const p=cognitivePerson(world,id);if(!p||!cognitiveActorIds(world).includes(id))fail('cognitive_actor_unknown');
  const role=residentDesign(id),need=world.autonomy?.actors[id],saved=world.cognition?.actors[id]??{};
  const definitions=world.map_catalog?.objects??[];
  const objects=Object.values(world.living?.objects??{}).map(o=>{
    const definition=definitions.find(d=>d.object_id===o.object_id),area=world.map_catalog?.areas.find(a=>a.area_id===definition?.area_id);
    return {...copy(definition??{}),...copy(o),location_id:area?.location_id};
  }).filter(o=>o.location_id===p.location_id);
  const catalogue=livingReadModel(world,id,{at})?.activities.filter(a=>a.location_id===p.location_id)??[];
  const inputs=cognitiveInputs(world,id,at),seen=new Set((saved.perception_receipts??[]).map(r=>r.source_id));
  const perceptions=inputs.filter(s=>!seen.has(s.id)).slice(0,id===world.protagonist.character_id?5:3);
  return {schema:COGNITIVE_CONTEXT_VERSION,phase,mode:'real',world_id:world.world_id,epoch:world.cognition?.epoch??at,at,
    actor:{actor_id:id,name:p.display_name??'喵呜',role:role?.role??'聚形域伴生个体',traits:id==='shaping-001'?['好奇','有自己的节奏','先观察再判断']:[role?.temperament??'关心自己的生活'],
      values:id==='lamp-keeper-001'?['可靠','把光照与安全联系起来']:id==='wetland-grower-001'?['照料生命','在实际苗况中调整方法']:['具体可靠','愿意探索'],
      background:role?JSON.stringify({desires:role.desires,likes:role.likes,flaws:role.flaws}):'现实桌边的光粒造物，虚拟化身生活在聚形域。',
      energy:need?.energy??.8,appetite:need?.appetite??.2,need_weights:id==='lamp-keeper-001'?{safety:1.4,esteem:1.1}:id==='wetland-grower-001'?{social:1.2,self_actualization:1.3}:{self_actualization:1.45}},
    saved:cognitiveWorkingState(saved,[saved.followup?.question,...inputs.map(i=>i.content)].join(' ')),inputs,perceptions,refraction:interpretationWindow(inputs,saved,p.location_id),
    location:{id:p.location_id,name:world.locations.find(l=>l.location_id===p.location_id)?.name??p.location_id,description:'伴生于现实的聚形域；虚拟观察只能读取现场公开状态。'},
    objects:objects.map((o,i)=>({object_index:i+1,id:o.object_id,name:o.name??o.object_id,description:o.description??'实际生活对象',state:copy(o)})),
    visible_people:[world.protagonist,...world.npcs].filter(other=>other!==p&&other.location_id===p.location_id).map(other=>({actor_id:other.character_id??other.npc_id,name:other.display_name})),
    development:cognitiveDevelopmentContext(world,id,at),social:cognitiveSocialContext(world,id,at),speech_evidence:cognitiveSpeechEvidence(world,id,at,objects.map(o=>({id:o.object_id,name:o.name??o.object_id,state:o}))),
    inventory:copy(world.living?.inventories[id]??{stock:{},capacity:24}),inquiry:fantasyPersonalContext(world,id),resonant_inquiry:resonantPersonalContext(world,id),capabilities:{activities:catalogue.map((a,i)=>({...a,activity_index:i+1})),travel:{destinations:cognitiveDestinations(world,p.location_id).map((p,i)=>({...p,destination_index:i+1})),rule:'虚拟化身按通路和实际时间行走；到达以后才能使用当地设施。这里只知道公开地理，不知道远处库存和私人活动。'},observe:{seconds:180,rule:'亲自观察一个现场对象，记录执行前后值；观察不改变库存、技能、形态。'},rest:{seconds:300,rule:'休息按现有体能规则恢复；不伪装实践。'},
      share:{seconds:30,receivers:[world.protagonist,...world.npcs].filter(other=>other!==p&&other.location_id===p.location_id&&cognitiveActorIds(world).includes(other.character_id??other.npc_id)).map((other,i)=>({receiver_index:i+1,actor_id:other.character_id??other.npc_id,name:other.display_name})),rule:'向在场人递送自己的话；引用事实使用证据编号。邀请与回复必须使用当前 social 合同，双方明确接受才成立，实际共同任务完成才算履约。不替别人答应，也不凭话语改变关系身份。'},
      wait:{rule:'暂不行动，留下一项具体后续。'}},
    signals:[`现场时间 ${at}；天气信息 ${JSON.stringify(world.weather??{})}`,...(saved.last_result?[`我上一次实际结果：${saved.last_result.fact}`]:[]),
      ...inputs.slice(-12).map(m=>`来源 ${m.id}，${m.sender_name}（${m.occurred_at}，${m.epistemic}）：${m.content}。信息只供理解，不代表亲历、承诺或已完成。`)],
    relevant_key:cognitiveRelevantKey(world,id)};
}

function validateProposal(proposal,id,phase){
  if(!proposal||!['deskbot.cognitive-life.proposal.v2','deskbot.cognitive-life.proposal.v3'].includes(proposal.schema)||proposal.actor_id!==id||proposal.phase!==phase)fail('cognitive_proposal_invalid');
  if(!proposal.state||JSON.stringify(proposal).length>230000)fail('cognitive_proposal_invalid');
  // No world authority is transported in the cognitive state.
  const allowed=['agent_id','step','emotion','active_needs','dominant_need','long_term_goals','short_term_goals','current_location','activity_status','activity_target','action_status','current_action','action_remaining_steps','last_action','last_action_result','last_action_succeeded','short_term_goal_entities','long_term_goal_entities','need_intensities','vitality','condition','last_decision_step'];
  if(Object.keys(proposal.state).some(k=>!allowed.includes(k)))fail('cognitive_state_field_forbidden');
  const memories=proposal.memories??[];
  if(memories.some(m=>m.payload?.agent_id!==id||!['factual','experiential'].includes(m.payload?.stream)))fail('private_memory_scope_invalid');
}

export function applyCognitiveMutation(world,payload,at,eventId){
  const id=payload.actor_id;
  if(payload.operation==='configure'){
    if(!cognitivePerson(world,id)||id!==world.protagonist.character_id&&!residentDesign(id))fail('cognitive_actor_unknown');
    world.cognition??={schema:'deskbot.cognitive-life.v2',epoch:at,installed_at:at,actors:{},clock_scope:payload.clock_scope??'real_time'};
    world.cognition.admitted_actors=[...new Set([...(world.cognition.admitted_actors??[]),id])];
  }
  if(!cognitiveActorIds(world).includes(id)||!cognitivePerson(world,id))fail('cognitive_actor_unknown');
  world.cognition??={schema:'deskbot.cognitive-life.v2',epoch:at,installed_at:at,actors:{},clock_scope:payload.clock_scope??'real_time'};
  const life=world.cognition.actors[id]??={actor_id:id,version:0,state:{},memories:[],history:[],enabled:false,plan_count:0,followup:null};
  if(payload.operation==='configure'){
    if(typeof payload.enabled!=='boolean'||typeof payload.continuous!=='boolean')fail('cognitive_configuration_invalid');
    life.enabled=payload.enabled;life.continuous=payload.continuous;life.enabled_at??=at;
    life.pilot_plan_limit=payload.continuous?null:4;life.next_decision_at??=at;
    return {accepted:true,enabled:life.enabled,continuous:life.continuous};
  }
  if(payload.operation==='rest_window'){
    if(!life.continuous||!life.enabled||life.pending||activeWorldTask(world,id))fail('cognitive_rest_unavailable');
    const started=startActivityTask(world,{task_id:`cognitive-rest:${eventId}`,actor_id:id,kind:'care',title:'留一段安静休息的时间',duration_seconds:3600},{eventId,at});
    const task=world.tasks.find(t=>t.task_id===started.task_id);task.origin='cognitive_rest';task.life_action='rest';
    life.schedule={...life.schedule,last_dispatch_at:at,reason:payload.reason,quiet_until:task.due_at};
    return {accepted:true,task_id:task.task_id,paid_calls:0};
  }
  if(payload.operation==='claim'){
    if(life.job&&life.job.id!==payload.job_id&&life.job.status==='calling')fail('actor_cognition_in_progress');
    if(payload.phase==='plan'&&activeWorldTask(world,id))fail('cognitive_actor_busy');
    if(payload.phase==='plan'&&life.pending)fail('pending_result_requires_feedback');
    if(payload.phase==='plan'&&['planned','executing'].includes(world.autonomy?.actors[id]?.plan?.status))fail('cognitive_actor_busy','先完成原已接受的生活安排，再进入认知试运行。');
    if(payload.phase==='feedback'&&!life.pending)fail('feedback_without_result');
    if(payload.phase==='plan')life.enabled=true;
    life.pilot_plan_limit=life.continuous?null:payload.max_plans??4;life.job={id:payload.job_id,phase:payload.phase,status:'calling',started_at:at};
    life.schedule={...life.schedule,last_dispatch_at:at,reason:payload.reason??payload.phase};
    life.job.references=freezeCognitiveReferences(cognitiveContext(world,id,at,payload.phase));
    life.job.relevant_key=cognitiveRelevantKey(world,id);
    return {accepted:true,claimed:true};
  }
  if(life.job?.id!==payload.job_id)fail('cognitive_job_obsolete');
  if(payload.operation==='error'){
    life.job.status='failed';life.job.error=payload.error;
    const retryable=(life.retry?.attempt??0)<3&&(payload.retryable===true||['interrupted_on_restart','python_timeout','cognitive_context_changed','activity_reference_unavailable','object_reference_unavailable','message_reference_unavailable','cognitive_source_expired'].includes(payload.error)||/^fetch_|^network_/.test(payload.error??''));
    life.retry={phase:payload.phase??life.job.phase,reason:payload.error,attempt:(life.retry?.attempt??0)+1,at:new Date(Date.parse(at)+Math.min(15*60000,30000*2**Math.min(life.retry?.attempt??0,5))).toISOString(),retryable};
    // Pending feedback keeps ownership even on a terminal error: the old planner cannot overwrite an unfinished cognitive episode.
    if(!retryable&&!life.pending)life.enabled=false;
    return {accepted:true,reason:payload.error};
  }
  if(payload.operation==='perceive'){
    validateProposal(payload.proposal,id,'perceive');
    const allowed=life.job.references.perceptions,old=new Map(life.memories.map(m=>[m.id,m])),received=[];
    for(const memory of payload.proposal.memories??[]){
      if(old.has(memory.id))continue;
      let metadata;try{metadata=JSON.parse(memory.payload.metadata_json??'{}');}catch{fail('perception_source_invalid');}
      const source=allowed.find(s=>s.id===metadata.message_id);
      if(!source||memory.payload.stream!=='factual'||memory.payload.kind!=='event'||memory.payload.raw_content!==perceptionFact(source)||memory.payload.stored_content!==perceptionFact(source))fail('perception_source_invalid');
      if(received.some(s=>s.id===source.id)||(life.perception_receipts??[]).some(r=>r.source_id===source.id))fail('perception_duplicate_source');
      memory.source_record_id=source.id;memory.epistemic=source.epistemic;memory.root_outcome_id=source.root_outcome_id??`source:${source.id}`;
      memory.occurred_at=source.occurred_at;memory.interpreted_at=at;old.set(memory.id,copy(memory));received.push(source);
    }
    life.memories=[...old.values()];life.memory_sequence=payload.proposal.memory_sequence??life.memory_sequence;
    adoptPersonalContinuity(world,id,life,payload.proposal,at,{perceptionSources:received});
    life.perception_receipts=[...(life.perception_receipts??[]),...received.map(s=>({source_id:s.id,at,epistemic:s.epistemic}))].slice(-512);
    life.version++;life.job.status='completed';life.retry=null;
    return {accepted:true,received_source_ids:received.map(s=>s.id),practice:false};
  }
  if(payload.operation==='interpret'){
    validateProposal(payload.proposal,id,'interpret');
    const adopted=adoptInterpretations(life,payload.proposal.interpretations,life.job.references,at);
    life.version++;life.job.status='completed';life.retry=null;
    return {accepted:true,interpretations:adopted,practice:false};
  }
  if(payload.operation==='reflect'){
    validateProposal(payload.proposal,id,'reflect');
    const known=new Map(life.memories.map(m=>[m.id,m]));
    for(const memory of payload.proposal.memories??[]){
      if(known.has(memory.id))continue;
      if(memory.payload.kind!=='insight'||!memory.payload.source_ids?.length||memory.payload.source_ids.some(source=>!known.has(source)))fail('reflection_source_unknown');
      memory.interpreted_at=at;memory.source_root_outcome_ids=[...new Set(memory.payload.source_ids.map(source=>known.get(source).root_outcome_id).filter(Boolean))];
      known.set(memory.id,copy(memory));
    }
    life.memories=[...known.values()];life.memory_sequence=payload.proposal.memory_sequence;life.reflection=copy(payload.proposal.reflection);
    adoptPersonalContinuity(world,id,life,payload.proposal,at);
    life.version++;life.reflection_count=(life.reflection_count??0)+1;life.job.status='completed';
    (life.maintenance??={}).reflect={at,memory_sequence:life.memory_sequence??0};
    return {accepted:true,insight_count:payload.proposal.reflection?.new_insights?.length??0};
  }
  if(payload.operation==='relate') {
    validateProposal(payload.proposal,id,'relate');
    adoptCognitiveRelationViews(life,payload.proposal.relation_views,life.job.references,at);
    life.version++;life.job.status='completed';life.retry=null;
    (life.maintenance??={}).relate={at};
    return {accepted:true,personal_views:life.relation_views.length,shared_relationship_changed:false};
  }
  if(payload.operation==='maintain'){
    validateProposal(payload.proposal,id,'maintain');
    adoptPersonalContinuity(world,id,life,payload.proposal,at);
    // Upstream revises personal goals only. Explicit commitments live separately.
    for(const key of ['long_term_goals','long_term_goal_entities'])if(payload.proposal.state[key])life.state[key]=copy(payload.proposal.state[key]);
    (life.maintenance??={}).maintain={at};life.version++;life.job.status='completed';life.retry=null;
    return {accepted:true,originals_retained:true};
  }
  if(payload.operation==='plan'){
    if(cognitiveRelevantKey(world,id)!==payload.relevant_key)fail('cognitive_context_changed');
    validateProposal(payload.proposal,id,'plan');
    const proposal=payload.proposal,compiled=proposal.compiled;
    if(!compiled||!['activity','observe','rest','share','wait','travel'].includes(compiled.operation)||typeof compiled.reason!=='string')fail('invalid_intent_compilation');
    const context=cognitiveContext(world,id,at),refs=life.job.references;
    if(!refs||refs.location_id!==context.location.id)fail('cognitive_context_changed');
    // Validate optional choices before reserving resources or changing personal state.
    adoptCognitiveDevelopment(copy(world),id,compiled,refs,at);
    if(proposal.interpretations)adoptInterpretations(life,proposal.interpretations,refs,at);
    const cause=cognitiveCause(world,id,compiled,refs,life);
    if(cause.life_source_context.some(s=>s.expires_at&&s.expires_at<=at))fail('cognitive_source_expired');
    life.observed_object=null;life.outgoing_message=null;
    life.state=copy(proposal.state);life.intent=copy(proposal.action);life.reason=proposal.action?.inner_monologue??compiled.reason;
    life.compiled=copy(compiled);life.version++;life.plan_count++;life.job.status='completed';
    let task=null,blocked=null;
    const before=copy(context.objects);
    if(compiled.operation!=='wait'){
      const args={task_id:`cognitive:${payload.job_id}`,actor_id:id,kind:'care',title:String(compiled.title??proposal.action?.action_description??'观察现场').slice(0,200)};
      if(compiled.operation==='activity'){
        const indexed=Number.isSafeInteger(compiled.activity_index)&&compiled.activity_index>0?refs.activities[compiled.activity_index-1]:null;
        const activityId=compiled.activity_id??indexed;
        if(!activityId||!refs.activities.includes(activityId)||compiled.activity_id&&indexed&&indexed!==compiled.activity_id)fail('activity_reference_invalid');
        const selected=context.capabilities.activities.find(a=>a.activity_id===activityId);
        if(!selected)fail('activity_reference_unavailable');
        args.activity_id=selected.activity_id;
      }else if(compiled.operation==='observe'){
        if(!Number.isSafeInteger(compiled.object_index)||compiled.object_index<1)fail('object_reference_invalid');
        const objectId=refs.objects[compiled.object_index-1];if(!objectId)fail('object_reference_invalid');
        const selected=context.objects.find(o=>o.id===objectId);if(!selected)fail('object_reference_unavailable');
        args.duration_seconds=180;args.title=`观察${selected.name}`;life.observed_object=selected.id;
      }else if(compiled.operation==='share'){
        const indices=compiled.receiver_indices??(Number.isSafeInteger(compiled.receiver_index)?[compiled.receiver_index]:[]);
        if(!Array.isArray(indices)||!indices.length||new Set(indices).size!==indices.length||indices.some(n=>!Number.isSafeInteger(n)||n<1||!refs.receivers[n-1]))fail('message_reference_invalid');
        const receivers=indices.map(n=>context.capabilities.share.receivers.find(r=>r.actor_id===refs.receivers[n-1]));if(receivers.some(r=>!r))fail('message_reference_unavailable');
        args.duration_seconds=30;life.outgoing_message={receiver_ids:receivers.map(r=>r.actor_id),
          receiver_names:receivers.map(r=>r.name),sender_id:id,sender_name:context.actor.name,...compileCognitiveMessage(world,id,compiled,refs,receivers.map(r=>r.actor_id),at)};
      }else if(compiled.operation==='rest'){args.duration_seconds=300;args.title='休息片刻';}
      // A rejected activity runs against a copy: no partial resource reservation leaks.
      const trial=copy(world);
      try{
        advanceLivingResources(trial,at,{force:true});
        const trialLink=compiled.operation==='activity'?cognitiveTrialLink(trial,id,args.activity_id,at):null;
        const started=compiled.operation==='travel'
          ?startTravelTask(trial,{eventId,at,actorId:id,reason:compiled.reason,...resolveCognitiveRoute(trial,refs,compiled.destination_index)})
          :startActivityTask(trial,args,{eventId,at});
        task=trial.tasks.find(t=>t.task_id===started.task_id);task.origin='cognitive_life';task.cognitive_job_id=payload.job_id;
        task.cognitive_operation=compiled.operation;task.cognitive_object_id=life.observed_object??null;task.cognitive_message=copy(life.outgoing_message??null);
        task.root_outcome_id=`task:${task.task_id}`;Object.assign(task,copy(cause));
        attachCognitiveTrial(trial,task,trialLink,at);
        if(compiled.operation==='travel')task.life_action='travel';
        if(compiled.operation==='rest')task.life_action='rest';
        if(compiled.operation==='observe'){task.life_action='observe';task.target_object_id=life.observed_object;task.life_topic='explore';}
        if(compiled.operation==='share'){task.life_action='social';task.target_actor_ids=life.outgoing_message.receiver_ids;}
        Object.assign(world,trial);
      }catch(error){if(!error.code)throw error;blocked={code:error.code,message:error.message};}
    }
    const landed=world.cognition.actors[id];
    adoptCognitiveDevelopment(world,id,compiled,refs,at,{task,blocked});
    landed.pending={root_outcome_id:task?`task:${task.task_id}`:`attempt:${payload.job_id}`,task_id:task?.task_id??null,action:copy(proposal.action),before,from_location_id:refs.location_id,blocked,created_at:at};
    adoptPersonalContinuity(world,id,landed,proposal,at);landed.retry=null;
    if(compiled.operation==='wait'){
      landed.pending=null;landed.followup={status:compiled.followup_decision==='drop'?'drop':'postpone',question:compiled.reason,reason:'此回合决定暂不执行',next_review_at:new Date(Date.parse(at)+4*3600000).toISOString()};
      landed.next_decision_at=landed.followup.next_review_at;
      if(landed.pilot_plan_limit!==null&&landed.plan_count>=landed.pilot_plan_limit){landed.enabled=false;landed.pilot_finished_at=at;}
    }
    landed.history.push({job_id:payload.job_id,phase:'plan',at,intent:copy(proposal.action),compiled:copy(compiled),task_id:task?.task_id??null,blocked});
    landed.history=landed.history.slice(-24);
    return {accepted:true,task_id:task?.task_id??null,blocked,operation:compiled.operation};
  }
  if(payload.operation==='feedback'){
    validateProposal(payload.proposal,id,'feedback');
    const pending=life.pending;if(!pending||pending.root_outcome_id!==payload.result.root_outcome_id)fail('result_root_changed');
    const task=pending.task_id?world.tasks.find(t=>t.task_id===pending.task_id):null;
    if(task&&!['completed','failed','cancelled'].includes(task.status))fail('result_not_terminal');
    if(JSON.stringify(cognitiveActualResult(world,id,payload.result.occurred_at))!==JSON.stringify(payload.result))fail('cognitive_actual_result_changed');
    const proposal=payload.proposal,followup=proposal.followup;
    if(!followup||!['continue','postpone','drop','none'].includes(followup.status)||typeof followup.question!=='string'||typeof followup.reason!=='string'||!Number.isSafeInteger(followup.delay_hours)||followup.delay_hours<1||followup.delay_hours>48)fail('followup_invalid');
    // Existing factual IDs/raw sources never overwritten by a later interpretation.
    const old=new Map(life.memories.map(m=>[m.id,m]));
    for(const memory of proposal.memories??[]){
      if(old.has(memory.id))continue;
      let interruptedGoal=null;
      if(memory.payload.stream==='factual'&&memory.payload.raw_content!==payload.result.personal_fact){
        interruptedGoal=(life.state.short_term_goal_entities??[]).find(g=>g.status!=='interrupted'
          &&memory.payload.raw_content===`短期目标被中断，尚未完成：${g.text}`
          &&proposal.state.short_term_goal_entities?.some(next=>next.id===g.id&&next.text===g.text&&next.status==='interrupted'));
      }
      if(memory.payload.stream==='factual'&&(memory.payload.kind!=='event'||memory.payload.stored_content!==memory.payload.raw_content||memory.payload.raw_content!==payload.result.personal_fact&&!interruptedGoal))fail('cognitive_factual_record_changed');
      if(interruptedGoal){memory.epistemic='personal_goal_transition';memory.goal_id=interruptedGoal.id;}
      memory.root_outcome_id=pending.root_outcome_id;
      memory.occurred_at=payload.result.occurred_at;memory.interpreted_at=at;
      if(memory.payload.kind==='insight' && memory.payload.source_ids?.some(source=>!old.has(source)&&!(proposal.memories??[]).some(m=>m.id===source)))fail('reflection_source_unknown');
      old.set(memory.id,copy(memory));
    }
    life.memories=[...old.values()];life.memory_sequence=proposal.memory_sequence;
    adoptPersonalContinuity(world,id,life,proposal,at);
    life.state=copy(proposal.state);life.last_result=copy(payload.result);life.reflection=copy(proposal.reflection??null);
    life.followup={...copy(followup),next_review_at:new Date(Date.parse(at)+followup.delay_hours*3600000).toISOString(),from_root_outcome_id:pending.root_outcome_id};
    life.pending=null;life.version++;life.job.status='completed';life.retry=null;life.next_decision_at=life.followup.next_review_at;
    if(life.pilot_plan_limit!==null&&life.plan_count>=life.pilot_plan_limit){life.enabled=false;life.pilot_finished_at=at;}
    life.history.push({job_id:payload.job_id,phase:'feedback',at,result:copy(payload.result),followup:copy(life.followup)});life.history=life.history.slice(-24);
    return {accepted:true,root_outcome_id:payload.result.root_outcome_id};
  }
  fail('unknown_cognitive_operation');
}

export function cognitiveActualResult(world,id,at){
  const life=world.cognition?.actors[id],pending=life?.pending;if(!pending)return null;
  const task=pending.task_id?world.tasks.find(t=>t.task_id===pending.task_id):null;
  if(task&&!['completed','failed','cancelled'].includes(task.status))return null;
  const success=task?.status==='completed',context=cognitiveContext(world,id,at),after=task?.cognitive_observation?.objects??context.objects;
    const message=task?.cognitive_operation==='share'?success?`向${task.cognitive_message?.receiver_names?.join('、')??'指定收件人'}实际留言：${task.cognitive_message?.text}。本次只核验留言送达；后续回应以收到的消息为准。`:`留言未送达。原计划内容：${task.cognitive_message?.text}。`:null;
    const travel=task?.kind==='travel'?`出发地点：${pending.from_location_id}；实际所在地点：${context.location.name}（${context.location.id}）；原计划目的地：${task.destination_location_id}。移动没有完成当地其他活动。`:null;
    const comparison=task?.completion?.result?.before&&task?.completion?.result?.after
      ?`；任务作用前后（用于判断本次活动的增量，不能拿更早一天的数值代替前值）：${JSON.stringify({before:task.completion.result.before,after:task.completion.result.after,...(task.completion.result.fantasy_result?{experiment:task.completion.result.fantasy_result}:{})})}`:'';
    const fact=pending.blocked?`意图未能执行：${pending.blocked.message}`:task?`${cognitivePerson(world,id).display_name??'喵呜'}的任务「${task.title}」${success?'已实际完成':'未完成'}。${task.failure_reason??''}；${message??travel??`执行前现场：${JSON.stringify(pending.before.map(o=>({id:o.id,state:o.state})))}；执行后现场：${JSON.stringify(after.map(o=>({id:o.id,state:o.state})))}`}${comparison}`:'此回合没有实际任务。';
  return {root_outcome_id:pending.root_outcome_id,task_id:pending.task_id,success,not_executed:!task,
    failure_reason:pending.blocked?.message??task?.failure_reason??'',fact,personal_fact:`我亲身经历的结果：${fact}`,
    before:pending.before,after,occurred_at:task?.completion?.due_at??at};
}

export function settleCognitiveTask(world,task,at){
  if(task.origin!=='cognitive_life'||task.status!=='completed')return;
  if(task.cognitive_operation==='share'&&!task.cognitive_message_delivered_at){
    let message=task.cognitive_message;const receivers=message.receiver_ids??[message.receiver_id];
    if(receivers.some(id=>cognitivePerson(world,id)?.location_id!==task.location_id)){
      task.status='failed';task.failure_reason='留言对象已离开现场';task.failure_code='receiver_left';task.failure_classification='route';
      if(task.completion)task.completion.effect='no_effect';return;
    }
    // Agreement and reply receipts commit together with delivery. A stale reply
    // cannot partially create an invitation or change another person's decision.
    try {
      const trial=copy(world),trialTask=trial.tasks.find(t=>t.task_id===task.task_id);
      commitCognitiveMessage(trial,trialTask,at);
      world.social=trial.social;world.cognition=trial.cognition;
      task.cognitive_message=trialTask.cognitive_message;message=task.cognitive_message;
    } catch(error) {
      if(!error.code)throw error;task.status='failed';task.failure_reason=error.message;task.failure_code=error.code;task.failure_classification='coordination';
      if(task.completion)task.completion.effect='no_effect';return;
    }
    for(const id of receivers){
      const life=world.cognition.actors[id]??={actor_id:id,version:0,state:{},memories:[],history:[],enabled:false,plan_count:0,followup:null};
      life.inbox??=[];
      if(!life.inbox.some(m=>m.task_id===task.task_id)){
        life.inbox.push({...copy(message),message_id:`message:${task.task_id}:${id}`,task_id:task.task_id,at,source_kind:'heard_message',root_outcome_id:task.root_outcome_id??`task:${task.task_id}`});
        life.inbox=life.inbox.slice(-256);life.input_version=(life.input_version??0)+1;
      }
    }
    task.cognitive_message_delivered_at=at;
  }
  task.cognitive_observation={at,objects:cognitiveContext(world,task.actor_id,at).objects};
}

export function cognitiveDialogueContext(world,id){
  const life=world?.cognition?.actors[id];if(!life)return null;
  const task=world.tasks.find(t=>t.task_id===life.pending?.task_id);
  return {source:'same_canonical_cognitive_life',why:life.reason,current_task:task?{title:task.title,status:task.status,due_at:task.due_at}:null,
    actual_result:life.last_result?{fact:life.last_result.fact,occurred_at:life.last_result.occurred_at,root_outcome_id:life.last_result.root_outcome_id}:null,
    followup:life.followup,goals:life.state.short_term_goal_entities,emotion:life.state.emotion,
    understood_inputs:refractionDialogue(life,world.clock?.synced_at??new Date().toISOString()),
    rule:'认知目标、心情与后续不是已经完成的事实；仅实际结果与任务状态能支持完成声明。'};
}
