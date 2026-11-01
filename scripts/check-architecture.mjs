import {readFileSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
export function checkArchitecture(register,root=repositoryRoot){
  const errors=[];
  const check=(condition,message)=>{if(!condition)errors.push(message);};
  const source=(path,label)=>{
    if(typeof path!=='string'||!path||isAbsolute(path)||path.includes('\\')){errors.push(`${label}: use a repository-relative path`);return '';}
    const full=resolve(root,path),rel=relative(root,full);
    if(rel.startsWith('..')||isAbsolute(rel)){errors.push(`${label}: path escapes repository`);return '';}
    try{if(!statSync(full).isFile())throw Error();return readFileSync(full,'utf8');}
    catch{errors.push(`${label}: missing file ${path}`);return '';}
  };
  check(register.schema==='deskbot.architecture-register.v1','unknown register version');
  source(register.baseline,'baseline');
  const modules=new Map(),contracts=new Set();
  for(const item of register.modules??[]){
    check(typeof item.id==='string'&&!modules.has(item.id),`duplicate or missing module ${item.id}`);
    modules.set(item.id,item);
    check(['input_status','authored_definition','proposal','command','world_reducer','canonical_commit','projection'].includes(item.authority),`unknown authority ${item.id}`);
    const text=source(item.entry,`module ${item.id}`);
    check(typeof item.anchor==='string'&&item.anchor.length>0&&text.includes(item.anchor),`missing entry anchor ${item.id}`);
  }
  const owners=[...modules.values()].filter(m=>m.authority==='canonical_commit');
  check(owners.length===1&&owners[0]?.id===register.canonical_committer&&owners[0]?.entry==='apps/deskbot-service/src/persistent-world.mjs',
    'canonical commit must remain exclusively at persistent-world');
  for(const item of register.interfaces??[]){
    check(typeof item.id==='string'&&!contracts.has(item.id),`duplicate or missing interface ${item.id}`);contracts.add(item.id);
    check(modules.has(item.producer),`unknown producer ${item.id}`);
    check(Array.isArray(item.consumers)&&item.consumers.length>0&&item.consumers.every(c=>modules.has(c)),`unknown or empty consumer ${item.id}`);
    const definition=source(item.definition,`interface ${item.id}`);
    check(typeof item.version==='string'&&item.version.length>0&&definition.includes(item.version),`missing version anchor ${item.id}`);
    check(['handwritten','shared'].includes(item.coverage),`invalid coverage ${item.id}`);
    check(Array.isArray(item.evidence)&&item.evidence.length>0,`missing evidence ${item.id}`);
    for(const file of item.evidence??[])source(file,`evidence ${item.id}`);
  }
  check(modules.size>0&&contracts.size>0,'empty architecture register');
  return {ok:errors.length===0,modules:modules.size,interfaces:contracts.size,errors,
    note:'Checks registered references and declared ownership; not proof of all runtime side effects or life quality.'};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=checkArchitecture(JSON.parse(readFileSync(resolve(repositoryRoot,'contracts/architecture.v1.json'),'utf8')));
  console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
}
