import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {continuityFixture} from './continuity-fixtures.mjs';
import {developmentFixture,policyChoice,settle,OWNER,BASE} from './development-fixtures.mjs';
import {installResidentLife} from '../../../apps/deskbot-service/src/resident-life.mjs';
import {cognitiveContext,applyCognitiveMutation,cognitiveRelevantKey} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=resolve(arg('output'));mkdirSync(output,{recursive:true});
const traces=[],atMinute=(at,n)=>new Date(Date.parse(at)+n*60000).toISOString();
function moveTime(w,at){advanceLivingResources(w,at,{force:true});w.clock.synced_at=at;}
function snapshot(w,label){const c=cognitiveContext(w,OWNER,w.clock.synced_at);return {label,at:w.clock.synced_at,time:c.time,question:c.saved.followup?.question??null,
 wait_for:c.saved.followup?.wait_for??null,next_review:c.saved.followup?.next_review_at??null,condition:c.continuation.current?.condition??null,wait_started_at:c.saved.followup?.wait_started_at??null,
 task_count:w.tasks.length,notes:w.resonant_life?.notes?.[OWNER]?.length??0,outbox_count:w.cognition.actors[OWNER].outbox?.length??0};}
{
 const w=continuityFixture(OWNER,'water-calm'),life=w.cognition.actors[OWNER],start=w.clock.synced_at,root=life.last_result.root_outcome_id;
 const rows=[snapshot(w,'刚完成一次实际测记')];
 policyChoice(w,{operation:'wait',reason:'让刚测过的浮铃稳定后再复测',motivation:'unknown',wait_for:{kind:'activity',id:'echo-read-bell'},review_after_minutes:60,followup_decision:'continue'});
 rows.push(snapshot(w,'保留原问题，在半小时条件到期时复查'));
 moveTime(w,life.followup.next_review_at);rows.push(snapshot(w,'服务端确认冷却已到期，方法当前可用'));
 const task=policyChoice(w,{operation:'activity',activity_id:'echo-read-bell',reason:'到期后实际复测',motivation:'self_continuation',prior_root_id:root});
 if(task?.status!=='completed')throw Error('read_not_completed');rows.push(snapshot(w,'实际执行复测，留下第二份记录'));
 traces.push({id:'timed-reading',title:'该复测的时候，时间是明确的',kind:'rule_replay',rows,
  previous_behavior:'旧代码等待统一推迟四小时，并用等待理由覆盖原问题。',new_behavior:'按同一条半小时测记规则计算复查时间；保留原问题和结果出处，到期后仍由选择决定是否执行。',root:`task:${task.task_id}`});
}
{
 const w=developmentFixture();installResidentLife(w,BASE);w.npcs.find(n=>n.npc_id==='lamp-keeper-001').location_id=w.protagonist.location_id;
 policyChoice(w,{operation:'share',receiver_indices:[1],message_parts:[{kind:'question',text:'想听听你对余辉的看法'}],message:'',reason:'先询问对方意见',motivation:'unknown'});
 const life=w.cognition.actors[OWNER],sent=life.outbox.at(-1),start=w.clock.synced_at;life.followup.question='想听听灯穗对余辉的看法';
 const rows=[snapshot(w,'问题已经实际送达，尚无关联回应')];
 for(const n of [0,120,240]){
  moveTime(w,atMinute(start,n));policyChoice(w,{operation:'wait',reason:'暂时留意这条消息的回应',motivation:'unknown',wait_for:{kind:'reply',id:sent.message_id},followup_decision:'continue'});
  rows.push(snapshot(w,n?'再次复查，等待起点保持不变':'保存明确的回复条件'));
 }
 moveTime(w,atMinute(start,361));rows.push(snapshot(w,'等待期限到了，仍未收到关联回复'));
 policyChoice(w,{operation:'wait',reason:'今天先自己观察，保留问题，暂时不等这条回应',motivation:'unknown',wait_for:null,followup_decision:'postpone'});
 rows.push(snapshot(w,'明确暂缓回复等待，保留原问题与经历'));
 traces.push({id:'unanswered-message',title:'没人回复时，也能重新安排',kind:'rule_replay',rows,
 previous_behavior:'旧等待没有明确回复条件和固定复查期限，原问题会被等待理由覆盖。',new_behavior:'真实消息和关联回应分别核验；六小时是复查边界，不能靠重写理由续期。暂缓不扣兴趣，也不伪造对方承诺。',root:sent.root_outcome_id});
}
const evidence={schema:'deskbot.continuity.review.v1',note:'确定性规则回放。前态、时间与选择由夹具编排，任务通过实际执行器结算。不是模型自然跨日记录。',traces,
 limits:['六小时是等待诊断与复查参数，尚待自然体验调校；不要求六小时内必须完成活动。','相同消息无新回应时拦截重复送达；不同措辞但语义重复仍需模型对照与人工评审。','回复收到不等于接受邀请，冷却到期也不保证其他材料和设施条件满足。','原始意图、主观解释和反思仍可能有语义错误；规则与时间视图不保证所有文字正确。'],model:{note:'真实模型结果整理中。',cases:[],provider_calls:0,upper_cny:0},
 world:{status:'设计草案，尚未实现新地图',candidate:'风语林（工作名）',idea:'从熟悉的镇边进入林深，在风和光叶之间观察、制作、留下标记，再带着旧问题返回。',areas:[{name:'林间低地',purpose:'安静观察、休息、照料与复看'},{name:'风口棚',purpose:'比较收集架和风向，维护自己的造物'},{name:'归枝台',purpose:'整理材料、与居民交接、讨论不同解释'}]}};
writeFileSync(join(output,'continuity-review.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({replays:traces.length,paid_calls:0,file:join(output,'continuity-review.json')}));
