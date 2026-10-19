import {fileURLToPath} from 'node:url';
import {createSqlitePersistence} from './persistence.mjs';
import {createPersistentWorld} from './persistent-world.mjs';
import {createCognitiveBudget} from './cognitive-budget.mjs';
import {createCognitiveLife,readCognitiveLifeStatus} from './cognitive-life.mjs';
import {assertDistinctStores,bindRuntimeStore} from './runtime-profile.mjs';
import {COGNITIVE_ACTORS} from './cognitive-life-state.mjs';

export function restoredCognitiveTestTime(state,marker){
  const dates=[marker?.at,state?.clock?.synced_at,...(state?.tasks??[]).map(t=>t.finished_at),
    ...Object.values(state?.cognition?.actors??{}).flatMap(a=>[a.last_result?.occurred_at,...(a.history??[]).map(h=>h.at)])];
  const valid=dates.map(d=>Date.parse(d)).filter(Number.isFinite);
  return new Date(valid.length?Math.max(...valid):Date.parse('2026-10-10T02:00:00.000Z'));
}

export function createCognitiveRuntime({world,now=()=>new Date(),budgetFilename,experimentFilename,worldFilename,modelUsage=null,liveBudget=null}={}){
  budgetFilename??=fileURLToPath(new URL('../../../data/cognition-stage2-budget.sqlite',import.meta.url));
  experimentFilename??=fileURLToPath(new URL('../../../data/cognition-stage2-confirmation.sqlite',import.meta.url));
  assertDistinctStores({live:worldFilename,budget:budgetFilename,experiment:experimentFilename});
  const budgetStore=createSqlitePersistence({filename:budgetFilename??fileURLToPath(new URL('../../../data/cognition-stage2-budget.sqlite',import.meta.url))});
  try{bindRuntimeStore(budgetStore,{scope:'lab',kind:'cognition_budget'});}catch(e){budgetStore.close();throw e;}
  const budget=createCognitiveBudget({persistence:budgetStore,onUsage:modelUsage?.record});
  const labStore=createSqlitePersistence({filename:experimentFilename??fileURLToPath(new URL('../../../data/cognition-stage2-confirmation.sqlite',import.meta.url))});
  try{bindRuntimeStore(labStore,{scope:'lab',kind:'cognition_world',allowLegacy:labStore.get('cognition-stage2.test-clock','current')?.scope==='isolated_test_clock'});}
  catch(e){labStore.close();budgetStore.close();throw e;}
  let testAt=restoredCognitiveTestTime(labStore.list('canonical-world.states')[0],labStore.get('cognition-stage2.test-clock','current'));
  const saveTestTime=()=>labStore.put('cognition-stage2.test-clock','current',{at:testAt.toISOString(),scope:'isolated_test_clock'});
  saveTestTime();
  let labWorld=createPersistentWorld({persistence:labStore,timeMode:'realtime',now:()=>testAt});
  if(!labWorld.get().cognition){
    labWorld.ingest({event_id:'stage2-fixture-residents',type:'world.mutation',source:'fixture',character_id:'shaping-001',payload:{action:'install_resident_life'}});
    const seed=labWorld.get();seed.protagonist.location_id='moss-sprout-garden';seed.npcs=seed.npcs.filter(n=>COGNITIVE_ACTORS.includes(n.npc_id));
    for(const p of seed.npcs)p.location_id='moss-sprout-garden';
    seed.living.objects['garden-bed'].moisture=.34;labStore.put('canonical-world.states',seed.world_id,seed);
    labWorld=createPersistentWorld({persistence:labStore,timeMode:'realtime',now:()=>testAt});
  }
  // Experiment consent/credit never enables continuous cognition in a real life.
  const live=liveBudget?createCognitiveLife({world,budget:liveBudget,now}):null;
  const experiment=createCognitiveLife({world:labWorld,budget,now:()=>testAt,clockScope:'isolated_test_clock'});
  function status(){return {schema:'deskbot.cognitive-runtime.v2',live:live?.status()??readCognitiveLifeStatus(world.get(),{at:now().toISOString(),enabled:false,
    budget:{approval:{limit_cny:0,max_calls:0,scope:'live_not_enabled'},used_upper_cny:0,remaining_cny:0,calls:[],cost_note:'正式连续认知未启用；实验额度仅用于隔离存档。'}}),experiment:experiment.status()};}
  async function run({scope,actor_id,phase='plan'}){
    if(!['live','experiment'].includes(scope))throw Object.assign(new Error('invalid cognitive scope'),{code:'invalid_cognitive_scope'});
    if(scope==='live'&&!live)throw Object.assign(new Error('正式连续认知尚未启用，隔离实验额度不能用于正式人生。'),{code:'live_cognition_not_enabled'});
    return (scope==='live'?live:experiment).run(actor_id,phase);
  }
  async function advance({operation}){
    if(experiment.status().active_actors.length)throw Object.assign(new Error('先等待正在进行的认知回合结束。'),{code:'test_clock_busy'});
    if(!['finish_tasks','next_review','next_day'].includes(operation))throw Object.assign(new Error('invalid test operation'),{code:'invalid_test_clock_operation'});
    const pending=labWorld.get().tasks.filter(t=>t.status==='running');
    if(pending.length){
      testAt=new Date(Math.max(testAt.getTime(),...pending.map(t=>Date.parse(t.due_at))));saveTestTime();
      labWorld.syncTasks();labWorld.syncWallClock();await experiment.tick();
    }
    if(operation==='next_day'){
      testAt=new Date(testAt.getTime()+24*3600000);saveTestTime();labWorld.syncTasks();labWorld.syncWallClock();
      for(const id of COGNITIVE_ACTORS){
        const life=labWorld.get().cognition?.actors[id];
        if(!life?.pending&&(life?.plan_count??0)<experiment.status().max_plans_per_actor)await experiment.run(id);
      }
    }
    if(operation==='next_review'){
      const eligible=Object.values(labWorld.get().cognition?.actors??{}).filter(a=>a.enabled&&!a.pending&&a.plan_count<experiment.status().max_plans_per_actor);
      const windows=eligible.map(a=>Date.parse(a.next_decision_at)).filter(Number.isFinite);
      if(windows.length){
        testAt=new Date(Math.max(testAt.getTime(),Math.min(...windows)));saveTestTime();labWorld.syncTasks();labWorld.syncWallClock();await experiment.tick();
      }
    }
    return status();
  }
  return {status,run,advance,tick:()=>live?.tick()??Promise.resolve([]),close:async()=>{await Promise.all([live?.close(),experiment.close()]);await budget.close();labStore.close();budgetStore.close();}};
}
