// Raw personal memory is immutable and stored once. The index is derived;
// snapshots retain a bounded working set and independent execution/contract state.
export const MEMORY_HOT_LIMIT=128;
export const MEMORY_HOT_CHARS=192000;
const copy=structuredClone;
export const memoryNamespace=(worldId,actorId)=>`cognitive-memory:${worldId}:${actorId}`;
const immutable=m=>JSON.stringify({id:m.id,root_outcome_id:m.root_outcome_id,source_record_id:m.source_record_id,
  payload:{agent_id:m.payload.agent_id,stream:m.payload.stream,kind:m.payload.kind,raw_content:m.payload.raw_content,stored_content:m.payload.stored_content,source_ids:m.payload.source_ids}});
function bounded(all){
  const out=[];let size=0;
  for(const m of [...all].reverse()){
    const n=JSON.stringify(m).length;if(out.length>=MEMORY_HOT_LIMIT||size+n>MEMORY_HOT_CHARS)continue;
    out.push(m);size+=n;
  }return out.reverse();
}
export function prepareCognitiveArchive(world,{enabled=true}={}){
  const entries=[];if(!enabled)return entries;
  for(const [id,life] of Object.entries(world.cognition?.actors??{})){
    for(const memory of life.memories??[])entries.push({namespace:memoryNamespace(world.world_id,id),memory:copy(memory)});
    life.memories=bounded(life.memories??[]);
    life.memory_archive={schema:'deskbot.cognitive-memory-archive.v1',hot:life.memories.length,originals_retained:true};
  }return entries;
}
export function persistCognitiveArchive(store,entries){
  for(const {namespace,memory} of entries){
    const prior=store.get(namespace,memory.id);
    if(prior&&immutable(prior)!==immutable(memory))throw Object.assign(new Error('archived memory cannot be rewritten'),{code:'archived_memory_conflict'});
    if(!prior)store.put(namespace,memory.id,memory);
    // Retrieval/decay metadata are mutable, separately from the original record.
    const metadata=Object.fromEntries(['retrieval_count','last_accessed_step','decay_score'].filter(k=>memory.payload[k]!==undefined).map(k=>[k,memory.payload[k]]));
    if(Object.keys(metadata).length)store.put(namespace+':metadata',memory.id,metadata);
    if(!prior)store.indexMemory(namespace,memory.id,memory);
  }
}
export function retrieveCognitiveMemories(store,world,id,query=''){
  const namespace=memoryNamespace(world.world_id,id),life=world.cognition?.actors[id];if(!life)return [];
  const chars=String(query).replace(/[\s\p{P}\p{N}]/gu,'').slice(0,80);
  const terms=Array.from({length:Math.max(0,chars.length-1)},(_,i)=>chars.slice(i,i+2));
  const chosen=new Map((life.memories??[]).map(m=>[m.id,copy(m)]));
  // Recent hot memories plus a ranked cold sample. No all-history materialization.
  for(const memory of store.searchMemory(namespace,terms,24))if(!chosen.has(memory.id))chosen.set(memory.id,copy(memory));
  const queue=[...chosen.values()];let dependencyChars=0;
  for(let i=0;i<queue.length&&chosen.size<192;i++)for(const source of queue[i].payload.source_ids??[]){
    if(chosen.has(source))continue;
    const m=store.get(namespace,source);if(!m)continue;
    dependencyChars+=JSON.stringify(m).length;if(dependencyChars>96000)continue;
    chosen.set(source,m);queue.push(m);
  }
  for(const m of chosen.values())Object.assign(m.payload,store.get(namespace+':metadata',m.id)??{});
  return [...chosen.values()];
}
export function rebuildCognitiveMemoryIndex(store,worldId,id){
  const namespace=memoryNamespace(worldId,id);let cursor='',count=0;
  for(;;){const rows=store.page(namespace,{afterId:cursor,limit:100});if(!rows.length)break;
    for(const row of rows){store.indexMemory(namespace,row.id,row.value);count++;}cursor=rows.at(-1).id;
  }return count;
}
