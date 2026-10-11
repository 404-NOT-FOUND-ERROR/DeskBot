// Isolated policy fixtures. Dates, supply and needs are authored test conditions;
// every result is executed by the ordinary finite task engine, never inserted.
import {createPersistentWorld} from '../../../apps/deskbot-service/src/persistent-world.mjs';
import {installAutonomy} from '../../../apps/deskbot-service/src/life-state.mjs';
import {installLivedMemory,syncLivedMemory} from '../../../apps/deskbot-service/src/lived-memory.mjs';
import {advanceLivingResources} from '../../../apps/deskbot-service/src/living-resources.mjs';
import {advanceWorldTask,applyRealTimeClock} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {applyCognitiveMutation,cognitiveRelevantKey,cognitiveActualResult,settleCognitiveTask} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {settlePracticalTrials} from '../../../apps/deskbot-service/src/role-practical-trials.mjs';
export const OWNER='shaping-001',BASE='2026-10-01T02:00:00.000Z',DAY=86400000;
export const atDay=n=>new Date(Date.parse(BASE)+n*DAY).toISOString();
export function developmentFixture(){
 const w=createPersistentWorld({timeMode:'realtime',now:()=>new Date(BASE)}).get();
 installAutonomy(w,BASE);installLivedMemory(w,BASE);
 w.protagonist.location_id='moss-sprout-garden';
 w.cognition={schema:'deskbot.cognitive-life.v2',epoch:BASE,clock_scope:'isolated_test_clock',actors:{[OWNER]:{actor_id:OWNER,continuous:true,version:0,state:{},memories:[],history:[],enabled:false,plan_count:0}}};
 arrange(w,BASE);return w;
}
export function arrange(w,at){
 // Used only at declared fixture boundaries, not by production or paid agents.
 advanceLivingResources(w,at,{force:true});applyRealTimeClock(w,at);
 Object.assign(w.autonomy.actors[OWNER],{paused:false,energy:.88,appetite:.2,plan:null,updated_at:at});
 Object.assign(w.living.objects['garden-bed'],{moisture:.55,health:.97,growth:.2,quantity:10});
 Object.assign(w.living.objects['seedling-rack'].stock,{water:12,moss:8,trays:5,seeds:8});
 Object.assign(w.living.objects['parts-drawers'].stock,{wood:12,fasteners:12});
 w.living.objects['shared-table'].stock.rations=12;
 if(w.living.recovery)w.living.recovery.pending=false;
 syncLivedMemory(w,at);settlePracticalTrials(w,at);
}
export function settle(w,task){
 while(task?.status==='running'){
  const at=task.due_at;advanceLivingResources(w,at,{force:true});applyRealTimeClock(w,at);
  advanceWorldTask(w,{task_id:task.task_id,expected_task_revision:task.revision},at);
 }
 if(task)settleCognitiveTask(w,task,w.clock.synced_at);
 syncLivedMemory(w,w.clock.synced_at);settlePracticalTrials(w,w.clock.synced_at);
}
export function policyChoice(w,compiled,job=`fixture:${w.tasks.length}:${w.clock.synced_at}`){
 const at=w.clock.synced_at;
 applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'plan',job_id:job},at,job+':claim');
 const proposal={schema:'deskbot.cognitive-life.proposal.v3',actor_id:OWNER,phase:'plan',state:{},action:{action_description:'确定性合同测试'},
  compiled:{reason:'明确编排的隔离测试意图',source_ids:[],followup_decision:'continue',...compiled}};
 const result=applyCognitiveMutation(w,{actor_id:OWNER,operation:'plan',job_id:job,proposal,relevant_key:cognitiveRelevantKey(w,OWNER)},at,job+':adopt');
 const task=w.tasks.find(t=>t.task_id===result.task_id);settle(w,task);
 const life=w.cognition.actors[OWNER];
 if(life.pending){
  const actual=cognitiveActualResult(w,OWNER,w.clock.synced_at),feedbackJob=job+':feedback';
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'claim',phase:'feedback',job_id:feedbackJob},w.clock.synced_at,feedbackJob+':claim');
  applyCognitiveMutation(w,{actor_id:OWNER,operation:'feedback',job_id:feedbackJob,result:actual,proposal:{schema:proposal.schema,actor_id:OWNER,phase:'feedback',state:{},memories:[],followup:{status:'continue',question:'测试后续仍待自主选择',reason:'确定性夹具',delay_hours:24}}},w.clock.synced_at,feedbackJob+':adopt');
 }
 return task;
}
export function formedCareFixture(){
 const w=developmentFixture();let root=null;
 for(let n=0;n<4;n++){
  arrange(w,atDay(n));
  const task=policyChoice(w,{operation:'activity',activity_id:n%2?'tend-bed':'water-bed',motivation:n?'self_continuation':'self_exploration',prior_root_id:root});
  if(task?.status!=='completed')throw Error('authored_prior_not_executed');root=`task:${task.task_id}`;
 }
 return w;
}
