// Reproducible, fictional rule execution. No provider, formal save or fabricated
// completion: contracts and the normal finite executor produce every recorded row.
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,dirname,relative,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,cases,OWNER,settle,tick,plus} from './r3-fixtures.mjs';
import {cognitiveContext,settleCognitiveTask} from '../../../apps/deskbot-service/src/cognitive-life-state.mjs';
import {freezeCognitiveReferences} from '../../../apps/deskbot-service/src/cognitive-continuity.mjs';
import {prepareGoalBindings} from '../../../apps/deskbot-service/src/cognitive-goal-opportunities.mjs';
import {GOAL_LIFECYCLE} from '../../../apps/deskbot-service/src/cognitive-goal-lifecycle.mjs';
import {startActivityTask} from '../../../apps/deskbot-service/src/realtime-world.mjs';
import {createSqlitePersistence} from '../../../apps/deskbot-service/src/persistence.mjs';

let w=fixture(cases.find(c=>c.id==='resources-1-off'));
const ctx=()=>cognitiveContext(w,OWNER,w.clock.synced_at),goalId='goal:a2-water',rows=[];
const chosen=id=>ctx().opportunities.entries.find(e=>e.binding.activity_id===id&&e.binding.production_use?.kind==='reserve');
function record(label){
 const goal=ctx().goal_lifecycle.goals.find(g=>g.goal_id===goalId);
 rows.push({label,at:w.clock.synced_at,goal_id:goalId,lifecycle_status:goal.lifecycle_status,review_due:goal.review_due,
  next_review_at:goal.next_review_at,criterion_id:goal.completion_criteria.id,method_id:goal.binding?.id,
  evidence_ids:goal.evidence_ids,water:w.living.inventories[OWNER].stock.water??0,
  completed_tasks:w.tasks.filter(t=>t.task_id==='a2-water-execution'&&t.status==='completed').length});
}
function update(u){
 const c=ctx(),life=w.cognition.actors[OWNER],entities=structuredClone(life.state.short_term_goal_entities??[]);
 let g=entities.find(x=>x.id===goalId);
 if(!g){g={id:goalId,text:'备好一批自用清水',goal_type:'short_term',status:'active',created_step:0,due_step:null};entities.push(g);}
 g.status={postpone:'interrupted',resume:'active',complete:'completed'}[u.operation]??g.status;
 const proposal={goal_contract:GOAL_LIFECYCLE.schema,goal_updates:[{goal_id:goalId,...u}],state:{short_term_goal_entities:entities}};
 life.goal_bindings=prepareGoalBindings(life,proposal,c,freezeCognitiveReferences(c),c.at);life.state=proposal.state;
}
const first=chosen('waylight-use'),criterion=ctx().goal_lifecycle.criteria.find(k=>k.opportunity_ids.includes(first.id));
update({operation:'new',text:'备好一批自用清水',criterion_id:criterion.id,next_step:{kind:'opportunity',id:first.id},reason:'夜里考虑借灯净滤一批水'});record('提出目标');
update({operation:'postpone',review_in_hours:12,reason:'留到休息后复查'});record('暂缓十二小时');
tick(w,plus(w.clock.synced_at,13*60));record('隔夜到期，仍未失败');
assert.equal(rows.at(-1).lifecycle_status,'postponed');assert.equal(rows.at(-1).review_due,true);
update({operation:'resume',reason:'休息后有余力再来'});
const second=chosen('collect-water');assert.equal(second.status,'ready');
update({operation:'replan',next_step:{kind:'opportunity',id:second.id},reason:'白天改用普通净滤，仍是同一批自用水'});record('保持目标，换用普通净滤');
startActivityTask(w,{actor_id:OWNER,activity_id:'collect-water',task_id:'a2-water-execution'},{eventId:'a2-water',at:w.clock.synced_at});
const task=w.tasks.find(t=>t.task_id==='a2-water-execution');task.origin='cognitive_life';task.cognitive_operation='activity';task.root_outcome_id='task:a2-water-execution';
task.opportunity_binding={id:second.id,identity:second.identity,production_use:second.binding.production_use};
settle(w,task);assert.equal(task.status,'completed');record('实际执行，产出四份水');
const before=structuredClone(w.living.inventories[OWNER]);
const tempRoot=resolve(tmpdir()),scratch=mkdtempSync(join(tempRoot,'deskbot-a2-report-')),filename=join(scratch,'world.sqlite');
try{
 let db=createSqlitePersistence({filename});db.put('canonical-world.states',w.world_id,w);db.close();
 db=createSqlitePersistence({filename});w=db.get('canonical-world.states',w.world_id);db.close();
 settleCognitiveTask(w,w.tasks.find(t=>t.task_id==='a2-water-execution'),w.clock.synced_at);
 assert.deepEqual(w.living.inventories[OWNER],before);record('SQLite 重启，结果未重复');
}finally{
 const rel=relative(tempRoot,resolve(scratch));assert.ok(rel.startsWith('deskbot-a2-report-')&&!rel.includes('..'));
 rmSync(scratch,{recursive:true,force:true});
}
update({operation:'complete',reason:'执行器记录了这批水，实际结果满足最初标准'});record('有证据地完成');
assert.equal(new Set(rows.map(r=>r.goal_id)).size,1);assert.equal(new Set(rows.map(r=>r.criterion_id)).size,1);
assert.equal(rows.at(-1).water-rows[0].water,4);assert.equal(rows.at(-1).completed_tasks,1);
const report={schema:'deskbot.a2-lifecycle-check.v1',scope:'isolated_fictional_rule_execution',model_calls:0,
 contract:GOAL_LIFECYCLE.schema,goal_id:goalId,criterion:criterion.title,rows,
 checks:{stable_goal_id:true,stable_criterion:true,overnight_not_failed:true,changed_method:true,actual_water_delta:4,
  completed_task_count:1,sqlite_no_duplicate:true,completion_evidence_count:rows.at(-1).evidence_ids.length},
 limitations:['人为编排的合同执行，未测试模型会如何选择','测试时钟推进十三小时，不是自然跨日观察','不代表 R3-A 真实模型验收通过']};
const output=resolve(process.argv[2]??'../runtime/a2-lifecycle-check.json');mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,checks:report.checks,model_calls:0}));
