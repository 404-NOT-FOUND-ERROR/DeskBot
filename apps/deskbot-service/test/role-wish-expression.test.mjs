import test from 'node:test';
import assert from 'node:assert/strict';
import {modelRoleWishContext} from '../src/prompt-composer.mjs';

test('a long preparation remains visible beside recent responses on the other axis',()=>{
  const form={origin:'lived_wish',direction_id:'wetland_frog',axis:'form',status:'prepared',
    wish_basis:{active_days:['2026-10-01','2026-10-02','2026-10-03'],active_contexts:['a','b'],counts:{practice_successes:2}},
    current_gate:{eligible:true},authored_reason:'PRIVATE_HISTORY_MUST_NOT_BECOME_PROMPT'};
  const history=Array.from({length:12},(_,index)=>({origin:'lived_wish',direction_id:'chef',axis:'vocation',status:index%2?'deferred':'rejected',
    wish_basis:{counts:{practice_successes:3}},current_gate:{eligible:false}}));
  const input=[form,...history],before=structuredClone(input),context=modelRoleWishContext(input);
  assert.equal(context.length,8);
  assert.ok(context.some(item=>item.axis==='form'&&item.status==='prepared'));
  assert.ok(context.every(item=>item.changes_identity===false&&item.changes_appearance===false));
  assert.equal(JSON.stringify(context).includes('PRIVATE_HISTORY_MUST_NOT_BECOME_PROMPT'),false);
  assert.deepEqual(input,before);
});
