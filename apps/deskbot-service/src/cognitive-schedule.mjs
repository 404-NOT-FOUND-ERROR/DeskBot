// Real-time eligibility and fair dispatch. This chooses when to think, not what
// to want. Ordinary news never acquires wake-up or world mutation authority.
const minutes=(a,b)=>(Date.parse(a)-Date.parse(b))/60000;
const localHour=(at,zone)=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(new Date(at)));
export function cognitiveSleepWindow(w,id,at){
 const hour=localHour(at,w.clock?.time_zone??'Asia/Shanghai');
 return id==='lamp-keeper-001'?hour>=1&&hour<8:hour>=23||hour<7;
}
export function scheduleCognitiveActor(w,id,at,context,{actualResult=false}={}){
 const life=w.cognition?.actors[id];if(!life?.enabled)return null;
 if(life.retry){return life.retry.retryable&&life.retry.at<=at?{phase:life.retry.phase,reason:'retry_due',priority:90}:null;}
 if(life.pending&&actualResult)return {phase:'feedback',reason:'actual_result',priority:100};
 const busy=w.tasks?.some(t=>t.actor_id===id&&['running','paused'].includes(t.status));
 if(context.perceptions.length)return {phase:'perceive',reason:'received_input',priority:80};
 if(busy||life.pending)return null;
 const commitments=context.social?.commitments??[];
 const dueAgreement=commitments.some(c=>['accepted','meeting','working'].includes(c.status)&&(!c.not_before_at||minutes(c.not_before_at,at)<=15));
 if(dueAgreement)return null; // The shared executor owns the accepted work window.
 if(cognitiveSleepWindow(w,id,at))return {phase:'rest_window',reason:'sleep_window',priority:40};
 if((w.autonomy?.actors[id]?.energy??1)<.18)return {phase:'rest_window',reason:'restore_energy',priority:60};
 const age=life.schedule?.last_dispatch_at?Math.max(0,minutes(at,life.schedule.last_dispatch_at)):1440;
 const quiet=life.schedule?.quiet_until>at;
 if(quiet)return null;
 // Slow work has separate clocks and only runs after additional lived evidence.
 const since=phase=>minutes(at,life.maintenance?.[phase]?.at??life.enabled_at??life.job?.started_at??at);
 const newMemories=(life.memory_sequence??0)>(life.maintenance?.reflect?.memory_sequence??0);
 if(newMemories&&since('reflect')>=360)return {phase:'reflect',reason:'new_experiences',priority:35+Math.min(45,age/60)};
 if(context.social?.relation_evidence?.length&&since('relate')>=720)return {phase:'relate',reason:'social_review',priority:30+Math.min(45,age/60)};
 if((life.memories?.length??0)>0&&since('maintain')>=1440)return {phase:'maintain',reason:'daily_memory_and_goals',priority:35+Math.min(45,age/60)};
 const due=life.next_decision_at&&life.next_decision_at<=at;
 const newOpportunity=context.refraction?.pending?.length>0||commitments.some(c=>c.available_responses?.length&&c.status==='proposed');
 if((due||newOpportunity)&&age>=10)return {phase:'plan',reason:due?'followup_due':'new_opportunity',priority:40+Math.min(40,age/60)};
 return null;
}
export function fairCognitiveQueue(candidates){
 return candidates.sort((a,b)=>b.priority-a.priority||String(a.last_dispatch_at??'').localeCompare(String(b.last_dispatch_at??''))||a.actor_id.localeCompare(b.actor_id));
}
