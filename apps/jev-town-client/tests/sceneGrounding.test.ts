import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import {createCitizenFigure,disposeObject} from '../src/three/buildScene.ts';
import {captureFigureGrounding,forestFigureBaseY,forestGroundingWeight,groundFigureRings} from '../src/three/sceneGrounding.ts';
import {windleafHeightAt} from '../src/three/windleafLayout.ts';
import {createWindleafScene} from '../src/three/windleafScene.ts';
import {sceneWorkAnchor,sceneWorkTarget} from '../src/three/sceneWorkplace.ts';
import {SHAPING_FORMS} from '../src/three/shapingFigures.ts';
import samples from '../src/deskbot/windleafReviewFixtures.json';
import type {DeskBotWorldMap} from '../src/deskbot/types.ts';

const soles=(figure:ReturnType<typeof createCitizenFigure>)=>{
  figure.group.updateWorldMatrix(true,true);
  return Math.min(...[figure.limbs.legLeft,figure.limbs.legRight].map(leg=>new THREE.Box3().setFromObject(leg).min.y));
};

describe('forest residents stand on the visible surface',()=>{
  it('measures scaled model soles and places every resident on the actual forest path, not its local origin',()=>{
    for(const style of [...Object.keys(SHAPING_FORMS),undefined]){
      const figure=createCitizenFigure(0,7,style),reference=captureFigureGrounding(figure);
      expect(reference.footY).toBeGreaterThan(0);
      if(style)expect(reference.footY).toBeCloseTo((.35+.30-.10-.18)*1.35,5);
      for(const [x,y] of [[116,50],[150,30],[190,65]]){
        const point=mapToWorld(x!,y!);
        figure.group.position.set(point.x,forestFigureBaseY(reference,x!,y!),point.z);
        expect(soles(figure)).toBeCloseTo(windleafHeightAt(x!,y!)+.055,5);
      }
      disposeObject(figure.group);
    }
  });
  it('grounds town terraces and forest paths without cancelling animation',()=>{
    const figure=createCitizenFigure(0,1,'shaping-001'),reference=captureFigureGrounding(figure);
    expect(forestFigureBaseY(reference,80,68)).toBeCloseTo(windleafHeightAt(80,68)+.055-reference.footY);
    expect(forestGroundingWeight(80)).toBe(1);expect(forestGroundingWeight(114)).toBe(1);
    expect(Math.abs(forestFigureBaseY(reference,112.001,50)-forestFigureBaseY(reference,112,50))).toBeLessThan(.001);
    groundFigureRings(figure,reference,1);
    expect(figure.focusRing.position.y-reference.footY).toBeCloseTo(.06);
    groundFigureRings(figure,reference,0);
    expect(figure.focusRing.position.y).toBe(reference.focusRingY);expect(figure.pulseRing.position.y).toBe(reference.pulseRingY);
    figure.body.position.y=.08;figure.limbs.legLeft.rotation.x=.5;
    const base=forestFigureBaseY(reference,150,30);groundFigureRings(figure,reference,1);
    expect(base).toBeCloseTo(windleafHeightAt(150,30)+.055-reference.footY);
    expect(figure.body.position.y).toBe(.08);expect(figure.limbs.legLeft.rotation.x).toBe(.5);
    disposeObject(figure.group);
  });
  it('uses the real deck beneath front and reversed frames and preserves the task-facing target',()=>{
    const map=(samples as unknown as {samples:Record<string,{map:DeskBotWorldMap}>}).samples.installed!.map;
    const scene=createWindleafScene(map.locations)!,rack=scene.objects.get('windleaf-rack')!,frame=rack.getObjectByName('leaf-frame-slot:0')!;
    const figure=createCitizenFigure(0,1,'shaping-001'),reference=captureFigureGrounding(figure);
    for(const rotation of [0,Math.PI]){
      frame.rotation.y=rotation;
      const anchor=sceneWorkAnchor(frame,new THREE.Vector3(),'leaf-read');
      expect(anchor.y).toBeCloseTo(rack.position.y+.18,5);
      const target=sceneWorkTarget(frame,'leaf-read')!;
      expect(target).toEqual(frame.localToWorld(new THREE.Vector3(0,1.6,0)));
      figure.group.position.copy(anchor);figure.group.position.y-=reference.footY;
      expect(soles(figure)).toBeCloseTo(rack.position.y+.18,5);
    }
    const anchor=sceneWorkAnchor(rack,new THREE.Vector3(),'leaf-install');
    expect(anchor.y).toBeCloseTo(rack.position.y+.18,5);
    disposeObject(scene.root);disposeObject(figure.group);
  });
});
