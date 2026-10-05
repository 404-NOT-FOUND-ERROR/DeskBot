import { ACTIVITIES, transferLivingResource } from './living-resources.mjs';
import { findWorldPath } from './world-map-content.mjs';
import { activeWorldTask, startTravelTask, startActivityTask, localWorldDate } from './realtime-world.mjs';
import { AUTONOMY_VERSION, installAutonomy, syncLifeNeeds, lifeNote } from './life-state.mjs';

import { activitySteps, waterSupplySteps, seedSupplySteps, depositSteps, cookAndStoreSteps, fruitSupplySteps } from './life-planning.mjs';
import { RESIDENT_PROFILES } from './resident-life.mjs';
import { advanceSocialLife, reservedSocialActors } from './social-life.mjs';
import { influenceLifeChoices, recordInputDecision, settleRefraction } from './input-refraction.mjs';
import { influenceRememberedChoices } from './lived-memory.mjs';
import { prepareLifeChoice, fingerprintChoices, claimLifeChoice, resolveLifeChoice, choiceNote } from './life-choice.mjs';
import { projectCandidates, settleResidentProjects, updateProjectScheduling } from './resident-projects.mjs';
import { influenceBodyChoices, recordBodyLifeDecision } from './body-perception.mjs';
import { activityTopic, developmentFacetsReadModel } from './development-facets.mjs';
import { practicalTrialCandidates, practicalTrialPlanMayContinue, recordPracticalTrialTask } from './role-practical-trials.mjs';
const MINUTE = 60000;
const PROFILE = {
  'shaping-001': { interests: ['care', 'craft', 'explore'], places: ['moss-sprout-garden', 'spare-parts-house', 'backlit-grove'], rest: 'shaping-field-desk', quiet: '把今天的小事理一理' },
  'pathfinder-001': { interests: ['explore', 'repair'], places: ['tidal-old-road', 'echo-waterside', 'fog-lamp-square'], rest: 'lamp-street-homes', quiet: '在路边观察通行和路标' },
  'shade-collector-001': { interests: ['care', 'explore'], places: ['backlit-grove', 'moss-sprout-garden'], rest: 'lamp-street-homes', quiet: '留一会儿看林间光色' },
  'echo-postcarrier-001': { interests: ['explore', 'cook'], places: ['echo-waterside', 'warm-pot-courtyard', 'lamp-street-homes'], rest: 'lamp-street-homes', quiet: '整理行程，听一会儿水边的声音' },
};
function actor(world, id) { return id === world.protagonist.character_id ? world.protagonist : world.npcs.find(n => n.npc_id === id); }
function object(world, id) { const entry = world.map_catalog.objects.find(o => o.object_id === id); return entry && { ...entry, location_id: world.map_catalog.areas.find(a => a.area_id === entry.area_id)?.location_id }; }
const stock = (world, id, resource) => world.living.objects[id]?.stock?.[resource] ?? 0;
const carried = (world, id, resource) => world.living.inventories[id]?.stock?.[resource] ?? 0;
function hash(text) { let value=2166136261; for(const c of text) value=Math.imul(value^c.codePointAt(0),16777619); return value>>>0; }
export class AutonomousLifeError extends Error { constructor(message){super(message);this.code='life_plan_unavailable';this.statusCode=409;} }
function planError(message) { return new AutonomousLifeError(message); }

const SUPPLY_TARGETS=new Set(['trial-stove','light-fruit-bough','garden-bed']);
function supplyClaims(world,at,exceptId) {
  return Object.values(world.autonomy?.actors??{}).filter(s=>s.actor_id!==exceptId&&!s.paused&&['planned','executing'].includes(s.plan?.status))
    .filter(s=>{const task=activeWorldTask(world,s.actor_id);return task?.status!=='paused'&&(task||Date.parse(at)-Date.parse(s.plan.created_at)<120*MINUTE);})
    .flatMap(s=>s.plan.steps.slice(s.plan.index).filter(step=>step.kind==='activity').map(step=>({actor_id:s.actor_id,plan_id:s.plan.plan_id,
      activity_id:step.activity_id,target:ACTIVITIES.find(recipe=>recipe.activity_id===step.activity_id)?.target})))
    .filter(claim=>SUPPLY_TARGETS.has(claim.target));
}
function checkSupplyClaim(world,at,id,steps) {
  const targets=new Set(steps.filter(step=>step.kind==='activity').map(step=>ACTIVITIES.find(recipe=>recipe.activity_id===step.activity_id)?.target).filter(target=>SUPPLY_TARGETS.has(target)));
  const peer=supplyClaims(world,at,id).find(claim=>targets.has(claim.target));
  if(peer)throw planError(`${actor(world,peer.actor_id).display_name}已经在准备这项补给，等实际结果或另选一件事。`);
  return steps;
}
function mealTurn(world,id) {
  if(actor(world,id).location_id!=='warm-pot-courtyard')return true;
  const lastMeal=personId=>world.tasks.filter(task=>task.actor_id===personId&&task.activity_id==='share-meal'&&task.status==='completed').reduce((latest,task)=>Math.max(latest,Date.parse(task.finished_at??task.due_at)),0);
  const people=Object.values(world.autonomy.actors).filter(s=>!s.paused&&s.appetite>.6&&actor(world,s.actor_id)?.location_id==='warm-pot-courtyard'&&!activeWorldTask(world,s.actor_id)&&!reservedSocialActors(world).includes(s.actor_id))
    .sort((a,b)=>b.appetite-a.appetite||lastMeal(a.actor_id)-lastMeal(b.actor_id)||a.actor_id.localeCompare(b.actor_id));
  return !people.length||people[0].actor_id===id;
}

const observationTopic=(destination,profile)=>destination==='moss-sprout-garden'?'care'
  :destination==='warm-pot-courtyard'?'cook'
  :destination==='spare-parts-house'?(profile.interests.includes('repair')?'repair':'craft')
  :['backlit-grove','echo-waterside','tidal-old-road','fog-lamp-square','lamp-street-homes','whisper-market','shaping-field-desk'].includes(destination)?'explore':null;

function addDiscretionaryPractice(world,state,at,result,add) {
  if(state.energy<.55||state.appetite>.5||result.some(c=>c.available&&c.score>=50))return;
  const facets=developmentFacetsReadModel(world,{actorId:state.actor_id,at});
  if(!facets.enabled)return;
  const date=localWorldDate(at,world.clock.time_zone).date;
  if((world.memory?.development?.records??[]).some(r=>r.actor_ids.includes(state.actor_id)&&r.activity_id
    &&r.causes?.motivation?.kind==='self_continuation'&&localWorldDate(r.at,world.clock.time_zone).date===date))return;
  const topics=(facets.actors.find(a=>a.actor_id===state.actor_id)?.topics??[])
    .filter(t=>(t.contact?.count??0)+(t.interest.active_roots?.length??0)+(t.interest.invited_roots?.length??0)>0)
    .sort((a,b)=>(b.interest.bonus??0)-(a.interest.bonus??0)||a.topic.localeCompare(b.topic));
  const count=(id,resource)=>stock(world,id,resource)+carried(world,state.actor_id,resource);
  for(const topic of topics) {
    let recipe=null,build=null;
    const bed=world.living.objects['garden-bed'];
    if(topic.topic==='care'&&bed.quantity>0&&bed.health>=.65&&bed.health<.95&&bed.moisture>=.32&&bed.moisture<=.72
      &&stock(world,'seedling-rack','water')>=6)recipe='tend-bed';
    if(topic.topic==='craft'&&count('seedling-rack','trays')<2&&stock(world,'parts-drawers','wood')>=3&&stock(world,'parts-drawers','fasteners')>=5)recipe='craft-tray';
    if(topic.topic==='cook'&&stock(world,'shared-table','rations')>=6&&stock(world,'shared-table','rations')<=12
      &&stock(world,'trial-stove','water')>=3&&(count('seedling-rack','moss')>=4||count('seedling-rack','light_fruit')>=4)) {
      recipe='cook';build=()=>cookAndStoreSteps(world,state.actor_id);
    }
    if(!recipe||result.some(c=>c.available&&c.steps?.some(s=>s.kind==='activity'&&s.activity_id===recipe)))continue;
    const activity=ACTIVITIES.find(a=>a.activity_id===recipe);
    const goal=`continue:${topic.topic}`;
    add(goal,topic.topic==='cook'?'再试一次做饭并放到长桌':activity.title,
      `手头的事和基本需要已经留好余地，想把之前关注的${topic.label}实际试一小次。`,31,
      build??(()=>activitySteps(world,state.actor_id,recipe)));
    const candidate=result.find(c=>c.goal===goal);
    if(candidate)Object.assign(candidate,{development_topic:topic.topic,discretionary_practice:true});
    // One attempted plan per decision and one enacted practice per local day.
    // A blocked preparation has no settled outcome and awards no evidence.
    if(candidate?.available)return;
  }
}

function candidates(world, state, at) {
  const id=state.actor_id, profile=(world.resident_life?RESIDENT_PROFILES[id]:null)??PROFILE[id]??{interests:['explore'],places:[actor(world,id).location_id],rest:actor(world,id).location_id,quiet:'在这里待一会儿'};
  const bed=world.living.objects['garden-bed'], objects=world.living.objects;
  const minute=localWorldDate(at,world.clock.time_zone).minute_of_day, result=[];
  function add(goal,title,reason,score,build) {
    if(Date.parse(state.cooldowns[goal]??'')>Date.parse(at))return;
    try { result.push({goal,title,reason,score,steps:checkSupplyClaim(world,at,id,build()),available:true}); }
    catch(error) { result.push({goal,title,reason,score,available:false,blocked_reason:error.message}); }
  }
  function activity(goal,id,reason,score){add(goal,ACTIVITIES.find(r=>r.activity_id===id).title,reason,score,()=>activitySteps(world,state.actor_id,id));
    const candidate=result.find(c=>c.goal===goal);if(candidate)Object.assign(candidate,{activity_id:id,development_topic:activityTopic(id)});}
  const night=minute>=1380||minute<360;
  if(state.energy<.4 || night) add('rest','休息一会儿',night?'天晚了，先留出休息的时间。':'有些累了，先恢复精神。',state.energy<.2?150:night?115:100,()=>{
    const destination=world.locations.some(l=>l.location_id===profile.rest)?profile.rest:actor(world,id).location_id;
    const reachable=findWorldPath(world,actor(world,id).location_id,destination);
    const duration=night?Math.min(21600,Math.max(3600,((minute<360?360:1800)-minute)*60)):2700;
    return [...(reachable&&destination!==actor(world,id).location_id?[{kind:'travel',location_id:destination}]:[]),{kind:'rest',duration_seconds:duration,title:'休息一会儿'}];
  });
  if(carried(world,id,'rations')>0&&stock(world,'shared-table','rations')<(objects['shared-table'].capacity??24))
    add('store-meals','把做好的饭留到长桌','先把随身袋里的饭放上长桌，让回来的人都找得到。',145,()=>depositSteps(world,id,'shared-table','rations'));
  if(state.appetite>.6) add('meal','在长桌吃一份饭','想吃点东西，先确认长桌或厨房还有什么。',state.appetite>.9?140:95,()=>{
    if(stock(world,'shared-table','rations')>0&&!mealTurn(world,id))throw planError('先让同桌更饿、上次吃饭更早的人拿到一份。');
    return activitySteps(world,id,'share-meal');
  });
  if(bed.quantity>0 && bed.moisture<.32)activity('water','water-bed','苗床正在失水，想先照看这一批苗。',bed.moisture<.18?110:70);
  if(bed.quantity>0 && bed.moisture>.84)activity('drain','drain-bed','苗床积水了，先疏通排水。',105);
  if(bed.quantity>0 && bed.health<.65)activity('tend','tend-bed','这一批苗有些衰弱，想整理一下。',profile.interests.includes('care')?80:55);
  if(bed.quantity>0 && bed.growth>=.85)activity('harvest','harvest-bed','苔芽已经成熟，收下后还能继续播种或做饭。',profile.interests.includes('care')?78:58);
  if(!bed.quantity)activity('sow','sow-bed','苗床空下来了，想让下一批苔芽继续长。',profile.interests.includes('care')?72:45);
  if(stock(world,'trial-stove','water')<2) add('water-supply:kitchen','给厨房送一桶清水','灶边的清水不多了，先去水岸取水，再带回来。',profile.interests.includes('cook')?76:53,()=>waterSupplySteps(world,id,'trial-stove'));
  if(bed.quantity>0&&stock(world,'seedling-rack','water')<3) add('water-supply:nursery','给苗圃补清水','给下一次照料留些水，去水岸取水带回育苗架。',profile.interests.includes('care')?81:56,()=>waterSupplySteps(world,id,'seedling-rack'));
  if(carried(world,id,'seeds')>0) add('store-seeds','把留好的种子放回苗圃','下一次播种时，大家都能找到这些种子。',80,()=>depositSteps(world,id,'seedling-rack','seeds'));
  if(stock(world,'seedling-rack','seeds')<4) add('seed-supply','为下一批苔芽留种','从收获里分出一部分挑选种子，给下次播种留下余地。',profile.interests.includes('care')?83:66,()=>seedSupplySteps(world,id));
  if(carried(world,id,'moss')>0&&(stock(world,'seedling-rack','seeds')>=4||carried(world,id,'moss')<2)) add('store-harvest','把收获留到共用育苗架','把鲜苔芽放好，厨房需要时就能来取。',64,()=>depositSteps(world,id,'seedling-rack','moss'));
  for(const [objectId,recipeId] of [['floating-frame','repair-frame'],['market-canopy','stitch-canopy'],['repair-bench','repair-bench'],['seedling-rack','repair-rack'],['trial-stove','repair-stove']]) {
    if(objects[objectId].condition<.55)activity(`repair:${objectId}`,recipeId,'设施磨损了，先把材料备齐再修。',profile.interests.includes('repair')||profile.interests.includes('craft')?82:52);
  }
  if(profile.interests.includes('craft') && stock(world,'seedling-rack','trays')+carried(world,id,'trays')<2) add('tray','做一只育苗托盘','想试着做点苗圃能用上的东西。',35,()=>[...activitySteps(world,id,'craft-tray'),{kind:'travel',location_id:object(world,'seedling-rack').location_id},{kind:'transfer',object_id:'seedling-rack',resource:'trays',count:1,operation:'store'}]);
  const hungry=Object.values(world.autonomy.actors).filter(s=>actor(world,s.actor_id)&&s.appetite>.6).length;
  const mealReserve=Math.min(10,Math.max(4,hungry+2));
  if(profile.interests.includes('cook') && stock(world,'shared-table','rations')<mealReserve)
    add('cook','做一锅饭放到长桌','先看苗圃和林间实际采回的食材，做成一锅，再把每一份放到长桌。',hungry?90:65,()=>cookAndStoreSteps(world,id));
  if(objects['light-fruit-bough']&&stock(world,'shared-table','rations')<mealReserve&&stock(world,'seedling-rack','light_fruit')<2) {
    if(carried(world,id,'light_fruit')>0)add('store-fruit','把光果带回共用育苗架','让厨房能看到已经采到的食材，回来的人也能取用。',88,()=>depositSteps(world,id,'seedling-rack','light_fruit'));
    else if(profile.interests.includes('care')||profile.interests.includes('explore')||profile.interests.includes('trade'))
      add('fruit-supply','采一篮光果送回苗圃','林间果枝有成熟光果时，采下实际的一篮，送到公共食材架。',hungry?86:62,()=>fruitSupplySteps(world,id));
  }
  const blockedMeal=result.find(choice=>choice.goal==='meal'&&!choice.available);
  if(blockedMeal&&(stock(world,'shared-table','rations')>0||world.tasks.some(task=>['running','paused'].includes(task.status)&&task.target_object_id==='shared-table')||supplyClaims(world,at,id).some(claim=>claim.target==='trial-stove')))
    add('wait-meal','在饭桌附近等一小会儿','已有饭或有人正在做这餐，先过去等空位，三分钟后再看真实结果。',state.appetite>.9?139:94,()=>{
      if(!findWorldPath(world,actor(world,id).location_id,'warm-pot-courtyard'))throw planError('到饭桌的路暂时不通。');
      return [...(actor(world,id).location_id==='warm-pot-courtyard'?[]:[{kind:'travel',location_id:'warm-pot-courtyard'}]),{kind:'observe',title:'等长桌和厨房空下来',duration_seconds:180}];
    });
  for(const project of projectCandidates(world,id,at)) {
    if(!project.available) result.push(project);
    else add(project.goal,project.title,project.reason,project.score,()=>activitySteps(world,id,project.activity_id));
    const choice=result.find(c=>c.goal===project.goal);
    if(choice)Object.assign(choice,{project_id:project.project_id,project_stage_id:project.project_stage_id,activity_id:project.activity_id});
  }
  updateProjectScheduling(world,id,at,result.filter(c=>c.project_id));
  for(const trial of practicalTrialCandidates(world,state,at)) {
    try { result.push({...trial,steps:checkSupplyClaim(world,at,id,trial.steps)}); }
    catch(error) { result.push({...trial,available:false,blocked_reason:error.message}); }
  }
  addDiscretionaryPractice(world,state,at,result,add);
  const index=hash(`${id}:${localWorldDate(at,world.clock.time_zone).date}:${Math.floor(minute/180)}`)%profile.places.length;
  for(const destination of world.memory ? profile.places : [profile.places[index]]) {
  add(`interest:${destination}`,world.memory?`${world.locations.find(l=>l.location_id===destination)?.name??destination} · ${profile.quiet}`:profile.quiet,'留点时间做自己感兴趣的事。',30,()=>{
    if(!findWorldPath(world,actor(world,id).location_id,destination))throw planError('这条路暂时不通。');
    return [...(actor(world,id).location_id===destination?[]:[{kind:'travel',location_id:destination}]),{kind:'observe',title:profile.quiet,duration_seconds:900}];
  });
  const observation=result.find(c=>c.goal===`interest:${destination}`);
  if(observation)observation.development_topic=observationTopic(destination,profile);
  }
  add('quiet-rest','在这里歇一歇','眼前能做的事暂时有限，先歇一会儿。',5,()=>[{kind:'rest',title:'在这里歇一歇',duration_seconds:1800}]);
  return influenceRememberedChoices(world,state,influenceBodyChoices(world,state,at,influenceLifeChoices(world,state,at,profile,result)));
}
function feedback(world,state,at,kind,text,more={}) {
  state.last_feedback={at,kind,text,...more}; lifeNote(world,at,state.actor_id,kind,text,more);
}
function abandon(world,state,at,reason,cancelled=false) {
  const plan=state.plan;
  plan.status=cancelled?'cancelled':'failed';plan.finished_at=at;plan.failure_reason=reason;
  state.cooldowns[plan.goal]=new Date(Date.parse(at)+(cancelled?30:20)*MINUTE).toISOString();
  state.next_decision_at=new Date(Date.parse(at)+(cancelled?30:1)*MINUTE).toISOString();
  feedback(world,state,at,cancelled?'cancelled':'replan',cancelled?'这次安排停下了，留点时间再决定。':`原来的安排没能继续：${reason}`,{plan_id:plan.plan_id});
}
function executeStep(world,state,at,eventId) {
  const plan=state.plan, step=plan.steps[plan.index];
  if(!step){plan.status='completed';plan.finished_at=at;const cooldown=plan.goal==='wait-meal'?0:['meal','cook','store-meals','store-fruit','fruit-supply'].includes(plan.goal)?5:120;
    state.cooldowns[plan.goal]=new Date(Date.parse(at)+cooldown*MINUTE).toISOString();state.next_decision_at=new Date(Date.parse(at)+(plan.goal==='wait-meal'?0:5)*MINUTE).toISOString();feedback(world,state,at,'plan_completed',`“${plan.title}”这件事做完了。`,{plan_id:plan.plan_id});return;}
  const id=state.actor_id, actionId=`${eventId}:${id}:${state.sequence}:${plan.index}`;
  if(step.kind==='travel' && actor(world,id).location_id===step.location_id){plan.index++;return;}
  if(step.kind==='transfer') {
    const transferred=transferLivingResource(world,{...step,actor_id:id},at);plan.index++;
    feedback(world,state,at,'transfer',transferred.text,{plan_id:plan.plan_id});return;
  }
  let task;
  if(step.kind==='travel') {
    const path=findWorldPath(world,actor(world,id).location_id,step.location_id);
    if(!path?.[1])throw planError('当前通路无法到达原定地点。');
    task=startTravelTask(world,{eventId:actionId,at,actorId:id,locationId:path[1],destinationId:step.location_id,reason:plan.reason}).task;
  } else task=startActivityTask(world,{actor_id:id,task_id:`life-${actionId}`,...(step.kind==='activity'?{activity_id:step.activity_id}:{kind:'care',title:step.title,duration_seconds:step.duration_seconds})},{eventId:actionId,at}).task;
  const stored=world.tasks.find(t=>t.task_id===task.task_id);stored.origin='autonomous_life';stored.life_plan_id=plan.plan_id;stored.life_action=step.kind;stored.life_goal=plan.goal;stored.life_source_ids=plan.source_ids??[];
  // Preserve the bounded choice and its input references at execution time.
  // Later plans and short-lived input records must not rewrite this task's cause.
  stored.life_decision={source:plan.decision?.source??'rules',at:plan.created_at,
    ...(plan.decision?.model?{model:plan.decision.model}:{}),
    ...(plan.decision?.request_id?{request_id:plan.decision.request_id}:{}),
    memory_ids:[...(plan.decision?.memory_ids??[])]};
  stored.life_source_context=(world.refraction?.records??[]).filter(r=>stored.life_source_ids.includes(r.id))
    .map(r=>({record_id:r.id,event_id:r.event_id,origin_id:r.origin_id,category:r.category,attested:r.attested}));
  stored.life_motivation={...structuredClone(plan.motivation??{kind:'unknown',basis_score:null}),
    facet_root_ids:[...(plan.motivation?.facet_root_ids??[])].slice(-16)};
  if(step.kind==='observe'&&['care','craft','repair','cook','explore','connection'].includes(plan.development_topic))stored.life_topic=plan.development_topic;
  if(plan.role_trial) {
    stored.role_trial={...plan.role_trial,step_role:step.role_trial_primary?'primary':'support'};
    recordPracticalTrialTask(world,stored,at);
  }
  for(const record of world.refraction?.records??[])if(plan.source_ids?.includes(record.id))record.source_task_ids=[...(record.source_task_ids??[]),task.task_id].slice(-16);
  plan.task_id=task.task_id;plan.status='executing';
  if(id!==world.protagonist.character_id && step.kind!=='travel')actor(world,id).status=step.kind==='rest'?'正在休息':task.title;
  feedback(world,state,at,'started',`开始${task.title}。`,{plan_id:plan.plan_id,task_id:task.task_id});
}

export function advanceAutonomousLife(world, at, {eventId,reservedActors=[],budget=8}={}) {
  if(world.clock?.mode!=='real_time' || world.living?.recovery.pending || at<world.clock.synced_at || world.tasks.some(t=>t.status==='running'&&t.due_at<=at))return {accepted:false,reason:'life_waiting_for_recovery'};
  installAutonomy(world,at);syncLifeNeeds(world,at);
  settleResidentProjects(world,at);
  settleRefraction(world,at);
  if(world.social)advanceSocialLife(world,at,{eventId,reservedActors});
  const socialReserved=reservedSocialActors(world);
  const states=Object.values(world.autonomy.actors).filter(s=>actor(world,s.actor_id));
  const rotate=(Math.floor(Date.parse(at)/MINUTE)*Math.min(8,budget))%Math.max(1,states.length);
  const rotation=[...states.slice(rotate),...states.slice(0,rotate)];
  const ready=rotation.filter(s=>['ready','fallback'].includes(world.memory?.planner.requests[s.actor_id]?.status));
  const remaining=rotation.filter(s=>!ready.includes(s));
  const ordered=[...ready,...remaining.filter(s=>!s.paused),...remaining.filter(s=>s.paused)].slice(0,Math.min(8,budget));
  for(const entry of ordered) {
    const state=world.autonomy.actors[entry.actor_id];
    const current=activeWorldTask(world,state.actor_id);
    if(current)continue; // Includes user-paused tasks. No preemption or automatic resume.
    const plan=state.plan;
    if(plan?.task_id && ['planned','executing'].includes(plan.status)) {
      const task=world.tasks.find(t=>t.task_id===plan.task_id);
      if(!task){abandon(world,state,at,'原任务记录已不在可恢复范围。');continue;}
      if(task.status!=='completed'){abandon(world,state,at,task.failure_reason??'活动已取消',task.status==='cancelled');continue;}
      feedback(world,state,at,'completed',task.completion?.result?.text??(task.life_action==='rest'?'休息结束了。':`${task.title}完成了。`),{task_id:task.task_id,completed_at:task.completion?.due_at});
      if(state.actor_id!==world.protagonist.character_id){actor(world,state.actor_id).status=state.last_feedback.text;actor(world,state.actor_id).last_action=task.title;}
      plan.task_id=null;plan.index++;plan.status='planned';
    }
    if(state.plan?.role_trial&&!practicalTrialPlanMayContinue(world,state,at)) {
      state.plan=null;state.next_decision_at=at;
    }
    if(state.paused || reservedActors.includes(state.actor_id) || socialReserved.includes(state.actor_id))continue;
    if(Date.parse(state.next_decision_at)>Date.parse(at))continue;
    if(!state.plan || ['completed','failed','cancelled'].includes(state.plan.status)) {
      const choices=candidates(world,state,at);state.last_candidates=choices.map(({steps,...choice})=>choice).slice(0,12);
      const selection=prepareLifeChoice(world,state,choices,at);if(selection.waiting)continue;
      const choice=selection.choice;if(!choice)continue;
      state.sequence++;
      state.plan={plan_id:`life-plan:${state.actor_id}:${state.sequence}`,goal:choice.goal,title:choice.title,reason:choice.reason,steps:choice.steps,index:0,status:'planned',task_id:null,created_at:at};
      state.plan.source_ids=choice.source_ids??[];state.plan.decision=selection.decision;
      const invited=(world.refraction?.records??[]).some(r=>choice.source_ids?.includes(r.id)&&r.attested===true&&['dialogue','user','agent'].includes(r.category));
      state.plan.motivation={kind:invited?'invited':choice.goal.startsWith('interest:')||choice.discretionary_practice?'self_continuation':'need',
        basis_score:choice.score-(choice.memory_bonus??0),facet_root_ids:[...(choice.facet_root_ids??[])].slice(-16)};
      state.plan.development_topic=choice.development_topic??null;
      if(choice.role_trial)state.plan.role_trial=structuredClone(choice.role_trial);
      if(choice.project_id)Object.assign(state.plan,{project_id:choice.project_id,project_stage_id:choice.project_stage_id});
      recordInputDecision(world,state,choices,choice,at);
      recordBodyLifeDecision(world,state,choice,at);
      feedback(world,state,at,'decided',`想${choice.title}：${choice.reason}`,{plan_id:state.plan.plan_id});
    }
    try {
      const trial=structuredClone(world);
      executeStep(trial,trial.autonomy.actors[state.actor_id],at,eventId);
      Object.assign(world,trial);
    }
    catch(error){if(!error.code)throw error;abandon(world,state,at,error.message);}
  }
  world.autonomy.last_cycle_slot=Math.floor(Date.parse(at)/MINUTE);
  settleRefraction(world,at);
  world.autonomy.revision++;return {accepted:true,version:AUTONOMY_VERSION,actors:ordered.length};
}
export function applyLifeChoice(world,at,payload) {
  const state=world.autonomy?.actors[payload.actor_id],r=world.memory?.planner.requests[payload.actor_id];
  if(!r||r.id!==payload.request_id||!state)return {accepted:true,resolved:false,claimed:false,reason:'obsolete_request'};
  const choices=candidates(world,state,at);
  const invalid=!world.memory.planner.enabled||state.paused||activeWorldTask(world,state.actor_id)||
    ['planned','executing'].includes(state.plan?.status)||reservedSocialActors(world).includes(state.actor_id)||
    payload.reserved_actors?.includes(state.actor_id)||world.living?.recovery.pending||
    choices.some(c=>c.available&&c.score-(c.memory_bonus??0)>=50)||fingerprintChoices(world,state,choices)!==r.key;
  if(invalid) {if(['waiting','calling','ready'].includes(r.status)){r.status='discarded';choiceNote(world,r,at,'discarded','手头已有事务，或可行条件变化，保留原结果但不执行旧选择。');}
    return {accepted:true,resolved:false,claimed:false,reason:'current_context_changed'};}
  return {accepted:true,...(payload.action==='claim_life_choice'?claimLifeChoice(world,r,at):resolveLifeChoice(world,r,payload,at))};
}
export function controlAutonomy(world, at, operation) {
  if(!['pause','resume'].includes(operation)||!world.autonomy)throw planError('自主生活尚未安装，或操作无效。');
  const state=world.autonomy.actors[world.protagonist.character_id];state.paused=operation==='pause';state.next_decision_at=at;
  lifeNote(world,at,state.actor_id,'control',state.paused?'暂缓喵呜下一次自发安排，当前活动仍按原任务继续。':'喵呜恢复自行安排生活。');world.autonomy.revision++;
  return {paused:state.paused};
}
export function autonomyReadModel(world) {
  if(!world.autonomy)return null;
  return {schema:AUTONOMY_VERSION,enabled:world.autonomy.enabled,installed_at:world.autonomy.installed_at,revision:world.autonomy.revision,
    policy:world.memory?.planner.enabled?'bounded_model_choice_v1':'bounded_rules_v1',actors:Object.values(world.autonomy.actors).filter(s=>actor(world,s.actor_id)).map(s=>({...structuredClone(s),display_name:actor(world,s.actor_id).display_name,location_id:actor(world,s.actor_id).location_id,inventory:structuredClone(world.living.inventories[s.actor_id]?.stock??{})})),recent:structuredClone(world.autonomy.recent.slice(-20))};
}
export function createAutonomousLife({world,now=()=>new Date(),enabled=false,reserved=()=>[]}={}) {
  return {snapshot:()=>({...autonomyReadModel(world.get()),enabled}),tick({wakeId=null}={}){
    if(!enabled)return {enabled:false};
    const snapshot=world.get(),at=now().toISOString();
    if(snapshot.clock?.mode!=='real_time')return {enabled:false};
    const slot=Math.floor(Date.parse(at)/MINUTE);
    if(!wakeId&&slot<=(snapshot.autonomy?.last_cycle_slot??-1))return {enabled:true,duplicate:true};
    if(snapshot.living?.recovery.pending || snapshot.tasks.some(t=>t.status==='running'&&t.due_at<=at))return {enabled:true,waiting_for_recovery:true};
    return world.ingest({event_id:wakeId?`autonomous-life-wake:${wakeId}`:`autonomous-life:${slot}`,type:'world.mutation',source:'autonomous-life-engine',source_kind:'world_engine',character_id:snapshot.protagonist.character_id,occurred_at:new Date(slot*MINUTE).toISOString(),payload:{action:'advance_autonomous_life',reserved_actors:reserved()}});
  }};
}
