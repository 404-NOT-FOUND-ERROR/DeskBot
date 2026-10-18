import blueprint from '../../../../world-content/companion-world/windleaf-region.v1.json';
import type {DeskBotLocation} from '../deskbot/types.ts';
import {shapingTownHeightAt,shapingCoastHeight,shapingOuterRelief,shapingPoolGround,shapingPathDistance} from './shapingLandform.ts';
import {SHAPING_RENDER_BOUNDS} from './shapingProjection.ts';
import {shapingBridgeAt,shapingChannelGround} from './shapingWaterway.ts';
export const WINDLEAF_BLUEPRINT=blueprint;
export function hasWindleaf(locations:readonly DeskBotLocation[]|undefined){return Boolean(locations?.some(p=>p.location_id==='windleaf-edge'&&p.presentation?.space==='jev-town-map-v2'));}
export function worldSceneBounds(locations?:readonly DeskBotLocation[]){return hasWindleaf(locations)?SHAPING_RENDER_BOUNDS:{min_x:0,min_y:0,max_x:120,max_y:120};}
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
function segmentProjection(x:number,y:number,a:{x:number,y:number},b:{x:number,y:number}){
  const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy));
  return {distance:Math.hypot(x-a.x-dx*t,y-a.y-dy*t),x:a.x+dx*t,y:a.y+dy*t,t};
}
/** Visual creek only. Its width never creates a new crossing or an inventory source. */
export function windleafStreamAt(x:number,y:number){
  let closest={distance:Infinity,x:0,y:0,t:0};
  for(let i=1;i<blueprint.terrain.stream.length;i++){
    const p=segmentProjection(x,y,blueprint.terrain.stream[i-1]!,blueprint.terrain.stream[i]!);
    if(p.distance<closest.distance)closest=p;
  }
  return {...closest,width:2.45+Math.sin(closest.y*.19)*.28+Math.sin(closest.y*.51)*.12};
}
export function windleafPathDistanceAt(x:number,y:number){
  let distance=Infinity;
  for(const path of blueprint.passages)for(let i=1;i<path.presentation_points.length;i++)
    distance=Math.min(distance,segmentProjection(x,y,path.presentation_points[i-1]!,path.presentation_points[i]!).distance);
  return distance;
}
/** One shared surface for terrain, path, character feet and placed objects.
 * Render-only topography: never changes server travel duration or admitted geography. */
function uncutHeightAt(x:number,y:number){
  if(x<=112)return shapingTownHeightAt(x,y);
  // Replace the former raised perimeter lawn with a graded forest verge.
  // Both admitted exits cut through it at street level; figures and scenery
  // sample this same height so neither route is buried under a decorative tile.
  const verge=.35*smooth((x-112)/2)*(1-smooth((x-120)/10))*smooth((windleafPathDistanceAt(x,y)-1.8)/1.5);
  const edge=smooth((x-120)/10);
  const hill=smooth(1-Math.hypot((x-190)/29,(y-65)/26));
  const hollow=smooth(1-Math.hypot((x-150)/23,(y-30)/20));
  const rolling=(Math.sin(x*.09+y*.035)+Math.cos(y*.12-x*.03))*.17;
  const shellRidge=10*smooth(1-Math.hypot((x-181)/32,(y-6)/22));
  const land=shapingCoastHeight(x,y,verge+edge*(.46+7.2*hill+shellRidge-.85*hollow+rolling*(1-hill)*(1-hollow))+shapingOuterRelief(x,y));
  const stream=windleafStreamAt(x,y);
  if(stream.distance<=stream.width)return -.95+.08*Math.sin(stream.y*.12)+.57*smooth(stream.distance/stream.width);
  const bank=smooth((stream.distance-stream.width)/3.8);
  return land*bank+(-.38+.08*Math.sin(stream.y*.12))*(1-bank);
}
function groundSurface(x:number,y:number){return shapingPoolGround(x,y,shapingChannelGround(x,y,uncutHeightAt(x,y)));}
export function windleafTerrainHeightAt(x:number,y:number){
  const path=Math.min(shapingPathDistance(x,y),windleafPathDistanceAt(x,y));
  return groundSurface(x,y)-.28*smooth((3.5-path)/1.6);
}
export function windleafHeightAt(x:number,y:number){
  const bridge=shapingBridgeAt(x,y);
  return bridge?uncutHeightAt(x,y)+1.25*Math.sin(bridge.t*Math.PI):groundSurface(x,y);
}
