import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import type {DeskBotLocation} from '../deskbot/types.ts';
import {LowPolyBatch} from './lowPolyBatch.ts';
import {windleafHeightAt,windleafPathDistanceAt} from './windleafLayout.ts';
import {shapingPathDistance,shapingLandmarkFootprint} from './shapingLandform.ts';

const hash=(n:number)=>{const x=Math.sin(n*73.27+41.6)*41351.7;return x-Math.floor(x);};
/** Town terraces, threshold gardens and a graded bridge approach. These are
 * authored scenery. All functional objects continue to use their original IDs. */
export function createSettlementVerge(locations:readonly DeskBotLocation[]){
  const root=new THREE.Group();root.name='settlement-verges';root.userData.state_scope='authored_scenery';
  const stone=new LowPolyBatch(),plants=new LowPolyBatch(),furniture=new LowPolyBatch();
  const lots=locations.flatMap(p=>p.presentation?.lot?[{...p.presentation.lot,kind:p.presentation.model}]:[]);
  const safe=(x:number,y:number,margin=2.2)=>Math.min(shapingPathDistance(x,y),windleafPathDistanceAt(x,y))>margin;
  const cover=(x:number,y:number,s:number,seed:number)=>{
    const p=mapToWorld(x,y),h=windleafHeightAt(x,y);
    for(let n=0;n<3;n++){
      const geometry=new THREE.IcosahedronGeometry(s*(.7+hash(seed+n)*.35),0);geometry.scale(1,.7,.8);
      plants.add(geometry,p.x+(hash(seed+n*3)-.5)*s,h+s*.35,p.z+(hash(seed+n*5)-.5)*s,seed%4===0?0xbfa7c1:n%2?0x7eb08c:0x95bd87);
    }
  };
  for(const [i,lot] of lots.entries()){
    const top=windleafHeightAt(lot.x,lot.y);
    // Back and side edges only: the complete front arrival and working yard
    // remain open. A varying low retaining course visually anchors each terrace.
    for(let n=0;n<18;n++){
      if((n+i*2)%11===0)continue;
      const angle=Math.PI*(.91+(i%3)*.035)+n/17*Math.PI*(1.05+(i%2)*.09),radius=8.05+Math.sin(n*.7+i)*.24;
      const x=lot.x+Math.cos(angle)*radius,y=lot.y+Math.sin(angle)*radius;
      if(!safe(x,y,2))continue;
      const p=mapToWorld(x,y),ground=windleafHeightAt(x,y),base=Math.min(top,ground)-.14;
      const h=Math.max(.32,top-base+.18),g=new THREE.BoxGeometry(1.15,h,.56);g.rotateY(-angle+Math.PI/2);
      stone.add(g,p.x,base+h/2,p.z,n%4===0?0xb8b8b7:0xc5c5ad);
      if(n%4===0)cover(x+Math.cos(angle)*.6,y+Math.sin(angle)*.6,.65,i*41+n);
    }
    // One offset entrance rest ledge rather than a fence around every lot.
    if(lot.kind!=='waterside'){
      const x=lot.x+5.3,y=lot.y+6.8,p=mapToWorld(x,y);
      furniture.box(1.8,.16,.55,p.x,top+.46,p.z,0xa58d6e);
      for(const dx of [-.65,.65])furniture.cylinder(.10,.46,p.x+dx,top,p.z,0x727b68);
    }
  }
  // Break the abrupt lawn-to-forest switch with sparse groups, then denser
  // saplings on the far bank. River and both admitted bridge decks stay clear.
  for(let i=0;i<95;i++){
    const x=94+hash(i+2)*39,y=15+hash(i+71)*91;
    if(!safe(x,y,3.8)||shapingLandmarkFootprint(x,y,-4)||lots.some(p=>Math.abs(x-p.x)<9&&Math.abs(y-p.y)<9))continue;
    const h=windleafHeightAt(x,y);if(h<.15)continue;
    cover(x,y,.55+hash(i+47)*.75,i);
    if(i%6===0){
      const p=mapToWorld(x,y),height=2.2+hash(i+81)*1.6;
      furniture.cylinder(.11,height,p.x,h,p.z,0x8b8b71);
      const crown=new THREE.IcosahedronGeometry(1.05,0);crown.scale(.8,1.3,.8);
      plants.add(crown,p.x,h+height,p.z,0x8ab79e);
    }
  }
  stone.finish(root,'settlement-retaining-courses');
  plants.finish(root,'settlement-verge-plants');
  furniture.finish(root,'settlement-threshold-details');
  return root;
}
