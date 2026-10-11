import {createHash} from 'node:crypto';

export const REFRACTION_VERSION='deskbot.cognitive-refraction.v1';
export const sourceSignature=s=>createHash('sha256').update(JSON.stringify([s.id,s.content,s.category,s.epistemic])).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const copy=structuredClone;

export function interpretationWindow(inputs,saved,locationId){
 const interpretations=saved.interpretations??[];
 const key=s=>`${sourceSignature(s)}:${locationId}:${REFRACTION_VERSION}`;
 const active=interpretations.filter(i=>inputs.some(s=>s.id===i.source_id&&i.context_key===key(s)));
 const known=new Set(active.map(i=>i.source_id));
 return {version:REFRACTION_VERSION,active:copy(active),pending:inputs.filter(s=>!known.has(s.id)).slice(-5).map(s=>({...copy(s),context_key:key(s)}))};
}

// The model describes a possible meaning, never commits an event or an identity change.
export function adoptInterpretations(life,items,refs,at){
 if(!Array.isArray(items)||items.length>5)fail('refraction_batch_invalid');
 const seen=new Set(),out=[];
 for(const item of items){
  const source=refs.interpretation_pending?.find(s=>s.id===item.source_id);
  if(!source||seen.has(item.source_id))fail('refraction_source_invalid');
  if(source.expires_at&&source.expires_at<=at)fail('cognitive_source_expired');
  seen.add(item.source_id);
  const allowed=['source_id','kind','stance','effect','topic','question','reason','evidence_quote','target_object_ids','confidence'];
  if(Object.keys(item).some(k=>!allowed.includes(k)))fail('refraction_field_forbidden');
  if(!['question','suggestion','invitation','report','hypothesis','negation','quotation','social','noise'].includes(item.kind)
    ||!['affirmed','negated','quoted','uncertain'].includes(item.stance)
    ||!['inquiry','offer','condition','attention','none'].includes(item.effect))fail('refraction_meaning_invalid');
  if(!['topic','question','reason','evidence_quote'].every(k=>typeof item[k]==='string'&&item[k].length<=480)
    ||!item.evidence_quote.trim()||!source.content.includes(item.evidence_quote))fail('refraction_evidence_invalid');
  if(!Number.isFinite(item.confidence)||item.confidence<0||item.confidence>1)fail('refraction_confidence_invalid');
  if(!Array.isArray(item.target_object_ids)||item.target_object_ids.some(id=>!refs.objects.includes(id)))fail('refraction_target_invalid');
  if((['negated','quoted'].includes(item.stance)||['negation','quotation','noise'].includes(item.kind))&&item.effect!=='none')fail('refraction_nonassertion_has_effect');
  if(item.effect==='condition'&&!['weather','body'].includes(source.category))fail('refraction_condition_authority');
  if(item.effect==='offer'&&(!['user','agent'].includes(source.category)||item.kind!=='invitation'))fail('refraction_invitation_authority');
  if(['inquiry','offer','condition'].includes(item.effect)&&!item.question.trim())fail('refraction_question_required');
  out.push({...copy(item),context_key:source.context_key,interpreted_at:at,epistemic:'personal_interpretation',
    source_category:source.category,source_content:source.content,source_at:source.occurred_at,expires_at:source.expires_at??null,
    authority:'opportunity_only',status:item.effect==='none'?'acknowledged':'available'});
 }
 life.interpretations=[...(life.interpretations??[]).filter(i=>!out.some(o=>o.source_id===i.source_id&&o.context_key===i.context_key)),...out].slice(-128);
 return out;
}

export function refractionDialogue(life,at){
 return (life?.interpretations??[]).filter(i=>!i.expires_at||i.expires_at>at).slice(-5).map(i=>({source_id:i.source_id,
  source_content:i.source_content,meaning:i.kind,question:i.question,effect:i.effect,reason:i.reason,epistemic:i.epistemic,
  rule:'这是个人理解与可选问题，不是已发生的事实或已接受的承诺。'}));
}
