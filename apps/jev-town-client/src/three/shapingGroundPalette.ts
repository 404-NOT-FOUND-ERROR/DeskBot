import * as THREE from 'three';
import {projectShapingPoint} from './shapingProjection.ts';
import {SHAPING_REGIONS,shapingCoastDistance} from './shapingLandform.ts';

const unit=(n:number)=>Math.max(0,Math.min(1,n));
/** One continuous palette field across the town/forest mesh boundary. Soil
 * and vegetation may add local cover, but cannot paint a rectangular biome. */
export function shapingGroundColor(x:number,y:number,height:number){
  const patch=(Math.sin(x*.12+y*.07)+Math.cos(y*.14-x*.08))*.5;
  const color=new THREE.Color(0xa9d77d);
  color.lerp(new THREE.Color(0xd9df98),unit(patch)*.46);
  color.lerp(new THREE.Color(0x77bc98),unit(-patch)*.32);
  if(height>9)color.lerp(new THREE.Color(0xc4bfd1),unit((height-9)/10)*.66);
  const p=projectShapingPoint(x,y);
  for(const region of SHAPING_REGIONS){
    const weight=unit(1-Math.hypot(p.x-region.x,p.y-region.y)/region.radius);
    color.lerp(new THREE.Color(region.color),weight*.7);
  }
  const edge=shapingCoastDistance(x,y);
  if(edge<9)color.lerp(new THREE.Color(0xe2dba6),unit(1-edge/9)*.76);
  return color;
}
