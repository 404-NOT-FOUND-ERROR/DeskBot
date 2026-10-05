import type {DeskBotLivedMemory,DeskBotRoleEvolution,DeskBotRoleProposal} from './deskbot/types.ts';
import {readDevelopmentFacetsReview} from './developmentFacetsReview.ts';
import {roleWishView} from './deskbot/RoleWishes.tsx';

export interface RoleWishesReviewSample {
  id:string;label:string;now:string;summary:string;memory:DeskBotLivedMemory;
  evolution:DeskBotRoleEvolution;proposals:DeskBotRoleProposal[];restart_verified?:boolean;
}
export interface RoleWishesReviewFixture {
  schema:'deskbot.role-wishes-review.v1';simulated:true;live_world_untouched:true;samples:RoleWishesReviewSample[];
}
export function readRoleWishesReview(value:unknown):RoleWishesReviewFixture|null {
  if(!value||typeof value!=='object')return null;
  const fixture=value as RoleWishesReviewFixture;
  if(fixture.schema!=='deskbot.role-wishes-review.v1'||fixture.simulated!==true||fixture.live_world_untouched!==true||!Array.isArray(fixture.samples)||!fixture.samples.length)return null;
  const ids=new Set<string>();
  for(const sample of fixture.samples) {
    if(!sample||typeof sample.id!=='string'||!sample.id||ids.has(sample.id)||typeof sample.label!=='string'||typeof sample.summary!=='string'||!Number.isFinite(Date.parse(sample.now)))return null;
    ids.add(sample.id);
    if(!readDevelopmentFacetsReview({schema:'deskbot.development-facets-review.v1',simulated:true,live_world_untouched:true,samples:[sample]}))return null;
    const view=roleWishView({evolution:sample.evolution,proposals:sample.proposals});
    if(!view||view.character_id!==sample.memory.owner_id||!Array.isArray(sample.proposals))return null;
    for(const direction of view.directions) {
      if(!direction||typeof direction.direction_id!=='string'||typeof direction.label!=='string'||!['form','vocation'].includes(direction.axis)||typeof direction.authored_reason!=='string')return null;
      if(typeof direction.readiness?.eligible!=='boolean'||!Array.isArray(direction.readiness.barriers)||!Array.isArray(direction.readiness.checks)||!Array.isArray(direction.basis?.root_outcome_ids))return null;
      if(direction.readiness.barriers.some(barrier=>!barrier||typeof barrier.id!=='string'||typeof barrier.label!=='string'||!['evidence','circumstance'].includes(barrier.scope)))return null;
      if(direction.basis.root_outcome_ids.some(root=>typeof root!=='string'))return null;
    }
    for(const proposal of sample.proposals) {
      if(!proposal||typeof proposal.proposal_id!=='string'||typeof proposal.direction_id!=='string'||typeof proposal.status!=='string')return null;
      if(proposal.origin==='lived_wish'&&(!['form','vocation'].includes(proposal.axis??'')||!['proposed','prepared','deferred','rejected','withdrawn'].includes(proposal.status)))return null;
    }
  }
  return fixture;
}
