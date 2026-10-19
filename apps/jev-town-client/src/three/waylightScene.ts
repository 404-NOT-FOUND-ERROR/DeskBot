import * as THREE from 'three';
import type {DeskBotObjectState} from '../deskbot/types';
import {createSoftLightTexture} from './sceneLifeEffects';

/** The hook exists as scenery; the work, hood, patches and light require saved state. */
export function createWaylightScene(parent:THREE.Group){
  const frame=parent.getObjectByName('object:floating-frame');if(!frame)return null;
  const root=new THREE.Group();root.name='waterside-waylight';root.position.set(2.8,.15,.6);frame.add(root);
  const mat=(color:number)=>new THREE.MeshStandardMaterial({color,roughness:.85});
  // The working position connects the floating frame to the existing bank dock.
  // Keep a visible supporting surface under both the hook and the actor's feet.
  const deck=new THREE.Group();deck.name='waylight-working-planks';frame.add(deck);
  for(let i=0;i<6;i++){
    const plank=new THREE.Mesh(new THREE.BoxGeometry(.72,.18,1.6),mat(i%2?0x947554:0xa1815c));
    plank.position.set(2.35+i*.73,0,.9);plank.castShadow=true;plank.receiveShadow=true;deck.add(plank);
  }
  const branch=new THREE.CatmullRomCurve3([new THREE.Vector3(0,0,0),new THREE.Vector3(-.25,1.5,0),new THREE.Vector3(.1,3.05,0),new THREE.Vector3(1.05,2.9,0)]);
  const hook=new THREE.Mesh(new THREE.TubeGeometry(branch,12,.105,5,false),mat(0x777261));hook.name='authored-empty-waylight-hook';hook.castShadow=true;root.add(hook);
  const work=new THREE.Group();work.name='actual-waylight';work.position.set(.95,2.15,0);work.scale.setScalar(1.2);root.add(work);work.visible=false;
  const core=new THREE.Mesh(new THREE.OctahedronGeometry(.42,0),mat(0xe7dfaf));core.name='finite-waylight-core';core.scale.set(.72,1.25,.72);work.add(core);
  // The style pass copies source intensity each frame. Keep both surfaces in
  // sync so it cannot erase the saved lamp brightness after Toon conversion.
  const coreSurface=core.material;
  const crown=new THREE.Group();crown.name='woven-light-leaves';work.add(crown);
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3,leaf=new THREE.Mesh(new THREE.OctahedronGeometry(.4,0),mat(i%2?0x8fcdb9:0x63a797));
    leaf.scale.set(.28,1.75,.18);leaf.position.set(Math.cos(a)*.45,-.03,Math.sin(a)*.45);leaf.rotation.z=Math.sin(a)*.35;leaf.rotation.y=-a;crown.add(leaf);
  }
  const ring=new THREE.Mesh(new THREE.TorusGeometry(.43,.045,5,8),mat(0xb6996b));ring.rotation.x=Math.PI/2;ring.position.y=-.28;work.add(ring);
  // Leave a road-facing opening; the cloth shields the back, not the whole flame.
  const hood=new THREE.Mesh(new THREE.ConeGeometry(.7,.62,6,1,true,Math.PI*.65,Math.PI*1.25),mat(0x5c7e88));
  hood.name='reusable-waylight-hood';hood.position.y=.2;hood.material.side=THREE.DoubleSide;hood.castShadow=true;work.add(hood);
  const stitches=Array.from({length:3},(_,i)=>{const patch=new THREE.Mesh(new THREE.BoxGeometry(.22,.1,.055),mat(0xe9c79c));patch.position.set(-.25+i*.22,-.04,.48);patch.name=`waylight-patch:${i}`;work.add(patch);return patch;});
  const pool=new THREE.Mesh(new THREE.CircleGeometry(2.9,24),new THREE.MeshBasicMaterial({map:createSoftLightTexture(),color:0xd9efaa,transparent:true,opacity:0,depthWrite:false}));
  pool.name='waylight-pool';pool.rotation.x=-Math.PI/2;pool.position.set(.8,.12,.8);root.add(pool);
  const marks=new THREE.Group();marks.name='waylight-water-measure';root.add(marks);
  for(let i=0;i<4;i++){const mark=new THREE.Mesh(new THREE.BoxGeometry(.1,.045,.02),mat(0xe2d8b9));mark.position.set(-.09,.15+i*.18,.14);marks.add(mark);}
  frame.userData.workstations??={};
  for(const action of ['build-open','build-hooded','fit-shade','open','shade','repair','use'])
    frame.userData.workstations[`waylight-${action}`]={standing:[4.5,.1,1.45],facing:[3.75,2.3,.6]};
  return {root,update(seconds:number,reducedMotion:boolean){
    const l=(frame.userData.state as DeskBotObjectState|undefined)?.waylight;
    work.visible=Boolean(l);marks.visible=Boolean(l);pool.visible=Boolean(l&&l.brightness>0);if(!l)return;
    work.userData={asset_id:l.asset_id,setup_root:l.setup_root,use_count:l.use_count,condition:l.condition};
    coreSurface.emissive.setHex(0xbfe886);coreSurface.emissiveIntensity=l.brightness*1.8;
    core.material.emissiveIntensity=coreSurface.emissiveIntensity;
    hood.visible=l.has_hood;hood.rotation.z=l.mode==='open'?-.95:0;hood.position.x=l.mode==='open'?-.55:0;
    work.rotation.z=reducedMotion?0:Math.sin(seconds*.9)*.025;
    pool.material.opacity=l.brightness*.48;pool.scale.set(l.mode==='hooded'?.55:1,1,1);
    crown.scale.y=.8+l.condition*.2;
    stitches.forEach((p,i)=>p.visible=i<l.patches);
  }};
}
