// Render only recorded fictional cases; no model calls or production reads.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const arg=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const dir=resolve(arg('input')),raw=JSON.parse(readFileSync(join(dir,'results.json')));
const optional=name=>existsSync(join(dir,name))?JSON.parse(readFileSync(join(dir,name))):null;
const audit=optional('semantic-audit.json'),replay=optional('replay-check.json');
const validation=optional('local-validation.json'),manifest=optional('manifest.json');
const budgetStopped=r=>['call_limit_reached','budget_exhausted','budget_limit_reached'].includes(r.error);
const reviewStopped=r=>r.error==='window_review_stopped';
const calls=raw.budget?.calls??[],quantile=(values,q)=>values.length?[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)]:null;
function usage(rows){return {calls:rows.length,input:rows.reduce((n,r)=>n+(r.usage?.prompt_tokens??0),0),output:rows.reduce((n,r)=>n+(r.usage?.completion_tokens??0),0),
 cost_cny:rows.reduce((n,r)=>n+r.held_cny,0),unknown:rows.filter(r=>r.uncertain).length,provider_failed:rows.filter(r=>r.status!=='completed').length,
 p50_ms:quantile(rows.map(r=>r.latency_ms).filter(Number.isFinite),.5),p95_ms:quantile(rows.map(r=>r.latency_ms).filter(Number.isFinite),.95),
 queue_ms:rows.reduce((n,r)=>n+(r.queue_ms??0),0),input_chars:rows.reduce((n,r)=>n+(r.input_chars??0),0)};}
const report={schema:'deskbot.r3a-review.v1',version:raw.version,status:audit?.status??'真实调用已保存，语义审查未完成',
 summary:audit?.summary??'尚未判定行为达标。',usage:usage(calls),repairs:calls.filter(c=>c.stage.endsWith('_repair')).length,
 stages:[...new Set(calls.map(c=>c.stage))].map(stage=>({stage,...usage(calls.filter(c=>c.stage===stage))})),
 protocol_or_execution_failures:raw.results.filter(r=>r.error&&!budgetStopped(r)&&!reviewStopped(r)).length,
 semantic_review_stops:raw.results.filter(reviewStopped).length,
 budget_stops:raw.results.filter(budgetStopped).length,assessment:audit?.assessment??null,campaign_usage:audit?.campaign_usage??null,
 completed_windows:raw.results.flatMap(r=>r.turns).filter(t=>t.after&&!t.truncated&&(t.feedback_proposal||t.compiled?.operation==='wait')).length,
 deterministic_choice_windows:raw.results.flatMap(r=>r.turns).filter(t=>['single-choice-v1','choice-catalogue-v2'].includes(t.plan_proposal?.choice_binding?.contract)).length,
 observed_windows:raw.results.reduce((n,r)=>n+r.turns.length,0),planned_windows:(validation?.cases?.length??raw.results.length)*(manifest?.turns??4),
 window_p50_ms:quantile(raw.results.flatMap(r=>r.turns).map(t=>t.latency_ms).filter(Number.isFinite),.5),
 window_p95_ms:quantile(raw.results.flatMap(r=>r.turns).map(t=>t.latency_ms).filter(Number.isFinite),.95),
 replay,checks:optional('local-validation.json'),local_revision:optional('local-followup.json'),findings:audit?.findings??[],
 cases:raw.results.map(r=>({id:r.id,error:r.error??null,error_detail:r.error_detail??null,stop_kind:r.error?(budgetStopped(r)?'budget':reviewStopped(r)?'review':'error'):null,elapsed_ms:r.latency_ms,note:audit?.cases?.[r.id]?.note??'待逐例审查',
  turns:r.turns.map(t=>({turn:t.turn,at:t.at,action:t.task?.title??t.compiled?.operation??'未采用计划',activity:t.task?.activity_id??null,
   operation:t.compiled?.operation??null,reason:t.reason??null,result:t.actual_result?.effects??null,
   feedback_pending:Boolean(t.actual_result&&!t.feedback_proposal),
   actual_text:t.task?.cognitive_operation==='share'?(t.task.cognitive_message_delivered_at?'留言送达；物品未交接，所谈活动未因此完成。':'留言未送达；没有向对方公开结果。'):t.compiled?.operation==='wait'?'本人选择暂不行动，保留后续复查；没有新增物质成果。':t.task?.completion?.result?.text??(t.task?.status==='completed'&&t.compiled?.operation==='rest'?'已完成这次休息；没有把休息计作研究成果。':t.task?.status==='completed'&&t.compiled?.operation==='observe'?'已完成现场观察；没有制作、交付或新增物品。':null),
   delivered_message:t.task?.cognitive_message_delivered_at?t.task?.cognitive_message?.text??null:null,
   success:t.actual_result?.success??null,blocked:t.actual_result?.failure_reason??null,latency_ms:t.latency_ms??null,
   decision_contact:t.plan_proposal?.decision_contact??null,
   decision_issue:t.plan_proposal?.decision_issue??null,
   production_use:t.plan_proposal?.decision_production??null,memory_anchor_checks:t.feedback_proposal?.memory_anchor_checks??[],
   recollections:(t.feedback_proposal?.memories??[]).filter(m=>m.payload.stream==='experiential'&&m.payload.kind==='event').map(m=>({
     feeling:m.payload.stored_content,
     fact:(t.feedback_proposal?.memories??[]).find(f=>f.payload.stream==='factual'&&f.payload.event_group_id===m.payload.event_group_id)?.payload.raw_content??null})),
   prior_issue:t.prior_followup??null,issues:t.issues??null,followup:t.followup??null,audit:audit?.cases?.[r.id]?.turns?.[String(t.turn)]??null}))})),
 limitations:[`计划 ${(validation?.cases?.length??raw.results.length)} 例、各 ${manifest?.turns??4} 个模拟窗口；不能证明自然跨日、稳定兴趣或多人生活。`,'其他居民未运行自主认知，不把未回复说成拒绝。',
 'resolved只核验绑定的具体一步；开放研究的satisfied是个人判断，不是客观结论。','相关来源仍依赖个人折射与引用范围，未验证任意自然语言的语义正确性。',
 '费用按已登记单价估算，含修复及失败；实际账单未知。小样本P95只描述本批。',
 '旧批次与本批路径和上下文不同；费用差异不能单独归因于压缩，也不能外推整镇日费用。']};
const output=resolve(arg('output')??'apps/jev-town-client/public/r3a-review.json');writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({output,version:report.version,completed_windows:report.completed_windows,usage:report.usage,status:report.status}));
