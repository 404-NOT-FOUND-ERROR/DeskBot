import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import {createWindleafVegetation} from './windleafVegetation.ts';
import {PALETTE} from './palette.ts';
import {WINDLEAF_BLUEPRINT as B,windleafHeightAt,windleafTerrainHeightAt,windleafStreamAt,windleafPathDistanceAt} from './windleafLayout.ts';
import {shapingCoastDistance} from './shapingLandform.ts';
import {shapingTerrainVertex,clipShapingCoast} from './shapingSurface.ts';

type Point={x:number,y:number};
const hash=(n:number)=>{const v=Math.sin(n*127.1+13.1)*43758.5;return v-Math.floor(v);};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ROOT_HEIGHT=-3;
const WATER_HEIGHT=-.36;
const PATH_OFFSET=.055;
const PATH_HALF_WIDTH=1.7;
const C={soil:0xffe3a1,grass:0x99db88,earth:0x9cbd8a,bark:0x8a7864,stone:0xaeb6c4};

/** Broad, irregular ground patches keep the work areas legible without four round pads. */
export function windleafClearingRadius(index:number,angle:number){
  const r=B.terrain.clearings[index]!.r;
  return r*(.93+.11*Math.sin(angle*3+index*.8)+.065*Math.cos(angle*5-index));
}
function inClearing(x:number,y:number,margin=0){
  return B.terrain.clearings.some((p,i)=>Math.hypot(x-p.x,y-p.y)<windleafClearingRadius(i,Math.atan2(y-p.y,x-p.x))+margin);
}
function surfaceGeometry(vertices:number[],colors?:number[]){
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  if(colors)geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.computeVertexNormals();return geometry;
}
function worldVertex(p:Point,offset=0,clearing=false){
  const w=mapToWorld(p.x,p.y);
  // Clearings have a coarser polar mesh than paths. Recess their road overlap
  // so independent facet interpolation cannot leave wedges across a path.
  const clearance=clearing?.24*clamp((4.3-windleafPathDistanceAt(p.x,p.y))/2):0;
  return [w.x,windleafHeightAt(p.x,p.y)+offset-clearance,w.z];
}
function appendTriangle(out:number[],a:Point,b:Point,c:Point,offset=0,clearing=false){out.push(...worldVertex(a,offset,clearing),...worldVertex(b,offset,clearing),...worldVertex(c,offset,clearing));}
function routeSamples(points:readonly Point[]){
  const result:Point[]=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!,steps=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y));
    for(let n=0;n<steps;n++)result.push({x:a.x+(b.x-a.x)*n/steps,y:a.y+(b.y-a.y)*n/steps});
  }
  result.push({...points[points.length-1]!});return result;
}
/** Route centres are identical to the six public, server-admitted polylines. */
export function windleafRouteSurfaceSamples(){
  return B.passages.map(p=>({passageId:p.passage_id,points:routeSamples(p.presentation_points).filter(p=>p.x>=110)}));
}
function terrainColor(x:number,y:number){
  const stream=windleafStreamAt(x,y),height=windleafHeightAt(x,y),color=new THREE.Color(C.grass);
  const patch=clamp((Math.sin(x*.16+y*.09)+Math.cos(x*.04-y*.17))*.18+.3);
  color.lerp(new THREE.Color(0xbddd83),patch);
  if(height>1)color.lerp(new THREE.Color(0xc9de87),clamp((height-1)/9)*.4);
  if(shapingCoastDistance(x,y)<8)color.lerp(new THREE.Color(0xe8df9a),clamp((8-shapingCoastDistance(x,y))/8)*.8);
  if(Math.hypot(x-150,y-30)<20)color.lerp(new THREE.Color(0x87a788),.22);
  if(stream.distance<stream.width+4)color.lerp(new THREE.Color(0xb9baa0),clamp((stream.width+4-stream.distance)/4)*.6);
  return color;
}

export function createWindleafLandscape(){
  const root=new THREE.Group();root.name='windleaf-landscape';root.userData.decorativeOnly=true;
  const vegetation=createWindleafVegetation({inClearing});root.add(vegetation.root);
  const plants=vegetation.root.userData.plants as {x:number,y:number,size:number}[];
  function surfaceColor(x:number,y:number){
    const color=terrainColor(x,y);
    let cover=0;
    for(const p of plants)cover=Math.max(cover,clamp(1-Math.hypot(x-p.x,y-p.y)/(2.8+p.size*1.5)));
    // Mottled moss/leaf litter under actual stands, continuous across the former
    // map boundary; this is surface colour, not a simulated resource or event.
    color.lerp(new THREE.Color(0x68a88a),cover*.33);
    const litter=clamp(Math.sin(x*.73+y*.61)*Math.cos(y*.49-x*.38));
    return color.lerp(new THREE.Color(0x928159),litter*cover*.18);
  }
  const terrainPositions:number[]=[],terrainColors:number[]=[];
  // An indexed-looking faceted tessellation, represented as one vertex-colour mesh.
  // 1.25 map units keeps path edges and the creek bed on the same sampled surface.
  const cell=2;
  for(let x=112;x<220;x+=cell)for(let y=0;y<120;y+=cell){
    if(shapingCoastDistance(x+cell/2,y+cell/2)< -3)continue;
    const corners=[{x,y},{x,y:y+cell},{x:x+cell,y:y+cell},{x:x+cell,y}];
    for(const triangle of [[0,1,2],[0,2,3]]){
      const color=surfaceColor(x+cell*.5,y+cell*.5).multiplyScalar(.985+hash(x*17+y*11+triangle[1]!)*.03);
      for(const clipped of clipShapingCoast(triangle.map(index=>shapingTerrainVertex(corners[index]!.x,corners[index]!.y))))for(const p of clipped){
        const w=mapToWorld(p.x,p.y);terrainPositions.push(w.x,windleafTerrainHeightAt(p.x,p.y),w.z);terrainColors.push(color.r,color.g,color.b);
      }
    }
  }
  const terrain=new THREE.Mesh(surfaceGeometry(terrainPositions,terrainColors),new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true}));
  terrain.name='windleaf-terrain';terrain.receiveShadow=true;root.add(terrain);
  const walls:number[]=[];
  const perimeter:Point[]=[];
  for(let x=112;x<220;x+=2)perimeter.push({x,y:0});
  for(let y=0;y<120;y+=2)perimeter.push({x:220,y});
  for(let x=220;x>=112;x-=2)perimeter.push({x,y:120});
  for(let i=0;i<perimeter.length-1;i++){
    const a=worldVertex(perimeter[i]!),b=worldVertex(perimeter[(i+1)%perimeter.length]!);
    walls.push(...a,a[0]!,ROOT_HEIGHT,a[2]!,...b,...b,a[0]!,ROOT_HEIGHT,a[2]!,b[0]!,ROOT_HEIGHT,b[2]!);
  }
  const side=new THREE.Mesh(surfaceGeometry(walls),new THREE.MeshLambertMaterial({color:PALETTE.slabSide,flatShading:true,side:THREE.DoubleSide}));side.name='windleaf-terrain-edge';side.visible=false;root.add(side);

  const paths:number[]=[],pathColors:number[]=[];
  const sampledRoutes=windleafRouteSurfaceSamples();
  for(const route of sampledRoutes){
    const edges=route.points.map((point,index)=>{
      const before=route.points[Math.max(0,index-1)]!,after=route.points[Math.min(route.points.length-1,index+1)]!;
      const dx=after.x-before.x,dy=after.y-before.y,len=Math.hypot(dx,dy)||1;
      const width=PATH_HALF_WIDTH*(1+.10*Math.sin(point.x*.8+point.y*.6)+.06*Math.cos(point.y*1.7));
      return [{x:point.x-dy/len*width,y:point.y+dx/len*width},{x:point.x+dy/len*width,y:point.y-dx/len*width}] as const;
    });
    for(let i=1;i<edges.length;i++){
      const a=edges[i-1]!,b=edges[i]!;
      appendTriangle(paths,a[0],b[0],a[1],PATH_OFFSET);appendTriangle(paths,a[1],b[0],b[1],PATH_OFFSET);
      const center=route.points[i]!,color=new THREE.Color(PALETTE.pavement).lerp(new THREE.Color(C.soil),clamp((center.x-112)/8));
      color.multiplyScalar(.98+.035*Math.sin(center.x*.3+center.y*.4));
      for(let v=0;v<6;v++)pathColors.push(color.r,color.g,color.b);
    }
  }
  const road=new THREE.Mesh(surfaceGeometry(paths,pathColors),new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true,side:THREE.DoubleSide}));road.name='windleaf-route-surface';road.receiveShadow=true;road.userData.routes=sampledRoutes;root.add(road);
  const clearingPositions:number[]=[],clearingColors:number[]=[];
  B.terrain.clearings.forEach((p,index)=>{
    const angularSteps=28,rings=10;
    const ringPoint=(ring:number,angle:number)=>{const r=windleafClearingRadius(index,angle)*ring/rings;return {x:p.x+Math.cos(angle)*r,y:p.y+Math.sin(angle)*r};};
    for(let ring=0;ring<rings;ring++)for(let k=0;k<angularSteps;k++){
      const a=k*Math.PI*2/angularSteps,b=(k+1)*Math.PI*2/angularSteps;
      const p0=ringPoint(ring,a),p1=ringPoint(ring,b),p2=ringPoint(ring+1,a),p3=ringPoint(ring+1,b);
      const before=clearingPositions.length;
      if(ring)appendTriangle(clearingPositions,p0,p1,p2,PATH_OFFSET*.7,true);
      appendTriangle(clearingPositions,p2,p1,p3,PATH_OFFSET*.7,true);
      for(let v=before;v<clearingPositions.length;v+=3){
        const x=clearingPositions[v]!+60,y=clearingPositions[v+2]!+60;
        const radius=Math.hypot(x-p.x,y-p.y)/windleafClearingRadius(index,Math.atan2(y-p.y,x-p.x));
        const color=new THREE.Color(0xc2b490).lerp(surfaceColor(x,y),clamp((radius-.30)/.70));
        clearingColors.push(color.r,color.g,color.b);
      }
    }
  });
  const clearings=new THREE.Mesh(surfaceGeometry(clearingPositions,clearingColors),new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true,side:THREE.DoubleSide}));clearings.name='windleaf-work-clearings';clearings.receiveShadow=true;root.add(clearings);

  // A continuous ribbon follows the creek's admitted visual centreline. There is no bridge.
  const streamPoints=routeSamples(B.terrain.stream),waterPositions:number[]=[],waterColors:number[]=[];
  const creekEdges=streamPoints.map((p,i)=>{
    const a=streamPoints[Math.max(0,i-1)]!,b=streamPoints[Math.min(streamPoints.length-1,i+1)]!,len=Math.hypot(b.x-a.x,b.y-a.y)||1;
    const width=windleafStreamAt(p.x,p.y).width;
    if(i===0||i===streamPoints.length-1)return [{x:p.x-width,y:p.y},{x:p.x+width,y:p.y}];
    return [{x:p.x-(b.y-a.y)/len*width,y:p.y+(b.x-a.x)/len*width},{x:p.x+(b.y-a.y)/len*width,y:p.y-(b.x-a.x)/len*width}];
  });
  for(let i=1;i<creekEdges.length;i++){
    if(shapingCoastDistance(streamPoints[i]!.x,streamPoints[i]!.y)<2)continue;
    const a=creekEdges[i-1]!,b=creekEdges[i]!,color=new THREE.Color(0x47bcb8).lerp(new THREE.Color(0x88e4cd),.45+.3*Math.sin(i*.08));
    for(const p of [a[0]!,b[0]!,a[1]!,a[1]!,b[0]!,b[1]!]){const w=mapToWorld(p.x,p.y);waterPositions.push(w.x,WATER_HEIGHT,w.z);waterColors.push(color.r,color.g,color.b);}
  }
  const creek=new THREE.Mesh(surfaceGeometry(waterPositions,waterColors),new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,flatShading:true}));creek.name='windleaf-creek';creek.receiveShadow=true;root.add(creek);
  const ripplePositions:number[]=[];
  for(let i=4;i<streamPoints.length-4;i+=6){
    if(shapingCoastDistance(streamPoints[i]!.x,streamPoints[i]!.y)<2)continue;
    const p=streamPoints[i]!,w=mapToWorld(p.x,p.y),s=.5+hash(i)*.7;
    ripplePositions.push(w.x-s,WATER_HEIGHT+.02,w.z,w.x+s,WATER_HEIGHT+.02,w.z+.1,w.x+.5,WATER_HEIGHT+.02,w.z+.22);
  }
  const ripples=new THREE.Mesh(surfaceGeometry(ripplePositions),new THREE.MeshBasicMaterial({color:0xb4d3cb,side:THREE.DoubleSide}));ripples.name='windleaf-creek-ripples';root.add(ripples);

  root.userData.plants=vegetation.root.userData.plants;
  root.userData.transition={start:112,end:132,sharedFoundation:true,internalWall:false};
  return {root,update(time:number,wind:number,wet:number,reduced:boolean){
    terrain.material.color.setHex(0xffffff).lerp(new THREE.Color(0xb7c7be),clamp(wet)*.35);
    creek.material.color.setHex(0xffffff).lerp(new THREE.Color(0xa9c4c0),clamp(wet)*.2);
    vegetation.update(time,wind,wet,reduced);
    ripples.material.color.setHex(0xb4d3cb).multiplyScalar(reduced?1:.94+Math.sin(time*.7)*.06);
  }};
}
