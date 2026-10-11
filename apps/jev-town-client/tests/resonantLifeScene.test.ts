import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createResonantLifeScene} from '../src/three/resonantLifeScene';
describe('water and night actual objects',()=>{
 function fixture(name:string){const parent=new THREE.Group(),object=new THREE.Group();object.name=`object:${name}`;parent.add(object);return {object,scene:createResonantLifeScene(parent)!};}
 it('cannot create objects from elapsed animation; height and cloth follow the installed bell',()=>{
  const {object,scene}=fixture('floating-frame');scene.update(9999,false);const slot=scene.root.getObjectByName('resonant-asset:0')!;expect(slot.visible).toBe(false);
  const asset={bell_id:'bell:one',owner_id:'one',height:.3,dampened:true,measurement:{noise:.5,resonance:.25}};object.userData.state={echo_bells:[asset]};scene.update(1,true);
  expect(slot.visible).toBe(true);expect(slot.userData.asset_id).toBe('bell:one');expect(slot.getObjectByName('damping-cloth')!.visible).toBe(true);expect(slot.getObjectByName('measured-bell')!.position.y).toBeCloseTo(1.2);
  const before=JSON.stringify(object.userData.state);scene.update(9999,false);expect(JSON.stringify(object.userData.state)).toBe(before);
  object.userData.state.echo_bells=[];scene.update(1,true);expect(slot.visible).toBe(false);
 });
 it('a closed shutter extinguishes the actual study and preserves source identity',()=>{
  const {object,scene}=fixture('square-noticeboard'),asset={lantern_id:'lamp:one',study_id:'study:one',observation_root:'task:read',closed:false,brightness:.2};object.userData.state={night_lanterns:[asset]};scene.update(1,true);
  const core=scene.root.getObjectByName('finite-afterglow') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>;
  expect(core.material.emissiveIntensity).toBeCloseTo(.4);expect(core.parent!.userData.observation_root).toBe('task:read');
  asset.closed=true;asset.brightness=0;scene.update(1,false);expect(core.visible).toBe(false);expect(core.material.emissiveIntensity).toBe(0);expect(core.parent!.getObjectByName('actual-shutter')!.visible).toBe(true);
 });
});
