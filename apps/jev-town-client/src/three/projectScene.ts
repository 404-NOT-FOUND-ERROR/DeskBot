import * as THREE from 'three';
import type { SceneLifeActivity } from '../deskbot/activityProjection.ts';
import type { DeskBotObjectState } from '../deskbot/types.ts';
import type { SceneLifeContext } from './sceneLifeEffects.ts';
import {createFloatingSeedbedArtifact,createWaterPumpArtifact,createRecipeArtifact} from './projectArtifacts.ts';

const recipes:Record<string,{target:string;location:string;pose:string}>={
  'seedbed-survey':{target:'floating-frame',location:'echo-waterside',pose:'observe'},
  'seedbed-plant':{target:'floating-frame',location:'echo-waterside',pose:'care'},
  'seedbed-inspect':{target:'floating-frame',location:'echo-waterside',pose:'observe'},
  'seedbed-accept':{target:'floating-frame',location:'echo-waterside',pose:'observe'},
  'seedbed-care':{target:'floating-frame',location:'echo-waterside',pose:'care'},
  'harvest-float-bed':{target:'floating-frame',location:'echo-waterside',pose:'care'},
  'sow-float-bed':{target:'floating-frame',location:'echo-waterside',pose:'care'},
  'pump-survey':{target:'repair-bench',location:'spare-parts-house',pose:'observe'},
  'pump-assemble':{target:'repair-bench',location:'spare-parts-house',pose:'craft'},
  'pump-install':{target:'floating-frame',location:'echo-waterside',pose:'craft'},
  'pump-trial':{target:'floating-frame',location:'echo-waterside',pose:'care'},
  'pump-accept':{target:'floating-frame',location:'echo-waterside',pose:'observe'},
  'pump-water':{target:'floating-frame',location:'echo-waterside',pose:'care'},
  'repair-pump':{target:'floating-frame',location:'echo-waterside',pose:'craft'},
  'soup-record-ratio':{target:'trial-stove',location:'warm-pot-courtyard',pose:'craft'},
  'soup-cook-trial':{target:'trial-stove',location:'warm-pot-courtyard',pose:'craft'},
  'soup-confirm-recipe':{target:'trial-stove',location:'warm-pot-courtyard',pose:'craft'},
  'cook-leaf-soup':{target:'trial-stove',location:'warm-pot-courtyard',pose:'craft'},
  'soup-serve-trial':{target:'shared-table',location:'warm-pot-courtyard',pose:'social'},
  'soup-taste-trial':{target:'shared-table',location:'warm-pot-courtyard',pose:'eat'},
};
const unit=(value:number|undefined)=>Number.isFinite(value)?THREE.MathUtils.clamp(value!,0,1):0;
export const isProjectActivity=(id?:string)=>Boolean(id&&Object.hasOwn(recipes,id));
/** Titles and elapsed time cannot authorize a project gesture or result. */
export function projectActivityView(activity?:SceneLifeActivity) {
  const recipe=activity?.activityId?recipes[activity.activityId]:undefined;
  return recipe&&activity?.status==='running'&&activity.kind!=='travel'&&activity.targetObjectId===recipe.target&&activity.locationId===recipe.location?recipe:null;
}

/** All meshes are allocated once. Persistent artifacts and temporary task effects are separate. */
export function createProjectScene(parent:THREE.Group,kind:string) {
  if(!['waterside','workshop','courtyard'].includes(kind))return null;
  const root=new THREE.Group();root.name=`resident-project-artifacts:${kind}`;parent.add(root);
  const frame=parent.getObjectByName('object:floating-frame');
  const bed=kind==='waterside'&&frame?createFloatingSeedbedArtifact(frame as THREE.Group):null;
  const pump=kind==='waterside'||kind==='workshop'?createWaterPumpArtifact(root,kind==='workshop'?'project-pump-prototype':'project-installed-pump'):null;
  if(pump)pump.pump.position.set(kind==='workshop'?-2.1:5.4,kind==='workshop'?1.8:.48,kind==='workshop'?4:5.6);
  const soup=kind==='courtyard'?createRecipeArtifact(root):null;
  const particles=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.07,0),new THREE.MeshBasicMaterial({color:0xc0ddae,transparent:true,opacity:.78}),10);
  particles.name=kind==='waterside'?'project-pump-water-flow':kind==='courtyard'?'project-soup-task-steam':'project-pump-assembly-shavings';
  particles.visible=false;particles.frustumCulled=false;root.add(particles);
  const matrix=new THREE.Object3D();
  const state=(id:string)=>parent.getObjectByName(`object:${id}`)?.userData.state as DeskBotObjectState|undefined;
  return {root,update(seconds:number,reducedMotion:boolean,context?:SceneLifeContext) {
    const activities=context?.activities??[];
    const active=(ids:string[])=>activities.some(activity=>ids.includes(activity.activityId??'')&&projectActivityView(activity));
    const floatState=state('floating-frame'),benchState=state('repair-bench'),stoveState=state('trial-stove'),tableState=state('shared-table');
    const seedbed=floatState?.project_assets?.floating_seedbed;
    if(bed){
      const installed=Boolean(seedbed?.installed_at);
      bed.bed.visible=installed||active(['seedbed-plant','sow-float-bed']);
      bed.bed.userData={project_id:'floating-seedbed',status:seedbed?.status??'work_in_progress',accepted:Boolean(seedbed?.accepted_at)};
      bed.seal.visible=Boolean(seedbed?.accepted_at);
      const quantity=Number.isFinite(seedbed?.quantity)?Math.max(0,Math.floor(seedbed!.quantity)):0;
      const health=unit(seedbed?.health),growth=unit(seedbed?.growth);
      bed.sprouts.visible=installed&&quantity>0;
      const height=.28+growth*1.35;
      matrix.rotation.set(0,0,0);
      for(let i=0;i<12;i++){
        matrix.position.set(-1.14+(i%6)*.455,.64,-.34+Math.floor(i/6)*.68);
        matrix.scale.setScalar(i<quantity?1:0);matrix.scale.y*=height;matrix.updateMatrix();bed.plants.setMatrixAt(i,matrix.matrix);
      }
      bed.plants.instanceMatrix.needsUpdate=true;
      bed.plants.material.color.set(0x9b8059).lerp(new THREE.Color(0xffffff),health);
      bed.sprouts.userData={quantity:seedbed?.quantity??0,growth,health};
    }
    if(pump){
      const asset=kind==='workshop'?benchState?.project_assets?.small_water_pump:floatState?.project_assets?.small_water_pump;
      const installed=kind==='workshop'?asset?.status==='assembled'&&Boolean(asset.assembled_at):Boolean(asset?.installed_at)&&['installed_trial','ready','broken'].includes(asset?.status??'');
      pump.pump.visible=Boolean(installed)||active(kind==='workshop'?['pump-assemble']:['pump-install']);
      pump.pump.userData={project_id:'small-water-pump',status:asset?.status??'work_in_progress',accepted:Boolean(asset?.accepted_at),use_count:asset?.use_count??0};
      const condition=asset?.condition===undefined?1:unit(asset.condition);
      const body=pump.pump.getObjectByName('pump-body-and-intake') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>;
      body.material.color.set(0x96764f).lerp(new THREE.Color(0xffffff),condition);
      const pumping=kind==='waterside'&&Boolean(installed)&&asset?.status!=='broken'&&active(['pump-trial','pump-water']);
      pump.rotor.rotation.z=pumping&&!reducedMotion?seconds*2.3:0;
      pump.rotor.userData.running=pumping;
    }
    if(soup){
      const draft=stoveState?.project_drafts?.['leaf-signature-soup'];
      const recipe=stoveState?.recipe_book?.['leaf-signature-soup'];
      const batch=tableState?.project_batches?.['leaf-signature-soup'];
      soup.paper.visible=Boolean(draft?.recorded_at)||Boolean(recipe?.accepted_at)||active(['soup-record-ratio']);
      soup.paper.userData={recorded_at:draft?.recorded_at??null,accepted_at:recipe?.accepted_at??null,recipe_name:recipe?.name??null};
      soup.bowl.visible=Boolean(batch?.prepared_at)&&batch?.status!=='expired'&&(batch?.remaining_portions??0)>0;
      soup.bowl.userData={batch_id:batch?.batch_id??null,status:batch?.status??null,remaining_portions:batch?.remaining_portions??0};
      soup.nameplate.visible=Boolean(recipe?.accepted_at);soup.nameplate.userData.recipe_name=recipe?.name??null;
    }
    const pumping=kind==='waterside'&&pump?.rotor.userData.running;
    const steaming=kind==='courtyard'&&active(['soup-cook-trial','soup-confirm-recipe','cook-leaf-soup']);
    const assembling=kind==='workshop'&&active(['pump-assemble']);
    particles.visible=Boolean(pumping||steaming||assembling);
    const time=reducedMotion?0:seconds;
    if(particles.visible)for(let i=0;i<10;i++) {
      const cycle=(time*(steaming?.22:.7)+i/10)%1;
      if(pumping){matrix.position.set(5.86,1.06-cycle*.58,5.79);matrix.scale.set(.48,.95,.48);}
      else if(steaming){matrix.position.set(-4+Math.sin(i*3)*cycle*.27,2.3+cycle*1.7,3+Math.cos(i)*cycle*.27);matrix.scale.setScalar(.6+cycle*1.2);}
      else {matrix.position.set(-2.1+Math.sin(i*7)*cycle*.55,2.2+Math.sin(cycle*Math.PI)*.5,4+Math.cos(i)*cycle*.42);matrix.scale.setScalar(.35+(1-cycle)*.4);}
      matrix.rotation.set(0,0,0);matrix.updateMatrix();particles.setMatrixAt(i,matrix.matrix);
    }
    (particles.material as THREE.MeshBasicMaterial).color.set(steaming?0xe7ece4:pumping?0x99d9dd:0xffd79f);
    (particles.material as THREE.MeshBasicMaterial).opacity=steaming?.2:.75;
    particles.instanceMatrix.needsUpdate=true;
  }};
}
