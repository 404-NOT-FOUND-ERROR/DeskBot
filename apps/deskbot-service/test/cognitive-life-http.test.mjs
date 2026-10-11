import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeskBotServer} from '../src/app.mjs';
test('cognitive life routes retain CORS and reject client context, pricing or clocks',async t=>{
 let calls=0;
 const server=createDeskBotServer({cognitiveRuntime:{status:()=>({schema:'test'}),run:async()=>{calls++;return {ok:true}},advance:async()=>{calls++;return {ok:true}},tick:async()=>[],close:async()=>{}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base=`http://127.0.0.1:${server.address().port}`;
 const preflight=await fetch(base+'/api/life/cognitive-life/run',{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:5173'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'*');
 assert.equal((await fetch(base+'/api/life/cognitive-life/status')).status,200);
 for(const body of [{scope:'live',actor_id:'shaping-001',context:{}},{scope:'live',actor_id:'shaping-001',budget:100}]){
  const r=await fetch(base+'/api/life/cognitive-life/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,422);
 }
 const clock=await fetch(base+'/api/life/cognitive-life/test-clock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'next_day',at:'2099-01-01'})});assert.equal(clock.status,422);assert.equal(calls,0);
});
