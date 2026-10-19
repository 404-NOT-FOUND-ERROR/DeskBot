import * as THREE from 'three';
import type {DeskBotObjectState} from '../deskbot/types';
import type {SceneLifeContext} from './sceneLifeEffects';
import {createSoftLightTexture} from './sceneLifeEffects';
import {createWaylightScene} from './waylightScene';
export function createResonantLifeScene(parent:THREE.Group){
 const frame=parent.getObjectByName('object:floating-frame'),board=parent.getObjectByName('object:square-noticeboard');
 const target=frame??board;if(!target)return null;
 const waylight=frame?createWaylightScene(parent):null;
 const root=new THREE.Group();root.name=frame?'actual-echo-bells':'actual-night-lanterns';target.add(root);
 const material=(color:number)=>new THREE.MeshStandardMaterial({color,roughness:.72});
 function box(group:THREE.Group,name:string,size:number[],pos:number[],color:number){const mesh=new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),material(color));mesh.name=name;mesh.position.set(pos[0]!,pos[1]!,pos[2]!);mesh.castShadow=true;group.add(mesh);return mesh;}
 target.userData.inspection_anchor=frame?[0,1.4,2]:[-3.5,2.9,-2.5];
 target.userData.workstations??={};
 const activities=frame?['set-bell','read-bell','raise-bell','lower-bell','dampen-bell','open-bell','pack-bell']:['mount-lantern','read-lantern','close-shutter','open-shutter','pack-lantern','line-with-leaf'];
 for(const activity of activities)target.userData.workstations[(frame?'echo-':'night-')+activity]={standing:frame?[0,0,3.1]:[-3.5,0,-1.3],facing:target.userData.inspection_anchor};
 // The empty, repaired frame is authored scenery. Personal lamps remain absent
 // until their stored task results exist.
 if(board){
  const oldFrame=new THREE.Group();oldFrame.name='authored-old-guide-frame';target.add(oldFrame);
  for(const x of [-5.7,-.6])box(oldFrame,'guide-post',[.19,3.6,.20],[x,1.8,-2.55],0x96856b);
  box(oldFrame,'guide-crossbar',[4.6,.20,.20],[-3.4,3.6,-2.55],0xa49373);
  box(oldFrame,'visible-old-joint',[.44,.48,.25],[-5.7,2.5,-2.55],0x647f71);
  box(oldFrame,'short-return',[.18,.55,.20],[-.6,3.32,-2.55],0x96856b);
 }
 const glowTexture=board?createSoftLightTexture():null;
 const slots=Array.from({length:frame?3:4},(_,i)=>{
  const group=new THREE.Group();group.name=`resonant-asset:${i}`;group.position.set(frame?-1.6+i*1.5:-5.05+i*1.05,frame?.2:2.75,frame?1.65:-2.55);root.add(group);group.visible=false;
  if(frame){
   box(group,'floating-mast',[.07,1.65,.07],[0,.825,0],0x8e7658);box(group,'suspension-arm',[.6,.07,.08],[.25,1.58,0],0x8e7658);
   const pendulum=new THREE.Group();pendulum.name='measured-bell';pendulum.position.set(.45,1.5,0);group.add(pendulum);
   box(pendulum,'cord',[.025,.55,.025],[0,-.275,0],0xb7a585);
   const bell=new THREE.Mesh(new THREE.CylinderGeometry(.29,.21,.42,8),material(0xc6e0cf));bell.name='echo-cup';bell.position.y=-.62;pendulum.add(bell);
   const cloth=box(group,'damping-cloth',[.6,.62,.025],[.3,1.1,-.12],0x86afa7);
   const ripple=new THREE.Mesh(new THREE.TorusGeometry(.4,.016,4,32),new THREE.MeshBasicMaterial({color:0xa8f0df,transparent:true,opacity:0,depthWrite:false}));ripple.name='measured-resonance';ripple.rotation.x=-Math.PI/2;ripple.position.set(.45,-.03,0);group.add(ripple);
   return {group,pendulum,cloth,ripple,core:null,shutter:null,inlay:null,pool:null};
  }
  box(group,'hanging-cord',[.025,.45,.025],[0,.43,0],0xb7a585);
  box(group,'lantern-bottom',[.48,.08,.32],[0,-.4,0],0x786a50);box(group,'lantern-cap',[.5,.08,.34],[0,.27,0],0x786a50);
  for(const x of [-.21,.21])box(group,'lantern-rib',[.045,.62,.045],[x,-.06,.12],0xa28a5b);
  const core=new THREE.Mesh(new THREE.OctahedronGeometry(.24,0),material(0xbbd3ae));core.name='finite-afterglow';core.scale.y=1.2;core.position.y=-.08;group.add(core);
  const shutter=box(group,'actual-shutter',[.45,.59,.035],[0,-.065,.17],0x59766c);
  const inlay=new THREE.Group();inlay.name='actual-leaf-inlay';group.add(inlay);
  for(const side of [-1,1]){const leaf=new THREE.Mesh(new THREE.OctahedronGeometry(.25,0),material(0x99b278));leaf.scale.set(.45,1.35,.18);leaf.position.set(side*.15,-.065,.19);leaf.rotation.z=side*.25;inlay.add(leaf);}
  box(inlay,'retained-inlay-binding',[.5,.08,.07],[0,-.18,.2],0xdfceac);
  const pool=new THREE.Mesh(new THREE.CircleGeometry(.95,16),new THREE.MeshBasicMaterial({map:glowTexture,color:0xcee6a8,transparent:true,opacity:0,depthWrite:false}));pool.name='actual-night-lantern-pool';pool.rotation.x=-Math.PI/2;pool.position.y=-2.23;group.add(pool);
  return {group,pendulum:null,cloth:null,ripple:null,core,shutter,inlay,pool};
 });
 return {root,update(seconds:number,reducedMotion:boolean,_context?:SceneLifeContext){
  waylight?.update(seconds,reducedMotion);
  const state=target.userData.state as DeskBotObjectState|undefined;
  slots.forEach((slot,i)=>{
   if(frame){const asset=state?.echo_bells?.[i];slot.group.visible=Boolean(asset);if(!asset)return;
    slot.group.userData={asset_id:asset.bell_id,owner_id:asset.owner_id};slot.cloth!.visible=asset.dampened;
    slot.pendulum!.position.y=.9+asset.height;slot.pendulum!.rotation.z=reducedMotion?0:Math.sin(seconds*2.4+i)*(.035+asset.measurement.noise*.12);
    const resonance=asset.measurement.resonance;slot.ripple!.material.opacity=resonance*(reducedMotion?.35:.2+.15*Math.sin(seconds*1.4));slot.ripple!.scale.setScalar(reducedMotion?1:1+Math.sin(seconds*1.4)*.13);
   }else {const asset=state?.night_lanterns?.[i];slot.group.visible=Boolean(asset);if(!asset)return;
    slot.group.userData={asset_id:asset.lantern_id,study_id:asset.study_id,observation_root:asset.observation_root};slot.shutter!.visible=asset.closed;
    slot.core!.visible=!asset.closed;slot.core!.material.emissive.set(0xacf3bd);slot.core!.material.emissiveIntensity=asset.brightness*2;
    slot.inlay!.visible=Boolean(asset.leaf_inlay);slot.inlay!.userData.root_outcome_id=asset.leaf_inlay?.root_outcome_id;
    slot.inlay!.children.forEach(child=>{if(child instanceof THREE.Mesh&&child.geometry instanceof THREE.OctahedronGeometry)child.material.color.setHex(asset.leaf_inlay?.active?0x99b278:0x8b886c);});
    slot.pool!.material.opacity=asset.closed?0:asset.brightness*.32;
    slot.core!.rotation.y=reducedMotion?0:seconds*.08;
   }
  });
 }};
}
