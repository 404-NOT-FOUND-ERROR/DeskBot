import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import type {DeskBotLocation,DeskBotObjectState} from '../src/deskbot/types.ts';
import type {SceneLifeActivity} from '../src/deskbot/activityProjection.ts';
import {buildCompanionScenery} from '../src/three/companionScenery.ts';
import {isProjectActivity,projectActivityView} from '../src/three/projectScene.ts';
import {disposeObject} from '../src/three/buildScene.ts';

const fixtures=JSON.parse(readFileSync(new URL('../public/living-review-fixtures.json',import.meta.url),'utf8'));
const initial=():DeskBotLocation[]=>structuredClone(fixtures.samples.initial.map.locations);
function objectState(locations:DeskBotLocation[],id:string) {return locations.flatMap(location=>location.areas??[]).flatMap(area=>area.objects??[]).find(object=>object.object_id===id)!.state!;}
const task=(changes:Partial<SceneLifeActivity>={}):SceneLifeActivity=>({actorId:'spare-mender-001',citizenId:1,locationId:'echo-waterside',taskId:'project-task',title:'真实试机',kind:'care',activityId:'pump-trial',targetObjectId:'floating-frame',status:'running',dueAt:'2026-10-05T12:20:00Z',remainingMs:1200000,...changes});
const context=(activities:SceneLifeActivity[])=>({minute:720,daylight:1,activities});
const installedPump=():NonNullable<DeskBotObjectState['project_assets']>['small_water_pump']=>({project_id:'small-water-pump',status:'installed_trial',installed_at:'2026-10-05T12:00:00Z',condition:.8,use_count:0});

describe('resident project artifacts follow formal settled state',()=>{
  it('covers all 20 domain activities at their catalog object and location, including real workstations',async()=>{
    const moduleUrl=new URL('../../deskbot-service/src/resident-projects.mjs',import.meta.url);
    const {PROJECT_ACTIVITIES}=await import(moduleUrl.href) as {PROJECT_ACTIVITIES:readonly {activity_id:string;target:string;kind:'care'|'craft'}[]};
    const catalog:{objects:{object_id:string;area_id:string}[];areas:{area_id:string;location_id:string}[]}=JSON.parse(readFileSync(new URL('../../../world-content/companion-world/map.v1.json',import.meta.url),'utf8'));
    const scene=buildCompanionScenery(initial());
    expect(PROJECT_ACTIVITIES).toHaveLength(20);
    for(const recipe of PROJECT_ACTIVITIES){
      const object=catalog.objects.find(o=>o.object_id===recipe.target)!,location=catalog.areas.find(a=>a.area_id===object.area_id)!.location_id;
      const activity=task({activityId:recipe.activity_id,targetObjectId:recipe.target,locationId:location,kind:recipe.kind});
      expect(isProjectActivity(recipe.activity_id),recipe.activity_id).toBe(true);
      expect(projectActivityView(activity),recipe.activity_id).toMatchObject({target:recipe.target,location});
      expect(scene.root.getObjectByName(`object:${recipe.target}`)?.userData.workstations?.[recipe.activity_id],recipe.activity_id).toBeDefined();
      for(const invalid of [{status:'paused' as const},{kind:'travel'},{targetObjectId:'unrelated-object'},{locationId:'unrelated-place'}])expect(projectActivityView({...activity,...invalid}),recipe.activity_id).toBeNull();
    }
    for(const obsolete of ['seedbed-harvest','seedbed-sow'])expect(isProjectActivity(obsolete)).toBe(false);
    const assembly=task({activityId:'pump-assemble',targetObjectId:'repair-bench',locationId:'spare-parts-house',kind:'craft'});
    scene.update(1,0,0,0,false,context([assembly]));
    expect(scene.root.getObjectByName('project-pump-prototype')!.visible).toBe(true);
    expect(scene.root.getObjectByName('project-pump-assembly-shavings')!.visible).toBe(true);
    scene.update(2,0,0,0,false,context([{...assembly,status:'paused'}]));
    expect(scene.root.getObjectByName('project-pump-prototype')!.visible).toBe(false);
    expect(scene.root.getObjectByName('project-pump-assembly-shavings')!.visible).toBe(false);
    disposeObject(scene.root);
  });
  it('does not materialize completed artifacts from a clock, title or a generic craft task',()=>{
    const locations=initial(),scene=buildCompanionScenery(locations),before=JSON.stringify(locations);
    scene.update(999999,1,4,.3,false,context([task({activityId:undefined,title:'我想做泵',kind:'craft'})]));
    for(const name of ['project-floating-seedbed','project-pump-prototype','project-installed-pump','project-leaf-recipe','project-soup-tasting-bowl','project-signature-dish-label'])expect(scene.root.getObjectByName(name)!.visible,name).toBe(false);
    expect(JSON.stringify(locations)).toBe(before);disposeObject(scene.root);
  });
  it('shows planted quantity, growth, death and the separate accepted seal without inventing acceptance',()=>{
    const locations=initial();objectState(locations,'floating-frame').project_assets={floating_seedbed:{project_id:'floating-seedbed',status:'prototype',installed_at:'2026-10-05T12:00:00Z',quantity:4,health:.8,moisture:.5,growth:.1}};
    const scene=buildCompanionScenery(locations);scene.update(1,0,0,0,true,context([]));
    const bed=scene.root.getObjectByName('project-floating-seedbed')!,plants=scene.root.getObjectByName('floating-seedbed-foliage') as THREE.InstancedMesh,seal=scene.root.getObjectByName('floating-seedbed-acceptance-seal')!;
    expect(bed.visible).toBe(true);expect(seal.visible).toBe(false);expect(bed.userData.accepted).toBe(false);
    const matrix=new THREE.Matrix4();plants.getMatrixAt(0,matrix);const short=matrix.elements[5];plants.getMatrixAt(4,matrix);expect(matrix.elements[5]).toBe(0);
    const asset=objectState(locations,'floating-frame').project_assets!.floating_seedbed!;asset.growth=1;asset.status='ready';asset.accepted_at='2026-10-06T02:00:00Z';
    scene.applyState(locations);scene.update(2,0,0,0,true,context([]));plants.getMatrixAt(0,matrix);expect(matrix.elements[5]).toBeGreaterThan(short!);expect(seal.visible).toBe(true);
    const healthy=(plants.material as THREE.MeshLambertMaterial).color.clone();asset.status='dead';asset.health=0;scene.applyState(locations);scene.update(3,0,0,0,true,context([]));
    expect((plants.material as THREE.MeshLambertMaterial).color.equals(healthy)).toBe(false);
    asset.status='empty';asset.quantity=0;scene.applyState(locations);scene.update(4,0,0,0,true,context([]));expect(scene.root.getObjectByName('floating-seedbed-sprouts')!.visible).toBe(false);expect(bed.visible).toBe(true);
    disposeObject(scene.root);
  });
  it('moves the settled pump prototype to the installed bank and animates only a valid running trial',()=>{
    const locations=initial();objectState(locations,'repair-bench').project_assets={small_water_pump:{project_id:'small-water-pump',status:'assembled',assembled_at:'2026-10-05T11:00:00Z',carrier_id:'spare-mender-001'}};
    const scene=buildCompanionScenery(locations);scene.update(1,0,0,0,false,context([]));
    const prototype=scene.root.getObjectByName('project-pump-prototype')!,pump=scene.root.getObjectByName('project-installed-pump')!,flow=scene.root.getObjectByName('project-pump-water-flow')!;
    expect(prototype.visible).toBe(true);expect(pump.visible).toBe(false);
    objectState(locations,'repair-bench').project_assets!.small_water_pump!.status='moved';objectState(locations,'floating-frame').project_assets={small_water_pump:installedPump()};
    scene.applyState(locations);scene.update(2,0,0,0,false,context([]));expect(prototype.visible).toBe(false);expect(pump.visible).toBe(true);expect(flow.visible).toBe(false);
    const rotor=pump.getObjectByName('water-pump-rotor')!;expect(rotor.rotation.z).toBe(0);
    scene.update(3,0,0,0,false,context([task()]));expect(flow.visible).toBe(true);expect(rotor.rotation.z).not.toBe(0);
    for(const invalid of [{status:'paused' as const},{kind:'travel'},{targetObjectId:'repair-bench'},{locationId:'spare-parts-house'}]){scene.update(4,0,0,0,false,context([task(invalid)]));expect(flow.visible).toBe(false);expect(projectActivityView(task(invalid))).toBeNull();}
    objectState(locations,'floating-frame').project_assets!.small_water_pump!.status='broken';scene.applyState(locations);scene.update(5,0,0,0,false,context([task()]));expect(flow.visible).toBe(false);
    disposeObject(scene.root);
  });
  it('keeps draft ratios, actual served samples, and accepted recipes as different facts',()=>{
    const locations=initial(),stove=objectState(locations,'trial-stove'),table=objectState(locations,'shared-table');
    stove.project_drafts={'leaf-signature-soup':{project_id:'leaf-signature-soup',recorded_at:'2026-10-05T11:00:00Z',inputs:[{resource:'moss',count:2},{resource:'water',count:1}],yield_count:3}};
    const scene=buildCompanionScenery(locations);scene.update(1,0,0,0,true,context([]));
    const paper=scene.root.getObjectByName('project-leaf-recipe')!,bowl=scene.root.getObjectByName('project-soup-tasting-bowl')!,label=scene.root.getObjectByName('project-signature-dish-label')!,steam=scene.root.getObjectByName('project-soup-task-steam')!;
    expect(paper.visible).toBe(true);expect(label.visible).toBe(false);expect(bowl.visible).toBe(false);
    scene.update(2,0,0,0,false,context([task({locationId:'warm-pot-courtyard',targetObjectId:'trial-stove',activityId:'soup-cook-trial',kind:'craft'})]));expect(steam.visible).toBe(true);expect(bowl.visible).toBe(false);
    scene.update(3,0,0,0,false,context([task({locationId:'warm-pot-courtyard',targetObjectId:'trial-stove',activityId:'soup-confirm-recipe',kind:'craft'})]));expect(steam.visible).toBe(true);expect(label.visible).toBe(false);
    table.project_batches={'leaf-signature-soup':{batch_id:'actual-batch',status:'awaiting_taste',prepared_at:'2026-10-05T12:00:00Z',served_at:'2026-10-05T12:20:00Z',expires_at:'2026-10-06T12:00:00Z',remaining_portions:3,feedback:[]}};
    scene.applyState(locations);scene.update(999999,1,0,0,true,context([]));expect(bowl.visible).toBe(true);expect(label.visible).toBe(false);expect(steam.visible).toBe(false);
    stove.recipe_book={'leaf-signature-soup':{project_id:'leaf-signature-soup',name:'叶香招牌汤',accepted_at:'2026-10-06T03:00:00Z',inputs:stove.project_drafts['leaf-signature-soup']!.inputs,yield_count:3}};
    table.project_batches['leaf-signature-soup']!.status='expired';scene.applyState(locations);scene.update(4,0,0,0,true,context([]));expect(label.visible).toBe(true);expect(bowl.visible).toBe(false);expect(label.userData.recipe_name).toBe('叶香招牌汤');
    disposeObject(scene.root);
  });
  it('freezes reduced-motion work effects and retains bounded geometry without settling anything',()=>{
    const locations=initial();objectState(locations,'floating-frame').project_assets={small_water_pump:installedPump()};
    const scene=buildCompanionScenery(locations),before=JSON.stringify(locations),flow=scene.root.getObjectByName('project-pump-water-flow') as THREE.InstancedMesh;
    let count=0;scene.root.traverse(()=>count++);scene.update(10,0,0,0,true,context([task()]));const matrix=[...flow.instanceMatrix.array];
    scene.update(30,0,0,0,true,context([task()]));expect([...flow.instanceMatrix.array]).toEqual(matrix);expect(scene.root.getObjectByName('project-installed-pump')!.getObjectByName('water-pump-rotor')!.rotation.z).toBe(0);
    expect(JSON.stringify(locations)).toBe(before);let after=0;scene.root.traverse(()=>after++);expect(after).toBe(count);disposeObject(scene.root);
  });
});
