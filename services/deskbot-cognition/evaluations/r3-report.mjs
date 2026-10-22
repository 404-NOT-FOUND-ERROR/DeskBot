import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const arg=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const dir=resolve(arg('input')??''),raw=JSON.parse(readFileSync(join(dir,'results.json'),'utf8'));
const auditPath=join(dir,'semantic-audit.json'),audit=existsSync(auditPath)?JSON.parse(readFileSync(auditPath)):null;
const rows=raw.results;
const supplementalPath=join(dir,'supplement.json'),supplement=existsSync(supplementalPath)?JSON.parse(readFileSync(supplementalPath)):null;
// Recompute the frozen run's strict categories from activity IDs. Collecting
// and filtering water have the same resource consequence, not two options.
function strictOptions(t){
  const categories=new Set();
  for(const {activity_id:k} of t.opportunity.raw.methods??[])
    categories.add(['waylight-use','collect-water'].includes(k)?'取水':/build|craft|fit|repair/.test(k)?'改变物件':/open|shade|close/.test(k)?'调整光照':/read|measure|observe/.test(k)?'测记':'其他生产照料');
  if(t.opportunity.meaningful_options.includes('交流'))categories.add('交流');
  return [...categories];
}
const percentile=(a,q)=>a.length?[...a].sort((a,b)=>a-b)[Math.min(a.length-1,Math.ceil(a.length*q)-1)]:null;
const taskKey=t=>t?.activity_id??t?.life_action??t?.kind??'none';
const compact=r=>({
  key:r.key,id:r.id,group:r.group,repeat:r.repeat,on:r.on,actor:r.actor,arm:r.arm,error:r.error??null,
  latency_ms:r.latency_ms,initial_hash:r.initial_hash,final_hash:r.final_hash,
  turns:r.turns.map(t=>({
    turn:t.turn,at:t.at,reason:t.reason??'',op:t.compiled?.operation??t.plan?.goal??'未选择',
    activity:t.compiled?.activity_id??null,compiled:t.compiled??null,followup:t.followup??null,
    prior_followup:t.prior_followup,opportunity:{...t.opportunity,meaningful_options:strictOptions(t),strict_two:t.opportunity.raw.free&&strictOptions(t).length>=2},
    inputs:t.inputs.map(i=>({id:i.id,category:i.category,name:i.sender_name,text:i.content})),
    interpretations:t.plan_proposal?.interpretations??[],
    actual:t.actual_result?{success:t.actual_result.success,effects:t.actual_result.effects??null}:null,
    tasks:(t.tasks??(t.task?[t.task]:[])).map(x=>({id:x.task_id,title:x.title,activity:taskKey(x),status:x.status,
      result:x.cognitive_operation==='share'?(x.cognitive_message_delivered_at?'留言已送达；没有交付物品，也未完成所谈及的活动。':'留言未送达。'):x.completion?.result?.text??null})),
    before:{at:t.before.at,lamp:t.before.lamp,bag:t.before.bag,location:t.before.location},
    after:t.after?{at:t.after.at,lamp:t.after.lamp,bag:t.after.bag,location:t.after.location}:null,
    latency_ms:t.latency_ms??null,truncated:t.truncated??false,
    audit:audit?.cases?.[r.key]?.turns?.[String(t.turn)]??null,
  })),
  audit:audit?.cases?.[r.key]??null,
});
const cognition=rows.filter(r=>r.arm==='cognition'&&r.group!=='persona');
const windows=cognition.flatMap(r=>r.turns).filter(t=>t.opportunity.raw.free);
const eligible=cognition.filter(r=>r.turns.length===2&&!r.error&&!r.turns.some(t=>t.truncated)&&r.turns[1].opportunity.raw.free);
const progress=eligible.filter(r=>{
  const t=r.turns[1];return t.actual_result?.success&&['activity','travel'].includes(t.compiled?.operation)&&t.compiled?.followup_decision==='continue';
});
const calls=raw.budget?.calls??[];
const replayCheck=existsSync(join(dir,'replay-check.json'))?JSON.parse(readFileSync(join(dir,'replay-check.json'))):null;
const pairs=[];
for(const arm of ['rules','bounded','cognition'])for(const group of ['weather','advice','knowledge','invitation','touch','resources']){
  const trials=[];
  for(let repeat=1;repeat<=3;repeat++){
    const off=rows.find(r=>r.arm===arm&&r.group===group&&r.repeat===repeat&&!r.on);
    const on=rows.find(r=>r.arm===arm&&r.group===group&&r.repeat===repeat&&r.on);
    if(!off||!on)continue;
    const actions=r=>r.turns.map(t=>t.compiled?.activity_id??t.compiled?.operation??t.plan?.goal??'error');
    trials.push({repeat,off:actions(off),on:actions(on),actions_differ:JSON.stringify(actions(off))!==JSON.stringify(actions(on)),complete:!off.error&&!on.error});
  }
  pairs.push({arm,group,trials});
}
const gates=[
  {id:'matrix',title:'六类输入、三次成对重复、三条路径',status:rows.filter(r=>r.group!=='persona').length===108?(rows.some(r=>r.error)?'fail':'pass'):'pending',value:`${rows.filter(r=>r.group!=='persona').length}/108`,note:'病例数含失败；未完成不能算通过。'},
  {id:'followup',title:'至少 20 个后续窗口，80% 有依据地推进或收束',status:audit?.followup_gate?.status??'pending',value:audit?.followup_gate?.value??`${eligible.length} 个自由第二窗口；自动筛到 ${progress.length} 个连续实际动作`,note:'动作筛查不直接判定后续相关性；语义审查另列。'},
  {id:'opportunities',title:'70% 自由窗口有两类实质安排',status:windows.length?(windows.filter(t=>strictOptions(t).length>=2).length/windows.length>=.7?'pass':'fail'):'pending',value:`${windows.filter(t=>strictOptions(t).length>=2).length}/${windows.length}`,note:'取水和净滤合并一类；改变物件与交流另列。只证明这些布置好的窗口，不代表自然全天。'},
  {id:'truth',title:'关键完成、承诺、身份、库存错误为零',status:audit?.truth_gate?.status??'pending',value:audit?.truth_gate?.value??'待逐例复核',note:'协议拒绝、模型说错、实际执行失败分别记录。'},
  {id:'replay',title:'缓存重放不调用模型，世界结果一致',status:replayCheck?.status??'pending',value:replayCheck?.summary??'待检查',note:'缺失缓存或请求不匹配明确报错，不补调用。'},
];
const summary={schema:'deskbot.r3-review.v1',version:raw.version,generated_at:new Date().toISOString(),title:'同一盏灯，不同来由',
  status:gates.every(g=>g.status==='pass')?'实验门槛通过；自然跨日仍待 R4':'R3 首轮已完成；仍需修正，未放行 R4',
  scope:'隔离虚构世界 · 实际有限任务 · 两个模拟选择窗口',limitations:raw.limitations,
  gates,pairs,counts:{episodes:rows.length,errors:rows.filter(r=>r.error).length,persona:rows.filter(r=>r.group==='persona').length},
  usage:{calls:calls.length,failed:calls.filter(c=>c.status!=='completed').length,unknown:calls.filter(c=>c.uncertain).length,
    prompt_tokens:calls.reduce((n,c)=>n+(c.usage?.prompt_tokens??0),0),completion_tokens:calls.reduce((n,c)=>n+(c.usage?.completion_tokens??0),0),
    upper_cny:raw.budget?.used_upper_cny??0,api_p50_ms:percentile(calls.map(c=>c.latency_ms).filter(Number.isFinite),.5),
    api_p95_ms:percentile(calls.map(c=>c.latency_ms).filter(Number.isFinite),.95),
    round_p50_ms:percentile(cognition.flatMap(r=>r.turns.map(t=>t.latency_ms)).filter(Number.isFinite),.5),
    round_p95_ms:percentile(cognition.flatMap(r=>r.turns.map(t=>t.latency_ms)).filter(Number.isFinite),.95),note:raw.budget?.cost_note},
  audit: audit?{summary:audit.summary,reviewer:audit.reviewer,followup_gate:audit.followup_gate,truth_gate:audit.truth_gate}:null,
  supplement,episodes:rows.map(compact)};
const output=resolve(arg('output')??join(dir,'review.json'));
writeFileSync(output,JSON.stringify(summary,null,2));
console.log(JSON.stringify({output,episodes:rows.length,errors:summary.counts.errors,cost:summary.usage.upper_cny,gates:gates.map(g=>[g.id,g.status])}));
