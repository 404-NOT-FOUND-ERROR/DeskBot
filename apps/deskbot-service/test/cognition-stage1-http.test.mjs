import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDeskBotServer } from '../src/app.mjs';
import { createCognitionStage1 } from '../src/cognition-stage1.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
import { createSqlitePersistence } from '../src/persistence.mjs';

test('HTTP lab boundary cannot receive caller-owned contexts and cannot rewrite the formal world or dialogue history', async () => {
  const directory=mkdtempSync(join(tmpdir(),'deskbot-cognition-http-'));
  const persistence=createSqlitePersistence({filename:join(directory,'formal.sqlite')});
  const fixed=new Date('2026-10-09T12:00:00Z');
  const world=createPersistentWorld({persistence,now:()=>fixed});
  const lab=createCognitionStage1({filename:join(directory,'lab.sqlite')});
  const server=createDeskBotServer({persistence,persistentWorld:world,now:()=>fixed,cognitionStage1:lab});
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    const original=JSON.stringify(world.get());
    const oldHistory=await (await fetch(`${base}/api/chat/history`)).json();
    const preflight=await fetch(`${base}/api/life/cognition/run`,{method:'OPTIONS',headers:{origin:'http://127.0.0.1:5173','access-control-request-method':'POST','access-control-request-headers':'content-type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'*');
    const post=(path,body)=>fetch(`${base}/api/life/cognition/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const denied=await post('run',{run_id:'forged',context:{actor_id:'someone'}});
    assert.equal(denied.status,422);assert.equal((await denied.json()).error.code,'invalid_lab_request');
    const response=await post('run',{run_id:'http-roundtrip'});assert.equal(response.status,200);assert.equal((await response.json()).status,'completed');
    const status=await (await fetch(`${base}/api/life/cognition/status`)).json();assert.equal(status.memories.length,3);
    await post('run',{run_id:'http-roundtrip'});
    const replay=await (await fetch(`${base}/api/life/cognition/status`)).json();assert.equal(replay.broker.calls.length,6);
    assert.equal(JSON.stringify(world.get()),original);
    assert.deepEqual(await (await fetch(`${base}/api/chat/history`)).json(),oldHistory);
  } finally {
    await new Promise(resolve=>server.close(resolve));
    // app.close begins this shutdown too; its close method is idempotent.
    await lab.close();persistence.close();rmSync(directory,{recursive:true,force:true,maxRetries:3});
  }
});
