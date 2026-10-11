import {randomUUID} from 'node:crypto';

export const LIFE_OBSERVATION_SCHEMA = 'deskbot.life-observation.v1';
const NS = 'life.observation';
const HEARTBEAT_LIMIT_MS = 90_000;
const DAY_MS = 86_400_000;
const date = at => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
const clone = value => structuredClone(value);
const counts = () => ({completed:0,failed:0,cancelled:0,need:0,self_continuation:0,invited:0,unknown:0,practice:0,observation:0,travel:0,rest:0,input_linked:0,followups:0});
function addResult(target, r) {
  if (Object.hasOwn(target,r.outcome)) target[r.outcome]++;
  const motivation = r.causes?.motivation?.kind;
  target[Object.hasOwn(target,motivation) ? motivation : 'unknown']++;
  if (r.outcome !== 'completed') return;
  if (r.effect?.practice) target.practice++;
  if (r.source?.life_action === 'observe') target.observation++;
  if (r.source?.life_action === 'rest') target.rest++;
  if (r.source?.task_kind === 'travel') target.travel++;
  if (r.causes?.sources?.some(s => s.attested)) target.input_linked++;
  if (r.source?.life_followup_id) target.followups++;
}
function inputKey(r) { return `${r.category}:${r.source_label}:${r.origin_id ?? r.id}`; }
function snapshots(w) {
  return Object.values(w.autonomy?.actors ?? {}).map(a => {
    const r = w.memory?.development?.rhythm?.actors?.[a.actor_id];
    const task = w.tasks?.find(t => t.actor_id === a.actor_id && ['running','paused'].includes(t.status));
    return {actor_id:a.actor_id, name:a.actor_id===w.protagonist.character_id?'喵呜':w.npcs?.find(n=>n.npc_id===a.actor_id)?.display_name??a.actor_id,
      energy:a.energy,appetite:a.appetite,paused:!!a.paused,goal:a.plan?.goal??null,title:a.plan?.title??null,
      task_status:task?.status??null,primary_topic:r?.primary_topic??null,
      topics:Object.values(r?.topics??{}).map(t=>({topic:t.topic,label:t.label,status:t.status,formed_at:t.formed_at,reason:t.reason})),
      pending_followups:(w.memory?.development?.rhythm?.opportunities??[]).filter(o=>o.actor_id===a.actor_id&&['waiting_day','available','scheduled'].includes(o.status)).length};
  });
}

// A separate local audit projection. It never dispatches tasks, creates inputs,
// changes interests, or awards growth. GET reads never sample or settle the world.
export function createLifeObservation({worldSnapshot,persistence=null,now=()=>new Date()}={}) {
  let state = null, session = null;
  function day(at) {
    const key = date(at);
    let d = state.days.find(d=>d.date===key);
    if (!d) { d={date:key,online_seconds:0,unobserved_seconds:0,samples:0,inputs:{},choices:{},actors:{},results:[],changes:[]};state.days.push(d); }
    return d;
  }
  function interval(from, to, field) {
    let cursor=Date.parse(from), end=Date.parse(to);
    while(cursor<end) {
      const key=date(cursor), boundary=Date.parse(`${key}T00:00:00+08:00`)+DAY_MS, next=Math.min(end,boundary);
      day(cursor)[field]+=(next-cursor)/1000;cursor=next;
    }
  }
  function save() {
    state.days.sort((a,b)=>a.date.localeCompare(b.date));state.days=state.days.slice(-31);
    persistence?.put(NS,state.world_id,state);
  }
  function start() {
    const w=worldSnapshot(),at=now().toISOString();session=randomUUID();
    state=persistence?.get(NS,w.world_id)??null;
    if(state && state.schema!==LIFE_OBSERVATION_SCHEMA) throw Error('unsupported_life_observation_schema');
    if(!state) state={schema:LIFE_OBSERVATION_SCHEMA,world_id:w.world_id,started_at:at,last_observed_at:null,last_session:null,
      days:[],seen_roots:[],seen_inputs:[],seen_plans:[],latest:[]};
    const roots=w.memory?.development?.records??[];
    if(state.last_observed_at) interval(state.last_observed_at,at,'unobserved_seconds');
    // Startup recovery is not proof that someone acted while the service was off.
    const newRecovery=roots.filter(r=>!state.seen_roots.includes(r.root_outcome_id)&&state.last_observed_at);
    day(at).reconciled_roots=(day(at).reconciled_roots??0)+newRecovery.length;
    state.seen_roots=roots.map(r=>r.root_outcome_id);
    state.seen_inputs=(w.refraction?.records??[]).map(inputKey);
    state.seen_plans=Object.values(w.autonomy?.actors??{}).map(a=>a.plan?.plan_id).filter(Boolean);
    state.last_observed_at=at;state.last_session=session;state.latest=snapshots(w);day(at).samples++;save();
  }
  function sample() {
    if(!session) return;
    const at=now().toISOString(),w=worldSnapshot();
    const elapsed=Date.parse(at)-Date.parse(state.last_observed_at);
    if(elapsed<=0) return;
    const continuous=elapsed<=HEARTBEAT_LIMIT_MS;
    interval(state.last_observed_at,at,continuous?'online_seconds':'unobserved_seconds');
    const today=day(at),rootIds=new Set(state.seen_roots),inputIds=new Set(state.seen_inputs),plans=new Set(state.seen_plans);
    for(const r of w.memory?.development?.records??[]) {
      if(rootIds.has(r.root_outcome_id)) continue;
      rootIds.add(r.root_outcome_id);
      if(!continuous||Date.parse(r.at)<Date.parse(state.last_observed_at)||Date.parse(r.at)>Date.parse(at)) {
        today.reconciled_roots=(today.reconciled_roots??0)+1;continue;
      }
      const d=day(r.at);
      for(const actorId of r.actor_ids??[]) { d.actors[actorId]??=counts();addResult(d.actors[actorId],r); }
      d.results.push({root_id:r.root_outcome_id,at:r.at,actor_ids:[...(r.actor_ids??[])],title:r.title,outcome:r.outcome,topic:r.topic,
        practice:!!r.effect?.practice,motivation:r.causes?.motivation?.kind??'unknown',
        sources:[...new Set((r.causes?.sources??[]).filter(s=>s.attested).map(s=>s.category))],
        prior_root:r.source?.prior_root_id??null});d.results=d.results.slice(-120);
    }
    for(const r of w.refraction?.records??[]) {
      const id=inputKey(r);if(inputIds.has(id))continue;inputIds.add(id);
      if(!continuous||Date.parse(r.received_at)<Date.parse(state.last_observed_at))continue;
      const key=`${r.category}:${r.attested?'attested':'unverified'}`;
      day(r.received_at).inputs[key]=(day(r.received_at).inputs[key]??0)+1;
    }
    for(const a of Object.values(w.autonomy?.actors??{})) {
      const p=a.plan;if(!p||plans.has(p.plan_id))continue;plans.add(p.plan_id);
      if(!continuous||Date.parse(p.created_at)<Date.parse(state.last_observed_at))continue;
      const key=p.decision?.source??'rules';today.choices[key]=(today.choices[key]??0)+1;
    }
    const next=snapshots(w);
    for(const a of next) {
      const old=state.latest.find(o=>o.actor_id===a.actor_id);
      if(old && (old.primary_topic!==a.primary_topic||JSON.stringify(old.topics.map(t=>[t.topic,t.status]))!==JSON.stringify(a.topics.map(t=>[t.topic,t.status])))) {
        today.changes.push({at,actor_id:a.actor_id,primary_from:old.primary_topic,primary_to:a.primary_topic,
          topics:a.topics.map(t=>({label:t.label,status:t.status,reason:t.reason}))});today.changes=today.changes.slice(-48);
      }
    }
    state.seen_roots=[...rootIds].slice(-4096);state.seen_inputs=[...inputIds].slice(-1024);state.seen_plans=[...plans].slice(-2048);
    state.latest=next;state.last_observed_at=at;today.samples++;save();
  }
  function read() {
    const at=now().toISOString(),w=worldSnapshot();
    const retained=(w.memory?.development?.records??[]).filter(r=>Date.parse(r.at)>Date.parse(at)-DAY_MS);
    const historical={scope:'retained_roots_including_offline_reconciliation',actors:{}};
    for(const r of retained) for(const id of r.actor_ids??[]) {historical.actors[id]??=counts();addResult(historical.actors[id],r);}
    return {schema:LIFE_OBSERVATION_SCHEMA,started_at:state?.started_at??null,last_observed_at:state?.last_observed_at??null,
      sampled_status:state?.last_observed_at&&Date.parse(at)-Date.parse(state.last_observed_at)<=HEARTBEAT_LIMIT_MS?'collecting':'no_recent_sample',
      protagonist_id:w.protagonist.character_id,days:clone(state?.days??[]),current:snapshots(w),historical_24h:historical,
      policy:{time_zone:'Asia/Shanghai',retained_days:31,heartbeat_limit_seconds:90,automatic_acceptance:false,
        note:'只累计连续心跳确认的在线时间。停机、长调度间隙和启动补结算单列；观察不制造活动或成长。'}};
  }
  return {start,sample,read};
}
