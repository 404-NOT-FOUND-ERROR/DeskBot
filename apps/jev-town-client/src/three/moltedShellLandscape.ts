import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import type {DeskBotLocation} from '../deskbot/types.ts';
import {COTTAGE_SPECS,TREE_SPECS} from './sceneSpec.ts';
import {LowPolyBatch} from './lowPolyBatch.ts';
import {shellSpiralGeometry,shellVaultGeometry} from './moltedShellGeometry.ts';
import {SHAPING_VISUAL_BOUNDS as B,SHELL_LANDMARKS,SHAPING_TOWN_PATHS,shapingCoastDistance,shapingPathDistance,shapingPathHalfWidth,shapingLandmarkFootprint} from './shapingLandform.ts';
import {windleafHeightAt,windleafTerrainHeightAt} from './windleafLayout.ts';
import {shapingTerrainVertex,clipShapingCoast,clipSurfacePolygon} from './shapingSurface.ts';
import {createShapingWaterScene} from './shapingWaterScene.ts';
import {createShapingOuterLand} from './shapingOuterLand.ts';
import {shapingGroundColor} from './shapingGroundPalette.ts';
import {addShellHouse,architectureFrame,type ShellHouseKind} from './shapingArchitecture.ts';
import {createSettlementVerge} from './shapingSettlementVerge.ts';

const hash=(n:number)=>{const a=Math.sin(n*127.1+17.4)*43758.5453;return a-Math.floor(a);};
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const shades=[0xf3ecc6,0xd6dbef,0xb4e3ca,0xe4bfce,0xaed5d3];
const groundAt=windleafHeightAt;
function geometry(positions:number[],colors?:number[]) {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  if(colors)g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}
function triangle(points:{x:number,y:number}[],positions:number[],colors:number[],color:THREE.Color,offset=0,terrain=false) {
  for(const p of points){const w=mapToWorld(p.x,p.y);positions.push(w.x,(terrain?windleafTerrainHeightAt(p.x,p.y):groundAt(p.x,p.y))+offset,w.z);colors.push(color.r,color.g,color.b);}
}

export function createMoltedShellLandscape(locations:readonly DeskBotLocation[]) {
  const root=new THREE.Group();root.name='shaping-molted-shell-world';
  root.userData={visualVersion:'molted-shell-round1',decorativeOnly:true,canonicalLocations:locations.map(p=>p.location_id)};
  const landmarks=new THREE.Group();landmarks.name='old-shape-geology';root.add(landmarks);
  const waterway=createShapingWaterScene();root.add(waterway.root);
  const outerLand=createShapingOuterLand();root.add(outerLand.root);
  const verge=createSettlementVerge(locations);root.add(verge);
  const ground:number[]=[],groundColors:number[]=[],paths:number[]=[],pathColors:number[]=[];
  const lots=locations.flatMap(p=>p.presentation?.lot?[p.presentation.lot]:[]);
  const reserved=(x:number,y:number,r=8.6)=>lots.some(p=>Math.abs(x-p.x)<r&&Math.abs(y-p.y)<r);
  for(let x=B.min_x;x<B.max_x;x+=2)for(let y=B.min_y;y<B.max_y;y+=2) {
    // The forest retains its own shared, deformable terrain and creek. The new
    // surface meets it along x=112 without a slab or an internal cliff wall.
    if(x>=112&&x<220&&y>=0&&y<120)continue;
    const edge=shapingCoastDistance(x+1,y+1);if(edge< -3)continue;
    const color=shapingGroundColor(x+1,y+1,groundAt(x+1,y+1));
    for(const tri of [[{x,y},{x,y:y+2},{x:x+2,y:y+2}],[{x,y},{x:x+2,y:y+2},{x:x+2,y}]])
      for(const clipped of clipShapingCoast(tri.map(p=>shapingTerrainVertex(p.x,p.y))))triangle(clipped,ground,groundColors,color,0,true);
  }
  const surface=new THREE.Mesh(geometry(ground,groundColors),new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true}));
  surface.name='shaping-town-terrain';surface.receiveShadow=true;root.add(surface);

  // One height-sampled mesh avoids overlapping ribbons and z-fighting at
  // shared junctions. Every authored travel line remains on the path surface.
  const cell=.8;
  const lane=(x:number,y:number)=>shapingPathHalfWidth(x,y)-shapingPathDistance(x,y);
  for(let x=8;x<112;x+=cell)for(let y=27;y<113;y+=cell){
    if(lane(x+cell/2,y+cell/2)<-1)continue;
    const pathColour=new THREE.Color(0xe9d3a1).lerp(new THREE.Color(0xd4c18e),.12+.08*Math.sin(x*.35+y*.19));
    for(const tri of [[{x,y},{x,y:y+cell},{x:x+cell,y:y+cell}],[{x,y},{x:x+cell,y:y+cell},{x:x+cell,y}]])
      for(const clipped of clipSurfacePolygon(tri,lane))triangle(clipped,paths,pathColors,pathColour,.09);
  }
  const road=new THREE.Mesh(geometry(paths,pathColors),new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide}));road.name='shaping-town-paths';road.userData.routes=SHAPING_TOWN_PATHS;road.receiveShadow=true;root.add(road);

  const buildings=new LowPolyBatch(),details=new LowPolyBatch(),vegetation=new LowPolyBatch();
  const windows:THREE.Mesh[]=[];
  const windowGeometry=new THREE.CircleGeometry(.33,10);
  function vault(batch:LowPolyBatch,x:number,y:number,z:number,w:number,h:number,d:number,colour:number,rotation=0) {
    const shell=shellVaultGeometry(w,h,d,.26);
    batch.add(shell.outer,x,y,z,colour,rotation);batch.add(shell.inner,x,y,z,0x548a91,rotation);batch.add(shell.rim,x,y,z,0xffedbd,rotation);
  }
  // Entrances retain a low threshold. Curved verges replace identical fenced
  // rectangles and ornamental arches around every functional location.
  lots.forEach((p,i)=>{
    const w=mapToWorld(p.x,p.y),base=groundAt(p.x,p.y);
    for(let n=0;n<3;n++)details.box(2.5-n*.15,.07,.58,w.x,base+.015*n,w.z+6.8+n*.55,0xd5c9a8);
    for(const side of [-1,1]){details.cylinder(.34,.5,w.x+side*6.9,base,w.z+5.8,0xbca584);details.rock(.45,w.x+side*6.9,base+.85,w.z+5.8,i%2?0x94b779:0xb4b386);}
  });
  const houseKinds:ShellHouseKind[]=['vault','split','lantern','petal'];
  const houseSpecs:{x:number;y:number;kind:ShellHouseKind}[]=[];
  COTTAGE_SPECS.forEach((house,i)=>{
    const x=house.x+60,y=house.z+60;if(reserved(x,y)||x>111||shapingCoastDistance(x,y)<10||shapingLandmarkFootprint(x,y,1)||shapingPathDistance(x,y)>8)return;
    const base=groundAt(x,y),scale=house.scale,w=(4.2+hash(i+101)*1.4)*scale,h=(3.4+hash(i+209)*1.5)*scale,d=(3.8+hash(i+77)*1.8)*scale;
    // Shell openings face the same arrival street as the former cottages.
    const rotation=[Math.PI,Math.PI/2,0,-Math.PI/2][house.facing]??0;
    const kind=houseKinds[i%houseKinds.length]!;
    houseSpecs.push({x,y,kind});
    const architecture=addShellHouse(architectureFrame(buildings,house.x,base,house.z,rotation),{kind,width:w,height:h,depth:d,color:shades[i%shades.length]!});
    const local=(a:number,b:number)=>({x:house.x+Math.cos(rotation)*a+Math.sin(rotation)*b,z:house.z-Math.sin(rotation)*a+Math.cos(rotation)*b});
    for(const window of architecture.windows) {
      const p=local(window.x,window.z);
      const glow=new THREE.Mesh(windowGeometry,new THREE.MeshBasicMaterial({color:0xffd879,transparent:true,opacity:0}));
      glow.scale.setScalar(window.radius/.33);glow.position.set(p.x,base+window.y,p.z);glow.rotation.y=rotation;glow.name='shell-house-window';root.add(glow);windows.push(glow);
    }
    // Everyday traces: a bench, baskets, a patch canopy, pots and a repaired rim.
    const pot=local(w*.47,d*.66);details.cylinder(.38,.53,pot.x,base,pot.z,0xb88e69);details.rock(.48,pot.x,base+.8,pot.z,0x80bb8b);
    if(i%3===0){const p=local(-w*.42,d*.8);details.box(1.5,.15,.6,p.x,base+.6,p.z,0x9a8369,rotation);details.cylinder(.1,.6,p.x-.5,base,p.z,0x736d62);details.cylinder(.1,.6,p.x+.5,base,p.z,0x736d62);}
    if(i%4===1){const p=local(0,-d*.22);details.rock(.33,p.x,base+h+.1,p.z,0xe4c67a);}
  });
  buildings.finish(root,'inhabited-shell-cottages');details.finish(root,'shell-neighbourhood-details');
  root.userData.houses=houseSpecs;

  // Existing garden-tree positions keep inhabited clearings open. Broader,
  // simpler crowns give the new rendering standard readable silhouettes.
  TREE_SPECS.forEach((tree,i)=>{
    const x=tree.x+60,y=tree.z+60;if(x>111||reserved(x,y,8.1)||shapingCoastDistance(x,y)<5||shapingLandmarkFootprint(x,y,-3)||shapingPathDistance(x,y)<2.5)return;
    const base=groundAt(x,y),s=tree.scale;
    vegetation.cylinder(.25*s,2.4*s,tree.x,base,tree.z,0x897961);
    const crown=new THREE.IcosahedronGeometry(1.7*s,1);crown.scale(1,.97,1);
    vegetation.add(crown,tree.x,base+3.3*s,tree.z,i%5===0?0xd8adca:i%3===0?0x8fca81:0x69af85);
  });
  vegetation.finish(root,'shell-town-canopies');

  for(const [i,landmark] of SHELL_LANDMARKS.entries()) {
    const w=mapToWorld(landmark.x,landmark.y),g=shellSpiralGeometry(landmark.r,landmark.r*.12,landmark.depth,1.15+i*.065);
    const p=g.getAttribute('position'),n=g.getAttribute('normal'),colors:number[]=[];
    for(let v=0;v<p.count;v++) {
      const radial=p.getX(v)*n.getX(v)+(p.getY(v)-landmark.r*.74)*n.getY(v);
      const color=new THREE.Color(radial<-.15?0x4b9aa8:Math.abs(n.getZ(v))>.65?0xd6cbe6:0xfff1ca);
      colors.push(color.r,color.g,color.b);
    }
    g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    const mesh=new THREE.Mesh(g,new THREE.MeshLambertMaterial({vertexColors:true,side:THREE.DoubleSide,flatShading:true}));
    mesh.name=landmark.name;mesh.position.set(w.x,groundAt(landmark.x,landmark.y)-landmark.r*.38,w.z);mesh.rotation.y=landmark.rotation;mesh.castShadow=true;mesh.receiveShadow=true;landmarks.add(mesh);
  }
  const outcrops=new LowPolyBatch();
  for(let i=0;i<95;i++) {
    const anchor=SHELL_LANDMARKS[i%SHELL_LANDMARKS.length]!,angle=hash(i+51)*Math.PI*2,r=anchor.r*(.7+hash(i+23)*.65);
    const x=anchor.x+Math.cos(angle)*r,y=anchor.y+Math.sin(angle)*anchor.depth*.6;
    if(shapingCoastDistance(x,y)<4||reserved(x,y,11)||shapingPathDistance(x,y)<4)continue;
    const w=mapToWorld(x,y),h=groundAt(x,y),s=1.5+hash(i+97)*4.4;
    const g=new THREE.IcosahedronGeometry(s,0);g.scale(.9,1.5,.7);g.rotateZ((hash(i+311)-.5)*.65);
    outcrops.add(g,w.x,h+s*.8,w.z,i%3===0?0xd3cbdc:0xa2b4bb);
  }
  // Half-buried curved plates extend the geology into town and forest, keeping
  // material continuity rather than putting a separate themed park beside it.
  for(const [i,p] of [{x:40,y:20,w:12},{x:100,y:20,w:10},{x:100,y:80,w:9},{x:160,y:59,w:8},{x:197,y:96,w:7}].entries()) {
    const w=mapToWorld(p.x,p.y),h=groundAt(p.x,p.y);vault(outcrops,w.x,h-.6,w.z,p.w,p.w*.6,p.w*.52,shades[i%shades.length]!,i*.53);
  }
  outcrops.finish(root,'scattered-old-form-plates');
  root.userData.landmarkCount=SHELL_LANDMARKS.length;
  root.userData.reservedLots=lots;
  root.userData.surfaceBounds=B;
  const wetTint=new THREE.Color(0xa7bdc6);
  return {root,update(time:number,night:number,minute:number,reduced:boolean,wetness=0) {
    waterway.update(time,night,reduced);
    outerLand.update(time,night,reduced);
    surface.material.color.setHex(0xffffff).lerp(wetTint,clamp(wetness)*.35);
    const hour=((minute/60)%24+24)%24;
    windows.forEach((window,i)=>{
      const bedtime=21.5+hash(i+63)*3.6,nightHour=hour<6?hour+24:hour,awake=nightHour<bedtime||hash(i+94)>.93;
      const target=night*(awake?.9:.035),m=window.material as THREE.MeshBasicMaterial;
      m.opacity=reduced?target:m.opacity+(target-m.opacity)*.035;
    });
  }};
}
