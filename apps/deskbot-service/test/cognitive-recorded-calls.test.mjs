import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {recordedCalls} from '../../../services/deskbot-cognition/evaluations/recorded-calls.mjs';
function temporary(t){const base=resolve(tmpdir()),p=mkdtempSync(join(base,'deskbot-call-'));assert.equal(dirname(p),base);t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
test('admission refusal replays the same stop after cached responses, without calling the provider',async t=>{
 const directory=temporary(t);let calls=0;
 const real=recordedCalls({directory,mode:'real',complete:async()=>{if(++calls===2)throw Object.assign(Error('limit'),{code:'call_limit_reached'});return {content:'fictional response'};}});
 assert.deepEqual(await real.call('one',{messages:[]}),{content:'fictional response'});
 await assert.rejects(real.call('two',{messages:[]}),{code:'call_limit_reached'});
 const replay=recordedCalls({directory,mode:'replay',complete:()=>{throw Error('must not connect');}});
 assert.deepEqual(await replay.call('one',{messages:[]}),{content:'fictional response'});
 await assert.rejects(replay.call('two',{messages:[]}),{code:'call_limit_reached'});
 assert.deepEqual(replay.stats,{hits:1,terminal_hits:1,provider_returns:0});
 await assert.rejects(replay.call('two',{messages:['changed']}),{code:'replay_request_mismatch'});
 await assert.rejects(replay.call('missing',{}),{code:'replay_cache_missing'});
});

test('provider failure is preserved and replay stops with the same diagnostic without retrying',async t=>{
 const directory=temporary(t);let calls=0;
 const real=recordedCalls({directory,mode:'real',complete:async()=>{calls++;throw Object.assign(Error('DeepSeek HTTP 400: invalid format'),{code:'provider_http_error'});}});
 const expected={code:'provider_http_error',message:'DeepSeek HTTP 400: invalid format'};
 await assert.rejects(real.call('failed',{messages:[]}),expected);
 await assert.rejects(real.call('failed',{messages:[]}),expected);
 assert.equal(calls,1);
 const replay=recordedCalls({directory,mode:'replay',complete:()=>{throw Error('must not connect');}});
 await assert.rejects(replay.call('failed',{messages:[]}),expected);
 assert.deepEqual(replay.stats,{hits:0,terminal_hits:1,provider_returns:0});
 const malformed=recordedCalls({directory,mode:'real',complete:async()=>{throw new SyntaxError('Malformed provider JSON');}});
 await assert.rejects(malformed.call('malformed',{}),{message:'Malformed provider JSON'});
 await assert.rejects(replay.call('malformed',{}),e=>(e.code??e.message)==='Malformed provider JSON');
});
