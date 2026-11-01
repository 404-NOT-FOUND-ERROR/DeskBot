import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const EVENT_EVIDENCE=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-event-evidence.v1.json',import.meta.url),'utf8'));
const copy=structuredClone;
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};

/** Only executor-owned, explicitly public result fields. Never copy an actor's
 * memory, inventory, motivation or arbitrary result object into a message. */
export function resultDisclosures(result,task){
 if(!result?.root_outcome_id||!task||!result.success||task.status!=='completed')return [];
 const title=result.effects?.verified_title??(task.activity_id?`执行活动 ${task.activity_id}`:'已记录的实际操作');
 const base={schema:EVENT_EVIDENCE.disclosure_schema,root_outcome_id:result.root_outcome_id,
  occurred_at:result.occurred_at,object_id:task.target_object_id??null};
 const seal=value=>({...value,id:'disclosure:'+hash(value).slice(0,24)});
 const notice=seal({...base,kind:'completion_notice',fields:[{path:'task.status',value:'completed',label:'任务状态'}],
  text:`我的任务「${title}」已实际完成。${task.cognitive_operation==='share'?'只核验话语送达，没有交付物品；提到的活动与双方承诺需另有实际记录。':''}`});
 const output=[notice],method=task.completion?.result?.method_result;
 if(!method||method.root_outcome_id!==base.root_outcome_id||method.actor_id!==task.actor_id)return output;
 const fields=(method.observations??[]).filter(o=>Number.isFinite(method.before?.[o.field])&&Number.isFinite(method.after?.[o.field]))
  .map(o=>({path:o.field,label:o.label,unit:o.unit??'执行器原始量纲',before:method.before[o.field],value:method.after[o.field]}));
 const stock=(method.stock_changes??[]).map(s=>({container:s.container,resource:s.resource,delta:s.delta??s.count}));
 if(!fields.length&&!stock.length)return output;
 const conditions=copy(method.conditions??{}),limits=copy(method.limits??[]);
 const text=`「${title}」的实际记录（${method.started_at} 至 ${method.finished_at}）：`
  +fields.map(f=>`${f.label}：${f.before} → ${f.value}（${f.unit}）`).join('；')
  +`。对象 ${base.object_id??'未登记'}；条件 ${JSON.stringify(conditions)}。`
  +(stock.length?`已记录的产出或转移增减（不含开工预留）${JSON.stringify(stock)}。`:'没有产出或交接物品。')
  +limits.join('；')+'。这是当时的记录，不代表当前值或单独因果。';
 // A large future method needs an authored projection, not silent truncation.
 if(text.length>1400)return output;
 output.push(seal({...base,kind:'result_extract',method_id:method.id,method_version:method.version,
  fields,stock_changes:stock,conditions,scope:method.scope,causal_claim:false,text}));
 return output;
}

export function messageReceipt(task,at,delivered){
 const message=task.cognitive_message;
 if(message?.evidence_contract!==EVENT_EVIDENCE.schema)return null;
 const disclosed=delivered?copy(message.disclosures??[]):[];
 const kinds=[...new Set(disclosed.map(d=>d.kind))];
 const detail=kinds.includes('result_extract')?'含回执列明的结果字段':kinds.includes('completion_notice')?'仅通知任务完成，不含测记数值':'以回执中的实际正文为限';
 return {schema:EVENT_EVIDENCE.receipt_schema,id:`receipt:${task.task_id}`,root_outcome_id:task.root_outcome_id??`task:${task.task_id}`,
  sender_id:task.actor_id,receiver_ids:copy(message.receiver_ids??[]),at,
  delivered,delivery_message_ids:delivered?(message.receiver_ids??[]).map(id=>`message:${task.task_id}:${id}`):[],
  text:delivered?message.text:null,text_sha256:delivered?hash(message.text):null,disclosures:disclosed,
  understanding_verified:false,acceptance_verified:false,material_transfer:false,
  summary:delivered?`本次留言已送达；${detail}。未核验对方理解或接受，没有交付物品；提及的来源不等于全文已公开。`:'本次留言未送达；没有向对方公开结果，也没有交付物品或建立承诺。'};
}

export function validateCommunicationFeedback(value,receipt){
 if(!receipt){if(value?.communication_evidence_id!=null)fail(EVENT_EVIDENCE.errors.communication);return;}
 if(receipt.schema!==EVENT_EVIDENCE.receipt_schema||value?.communication_evidence_id!==receipt.id||value.reason!==receipt.summary)
  fail(EVENT_EVIDENCE.errors.communication);
}

/** Scope is based on existing public commitment terms, never the prose reason.
 * Social executor still owns meetings, transfers and joint completion. */
export function obligationEvidence(w,id,c){
 const rows=c.choice_catalogue.choices;
 return (w.social?.commitments??[]).filter(a=>a.control==='cognitive'&&a.actors.includes(id)
  &&EVENT_EVIDENCE.obligation_statuses.includes(a.status)&&a.actors.every(p=>a.responses[p]==='join')
  &&Date.parse(a.deadline_at)>=Date.parse(c.at)&&(!a.not_before_at||a.not_before_at<=c.at)).map(a=>({
   commitment_id:a.id,terms_revision:a.terms_revision,
   choice_ids:rows.filter(r=>{
    const b=r.binding;
    if(b.operation==='travel')return c.capabilities.travel.destinations[b.destination_index-1]?.id===a.location_id;
    if(b.operation!=='activity')return false;
    if(b.production_use?.kind==='accepted_delivery')return b.production_use.reference_id===a.id;
    if(a.kind==='cooperate')return id===a.actors[0]?b.activity_id===a.produce_activity:b.activity_id===a.use_activity;
    return a.kind==='meal'&&b.activity_id==='share-meal'&&c.location.id===a.location_id;
   }).map(r=>r.id),
  })).filter(a=>a.choice_ids.length);
}

export function validateObligationEvidence(payload,context,compiled=null){
 if(context.event_evidence?.schema!==EVENT_EVIDENCE.schema)return; // explicit historical contract
 const ref=payload.obligation_ref,kind=payload.motivation??payload.issue?.motivation;
 if(kind!=='accepted_obligation'){if(ref!=null||compiled?.obligation_ref!=null||compiled?.commitment_id!=null||compiled?.motivation==='accepted_obligation')fail(EVENT_EVIDENCE.errors.obligation);return;}
 if(!ref||!isDeepStrictEqual(Object.keys(ref).sort(),EVENT_EVIDENCE.obligation_ref_fields.toSorted())
  ||!context.event_evidence.obligations.some(o=>o.commitment_id===ref.commitment_id&&o.terms_revision===ref.terms_revision&&o.choice_ids.includes(payload.choice_id)))fail(EVENT_EVIDENCE.errors.obligation);
 if(compiled&&(!isDeepStrictEqual(compiled.obligation_ref,ref)||compiled.commitment_id!==ref.commitment_id||compiled.motivation!==kind))fail(EVENT_EVIDENCE.errors.obligation);
}

export function eventEvidenceContext(w,id,c){
 return {schema:EVENT_EVIDENCE.schema,obligations:obligationEvidence(w,id,c),obligation_rule:EVENT_EVIDENCE.obligation_rule,
  feedback_rule:EVENT_EVIDENCE.feedback_rule,
  // A known name alone provides no remote position. No other actor's private state.
  people:c.visible_people.map(p=>({actor_id:p.actor_id,location_id:c.location.id,observed_at:c.at,basis:'seen_here'}))};
}
