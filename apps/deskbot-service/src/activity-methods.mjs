// Authored methods are shared by the executor, cognition and development views.
// This bounded registry is not an expression engine or a second world store.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const copy=structuredClone;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields=new Set(['water_level','condition','waylight.asset_id','waylight.mode','waylight.has_hood',
  'waylight.brightness','waylight.charge','waylight.moisture','waylight.use_count','$phase']);
const topics=new Set(['care','craft','repair','cook','explore','connection']);
const safeId=v=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function validateMethodRegistry(document){
  const errors=[],ids=new Set(),check=(ok,message)=>{if(!ok)errors.push(message);};
  check(document?.schema==='deskbot.activity-methods.v1','method_schema_invalid');
  check(Array.isArray(document?.methods)&&document.methods.length>0,'methods_required');
  for(const m of document?.methods??[]){
    const r=m.recipe??{};
    check(Object.keys(m).every(k=>['id','version','topic','executor','recipe','method','effects','limits','conditions','observations','experiment'].includes(k)),'method_field_unknown');
    check(Object.keys(r).every(k=>['activity_id','title','kind','target','seconds','inputs','output','waylight_rule'].includes(k)),'method_recipe_field_unknown');
    check(safeId(m.id)&&!ids.has(m.id),'method_id_invalid');ids.add(m.id);
    check(Number.isSafeInteger(m.version)&&m.version>0&&topics.has(m.topic),'method_version_or_topic_invalid');
    check(['recipe','waylight','sample'].includes(m.executor),'method_executor_unknown');
    check(r.activity_id===m.id&&safeId(r.target)&&text(r.title)&&['care','craft'].includes(r.kind)
      &&Number.isSafeInteger(r.seconds)&&r.seconds>0&&r.seconds<=604800,'method_recipe_invalid');
    const resources=[...(Array.isArray(r.inputs)?r.inputs:[]),...(r.output?[r.output]:[])];
    check(Array.isArray(r.inputs)&&resources.every(i=>safeId(i.container)&&typeof i.resource==='string'
      &&/^[a-z][a-z0-9_]*$/.test(i.resource)&&Number.isSafeInteger(i.count)&&i.count>0),'method_resources_invalid');
    check(m.executor!=='sample'||(!r.output&&Array.isArray(r.inputs)&&r.inputs.length===0),'sample_cannot_produce');
    check(m.executor!=='waylight'||m.id==='waylight-use'&&r.waylight_rule==='waterside-waylight-v1','method_adapter_invalid');
    check(m.executor==='waylight'||!r.waylight_rule,'method_adapter_mismatch');
    check(text(m.method)&&Array.isArray(m.effects)&&m.effects.every(text)&&Array.isArray(m.limits)&&m.limits.every(text),'method_description_invalid');
    check(Array.isArray(m.conditions)&&m.conditions.every(c=>fields.has(c.field)&&['exists','eq','gte','lte'].includes(c.op)
      &&text(c.code)&&text(c.reason)&&(['gte','lte'].includes(c.op)?Number.isFinite(c.value):true)),'method_condition_invalid');
    check(Array.isArray(m.observations)&&m.observations.length>0&&m.observations.every(o=>fields.has(o.field)&&text(o.label)),'method_observations_invalid');
    check(m.experiment===null||m.experiment&&text(m.experiment.purpose)&&fields.has(m.experiment.subject)
      &&Array.isArray(m.experiment.axes)&&m.experiment.axes.length>0&&new Set(m.experiment.axes).size===m.experiment.axes.length
      &&m.experiment.axes.every(f=>['waylight.mode','waylight.has_hood','$phase'].includes(f)),'method_experiment_invalid');
  }
  return errors;
}
const document=JSON.parse(readFileSync(new URL('../../../contracts/activity-methods.v1.json',import.meta.url),'utf8'));
const errors=validateMethodRegistry(document);if(errors.length)throw Error(errors.join(','));
freeze(document);
const methods=new Map(document.methods.map(m=>[m.id,m]));
export const METHOD_RECIPES=Object.freeze(document.methods.map(m=>m.recipe));
export const registeredMethod=id=>methods.get(id)??null;
export const methodSemantics=id=>{const m=registeredMethod(id);return m?copy({id:m.id,version:m.version,topic:m.topic,
  method:m.method,effects:m.effects,limits:m.limits,experiment:m.experiment?{kind:m.id,purpose:m.experiment.purpose}:null}):null;};

function valueAt(w,target,field,at){
  if(field==='$phase'){
    const h=Number(new Intl.DateTimeFormat('en',{timeZone:w.clock?.time_zone??'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(new Date(at)));
    return h>=18||h<6?'night':'day';
  }
  return field.split('.').reduce((value,key)=>value?.[key],target)??null;
}
const observe=(w,m,at)=>Object.fromEntries(m.observations.map(o=>[o.field,valueAt(w,w.living?.objects[m.recipe.target],o.field,at)]));
function conditions(w,m,at){
  if(!m.experiment)return null;
  const target=w.living?.objects[m.recipe.target],e=m.experiment;
  return {subject:valueAt(w,target,e.subject,at),axes:Object.fromEntries(e.axes.map(f=>[f,valueAt(w,target,f,at)]))};
}
const keyFor=(m,c)=>hash([m.id,m.version,c]).slice(0,24);
export function methodView(w,id,activityId,at){
  const m=registeredMethod(activityId);if(!m)return null;
  if(w.clock?.mode!=='real_time'||!Number.isFinite(Date.parse(at)))return null;
  const p=[w.protagonist,...(w.npcs??[])].find(p=>(p.character_id??p.npc_id)===id);
  const object=w.map_catalog?.objects.find(o=>o.object_id===m.recipe.target);
  if(!p||w.map_catalog?.areas.find(a=>a.area_id===object?.area_id)?.location_id!==p.location_id)return null;
  const c=conditions(w,m,at),key=c?keyFor(m,c):null;
  const proof=key?w.living?.method_evidence?.[id]?.[key]:null;
  return {...methodSemantics(activityId),schema:'deskbot.activity-method-view.v1',definition_hash:hash(m),
    observations:copy(m.observations),experiment:c?{kind:m.id,purpose:m.experiment.purpose,condition_key:key,conditions:c,
      completion_target_id:`method:${m.id}:${key}`,available:Boolean(c.subject)&&!proof,
      prior_roots:proof?[proof.root_outcome_id]:[],reason:proof?'该对象和条件已有实际记录；改问题名或等待不会产生新实验':null}:null};
}
export function methodBlocker(w,r,id,at,{completion=false,task=null}={}){
  const m=registeredMethod(r.activity_id);if(!m)return null;
  const block=(code,reason)=>({code,classification:'condition',reason});
  for(const c of m.conditions){
    const v=valueAt(w,w.living?.objects[r.target],c.field,at);
    const ok=c.op==='exists'?v!==null:c.op==='eq'?v===c.value:typeof v==='number'&&(c.op==='gte'?v>=c.value:v<=c.value);
    if(!ok)return block(c.code,c.reason);
  }
  if(completion&&task?.method_binding){
    const b=task.method_binding;
    if(b.id!==m.id||b.version!==m.version||b.definition_hash!==hash(m))return block('method_rules_changed','本次活动的方法版本已改变，需要重新安排。');
    if(b.conditions&&keyFor(m,conditions(w,m,at))!==b.condition_key)return block('method_conditions_changed','执行期间对象或试验条件改变，本次不作为原条件的成果。');
  }
  // A sample has no consumable purpose; it is only offered for a new condition.
  // Production remains available for real reserve/use/delivery even after a trial.
  if(m.executor==='sample'&&methodView(w,id,m.id,at)?.experiment?.available===false)
    return block('method_condition_already_observed','已经测记过这个对象和罩片条件；普通查看仍然可以，新的实验需要条件变化。');
  return null;
}
export function bindMethod(w,id,activityId,at){
  const m=registeredMethod(activityId);if(!m)return null;
  const c=conditions(w,m,at);
  return {schema:'deskbot.activity-method-binding.v1',id:m.id,version:m.version,definition_hash:hash(m),topic:m.topic,
    target_object_id:m.recipe.target,started_at:at,conditions:c,condition_key:c?keyFor(m,c):null,before:observe(w,m,at)};
}
export function settleMethod(w,task,at,stockChanges){
  const b=task.method_binding,m=registeredMethod(task.activity_id);if(!b||!m)return null; // Historical tasks keep their original evidence.
  const proof={schema:'deskbot.activity-method-result.v1',id:b.id,version:b.version,definition_hash:b.definition_hash,topic:b.topic,
    actor_id:task.actor_id,root_outcome_id:task.root_outcome_id??`task:${task.task_id}`,target_object_id:b.target_object_id,
    started_at:b.started_at,finished_at:at,conditions:copy(b.conditions),condition_key:b.condition_key,
    before:copy(b.before),after:observe(w,m,at),observations:copy(m.observations),stock_changes:copy(stockChanges),
    limits:copy(m.limits),scope:'task_interval_including_environment',causal_claim:false};
  if(b.condition_key){
    const own=(w.living.method_evidence??={})[task.actor_id]??={};
    // Retain the first actual proof per condition independently of task/history rotation.
    own[b.condition_key]??={method_id:m.id,version:m.version,root_outcome_id:proof.root_outcome_id,at,
      conditions:copy(b.conditions)};
  }
  return proof;
}
