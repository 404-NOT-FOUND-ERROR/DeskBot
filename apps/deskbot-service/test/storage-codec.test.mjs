import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeRecord,decodeRecord} from '../src/storage-codec.mjs';
const ns='canonical-world.checkpoints';
const checkpoint={schema:'deskbot.world-checkpoint.v1',checkpoint_id:'test',sequence:24,world:{tasks:Array.from({length:120},(_,i)=>({task_id:`t${i}`,text:'这是已经完成的一件真实事情。'.repeat(100)}))}};
test('checkpoint storage compresses losslessly; other namespaces and old JSON stay unchanged',()=>{
  const encoded=encodeRecord(ns,checkpoint);
  assert.ok(Buffer.byteLength(encoded)<Buffer.byteLength(JSON.stringify(checkpoint))*.1);
  assert.deepEqual(decodeRecord(encoded),checkpoint);
  assert.deepEqual(decodeRecord(JSON.stringify(checkpoint)),checkpoint);
  assert.equal(encodeRecord('canonical-world.current',checkpoint),JSON.stringify(checkpoint));
  assert.equal(JSON.parse(encoded).sequence,24);
});
test('damaged payloads, metadata tampering, unknown codec and expansion limits fail closed',()=>{
  for(const change of [x=>x._deskbot_storage.sha256='bad',x=>x._deskbot_storage.bytes=1,x=>x._deskbot_storage.bytes=2**40,
    x=>x._deskbot_storage.codec='future',x=>x.sequence=99,x=>x._deskbot_storage.data='garbage']){
    const packed=JSON.parse(encodeRecord(ns,checkpoint));change(packed);
    assert.throws(()=>decodeRecord(JSON.stringify(packed)),{code:'history_corrupt'});
  }
});
