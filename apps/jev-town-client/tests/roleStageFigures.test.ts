import {describe,expect,it} from 'vitest';
import * as THREE from 'three';
import {createShapingFigure} from '../src/three/shapingFigures.ts';
import {disposeObject} from '../src/three/buildScene.ts';
import {SHAPING_ANCHORS,shapingAppearanceKey,shapingAppearanceLayers,type ShapingAppearance} from '../src/three/shapingAppearance.ts';

const appearance=(frog=false,vocation:'none'|'chef'|'workshop-maker'='none'):ShapingAppearance=>({schema:'deskbot.role-stage-appearance.v1',anchors:[...SHAPING_ANCHORS],physical_shell_changed:false,
  form:frog?{direction_id:'wetland_frog',stage_id:'frog-stage',figure_form:'leaf-frog',label:'荷叶青蛙',accessories:['leaf-collar','frog-brow']}:null,
  vocation:vocation==='none'?null:{direction_id:vocation==='chef'?'chef':'workshop_maker',stage_id:'vocation-stage',figure_vocation:vocation,label:vocation,accessories:[]}});
describe('one light being, combinable authored role layers',()=>{
  it('makes the frog a real broader silhouette and leaf collar while retaining the seed eyes and light anchors',()=>{
    const base=createShapingFigure('shaping-001',1,appearance()),frog=createShapingFigure('shaping-001',1,appearance(true));
    for(const figure of [base,frog]){
      expect(figure.group.getObjectByName('seed-eyes')).toBeDefined();expect(figure.group.getObjectByName('condensed-light-core')).toBeDefined();expect(figure.group.getObjectByName('settling-light-grains')).toBeDefined();
      expect(figure.group.userData.identity_anchors).toEqual([...SHAPING_ANCHORS]);expect(figure.group.userData.physical_shell_changed).toBe(false);
    }
    expect(new THREE.Box3().setFromObject(frog.upper).max.x).toBeGreaterThan(new THREE.Box3().setFromObject(base.upper).max.x);
    expect(frog.group.getObjectByName('leaf-collar-and-frog-brow')).toBeDefined();expect(base.group.getObjectByName('leaf-collar-and-frog-brow')).toBeUndefined();
    disposeObject(base.group);disposeObject(frog.group);
  });
  it('composes each vocation independently with each form, keeps all vertices finite and preserves admitted actual task poses',()=>{
    for(const frog of [false,true])for(const vocation of ['none','chef','workshop-maker'] as const){
      const input=appearance(frog,vocation),before=JSON.stringify(input),figure=createShapingFigure('shaping-001',1,input);
      expect(figure.group.userData.role_form).toBe(frog?'leaf-frog':'base');expect(figure.group.userData.role_vocation).toBe(vocation);
      expect(Boolean(figure.group.getObjectByName('chef-hat-and-apron'))).toBe(vocation==='chef');expect(Boolean(figure.group.getObjectByName('maker-apron-and-tool-badge'))).toBe(vocation==='workshop-maker');
      figure.group.traverse(object=>{if(object instanceof THREE.Mesh){expect([...object.geometry.getAttribute('position').array].every(Number.isFinite)).toBe(true);}});
      figure.updateLife?.(5,'craft',false,true,0,'craft-tray');expect(figure.limbs.armLeft.rotation.x).toBe(-.7);
      figure.updateLife?.(5,'idle',false,true,0,'craft-tray');expect(figure.limbs.armLeft.rotation.x).toBe(0);expect(JSON.stringify(input)).toBe(before);
      disposeObject(figure.group);
    }
  });
  it('does not style another resident or unknown layers as an accepted protagonist form',()=>{
    const other=createShapingFigure('wetland-grower-001',1,appearance(true,'chef'));
    expect(other.group.getObjectByName('leaf-collar-and-frog-brow')).toBeUndefined();expect(other.group.getObjectByName('chef-hat-and-apron')).toBeUndefined();disposeObject(other.group);
    expect(shapingAppearanceLayers({...appearance(true,'chef'),physical_shell_changed:true} as unknown as ShapingAppearance)).toEqual({form:'base',vocation:'none'});
    expect(shapingAppearanceKey(appearance(true,'chef'))).not.toBe(shapingAppearanceKey(appearance(true,'workshop-maker')));
    expect(shapingAppearanceKey(appearance(true,'chef'))).not.toBe(shapingAppearanceKey({...appearance(true,'chef'),form:null}));
  });
});
