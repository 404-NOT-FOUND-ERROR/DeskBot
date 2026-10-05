import test from 'node:test';
import assert from 'node:assert/strict';
import { getWorldEnvironment } from '../src/world-environment.mjs';
import { loadWorldMapContent, upgradeAuthoredScene } from '../src/world-map-content.mjs';
import { createPersistentWorld } from '../src/persistent-world.mjs';
const now=new Date('2026-10-04T08:00:00Z');
const world=condition=>({clock:{mode:'real_time',time_zone:'Asia/Shanghai'},logical_time:{minute_of_day:1320},weather:{snapshot:{condition,wind_mps:8,observed_at:'2026-10-04T07:50:00Z',provider:'open-meteo',location:'观测城市'}}});
test('local dawn, day, dusk and night follow the same world minute without changing the clock',()=>{
  const w=world('中雨'),before=structuredClone(w);
  assert.equal(getWorldEnvironment(w,{now}).time.phase,'night');
  for(const [minute,phase] of [[350,'dawn'],[720,'day'],[1100,'dusk'],[1200,'night']]){w.logical_time.minute_of_day=minute;assert.equal(getWorldEnvironment(w,{now}).time.phase,phase);}
  w.logical_time.minute_of_day=1320;assert.deepEqual(w,before);
});
test('fresh rain, snow and wind project to effects; missing, old and future observations do not',()=>{
  assert.equal(getWorldEnvironment(world('中雨'),{now}).weather.precipitation,'rain');
  assert.equal(getWorldEnvironment(world('雨夹雪'),{now}).weather.precipitation,'snow');
  const stale=world('大雨');stale.weather.snapshot.observed_at='2026-10-03T07:50:00Z';
  assert.equal(getWorldEnvironment(stale,{now}).weather.status,'stale');assert.equal(getWorldEnvironment(stale,{now}).weather.precipitation,'none');assert.equal(getWorldEnvironment(stale,{now}).weather.wind_mps,null);
  const future=world('大雨');future.weather.snapshot.observed_at='2026-10-05T07:50:00Z';assert.equal(getWorldEnvironment(future,{now}).weather.status,'stale');
  assert.equal(getWorldEnvironment({},{now}).weather.status,'unavailable');
});
test('weather projection respects connector expiry',()=>{
  const w=world('中雨');w.weather.provenance={expires_at:'2026-10-04T07:59:00Z'};assert.equal(getWorldEnvironment(w,{now}).weather.status,'stale');
});
test('scene correction preserves IDs, passage access, running task deadlines, NPCs and object state and applies once',()=>{
  const w=createPersistentWorld().get(),old=loadWorldMapContent();old.version='2026-10-04.1';delete old.scene_revision;
  old.locations.forEach(p=>{p.presentation={space:'jev-town-map-v1',point:{x:50,y:90}};p.x=50;p.y=50;});
  w.map_catalog=old;w.tasks=[{task_id:'saved-travel',due_at:'2026-10-04T08:05:00Z',status:'running',to_location_id:'moss-sprout-garden'}];w.object_states={'floating-frame':{owner:'shaping-001'}};
  const before=structuredClone(w);assert.equal(upgradeAuthoredScene(w,now.toISOString()),true);
  for(const field of ['protagonist','npcs','tasks','clock','logical_time','passage_states','object_states'])assert.deepEqual(w[field],before[field]);
  assert.deepEqual(w.locations.find(p=>p.location_id==='moss-sprout-garden').presentation.lot,{x:20,y:100});
  assert.equal(w.world_revision,before.world_revision+1);assert.equal(upgradeAuthoredScene(w,now.toISOString()),false);
});
