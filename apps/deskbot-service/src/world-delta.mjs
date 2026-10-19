import {createHash} from 'node:crypto';

export const DELTA_SCHEMA = 'deskbot.world-delta.v1';
const copy = value => value === undefined ? undefined : structuredClone(value);
// Hash the JSON representation that can actually survive SQLite/restart.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(v => canonicalJson(v) ?? 'null').join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => value[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const worldHash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
// Compare the persistable JSON structure without repeatedly serializing entire
// unchanged subtrees at every diff depth. Canonical hashes stay byte-compatible.
const equal = (a,b) => {
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object')return JSON.stringify(a)===JSON.stringify(b);
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v??null,b[i]??null));
  const ak=Object.keys(a).filter(k=>a[k]!==undefined),bk=Object.keys(b).filter(k=>b[k]!==undefined);
  return ak.length===bk.length&&ak.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
};
const segment = key => String(key).replaceAll('~','~0').replaceAll('/','~1');
const idFields = ['task_id','npc_id','event_id','record_id','id','object_id','location_id','plan_id'];

/** JSON-pointer deltas; stable-ID arrays retain unchanged entries even when
 * their order changes. No repeated full task/history array on each tick. */
export function diffWorld(before, after, path = '') {
  if (equal(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    const key = idFields.find(k => [...before,...after].every(v => v && typeof v === 'object' && typeof v[k] === 'string')
      && new Set(before.map(v=>v[k])).size===before.length && new Set(after.map(v=>v[k])).size===after.length);
    if (key && before.length && after.length) {
      const old = new Map(before.map(v=>[v[key],v])), next = new Map(after.map(v=>[v[key],v]));
      const updates = after.filter(v=>old.has(v[key])).flatMap(v=>{
        const changes=diffWorld(old.get(v[key]),v);return changes.length?[{id:v[key],changes}]:[];
      });
      return [{op:'keyed_array',field_path:path,key,
        removed:before.filter(v=>!next.has(v[key])).map(v=>v[key]),
        added:after.filter(v=>!old.has(v[key])).map(copy),updates,
        ...(!equal(before.map(v=>v[key]),after.map(v=>v[key]))?{order:after.map(v=>v[key])}:{})}];
    }
    let start=0,end=0;
    while(start<Math.min(before.length,after.length)&&equal(before[start],after[start]))start++;
    while(end<Math.min(before.length,after.length)-start&&equal(before[before.length-1-end],after[after.length-1-end]))end++;
    return [{op:'splice',field_path:path,index:start,delete_count:before.length-start-end,values:after.slice(start,after.length-end).map(copy)}];
  }
  if (before && after && typeof before==='object' && typeof after==='object' && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before),...Object.keys(after)])].sort().flatMap(k=>diffWorld(before[k],after[k],`${path}/${segment(k)}`));
  }
  return [{op:after===undefined?'remove':'set',field_path:path,old_value:copy(before),new_value:copy(after)}];
}

function invalid(message) { throw Object.assign(new Error(message),{code:'invalid_world_delta',statusCode:409}); }
function keys(path) {
  if(path==='')return [];
  if(typeof path!=='string'||!path.startsWith('/')||/~(?![01])/u.test(path))invalid('invalid JSON pointer');
  return path.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~'));
}
function applyChanges(value, changes) {
  let root=value;
  for(const change of changes) {
    const parts=keys(change.field_path),last=parts.pop();let parent=root;
    for(const key of parts) {if(!parent||typeof parent!=='object'||!Object.hasOwn(parent,key))invalid('delta path is absent');parent=parent[key];}
    const current=last===undefined?root:parent?.[last];let replacement;
    if(change.op==='set')replacement=copy(change.new_value);
    else if(change.op==='remove') {
      if(last===undefined)invalid('cannot remove world root');
      if(!parent||!Object.hasOwn(parent,last))invalid('remove path is absent');
      delete parent[last];continue;
    } else if(change.op==='splice') {
      if(!Array.isArray(current)||!Number.isSafeInteger(change.index)||!Number.isSafeInteger(change.delete_count)||change.index<0||change.delete_count<0||change.index+change.delete_count>current.length||!Array.isArray(change.values))invalid('invalid array splice');
      current.splice(change.index,change.delete_count,...copy(change.values));continue;
    } else if(change.op==='keyed_array') {
      if(!Array.isArray(current)||!idFields.includes(change.key))invalid('invalid keyed array');
      const entries=new Map(current.map(v=>[v[change.key],v]));
      if(entries.size!==current.length)invalid('duplicate array identity');
      for(const id of change.removed){if(!entries.delete(id))invalid('missing removed identity');}
      for(const item of change.added){if(entries.has(item[change.key]))invalid('duplicate inserted identity');entries.set(item[change.key],copy(item));}
      for(const update of change.updates){if(!entries.has(update.id))invalid('missing updated identity');const updated=applyChanges(entries.get(update.id),update.changes);if(updated[change.key]!==update.id)invalid('changed array identity');entries.set(update.id,updated);}
      const order=change.order??[...entries.keys()];
      if(order.length!==entries.size||new Set(order).size!==order.length||order.some(id=>!entries.has(id)))invalid('invalid array order');
      replacement=order.map(id=>entries.get(id));
    } else invalid('unsupported delta operation');
    if(last===undefined)root=replacement;
    else {if(!parent||typeof parent!=='object')invalid('delta parent is absent');Object.defineProperty(parent,last,{value:replacement,enumerable:true,writable:true,configurable:true});}
  }
  return root;
}

export function applyWorldDelta(before, mutation) {
  if(mutation.replay?.schema!==DELTA_SCHEMA)invalid('this historical record has no replay delta');
  if(worldHash(before)!==mutation.replay.before_hash)invalid('world before-hash does not match');
  const after=applyChanges(JSON.parse(JSON.stringify(before)),mutation.changes);
  if(worldHash(after)!==mutation.replay.after_hash)invalid('world after-hash does not match');
  return after;
}
