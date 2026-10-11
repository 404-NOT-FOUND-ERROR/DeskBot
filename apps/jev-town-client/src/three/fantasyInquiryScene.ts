import * as THREE from 'three';
import type { DeskBotObjectState, GlowSample } from '../deskbot/types.ts';
import type { SceneLifeContext } from './sceneLifeEffects.ts';

const unit=(n:number|undefined)=>Number.isFinite(n)?THREE.MathUtils.clamp(n!,0,1):0;
/** Only server measurements power light; time animates particles, never grows a result. */
export function glowSampleView(sample?:GlowSample) {
  return {visible:Boolean(sample),brightness:unit(sample?.brightness),wetness:unit(sample?.moisture),cohesion:unit(sample?.cohesion),shade:sample?sample.light<.5:false};
}
export function createFantasyInquiryScene(parent:THREE.Group) {
  const rack=parent.getObjectByName('object:seedling-rack');if(!rack)return null;
  const root=new THREE.Group();root.name='glow-moss-inquiry';rack.add(root);
  rack.userData.inspection_anchor=[-3.5,1.5,-.8];
  rack.userData.workstations??={};for(const id of ['set-pair','read-pair','water-pair','drain-pair','shelter-pair','unshelter-pair','swap-pair','press-study','clear-pair'])rack.userData.workstations['glow-'+id]={standing:[-3.5,0,.4],facing:[-3.5,1.5,-.8]};
  const box=(group:THREE.Group,name:string,size:number[],position:number[],color:number)=>{
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),new THREE.MeshStandardMaterial({color,roughness:.8}));
    mesh.name=name;mesh.position.set(position[0]!,position[1]!,position[2]!);mesh.castShadow=true;group.add(mesh);return mesh;
  };
  const slots=Array.from({length:3},(_,i)=>{
    const group=new THREE.Group();group.name=`glow-trial-slot:${i}`;group.position.set(-4.35+i*.85,1.32,-.8);root.add(group);group.visible=false;
    const samples=[-.19,.19].map((x,j)=>{
      const tray=box(group,`measured-tray:${j}`,[.34,.1,.66],[x,0,0],0xb5a581);
      const moss=box(group,`measured-moss:${j}`,[.27,.07,.52],[x,.085,0],0x719b82);
      const shade=box(group,`light-control:${j}`,[.35,.03,.66],[x,.4,0],0x465f66);
      const glints=new THREE.Group();glints.name=`condensed-particles:${j}`;group.add(glints);
      for(let k=0;k<5;k++){
        const particle=new THREE.Mesh(new THREE.OctahedronGeometry(.024,0),new THREE.MeshBasicMaterial({color:0xb5f9d5,transparent:true,opacity:0}));
        particle.position.set(x+(k%2?-.08:.06),.16+k*.018,-.2+k*.095);glints.add(particle);
      }
      return {tray,moss,shade,glints};
    });
    const hood=box(group,'removable-wind-hood',[.78,.47,.77],[0,.27,0],0xc4dace);
    hood.material.transparent=true;hood.material.opacity=.26;hood.material.depthWrite=false;hood.visible=false;
    const clip=box(group,'comparison-record-clip',[.2,.13,.025],[.25,.22,.4],0xe2d5b7);clip.visible=false;
    return {group,samples,hood,clip};
  });
  const studies=Array.from({length:6},(_,i)=>{
    const plate=box(root,`afterglow-study:${i}`,[.23,.34,.045],[-1.75+(i%3)*.29,1.3+Math.floor(i/3)*.38,-1.23],0xa8ceb1);
    plate.visible=false;return plate;
  });
  const tool=new THREE.Group();tool.name='actual-moss-measurement-tool';tool.position.set(-3.5,1.74,-.49);tool.visible=false;root.add(tool);
  const lens=new THREE.Mesh(new THREE.TorusGeometry(.14,.018,5,16),new THREE.MeshStandardMaterial({color:0xd0b779}));tool.add(lens);
  box(tool,'lens-handle',[.04,.23,.04],[0,-.23,0],0x6a634e);
  return {root,update(seconds:number,reducedMotion:boolean,context?:SceneLifeContext){
    const state=rack.userData.state as DeskBotObjectState|undefined;
    slots.forEach((slot,i)=>{
      const trial=state?.glow_trials?.[i];slot.group.visible=Boolean(trial);if(!trial)return;
      slot.group.userData={trial_id:trial.trial_id,owner_id:trial.owner_id,state_scope:'persistent_living'};
      slot.hood.visible=trial.sheltered;slot.clip.visible=trial.read_count>0;
      slot.samples.forEach((part,j)=>{
        const sample=trial.samples[j],view=glowSampleView(sample);part.moss.visible=view.visible;part.shade.visible=view.shade;
        part.tray.userData={sample_id:sample?.id,light:sample?.light};part.moss.material.color.set(0x638a73).lerp(new THREE.Color(0x31545c),view.wetness);
        part.moss.material.emissive.set(0x7cf1bc);part.moss.material.emissiveIntensity=view.brightness*(context&&context.minute>=1140?1.7:1.1);
        part.glints.visible=view.brightness>.03;
        part.glints.children.forEach((mesh,k)=>{const p=mesh as THREE.Mesh<THREE.OctahedronGeometry,THREE.MeshBasicMaterial>;
          p.material.opacity=view.brightness*(reducedMotion?.75:.6+.2*Math.sin(seconds*1.4+k));
          p.position.y=.16+k*.018+(reducedMotion?0:Math.sin(seconds*.8+k)*.018*view.cohesion);
        });
      });
    });
    studies.forEach((plate,i)=>{const study=state?.glow_studies?.[i];plate.visible=Boolean(study);plate.userData=study?{study_id:study.study_id,observation_root:study.observation_root,root_outcome_id:study.root_outcome_id}:{};
      plate.material.emissive.set(0x9de8c2);plate.material.emissiveIntensity=unit(study?.brightness)*1.4;});
    tool.visible=Boolean(context?.activities.some(a=>a.status==='running'&&a.activityId==='glow-read-pair'&&a.targetObjectId==='seedling-rack'));
    tool.rotation.y=reducedMotion?0:Math.sin(seconds*.7)*.18;
  }};
}
