import * as THREE from 'three';
import type {DeskBotObjectState} from '../deskbot/types';
import type {SceneLifeContext} from './sceneLifeEffects';
export function createResonantLifeScene(parent:THREE.Group){
 const frame=parent.getObjectByName('object:floating-frame'),board=parent.getObjectByName('object:square-noticeboard');
 const target=frame??board;if(!target)return null;
 const root=new THREE.Group();root.name=frame?'actual-echo-bells':'actual-night-lanterns';target.add(root);
 const material=(color:number)=>new THREE.MeshStandardMaterial({color,roughness:.72});
 function box(group:THREE.Group,name:string,size:number[],pos:number[],color:number){const mesh=new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),material(color));mesh.name=name;mesh.position.set(pos[0]!,pos[1]!,pos[2]!);mesh.castShadow=true;group.add(mesh);return mesh;}
 target.userData.inspection_anchor=frame?[0,1.4,2]:[-3.5,2.9,-2.5];
 target.userData.workstations??={};
 const activities=frame?['set-bell','read-bell','raise-bell','lower-bell','dampen-bell','open-bell','pack-bell']:['mount-lantern','read-lantern','close-shutter','open-shutter','pack-lantern'];
 for(const activity of activities)target.userData.workstations[(frame?'echo-':'night-')+activity]={standing:frame?[0,0,3.1]:[-3.5,0,-1.3],facing:target.userData.inspection_anchor};
 const slots=Array.from({length:frame?3:4},(_,i)=>{
  const group=new THREE.Group();group.name=`resonant-asset:${i}`;group.position.set(frame?-1.6+i*1.5:-5.05+i*1.05,frame?.2:2.75,frame?1.65:-2.55);root.add(group);group.visible=false;
  if(frame){
   box(group,'floating-mast',[.07,1.65,.07],[0,.825,0],0x8e7658);box(group,'suspension-arm',[.6,.07,.08],[.25,1.58,0],0x8e7658);
   const pendulum=new THREE.Group();pendulum.name='measured-bell';pendulum.position.set(.45,1.5,0);group.add(pendulum);
   box(pendulum,'cord',[.025,.55,.025],[0,-.275,0],0xb7a585);
   const bell=new THREE.Mesh(new THREE.CylinderGeometry(.29,.21,.42,8),material(0xc6e0cf));bell.name='echo-cup';bell.position.y=-.62;pendulum.add(bell);
   const cloth=box(group,'damping-cloth',[.6,.62,.025],[.3,1.1,-.12],0x86afa7);
   const ripple=new THREE.Mesh(new THREE.TorusGeometry(.4,.016,4,32),new THREE.MeshBasicMaterial({color:0xa8f0df,transparent:true,opacity:0,depthWrite:false}));ripple.name='measured-resonance';ripple.rotation.x=-Math.PI/2;ripple.position.set(.45,-.03,0);group.add(ripple);
   return {group,pendulum,cloth,ripple,core:null,shutter:null};
  }
  box(group,'hanging-cord',[.025,.45,.025],[0,.43,0],0xb7a585);
  box(group,'lantern-bottom',[.48,.08,.32],[0,-.4,0],0x786a50);box(group,'lantern-cap',[.5,.08,.34],[0,.27,0],0x786a50);
  for(const x of [-.21,.21])box(group,'lantern-rib',[.045,.62,.045],[x,-.06,.12],0xa28a5b);
  const core=new THREE.Mesh(new THREE.OctahedronGeometry(.24,0),material(0xbbd3ae));core.name='finite-afterglow';core.scale.y=1.2;core.position.y=-.08;group.add(core);
  const shutter=box(group,'actual-shutter',[.45,.59,.035],[0,-.065,.17],0x59766c);
  return {group,pendulum:null,cloth:null,ripple:null,core,shutter};
 });
 return {root,update(seconds:number,reducedMotion:boolean,_context?:SceneLifeContext){
  const state=target.userData.state as DeskBotObjectState|undefined;
  slots.forEach((slot,i)=>{
   if(frame){const asset=state?.echo_bells?.[i];slot.group.visible=Boolean(asset);if(!asset)return;
    slot.group.userData={asset_id:asset.bell_id,owner_id:asset.owner_id};slot.cloth!.visible=asset.dampened;
    slot.pendulum!.position.y=.9+asset.height;slot.pendulum!.rotation.z=reducedMotion?0:Math.sin(seconds*2.4+i)*(.035+asset.measurement.noise*.12);
    const resonance=asset.measurement.resonance;slot.ripple!.material.opacity=resonance*(reducedMotion?.35:.2+.15*Math.sin(seconds*1.4));slot.ripple!.scale.setScalar(reducedMotion?1:1+Math.sin(seconds*1.4)*.13);
   }else {const asset=state?.night_lanterns?.[i];slot.group.visible=Boolean(asset);if(!asset)return;
    slot.group.userData={asset_id:asset.lantern_id,study_id:asset.study_id,observation_root:asset.observation_root};slot.shutter!.visible=asset.closed;
    slot.core!.visible=!asset.closed;slot.core!.material.emissive.set(0xacf3bd);slot.core!.material.emissiveIntensity=asset.brightness*2;
    slot.core!.rotation.y=reducedMotion?0:seconds*.08;
   }
  });
 }};
}
