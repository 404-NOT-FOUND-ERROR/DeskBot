import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {createWorkplaceDetails} from '../src/three/workplaceDetails.ts';
import {disposeObject} from '../src/three/buildScene.ts';
import type {SceneLifeActivity} from '../src/deskbot/activityProjection.ts';

const task=(patch:Partial<SceneLifeActivity>={}):SceneLifeActivity=>({actorId:'worker',citizenId:1,taskId:'admitted-1',locationId:'spare-parts-house',targetObjectId:'repair-bench',activityId:'craft-tray',title:'工作',kind:'craft',status:'running',startedAt:'2026-10-19T08:00:00Z',dueAt:'2026-10-19T08:10:00Z',durationMs:600000,remainingMs:300000,projectedAt:'2026-10-19T08:05:00Z',realTime:false,...patch});
function setup(kind='workshop'){
  const parent=new THREE.Group();parent.userData.location_id=kind==='workshop'?'spare-parts-house':'moss-sprout-garden';
  const object=new THREE.Group();object.name=kind==='workshop'?'object:repair-bench':'object:garden-bed';object.userData.state={moisture:.8,stock:{wood:5,trays:0},condition:.6};parent.add(object);
  const detail=createWorkplaceDetails(parent,kind)!;
  const update=(seconds:number,activities:SceneLifeActivity[],reduced=false)=>detail.update(seconds,reduced,{minute:840,daylight:1,activities});
  return {parent,object,detail,update};
}
describe('visible workplace details follow admitted work and saved state',()=>{
  it('starts, pauses, resumes and cancels without manufacturing inventory or finishing overdue work',()=>{
    const {parent,object,detail,update}=setup(),before=JSON.stringify(object.userData.state);
    const work=detail.root.getObjectByName('workplace-unfinished-work')!,tool=detail.root.getObjectByName('workplace-tool')!;
    let nodes=0;parent.traverse(()=>nodes++);
    update(1,[]);expect(work.visible).toBe(false);
    update(1,[task()]);expect(work.visible).toBe(true);const moving=tool.rotation.z;
    update(2,[task()]);expect(tool.rotation.z).not.toBe(moving);expect(work.userData.progress).toBeCloseTo(.5);
    update(2,[task({status:'paused',remainingMs:120000})]);const paused=tool.rotation.z;
    update(40,[task({status:'paused',remainingMs:120000})]);expect(tool.rotation.z).toBe(paused);expect(work.userData.progress).toBeCloseTo(.8);
    update(3,[task({realTime:true,dueAt:'2020-01-01T00:00:00Z'})]);expect(work.visible).toBe(true);expect(work.userData.progress).toBeLessThan(1);expect(work.userData.result_committed).toBe(false);
    update(4,[task()],true);const reduced=tool.rotation.z;update(80,[task()],true);expect(tool.rotation.z).toBe(reduced);
    update(90,[]);expect(work.visible).toBe(false);expect(work.userData.task_id).toBeNull();
    let after=0;parent.traverse(()=>after++);expect(after).toBe(nodes);expect(JSON.stringify(object.userData.state)).toBe(before);disposeObject(parent);
  });
  it('does not operate on titles, another place, a mismatched object or a trip',()=>{
    const {parent,detail,update}=setup(),work=detail.root.getObjectByName('workplace-unfinished-work')!;
    for(const patch of [{activityId:undefined,title:'想制作托盘'},{locationId:'moss-sprout-garden'},{targetObjectId:'garden-bed'},{kind:'travel'}]){
      update(4,[task(patch)]);expect(work.visible).toBe(false);
    }
    disposeObject(parent);
  });
  it('reads moisture only from the bed; irrigation animation and its completion cannot wet it',()=>{
    const {parent,object,detail,update}=setup('nursery'),cracks=detail.root.getObjectByName('persisted-dry-soil-cracks')!,wet=detail.root.getObjectByName('persisted-wet-soil-furrows')!;
    update(0,[]);expect(wet.visible).toBe(true);expect(cracks.visible).toBe(false);
    object.userData.state.moisture=.1;
    update(1,[task({locationId:'moss-sprout-garden',targetObjectId:'garden-bed',activityId:'water-bed'})]);expect(wet.visible).toBe(false);expect(cracks.visible).toBe(true);
    update(100,[]);expect(object.userData.state.moisture).toBe(.1);expect(cracks.visible).toBe(true);
    delete object.userData.state;update(101,[]);expect(cracks.visible).toBe(false);expect(wet.visible).toBe(false);expect(detail.root.userData.moisture).toBeNull();disposeObject(parent);
  });
});
