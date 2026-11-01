// Allowlisted executable sources only. Never snapshot config, saves or credentials.
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const roots=['apps/deskbot-service/src','contracts','services/deskbot-cognition','world-content'];
export function experimentSources(base){
 const files=[];
 function walk(dir){
  for(const entry of readdirSync(join(base,dir),{withFileTypes:true})){
   if(entry.isSymbolicLink())throw Error('experiment_source_symlink');
   if(['__pycache__','node_modules','.git'].includes(entry.name))continue;
   const path=dir+'/'+entry.name;
   if(entry.isDirectory())walk(path);
   else if(/\.(mjs|py|json)$/.test(entry.name))files.push(path);
  }
 }
 roots.forEach(walk);
 files.push('research/design/a32-refrozen-acceptance-2026-11-01.md');
 return Object.fromEntries(files.sort().map(path=>[path,readFileSync(join(base,path),'utf8')]));
}
export function experimentVersion(sources,settings){
 return createHash('sha256').update(JSON.stringify({sources,settings})).digest('hex').slice(0,12);
}
