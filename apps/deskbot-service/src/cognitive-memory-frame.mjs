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
 const previous=task?.completion?.result?.before?.waylight,next=task?.completion?.result?.after?.waylight;
 if(previous&&next)facts.push({id:'lamp',text:`执行器在任务前后记录：归途灯${previous.mode==='hooded'?'有罩':'敞开'}→${next.mode==='hooded'?'有罩':'敞开'}，亮度${previous.brightness.toFixed(2)}→${next.brightness.toFixed(2)}，蓄光${previous.charge.toFixed(2)}→${next.charge.toFixed(2)}。灯按昼夜自行发光，借灯滤水不等于点亮灯。`});
 return {schema:'deskbot.event-memory-frame.v1',root_outcome_id:result.root_outcome_id,at:result.occurred_at,facts};
}
