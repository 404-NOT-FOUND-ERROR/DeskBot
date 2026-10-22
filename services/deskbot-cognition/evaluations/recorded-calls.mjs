// Responses and local admission refusals are separate trace events. No replay fallback.
import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const reject=code=>Object.assign(Error(code),{code});
export function recordedCalls({directory,mode,complete}){
 const stats={hits:0,terminal_hits:0,provider_returns:0};
 const write=(path,value)=>{writeFileSync(path+'.tmp',gzipSync(JSON.stringify(value)));renameSync(path+'.tmp',path);};
 return {stats,async call(id,request){
  const path=join(directory,hash(id)+'.json.gz'),fingerprint=hash(request);
  if(existsSync(path)){
   const event=JSON.parse(gunzipSync(readFileSync(path)));
   if(event.id!==id||event.fingerprint!==fingerprint)throw reject('replay_request_mismatch');
   if(event.terminal){stats.terminal_hits++;throw reject(event.terminal.code);}
   stats.hits++;return event.response;
  }
  if(mode!=='real')throw reject('replay_cache_missing');
  let response;
  try{response=await complete(id,request);}catch(e){
   // A refusal before provider admission has no billable response to manufacture.
   if(['call_limit_reached','budget_exhausted'].includes(e.code))write(path,{id,fingerprint,request,terminal:{code:e.code,kind:'admission_refused'}});
   throw e;
  }
  stats.provider_returns++;write(path,{id,fingerprint,request,response});return response;
 }};
}
