import test from 'node:test';
import assert from 'node:assert/strict';
import {createModelUsage} from '../src/model-usage.mjs';
import {createOpenAiCompatibleLlm} from '../src/llm.mjs';
import {createCognitiveBudget} from '../src/cognitive-budget.mjs';
const usage={prompt_tokens:100,completion_tokens:10,prompt_cache_hit_tokens:50};
test('each retry retains its provider usage even when the returned text is empty',async()=>{
 const ledger=createModelUsage();let n=0;
 const llm=createOpenAiCompatibleLlm({base_url:'https://api.deepseek.com',api_key:'test-secret',model:'deepseek-flash',onUsage:ledger.record,
  fetchImpl:async()=>({ok:true,json:async()=>({usage,choices:[{message:{content:++n===1?'':'完成'},finish_reason:'stop'}]})})});
 await llm.complete({prompt:'fictional prompt',purpose:'news_translation'});
 const report=ledger.status();assert.equal(report.totals.attempts,2);assert.equal(report.totals.input_tokens,200);assert.equal(report.totals.usage_unknown,0);
 assert.equal(report.recent[0].status,'failed');assert.equal(report.recent[1].attempt,2);assert.equal(report.categories.news_translation.attempts,2);
 assert.doesNotMatch(JSON.stringify(report),/fictional prompt|test-secret|完成/);
});
test('unknown transport usage is not reported as a free successful call',async()=>{
 const ledger=createModelUsage();const llm=createOpenAiCompatibleLlm({base_url:'https://api.deepseek.com',api_key:'test',model:'deepseek-flash',onUsage:ledger.record,
  fetchImpl:async()=>{throw Error('offline')}});
 await assert.rejects(llm.complete({prompt:'JSON',purpose:'life_choice'}),{code:'llm_transport_error'});
 const report=ledger.status();assert.equal(report.totals.attempts,1);assert.equal(report.totals.usage_unknown,1);assert.equal(report.recent[0].estimated_upper_cny,null);
});
test('updating an attempt is idempotent and drops extra payload fields',()=>{
 const ledger=createModelUsage();ledger.record({call_id:'one',category:'cognition.plan',status:'calling',prompt:'private',model:'deepseek-flash'});
 ledger.record({call_id:'one',status:'completed',usage,answer:'private'});ledger.record({call_id:'one',status:'completed',usage});
 assert.equal(ledger.status().totals.attempts,1);assert.doesNotMatch(JSON.stringify(ledger.status()),/private/);
});
test('the cognitive broker records actual usage in the same classifier before replaying a call',async()=>{
 const ledger=createModelUsage(),store=new Map(),persistence={get:(ns,id)=>store.get(`${ns}/${id}`),put:(ns,id,value)=>store.set(`${ns}/${id}`,structuredClone(value)),list:ns=>[...store].filter(([k])=>k.startsWith(ns+'/')).map(([,v])=>v)};
 const broker=createCognitiveBudget({persistence,onUsage:ledger.record,testProvider:async()=>({usage,choices:[{message:{content:'{}'},finish_reason:'stop'}]})});
 const request={messages:[{role:'user',content:'JSON'}],json_mode:true,phase:'interpret',usage_scope:'isolated_test_clock'};
 await broker.complete('cognition-one',request);await broker.complete('cognition-one',request);await broker.close();
 assert.equal(ledger.status().totals.attempts,1);assert.equal(ledger.status().totals.input_tokens,100);assert.equal(ledger.status().categories['cognition.interpret'].attempts,1);
});
