import type {DeskBotLivedMemory} from './deskbot/types.ts';

export interface DevelopmentFacetsReviewSample {
  id:string;label:string;now:string;memory:DeskBotLivedMemory;summary:string;restart_verified?:boolean;
}
export interface DevelopmentFacetsReviewFixture {
  schema:'deskbot.development-facets-review.v1';simulated:true;live_world_untouched:true;samples:DevelopmentFacetsReviewSample[];
}
export function readDevelopmentFacetsReview(value:unknown):DevelopmentFacetsReviewFixture|null {
  if(!value||typeof value!=='object')return null;
  const fixture=value as DevelopmentFacetsReviewFixture;
  if(fixture.schema!=='deskbot.development-facets-review.v1'||fixture.simulated!==true||fixture.live_world_untouched!==true||!Array.isArray(fixture.samples)||!fixture.samples.length)return null;
  const ids=new Set<string>();
  for(const sample of fixture.samples) {
    if(!sample||typeof sample.id!=='string'||!sample.id||ids.has(sample.id)||typeof sample.label!=='string'||typeof sample.now!=='string'||!Number.isFinite(Date.parse(sample.now))||typeof sample.summary!=='string')return null;
    ids.add(sample.id);
    const memory=sample.memory,development=memory?.development,facets=development?.facets;
    if(!memory||typeof memory.owner_id!=='string'||!Array.isArray(memory.actors)||!Array.isArray(memory.own)||!Array.isArray(memory.recent)||!Array.isArray(memory.planner?.requests))return null;
    if(development?.schema!=='deskbot.development-evidence.v1'||!Array.isArray(development.actors)||!Array.isArray(development.recent)||!Array.isArray(development.coverage?.limitations))return null;
    if(facets?.schema!=='deskbot.development-facets.v1'||!facets.enabled||!Array.isArray(facets.actors)||!facets.actors.some(actor=>actor.actor_id===memory.owner_id&&Array.isArray(actor.topics)))return null;
  }
  return fixture;
}
export function facetsReviewCounts(sample:DevelopmentFacetsReviewSample) {
  const topics=sample.memory.development?.facets?.actors.find(actor=>actor.actor_id===sample.memory.owner_id)?.topics??[];
  const unique=(values:string[])=>new Set(values).size;
  return {
    actual:unique(topics.flatMap(topic=>[...topic.capability.root_outcome_ids,...topic.interest.active_roots,...topic.interest.invited_roots,...topic.interest.obligation_roots,...topic.interest.unknown_roots])),
    contact:unique(topics.flatMap(topic=>topic.contact.source_record_ids)),
    successful:unique(topics.flatMap(topic=>topic.capability.success_roots)),
    conditions:unique(topics.flatMap(topic=>topic.capability.condition_failure_roots)),
    performance:unique(topics.flatMap(topic=>topic.capability.performance_failure_roots)),
    ongoing:topics.some(topic=>topic.wish.stable_interest),
  };
}
