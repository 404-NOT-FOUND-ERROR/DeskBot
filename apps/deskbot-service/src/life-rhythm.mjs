import { ACTIVITIES } from './living-resources.mjs';
import { createHash } from 'node:crypto';
import { developmentFacetsReadModel } from './development-facets.mjs';

export const LIFE_RHYTHM_VERSION = 'deskbot.life-rhythm.v1';
const DAY = 86400000;
const ms = at => Date.parse(at ?? '');
const day = at => new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(at));
const nextMorning = at => new Date(ms(`${day(at)}T08:00:00+08:00`) + DAY).toISOString();
const realMotivation = r => r.causes?.motivation?.kind==='accepted_obligation'?'accepted_obligation':r.causes?.trigger === 'invited' ? 'invited' : r.causes?.motivation?.kind ?? 'unknown';
const pending = o => !['completed','failed','expired'].includes(o.status);
const summary = {
  invested:'已经形成投入，继续留出自己的时间。', held:'投入还在，眼下先处理需要、约定或实际条件。',
  quiet:'最近暂未继续，先留着这份投入。', parked:'一段时间没有主动继续，暂时搁置；已有经历仍保留。',
  reawakened:'相关消息或后续重新带来机会，是否继续还要看实际选择。',
  trying:'已有主动尝试，继续看它会不会跨日发展。', attention:'目前只是留意，还没有形成稳定投入。',
};
export function readFollowupSite(w, link, at) {
  const o=w.memory?.development?.rhythm?.opportunities.find(o=>o.id===link?.id&&o.source_root_id===link?.source_root_id);
  if(!o||o.kind!=='review')return null;
  const recipe=ACTIVITIES.find(a=>a.activity_id===o.activity_id),object=w.living?.objects[recipe?.target];
  if(!object)return null;
  return {at,object_id:recipe.target,name:w.map_catalog.objects.find(x=>x.object_id===recipe.target)?.name??recipe.target,
    values:Object.fromEntries(['moisture','growth','health','quantity','condition'].filter(k=>Number.isFinite(object[k])).map(k=>[k,object[k]])),
    stock:structuredClone(object.stock??{})};
}
function currentConstraint(w, actorId) {
  const state=w.autonomy?.actors[actorId];
  if(state?.paused)return '自主安排暂缓';
  if(state?.energy<.4)return '先恢复精神';
  if(state?.appetite>.6)return '先处理吃饭与补给';
  const task=w.tasks?.find(t=>t.actor_id===actorId&&['running','paused'].includes(t.status));
  if(task)return task.status==='paused'?'原任务暂停中':'先做完正在进行的事';
  if(w.social?.commitments?.some(c=>c.actors.includes(actorId)&&['accepted','meeting','working'].includes(c.status)))return '先照应已经接受的约定';
  return null;
}

// Scheduling state lives beside the same result ledger. It stores intentions
// and maintenance history, never a second outcome, liking score or role gate.
export function syncLifeRhythm(w, at) {
  const d=w.memory?.development;
  if(!d||!Number.isFinite(ms(at)))return {enabled:false};
  d.rhythm??={schema:LIFE_RHYTHM_VERSION,installed_at:at,revision:0,actors:{},opportunities:[]};
  const rhythm=d.rhythm, before=JSON.stringify({actors:rhythm.actors,opportunities:rhythm.opportunities});
  const records=d.records.filter(r=>ms(r.at)<=ms(at));
  const facets=developmentFacetsReadModel(w,{at});
  for(const actor of facets.actors){
    const state=rhythm.actors[actor.actor_id]??={actor_id:actor.actor_id,primary_topic:null,side_topics:[],topics:{}};
    const constraint=currentConstraint(w,actor.actor_id);
    for(const topic of actor.topics){
      const related=records.filter(r=>r.actor_ids.includes(actor.actor_id)&&r.topic===topic.topic);
      const active=related.filter(r=>r.outcome==='completed'&&realMotivation(r)==='self_continuation'
        &&(r.effect.practice||r.source?.life_action==='observe'));
      const invited=related.filter(r=>realMotivation(r)==='invited');
      const explored=related.filter(r=>r.outcome==='completed'&&realMotivation(r)==='self_exploration');
      const contacts=(d.contacts??[]).filter(c=>c.actor_id===actor.actor_id&&c.topic===topic.topic&&ms(c.at)<=ms(at));
      if(!active.length&&!explored.length&&!invited.length&&!contacts.length&&!state.topics[topic.topic])continue;
      const t=state.topics[topic.topic]??={topic:topic.topic,label:topic.label,formed_at:null,last_active_at:null,root_outcome_ids:[],status:'attention'};
      if(topic.interest.status==='continuing')t.formed_at??=at;
      const last=active.at(-1);
      if(last&&(!t.last_active_at||last.at>t.last_active_at))t.last_active_at=last.at;
      t.root_outcome_ids=[...new Set([...t.root_outcome_ids,...active.map(r=>r.root_outcome_id),...invited.map(r=>r.root_outcome_id)])].slice(-16);
      const age=ms(at)-ms(t.last_active_at??t.formed_at??contacts.at(-1)?.at??invited.at(-1)?.at??at);
      const renewed=contacts.find(c=>ms(c.at)>ms(t.last_active_at??t.formed_at??at)&&ms(at)-ms(c.at)<3*DAY&&(!c.expires_at||ms(c.expires_at)>ms(at)));
      const blocked=related.at(-1)?.failure&&['resource','condition','route','coordination'].includes(related.at(-1).failure.classification)
        &&ms(at)-ms(related.at(-1).at)<3*DAY&&(!t.last_active_at||related.at(-1).at>t.last_active_at);
      t.status=t.formed_at?(renewed&&age>=3*DAY?'reawakened':constraint||blocked?'held':age>=7*DAY?'parked':age>=3*DAY?'quiet':'invested')
        :age>=3*DAY?'parked':active.length?'trying':'attention';
      t.reason=constraint??(blocked?'上次尝试受实际条件阻碍':summary[t.status]);
      const windows=d.cognitive_windows?.[actor.actor_id];
      if(windows){
        const since=t.last_active_at??explored.at(-1)?.at??t.formed_at??contacts.at(-1)?.at??at;
        const effective=windows.filter(o=>o.at>since&&o.at<=at&&o.free&&o.topics.includes(topic.topic));
        const days=[...new Set(effective.map(o=>day(o.at)))];
        const latest=windows.filter(o=>o.at<=at).at(-1);
        const declaration=w.cognition?.actors[actor.actor_id]?.interest_choices?.[topic.topic];
        const declared=declaration&&(!t.last_active_at||declaration.at>=t.last_active_at);
        t.opportunity_basis={mode:'actual_personal_decision_windows',effective_days:days,free_windows:effective.length,
          offline_days_are_opportunities:false,formed_by_calendar_alone:false};
        // Formation still requires independent cross-day results. Maintenance
        // counts feasible decision days; a month offline does not erase liking.
        if(declared&&declaration.decision==='drop'){t.status='parked';t.reason=`本人暂时放下：${declaration.reason}`;}
        else if(declared&&declaration.decision==='pause'){t.status='held';t.reason=`本人暂缓：${declaration.reason}`;}
        else if(declared&&declaration.decision==='revisit'){t.status='reawakened';t.reason=`想重新看看，尚待实际返回：${declaration.reason}`;}
        else if(constraint||blocked||latest&&!latest.topics.includes(topic.topic)){
          t.status=t.formed_at?'held':active.length||explored.length?'trying':'attention';
          t.reason=constraint??(blocked?'实际条件暂时不支持继续':'最近还没有可返回这个方向的当地方法');
        }else{
          t.status=t.formed_at?(renewed&&days.length>=3?'reawakened':days.length>=7?'parked':days.length>=3?'quiet':'invested')
            :active.length||explored.length?'trying':'attention';
          t.reason=days.length>=7?'七个有实际机会的上海日里选择了其他安排，暂时搁置':summary[t.status];
        }
      }
      t.summary=summary[t.status];
      t.reawakening_source_id=renewed?.source_record_id??null;
    }
    const ranked=Object.values(state.topics).sort((a,b)=>Number(Boolean(b.formed_at))-Number(Boolean(a.formed_at))
      ||String(b.last_active_at??'').localeCompare(String(a.last_active_at??''))||a.topic.localeCompare(b.topic));
    const previous=state.topics[state.primary_topic];
    if(!previous||!previous.formed_at||previous.status==='parked')state.primary_topic=ranked.find(t=>t.formed_at&&t.status!=='parked')?.topic??null;
    state.side_topics=ranked.filter(t=>t.topic!==state.primary_topic&&t.status!=='parked').slice(0,2).map(t=>t.topic);
  }
  for(const o of rhythm.opportunities){
    const result=records.find(r=>r.actor_ids.includes(o.actor_id)&&r.source?.life_followup_id===o.id&&r.source?.task_kind!=='travel'
      &&(r.effect.practice||r.source.life_action==='observe'));
    if(result){o.status=result.outcome==='completed'?'completed':'failed';o.result_root_id=result.root_outcome_id;o.finished_at=result.at;
      const task=w.tasks.find(t=>t.task_id===result.source.task_id);
      if(task?.life_followup_inspection)o.inspection=structuredClone(task.life_followup_inspection);
      continue;}
    if(!pending(o))continue;
    if(ms(at)>ms(o.expires_at)){o.status='expired';o.reason='这次复看窗口已经过去，原经历仍然保留';continue;}
    const plan=w.autonomy?.actors[o.actor_id]?.plan;
    o.status=plan?.life_followup?.id===o.id&&['planned','executing'].includes(plan.status)?'in_progress':ms(at)<ms(o.not_before)?'waiting_day':'available';
    o.reason=currentConstraint(w,o.actor_id)??(o.status==='waiting_day'?'留到明天再看实际变化':'有空时可以考虑这件后续');
  }
  for(const r of records){
    if(r.at<rhythm.installed_at||ms(at)-ms(r.at)>3*DAY||r.historical_import||!r.effect.practice
      ||!['self_continuation','invited'].includes(realMotivation(r))||r.source?.life_followup_id||!r.location_id)continue;
    if(!['completed','failed'].includes(r.outcome)||!ACTIVITIES.some(a=>a.activity_id===r.activity_id))continue;
    if(r.outcome==='failed'&&!['resource','condition','route','coordination'].includes(r.failure?.classification))continue;
    for(const actorId of r.actor_ids){
      const id=`followup:${actorId}:${r.root_outcome_id}`;
      if(rhythm.opportunities.some(o=>o.id===id||o.actor_id===actorId&&o.topic===r.topic&&pending(o)))continue;
      rhythm.opportunities.push({id,actor_id:actorId,topic:r.topic,kind:r.outcome==='failed'?'retry':'review',
        title:r.outcome==='failed'?'换个合适的时候，再试原来的活动':'回来看看昨天留下的变化',
        location_id:r.location_id,activity_id:r.activity_id,source_root_id:r.root_outcome_id,
        created_at:at,not_before:nextMorning(r.at),expires_at:new Date(ms(nextMorning(r.at))+3*DAY).toISOString(),
        status:'waiting_day',reason:'留到明天再看实际变化',result_root_id:null});
    }
  }
  rhythm.opportunities=rhythm.opportunities.slice(-96);
  if(before!==JSON.stringify({actors:rhythm.actors,opportunities:rhythm.opportunities}))rhythm.revision++;
  return {enabled:true,revision:rhythm.revision};
}

export function lifeRhythmReadModel(w,{actorId=null}={}) {
  const rhythm=w.memory?.development?.rhythm;
  if(!rhythm)return null;
  return {schema:LIFE_RHYTHM_VERSION,installed_at:rhythm.installed_at,revision:rhythm.revision,
    actors:structuredClone(Object.values(rhythm.actors).filter(a=>!actorId||a.actor_id===actorId)),
    opportunities:structuredClone(rhythm.opportunities.filter(o=>!actorId||o.actor_id===actorId)),
    policy:{primary_limit:1,side_limit:2,quiet_after_days:3,park_after_days:7,followups_per_day:1,automatic_role_change:false}};
}

export function lifeFollowupCandidates(w,state,at,{travel,practice}={}) {
  if(state.energy<.55||state.appetite>.6)return [];
  const d=w.memory?.development,rhythm=d?.rhythm;
  if(!rhythm)return [];
  if(w.tasks.some(t=>t.actor_id===state.actor_id&&t.life_followup&&t.life_action!=='travel'&&day(t.started_at)===day(at)))return [];
  return rhythm.opportunities.filter(o=>o.actor_id===state.actor_id&&o.status==='available').slice(0,3).map(o=>{
    const goal=`followup:${createHash('sha256').update(o.id).digest('hex').slice(0,16)}`;
    try{
      const source=d.records.find(r=>r.root_outcome_id===o.source_root_id);
      if(!source)throw Error('原结果已超出保留范围，无法核验这次后续');
      const steps=o.kind==='retry'?practice(o.activity_id):[...travel(o.location_id),{kind:'observe',title:`复看${ACTIVITIES.find(a=>a.activity_id===o.activity_id)?.title??'原活动'}的现场`,duration_seconds:900}];
      return {goal,title:o.title,reason:'昨天的实际结果留下了这件后续，今天想回去看看或换个合适办法。',
        score:34,available:true,steps,development_topic:o.topic,discretionary_practice:true,
        life_followup:{id:o.id,source_root_id:o.source_root_id,kind:o.kind}};
    }catch(error){return {goal,title:o.title,score:34,available:false,blocked_reason:error.message,development_topic:o.topic,
      life_followup:{id:o.id,source_root_id:o.source_root_id,kind:o.kind}};}
  });
}
