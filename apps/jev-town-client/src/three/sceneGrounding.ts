import * as THREE from 'three';
import type {CitizenFigure} from './buildScene.ts';
import {windleafHeightAt} from './windleafLayout.ts';

export type FigureGrounding={footY:number;focusRingY:number;pulseRingY:number};

/** Capture the unposed soles once, including the model's own scale. Animating
 * legs must never move this reference and cancel the walking/breathing pose. */
export function captureFigureGrounding(figure:CitizenFigure):FigureGrounding{
  figure.group.updateWorldMatrix(true,true);
  const inverse=figure.group.matrixWorld.clone().invert(),bounds=new THREE.Box3();
  for(const leg of [figure.limbs.legLeft,figure.limbs.legRight])leg.traverse(child=>{
    if(!(child instanceof THREE.Mesh))return;
    child.geometry.computeBoundingBox();
    if(child.geometry.boundingBox)bounds.union(child.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(child.matrixWorld)));
  });
  return {footY:bounds.isEmpty()?0:bounds.min.y,focusRingY:figure.focusRing.position.y,pulseRingY:figure.pulseRing.position.y};
}

/** The expanded world now has town terraces as well as forest relief. All
 * residents use their measured soles; the legacy flat scene opts out upstream. */
export function forestGroundingWeight(_x:number){return 1;}
export function forestFigureBaseY(reference:FigureGrounding,x:number,y:number){
  return windleafHeightAt(x,y)+forestGroundingWeight(x)*(.055-reference.footY);
}
export function groundFigureRings(figure:CitizenFigure,reference:FigureGrounding,weight:number){
  figure.focusRing.position.y=THREE.MathUtils.lerp(reference.focusRingY,reference.footY+.06,weight);
  figure.pulseRing.position.y=THREE.MathUtils.lerp(reference.pulseRingY,reference.footY+.08,weight);
}
