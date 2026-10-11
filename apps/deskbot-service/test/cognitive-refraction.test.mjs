import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretationWindow,adoptInterpretations} from '../src/cognitive-refraction.mjs';
import {cognitiveInputs} from '../src/cognitive-continuity.mjs';
import {createCognitiveBudget} from '../src/cognitive-budget.mjs';
import {caseSource,cognitiveSourceCases} from './fixtures/cognitive-source-cases.mjs';
const at='2026-10-11T02:00:00.000Z',source=caseSource(cognitiveSourceCases[0],at);
const meaning={source_id:source.id,kind:'report',stance:'uncertain',effect:'inquiry',topic:'光照与苔',question:'能否先观察苗况？',reason:'需要在当地验证',evidence_quote:'光照改变',target_object_ids:['garden-bed'],confidence:.8};
function references(){return {objects:['garden-bed'],interpretation_pending:interpretationWindow([source],{},'garden').pending};}

test('same source/location is interpreted once, moving or changed content invalidates the semantic cache',()=>{
 const life={};adoptInterpretations(life,[meaning],references(),at);
 assert.equal(interpretationWindow([source],life,'garden').pending.length,0);
 assert.equal(interpretationWindow([source],life,'waterside').pending.length,1);
 assert.equal(interpretationWindow([{...source,content:'更正了来源内容'}],life,'garden').pending.length,1);
 assert.equal(life.interpretations[0].authority,'opportunity_only');
});
test('interpretation requires exact attributable evidence and a currently visible target',()=>{
 for(const [change,code] of [[{source_id:'private-unseen'},'refraction_source_invalid'],[{evidence_quote:'已经丰收'},'refraction_evidence_invalid'],[{target_object_ids:['private-room']},'refraction_target_invalid'],[{inventory:{moss:99}},'refraction_field_forbidden']])
  assert.throws(()=>adoptInterpretations({},[{...meaning,...change}],references(),at),{code});
});
test('negation and quotations cannot become imperative opportunities',()=>{
 for(const change of [{stance:'negated'},{stance:'quoted'},{kind:'noise'},{kind:'quotation'}])assert.throws(()=>adoptInterpretations({},[{...meaning,...change}],references(),at),{code:'refraction_nonassertion_has_effect'});
});
test('a report cannot become authority over conditions, and a feed cannot create an invitation',()=>{
 assert.throws(()=>adoptInterpretations({},[{...meaning,effect:'condition'}],references(),at),{code:'refraction_condition_authority'});
 assert.throws(()=>adoptInterpretations({},[{...meaning,kind:'invitation',effect:'offer'}],references(),at),{code:'refraction_invitation_authority'});
});
test('late or duplicate interpretation is rejected without partial commit',()=>{
 assert.throws(()=>adoptInterpretations({},[meaning],references(),'2026-10-12T03:00:00Z'),{code:'cognitive_source_expired'});
 const life={};assert.throws(()=>adoptInterpretations(life,[meaning,meaning],references(),at),{code:'refraction_source_invalid'});assert.equal(life.interpretations,undefined);
});
test('expired, future, spoofed and rejected body observations never reach the cognitive source queue',()=>{
 const record={id:'one',category:'external',text:'苗圃消息',attested:true,freshness:'fresh',status:'observed',received_at:at,expires_at:'2026-10-12T02:00:00Z'};
 const world={protagonist:{character_id:'p'},refraction:{records:[record,{...record,id:'old',expires_at:at},{...record,id:'future',received_at:'2026-10-13T00:00:00Z'},{...record,id:'spoof',attested:false},{...record,id:'body',category:'body',status:'record_only'}]}};
 assert.deepEqual(cognitiveInputs(world,'p',at).map(s=>s.id),['one']);assert.deepEqual(cognitiveInputs(world,'other',at),[]);
});
test('unlimited authorization uses its own ledger and does not rewrite the old two-yuan approval',async()=>{
 const store=new Map(),persistence={get:(ns,id)=>store.get(`${ns}/${id}`),put:(ns,id,value)=>store.set(`${ns}/${id}`,structuredClone(value)),list:ns=>[...store].filter(([k])=>k.startsWith(ns+'/')).map(([,v])=>v)};
 const original=createCognitiveBudget({persistence});
 assert.throws(()=>createCognitiveBudget({persistence,limitCny:null}),{code:'unlimited_authorization_required'});
 const later=createCognitiveBudget({persistence,namespace:'cognition-stage3-5',approvalId:'stages3-5',approvalSource:'human:不限制金额，节省着用就行',scope:'isolated fictional inputs only',limitCny:null,maxCalls:null});
 assert.equal(original.status().approval.limit_cny,2);assert.equal(later.status().remaining_cny,null);
 await Promise.all([original.close(),later.close()]);
});
