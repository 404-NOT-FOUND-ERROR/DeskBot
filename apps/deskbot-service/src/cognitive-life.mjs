import {randomUUID} from 'node:crypto';
import {createCognitionBridge} from './cognition-bridge.mjs';
import {cognitiveActorIds,cognitiveContext,cognitiveActualResult,cognitivePerson} from './cognitive-life-state.mjs';
import {scheduleCognitiveActor,fairCognitiveQueue} from './cognitive-schedule.mjs';

export function createCognitiveLife({world,budget,now=()=>new Date(),clockScope='real_time',mode='real',bridge=null,maxPlans=4,maxConcurrent=2}={}){
  const transport=bridge??createCognitionBridge({workerFile:'life_worker.py',timeoutMs:180000,maxFrames:45,mode});
  const active=new Map();let closed=false;
  function mutate(id,operation,jobId,extra={}){
    return world.ingest({event_id:`${jobId}:${operation}`,type:'world.mutation',source:'cognitive-life-engine',source_kind:'world_engine',
      character_id:world.get().protagonist.character_id,occurred_at:now().toISOString(),payload:{action:'cognitive_life',actor_id:id,operation,job_id:jobId,clock_scope:clockScope,...extra}},{cognitiveInternal:true});
  }
  async function perform(id,phase){
    if(closed)throw Object.assign(new Error('life closed'),{code:'cognitive_life_closed'});
    const prior=world.get().cognition?.actors[id];
    if(prior?.job?.status==='calling'&&!active.has(id)){
      mutate(id,'error',prior.job.id,{error:'interrupted_on_restart'});
    }
    if(phase==='plan'&&prior?.pending)throw Object.assign(new Error('先理解上一件事的实际结果。'),{code:'pending_result_requires_feedback'});
    if(phase==='plan'&&!prior?.continuous&&(prior?.plan_count??0)>=maxPlans)throw Object.assign(new Error('此人物已达到首轮回合数，不追加调用。'),{code:'pilot_plan_limit'});
    if(phase==='feedback'&&!cognitiveActualResult(world.get(),id,now().toISOString()))throw Object.assign(new Error('任务尚未结束或已经反馈。'),{code:'feedback_without_result'});
    if(phase==='reflect'&&!prior?.continuous&&(prior?.reflection_count??0)>=2)throw Object.assign(new Error('首轮整理次数已达到上限。'),{code:'reflection_limit'});
    const jobId=`cog-${id}-${randomUUID()}`;
    mutate(id,'claim',jobId,{phase,max_plans:maxPlans});
    const context=cognitiveContext(world.cognitionView?.(id)??world.get(),id,now().toISOString(),phase);context.mode=mode;
    if(phase==='feedback'){
      context.result=cognitiveActualResult(world.get(),id,now().toISOString());
      if(!context.result)throw Object.assign(new Error('任务尚未结束。'),{code:'task_not_finished'});
      context.action=context.saved.pending.action;
      context.reflect=!prior?.continuous&&context.saved.memories.filter(m=>m.payload.stream==='experiential').length>=2;
    }
    let call=0;
    try{
      const proposal=await transport.session(context,request=>budget.complete(`${jobId}:${++call}`,{...request,phase,usage_scope:clockScope}));
      const adoption=mutate(id,phase,jobId,{proposal,relevant_key:context.relevant_key,...(phase==='feedback'?{result:context.result}:{})});
      return {job_id:jobId,phase,actor_id:id,calls:call,adoption:adoption.mutation.details};
    }catch(error){mutate(id,'error',jobId,{phase,error:error.code??error.message,retryable:error.retryable===true});throw error;}
  }
  async function run(id,phase='plan'){
    if(!cognitiveActorIds(world.get()).includes(id)||!['plan','feedback','reflect','perceive','interpret','relate','maintain'].includes(phase))throw Object.assign(new Error('invalid actor/phase'),{code:'invalid_cognitive_request'});
    const inFlight=active.get(id);
    if(inFlight){if(inFlight.phase===phase)return inFlight.promise;await inFlight.promise.catch(()=>{});return run(id,phase);}
    const entry={phase,promise:null};
    const promise=Promise.resolve().then(async()=>{
      if(phase==='plan'&&cognitiveContext(world.get(),id,now().toISOString()).perceptions.length)await perform(id,'perceive');
      return perform(id,phase);
    });entry.promise=promise;active.set(id,entry);
    try{return await promise;}finally{if(active.get(id)===entry)active.delete(id);}
  }
  async function tick(){
    const snapshot=world.get(),at=now().toISOString(),results=[],queue=[];
    for(const id of cognitiveActorIds(snapshot)){
      const life=snapshot.cognition?.actors[id];if(!life?.enabled||active.has(id))continue;
      if(life.continuous){
        const candidate=scheduleCognitiveActor(snapshot,id,at,cognitiveContext(snapshot,id,at),{actualResult:Boolean(cognitiveActualResult(snapshot,id,at))});
        if(candidate)queue.push({...candidate,actor_id:id,last_dispatch_at:life.schedule?.last_dispatch_at});
        continue;
      }
      if(life.retry){
        if(!life.retry.retryable||life.retry.at>at)continue;
        results.push(await run(id,life.retry.phase).catch(e=>({actor_id:id,error:e.code??e.message})));continue;
      }
      if(life.pending&&cognitiveActualResult(snapshot,id,at))results.push(await run(id,'feedback').catch(e=>({actor_id:id,error:e.code??e.message})));
      else if(!life.pending&&life.next_decision_at&&life.next_decision_at<=at&&life.plan_count<maxPlans)
        results.push(await run(id,'plan').catch(e=>({actor_id:id,error:e.code??e.message})));
      else if(cognitiveContext(world.get(),id,at).perceptions.length)results.push(await run(id,'perceive').catch(e=>({actor_id:id,error:e.code??e.message})));
    }
    const selected=fairCognitiveQueue(queue).slice(0,Math.max(0,maxConcurrent-active.size));
    results.push(...await Promise.all(selected.map(item=>item.phase==='rest_window'
      ?Promise.resolve().then(()=>mutate(item.actor_id,'rest_window',`sleep-${item.actor_id}-${randomUUID()}`,{reason:item.reason})).catch(e=>({actor_id:item.actor_id,error:e.code??e.message}))
      :run(item.actor_id,item.phase).catch(e=>({actor_id:item.actor_id,error:e.code??e.message})))));
    return results;
  }
  function status(){const snapshot=world.get();return {schema:'deskbot.cognitive-life.status.v2',clock_scope:clockScope,at:now().toISOString(),
    engine:'Asamana Agent / Need / Decision / Memory / Reflection + Node authoritative tasks',max_plans_per_actor:maxPlans,
    active_actors:[...active.keys()],actors:cognitiveActorIds(snapshot).map(id=>({actor_id:id,name:cognitivePerson(snapshot,id)?.display_name??id,
      location_id:cognitivePerson(snapshot,id)?.location_id,location_name:snapshot.locations.find(l=>l.location_id===cognitivePerson(snapshot,id)?.location_id)?.name,life:snapshot.cognition?.actors[id]??null})),
    tasks:(snapshot.tasks??[]).filter(t=>t.origin==='cognitive_life').slice(-20),budget:budget.status()};}
  for(const id of cognitiveActorIds(world.get())){const job=world.get().cognition?.actors[id]?.job;if(job?.status==='calling')mutate(id,'error',job.id,{error:'interrupted_on_restart'});}
  function configure(id,{enabled=true,continuous=true}={}){return mutate(id,'configure',`configure-${id}-${randomUUID()}`,{enabled,continuous});}
  return {run,tick,status,configure,close:async()=>{closed=true;transport.close();await Promise.allSettled([...active.values()].map(entry=>entry.promise));}};
}
