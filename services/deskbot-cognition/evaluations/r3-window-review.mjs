// Experiment-only review checkpoint. It cannot alter the world or call a provider.
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{code});};

export function validateWindowReview(checkpoint,review){
 if(!review||review.schema!=='deskbot.r3-window-review.v1'
  ||review.version!==checkpoint.version||review.key!==checkpoint.key||review.turn!==checkpoint.turn
  ||review.record_hash!==checkpoint.record_hash||!['continue','stop'].includes(review.decision)
  ||typeof review.valid!=='boolean'||typeof review.note!=='string'||!review.note.trim()||review.note.length>2000
  ||!Array.isArray(review.critical_errors)||review.critical_errors.length>20
  ||review.critical_errors.some(s=>typeof s!=='string'||!s.trim()||s.length>1000))fail('window_review_invalid');
 if(review.critical_errors.length&&(review.decision!=='stop'||review.valid))fail('window_review_critical_must_stop');
 return structuredClone(review);
}

export async function awaitWindowReview({directory,version,key,record,timeoutMs=900000,pollMs=500,notify=console.log}){
 mkdirSync(directory,{recursive:true});
 const checkpoint={schema:'deskbot.r3-window-checkpoint.v1',version,key,turn:record.turn,record_hash:hash(record),record};
 const stem=hash([version,key,record.turn]).slice(0,24),request=join(directory,stem+'.request.json.gz'),response=join(directory,stem+'.decision.json');
 // A prior checkpoint is evidence. Never overwrite it or silently reuse approval.
 if(existsSync(request)||existsSync(response))fail('window_review_already_exists');
 writeFileSync(request,gzipSync(JSON.stringify(checkpoint)),{flag:'wx'});
 notify(JSON.stringify({review_required:true,version,key,turn:record.turn,request,response,record_hash:checkpoint.record_hash}));
 const start=performance.now();
 while(!existsSync(response)){
  if(performance.now()-start>=timeoutMs)fail('window_review_timeout');
  await new Promise(resolve=>setTimeout(resolve,pollMs));
 }
 return validateWindowReview(checkpoint,JSON.parse(readFileSync(response,'utf8')));
}
