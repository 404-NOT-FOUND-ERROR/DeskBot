import {readFileSync} from 'node:fs';

const contract=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-failure.v1.json',import.meta.url),'utf8'));
const categories=new Map(Object.entries(contract.layers).flatMap(([layer,codes])=>codes.map(code=>[code,layer])));
const symbol=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value)?value:null;

/** Diagnostics never infer a category from a model's prose or change retry policy. */
export function cognitiveFailure(code,{cause_code=null,phase=null,stage=null,job_id=null,actor_id=null,retryable=false}={}){
  code=symbol(code)??'unknown_error';cause_code=symbol(cause_code);
  return {schema:contract.report_schema,layer:categories.get(cause_code)??categories.get(code)??'unknown',code,cause_code,
    phase:symbol(phase),stage:symbol(stage),job_id:symbol(job_id),actor_id:symbol(actor_id),retryable:retryable===true,record_as_experience:false};
}

export function validCognitiveFailure(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==contract.fields.length
    ||contract.fields.some(k=>!Object.hasOwn(value,k))||typeof value.retryable!=='boolean'||value.record_as_experience!==false)return false;
  const normalized=cognitiveFailure(value.code,value);
  return contract.fields.every(k=>value[k]===normalized[k]);
}
