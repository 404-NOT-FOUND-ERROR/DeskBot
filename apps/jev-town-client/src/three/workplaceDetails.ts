import * as THREE from 'three';
import {LowPolyBatch} from './lowPolyBatch.ts';
import {activityProgressAt, type SceneLifeActivity} from '../deskbot/activityProjection.ts';
import type {SceneLifeContext} from './sceneLifeEffects.ts';

const workIds=['repair-bench','craft-tray','craft-frame-kit','pump-survey','pump-assemble'];
/** Resolve an admitted, local task, including a paused task with unfinished work.
 * A title, an intention, a visitor or another site's task cannot operate tools. */
export function workplaceTask(activities:readonly SceneLifeActivity[],locationId:string,objectId:string,ids:readonly string[]){
  return activities.find(a=>a.locationId===locationId && a.targetObjectId===objectId &&
    a.kind!=='travel' && (a.status==='running'||a.status==='paused') && ids.includes(a.activityId??''));
}

/** A workshop's prepared clamp and hand tool, or a nursery's irrigation lever
 * and soil traces. These are read-only presentations; they never award output,
 * advance a task, water a bed, or infer that a repair has succeeded. */
export function createWorkplaceDetails(parent:THREE.Group,kind:string){
  if(kind!=='workshop'&&kind!=='nursery')return null;
  const workshop=kind==='workshop',target=workshop?'repair-bench':'garden-bed';
  const root=new THREE.Group();root.name=`workplace-details:${target}`;root.userData.state_scope='read_only_presentation';parent.add(root);
  const fixed=new LowPolyBatch();
  const pivot=new THREE.Group();pivot.name='workplace-tool';
  pivot.position.set(workshop?-2:4.05,workshop?1.95:.88,workshop?4:3.7);root.add(pivot);
  const tool=new LowPolyBatch();
  if(workshop){
    // A clamp and measuring rails remain when the bench is idle.
    for(const x of [-3.1,-1.25]){
      fixed.box(.24,.28,.63,x,1.75,4,0x648a85);
      fixed.box(.36,.07,.7,x,1.97,4,0xbab8a1);
    }
    fixed.box(1.8,.035,.14,-2.1,1.78,4.65,0xdcc598);
    for(let i=0;i<12;i++)fixed.box(.025,.018,i%3?.06:.12,-2.9+i*.14,1.82,4.65,0x6b7b67);
    tool.box(.1,.78,.1,0,0,0,0xb48f61);
    tool.box(.48,.21,.21,0,.66,0,0x8faaa5);
  }else{
    fixed.box(.15,.42,.15,4.05,.66,3.7,0xc7ac79);
    tool.box(.55,.09,.16,.19,0,0,0x668f85);
    tool.cylinder(.11,.14,-.10,-.02,0,0xd6c493);
  }
  fixed.finish(root,'workplace-fixtures');tool.finish(pivot,'workplace-hand-tool');
  const preparation=new THREE.Group();preparation.name='workplace-unfinished-work';preparation.visible=false;root.add(preparation);
  const prep=new LowPolyBatch();
  if(workshop){
    // A neutral working board under the clamp, never a finished recipe product.
    prep.box(1.25,.09,.68,-2.15,1.79,4,0xd2b78d);
    for(let i=0;i<3;i++)prep.box(.05,.02,.5,-2.55+i*.35,1.89,4,0x97876e);
    prep.box(.48,.026,.35,-.75,1.78,4.2,0xe8ddbd);
  }else{
    prep.cylinder(.22,.26,4.05,.67,3.7,0x8cb9ad);
  }
  prep.finish(preparation,'clamped-work-in-progress');
  let furrows:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>|undefined;
  let cracks:THREE.Group|undefined;
  if(!workshop){
    const lines=new LowPolyBatch();
    cracks=new THREE.Group();cracks.name='persisted-dry-soil-cracks';cracks.visible=false;root.add(cracks);
    const channels=new LowPolyBatch(),channelRoot=new THREE.Group();root.add(channelRoot);
    for(let row=0;row<3;row++){
      const z=1.9+row*1.8;
      channels.box(9.2,.018,.10,-1,.844,z+.25,0xffffff);
      for(let i=0;i<7;i++){
        const x=-5+i*1.28;
        lines.box(.026,.015,.25,x,.843,z-.13,0x645941,i%2?.5:-.5);
        lines.box(.19,.015,.025,x+.06,.843,z-.1,0x645941);
      }
    }
    lines.finish(cracks,'soil-crack-lines');
    const mesh=channels.finish(channelRoot,'persisted-wet-soil-furrows')!;
    mesh.material.dispose();
    (mesh as THREE.Mesh).material=new THREE.MeshBasicMaterial({color:0x607d6c,transparent:true,opacity:0,depthWrite:false});
    furrows=mesh as unknown as typeof furrows;
  }
  return {root,update(seconds:number,reducedMotion:boolean,context?:SceneLifeContext){
    const state=parent.getObjectByName(`object:${target}`)?.userData.state;
    const task=workplaceTask(context?.activities??[],parent.userData.location_id,target,workshop?workIds:['water-bed']);
    preparation.visible=!!task;
    const running=task?.status==='running';
    // Pausing puts the tool down. All poses are absolute, so no accumulated
    // drift and no stale animation after task cancellation or reduced motion.
    pivot.rotation.z=workshop?(running&&!reducedMotion?-.4-Math.sin(seconds*4)*.25:-1.22)
      :(running&&!reducedMotion?Math.sin(seconds*2)*.32:0);
    preparation.userData.task_id=task?.taskId??null;
    preparation.userData.status=task?.status??'idle';
    preparation.userData.progress=task?activityProgressAt(task):null;
    preparation.userData.result_committed=false;
    if(furrows&&cracks){
      const known=Number.isFinite(state?.moisture),moisture=known?Math.min(1,Math.max(0,state.moisture)):0;
      furrows.visible=known&&moisture>.25;furrows.material.opacity=Math.max(0,moisture-.25)*.75;
      cracks.visible=known&&moisture<.28;
      root.userData.moisture=known?moisture:null;
    }
  }};
}
