import {readFileSync} from 'node:fs';
export const EVIDENCE_REFS=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-evidence-refs.v1.json',import.meta.url),'utf8'));
const C=EVIDENCE_REFS;
const fail=code=>{throw Object.assign(Error(code),{code,statusCode:409});};
/** An actor-local index only. No other resident's state or memory is read. */
export function evidenceReferences(context){
 const rows=new Map();
 const add=(id,kind,extra={})=>{if(id&&!rows.has(id))rows.set(id,{id,kind,uses:C.types[kind].uses,status:'available',...extra});};
 for(const source of context.inputs??[])add(source.id,'input',{epistemic:source.epistemic});
 const last=context.saved?.last_result;
 add(last?.root_outcome_id,'outcome');
 const issues=[context.continuation?.current,...(context.continuation?.deferred??[])].filter(Boolean);
 for(const f of issues){
  for(const id of [f.origin_root_outcome_id,f.from_root_outcome_id,...(f.resolution_evidence_ids??[]),...(f.completed_steps??[]).flatMap(s=>s.evidence_ids??[])])add(id,'outcome');
  if(f.intent_evidence?.unverified_idea)add(`idea:${f.followup_id}:${f.last_reviewed_at}`,'speculation',{epistemic:'unverified'});
 }
 for(const r of [last?.effects?.communication,...(context.saved?.outbox??[]).map(o=>o.receipt)].filter(Boolean))add(r.id,'receipt');
 for(const p of context.position_knowledge?.people??[])add(p.source_id,'position',{
  status:p.freshness==='expired'?'stale':'available',epistemic:p.current_verified?'observed':'historical_clue'});
 for(const b of context.followup_intent?.bases??[])add(b.id,b.kind);
 return {schema:C.schema,rule:C.rule,entries:[...rows.values()]};
}
export function classifyEvidence(ids,view,use='choice_context'){
 const result={source_ids:[],own_evidence_ids:[],context_evidence_ids:[]};
 if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'))fail(C.errors.unavailable);
 for(const id of new Set(ids)){
  const row=view?.entries?.find(r=>r.id===id);if(!row)fail(C.errors.unavailable);
  if(row.status!=='available')fail(C.errors.stale);
  if(!row.uses.includes(use)||!C.types[row.kind]?.uses.includes(use))fail(C.errors.use);
  result[C.types[row.kind].bucket].push(id);
 }
 return result;
}
