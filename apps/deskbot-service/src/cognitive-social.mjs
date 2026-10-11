import {proposeCognitiveCommitment,respondCognitiveCommitment} from './social-life.mjs';

const copy=structuredClone;
const person=(w,id)=>w.protagonist.character_id===id?w.protagonist:w.npcs.find(p=>p.npc_id===id);
const fail=(code)=>{throw Object.assign(new Error(code),{code,statusCode:409});};
const live=c=>['proposed','accepted','meeting','working'].includes(c.status);
const lifeFor=(w,id)=>w.cognition.actors[id]??={actor_id:id,version:0,state:{},memories:[],history:[],enabled:false,plan_count:0,followup:null};

/** Public shared terms only. A partner's needs, bag and private memory are absent. */
export function cognitiveSocialContext(w,id,at) {
  const own=person(w,id),life=w.cognition?.actors[id]??{},options=[];
  if(w.social&&own) {
    options.push({option_id:'visit',kind:'visit',title:'一起聊一会儿',location_id:own.location_id,reason:'留一段双方都愿意的时间交流',actor_order:'initiator_receiver'});
    if(own.location_id==='warm-pot-courtyard'&&(w.living?.objects['shared-table']?.stock.rations??0)>=2)
      options.push({option_id:'meal',kind:'meal',title:'一起吃一顿饭',location_id:own.location_id,reason:'目前长桌有两份饭；到场后再次核验',actor_order:'initiator_receiver'});
    if((w.living?.inventories[id]?.stock.trays??0)>0)
      options.push({option_id:'give-tray',kind:'exchange',title:'送出一只现有托盘',location_id:own.location_id,reason:'只交接自己确实拥有的一只托盘',actor_order:'initiator_receiver',offers:[{resource:'trays',count:1,from:'initiator',to:'receiver'}]});
    if(own.location_id==='moss-sprout-garden')
      options.push({option_id:'ask-tray-help',kind:'cooperate',title:'商量制作一只苗圃托盘',location_id:own.location_id,reason:'请对方沿实际通路备料制作，回来交接一只托盘',actor_order:'receiver_initiator',produce_activity:'craft-tray',resource:'trays'});
  }
  const commitments=(w.social?.commitments??[]).filter(c=>c.control==='cognitive'&&c.actors.includes(id)).slice(-16).map(c=>({
    id:c.id,terms_revision:c.terms_revision,title:c.title,kind:c.kind,status:c.status,actors:copy(c.actors),initiator_id:c.initiator_id,
    location_id:c.location_id,deadline_at:c.deadline_at,not_before_at:c.not_before_at??null,responses:copy(c.responses),last_note:c.last_note,
    available_responses:!live(c)?[]:c.status==='proposed'&&c.responses[id]==='pending'?['accept','decline','delay','withdraw']:['withdraw'],
  }));
  const relationEvidence=[];
  for(const peer of [w.protagonist,...w.npcs].map(p=>p.character_id??p.npc_id).filter(peer=>peer!==id)) {
    const sources=[...(life.inbox??[]).filter(m=>m.sender_id===peer).slice(-3).map(m=>({id:m.message_id,root:m.root_outcome_id,at:m.at,text:`对方实际留言（其中内容未必属实）：${m.text}`})),
      ...(life.outbox??[]).filter(m=>m.receiver_ids?.includes(peer)).slice(-3).map(m=>({id:m.message_id,root:m.root_outcome_id,at:m.at,text:`我实际送出的消息：${m.text}`})),
      ...(w.social?.commitments??[]).filter(c=>c.control==='cognitive'&&c.actors.includes(id)&&c.actors.includes(peer)&&!live(c)).slice(-3).map(c=>({id:`commitment:${c.id}`,root:`commitment:${c.id}`,at:c.finished_at,text:`实际共同事务「${c.title}」：${c.status}，${c.last_note}`}))];
    if(sources.length)relationEvidence.push({actor_id:peer,name:person(w,peer)?.display_name??peer,sources:sources.sort((a,b)=>a.at.localeCompare(b.at)).slice(-6)});
  }
  return {options,commitments,relation_evidence:relationEvidence.slice(-8),personal_views:copy(life.relation_views??[]),replies:(life.inbox??[]).slice(-12).map(m=>({message_id:m.message_id,sender_id:m.sender_id,text:m.text,reply_to:m.reply_to??null,at:m.at})),
    rule:'邀请不等于接受。仅自己可回复；延期是一份新条件，仍需对方确认。共同结果只记录实际任务，各自理解保持私有。'};
}

export function adoptCognitiveRelationViews(life,views,refs,at) {
  if(!Array.isArray(views)||views.length>8)fail('relation_views_invalid');
  const prior=new Map((life.relation_views??[]).map(v=>[v.actor_id,v]));
  for(const view of views){
    const available=refs.social?.relation_evidence.find(e=>e.actor_id===view.actor_id);
    if(!available||!Array.isArray(view.source_ids)||!view.source_ids.length||view.source_ids.some(id=>!available.sources.some(s=>s.id===id)))fail('relation_view_source_invalid');
    if(!Array.isArray(view.labels)||view.labels.length>3||view.labels.some(l=>!['想合作','想多了解','暂时保留','熟悉','不确定'].includes(l))||typeof view.summary!=='string'||view.summary.length>180)fail('relation_view_content_invalid');
    prior.set(view.actor_id,{...copy(view),epistemic:'personal_impression',updated_at:at});
  }
  life.relation_views=[...prior.values()];life.relation_reviewed_at=at;
}

/** Server-authored evidence snippets let a speaker cite facts without paraphrase drift. */
export function cognitiveSpeechEvidence(w,id,at,objects) {
  const life=w.cognition?.actors[id]??{},evidence=[];
  for(const o of objects) {
    const values=['moisture','health','growth','condition'].filter(k=>typeof o.state[k]==='number').map(k=>`${k}=${Number(o.state[k].toFixed(3))}`);
    const stock=Object.entries(o.state.stock??{}).map(([k,v])=>`${k}=${v}`);
    if(values.length||stock.length)evidence.push({id:`observation:${o.id}:${at}`,kind:'observation',text:`我在${at}看到${o.name}：${[...values,...stock].join('，')}。`});
  }
  if(life.last_result)evidence.push({id:life.last_result.root_outcome_id,kind:'completed',text:life.last_result.success?`我的任务「${w.tasks.find(t=>t.task_id===life.last_result.task_id)?.title??'已记录任务'}」已实际完成。`:`我上次的意图没有完成：${life.last_result.failure_reason||'实际记录未完成'}。`});
  for(const m of (life.inbox??[]).slice(-8))evidence.push({id:m.message_id,kind:m.source_kind==='joint_result'?'shared_result':'hearsay',text:`${m.sender_name??'居民'}在${m.at}留下消息：${m.text}`});
  return evidence;
}

export function compileCognitiveMessage(w,id,compiled,refs,receiverIds,at) {
  const life=w.cognition.actors[id],reply=compiled.reply_to??null;
  if(reply) {
    const message=refs.social?.replies.find(m=>m.message_id===reply);
    if(!message||!receiverIds.includes(message.sender_id)||!life.inbox?.some(m=>m.message_id===reply))fail('reply_reference_invalid');
    if((life.outbox??[]).some(m=>m.reply_to===reply))fail('reply_already_delivered');
  }
  const parts=compiled.message_parts;
  let text;
  if(parts!==undefined) {
    if(!Array.isArray(parts)||parts.length>3)fail('speech_parts_invalid');
    text=parts.map(part=>{
      if(part.kind==='evidence') {
        const source=refs.speech_evidence?.find(e=>e.id===part.evidence_id);
        if(!source||part.quote!==undefined&&part.quote!==source.text)fail('speech_evidence_mismatch');
        return source.text;
      }
      if(!['question','hypothesis','intention','greeting'].includes(part.kind)||typeof part.text!=='string'||!part.text.trim()||part.text.length>160)fail('speech_part_invalid');
      // Free prose cannot smuggle past performance, other people's agreement or a
      // purported verified causal conclusion into an ungrounded question/intention.
      if(/已经|已完成|刚刚.*[做浇修]|刚[做浇修]|答应了|同意了|证明了|证实了|我做过|我浇过|我修过/.test(part.text))fail('speech_unverified_completion');
      if(compiled.social&&/[零一二三四五六七八九十\d]+(?:分钟|小时|点)|上午|下午|明天|今晚/.test(part.text))fail('social_time_requires_terms');
      if(part.kind==='greeting') {
        let greeting=part.text.replace(/[\s，。！？!?,、]/g,'');
        for(const receiver of receiverIds){const name=person(w,receiver)?.display_name;if(name&&greeting.startsWith(name))greeting=greeting.slice(name.length);else if(name&&greeting.endsWith(name))greeting=greeting.slice(0,-name.length);}
        if(!['你好','谢谢你','回头见','早上好','晚上好'].includes(greeting))fail('speech_greeting_invalid');
      }
      return part.kind==='hypothesis'?`我的猜想（尚未核验）：${part.text}`:part.kind==='intention'?`我的打算（尚未执行）：${part.text}`:part.kind==='question'?`我想问：${part.text}`:part.text;
    }).join('\n');
  } else text=compiled.message; // Preserve already-saved v3 messages; new compiler emits structured parts.
  const social=compiled.social??null;
  let command=null;
  if(social) {
    if(receiverIds.length!==1)fail('social_receiver_count');
    const receiver=receiverIds[0];
    if(social.operation==='invite') {
      const option=refs.social?.options.find(o=>o.option_id===social.option_id);if(!option)fail('social_option_invalid');
      command={operation:'invite',definition:{...copy(option),actors:option.actor_order==='receiver_initiator'?[receiver,id]:[id,receiver]},initiator_id:id};
      delete command.definition.actor_order;delete command.definition.option_id;
      if(option.offers)command.definition.offers=option.offers.map(o=>({...o,from:o.from==='initiator'?id:receiver,to:o.to==='receiver'?receiver:id}));
      text=`我想邀请你${option.title}。${option.reason}。目前只是邀请，你可以答应、拒绝或商量时间。`+(text?`\n${text}`:'');
    } else if(social.operation==='respond') {
      const c=refs.social?.commitments.find(c=>c.id===social.commitment_id);
      if(!c||!c.actors.includes(receiver)||!c.available_responses.includes(social.response))fail('social_response_scope');
      const current=w.social.commitments.find(x=>x.id===c.id);
      if(current?.terms_revision!==c.terms_revision||current.status!==c.status)fail('commitment_terms_changed');
      command={operation:'respond',commitment_id:c.id,revision:c.terms_revision,response:social.response,delay_minutes:social.delay_minutes??0};
      const response={accept:'我接受这版安排',decline:'这次我不参加',withdraw:'我退出这次约定',delay:`我想商量延后${command.delay_minutes}分钟，等你确认后再安排`}[social.response];
      text=`关于「${c.title}」：${response}。`+(text?`\n${text}`:'');
    } else fail('social_operation_invalid');
  }
  if(typeof text!=='string'||!text.trim()||text.length>1600)fail('message_text_invalid');
  return {text,reply_to:reply,social_command:command,speech_sources:(parts??[]).filter(p=>p.kind==='evidence').map(p=>p.evidence_id),speech_verified:parts!==undefined};
}

export function commitCognitiveMessage(w,task,at) {
  const message=task.cognitive_message,id=task.actor_id,life=lifeFor(w,id),messageId=`sent:${task.task_id}`;
  if(life.outbox?.some(m=>m.message_id===messageId))return;
  const command=message.social_command;
  if(command?.operation==='invite') {
    const c=proposeCognitiveCommitment(w,at,command.definition,id,messageId);message.commitment_id=c.id;
    (c.causes_by_actor??={})[id]=copy({life_source_ids:task.life_source_ids,life_source_context:task.life_source_context,life_motivation:task.life_motivation,life_decision:task.life_decision});
  } else if(command?.operation==='respond') {
    const c=respondCognitiveCommitment(w,at,command.commitment_id,id,command.response,{revision:command.revision,messageId,delayMinutes:command.delay_minutes});message.commitment_id=c.id;
    (c.causes_by_actor??={})[id]=copy({life_source_ids:task.life_source_ids,life_source_context:task.life_source_context,life_motivation:task.life_motivation,life_decision:task.life_decision});
  }
  life.outbox=[...(life.outbox??[]),{message_id:messageId,reply_to:message.reply_to,receiver_ids:message.receiver_ids,at,commitment_id:message.commitment_id??null,root_outcome_id:task.root_outcome_id,text:message.text}].slice(-128);
}

export function deliverCognitiveSocialResults(w,at) {
  for(const c of w.social?.commitments??[]) {
    if(c.control!=='cognitive'||live(c)||c.cognitive_result_delivered_at)continue;
    const root=`commitment:${c.id}`,taskIds=[...new Set((c.changes??[]).map(x=>x.task_id).filter(Boolean))];
    for(const id of c.actors) {
      const life=lifeFor(w,id),messageId=`shared-result:${c.id}:${id}`;
      if(!life.inbox?.some(m=>m.message_id===messageId)) {
        life.inbox=[...(life.inbox??[]),{message_id:messageId,task_id:null,sender_id:'canonical-social-result',sender_name:'共同事务记录',at:c.finished_at??at,
          text:`「${c.title}」${c.status==='completed'?'实际完成':'没有完成'}：${c.last_note}。自己已发生的任务：${taskIds.filter(t=>w.tasks.find(task=>task.task_id===t)?.actor_id===id).join('、')||'无'}。`,
          source_kind:'joint_result',root_outcome_id:root,commitment_id:c.id,source_task_ids:taskIds}].slice(-256);
        life.input_version=(life.input_version??0)+1;
      }
    }
    c.cognitive_result_delivered_at=at;
  }
}
