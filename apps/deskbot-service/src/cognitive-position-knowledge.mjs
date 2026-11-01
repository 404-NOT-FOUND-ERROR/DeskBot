import {readFileSync} from 'node:fs';
export const POSITION_KNOWLEDGE=JSON.parse(readFileSync(new URL('../../../contracts/cognitive-position-knowledge.v1.json',import.meta.url),'utf8'));
const copy=structuredClone;

export function positionKnowledge(w,id,c){
 const saved=w.cognition?.actors[id]?.position_knowledge??[];
 const rows=new Map(saved.map(p=>[p.actor_id,copy(p)]));
 for(const p of c.visible_people)rows.set(p.actor_id,{actor_id:p.actor_id,location_id:c.location.id,
  observed_at:c.position_observed_at??c.at,basis:'seen_here',source_id:`sighting:${id}:${p.actor_id}:${c.position_observed_at??c.at}`,observer_id:id});
 return {schema:POSITION_KNOWLEDGE.schema,rule:POSITION_KNOWLEDGE.rule,people:[...rows.values()].map(p=>{
  const age=(Date.parse(c.at)-Date.parse(p.observed_at))/60000;
  const expired=!Number.isFinite(age)||age<0||age>POSITION_KNOWLEDGE.retention_hours*60;
  return {...p,location_id:expired?null:p.location_id,age_minutes:Number.isFinite(age)?Math.max(0,Math.round(age)):null,
   current_verified:p.basis==='seen_here',freshness:expired?'expired':age>POSITION_KNOWLEDGE.fresh_minutes?'stale':'fresh',
   status:expired?'unknown':p.basis==='seen_here'?'observed_now':'historical_clue'};
 })};
}

// Only adopted observations and actual addressed messages become personal knowledge.
// Pure context reads, a speaker's unsent intention or an arbitrary place name do not.
export function adoptPositionKnowledge(life,refs,perceptions=[]){
 const rows=new Map((life.position_knowledge??[]).map(p=>[p.actor_id,copy(p)]));
 const add=p=>{const old=rows.get(p.actor_id);if(!old||p.observed_at>old.observed_at||p.observed_at===old.observed_at&&p.basis==='seen_before')rows.set(p.actor_id,p);};
 for(const p of refs.event_evidence?.people??[])
  if(p.basis==='seen_here')add({...copy(p),basis:'seen_before',current_verified:false,status:'historical_clue'});
 for(const source of perceptions)for(const p of source.position_reports??[]){
  if(source.sender_is_agent&&source.epistemic==='heard'&&p.kind==='position_report'&&p.actor_id===source.sender_id
   &&p.observed_at<=source.occurred_at&&Number.isFinite(Date.parse(p.observed_at)))
   add({actor_id:p.actor_id,location_id:p.location_id,observed_at:p.observed_at,basis:'reported',
    source_id:source.id,reporter_id:source.sender_id,received_at:source.occurred_at});
 }
 life.position_knowledge=[...rows.values()].sort((a,b)=>b.observed_at.localeCompare(a.observed_at)).slice(0,POSITION_KNOWLEDGE.max_people);
}

export function selfPositionDisclosure(c){
 const at=c.position_observed_at??c.at;
 return {kind:'position_report',id:`position:${c.actor.actor_id}:${c.location.id}:${at}`,
  actor_id:c.actor.actor_id,location_id:c.location.id,observed_at:at,
  text:`我在${at}位于${c.location.name}。这是当时的位置，不保证我之后仍在这里。`};
}
