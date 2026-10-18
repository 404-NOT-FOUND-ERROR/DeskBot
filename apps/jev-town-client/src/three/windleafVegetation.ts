import * as THREE from 'three';
import {mapToWorld,worldToMap} from '@shared/world.ts';
import {STREET_LINES} from '@shared/town.ts';
import {COTTAGE_SPECS,SIGNATURE_SPECS,TREE_SPECS} from './sceneSpec.ts';
import {LowPolyBatch} from './lowPolyBatch.ts';
import {windleafHeightAt,windleafPathDistanceAt,windleafStreamAt} from './windleafLayout.ts';
import {shapingCoastDistance,shapingLandmarkFootprint} from './shapingLandform.ts';

type Point={x:number,y:number};
type Plant=Point&{size:number,phase:number,kind:'broadleaf'|'fir'|'young',decorativeOnly:true};
type GroundPlant=Point&{size:number,phase:number};
type Options={inClearing:(x:number,y:number,margin:number)=>boolean};
type BedIsland=Point&{rx:number,ry:number,place:'shelter'|'edge'|'canopy'|'return'};
const hash=(n:number)=>{const a=Math.sin(n*127.1+13.1)*43758.5453;return a-Math.floor(a);};
const clamp=(v:number)=>Math.min(1,Math.max(0,v));
const stands=[{x:122,y:17,r:16},{x:125,y:85,r:16},{x:137,y:63,r:18},{x:166,y:11,r:20},{x:177,y:39,r:19},{x:202,y:21,r:16},{x:206,y:92,r:20},{x:171,y:105,r:18},{x:158,y:69,r:18},{x:193,y:112,r:18}];
const houseFootprints=[...COTTAGE_SPECS.map(p=>({...worldToMap(p.x,p.z),r:4.9*p.scale})),...SIGNATURE_SPECS.map(p=>({...worldToMap(p.x,p.z),r:7.5}))];
const retainedTownTrees=TREE_SPECS.filter(p=>worldToMap(p.x,p.z).x<=112).map(p=>({...worldToMap(p.x,p.z),r:2*p.scale}));
// Low planting follows individual fittings rather than the old, much larger clearing circles.
// The asymmetric islands leave approaches open and preserve a view into the work areas.
const bedIslands:BedIsland[]=[
  {x:181,y:62,rx:1.3,ry:2.3,place:'shelter'},{x:180,y:67,rx:1.6,ry:2.1,place:'shelter'},
  {x:185,y:56.8,rx:2.9,ry:1.15,place:'shelter'},{x:193,y:56.8,rx:2.8,ry:1.2,place:'shelter'},
  {x:199.5,y:62.5,rx:1.5,ry:2.2,place:'shelter'},{x:200,y:67,rx:1.2,ry:1.6,place:'shelter'},
  {x:199.5,y:72,rx:1.9,ry:1.2,place:'shelter'},{x:195,y:73,rx:1.8,ry:1.1,place:'shelter'},
  {x:181,y:73,rx:2.0,ry:1.8,place:'shelter'},
  {x:119.5,y:37,rx:2.3,ry:3.1,place:'edge'},{x:124,y:39,rx:2.4,ry:2.3,place:'edge'},
  {x:129.5,y:42,rx:2.7,ry:2.1,place:'edge'},{x:121,y:44.5,rx:1.2,ry:1.4,place:'edge'},
  {x:131,y:56,rx:2.7,ry:1.6,place:'edge'},
  {x:144,y:24,rx:1.7,ry:2.1,place:'canopy'},{x:150,y:22.4,rx:2.5,ry:1.4,place:'canopy'},
  {x:155,y:24.5,rx:1.7,ry:2.1,place:'canopy'},{x:156.5,y:34.5,rx:2.3,ry:1.3,place:'canopy'},
  {x:149.5,y:35.5,rx:1.8,ry:1.3,place:'canopy'},{x:143,y:36.5,rx:1.7,ry:1.5,place:'canopy'},
  {x:141.5,y:88.5,rx:2.3,ry:1.1,place:'return'},{x:147,y:88.5,rx:2.5,ry:1.1,place:'return'},
  {x:152.5,y:90,rx:1.1,ry:2.0,place:'return'},{x:137.5,y:99.7,rx:1.8,ry:1.4,place:'return'},
  {x:143.5,y:102,rx:2.7,ry:1.2,place:'return'},{x:150,y:102,rx:1.7,ry:1.2,place:'return'},
];

/** Physical work surfaces and inspection/approach space, independent of landscape clearings. */
export function windleafWorkFootprintContains(x:number,y:number,padding=0){
  const rectangle=(cx:number,cy:number,rx:number,ry:number)=>Math.abs(x-cx)<=rx+padding&&Math.abs(y-cy)<=ry+padding;
  if(rectangle(190,65,7.5,6)||rectangle(145,95,5.2,4.7)||rectangle(122,46.5,2.8,1.5))return true;
  return [
    {x:150,y:28.4,r:3.4},{x:146,y:31,r:2.1},{x:197,y:69,r:1.8},
    {x:125,y:50,r:3.1},{x:124,y:54,r:.6},{x:199,y:61,r:.55},
  ].some(p=>Math.hypot(x-p.x,y-p.y)<=p.r+padding);
}

/** Render-only scenery cannot mint ingredients or imply new actions. */
function oldTownOccupied(x:number,y:number,padding:number){
  if(x>=122)return false;
  if(x<120&&STREET_LINES.some(a=>Math.abs(y-a)<2+padding))return true;
  return houseFootprints.some(p=>Math.hypot(x-p.x,y-p.y)<p.r+padding)||retainedTownTrees.some(p=>Math.hypot(x-p.x,y-p.y)<p.r+padding);
}
function inBounds(x:number,y:number){return x>=114&&x<=216&&y>=3&&y<=117&&shapingCoastDistance(x,y)>5&&!shapingLandmarkFootprint(x,y,-2);}
function standDensity(x:number,y:number){
  return Math.max(...stands.map(p=>clamp(1-Math.hypot(x-p.x,y-p.y)/p.r)));
}
function surfaceGeometry(vertices:number[]){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();return g;}
function leafyFan(count:number,length:number,width:number,height:number){
  const vertices:number[]=[];
  for(let i=0;i<count;i++){
    const a=i*Math.PI*2/count,dx=Math.cos(a),dz=Math.sin(a),h=height*(.75+hash(i+80)*.4);
    vertices.push(0,0,0,dx*length*.55-dz*width,h*.65,dz*length*.55+dx*width,dx*length,h,dz*length,
      0,0,0,dx*length,h,dz*length,dx*length*.55+dz*width,h*.65,dz*length*.55-dx*width);
  }
  return surfaceGeometry(vertices);
}

/** Layered stands, hedge-like clumps and bank vegetation join the town's small
 * garden trees to a forest. Deterministic rejection keeps all six routes open. */
export function createWindleafVegetation({inClearing}:Options){
  const root=new THREE.Group();root.name='windleaf-vegetation';root.userData.decorativeOnly=true;
  const trunks=new LowPolyBatch(),smallDetails=new LowPolyBatch(),plants:Plant[]=[];
  function eligible(x:number,y:number,pathMargin:number,clearingMargin:number,bankMargin:number){
    const stream=windleafStreamAt(x,y);
    return inBounds(x,y)&&!oldTownOccupied(x,y,pathMargin*.48)&&windleafPathDistanceAt(x,y)>=pathMargin&&!inClearing(x,y,clearingMargin)&&stream.distance>=stream.width+bankMargin;
  }
  // Choose stands first, then vary crown age and silhouette inside each stand.
  // No grid of equally sized trees; town-edge trees are deliberately smaller.
  for(let i=0;i<18000&&plants.length<186;i++){
    const stand=stands[i%stands.length]!,angle=hash(i+63)*Math.PI*2,r=Math.sqrt(hash(i+200))*stand.r;
    const x=stand.x+Math.cos(angle)*r,y=stand.y+Math.sin(angle)*r;
    if(!eligible(x,y,3.75,.45,2.8))continue;
    if(hash(i+1421)>.5+standDensity(x,y)*.5)continue;
    const transition=clamp((x-115)/23),young=hash(i+621)<.17;
    const size=(young?.58:.78)+hash(i+509)*(.34+transition*.32);
    if(plants.some(p=>Math.hypot(x-p.x,y-p.y)<2.6+(p.size+size)*.35))continue;
    const kind:Plant['kind']=young?'young':hash(i+411)<.25?'fir':'broadleaf',phase=hash(i+820)*Math.PI*2;
    plants.push({x,y,size,phase,kind,decorativeOnly:true});
  }
  root.userData.plants=plants;
  plants.forEach(p=>{
    const w=mapToWorld(p.x,p.y),h=windleafHeightAt(p.x,p.y),s=p.size;
    const trunkHeight=(p.kind==='fir'?4.1:p.kind==='young'?2.2:3.3)*s;
    trunks.add(new THREE.CylinderGeometry(.14*s,.3*s,trunkHeight,5),w.x,h+trunkHeight/2,w.z,p.kind==='young'?0x9a8461:0x82694c);
    if(p.kind!=='fir'){
      for(const direction of [-1,1]){
        const branch=new THREE.CylinderGeometry(.11*s,.17*s,1.75*s,5);branch.rotateZ(direction*.7);branch.rotateY(p.phase);
        trunks.add(branch,w.x+Math.cos(p.phase)*direction*.45*s,h+2.55*s,w.z-Math.sin(p.phase)*direction*.45*s,0x82694c);
      }
    }
    // Visible root flares and the occasional fallen branch tie trunks to soil.
    if(p.kind==='broadleaf')for(let j=0;j<3;j++){
      const a=p.phase+j*Math.PI*2/3,g=new THREE.ConeGeometry(.27*s,1.25*s,4);g.rotateZ(Math.PI*.34);g.rotateY(a);
      trunks.add(g,w.x+Math.cos(a)*.3*s,h+.17*s,w.z+Math.sin(a)*.3*s,0x806b4d);
    }
  });
  trunks.finish(root,'windleaf-ground-and-trunks');

  const broad=plants.filter(p=>p.kind!=='fir'),firs=plants.filter(p=>p.kind==='fir');
  const treeMaterial=new THREE.MeshLambertMaterial({color:0xffffff,flatShading:true});
  const canopies=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,0),treeMaterial,broad.length*4);
  canopies.name='windleaf-broadleaf-canopies';canopies.castShadow=true;canopies.receiveShadow=true;root.add(canopies);
  const needles=new THREE.InstancedMesh(new THREE.ConeGeometry(1,1,7),treeMaterial,firs.length*3);
  needles.name='windleaf-fir-canopies';needles.castShadow=true;needles.receiveShadow=true;root.add(needles);
  const broadPalette=[0x75b887,0x8bc685,0xa0cd92,0x69af88,0x91c697],firPalette=[0x579c8d,0x69ac91,0x80bd98];
  broad.forEach((p,i)=>{for(let j=0;j<4;j++)canopies.setColorAt(i*4+j,new THREE.Color(broadPalette[(Math.floor(p.phase*3)+j)%broadPalette.length]!));});
  firs.forEach((p,i)=>{for(let j=0;j<3;j++)needles.setColorAt(i*3+j,new THREE.Color(firPalette[(Math.floor(p.phase)+j)%firPalette.length]!));});
  const dummy=new THREE.Object3D();
  function animateTrees(time:number,wind:number,reduced:boolean){
    broad.forEach((p,i)=>{
      const w=mapToWorld(p.x,p.y),h=windleafHeightAt(p.x,p.y),s=p.size,young=p.kind==='young';
      const sway=reduced?0:Math.sin(time*.8+p.phase)*Math.min(12,wind)*.014;
      for(let j=0;j<4;j++){
        const angle=p.phase+j*Math.PI*2/3,top=j===3,spread=top?0:.85*s;
        dummy.position.set(w.x+Math.cos(angle)*spread+sway,h+(young?2.5:3.5)*s+(top?1.05*s:0),w.z+Math.sin(angle)*spread);
        dummy.rotation.set(.1*Math.sin(p.phase),p.phase+j*.6,.08*Math.cos(p.phase));
        dummy.scale.set((top?1.4:1.45)*s,(top?1.55:1.5)*s,(top?1.4:1.5)*s);dummy.updateMatrix();canopies.setMatrixAt(i*4+j,dummy.matrix);
      }
    });
    firs.forEach((p,i)=>{
      const w=mapToWorld(p.x,p.y),h=windleafHeightAt(p.x,p.y),s=p.size,sway=reduced?0:Math.sin(time*.7+p.phase)*Math.min(12,wind)*.008;
      for(let j=0;j<3;j++){
        dummy.position.set(w.x+sway*j,h+(2.45+j*1.28)*s,w.z);dummy.rotation.set(0,p.phase,sway*.03);
        dummy.scale.set((1.65-j*.3)*s,(2.65-j*.2)*s,(1.65-j*.3)*s);dummy.updateMatrix();needles.setMatrixAt(i*3+j,dummy.matrix);
      }
    });
    canopies.instanceMatrix.needsUpdate=true;needles.instanceMatrix.needsUpdate=true;
  }
  animateTrees(0,0,true);canopies.computeBoundingSphere();needles.computeBoundingSphere();

  function groundPoints(count:number,seed:number,margin:number,bank:number,small=false):GroundPlant[]{
    const result:GroundPlant[]=[];
    for(let i=0;i<count*60&&result.length<count;i++){
      // Most understory lives beside an actual tree, the rest forms low open glades.
      const tree=plants[i%plants.length]!,a=hash(i+seed)*Math.PI*2,r=1.4+hash(i+seed+33)*4.2;
      const x=i%4?tree.x+Math.cos(a)*r:115+hash(i+seed+410)*99,y=i%4?tree.y+Math.sin(a)*r:3+hash(i+seed+520)*114;
      if(!eligible(x,y,margin,small?-1.45:-.7,bank))continue;
      if(result.some(p=>Math.hypot(x-p.x,y-p.y)<(small?.42:.8)))continue;
      result.push({x,y,size:(small?.35:.6)+hash(i+seed+18)*(small?.6:.7),phase:hash(i+seed+81)*Math.PI*2});
    }
    return result;
  }
  function instancePlants(name:string,geometry:THREE.BufferGeometry,points:GroundPlant[],palette:number[],options:{flatten?:number,height?:number,side?:THREE.Side,clumps?:number}={}){
    const material=new THREE.MeshLambertMaterial({color:0xffffff,flatShading:true,side:options.side??THREE.FrontSide}),count=options.clumps??1;
    const mesh=new THREE.InstancedMesh(geometry,material,points.length*count);mesh.name=name;mesh.receiveShadow=true;mesh.castShadow=!name.includes('grass')&&!name.includes('litter');root.add(mesh);
    points.forEach((p,i)=>{
      const w=mapToWorld(p.x,p.y),h=windleafHeightAt(p.x,p.y);
      for(let j=0;j<count;j++){
        const spread=count===1?0:.42*p.size,a=p.phase+j*Math.PI*2/3;
        dummy.position.set(w.x+Math.cos(a)*spread,h+(options.height??.035)*p.size,w.z+Math.sin(a)*spread);
        dummy.rotation.set(0,a,0);dummy.scale.set(p.size,p.size*(options.flatten??1),p.size);dummy.updateMatrix();mesh.setMatrixAt(i*count+j,dummy.matrix);mesh.setColorAt(i*count+j,new THREE.Color(palette[(i+j)%palette.length]!));
      }
    });mesh.computeBoundingSphere();return mesh;
  }
  const shrubs=groundPoints(580,3000,2.5,1.55),ferns=groundPoints(390,5000,2.05,1.2,true),grass=groundPoints(940,7000,1.95,.85,true);
  const designedRockPoints:GroundPlant[]=[],designedUnderstory:(GroundPlant&{place:BedIsland['place'],layer:'shrub'|'fern'|'grass'|'stone',decorativeOnly:true})[]=[];
  bedIslands.forEach((bed,index)=>{
    const seed=31000+index*900;
    for(const [layer,target,total,padding] of [['shrub',shrubs,7,.95],['fern',ferns,12,.6],['grass',grass,20,.38],['stone',designedRockPoints,2,.85]] as const){
      let placed=0;
      for(let i=0;i<180&&placed<total;i++){
        const a=hash(seed+i*3+total)*Math.PI*2,r=Math.sqrt(hash(seed+i*3+total+1));
        const x=bed.x+Math.cos(a)*r*bed.rx,y=bed.y+Math.sin(a)*r*bed.ry,s=windleafStreamAt(x,y);
        // The path and actual fitting footprint are authoritative here. Planting can
        // enter an old clearing only when it does not obstruct use of its facilities.
        if(!inBounds(x,y)||oldTownOccupied(x,y,padding)||windleafPathDistanceAt(x,y)<1.95+padding*.35||windleafWorkFootprintContains(x,y,padding)||s.distance<s.width+padding+.25)continue;
        if(target.some(p=>Math.hypot(x-p.x,y-p.y)<(layer==='shrub'?.73:layer==='stone'?.9:.33)))continue;
        const size=layer==='shrub'?.95+hash(seed+i+611)*.65:layer==='stone'?.65+hash(seed+i+511)*.4:.48+hash(seed+i+711)*.55;
        const point={x,y,size,phase:hash(seed+i+310)*Math.PI*2};target.push(point);designedUnderstory.push({...point,place:bed.place,layer,decorativeOnly:true});placed++;
      }
    }
  });
  root.userData.designedUnderstory=designedUnderstory;
  instancePlants('windleaf-shrub-clumps',new THREE.IcosahedronGeometry(.63,0),shrubs,[0x52765c,0x64835c,0x82985a,0x426f5e,0x739466],{clumps:3,flatten:.82,height:.46});
  const fernMesh=instancePlants('windleaf-fern-understory',leafyFan(6,1.08,.2,.55),ferns,[0x6d925c,0x8aa566,0x9dad6e],{side:THREE.DoubleSide});
  const grassMesh=instancePlants('windleaf-meadow-grass',leafyFan(5,.5,.105,.9),grass,[0x98ad66,0xb1b877,0x839958],{side:THREE.DoubleSide});

  const reedPoints:GroundPlant[]=[],bankRocks:GroundPlant[]=[];
  for(let i=0;i<1600;i++){
    const x=201+hash(i+11002)*18,y=3+hash(i+11034)*114,s=windleafStreamAt(x,y),bank=s.distance-s.width;
    if(bank>.35&&bank<3.4&&eligible(x,y,2.4,-.7,.35)){
      if(i%3===0)bankRocks.push({x,y,size:.8+hash(i+9)*1.2,phase:hash(i+83)*6.28});
      else if(bank<2.2&&reedPoints.length<150)reedPoints.push({x,y,size:.7+hash(i+41)*.65,phase:hash(i+94)*6.28});
    }
  }
  const reeds=instancePlants('windleaf-bank-reeds',leafyFan(6,.55,.09,1.8),reedPoints,[0x6d8e63,0x839860,0x7e975e],{side:THREE.DoubleSide});
  // Rocks collect around banks and groups of trunks; a few taller stones break the silhouette.
  const ridgeRocks=groundPoints(130,14000,2.8,.4).map((p,i)=>({...p,size:p.size*(i%13===0?2.1:.85)}));
  instancePlants('windleaf-rock-clusters',new THREE.IcosahedronGeometry(.74,0),[...bankRocks,...ridgeRocks,...designedRockPoints],[0x959b88,0xa5a790,0x848f83,0xb3b59a],{height:.38,flatten:.8,clumps:2});
  const litter=groundPoints(160,17000,2.3,1.4,true);
  instancePlants('windleaf-leaf-litter',leafyFan(3,.6,.2,.075),litter,[0xb6ac73,0x8d9d65,0xbaaf7e],{side:THREE.DoubleSide});

  const flowers=groundPoints(95,21000,2.1,1.5,true),mushrooms=groundPoints(38,25000,2.5,2,true);
  const flowerPoints:GroundPlant[]=[];
  flowers.forEach((p,i)=>{
    for(let j=0;j<3;j++){
      const x=p.x+Math.cos(p.phase+j*2.1)*.26,y=p.y+Math.sin(p.phase+j*2.1)*.26,w=mapToWorld(x,y),h=windleafHeightAt(x,y),height=.3+hash(i+j)*.32;
      smallDetails.cylinder(.027,height,w.x,h,w.z,0x7b9767);flowerPoints.push({x,y,size:.16+hash(i+j+33)*.09,phase:p.phase});
    }
  });
  // A low handful of pale flowers; no glowing collectible tokens.
  const blossoms=instancePlants('windleaf-meadow-blossoms',new THREE.IcosahedronGeometry(1,0),flowerPoints,[0xe1d7a1,0xcac993,0xc5b8bf],{height:2.4,flatten:.7});
  const mushroomPoints:GroundPlant[]=[];
  mushrooms.forEach((p,i)=>{
    for(let j=0;j<3;j++){
      const x=p.x+Math.cos(j*2.1+p.phase)*.22,y=p.y+Math.sin(j*2.1+p.phase)*.22,w=mapToWorld(x,y),h=windleafHeightAt(x,y),s=.23+hash(i+j)*.18;
      smallDetails.cylinder(.055,s,w.x,h,w.z,0xcfbd97);mushroomPoints.push({x,y,size:s,phase:p.phase});
    }
  });
  instancePlants('windleaf-mushroom-caps',new THREE.ConeGeometry(1,.65,7),mushroomPoints,[0xb98b6f,0xa79268,0xc0a780],{height:1,flatten:.7});
  for(let i=0;i<plants.length;i+=11){
    const p=plants[i]!,x=p.x+2,y=p.y+1;if(!eligible(x,y,2.8,-.5,2))continue;
    const w=mapToWorld(x,y),g=new THREE.CylinderGeometry(.12,.18,1.65,5);g.rotateZ(Math.PI/2);g.rotateY(p.phase);
    smallDetails.add(g,w.x,windleafHeightAt(x,y)+.15,w.z,0x8c795b);
  }
  smallDetails.finish(root,'windleaf-ground-details');
  root.userData.population={trees:plants.length,shrubs:shrubs.length,ferns:ferns.length,grass:grass.length,reeds:reedPoints.length,rockClusters:bankRocks.length+ridgeRocks.length+designedRockPoints.length,flowers:flowers.length,mushrooms:mushrooms.length};
  root.userData.understory=[...shrubs,...ferns,...grass].map(p=>({x:p.x,y:p.y,decorativeOnly:true}));
  const groundMaterials=[fernMesh.material,grassMesh.material,reeds.material] as THREE.MeshLambertMaterial[];
  let lastWind=-1,lastTime=-1;
  return {root,update(time:number,wind:number,wet:number,reduced:boolean){
    if(reduced){if(lastWind!==0)animateTrees(0,0,true);lastWind=0;}
    else if(time!==lastTime||wind!==lastWind){animateTrees(time,wind,false);lastWind=wind;}
    lastTime=time;
    for(const m of groundMaterials)m.color.setHex(0xffffff).lerp(new THREE.Color(0xb6c8b6),clamp(wet)*.24);
    blossoms.material.color.setHex(0xffffff);
  }};
}
