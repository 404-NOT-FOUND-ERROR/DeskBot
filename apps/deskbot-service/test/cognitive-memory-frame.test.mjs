import test from 'node:test';
import assert from 'node:assert/strict';
import {cognitiveMemoryFrame} from '../src/cognitive-memory-frame.mjs';

test('memory describes the actual task interval, preserving small declines hidden by two-decimal rounding',()=>{
 const before={mode:'open',brightness:.790520866666,charge:.795999999999};
 const settled={mode:'open',brightness:.783841,charge:.789333333333};
 const after={mode:'hooded',brightness:.48597727288,charge:.789333333333};
 const result={success:true,root_outcome_id:'task:shade',occurred_at:'2026-10-20T14:16:00Z',effects:{verified_title:'装罩'},
  before:[{id:'lamp',state:{waylight:before}}],after:[{id:'lamp',state:{waylight:after}}]};
 const task={target_object_id:'lamp',completion:{result:{before:{waylight:settled},after:{waylight:after}}}};
 const fact=cognitiveMemoryFrame(result,task).facts.find(f=>f.id==='lamp').text;
 assert.match(fact,/任务开始至结束（含自然时间）/);
 assert.match(fact,/蓄光0\.796→0\.789333（下降0\.006667）/);
 assert.doesNotMatch(fact,/记录值相同/);
 assert.match(fact,/不能仅凭这些差值归因/);
 const legacy=cognitiveMemoryFrame({...result,before:[],after:[]},task).facts.find(f=>f.id==='lamp').text;
 assert.match(legacy,/完成结算瞬间（不是整段任务）/);
 assert.match(legacy,/蓄光0\.789333→0\.789333（记录值相同）/);
});
