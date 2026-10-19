import {existsSync,realpathSync,statSync} from 'node:fs';
import {resolve,dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const identity=path=>{
 const absolute=resolve(path);
 if(existsSync(absolute))return realpathSync.native(absolute).toLowerCase();
 const parent=dirname(absolute);return (existsSync(parent)?join(realpathSync.native(parent),basename(absolute)):absolute).toLowerCase();
};
export function assertDistinctStores(paths) {
 const entries=Object.entries(paths).filter(([,p])=>p&&p!==':memory:');
 for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
  const [a,x]=entries[i],[b,y]=entries[j];
  const sameFile=existsSync(x)&&existsSync(y)&&(()=>{const sx=statSync(x),sy=statSync(y);return sx.ino!==0&&sx.ino===sy.ino&&sx.dev===sy.dev;})();
  if(identity(x)===identity(y)||sameFile)fail('runtime_store_collision',`${a} 与 ${b} 不能共用一个存档。`);
 }
}
export function resolveRuntimeProfile({env=process.env,defaultDatabase}={}) {
 const scope=env.DESKBOT_RUN_SCOPE??'live';
 if(!['live','lab'].includes(scope))fail('runtime_scope_invalid','DESKBOT_RUN_SCOPE must be live or lab');
 const database=env.DESKBOT_DB_PATH?resolve(env.DESKBOT_DB_PATH):resolve(defaultDatabase);
 if(scope==='lab'){
  if(!env.DESKBOT_DB_PATH)fail('lab_database_required','隔离运行必须指定独立的 DESKBOT_DB_PATH。');
  assertDistinctStores({live:defaultDatabase,lab:database});
 }
 return {schema:'deskbot.runtime-profile.v1',scope,run_id:`${scope}:${randomUUID()}`,database,clock_scope:scope==='live'?'real_time':'isolated_clock',started_at:new Date().toISOString()};
}
export function bindRuntimeStore(persistence,{scope,kind='world',allowLegacy=false}={}) {
 if(!['live','lab'].includes(scope))fail('runtime_scope_invalid','存档范围无效。');
 const prior=persistence.get('runtime-profile','binding');
 if(prior&&(prior.scope!==scope||prior.kind!==kind))fail('runtime_store_scope_mismatch','存档已绑定其他运行范围，不能混用。');
 if(!prior&&!allowLegacy&&(persistence.count?.('canonical-world.states')??persistence.list('canonical-world.states').length)>0)
  fail('runtime_unclassified_save','已有世界尚未标注来源，不能自动当作隔离实验存档。');
 const binding=prior??{schema:'deskbot.store-binding.v1',scope,kind,bound_at:new Date().toISOString(),legacy_adopted:allowLegacy};
 if(!prior)persistence.put('runtime-profile','binding',binding);
 return binding;
}
