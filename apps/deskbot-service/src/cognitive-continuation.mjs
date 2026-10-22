// Personal follow-up conditions share the world's actual clock and task facts.
// These views never select an activity, invent a reply or alter a material law.
import {GLOW_LAW} from './fantasy-inquiry.mjs';
import {RESONANT_REVIEW_SECONDS} from './resonant-life.mjs';
import {WINDLEAF_LAW} from './windleaf-life.mjs';
import {WAYLIGHT_LAW} from './waylight-life.mjs';
import {completionTargets,issueResolutionEvidence,hasNewIssueEvidence,issueObjectIds} from './cognitive-issue-evidence.mjs';
const copy=structuredClone;
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};
const ms=value=>Date.parse(value);
const iso=value=>new Date(value).toISOString();
const active=f=>f&&['continue','postpone'].includes(f.status);
const issueId=f=>f?.followup_id??f?.origin_root_outcome_id??f?.from_root_outcome_id??null;
const issueRoots=f=>[f?.origin_root_outcome_id,f?.from_root_outcome_id].filter(Boolean);
const SERVER_FIELDS=['completion_target','target_bound_at','resolution_evidence_ids','completion_proofs','object_scope_ids','related_object_ids','current_conditions'];
export function validateFollowupTransition(value,context){
 if(SERVER_FIELDS.some(k=>Object.hasOwn(value,k)))fail('followup_server_fields');
 validateNextStep(value,context);
 const current=context.current,selected=value.followup_id==null?current:
  [current,...(context.deferred??[])].find(f=>issueId(f)===value.followup_id);
 if(value.followup_id!=null&&!selected)fail('followup_issue_unknown');
 const target=value.completion_target_id;
 if(target!=null){
  if(context.schema!=='deskbot.cognitive-continuation.v3'||!(context.completion_targets??[]).some(t=>t.id===target))fail('followup_target_unknown');
  if(!['new','none'].includes(value.followup_decision)&&selected?.completion_target&&selected.completion_target.id!==target)fail('followup_target_changed');
  if(value.followup_closure||value.status!==undefined)fail('followup_target_requires_plan');
 }
 const closure=value.followup_closure;
 if(closure!=null){
  if(!selected||closure.followup_id!==issueId(selected)||!['resolved','abandoned','satisfied'].includes(closure.kind)
   ||typeof closure.reason!=='string'||!closure.reason.trim()||closure.reason.length>240
   ||!Array.isArray(closure.evidence_ids))fail('followup_closure_invalid');
  const evidence=context.schema==='deskbot.cognitive-continuation.v3'?selected.resolution_evidence_ids??[]:context.completion_evidence_ids??[];
  if(closure.kind==='resolved'&&(!closure.evidence_ids.length||closure.evidence_ids.some(id=>!evidence.includes(id))))fail('followup_resolution_without_result');
 }
 // A model's own causal claim cannot simultaneously erase that same issue.
 if(selected&&value.motivation==='self_continuation'&&issueRoots(selected).includes(value.prior_root_id)
  &&['new','none','drop'].includes(value.followup_decision)&&!closure)fail('followup_continuation_conflict');
 if(selected&&value.followup_decision==='drop'&&!closure)fail('followup_close_requires_reason');
 if(closure&&['continue','postpone'].includes(value.followup_decision))fail('followup_closure_conflict');
 if(closure&&['continue','postpone'].includes(value.status))fail('followup_closure_conflict');
 return selected?copy(selected):null;
}
function deferIssue(life,issue,at){
 if(!active(issue))return;
 const id=issueId(issue);if(!id)fail('followup_issue_missing_identity');
 life.deferred_followups??=[];
 if(life.deferred_followups.some(f=>issueId(f)===id))return;
 if(life.deferred_followups.length>=8)fail('followup_deferred_full');
 life.deferred_followups.push({...copy(issue),followup_id:id,status:'postpone',deferred_at:at});
}
/** Switching attention parks an unresolved issue. Only an explicit closure archives it. */
export function prepareCognitiveFollowup(life,compiled,context,at){
 const draft=copy(life),result=prepareFollowupDraft(draft,compiled,context,at);
 Object.assign(life,draft);return result;
}
function prepareFollowupDraft(life,compiled,context,at){
 const selected=validateFollowupTransition(compiled,context),current=life.followup;
 if(current&&context.current)current.object_scope_ids=copy(context.current.related_object_ids??current.object_scope_ids??[]);
 if(selected)selected.object_scope_ids=copy(selected.related_object_ids??selected.object_scope_ids??[]);
 if(selected&&issueId(selected)!==issueId(current)&&compiled.followup_closure){
  life.followup=copy(selected);archiveCognitiveFollowup(life,at,compiled.followup_closure.reason,compiled.followup_closure);
  life.followup=current;
  life.deferred_followups=(life.deferred_followups??[]).filter(f=>issueId(f)!==issueId(selected));
  if(compiled.followup_decision==='new'){deferIssue(life,current,at);life.followup=null;return {preserved_current:false};}
  return {preserved_current:true};
 }
 if(selected&&issueId(selected)!==issueId(current)){
  life.deferred_followups=(life.deferred_followups??[]).filter(f=>issueId(f)!==issueId(selected));
  deferIssue(life,current,at);
  life.followup=copy(selected);
 }
 if(compiled.followup_closure){
  archiveCognitiveFollowup(life,at,compiled.followup_closure.reason,compiled.followup_closure);
  life.followup=null;
 }else if(['new','none'].includes(compiled.followup_decision)){
  deferIssue(life,life.followup,at);
  life.followup=null;
 }
 if(compiled.completion_target_id!=null&&life.followup&&!life.followup.completion_target){
  life.followup.completion_target=copy(context.completion_targets.find(t=>t.id===compiled.completion_target_id));
  life.followup.target_bound_at=at;
 }
 return {preserved_current:false};
}
export function cognitiveTime(at,zone='Asia/Shanghai'){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 return {utc:iso(ms(at)),zone,local:`${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`};
}
function methodReadyAt(w,id,activity){
 const lamp=w.living?.objects['floating-frame']?.waylight;
 if(lamp&&['waylight-open','waylight-shade','waylight-use'].includes(activity)){
  const base=activity==='waylight-use'?w.waylight_life?.last_used?.[id]:lamp.changed_at;
  const seconds=activity==='waylight-use'?WAYLIGHT_LAW.minimum_use_gap_seconds:WAYLIGHT_LAW.change_gap_seconds;
  return {ready_at:Number.isFinite(ms(base))?iso(ms(base)+seconds*1000):null,asset_id:lamp.asset_id};
 }
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
export function cognitiveContinuationContext(w,id,at,activities=[],commitments=[],socialOptions=[],recipientIds=null){
 const life=w.cognition?.actors[id]??{},zone=w.clock?.time_zone??'Asia/Shanghai';
 const options=activities.map(a=>{
  const timing=methodReadyAt(w,id,a.activity_id);
  return {kind:'activity',id:a.activity_id,title:a.title,available:a.available,blocker:a.unavailable_reason??a.reason??null,
   ...timing,...(timing.ready_at?{ready_time:cognitiveTime(timing.ready_at,zone),minutes_until_clock_ready:Math.max(0,Math.ceil((ms(timing.ready_at)-ms(at))/60000))}:{})};
 });
 const outgoing=(life.outbox??[]).slice(-4),waitingMessage=(life.outbox??[]).find(m=>life.followup?.wait_for?.kind==='reply'&&m.message_id===life.followup.wait_for.id);
 if(waitingMessage&&!outgoing.includes(waitingMessage))outgoing.unshift(waitingMessage);
 for(const message of outgoing){
  const replies=(life.inbox??[]).filter(m=>isCognitiveReplyTo(message,m));
  options.push({kind:'reply',id:message.message_id,title:'等这条已送达消息的回应',sent_at:message.at,sent_time:cognitiveTime(message.at,zone),
   receiver_ids:copy(message.receiver_ids??[]),commitment_id:message.commitment_id??null,text:message.text,available:replies.length>0,reply_ids:replies.map(m=>m.message_id)});
 }
 for(const c of commitments)options.push({kind:'commitment',id:c.id,title:c.title,status:c.status,available:['completed','declined','withdrawn','failed','cancelled','expired'].includes(c.status),
  not_before_at:c.not_before_at??null,deadline_at:c.deadline_at??null});
 const f=life.followup,isActive=active(f),option=isActive?selectedOption(options,f.wait_for):null;
 const since=f?.wait_started_at??f?.created_at??f?.from_at??(f?.next_review_at&&f?.delay_hours?iso(ms(f.next_review_at)-f.delay_hours*3600000):null);
 const deadline=option?.kind==='reply'&&since?iso(ms(since)+6*3600000):null;
 const condition=option?(option.available?'ready':deadline&&ms(at)>=ms(deadline)?'review_required':'waiting'):isActive?'unbound':'closed';
 const pendingTask=w.tasks?.find(t=>t.task_id===life.pending?.task_id);
 const result=pendingTask?.status==='completed'?{success:true,root_outcome_id:life.pending.root_outcome_id}:life.last_result;
 const completionEvidence=[...(result?.success?[result.root_outcome_id]:[]),...commitments.filter(c=>c.status==='completed').map(c=>`commitment:${c.id}`)];
 const withEvidence=f=>{
  const evidence=issueResolutionEvidence(w,id,f),next=selectedOption(options,f.next_step),wait=selectedOption(options,f.wait_for);
  return {...copy(f),followup_id:issueId(f),related_object_ids:issueObjectIds(w,f,activities),resolution_evidence_ids:evidence,
   // Current executor readings are distinct from the actor's dated last appraisal.
   current_conditions:{assessed_at:at,next_step:copy(next??null),wait_for:copy(wait??null),
    target_status:f.completion_target?(evidence.length?'achieved':'not_yet_proven'):'not_bound',
    rule:'这里是此刻重新核验的条件。旧question/reason是上次的判断，不是当前阻碍；冷却为0不代表材料、光照等其他条件也满足。目标已完成可据证据收束这一步，是否继续研究由本人决定。'},
  };
 };
 const targets=completionTargets(w,id,activities,socialOptions,recipientIds);
 for(const issue of [f,...(life.deferred_followups??[])])if(issue?.completion_target&&!targets.some(t=>t.id===issue.completion_target.id))targets.push(copy(issue.completion_target));
 return {schema:'deskbot.cognitive-continuation.v3',decision_contract:'issue-choice-v1',now:cognitiveTime(at,zone),wait_options:options,
  completion_targets:targets,deferred_capacity:{limit:8,used:life.deferred_followups?.length??0},
  completion_evidence_ids:completionEvidence, // References certify a result, not arbitrary prose about it.
  next_options:[...options.map(o=>({kind:o.kind,id:o.id,title:o.title})),...socialOptions.map(o=>({kind:'social',id:o.option_id,title:o.title}))],
  deferred:(life.deferred_followups??[]).map(withEvidence),
  current:isActive?{...withEvidence(f),condition,waiting_since:since,wait_deadline_at:deadline,
   next_review_time:f.next_review_at?cognitiveTime(f.next_review_at,zone):null,
   elapsed_minutes:since?Math.max(0,Math.floor((ms(at)-ms(since))/60000)):0,
   note:condition==='review_required'?'尚未收到关联回复；等待期限到了，需要自己决定换办法、暂缓或收束。期限不能靠重新措辞续期。':condition==='ready'?'所等条件已有实际依据；复查是否仍想继续，不把等待当成完成。':condition==='waiting'?'所等条件尚未满足；仍可做其他可行事务。':'后续未绑定具体条件，复查时需要自己说明下一步。'}:null,
  urgent_review:Boolean(isActive&&f.wait_for&&['ready','review_required'].includes(condition)),
  review_key:isActive&&option?JSON.stringify([issueId(f),option.kind,option.id,condition,option.asset_id??null,option.reply_ids??[],option.status??null]):null,
  rule:'继续原问题请绑定followup_id。new/none暂存旧问题，最多8项；满时继续/恢复或明确收束。客观小目标先在计划选择completion_target_id，绑定后不可换成容易的目标；resolved只能引用该问题resolution_evidence_ids，证明指定一步而非整个研究。个人觉得了解够了用satisfied，选择放下用abandoned，均不声称物质任务完成。方法可用不代表已执行；等待不增加实践或兴趣。'};
}
export function validateWaitFor(value,context){
 if(value===undefined||value===null)return null;
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['kind','id'].includes(k))||!selectedOption(context.wait_options,value))fail('followup_condition_unknown');
 return copy(value);
}
export function validateNextStep(value,context){
 const step=value.next_step;
 if(step==null)return;
 if(typeof step!=='object'||Array.isArray(step)||Object.keys(step).some(k=>!['kind','id'].includes(k))
  ||!selectedOption(context.next_options??[],step))fail('followup_next_step_unknown');
 const wait=value.wait_for;
 // A material/social handoff cannot be postponed on an unrelated gathering recipe.
 if(wait?.kind==='activity'&&(step.kind!=='activity'||step.id!==wait.id))fail('followup_wait_step_mismatch');
 if(wait?.kind==='commitment'&&(step.kind!=='commitment'||step.id!==wait.id))fail('followup_wait_step_mismatch');
 if(wait?.kind==='reply'&&step.kind==='commitment'
  &&selectedOption(context.wait_options,wait)?.commitment_id!==step.id)fail('followup_wait_step_mismatch');
 if(wait?.kind==='reply'&&step.kind!=='commitment'&&(step.kind!=='reply'||step.id!==wait.id))fail('followup_wait_step_mismatch');
}
function reviewAt(at,minutes,waitFor,context,since){
 let next=ms(at)+minutes*60000;const option=selectedOption(context.wait_options,waitFor);
 if(option?.kind==='activity'&&option.ready_at&&ms(option.ready_at)>ms(at))next=Math.min(next,ms(option.ready_at));
 if(option?.kind==='reply')next=Math.min(next,Math.max(ms(at)+10*60000,ms(since)+6*3600000));
 return iso(next);
}
export function cognitiveWaitFollowup(life,compiled,context,at){
 validateNextStep(compiled,context);
 const old=life.followup,decision=compiled.followup_decision??'postpone';
 const waitFor=Object.hasOwn(compiled,'wait_for')?validateWaitFor(compiled.wait_for,context):(['continue','postpone'].includes(old?.status)?copy(old.wait_for??null):null);
 const option=selectedOption(context.wait_options,waitFor);
 if(!['drop','none'].includes(decision)&&(option?.available||context.current?.condition==='review_required'
  &&JSON.stringify(context.current.wait_for)===JSON.stringify(waitFor)))fail('followup_wait_needs_reconsideration');
 const minutes=compiled.review_after_minutes??(waitFor?60:240);
 if(!Number.isSafeInteger(minutes)||minutes<10||minutes>240)fail('wait_review_invalid');
 const same=old&&['continue','postpone'].includes(old.status)&&decision!=='new';
 const sameCondition=same&&JSON.stringify(waitFor)===JSON.stringify(old.wait_for??null);
 const since=sameCondition?(old.wait_started_at??old.created_at??context.current?.waiting_since??at):at;
 return {status:decision==='drop'?'drop':decision==='none'?'none':'postpone',question:same?old.question:compiled.reason,
  reason:compiled.reason,original_question:same?old.original_question??old.question:compiled.reason,followup_id:same?(issueId(old)??`followup:${since}`):`followup:${at}`,
  from_root_outcome_id:same?old.from_root_outcome_id??null:null,created_at:same?old.created_at??since:at,wait_started_at:since,
  wait_for:waitFor,next_step:copy(Object.hasOwn(compiled,'next_step')?compiled.next_step:old?.next_step??null),wait_count:(same?old.wait_count??0:0)+1,last_reviewed_at:at,
  object_scope_ids:copy(same?old.object_scope_ids??[]:[]),
  ...(same&&old.completion_target?{completion_target:copy(old.completion_target),target_bound_at:old.target_bound_at,completion_proofs:copy(old.completion_proofs??[])}:compiled.completion_target_id?{completion_target:copy(context.completion_targets.find(t=>t.id===compiled.completion_target_id)),target_bound_at:at}:{}),
  next_review_at:reviewAt(at,minutes,waitFor,context,since)};
}
export function cognitiveResultFollowup(life,followup,context,at,root,decision=null){
 if(followup&&SERVER_FIELDS.some(k=>Object.hasOwn(followup,k)))fail('followup_server_fields');
 if(followup?.completion_target_id!=null)fail('followup_target_requires_plan');
 if(!followup||!['continue','postpone','drop','none'].includes(followup.status)||typeof followup.question!=='string'||typeof followup.reason!=='string'||!Number.isSafeInteger(followup.delay_hours)||followup.delay_hours<1||followup.delay_hours>48)fail('followup_invalid');
 const waitFor=validateWaitFor(followup.wait_for,context);
 validateNextStep(followup,context);
 const minutes=followup.review_after_minutes??followup.delay_hours*60;
 if(!Number.isSafeInteger(minutes)||minutes<10||minutes>2880)fail('followup_review_invalid');
 const old=life.followup,sameIssue=active(old)&&['continue','postpone'].includes(decision);
 if(followup.followup_id!=null&&followup.followup_id!==issueId(old))fail('followup_result_issue_changed');
 const closure=followup.followup_closure;
 if(closure)validateFollowupTransition({followup_id:issueId(old),status:followup.status,followup_closure:closure},context);
 // "No new question after this action" is not proof that an older issue is solved.
 if(sameIssue&&['drop','none'].includes(followup.status)&&!closure)
  return {...copy(old),status:'postpone',reason:followup.reason,last_reviewed_at:at,next_review_at:reviewAt(at,minutes,old.wait_for,context,old.wait_started_at??at)};
 const same=Boolean(waitFor&&JSON.stringify(waitFor)===JSON.stringify(old?.wait_for)&&['continue','postpone'].includes(old?.status));
 const since=same?(old.wait_started_at??old.created_at??at):at;
 const target=sameIssue?old.completion_target:life.pending?.completion_target;
 return {...copy(followup),last_reviewed_at:at,object_scope_ids:copy((sameIssue?old:life.pending)?.object_scope_ids??[]),...(target?{completion_target:copy(target),target_bound_at:sameIssue?old.target_bound_at:life.pending.target_bound_at,completion_proofs:copy((sameIssue?old:life.pending).completion_proofs??[])}:{}),original_question:sameIssue?old.original_question??old.question:followup.question,wait_for:waitFor,created_at:sameIssue?old.created_at??at:at,wait_started_at:since,followup_id:sameIssue||same?issueId(old)??root:root,
  origin_root_outcome_id:sameIssue?old.origin_root_outcome_id??old.from_root_outcome_id??root:root,
  from_root_outcome_id:root,wait_count:same?old.wait_count??0:0,next_review_at:reviewAt(at,minutes,waitFor,context,since)};
}
export function archiveCognitiveFollowup(life,at,reason,resolution=null){
 if(!life.followup||!['continue','postpone'].includes(life.followup.status))return;
 life.followup_archive=[...(life.followup_archive??[]),{...copy(life.followup),closed_at:at,closed_reason:reason,...(resolution?{resolution:copy(resolution)}:{})}].slice(-16);
}
export function isCognitiveReplyTo(sent,reply){
 if(!sent.receiver_ids?.includes(reply.sender_id)||!reply.reply_to)return false;
 // Reply targets are the recipient's receipt ID, whereas waiting uses the
 // sender's outbox ID. Derive only our delivered task's historical receipt.
 const taskId=sent.message_id?.startsWith('sent:')?sent.message_id.slice(5):null;
 return reply.reply_to===sent.message_id
  ||Boolean(taskId&&reply.reply_to===`message:${taskId}:${reply.sender_id}`);
}
function recipientAnswered(w,life,sent,peer){
 return (life.inbox??[]).some(m=>m.sender_id===peer&&isCognitiveReplyTo(sent,m))
  ||Boolean(sent.commitment_id&&(w.social?.commitments??[]).some(c=>c.id===sent.commitment_id
   &&(!['proposed','accepted','meeting','working'].includes(c.status)||c.responses?.[peer]&&c.responses[peer]!=='pending')));
}
/** Latest contact per issue and recipient. No partner's private state is read. */
export function unansweredCognitiveContacts(w,id){
 const life=w.cognition?.actors[id]??{},seen=new Set(),pending=[];
 for(const sent of [...(life.outbox??[])].reverse()){
  if(!sent.contact_basis?.followup_id)continue;
  const recipients=[];
  for(const peer of sent.receiver_ids??[]){
   const key=JSON.stringify([sent.contact_basis.followup_id,peer]);
   if(seen.has(key))continue;seen.add(key);
   if(!recipientAnswered(w,life,sent,peer))recipients.push(peer);
  }
  if(recipients.length)pending.push({message_id:sent.message_id,at:sent.at,receiver_ids:recipients,...copy(sent.contact_basis)});
 }
 return pending;
}
export function duplicateUnansweredMessage(w,id,message){
 const life=w.cognition?.actors[id]??{},basis=message.contact_basis;
 if(basis?.followup_id&&!message.reply_to&&!message.social_command){
  const repeated=unansweredCognitiveContacts(w,id).some(old=>old.followup_id===basis.followup_id
   &&(basis.schema==='deskbot.issue-contact.v1'?!hasNewIssueEvidence(basis,old):old.substantive_root===basis.substantive_root
   &&!(basis.source_ids??[]).some(input=>!(old.input_ids??[]).includes(input)))
   &&old.receiver_ids.some(peer=>message.receiver_ids.includes(peer)));
  if(repeated)return '同一问题已向这些收件人送达，尚无关联回应、新的实际观察/活动结果或新来源；换措辞、改称当面、缩减收件人都不能重发续期。可以自己行动、暂缓，或提出不同的明确约定。';
 }
 const norm=s=>String(s??'').normalize('NFKC').replace(/[\s\p{P}]/gu,'');
 return (life.outbox??[]).some(old=>norm(old.text)===norm(message.text)
  &&(old.receiver_ids??[]).some(peer=>message.receiver_ids.includes(peer)&&!recipientAnswered(w,life,old,peer)))
  ?'同样的内容已经实际送达，尚未收到关联回应；先复查等待或选择别的办法。':null;
}
