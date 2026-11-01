import {RESOURCES} from './living-resources.mjs';
import {isDeepStrictEqual} from 'node:util';

/** A read-only vocabulary for the already visible world, not a second world model. */
export function cognitiveGrounding(world, actorId, objects, activities) {
  const people=[world.protagonist,...world.npcs];
  const own=people.find(p=>(p.character_id??p.npc_id)===actorId);
  const names=new Map(people.filter(p=>p.location_id===own?.location_id)
    .map(p=>[p.character_id??p.npc_id,p.display_name]));
  const resources=new Set(Object.keys(world.living?.inventories[actorId]?.stock??{}));
  for(const object of objects)for(const key of Object.keys(object.stock??{}))resources.add(key);
  for(const activity of activities){
    for(const input of activity.inputs??[])resources.add(input.resource);
    if(activity.output)resources.add(activity.output.resource);
  }
  const assets=objects.filter(o=>o.waylight).map(o=>({
    object_id:o.object_id,asset_id:o.waylight.asset_id,name:'归途灯',
    owner_id:o.waylight.owner_id??null,
    owner_name:o.waylight.owner_id===actorId?'我':names.get(o.waylight.owner_id)??'姓名未知',
    ownership_basis:'现场物件的 owner_id；照料者、职业名称、提出建议者均不自动拥有物件',
  }));
  return {schema:'deskbot.cognitive-grounding.v1',
    resources:Object.fromEntries([...resources].sort().filter(k=>Object.hasOwn(RESOURCES,k)).map(k=>[k,RESOURCES[k]])),
    assets,
    quantities:assets.length?{'waylight.charge':'光叶凝聚的蓄光量（0至1），不是电池电量',
      'waylight.brightness':'当前照明强度；不等同蓄光量','waylight.moisture':'灯具湿润程度'}:{},
    rule:'名称与归属依据此处和事件原始事实。原水与清水是不同资源；净滤产出看实际 effects 和背包 after。旧回忆描述当时，现场状态描述现在，二者不能互相覆盖。主观理解可以改变，不改写物品、所有权、数量、是否履约；感受不是事实证据。'};
}

/** Production is an opportunity, not proof that more stock is needed. No peer inventories. */
export function cognitiveUseContext(world,actorId,activities,at){
 const stock=world.living?.inventories[actorId]?.stock??{};
 return {contract:'finite-use-v1',experiment_rule:'method-conditions-v2',assessed_at:at,capacity:world.living?.inventories[actorId]?.capacity??24,production:activities.filter(a=>a.output).map(a=>({activity_id:a.activity_id,
  experiment:a.method?.experiment??null,
  resource:a.output.resource,name:RESOURCES[a.output.resource]??a.output.resource,output_count:a.output.count,
  already_held:stock[a.output.resource]??0,
  reserve_limit:a.output.count,
  uses:activities.filter(other=>other.inputs?.some(i=>i.resource===a.output.resource)).map(other=>({activity_id:other.activity_id,title:other.title,available:other.available,count:other.inputs.filter(i=>i.resource===a.output.resource).reduce((n,i)=>n+i.count,0)})),
  accepted_outgoing:(world.social?.commitments??[]).filter(c=>c.actors?.includes(actorId)&&['accepted','meeting','working'].includes(c.status))
   .flatMap(c=>(c.offers??[]).filter(o=>o.from===actorId&&o.resource===a.output.resource).map(o=>({commitment_id:c.id,count:o.count}))),
 })),rule:'可生产不代表需要再生产。先看已经持有多少、真实用途和已接受的责任；未回复不是需求，无限备货不是默认后续。可有自己的备用或探索理由，也可用已有物品、做别的、休息或放下，不强制送出。没有货币或工钱机制，不把谈价当作已存在的交易。'};
}

export function validateProductionUse(compiled,context){
 const use=context.use_context;if(use?.contract!=='finite-use-v1')return;
 const p=compiled.operation==='activity'?use.production.find(p=>p.activity_id===compiled.activity_id):null;
 const choice=compiled.production_use;
 const reject=()=>{throw Object.assign(Error('production_use_invalid'),{code:'production_use_invalid',statusCode:409});};
 if(!p){if(choice!=null)reject();return;}
 if(!choice||choice.activity_id!==p.activity_id||!['self_use','accepted_delivery','reserve','experiment'].includes(choice.kind)
  ||typeof choice.reason!=='string'||!choice.reason.trim()||choice.reason.length>240
  ||!Number.isSafeInteger(choice.target_stock)||choice.target_stock<=0||choice.target_stock>use.capacity)reject();
 if(choice.kind==='accepted_delivery'){
  const offer=p.accepted_outgoing.find(o=>o.commitment_id===choice.reference_id);
  if(!offer||choice.target_stock!==offer.count)reject();
 }else if(choice.kind==='self_use'){
  const consumer=p.uses.find(o=>o.activity_id===choice.reference_id);
  if(!consumer||choice.target_stock!==consumer.count)reject();
 }else if(choice.kind==='experiment'){
  if(['authored-method-v1','method-conditions-v2'].includes(use.experiment_rule)&&!p.experiment)reject();
  const registered=use.experiment_rule==='method-conditions-v2';
  if(registered&&(!p.experiment.available||choice.target_stock!==p.already_held+p.output_count))reject();
  const target=registered?p.experiment.completion_target_id:`activity:${p.activity_id}`;
  const issue=[context.continuation.current,...(context.continuation.deferred??[])].find(f=>f?.followup_id===choice.reference_id);
  if(!issue||!['continue','postpone'].includes(compiled.followup_decision)||compiled.followup_id!==issue.followup_id
   ||compiled.completion_target_id!==target||issue.completed_steps?.some(s=>s.target.id===compiled.completion_target_id)
   ||issue.completion_target?.id===compiled.completion_target_id&&issue.resolution_evidence_ids?.length)reject();
 }else if(choice.reference_id!=null||choice.target_stock>(p.reserve_limit??use.capacity))reject();
 if(choice.kind!=='experiment'&&p.already_held>=choice.target_stock)reject();
}

export function validateDecisionIssue(proposal){
 if(!Object.hasOwn(proposal,'decision_issue')||proposal.decision_issue===null)return;
 const c=proposal.compiled,d=proposal.decision_issue;
 if(!d||['followup_id','completion_target_id','followup_closure','step_review'].some(k=>!isDeepStrictEqual(c[k]??null,d[k]??null))
  ||c.followup_decision!==d.followup_decision)
  throw Object.assign(Error('decision_issue_changed_by_compiler'),{code:'decision_issue_changed_by_compiler',statusCode:409});
}

export function validateDecisionMethod(proposal,context){
 if(proposal.choice_binding && (!['single-choice-v1','choice-catalogue-v2'].includes(proposal.choice_binding.contract)
   || proposal.choice_binding.model_compile_calls!==0 || !isDeepStrictEqual(proposal.choice_binding.compiled,proposal.compiled)))
  throw Object.assign(Error('actor_choice_binding_changed'),{code:'actor_choice_binding_changed',statusCode:409});
 if(!Object.hasOwn(proposal,'decision_method')||context.use_context?.contract!=='finite-use-v1')return;
 const c=proposal.compiled,method=proposal.decision_method;
 if(method!=null?(c.operation!=='activity'||c.activity_id!==method):c.operation==='activity')
  throw Object.assign(Error('decision_method_changed_by_compiler'),{code:'decision_method_changed_by_compiler',statusCode:409});
 if(!isDeepStrictEqual(c.production_use??null,proposal.decision_production??null))
  throw Object.assign(Error('decision_production_changed_by_compiler'),{code:'decision_production_changed_by_compiler',statusCode:409});
 validateProductionUse(c,context);
}

/** The compiler must implement, not silently replace, the actor's communication choice. */
export function validateDecisionContact(proposal, refs) {
  // Historical proposals predate this adapter field and keep their original validators.
  if(!Object.hasOwn(proposal,'decision_contact'))return;
  const choice=proposal.decision_contact,compiled=proposal.compiled;
  const fail=()=>{throw Object.assign(new Error('decision_contact_changed_by_compiler'),{code:'decision_contact_changed_by_compiler',statusCode:409});};
  if(choice===null){if(compiled?.operation==='share')fail();return;}
  if(!choice||!['message','reply','invite','respond'].includes(choice.kind)||compiled?.operation!=='share')fail();
  if(!Array.isArray(compiled.receiver_indices))fail();
  const receivers=compiled.receiver_indices.map(n=>refs.receivers[n-1]);
  const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&[...a].sort().every((v,i)=>v===[...b].sort()[i]);
  if(!same(receivers,choice.receiver_ids)||!same(compiled.source_ids??[],choice.source_ids??[]))fail();
  if((compiled.followup_id??null)!==(choice.followup_id??null))fail();
  if(choice.kind==='invite'){
    if(compiled.social?.operation!=='invite'||compiled.social.option_id!==choice.option_id||receivers.length!==1)fail();
  }else if(choice.kind==='respond'){
    const s=compiled.social;
    if(s?.operation!=='respond'||s.commitment_id!==choice.commitment_id||s.response!==choice.response||receivers.length!==1
      ||choice.response==='delay'&&s.delay_minutes!==choice.delay_minutes)fail();
  }else if(compiled.social)fail();
  if((compiled.reply_to??null)!==(choice.kind==='reply'?choice.reply_to:null))fail();
}
