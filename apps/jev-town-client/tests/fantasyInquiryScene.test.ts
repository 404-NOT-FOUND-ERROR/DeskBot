import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createFantasyInquiryScene,glowSampleView} from '../src/three/fantasyInquiryScene';
import type {DeskBotObjectState} from '../src/deskbot/types';
describe('actual fantasy experiment scene',()=>{
 it('does not materialize a trial from elapsed animation or absent state',()=>{
  const group=new THREE.Group(),rack=new THREE.Group();rack.name='object:seedling-rack';group.add(rack);
  const view=createFantasyInquiryScene(group)!;view.update(99999,false);
  expect(view.root.getObjectByName('glow-trial-slot:0')!.visible).toBe(false);
  expect(view.root.getObjectByName('afterglow-study:0')!.visible).toBe(false);
  expect(glowSampleView().brightness).toBe(0);
 });
 it('binds each visible sample and reusable cover to the same actual trial',()=>{
  const group=new THREE.Group(),rack=new THREE.Group();rack.name='object:seedling-rack';group.add(rack);
  rack.userData.state={glow_trials:[{trial_id:'trial:one',owner_id:'one',sheltered:true,read_count:1,samples:[
   {id:'B',light:1,charge:.5,moisture:.9,cohesion:.9,brightness:.2},
   {id:'A',light:.2,charge:.1,moisture:.5,cohesion:.9,brightness:.09}]}]} as DeskBotObjectState;
  const view=createFantasyInquiryScene(group)!;view.update(1,true);
  const slot=view.root.getObjectByName('glow-trial-slot:0')!;expect(slot.visible).toBe(true);
  expect(slot.getObjectByName('removable-wind-hood')!.visible).toBe(true);
  expect(slot.getObjectByName('measured-tray:0')!.userData.sample_id).toBe('B');
  expect(slot.getObjectByName('light-control:1')!.visible).toBe(true);
  expect(slot.getObjectByName('light-control:0')!.visible).toBe(false);
  expect(view.root.getObjectByName('actual-moss-measurement-tool')!.visible).toBe(false);
  const moss=slot.getObjectByName('measured-moss:0') as THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>;
  expect(moss.material.emissiveIntensity).toBeCloseTo(.22);
  rack.userData.state={glow_trials:[]};view.update(500,false);expect(slot.visible).toBe(false);
 });
});
