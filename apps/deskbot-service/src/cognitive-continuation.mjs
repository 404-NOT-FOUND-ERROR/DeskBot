// Personal follow-up conditions share the world's actual clock and task facts.
// These views never select an activity, invent a reply or alter a material law.
import {GLOW_LAW} from './fantasy-inquiry.mjs';
import {RESONANT_REVIEW_SECONDS} from './resonant-life.mjs';
import {WINDLEAF_LAW} from './windleaf-life.mjs';
const copy=structuredClone;
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};
const ms=value=>Date.parse(value);
const iso=value=>new Date(value).toISOString();
export function cognitiveTime(at,zone='Asia/Shanghai'){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 return {utc:iso(ms(at)),zone,local:`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`};
}
function methodReadyAt(w,id,activity){
 if(activity==='leaf-read'){
  const frame=w.living?.objects['windleaf-rack']?.leaf_frames?.find(f=>f.owner_id===id);
  if(frame){const base=Math.max(ms(frame.changed_at),ms(frame.last_read_at??frame.installed_at));return {ready_at:Number.isFinite(base)?iso(base+WINDLEAF_LAW.comparison_seconds*1000):null,asset_id:frame.frame_id};}
 }
 const frame=w.living?.objects['floating-frame'],board=w.living?.objects['square-noticeboard'],rack=w.living?.objects['seedling-rack'];
 const asset=activity==='echo-read-bell'?frame?.echo_bells?.find(b=>b.owner_id===id):activity==='night-read-lantern'?board?.night_lanterns?.find(b=>b.owner_id===id):null;
 if(asset){const base=asset.last_read_at??asset.changed_at;return {ready_at:Number.isFinite(ms(base))?iso(ms(base)+RESONANT_REVIEW_SECONDS*1000):null,asset_id:asset.bell_id??asset.lantern_id};}
 if(activity==='glow-read-pair'){
  const trial=rack?.glow_trials?.find(t=>t.owner_id===id);
  if(trial){const base=Math.max(ms(trial.changed_at),ms(trial.last_read_at??trial.started_at));return {ready_at:Number.isFinite(base)?iso(base+GLOW_LAW.comparison_seconds*1000):null,asset_id:trial.trial_id};}
 }
 return {};
}
const selectedOption=(options,value)=>options.find(o=>o.kind===value?.kind&&o.id===value?.id);
export function cognitiveContinuationContext(w,id,at,activities=[],commitments=[]){
 const life=w.cognition?.actors[id]??{},zone=w.clock?.time_zone??'Asia/Shanghai';
 const options=activities.map(a=>{
  const timing=methodReadyAt(w,id,a.activity_id);
  return {kind:'activity',id:a.activity_id,title:a.title,available:a.available,blocker:a.unavailable_reason??a.reason??null,
   ...timing,...(timing.ready_at?{ready_time:cognitiveTime(timing.ready_at,zone),minutes_until_clock_ready:Math.max(0,Math.ceil((ms(timing.ready_at)-ms(at))/60000))}:{})};
 });
 const outgoing=(life.outbox??[]).slice(-4),waitingMessage=(life.outbox??[]).find(m=>life.followup?.wait_for?.kind==='reply'&&m.message_id===life.followup.wait_for.id);
 if(waitingMessage&&!outgoing.includes(waitingMessage))outgoing.unshift(waitingMessage);
 for(const message of outgoing){
  const replies=(life.inbox??[]).filter(m=>m.reply_to===message.message_id&&message.receiver_ids?.includes(m.sender_id));
  options.push({kind:'reply',id:message.message_id,title:'等这条已送达消息的回应',sent_at:message.at,sent_time:cognitiveTime(message.at,zone),
   receiver_ids:copy(message.receiver_ids??[]),text:message.text,available:replies.length>0,reply_ids:replies.map(m=>m.message_id)});
 }
 for(const c of commitments)options.push({kind:'commitment',id:c.id,title:c.title,status:c.status,available:['completed','declined','withdrawn','failed','cancelled','expired'].includes(c.status),
  not_before_at:c.not_before_at??null,deadline_at:c.deadline_at??null});
 const f=life.followup,active=f&&['continue','postpone'].includes(f.status),option=active?selectedOption(options,f.wait_for):null;
 const since=f?.wait_started_at??f?.created_at??f?.from_at??(f?.next_review_at&&f?.delay_hours?iso(ms(f.next_review_at)-f.delay_hours*3600000):null);
 const deadline=option?.kind==='reply'&&since?iso(ms(since)+6*3600000):null;
 const condition=option?(option.available?'ready':deadline&&ms(at)>=ms(deadline)?'review_required':'waiting'):active?'unbound':'closed';
 return {schema:'deskbot.cognitive-continuation.v1',now:cognitiveTime(at,zone),wait_options:options,
  current:active?{...copy(f),condition,waiting_since:since,wait_deadline_at:deadline,
   next_review_time:f.next_review_at?cognitiveTime(f.next_review_at,zone):null,
   elapsed_minutes:since?Math.max(0,Math.floor((ms(at)-ms(since))/60000)):0,
   note:condition==='review_required'?'尚未收到关联回复；等待期限到了，需要自己决定换办法、暂缓或收束。期限不能靠重新措辞续期。':condition==='ready'?'所等条件已有实际依据；复查是否仍想继续，不把等待当成完成。':condition==='waiting'?'所等条件尚未满足；仍可做其他可行事务。':'后续未绑定具体条件，复查时需要自己说明下一步。'}:null,
  urgent_review:Boolean(active&&f.wait_for&&['ready','review_required'].includes(condition)),
  rule:'时间比较由服务端给出。方法可用只代表当前条件，不代表已执行；回复只能来自实际收到并关联的消息。等待不增加实践，复查不强迫行动或改变兴趣。'};
}
export function validateWaitFor(value,context){
 if(value===undefined||value===null)return null;
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['kind','id'].includes(k))||!selectedOption(context.wait_options,value))fail('followup_condition_unknown');
 return copy(value);
}
function reviewAt(at,minutes,waitFor,context,since){
 let next=ms(at)+minutes*60000;const option=selectedOption(context.wait_options,waitFor);
 if(option?.kind==='activity'&&option.ready_at&&ms(option.ready_at)>ms(at))next=Math.min(next,ms(option.ready_at));
 if(option?.kind==='reply')next=Math.min(next,Math.max(ms(at)+10*60000,ms(since)+6*3600000));
 if(option?.available)next=ms(at)+10*60000;
 return iso(next);
}
export function cognitiveWaitFollowup(life,compiled,context,at){
 const old=life.followup,decision=compiled.followup_decision??'postpone';
 const waitFor=Object.hasOwn(compiled,'wait_for')?validateWaitFor(compiled.wait_for,context):(['continue','postpone'].includes(old?.status)?copy(old.wait_for??null):null);
 const minutes=compiled.review_after_minutes??(waitFor?60:240);
 if(!Number.isSafeInteger(minutes)||minutes<10||minutes>240)fail('wait_review_invalid');
 const same=old&&['continue','postpone'].includes(old.status)&&decision!=='new';
 const sameCondition=same&&JSON.stringify(waitFor)===JSON.stringify(old.wait_for??null);
 const since=sameCondition?(old.wait_started_at??old.created_at??context.current?.waiting_since??at):at;
 return {status:decision==='drop'?'drop':decision==='none'?'none':'postpone',question:same?old.question:compiled.reason,
  reason:compiled.reason,followup_id:same?(old.followup_id??old.from_root_outcome_id??`followup:${since}`):`followup:${at}`,
  from_root_outcome_id:same?old.from_root_outcome_id??null:null,created_at:same?old.created_at??since:at,wait_started_at:since,
  wait_for:waitFor,wait_count:(same?old.wait_count??0:0)+1,last_reviewed_at:at,
  next_review_at:reviewAt(at,minutes,waitFor,context,since)};
}
export function cognitiveResultFollowup(life,followup,context,at,root,decision=null){
 if(!followup||!['continue','postpone','drop','none'].includes(followup.status)||typeof followup.question!=='string'||typeof followup.reason!=='string'||!Number.isSafeInteger(followup.delay_hours)||followup.delay_hours<1||followup.delay_hours>48)fail('followup_invalid');
 const waitFor=validateWaitFor(followup.wait_for,context);
 const minutes=followup.review_after_minutes??followup.delay_hours*60;
 if(!Number.isSafeInteger(minutes)||minutes<10||minutes>2880)fail('followup_review_invalid');
 const old=life.followup,sameIssue=old&&['continue','postpone'].includes(old.status)&&['continue','postpone'].includes(decision);
 const same=Boolean(waitFor&&JSON.stringify(waitFor)===JSON.stringify(old?.wait_for)&&['continue','postpone'].includes(old?.status));
 const since=same?(old.wait_started_at??old.created_at??at):at;
 return {...copy(followup),wait_for:waitFor,created_at:at,wait_started_at:since,followup_id:sameIssue||same?old.followup_id??old.from_root_outcome_id??root:root,
  origin_root_outcome_id:sameIssue?old.origin_root_outcome_id??old.from_root_outcome_id??root:root,
  from_root_outcome_id:root,wait_count:same?old.wait_count??0:0,next_review_at:reviewAt(at,minutes,waitFor,context,since)};
}
export function archiveCognitiveFollowup(life,at,reason){
 if(!life.followup||!['continue','postpone'].includes(life.followup.status))return;
 life.followup_archive=[...(life.followup_archive??[]),{...copy(life.followup),closed_at:at,closed_reason:reason}].slice(-16);
}
export function duplicateUnansweredMessage(w,id,message){
 const life=w.cognition?.actors[id]??{},norm=s=>String(s??'').normalize('NFKC').replace(/[\s\p{P}]/gu,'');
 return (life.outbox??[]).some(old=>norm(old.text)===norm(message.text)&&JSON.stringify([...(old.receiver_ids??[])].sort())===JSON.stringify([...message.receiver_ids].sort())
  &&!(life.inbox??[]).some(m=>m.reply_to===old.message_id&&old.receiver_ids.includes(m.sender_id))
  &&!(old.commitment_id&&(w.social?.commitments??[]).some(c=>c.id===old.commitment_id&&(!['proposed','accepted','meeting','working'].includes(c.status)||old.receiver_ids.some(peer=>c.responses?.[peer]&&c.responses[peer]!=='pending')))))
  ?'同样的内容已经实际送达，尚未收到关联回应；先复查等待或选择别的办法。':null;
}
