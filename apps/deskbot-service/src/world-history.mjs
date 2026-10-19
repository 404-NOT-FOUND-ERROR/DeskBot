import {DELTA_SCHEMA,worldHash,applyWorldDelta} from './world-delta.mjs';

const NS='canonical-world.checkpoints';
const fail=(code,message,statusCode=409)=>{throw Object.assign(new Error(message),{code,message,statusCode});};
const integer=(value,name)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<0)fail('invalid_history_cursor',`invalid ${name}`,400);return n;};

/** Checkpoints + verified state reconstruction. Reads never run the executor,
 * replay an input, consult today's rules or call a model. Old v0.1 rows remain
 * untouched and readable; their missing timestamps/anchors aren't invented. */
// The real saved world took ~6.3s to verify 42 transitions on this machine.
// Bound ordinary reads to 24 transitions while retaining immutable old anchors.
export function createWorldHistory({persistence,indexes,readMutation,interval=24}) {
  const memory=new Map(),bases=new Map();
  const load=id=>persistence?.get?.(NS,id)??memory.get(id);
  function prepare(before,mutation,beforeSequence,hash=worldHash(before)) {
    const base=bases.get(before.world_id);
    const needs=!base||mutation.sequence-base.sequence>interval||base.last_hash!==hash;
    const checkpoint=needs?{schema:'deskbot.world-checkpoint.v1',checkpoint_id:`${before.world_id}:${beforeSequence}:${hash.slice(0,20)}`,
      world_id:before.world_id,sequence:beforeSequence,world_revision:before.world_revision,hash,world:structuredClone(before)}:null;
    const anchor=checkpoint??base;
    return {checkpoint,base_checkpoint_id:anchor.checkpoint_id,commit(afterHash){
      if(checkpoint&&!persistence?.get)memory.set(checkpoint.checkpoint_id,checkpoint);
      bases.set(before.world_id,{checkpoint_id:anchor.checkpoint_id,sequence:anchor.sequence,last_hash:afterHash});
    }};
  }
  function persist(checkpoint){if(checkpoint)persistence?.put(NS,checkpoint.checkpoint_id,checkpoint);}
  function replayAt({worldId,sequence}) {
    const target=integer(sequence,'sequence');
    const rows=indexes().filter(r=>r.world_id===worldId),row=rows.find(r=>r.sequence===target);
    // A checkpoint before the first v2 row also exposes that exact baseline.
    const record=row?readMutation(row):null;
    const next=rows.find(r=>r.sequence>target&&r.schema==='foundry.world-mutation-record.v0.2');
    const anchorId=record?.replay?.base_checkpoint_id??(next?readMutation(next)?.replay?.base_checkpoint_id:null);
    if(!anchorId)fail('history_before_checkpoint','该时段只有旧审计记录，尚无可校验的状态回放锚点。',422);
    const anchor=load(anchorId);
    if(!anchor||anchor.world_id!==worldId||anchor.sequence>target)fail('history_before_checkpoint','所选版本早于可校验的回放范围。',422);
    if(worldHash(anchor.world)!==anchor.hash)fail('history_corrupt','回放锚点校验失败。');
    let world=structuredClone(anchor.world),applied=0,previousSequence=anchor.sequence;
    for(const item of rows.filter(r=>r.sequence>anchor.sequence&&r.sequence<=target)) {
      const mutation=readMutation(item);
      if(mutation.replay?.schema!==DELTA_SCHEMA)fail('history_gap','回放范围中有不支持的旧记录。',422);
      if(mutation.replay.previous_sequence!==previousSequence)fail('history_gap','回放记录序列不连续。');
      world=applyWorldDelta(world,mutation);applied++;previousSequence=mutation.sequence;
    }
    if(!row&&target!==anchor.sequence)fail('history_not_found','没有这个记录序号。',404);
    return {schema:'deskbot.world-replay.v1',world_id:worldId,sequence:target,world_revision:world.world_revision,
      checkpoint_id:anchorId,checkpoint_sequence:anchor.sequence,hash:worldHash(world),verified:true,
      applied_records:applied,read_only:true,world};
  }
  function page({worldId,cursor=null,limit=20,order='asc'}) {
    const size=Math.max(1,Math.min(50,integer(limit,'limit'))),rows=indexes().filter(r=>r.world_id===worldId);
    if(!['asc','desc'].includes(order))fail('invalid_history_cursor','invalid order',400);
    let frozen={world_id:worldId,head:rows.at(-1)?.sequence??0,head_id:rows.at(-1)?.mutation_id??null,after:0,order};
    if(cursor){
      try {frozen=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));}catch{fail('invalid_history_cursor','无法读取历史分页位置。',400);}
      if(frozen.world_id!==worldId||!Number.isSafeInteger(frozen.head)||!Number.isSafeInteger(frozen.after)||frozen.after<0||frozen.after>frozen.head||!['asc','desc'].includes(frozen.order))fail('invalid_history_cursor','历史分页位置不匹配。',400);
      if(frozen.head&&rows.find(r=>r.sequence===frozen.head)?.mutation_id!==frozen.head_id)fail('history_head_changed','存档已变化，请重新开始查看历史。');
    }
    const supported=rows.filter(r=>r.schema==='foundry.world-mutation-record.v0.2'&&r.sequence<=frozen.head);
    const remaining=frozen.order==='desc'?[...supported].reverse().filter(r=>!frozen.after||r.sequence<frozen.after):supported.filter(r=>r.sequence>frozen.after);
    const chosen=remaining.slice(0,size),operations=chosen.map(r=>{
      const m=readMutation(r);return {...m.operation_trace,replay_sequence:m.sequence,replay_checkpoint:m.replay.base_checkpoint_id};
    });
    const next=remaining.length>size?Buffer.from(JSON.stringify({...frozen,after:chosen.at(-1).sequence})).toString('base64url'):null;
    return {schema:'deskbot.world-operation-page.v1',world_id:worldId,head_sequence:frozen.head,
      first_traced_sequence:supported[0]?.sequence??null,legacy_records:rows.filter(r=>r.sequence<=frozen.head&&r.schema!=='foundry.world-mutation-record.v0.2').length,
      operations,next_cursor:next,read_only:true};
  }
  return {prepare,persist,replayAt,page};
}
