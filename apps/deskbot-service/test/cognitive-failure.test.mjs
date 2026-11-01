import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cognitiveFailure,validCognitiveFailure} from '../src/cognitive-failure.mjs';
import {createCognitionBridge,findCognitionPython} from '../src/cognition-bridge.mjs';

test('Node and Python classify identical known, wrapped and unknown diagnostics',()=>{
  const cases=[['python_session_failed',{cause_code:'upstream_decision_failed',phase:'plan',stage:'decision_repair'}],
    ['budget_exhausted',{phase:'feedback'}],['semantic_contract_rejected_after_retry',{stage:'followup_repair'}],
    ['cognitive_context_changed',{retryable:true}],['future_error',{}],['message with private content\nnot a code',{}]];
  const result=spawnSync(findCognitionPython(),['-c','import json,sys; from failure_contract import cognitive_failure; print(json.dumps([cognitive_failure(c, **k) for c,k in json.load(sys.stdin)]))'],
    {cwd:fileURLToPath(new URL('../../../services/deskbot-cognition/',import.meta.url)),input:JSON.stringify(cases),encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),cases.map(([code,meta])=>cognitiveFailure(code,meta)));
});

test('diagnostic shape cannot silently acquire authority or copy free-form context',()=>{
  const valid=cognitiveFailure('upstream_decision_failed',{actor_id:'a',stage:'decision',retryable:false});
  assert.ok(validCognitiveFailure(valid));assert.equal(valid.layer,'decision');
  for(const patch of [{record_as_experience:true},{layer:'contract'},{raw_prompt:'private'},{retryable:'yes'}])
    assert.equal(validCognitiveFailure({...valid,...patch}),false);
  assert.equal(cognitiveFailure('unknown_failure',{cause_code:'it was definitely a model error'}).layer,'unknown');
});

test('actual Python error frame retains its cause without a provider call',async t=>{
  const bridge=createCognitionBridge({workerFile:'life_worker.py',mode:'mock',timeoutMs:15000});t.after(()=>bridge.close());
  let calls=0;
  await assert.rejects(bridge.session({schema:'unsupported',phase:'plan',actor:{actor_id:'shaping-001'}},()=>{calls++;throw Error('must not call');}),e=>{
    assert.equal(e.code,'python_session_failed');assert.equal(e.failure.cause_code,'invalid_context_version');
    assert.equal(e.failure.layer,'contract');assert.equal(e.failure.phase,'plan');assert.equal(e.failure.record_as_experience,false);return true;
  });assert.equal(calls,0);
});
