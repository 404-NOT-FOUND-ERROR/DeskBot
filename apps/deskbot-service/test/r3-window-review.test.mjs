import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {awaitWindowReview,validateWindowReview} from '../../../services/deskbot-cognition/evaluations/r3-window-review.mjs';
const checkpoint={version:'frozen',key:'cognition:case',turn:1,record_hash:'exact'};
const review={schema:'deskbot.r3-window-review.v1',...checkpoint,decision:'continue',valid:true,critical_errors:[],note:'Actual result and future step agree.'};

test('window review binds the exact frozen case, turn and result; critical errors cannot continue',()=>{
 assert.deepEqual(validateWindowReview(checkpoint,review),review);
 for(const changed of [{version:'other'},{key:'other'},{turn:2},{record_hash:'other'},{valid:'yes'},{note:''},{critical_errors:['invented delivery']}])
  assert.throws(()=>validateWindowReview(checkpoint,{...review,...changed}));
 assert.equal(validateWindowReview(checkpoint,{...review,decision:'stop',valid:false,critical_errors:['invented delivery']}).decision,'stop');
});

test('paid runner checkpoint waits locally and cannot reuse or overwrite a prior review',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'r3-review-')),record={turn:1,actual_result:{success:true}};let response;
 try{
  const result=await awaitWindowReview({directory,version:'frozen',key:'cognition:case',record,pollMs:1,timeoutMs:2000,
   notify:line=>{const m=JSON.parse(line);assert.ok(existsSync(m.request));response=m.response;
    setTimeout(()=>{writeFileSync(response+'.tmp',JSON.stringify({...review,record_hash:m.record_hash}));renameSync(response+'.tmp',response);},5);}});
  assert.equal(result.decision,'continue');assert.deepEqual(record,{turn:1,actual_result:{success:true}});
  await assert.rejects(awaitWindowReview({directory,version:'frozen',key:'cognition:case',record,notify:()=>{}}),{code:'window_review_already_exists'});
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('a missing review times out without a provider call or fabricated acceptance',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'r3-review-timeout-'));
 try{await assert.rejects(awaitWindowReview({directory,version:'frozen',key:'case',record:{turn:1},timeoutMs:2,pollMs:1,notify:()=>{}}),{code:'window_review_timeout'});}
 finally{rmSync(directory,{recursive:true,force:true});}
});
