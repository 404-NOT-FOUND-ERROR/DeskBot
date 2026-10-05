import { activeWorldTask, startTravelTask, startActivityTask, localWorldDate } from './realtime-world.mjs';
import { findWorldPath } from './world-map-content.mjs';
import { transferLivingResource, RESOURCES } from './living-resources.mjs';
import { activitySteps } from './life-planning.mjs';
import { RESIDENTS, residentDesign } from './resident-life.mjs';

const M=60000, LIVE=['proposed','accepted','meeting','working'];
export class SocialLifeError extends Error { constructor(code,text){super(text);this.code=code;this.statusCode=409;} }
const fail=(code,text)=>{throw new SocialLifeError(code,text);};
const person=(w,id)=>id===w.protagonist.character_id?w.protagonist:w.npcs.find(n=>n.npc_id===id);
const bag=(w,id)=>w.living.inventories[id]??={stock:{},capacity:24};
const quantity=(w,id,r)=>w.living.inventories[id]?.stock?.[r]??0;
const sum=stock=>Object.values(stock).reduce((a,b)=>a+b,0);
const pair=(ids)=>[...ids].sort().join('|');
function record(w,c,at,kind,text,details={}) {
  w.social.recent.push({at,kind,text,commitment_id:c?.id??null,actor_ids:c?.actors??[],...details});
  w.social.recent=w.social.recent.slice(-100); if(c){c.last_note=text;c.updated_at=at;}
}
function relation(w,c,at,kind,text) {
  const key=pair(c.actors),r=w.social.relationships[key]??={actors:[...c.actors],encounters:0,trust:0,kept:0,missed:0,last_event:null};
  if(kind==='met')r.encounters++;
  if(kind==='completed'){r.trust=Math.min(30,r.trust+1);r.kept++;}
  if(kind==='failed'){r.trust=Math.max(-10,r.trust-1);r.missed++;}
  r.last_event={at,kind,text,commitment_id:c.id};
}
export function reservedSocialActors(w) { return [...new Set((w.social?.commitments??[]).filter(c=>LIVE.includes(c.status)).flatMap(c=>c.status==='proposed'?c.actors.filter(id=>id!==w.protagonist.character_id || (c.responses[id]==='join'&&!['planned','executing'].includes(w.autonomy?.actors[id]?.plan?.status))):c.actors))]; }
function interruptible(w,id,commitmentId=null) {
  const state=w.autonomy?.actors[id],task=activeWorldTask(w,id);
  const reserved=w.social.commitments.some(c=>c.id!==commitmentId&&LIVE.includes(c.status)&&c.actors.includes(id));
  const explicitJoin=id===w.protagonist.character_id&&w.social.commitments.some(c=>c.id===commitmentId&&c.responses[id]==='join');
  return !task && (!state?.paused||explicitJoin) && !['planned','executing'].includes(state?.plan?.status) && !reserved;
}
function refusal(w,id,definition=null) {
  const s=w.autonomy?.actors[id];
  if(!person(w,id))return '还没有住进镇里';
  if(s?.paused)return '想先留一点自己的时间';
  if(s?.energy<.3)return '现在很累，想先休息';
  // Food help is precisely for a hungry resident; appetite alone cannot refuse
  // an actual portion offered by a neighbour. Other engagements retain needs.
  if(s?.appetite>.85 && !['food-help','meal'].includes(definition?.kind))return '得先吃点东西';
  return null;
}
function close(w,c,at,status,text) {
  c.status=status;c.finished_at=at;record(w,c,at,status,text);
  if(status==='completed'||status==='failed')relation(w,c,at,status,text);
  w.social.cooldowns[c.key]=new Date(Date.parse(at)+(status==='failed'?360:status==='completed'?240:90)*M).toISOString();
}
function propose(w,at,definition) {
  if(definition.actors.some(id=>!person(w,id)))return null;
  const key=definition.key??`${definition.kind}:${pair(definition.actors)}`;
  if(Date.parse(w.social.cooldowns[key]??'')>Date.parse(at)||w.social.commitments.some(c=>LIVE.includes(c.status)&&(c.key===key||c.actors.some(id=>definition.actors.includes(id)))))return null;
  const c={id:`social:${++w.social.sequence}`,key,...definition,status:'proposed',created_at:at,updated_at:at,
    respond_after:new Date(Date.parse(at)+5*M).toISOString(),deadline_at:new Date(Date.parse(at)+90*M).toISOString(),
    responses:Object.fromEntries(definition.actors.map((id,index)=>[id,index===0?'join':'pending'])),
    arrivals:{},tasks:{},phase:'meeting',step_index:0,worker_steps:null,changes:[],delay_count:0,last_note:'邀请已经发出，尚未见面。'};
  w.social.commitments.push(c);
  // Retain every live record; bounded settled history is enough for this stage.
  w.social.commitments=[...w.social.commitments.filter(c=>!LIVE.includes(c.status)).slice(-60),...w.social.commitments.filter(c=>LIVE.includes(c.status))];
  record(w,c,at,'invited',`${person(w,c.actors[0]).display_name}发出邀请：${c.title}。${c.reason}`);
  return c;
}
export function respondSocialInvitation(w,at,id,operation) {
  const c=w.social?.commitments.find(c=>c.id===id),own=w.protagonist.character_id;
  if(!c||!c.actors.includes(own))fail('invitation_not_for_character','这不是喵呜的约定。');
  if(!['join','decline','withdraw'].includes(operation))fail('invalid_social_response','约定操作无效。');
  if(operation==='withdraw') {
    if(!['accepted','meeting','working'].includes(c.status))fail('invitation_already_settled','这项约定已不在进行中。');
    close(w,c,at,'withdrawn','喵呜通知对方退出这次约定；已开始的活动仍按实际结果保存。');
  } else {
    if(c.status!=='proposed'||c.responses[own]!=='pending')fail('invitation_already_answered','这项邀请已经回应过了。');
    if(Date.parse(at)>Date.parse(c.deadline_at))fail('invitation_expired','这项邀请已经过时。');
    c.responses[own]=operation;
    if(operation==='decline')close(w,c,at,'declined','喵呜说这次不参加，双方继续自己的安排。');
    else record(w,c,at,'responded','喵呜愿意参加；双方还有自己的事务，见面之后才开始。');
  }
  w.social.revision++;return {id:c.id,status:c.status};
}
// Exchanges are atomic, local and conserve every unit. Promises reserve no stock.
export function exchangeResidentResources(w,c,at,offers) {
  const projected=new Map(c.actors.map(id=>[id,structuredClone(bag(w,id).stock)]));
  for(const offer of offers) {
    if(!c.actors.includes(offer.from)||!c.actors.includes(offer.to)||offer.from===offer.to||!RESOURCES[offer.resource]||!Number.isSafeInteger(offer.count)||offer.count<1)fail('invalid_resident_exchange','交换条件无效。');
    if(person(w,offer.from).location_id!==c.location_id||person(w,offer.to).location_id!==c.location_id||c.actors.some(id=>activeWorldTask(w,id)))fail('exchange_requires_presence','要双方到场、停下手里的活动后才能交接。');
    const from=projected.get(offer.from),to=projected.get(offer.to);
    if((from[offer.resource]??0)<offer.count)fail('exchange_stock_short','说好的物品现在不够了。');
    from[offer.resource]-=offer.count;to[offer.resource]=(to[offer.resource]??0)+offer.count;
  }
  for(const [id,stock]of projected)if(sum(stock)>bag(w,id).capacity)fail('exchange_bag_full','对方的随身袋装不下了。');
  for(const [id,stock]of projected)bag(w,id).stock=stock;
  const text=offers.map(o=>`${person(w,o.from).display_name}交给${person(w,o.to).display_name}${o.count}份${RESOURCES[o.resource]}`).join('；');
  c.changes.push({at,text,offers:structuredClone(offers)});record(w,c,at,'handoff',text);return text;
}
function startTask(w,c,id,at,eventId,payload) {
  let task;
  if(payload.kind==='travel') {
    if(person(w,id).location_id===payload.location_id)return null;
    const route=findWorldPath(w,person(w,id).location_id,payload.location_id);
    if(!route?.[1])fail('social_path_closed','去约定地点的路暂时不通。');
    task=startTravelTask(w,{eventId,at,actorId:id,locationId:route[1],destinationId:payload.location_id,reason:c.reason}).task;
  } else task=startActivityTask(w,{actor_id:id,task_id:`social-task:${eventId}`,...payload},{eventId,at}).task;
  const actual=w.tasks.find(t=>t.task_id===task.task_id);actual.origin='social_life';actual.social_commitment_id=c.id;actual.life_action=payload.activity_id?'activity':payload.kind==='travel'?'travel':'social';
  c.tasks[id]=actual.task_id;if(id!==w.protagonist.character_id)person(w,id).status=actual.title;
  record(w,c,at,'started',`${person(w,id).display_name}开始${actual.title}。`,{task_id:actual.task_id});return actual;
}
function drainTask(w,c,id,at) {
  const taskId=c.tasks[id];if(!taskId)return true;
  const t=w.tasks.find(t=>t.task_id===taskId);
  if(!t)fail('social_task_missing','约定的任务记录无法恢复。');
  if(['running','paused'].includes(t.status))return false;
  if(t.status!=='completed')fail('social_task_failed',t.failure_reason??'约定中的活动取消了。');
  c.changes.push({at:t.finished_at,task_id:t.task_id,text:t.completion?.result?.text??`${t.title}完成了。`});
  delete c.tasks[id];return true;
}
function progress(w,c,at,eventId,reserved) {
  if(c.status==='proposed') {
    for(const id of c.actors.filter(id=>c.responses[id]==='pending')) {
      if(id===w.protagonist.character_id&&Date.parse(at)<Date.parse(c.respond_after))continue;
      const reason=refusal(w,id,c);
      if(reason){c.responses[id]='decline';close(w,c,at,'declined',`${person(w,id).display_name}${reason}，这次不参加。`);return;}
      if(interruptible(w,id,c.id)&&!reserved.includes(id)){c.responses[id]='join';record(w,c,at,'responded',`${person(w,id).display_name}愿意参加。`);}
    }
    if(c.actors.every(id=>c.responses[id]==='join')&&c.actors.every(id=>interruptible(w,id,c.id)&&!reserved.includes(id))){c.status='accepted';record(w,c,at,'accepted','双方确认安排；接下来沿实际通路去见面。');}
  }
  if(!LIVE.includes(c.status))return;
  if(Date.parse(at)>Date.parse(c.deadline_at)) {
    if(!c.delay_count){c.delay_count=1;c.deadline_at=new Date(Date.parse(at)+90*M).toISOString();record(w,c,at,'delayed','约定时间到了，但事情还没办完，已通知对方延后一次。');}
    else {close(w,c,at,'failed','延后之后仍没能完成约定，保留未办成的结果，改天再安排。');return;}
  }
  if(c.status==='proposed')return;
  if(c.phase==='meeting') {
    c.status='meeting';
    for(const id of c.actors) {
      if(!drainTask(w,c,id,at)||activeWorldTask(w,id)||reserved.includes(id))continue;
      if(person(w,id).location_id!==c.location_id)startTask(w,c,id,at,`${eventId}:${c.id}:arrive:${id}`,{kind:'travel',location_id:c.location_id});
      else c.arrivals[id]=at;
    }
    if(c.actors.every(id=>person(w,id).location_id===c.location_id&&!activeWorldTask(w,id)&&!reserved.includes(id))) {
      c.phase='work';c.status='working';c.met_at=at;relation(w,c,at,'met','双方实际到场。');record(w,c,at,'met',`${c.actors.map(id=>person(w,id).display_name).join('与')}在${w.locations.find(l=>l.location_id===c.location_id).name}见面了。`);
    }
    return;
  }
  if(c.kind==='exchange') {exchangeResidentResources(w,c,at,c.offers);close(w,c,at,'completed','交换完成，实际物品与关系记录已保存。');return;}
  if(c.kind==='food-help') {
    const [donor,recipient]=c.actors;
    if(c.actors.some(id=>person(w,id).location_id!==c.location_id))fail('meeting_left','有人离开了送饭地点。');
    if(c.served_at) {
      if(!drainTask(w,c,recipient,at))return;
      close(w,c,at,'completed','邻居送来的一份饭实际吃完了；材料、需要和这次帮助留下同一次记录。');
      return;
    }
    if(c.actors.some(id=>activeWorldTask(w,id)||reserved.includes(id)) || w.tasks.some(t=>['running','paused'].includes(t.status)&&t.target_object_id==='shared-table'))return;
    // The transaction performs handoff, local storage and admission together.
    // A spoken promise cannot satisfy appetite or reserve someone else's food.
    exchangeResidentResources(w,c,at,[{from:donor,to:recipient,resource:'rations',count:1}]);
    transferLivingResource(w,{actor_id:recipient,object_id:'shared-table',resource:'rations',count:1,operation:'store'},at);
    startTask(w,c,recipient,at,`${eventId}:${c.id}:eat`,{activity_id:'share-meal'});
    c.served_at=at;
    return;
  }
  if(c.kind==='cooperate') {
    const [worker,recipient]=c.actors;
    if(!c.worker_steps)c.worker_steps=activitySteps(w,worker,c.produce_activity);
    const step=c.worker_steps[c.step_index];
    if(step) {
      if(!drainTask(w,c,worker,at)||activeWorldTask(w,worker)||reserved.includes(worker))return;
      if(c.worker_task_pending){c.worker_task_pending=false;c.step_index++;return;}
      if(step.kind==='transfer'){transferLivingResource(w,{...step,actor_id:worker},at);c.step_index++;return;}
      if(step.kind==='travel'&&person(w,worker).location_id===step.location_id){c.step_index++;return;}
      startTask(w,c,worker,at,`${eventId}:${c.id}:${c.step_index}`,step.kind==='activity'?{activity_id:step.activity_id}:step);c.worker_task_pending=true;return;
    }
    if(person(w,worker).location_id!==c.location_id) {
      if(drainTask(w,c,worker,at)&&!activeWorldTask(w,worker))startTask(w,c,worker,at,`${eventId}:${c.id}:return`,{kind:'travel',location_id:c.location_id});return;
    }
    if(!drainTask(w,c,worker,at)||activeWorldTask(w,recipient)||reserved.includes(recipient))return;
    if(!c.handed_at){exchangeResidentResources(w,c,at,[{from:worker,to:recipient,resource:c.resource,count:1}]);c.handed_at=at;return;}
    if(c.use_activity) {
      if(!c.use_started){startTask(w,c,recipient,at,`${eventId}:${c.id}:use`,{activity_id:c.use_activity});c.use_started=at;return;}
      if(!drainTask(w,c,recipient,at))return;
    } else if(!c.stored_at){transferLivingResource(w,{actor_id:recipient,object_id:'seedling-rack',resource:c.resource,count:1,operation:'store'},at);c.stored_at=at;}
    close(w,c,at,'completed',c.use_activity?'材料交到对方手里，修缮也完成了。':'托盘已交接并存入育苗架，下次照料可以用到。');return;
  }
  // Even someone who finished their own portion must remain for the joint meeting.
  if(c.actors.some(id=>person(w,id).location_id!==c.location_id))fail('meeting_left','有人离开了约定地点，这次共同相处没有完成。');
  // Meetings and dinners take time. A dinner uses the same finite recipe as solo meals.
  for(const id of c.actors) {
    if(c.done?.[id])continue;
    if(c.started?.[id]){if(drainTask(w,c,id,at)){(c.done??={})[id]=at;}continue;}
    if(activeWorldTask(w,id)||reserved.includes(id))continue;
    if(person(w,id).location_id!==c.location_id)fail('meeting_left','有人离开了约定地点，谈话没有完成。');
    if(c.kind==='meal'&&w.tasks.some(t=>t.status==='running'&&t.target_object_id==='shared-table'))continue;
    startTask(w,c,id,at,`${eventId}:${c.id}:meet:${id}`,c.kind==='meal'?{activity_id:'share-meal'}:{kind:'care',title:c.kind==='interview'?'核对一条生活见闻':'一起聊一会儿',duration_seconds:900});(c.started??={})[id]=at;
  }
  if(c.actors.every(id=>c.done?.[id])) {
    const text=c.kind==='meal'?'双方吃完了各自的一份饭，食材消耗和这次相处都留下记录。':c.kind==='interview'?'这次见面与核对完成了；没有凭对白创造新世界事实。':'一起待了一会儿，这次实际相处留下了记录。';
    close(w,c,at,'completed',text);
    if(c.kind==='interview')publishFact(w,c,at);
  }
}
function publishFact(w,c,at) {
  const evidence=[...w.social.commitments].reverse().find(old=>old.status==='completed'&&old.id!==c.id&&old.changes.length);
  if(!evidence)return;
  const origin=`social-result:${evidence.id}`;
  if(w.social.notices.some(n=>n.origin_id===origin))return;
  w.social.notices.push({id:`notice:${c.id}`,at,author_id:c.actors.find(id=>id==='town-reporter-001'),kind:'world_fact',origin_id:origin,
    source_commitment_id:evidence.id,source_task_ids:evidence.changes.filter(x=>x.task_id).map(x=>x.task_id),text:`${evidence.title}：${evidence.last_note}`,verified_by:'canonical_world_record'});
  w.social.notices=w.social.notices.slice(-30);record(w,c,at,'reported','簌簌记下一条有原始事务记录的消息。');
}
function offers(w,at) {
  const own=w.protagonist.character_id,grower='wetland-grower-001',mender='spare-mender-001',cook='pot-cook-001';
  const definitions=[];
  const hungry=Object.values(w.autonomy?.actors??{}).filter(s=>s.appetite>.85)
    .sort((a,b)=>b.appetite-a.appetite||a.actor_id.localeCompare(b.actor_id));
  const donors=Object.values(w.autonomy?.actors??{}).filter(s=>s.appetite<.6&&quantity(w,s.actor_id,'rations')>=1);
  for(const recipient of hungry)for(const donor of donors)if(recipient.actor_id!==donor.actor_id)
    definitions.push({kind:'food-help',key:`food-help:${pair([donor.actor_id,recipient.actor_id])}`,actors:[donor.actor_id,recipient.actor_id],
      location_id:'warm-pot-courtyard',title:`给${person(w,recipient.actor_id).display_name}送一份饭`,
      reason:'手里确实有一份余餐，想在长桌交给还没吃饭的邻居；吃完之后才算帮上忙。'});
  if(w.living.objects['floating-frame'].condition<.72)definitions.push({kind:'cooperate',key:'cooperate:frame',actors:[mender,grower],location_id:'echo-waterside',title:'一起补好水岸浮框',reason:'苔团照看浮圃，扣扣备好修补包再带过来。',produce_activity:'craft-frame-kit',resource:'frame_kit',use_activity:'repair-frame'});
  if(w.living.objects['seedling-rack'].stock.trays<2)definitions.push({kind:'cooperate',key:'cooperate:tray',actors:[mender,grower],location_id:'moss-sprout-garden',title:'给苗圃添一只托盘',reason:'扣扣负责制作，苔团在苗圃接过来并存放。',produce_activity:'craft-tray',resource:'trays'});
  if(w.living.objects['shared-table'].stock.rations>=2)definitions.push({kind:'meal',actors:[cook,own],location_id:'warm-pot-courtyard',title:'约喵呜一起吃饭',reason:'锅粒看见长桌还有饭，想留一顿不赶时间的晚饭。'});
  // Reciprocal offers must already exist in bags. No money or infinite shop source.
  const carriers=[w.protagonist,...w.npcs].map(p=>p.character_id??p.npc_id);
  for(const a of carriers)for(const b of carriers)if(a!==b&&quantity(w,a,'moss')>=2&&quantity(w,b,'rations')>=1)
    definitions.push({kind:'exchange',actors:[a,b],location_id:'whisper-market',title:'用苔芽换一份饭',reason:'双方手里都有对方能用到的东西，先见面确认再交换。',offers:[{from:a,to:b,resource:'moss',count:2},{from:b,to:a,resource:'rations',count:1}]});
  const visits=[];
  for(const r of RESIDENTS) {
    const link=r.relationships[Math.floor(Date.parse(at)/(4*60*M))%r.relationships.length];
    visits.push({kind:r.role==='town_reporter'?'interview':'visit',actors:[r.npc_id,link.npc_id],location_id:person(w,r.npc_id)?.location_id,
      title:`${r.display_name}想和${person(w,link.npc_id)?.display_name}碰个面`,reason:link.connection+'。先留一会儿聊聊各自的安排。'});
  }
  // Kept commitments matter, while time apart gradually makes other partners eligible.
  const score=d=>{const r=w.social.relationships[pair(d.actors)];return (r?.trust??0)+Math.min(12,r?.last_event?(Date.parse(at)-Date.parse(r.last_event.at))/(4*60*M):12);};
  return [...definitions,...visits.sort((a,b)=>score(b)-score(a))];
}
export function advanceSocialLife(w,at,{eventId,reservedActors=[]}={}) {
  if(!w.social)return;
  for(const existing of [...w.social.commitments].filter(c=>LIVE.includes(c.status))) {
    const trial=structuredClone(w),c=trial.social.commitments.find(c=>c.id===existing.id);
    try{progress(trial,c,at,eventId,reservedActors);Object.assign(w,trial);}
    catch(error){if(!error.code)throw error;const actual=w.social.commitments.find(c=>c.id===existing.id);close(w,actual,at,'failed',`这次约定没能办成：${error.message}`);}
  }
  const minute=localWorldDate(at,w.clock.time_zone).minute_of_day;
  if(minute>=420&&minute<1320&&Date.parse(at)>=Date.parse(w.social.next_offer_at)&&w.social.commitments.filter(c=>LIVE.includes(c.status)).length<5) {
    let count=0;
    for(const d of offers(w,at)) {
      if(!d.location_id||d.actors.some(id=>refusal(w,id,d)||!interruptible(w,id)||reservedActors.includes(id))||d.actors.some(id=>!findWorldPath(w,person(w,id).location_id,d.location_id)))continue;
      if(d.kind==='cooperate'){try{activitySteps(w,d.actors[0],d.produce_activity);}catch{continue;}}
      if(propose(w,at,d))count++;
      if(count>=2)break;
    }
    w.social.next_offer_at=new Date(Date.parse(at)+10*M).toISOString();
  }
  w.social.revision++;
}
export function socialReadModel(w) {
  if(!w.social)return null;
  return {...structuredClone(w.social),policy:'bounded_social_rules_v1',residents: w.npcs.filter(n=>n.resident_version).map(n=>({npc_id:n.npc_id,display_name:n.display_name,role_label:n.role_label,color:n.color,home_location_id:n.home_location_id,
    desires:n.desires,flaws:n.flaws,project:n.project,authored_connections:n.authored_connections})),
    commitments:structuredClone(w.social.commitments.map(c=>({...c,people:c.actors.map(id=>({id,name:person(w,id)?.display_name??id})),location_name:w.locations.find(l=>l.location_id===c.location_id)?.name??c.location_id}))),recent:structuredClone(w.social.recent.slice(-30))};
}
