import {isDeepStrictEqual} from 'node:util';
import {pendingContactPurpose,purposeSignature} from './cognitive-contact-purpose.mjs';
import {cognitiveActionSemantics} from './cognitive-action-semantics.mjs';
import {validateObligationEvidence} from './cognitive-event-evidence.mjs';
import {selfPositionDisclosure} from './cognitive-position-knowledge.mjs';
import {classifyEvidence} from './cognitive-evidence-refs.mjs';

const copy=structuredClone;
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};

/** Executor-owned options, not an agenda. Each row retains the real operation,
 * recipient and resource use. The actor chooses one or chooses not to act.
 * Content packs can add activities; they enter through the same capability view.
 */
export function cognitiveChoiceCatalogue(w,id,c){
 const choices=[],unavailable=[],opportunities=[];
 const add=(title,binding,extra={})=>{
  const method=binding.activity_id?c.capabilities.activities.find(a=>a.activity_id===binding.activity_id)?.method??cognitiveActionSemantics(binding.activity_id):null;
  const row={id:'c-'+purposeSignature([binding,extra]),title,binding,...(method?{method}:{}),...extra};
  const activity=binding.activity_id?c.capabilities.activities.find(a=>a.activity_id===binding.activity_id):null;
  const available=activity?.available!==false;
  opportunities.push({...row,available,blockers:available?[]:copy(activity.blockers??[]),blocker:available?null:activity.unavailable_reason??activity.reason??'当前执行条件不足'});
  if(available)choices.push(row);return row;
 };
 const issues=[c.continuation.current,...(c.continuation.deferred??[])].filter(Boolean);
 for(const a of c.capabilities.activities){
  if(!a.available)unavailable.push({title:a.title,activity_id:a.activity_id,blockers:a.blockers});
  if(a.method?.experiment?.prior_roots?.length&&!a.output)continue;
  const base={operation:'activity',activity_id:a.activity_id};
  const p=c.use_context.production.find(p=>p.activity_id===a.activity_id);
  if(!p){add(a.title,base,a.method?.experiment?{step_target_id:a.method.experiment.completion_target_id}:{});continue;}
  const purpose=(kind,target,ref=null)=>({...base,production_use:{activity_id:a.activity_id,kind,target_stock:target,reference_id:ref}});
  if(p.already_held<p.reserve_limit)add(a.title+'；只备一批',purpose('reserve',p.reserve_limit));
  for(const use of p.uses.filter(u=>p.already_held<u.count))
   add(a.title+'；备给「'+use.title+'」',purpose('self_use',use.count,use.activity_id));
  for(const use of p.accepted_outgoing.filter(u=>p.already_held<u.count))
   add(a.title+'；备给已接受约定',purpose('accepted_delivery',use.count,use.commitment_id));
  for(const issue of p.experiment?.available?issues:[]){
   const target=p.experiment.completion_target_id;
   if(issue.completed_steps?.some(s=>s.target.id===target)||issue.completion_target?.id===target&&issue.resolution_evidence_ids?.length)continue;
   // An unfinished, different goal cannot be silently replaced by this experiment.
   if(issue.completion_target&&issue.completion_target.id!==target&&!issue.resolution_evidence_ids?.length)continue;
   if(p.already_held+p.output_count>c.use_context.capacity)continue;
   add(a.title+'；为原问题在当前条件下实际试一批',purpose('experiment',p.already_held+p.output_count,issue.followup_id),{requires_issue:issue.followup_id,step_target_id:target});
  }
  if(!opportunities.some(r=>r.binding.activity_id===a.activity_id))unavailable.push({activity_id:a.activity_id,title:a.title,
   reason:'现存物品已满足备用或已知用途；这个方法没有可用的未完成实验，不能借研究名义继续囤积'});
 }
 for(const o of c.objects)add('只观察'+o.name,{operation:'observe',object_index:o.object_index});
 for(const d of c.capabilities.travel.destinations)add('沿通路去'+(d.name??d.id),{operation:'travel',destination_index:d.destination_index});
 add('休息片刻',{operation:'rest'});

 const contact=(peer,key,terms,title,text,contact={kind:'message'},evidence=[],disclosures=[])=>{
  const purpose={key,signature:purposeSignature(terms)};
  const pending=pendingContactPurpose(w,id,peer.actor_id,purpose);
  if(pending){unavailable.push({title,reason:'相同用途和条件已送达，尚无真实回应',message_id:pending.message_id,purpose_key:key});return;}
  add(title,{operation:'share',receiver_indices:[peer.receiver_index],contact,text,contact_purpose:purpose,speech_sources:evidence,...(disclosures.length?{disclosures:copy(disclosures)}:{})});
 };
 for(const peer of c.capabilities.share.receivers){
  const position=selfPositionDisclosure(c);
  contact(peer,'share-position',{location_id:c.location.id},'告诉'+peer.name+'我现在的位置',position.text,{kind:'message'},[],[position]);
  // An informal query and a formal offer share a purpose. Switching wrappers
  // must not bypass a pending question about exactly the same resource terms.
  for(const option of c.social.options){
   const offer=option.offers?.length===1?option.offers[0]:null;
   const key=offer?'offer:'+offer.resource:'invite:'+option.option_id;
   const terms=offer?{resource:offer.resource,count:offer.count}:{option_id:option.option_id,location_id:option.location_id,produce_activity:option.produce_activity};
   if(offer)contact(peer,key,terms,'问'+peer.name+'是否需要'+(c.grounding.resources[offer.resource]??offer.resource),
    `我这里可拿出${offer.count}份${c.grounding.resources[offer.resource]??offer.resource}。你现在需要吗？我还没有交付，是否接受由你决定。`);
   const available=c.social.invitation_availability?.find(a=>a.option_id===option.option_id&&a.receiver_id===peer.actor_id);
   if(available?.available===false)continue;
   contact(peer,key,terms,'向'+peer.name+'提议：'+option.title,'',{kind:'invite',option_id:option.option_id});
  }
  for(const o of c.objects){
   const lamp=o.state.waylight;
   // Concrete material changes only; clock drift or a tiny charge tick is not
   // a new reason to ask the same question. Stock quantities remain exact.
   const terms=lamp?{asset:lamp.asset_id,mode:lamp.mode,hood:lamp.has_hood,uses:lamp.use_count??0}
    :{stock:o.state.stock,condition:Math.floor((o.state.condition??o.state.health??0)*4)};
   contact(peer,'advice:'+o.id,terms,'问'+peer.name+'对'+o.name+'的看法',`关于${o.name}，你愿意说说自己的观察或建议吗？我还不能确定原因。`);
  }
  for(const last of c.speech_evidence.filter(e=>e.kind==='completed').slice(0,3)){
   const notice=last.disclosures?.find(d=>d.kind==='completion_notice');
   contact(peer,'share-result',last.id,'告知'+peer.name+(notice?'任务完成（仅完成通知）':'任务结果（状态通知）'),notice?.text??last.text,{kind:'message'},[last.id],notice?[notice]:[]);
   for(const extract of last.disclosures?.filter(d=>d.kind==='result_extract')??[])
    contact(peer,'share-result-fields',{root:last.id,disclosure:extract.id},'向'+peer.name+'分享实际记录：'+extract.fields.map(f=>f.label).join('、'),extract.text,{kind:'message'},[last.id],[extract]);
  }
  for(const input of c.inputs.slice(-4))contact(peer,'discuss-source',input.id,'与'+peer.name+'讨论一则来信',
   `我读到一则来自${input.sender_name??'外界'}的消息（这是听闻，尚非我的亲历）：${input.content}\n你愿意谈谈自己的看法吗？`,{kind:'message'},[input.id]);
  for(const m of c.social.replies.filter(m=>m.message_id&&m.sender_id===peer.actor_id)){
   if((w.cognition.actors[id].outbox??[]).some(s=>s.reply_to===m.message_id))continue;
   contact(peer,'reply',m.message_id,'回应'+peer.name+'的实际留言','收到你的留言了，我会再想想；这不表示我接受任何约定。',{kind:'reply',reply_to:m.message_id});
  }
  for(const agreement of c.social.commitments.filter(a=>a.actors.includes(peer.actor_id))){
   for(const response of agreement.available_responses){
    for(const delay of response==='delay'?[30,120]:[null])contact(peer,'respond:'+agreement.id,
     {revision:agreement.terms_revision,response,delay},`${peer.name} · ${agreement.title}：${{accept:'接受',decline:'拒绝',withdraw:'退出',delay:'商量延期'}[response]}${delay??''}`,'',
     {kind:'respond',commitment_id:agreement.id,response,...(delay?{delay_minutes:delay}:{})});
   }
  }
 }
 return {schema:'deskbot.choice-catalogue.v2',choices,unavailable,opportunities,
  rule:'选择一项具体动作，或act=false。每项已绑定实际对象、用量、收件人与正文；不会从理由猜动作。联系正文只是所选语义的固定表达；开放自然对话尚不属于这个受控实验。未回复不等于需要或拒绝。'};
}

export function validateCatalogueSelection(proposal,context,refs){
 const receipt=proposal.choice_binding;
 if(receipt?.contract!=='choice-catalogue-v2'){
  if(refs.evidence_refs){
   const c=proposal.compiled??{},ids=[...(c.source_ids??[]),...(c.own_evidence_ids??[]),...(c.context_evidence_ids??[])];
   const typed=classifyEvidence(ids,refs.evidence_refs);
   classifyEvidence(ids,context.evidence_refs);
   if(Object.entries(typed).some(([key,values])=>!isDeepStrictEqual(c[key]??[],values)))fail('catalogue_evidence_changed');
  }
  // New claims cannot bypass obligation scope by omitting the choice receipt.
  // Frozen pre-contract jobs retain their original compatibility boundary.
  if(refs.event_evidence)validateObligationEvidence(proposal.compiled,context,proposal.compiled);
  return;
 }
 const entry=refs.choice_catalogue?.choices.find(x=>x.id===receipt.actor_payload?.choice_id);
 const current=context.choice_catalogue?.choices.find(x=>x.id===entry?.id);
 if(!entry||!current||!isDeepStrictEqual(entry,current))fail('choice_catalogue_changed');
 const b=entry.binding,c=proposal.compiled;
 const raw=receipt.actor_payload,claims=raw.source_ids??raw.issue?.source_ids??[];
 validateObligationEvidence(raw,context,c);
 const issues=[context.continuation.current,...(context.continuation.deferred??[])].filter(Boolean);
 const own=new Set([context.saved.last_result?.root_outcome_id,...issues.flatMap(f=>[f.origin_root_outcome_id,f.from_root_outcome_id,
   ...(f.resolution_evidence_ids??[]),...(f.completed_steps??[]).flatMap(s=>s.evidence_ids??[])])].filter(Boolean));
 const external=new Set(context.inputs.map(i=>i.id));
 if(refs.evidence_refs){
  const frozen=classifyEvidence(claims,refs.evidence_refs),current=classifyEvidence(claims,context.evidence_refs);
  if(!isDeepStrictEqual(frozen,current)||Object.entries(frozen).some(([key,ids])=>!isDeepStrictEqual(c[key]??[],ids)))fail('catalogue_evidence_changed');
 }else if(claims.some(s=>!own.has(s)&&!external.has(s))
  ||!isDeepStrictEqual(c.source_ids,[...new Set(claims.filter(s=>external.has(s)))])
  ||!isDeepStrictEqual(c.own_evidence_ids??[],[...new Set(claims.filter(s=>own.has(s)))]))fail('catalogue_evidence_changed');
 const expected={operation:b.operation,activity_id:b.activity_id??null,object_index:b.object_index??null,
  destination_index:b.destination_index??null,receiver_indices:b.receiver_indices??null};
 for(const [key,value] of Object.entries(expected))if(!isDeepStrictEqual(c[key]??null,value))fail('catalogue_operation_changed');
 if(!isDeepStrictEqual(c.production_use??null,b.production_use?{...b.production_use,reason:receipt.actor_payload.inner_monologue}:null))fail('catalogue_purpose_changed');
 if(b.operation==='share'){
  const contact=b.contact;
  if(!isDeepStrictEqual(c.message_parts,[{kind:'catalogue',choice_id:entry.id}])
   ||!isDeepStrictEqual(c.social??null,['invite','respond'].includes(contact.kind)?{operation:contact.kind,...Object.fromEntries(Object.entries(contact).filter(([k])=>k!=='kind'))}:null)
   ||(c.reply_to??null)!==(contact.reply_to??null))fail('catalogue_speech_changed');
  if(b.speech_sources.some(s=>context.inputs.some(i=>i.id===s)&&!c.source_ids.includes(s)))fail('catalogue_source_missing');
 }
 if(entry.requires_issue&&(!['continue','postpone'].includes(c.followup_decision)||c.followup_id!==entry.requires_issue))fail('catalogue_issue_changed');
}
