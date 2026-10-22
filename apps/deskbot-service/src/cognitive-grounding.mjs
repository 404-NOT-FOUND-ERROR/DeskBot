import {RESOURCES} from './living-resources.mjs';

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
