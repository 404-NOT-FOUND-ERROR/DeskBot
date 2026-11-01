// Offline fixture authoring only. This is never a provider fallback or repair.
import {FOLLOWUP_INTENT,compileFollowupIntent} from '../../../apps/deskbot-service/src/cognitive-followup-intent.mjs';
export function authoredFollowup(context,fields={}){
 const actor_payload={status:'continue',basis_ids:context.followup_intent.bases.map(b=>b.id),next_step:null,delay_hours:1,...fields};
 return {followup:compileFollowupIntent(actor_payload,context),followup_binding:{contract:FOLLOWUP_INTENT.schema,actor_payload}};
}
