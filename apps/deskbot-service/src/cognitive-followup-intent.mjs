import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
export const FOLLOWUP_INTENT=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-followup-intent.v1.json',import.meta.url),'utf8'));
const C=FOLLOWUP_INTENT,copy=structuredClone;
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};
export function followupIntentContext(context,result){
 const receipt=result.effects?.communication;
 const label=result.not_executed?C.result_labels.not_executed:result.success?C.result_labels.completed:C.result_labels.unfinished;
 return {schema:C.schema,rule:C.rule,bases:[{id:result.root_outcome_id,kind:'outcome',summary:label},
  ...(receipt?[{id:receipt.id,kind:'receipt',summary:receipt.summary}]:[])],
  next_options:copy(context.continuation.next_options??[]),wait_options:copy(context.continuation.wait_options??[])};
}
/** No free prose from the model becomes the factual title or result summary. */
export function compileFollowupIntent(raw,context){
 const view=context.followup_intent;
 if(view?.schema!==C.schema||!raw||typeof raw!=='object'||Array.isArray(raw)
  ||C.required.some(k=>!Object.hasOwn(raw,k))||Object.keys(raw).some(k=>![...C.required,...C.optional].includes(k))
  ||!C.statuses.includes(raw.status)||!Number.isSafeInteger(raw.delay_hours)||raw.delay_hours<1||raw.delay_hours>48
  ||!Array.isArray(raw.basis_ids)||!isDeepStrictEqual(raw.basis_ids,view.bases.map(b=>b.id)))fail(C.error);
 const select=(ref,rows)=>{
  if(ref===null)return null;
  if(!ref||Object.keys(ref).sort().join(',')!=='id,kind')fail(C.error);
  const row=rows.find(r=>r.kind===ref.kind&&r.id===ref.id);if(!row)fail(C.error);return row;
 };
 const next=select(raw.next_step,view.next_options),wait=select(raw.wait_for??null,view.wait_options);
 if(raw.unverified_idea!==undefined&&(typeof raw.unverified_idea!=='string'||!raw.unverified_idea.trim()||[...raw.unverified_idea].length>160))fail(C.error);
 if(raw.review_after_minutes!==undefined&&(!Number.isSafeInteger(raw.review_after_minutes)||raw.review_after_minutes<10||raw.review_after_minutes>2880))fail(C.error);
 const current=context.continuation.current;
 if(raw.followup_id!=null&&raw.followup_id!==current?.followup_id)fail(C.error);
 const receipt=view.bases.find(b=>b.kind==='receipt');
 const title=row=>row.title??row.label??row.id;
 const question=['drop','none'].includes(raw.status)?C.questions[raw.status]:next?C.questions.next.replace('{title}',title(next)):
  wait?C.questions.wait.replace('{title}',title(wait)):C.questions[raw.status];
 const out={status:raw.status,question,reason:receipt?.summary??view.bases[0].summary,delay_hours:raw.delay_hours,next_step:copy(raw.next_step)};
 for(const k of ['wait_for','review_after_minutes','followup_id'])if(Object.hasOwn(raw,k))out[k]=copy(raw[k]);
 if(receipt)out.communication_evidence_id=receipt.id;
 if(raw.closure!=null){
  const cl=raw.closure;
  if(typeof cl!=='object'||Array.isArray(cl)||Object.keys(cl).sort().join(',')!=='evidence_ids,kind'||!Object.hasOwn(C.closures,cl.kind)||!Array.isArray(cl.evidence_ids)||cl.evidence_ids.some(id=>typeof id!=='string')||!current)fail(C.error);
  out.followup_closure={followup_id:current.followup_id,kind:cl.kind,reason:C.closures[cl.kind],evidence_ids:copy(cl.evidence_ids)};
 }
 return out;
}
export function validateFollowupIntent(proposal,context,refs){
 if(refs.followup_intent?.schema!==C.schema)return null;
 const binding=proposal.followup_binding;
 if(binding?.contract!==C.schema)fail(C.binding_error);
 // Both claim-time evidence and the current world must still agree. A new
 // opportunity may appear while the provider runs; it cannot be selected retroactively.
 const frozen={...context,followup_intent:refs.followup_intent};
 const expected=compileFollowupIntent(binding.actor_payload,frozen);
 const current=compileFollowupIntent(binding.actor_payload,context);
 if(!isDeepStrictEqual(expected,current)||!isDeepStrictEqual(proposal.followup,expected))fail(C.binding_error);
 return {schema:C.schema,basis_ids:copy(binding.actor_payload.basis_ids),
  ...(binding.actor_payload.unverified_idea?{unverified_idea:{text:binding.actor_payload.unverified_idea,epistemic:'unverified',label:'未验证设想'}}:{})};
}
