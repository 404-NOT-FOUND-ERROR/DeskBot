import {routeBetween, type RoutePoint} from '@shared/routes.ts';
import catalog from '../../../../world-content/companion-world/map.v1.json';
import forest from '../../../../world-content/companion-world/windleaf-region.v1.json';
import {projectShapingPoint,unprojectShapingPoint} from './shapingProjection.ts';

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
export const SHAPING_VISUAL_BOUNDS={min_x:-126,min_y:-96,max_x:270,max_y:226};
export const SHELL_LANDMARKS=[
  {x:132,y:46,r:27,depth:26,rotation:.20,name:'old-form-sanctuary'},
  {x:74,y:77,r:16,depth:20,rotation:-.28,name:'split-shell-ridge'},
  {x:238,y:65,r:20,depth:21,rotation:-.18,name:'windward-shell'},
  {x:179,y:226,r:17,depth:20,rotation:-.48,name:'estuary-shell'},
].map(p=>({...p,...unprojectShapingPoint(p.x,p.y)}));
const townLots=catalog.locations.flatMap(place=>place.presentation?.lot?[place.presentation.lot]:[]);

/** Retain the lanes used by authored neighbours in both travel directions.
 * Unused grid streets no longer dictate the whole landscape. */
export const SHAPING_TOWN_PATHS:readonly (readonly RoutePoint[])[]=(function(){
  const paths:RoutePoint[][]=[];
  for(const from of catalog.locations)for(const id of from.neighbors){
    const to=catalog.locations.find(p=>p.location_id===id);
    if(to&&from.presentation&&to.presentation)paths.push(routeBetween(from.presentation.point,to.presentation.point));
  }
  for(const path of forest.passages)if(path.presentation_points.some(p=>p.x<112))paths.push(path.presentation_points);
  for(const place of catalog.locations)if(place.presentation?.lot)paths.push([place.presentation.lot,place.presentation.point]);
  return paths;
})();

export function shapingPathDistance(x:number,y:number){
  let distance=Infinity;
  for(const points of SHAPING_TOWN_PATHS)for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!,dx=b.x-a.x,dy=b.y-a.y;
    const t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1));
    distance=Math.min(distance,Math.hypot(x-a.x-dx*t,y-a.y-dy*t));
  }
  return distance;
}
/** The same irregular coast clips ground and vegetation. All functional
 * places stay inside; this boundary grants no new simulation territory. */
export function shapingCoastDistance(x:number,y:number){
  const point=projectShapingPoint(x,y),dx=(point.x-141)/143,dy=(point.y-140)/125,a=Math.atan2(dy,dx);
  const radius=1+.035*Math.sin(a*5+.4)+.025*Math.cos(a*9);
  return (radius-Math.hypot(dx,dy))*84;
}
export const SHAPING_REGIONS=[
  {name:'旧壳脊',x:132,y:46,color:0xd6cce6,height:17,radius:34},
  {name:'折光湿地',x:43,y:133,color:0x86dad0,height:0,radius:37},
  {name:'星屑台地',x:146,y:239,color:0xd9c2d5,height:11,radius:30},
  {name:'风语林',x:244,y:137,color:0x8bc98f,height:0,radius:46},
] as const;
export function shapingOuterRelief(x:number,y:number){
  const p=projectShapingPoint(x,y);
  return SHAPING_REGIONS.reduce((h,r)=>h+r.height*smooth(1-Math.hypot(p.x-r.x,p.y-r.y)/r.radius),0);
}
export const shapingLogicalPoint=unprojectShapingPoint;
export const SHAPING_POOLS=[{x:42,y:128,rx:19,ry:25},{x:62,y:164,rx:17,ry:14},{x:30,y:169,rx:13,ry:17}];
export function shapingPoolGround(x:number,y:number,land:number){
  const point=projectShapingPoint(x,y);let result=land;
  for(const p of SHAPING_POOLS){
    const d=Math.hypot((point.x-p.x)/p.rx,(point.y-p.y)/p.ry),t=smooth((1.19-d)/.29);
    result=result*(1-t)-1.7*t;
  }
  return result;
}
export function shapingCoastHeight(x:number,y:number,height:number){
  return -3.1+(height+3.1)*smooth(shapingCoastDistance(x,y)/9);
}
function baseHeight(x:number,y:number){
  return (1.1+6.4*smooth((93-y)/86)+1.6*Math.sin(x*.035+y*.015))*smooth((112-x)/20);
}
/** Shared terrain for paths, feet and work facilities. Lots are level
 * terraces, with sloping routes between them. */
export function shapingTownHeightAt(x:number,y:number) {
  let base=baseHeight(x,y),clear=Infinity;
  for(const p of townLots){
    const d=Math.max(Math.abs(x-p.x),Math.abs(y-p.y)),weight=smooth((13-d)/4.4);
    clear=Math.min(clear,d-8.6);base=base*(1-weight)+baseHeight(p.x,p.y)*weight;
  }
  const safe=smooth((shapingPathDistance(x,y)-2.1)/3.7)*smooth(clear/4.5);
  const hill=(cx:number,cy:number,rx:number,ry:number,h:number)=>h*smooth(1-Math.hypot((x-cx)/rx,(y-cy)/ry));
  const relief=hill(41,8,31,23,13)+hill(97,17,22,28,10)+hill(99,83,13,18,7)+hill(60,80,14,13,4);
  return shapingCoastHeight(x,y,base+safe*relief+shapingOuterRelief(x,y));
}
export function shapingLandmarkFootprint(x:number,y:number,padding=0) {
  return SHELL_LANDMARKS.some(p=>Math.abs(x-p.x)<p.r+padding&&Math.abs(y-p.y)<p.depth*.65+padding);
}
