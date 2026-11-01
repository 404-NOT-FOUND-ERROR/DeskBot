import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkArchitecture} from '../check-architecture.mjs';
import {baselineSource} from '../capture-baseline.mjs';

const original=JSON.parse(readFileSync(new URL('../../contracts/architecture.v1.json',import.meta.url),'utf8'));
test('registered interface references resolve in the actual source tree',()=>{
  const result=checkArchitecture(original);assert.deepEqual(result.errors,[]);
});
test('a missing migration seam or evidence cannot pass the architecture gate',()=>{
  for(const change of [r=>r.modules[0].anchor='export function removedEntry',r=>r.interfaces[0].evidence=['missing-test.mjs'],
    r=>r.interfaces[0].consumers=['unknown'],r=>r.interfaces[0].version='invented-schema-v999']){
    const r=structuredClone(original);change(r);assert.equal(checkArchitecture(r).ok,false);
  }
});
test('declared competing canonical writer and escaping references are rejected',()=>{
  const r=structuredClone(original);r.modules.find(m=>m.id==='cognition').authority='canonical_commit';
  assert.ok(checkArchitecture(r).errors.some(e=>e.includes('exclusively')));
  r.modules[0].entry='../outside.mjs';assert.ok(checkArchitecture(r).errors.some(e=>e.includes('escapes')));
});

test('source baseline includes new Python/content/contracts but excludes formal data and keys',()=>{
  for(const path of ['services/deskbot-cognition/life_worker.py','world-content/regions/new.json','contracts/cognitive-failure.v1.json'])assert.ok(baselineSource(path));
  for(const path of ['config/llm_config.json','config/local.json','config/weather.local.env','apps/deskbot-service/data/world.json','runtime/model-response.json','assets/art.png'])assert.equal(baselineSource(path),false);
});
