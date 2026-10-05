import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import * as THREE from "three";
import { buildTownScenery } from "../src/three/buildScene.ts";
import { createEnvironmentEffects } from "../src/three/environmentEffects.ts";
import { sceneEnvironmentAt } from "../src/three/sceneEnvironment.ts";
import type { DeskBotEnvironment, DeskBotLocation } from "../src/deskbot/types.ts";
const content=JSON.parse(readFileSync(new URL('../../../world-content/companion-world/map.v1.json',import.meta.url),'utf8'));
const locations:DeskBotLocation[]=content.locations.map((p:DeskBotLocation)=>({...p,areas:content.areas.filter((a:{location_id:string})=>a.location_id===p.location_id).map((a:{area_id:string})=>({...a,objects:content.objects.filter((o:{area_id:string})=>o.area_id===a.area_id)}))}));
const now=Date.parse('2026-10-04T08:00:00Z');
const environment:DeskBotEnvironment={schema:'deskbot.world-environment.v1',projected_at:new Date(now).toISOString(),time:{mode:'simulation',time_zone:'Asia/Shanghai',minute_of_day:1320,phase:'night',synced_at:null,lighting_convention:'fixed-local-dawn-dusk-v1'},weather:{status:'fresh',location:'测试',condition:'中雨',provider:'fixture',observed_at:new Date(now).toISOString(),expires_at:new Date(now+1800000).toISOString(),temperature_c:20,wind_mps:9,precipitation:'rain',cloud_cover:.9,intensity:.8}};
describe('authored living scenery',()=>{
  it('replaces the actual farm lot and binds every admitted object to a physical mesh',()=>{
    const scenery=buildTownScenery(locations);
    const garden=scenery.root.getObjectByName('location:moss-sprout-garden')!;
    expect([garden.position.x,garden.position.z]).toEqual([-40,40]);
    expect(garden.getObjectByName('building:nursery')).toBeDefined();
    expect([...scenery.companion!.objects.keys()].sort()).toEqual(content.objects.map((o:{object_id:string})=>o.object_id).sort());
    for(const [id,object] of scenery.companion!.objects){expect(object.children.length,id).toBeGreaterThan(0);expect(object.userData.state_scope).toBe('catalog_only');}
    expect(scenery.companion!.objects.get('garden-bed')!.getObjectByName('nursery-seedlings')).toBeDefined();
    expect(scenery.root.getObjectByName('water-level:floating-frame')!.userData.visual_channel).toBe('water_level');
    expect(scenery.fountainJets.visible).toBe(false);scenery.dispose();
  });
  it('changes light, precipitation and tree motion from the projection and disables expired effects',()=>{
    const scene=new THREE.Scene(),sky=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight(),fill=new THREE.DirectionalLight();
    const scenery=buildTownScenery(locations),effects=createEnvironmentEffects(scene,sky,sun,fill,scenery.companion);
    effects.update(environment,10,false,now);expect(sun.intensity).toBeLessThan(1);
    const rain=scene.getObjectByName('rain-fall') as THREE.LineSegments;expect(rain.visible).toBe(true);expect(rain.geometry.drawRange.count).toBeGreaterThan(0);
    effects.update(environment,11,false,now+1800001);expect(rain.visible).toBe(false);
    const day=structuredClone(environment);day.time.minute_of_day=720;day.weather.precipitation='none';day.weather.cloud_cover=0;
    effects.update(day,20,true,now);expect(sun.intensity).toBeGreaterThan(2);expect(scenery.companion!.trees.every(t=>t.rotation.z===0)).toBe(true);
    effects.dispose();scenery.dispose();
  });
  it('interpolates real time without advancing simulation fixtures or accepting stale wind',()=>{
    const real=structuredClone(environment);real.time.mode='real_time';real.time.synced_at=new Date(now).toISOString();
    expect(sceneEnvironmentAt(real,now+60000).minute).toBe(1321);expect(sceneEnvironmentAt(environment,now+60000).minute).toBe(1320);
    expect(sceneEnvironmentAt(real,now+1800001).wind).toBe(0);
  });
});
