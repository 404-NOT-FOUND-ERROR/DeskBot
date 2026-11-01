import {RESOURCES} from './living-resources.mjs';

// A compact immutable event frame accompanies feelings through retrieval.
// No summary model chooses which delivered paragraphs become a remembered fact.
export function cognitiveMemoryFrame(result, task){
 const facts=[{id:'execution',text:result.success?`我完成了「${result.effects.verified_title}」。`:`这次没有完成「${result.effects.verified_title}」：${result.failure_reason||'没有可核验的实际任务结果'}。`}];
 if(result.effects.message_delivery){
  facts.push({id:'delivery',text:result.effects.message_delivery.delivered?
   `我向${task.cognitive_message.receiver_names.join('、')}实际送达的完整留言：\n${task.cognitive_message.text}\n送达不代表对方同意，也没有交付物品。`:'消息没有送达；原打算不能记作已传达。'});
 }
 const inventory=result.effects.inventory;
 if(inventory?.before&&inventory?.after){
  const before=inventory.before.stock??{},after=inventory.after.stock??{};
  const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>(before[k]??0)!==(after[k]??0));
  if(changed.length)facts.push({id:'inventory',text:'这次任务前后我的背包：'+changed.map(k=>`${RESOURCES[k]??k} ${before[k]??0}→${after[k]??0}`).join('；')+'。'});
 }
 const start=result.before?.find(o=>o.id===task?.target_object_id)?.state?.waylight;
 const end=result.after?.find(o=>o.id===task?.target_object_id)?.state?.waylight;
 const wholeInterval=Boolean(start&&end);
 const previous=wholeInterval?start:task?.completion?.result?.before?.waylight,next=wholeInterval?end:task?.completion?.result?.after?.waylight;
 const value=n=>Number(n.toPrecision(6));
 const change=(a,b)=>a===b?'记录值相同':`${b>a?'上升':'下降'}${Math.abs(b-a)<.000001?Math.abs(b-a).toExponential(2):Number(Math.abs(b-a).toFixed(6))}`;
 if(previous&&next)facts.push({id:'lamp',text:`执行器在${wholeInterval?'任务开始至结束（含自然时间）':'完成结算瞬间（不是整段任务）'}记录：归途灯${previous.mode==='hooded'?'有罩':'敞开'}→${next.mode==='hooded'?'有罩':'敞开'}，亮度${value(previous.brightness)}→${value(next.brightness)}（${change(previous.brightness,next.brightness)}），蓄光${value(previous.charge)}→${value(next.charge)}（${change(previous.charge,next.charge)}）。灯按昼夜自行发光，借灯滤水不等于点亮灯。前后变化可能包含自然时间与环境作用，不能仅凭这些差值归因于本次操作。`});
 const method=task?.completion?.result?.method_result;
 if(result.success&&method)facts.push({id:'method',text:`执行器方法记录 ${method.id}@${method.version}，结果 ${method.root_outcome_id}：${JSON.stringify({conditions:method.conditions,before:method.before,after:method.after,stock_changes:method.stock_changes})}。这是任务开始至结束、包含环境变化的记录，不是单独因果证明。${method.limits.join('；')}`});
 return {schema:'deskbot.event-memory-frame.v1',affect_contract:'bounded-affect-v1',root_outcome_id:result.root_outcome_id,at:result.occurred_at,facts};
}
