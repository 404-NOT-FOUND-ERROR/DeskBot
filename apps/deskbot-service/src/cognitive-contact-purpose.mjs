import {createHash} from 'node:crypto';

export const purposeSignature=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,20);
const answered=(w,life,sent,peer)=>{
 if(sent.response_receipts?.some(r=>r.actor_id===peer))return true;
 const task=sent.message_id?.startsWith('sent:')?sent.message_id.slice(5):null;
 return (life.inbox??[]).some(m=>m.sender_id===peer&&m.reply_to
  &&(m.reply_to===sent.message_id||task&&m.reply_to===`message:${task}:${peer}`))
  ||Boolean(sent.commitment_id&&(w.social?.commitments??[]).some(c=>c.id===sent.commitment_id
    &&c.responses?.[peer]&&c.responses[peer]!=='pending'));
};

/** Retain factual response receipts before display inboxes/agreements rotate. */
export function captureContactResponses(w){
 for(const life of Object.values(w.cognition?.actors??{}))for(const sent of life.contact_purposes??[]){
  for(const peer of sent.receiver_ids??[]){
   if(sent.response_receipts?.some(r=>r.actor_id===peer))continue;
   const task=sent.message_id?.startsWith('sent:')?sent.message_id.slice(5):null;
   const reply=(life.inbox??[]).find(m=>m.sender_id===peer&&m.reply_to
    &&(m.reply_to===sent.message_id||task&&m.reply_to===`message:${task}:${peer}`));
   const agreement=(w.social?.commitments??[]).find(c=>c.id===sent.commitment_id&&c.responses?.[peer]&&c.responses[peer]!=='pending');
   if(reply||agreement)(sent.response_receipts??=[]).push({actor_id:peer,reply_id:reply?.message_id??null,commitment_id:agreement?.id??null});
  }
 }
}

export function ownContactReceipts(life){
 const byId=new Map((life.outbox??[]).map(m=>[m.message_id,m]));
 for(const m of life.contact_purposes??[])byId.set(m.message_id,{...byId.get(m.message_id),...m});
 return [...byId.values()].sort((a,b)=>(a.at??'').localeCompare(b.at??''));
}

/** A new broad research result cannot renew an unchanged, unanswered resource offer.
 * Expiration, a new issue name and other people's private stock are not evidence.
 * The key and terms are authored by the executor, never classified from model prose.
 */
export function pendingContactPurpose(w,id,peer,purpose){
 const life=w.cognition?.actors[id]??{};
 return [...(life.contact_purposes??life.outbox??[])].reverse().find(sent=>
  sent.receiver_ids?.includes(peer)&&sent.contact_purpose?.key===purpose.key
  &&sent.contact_purpose?.signature===purpose.signature&&!answered(w,life,sent,peer))??null;
}

export function rememberContactPurpose(life,sent){
 if(!sent.contact_purpose)return;
 // Compact one latest receipt per peer/purpose/terms. Unlike outbox display,
 // these guards are not evicted merely because unrelated messages arrived.
 const key=m=>JSON.stringify([m.receiver_ids,m.contact_purpose?.key,m.contact_purpose?.signature]);
 const history=life.contact_purposes??(life.outbox??[]).filter(m=>m.contact_purpose);
 life.contact_purposes=[...history.filter(m=>key(m)!==key(sent)),structuredClone(sent)];
}
