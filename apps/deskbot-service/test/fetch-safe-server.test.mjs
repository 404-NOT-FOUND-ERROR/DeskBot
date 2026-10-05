import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { listenOnFetchSafePort,closeTestServer } from './support/fetch-safe-server.mjs';

test('Fetch transport preflight retries only bad-port allocation before the business request',async t=>{
  let probes=0,business=0;const servers=[];
  const {server,baseUrl}=await listenOnFetchSafePort(()=>{
    const created=createServer((request,response)=>{
      if(request.url==='/business'){business++;response.end('done');}
    });servers.push(created);return created;
  },{fetchImpl:async(...args)=>{
    if(++probes===1)throw Object.assign(new TypeError('fetch failed'),{cause:Error('bad port')});
    return fetch(...args);
  }});
  t.after(()=>closeTestServer(server));
  assert.equal(servers.length,2);assert.equal(servers[0].listening,false);assert.equal(business,0);
  assert.equal(await(await fetch(`${baseUrl}/business`)).text(),'done');assert.equal(business,1);
});

test('preflight does not retry an unrelated transport failure and closes its server',async()=>{
  const failure=Object.assign(new TypeError('fetch failed'),{cause:Error('connection reset')});let attempts=0,server;
  await assert.rejects(listenOnFetchSafePort(()=>{attempts++;server=createServer();return server;},
    {fetchImpl:async()=>{throw failure;}}),error=>error===failure);
  assert.equal(attempts,1);assert.equal(server.listening,false);
});

test('bad-port retries are bounded and discarded listening servers are all closed',async()=>{
  const servers=[];
  await assert.rejects(listenOnFetchSafePort(()=>{const server=createServer();servers.push(server);return server;},
    {maxAttempts:2,fetchImpl:async()=>{throw Object.assign(new TypeError('fetch failed'),{cause:Error('bad port')});}}),
    /Unable to allocate/);
  assert.equal(servers.length,2);assert.ok(servers.every(server=>!server.listening));
});
