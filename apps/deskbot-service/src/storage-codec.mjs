import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// A storage envelope, independent of canonical world/delta schemas and hashes.
// Scalar metadata remains queryable without inflating an entire checkpoint.
const MARKER='_deskbot_storage';
const CODEC='gzip-json.v1';
const MAX_BYTES=64*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const corrupt=()=>{throw Object.assign(new Error('存档压缩记录校验失败。'),{code:'history_corrupt',statusCode:409});};
export function encodeRecord(namespace,value){
  const json=JSON.stringify(value);
  if(namespace!=='canonical-world.checkpoints'||Buffer.byteLength(json)<4096)return json;
  if(Object.hasOwn(value,MARKER))throw new Error('Reserved storage envelope field');
  const raw=Buffer.from(json);
  // A large, valid future world stays readable as legacy JSON instead of writing
  // an envelope our bounded decoder cannot read.
  if(raw.length>MAX_BYTES)return json;
  const data=gzipSync(raw,{level:3}).toString('base64');
  const metadata=Object.fromEntries(Object.entries(value).filter(([,v])=>v===null||['string','number','boolean'].includes(typeof v)));
  const encoded=JSON.stringify({...metadata,[MARKER]:{codec:CODEC,bytes:raw.length,sha256:digest(raw),data}});
  return Buffer.byteLength(encoded)<raw.length?encoded:json;
}
export function decodeRecord(json){
  const envelope=JSON.parse(json),packed=envelope?.[MARKER];
  if(!packed)return envelope; // Existing uncompressed records remain readable.
  try {
    if(packed.codec!==CODEC||!Number.isSafeInteger(packed.bytes)||packed.bytes<0||packed.bytes>MAX_BYTES||typeof packed.data!=='string')corrupt();
    const raw=gunzipSync(Buffer.from(packed.data,'base64'),{maxOutputLength:Math.max(1,packed.bytes)});
    if(raw.length!==packed.bytes||digest(raw)!==packed.sha256)corrupt();
    const value=JSON.parse(raw.toString('utf8'));
    if(Object.hasOwn(value,MARKER))corrupt();
    for(const [key,scalar]of Object.entries(envelope))if(key!==MARKER&&value[key]!==scalar)corrupt();
    return value;
  }catch{corrupt();}
}
