import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSqlitePersistence} from '../src/persistence.mjs';
import {createPersistentWorld} from '../src/persistent-world.mjs';

test('SQLite world restart reads only history indexes and preserves full replay, conflicts and pagination', t => {
  const dir=mkdtempSync(join(tmpdir(),'deskbot-history-lazy-'));
  const store=createSqlitePersistence({filename:join(dir,'world.sqlite')});
  t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  const now=()=>new Date('2026-10-10T02:00:00Z');
  let world=createPersistentWorld({persistence:store,now});
  const event={event_id:'first-turn',type:'conversation.input',source:'user',character_id:'shaping-001',correlation_id:'first-correlation',payload:{text:'今天苗圃怎么样？'}};
  const original=world.ingest(event).mutation;
  // Model an existing large audit record without altering its identity or world state.
  const large={...original,legacy_payload:'x'.repeat(2_000_000)};
  store.put('canonical-world.mutations',original.mutation_id,large);
  let fullReads=0;
  const guarded={...store,list(namespace){assert.notEqual(namespace,'canonical-world.mutations','restart must not deserialize all history');return store.list(namespace);},
    get(namespace,id){if(namespace==='canonical-world.mutations')fullReads++;return store.get(namespace,id);}};
  world=createPersistentWorld({persistence:guarded,now});assert.equal(fullReads,0);
  const revision=world.get().world_revision;
  assert.deepEqual(world.ingest(event).mutation,large);
  assert.throws(()=>world.ingest({...event,payload:{text:'different'}}),{code:'world_event_conflict'});
  assert.deepEqual(world.ingest({...event,event_id:'retry-turn'}).mutation,large);
  assert.equal(world.get().world_revision,revision);
  const later=world.ingest({...event,event_id:'second-turn',correlation_id:'second-correlation'}).mutation;
  assert.equal(later.sequence,original.sequence+1);
  assert.deepEqual(world.listMutations({limit:1}),[large]);
  assert.deepEqual(world.listMutations({afterSequence:original.sequence,limit:1}),[later]);
  assert.deepEqual(world.listMutations({eventId:'first-turn'}),[large]);
  assert.equal(store.get('canonical-world.mutations',original.mutation_id).legacy_payload.length,2_000_000);
});
