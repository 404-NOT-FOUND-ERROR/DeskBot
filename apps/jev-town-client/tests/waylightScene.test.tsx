import {it,expect} from 'vitest';
import * as THREE from 'three';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createWaylightScene} from '../src/three/waylightScene';
import {createShapingRender} from '../src/three/shapingRender';
import {WaylightState} from '../src/deskbot/WaylightLife';
import type {Waylight} from '../src/deskbot/types';
const lamp=():Waylight=>({asset_id:'lamp:one',setup_root:'task:made',owner_id:'shaping-001',created_at:'2026-10-20T00:00:00Z',updated_at:'2026-10-20T11:00:00Z',changed_at:'2026-10-20T00:00:00Z',mode:'hooded',has_hood:true,charge:.7,condition:.8,brightness:.3,moisture:.2,patches:1,use_count:2,lit_hours:3,dark_bank_hours:5,last_use:null});
it('animation cannot invent a lamp; material, hood, patches and glow follow saved state even after Toon conversion',()=>{
  const parent=new THREE.Group(),frame=new THREE.Group();frame.name='object:floating-frame';parent.add(frame);
  const view=createWaylightScene(parent)!,style=createShapingRender();style.attach(parent);
  const deckBounds=new THREE.Box3().setFromObject(frame.getObjectByName('waylight-working-planks')!);
  for(const [x,,z] of [frame.userData.workstations['waylight-use'].standing,view.root.position.toArray()]){
    expect(x).toBeGreaterThan(deckBounds.min.x);expect(x).toBeLessThan(deckBounds.max.x);
    expect(z).toBeGreaterThan(deckBounds.min.z);expect(z).toBeLessThan(deckBounds.max.z);
  }
  view.update(999999,false);expect(view.root.getObjectByName('actual-waylight')!.visible).toBe(false);
  const state={waylight:lamp()};frame.userData.state=state;const before=JSON.stringify(state);view.update(1,true);style.update();
  const work=view.root.getObjectByName('actual-waylight')!,core=work.getObjectByName('finite-waylight-core') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshToonMaterial>;
  expect(work.visible).toBe(true);expect(work.userData.asset_id).toBe('lamp:one');expect(core.material).toBeInstanceOf(THREE.MeshToonMaterial);
  expect(core.material.emissiveIntensity).toBeCloseTo(.54);expect(work.getObjectByName('waylight-patch:0')!.visible).toBe(true);expect(work.getObjectByName('waylight-patch:1')!.visible).toBe(false);
  view.update(999999,false);expect(JSON.stringify(state)).toBe(before);
  state.waylight.brightness=0;state.waylight.mode='open';view.update(2,true);
  expect(view.root.getObjectByName('waylight-pool')!.visible).toBe(false);expect(work.getObjectByName('reusable-waylight-hood')!.rotation.z).toBeCloseTo(-.95);
  style.dispose();
});
it('readout distinguishes unbuilt, built-but-unused and actual use, without counting elapsed time as experience',()=>{
  expect(renderToStaticMarkup(createElement(WaylightState,{lamp:null}))).toContain('空挂点');
  const state=lamp();state.use_count=0;expect(renderToStaticMarkup(createElement(WaylightState,{lamp:state}))).toContain('尚待第一次使用');
  state.use_count=2;expect(renderToStaticMarkup(createElement(WaylightState,{lamp:state}))).toContain('净滤取水 2 次');
});
