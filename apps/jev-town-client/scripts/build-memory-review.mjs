// Isolated seven-day canonical task replay. The model here is a labelled deterministic test double.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createPersistentWorld,getWorldMap} from '../../deskbot-service/src/persistent-world.mjs';
import {createWorldLife} from '../../deskbot-service/src/world-life.mjs';
import {createAutonomousLife} from '../../deskbot-service/src/autonomous-life.mjs';
import {createLifeChoiceWorker} from '../../deskbot-service/src/life-choice.mjs';
let time=Date.parse('2026-10-05T04:00:00Z');const now=()=>new Date(time),records=new Map();
const store={get(ns,id){return structuredClone(records.get(ns+':'+id)??null);},list(ns){return [...records.entries()].filter(([k])=>k.startsWith(ns+':')).map(([,v])=>structuredClone(v));},put(ns,id,v){records.set(ns+':'+id,structuredClone(v));},insert(ns,id,v){this.put(ns,id,v);},transaction(fn){return fn();}};
let world=createPersistentWorld({now,persistence:store,timeMode:'realtime'});
createWorldLife({now,worldSnapshot:()=>world.get(),ingest:e=>world.ingest(e),enabled:true}).seedNpcs();
const mutate=(action,more={})=>world.ingest({event_id:`memory-replay:${action}:${time}`,type:'world.mutation',source:'isolated-memory-replay',occurred_at:now().toISOString(),payload:{action,...more}});
mutate('install_resident_life');const setup=world.get();
for(const actor of Object.values(setup.autonomy.actors))actor.paused=actor.actor_id!=='shaping-001';
setup.social.next_offer_at=new Date(time+20*86400000).toISOString();store.put('canonical-world.states',setup.world_id,setup);
function restart(){world=createPersistentWorld({now,persistence:store,timeMode:'realtime'});loop=createAutonomousLife({world,now,enabled:true});worker=createLifeChoiceWorker({world,now,llm:replayModel,wake:id=>loop.tick({wakeId:id})});}
const replayModel={id:'deterministic-replay-model',complete:async()=>{
 const r=world.get().memory.planner.requests['shaping-001'],choices=r.candidates.filter(c=>c.goal.startsWith('interest:'));
 const choice=choices[Math.floor(time/3600000)%Math.max(1,choices.length)]??r.candidates[0];
 return {model:'独立回放测试模型',text:JSON.stringify({goal:choice.goal,reason:`我想${choice.title}，再看看前几次留下的变化。`,memory_ids:r.memories.filter(m=>m.kind==='world_fact').slice(0,2).map(m=>m.id)})};
}};
let loop,worker;restart();mutate('install_input_refraction');mutate('install_lived_memory',{planner_enabled:true});
const frames={},outcomes=[],seen=new Set();function save(id,label){frames[id]={label,map:getWorldMap(world.get())};}
loop.tick();await worker.tick();save('begin','第一天 · 想法与执行分开');
for(let minute=5;minute<=7*24*60;minute+=5){
 time+=300000;world.syncWallClock();world.syncTasks();loop.tick();await worker.tick();
 const w=world.get();for(const task of w.tasks){if(task.status!=='completed'||seen.has(task.task_id))continue;seen.add(task.task_id);outcomes.push({id:task.task_id,actor_id:task.actor_id,title:task.title,at:task.completion.due_at});}
 const interest=w.memory.actors['shaping-001'].interests.explore;
 if(!frames.trying&&interest?.stage==='trying')save('trying','跨过三天 · 想继续试试');
 if(!frames.familiar&&interest?.stage==='familiar')save('familiar','七天的经历 · 逐渐熟悉');
 if(minute===24*60)save('day2','第二天 · 原来的经历还在');
 if(minute===3*24*60){worker.stop();restart();save('restart','第四天 · 重启保留记忆');}
}
save('day7','第七天结束 · 原身份继续生活');
assert.ok(frames.trying);assert.ok(frames.familiar);assert.equal(world.get().protagonist.character_id,'shaping-001');
assert.ok(outcomes.length>20);assert.ok(world.get().memory.episodes.some(e=>e.kind==='personal_interpretation'));
worker.stop();
writeFileSync(new URL('../public/memory-review-fixtures.json',import.meta.url),JSON.stringify({schema:'deskbot.memory-review.v1',description:'独立七天任务回放；只开放喵呜自主安排，测试模型选择有限候选。包含真实规则下的旅行、完成结果与 SQLite 等价存储重载；不调用 DeepSeek，不读写正式存档，不冒充真实经过七天。',frames,outcomes},null,2));
console.log(JSON.stringify({frames:Object.keys(frames),completed_tasks:outcomes.length,interest:world.get().memory.actors['shaping-001'].interests.explore,production_writes:0}));
