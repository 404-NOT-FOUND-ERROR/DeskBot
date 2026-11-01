import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
const sha=value=>createHash('sha256').update(value).digest('hex');
// Text source + versioned content only. No runtime databases, secret configuration,
// downloaded assets, raw model outputs or copies of the formal life are captured.
export function baselineSource(path){
  return /\.(?:mjs|cjs|js|ts|tsx|py|json|ya?ml|ps1|txt|md)$/.test(path)
    && !/(?:^|\/)(?:data|runtime|node_modules|dist|dist-server|__pycache__|\.venv)\//.test(path)
    && !/(?:llm_config\.json|body_devices\.json|credentials|secrets|\.env)/i.test(path)
    && (!path.startsWith('config/')||path.includes('example')||path==='config/README.md');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const paths=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(baselineSource))].sort();
  const files=paths.map(path=>{try{const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:sha(bytes)};}
    catch(error){if(error.code==='ENOENT')return {path,deleted:true};throw error;}});
  const report={schema:'deskbot.source-baseline.v1',captured_at:new Date().toISOString(),git_head:git(['rev-parse','HEAD']).trim(),
    working_tree_dirty:Boolean(git(['status','--porcelain']).trim()),fingerprint:sha(JSON.stringify(files)),node:process.version,files,
    scope:'Text source, contracts and versioned content; excludes runtime, secrets and binary art. Hash inventory, not a recovery archive.'};
  const outputIndex=process.argv.indexOf('--output');
  if(outputIndex!==-1){
    const output=process.argv[outputIndex+1];if(!output)throw Error('missing_output_path');
    writeFileSync(resolve(output),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({fingerprint:report.fingerprint,files:files.length,output:resolve(output),working_tree_dirty:report.working_tree_dirty}));
  }else console.log(JSON.stringify(report,null,2));
}
