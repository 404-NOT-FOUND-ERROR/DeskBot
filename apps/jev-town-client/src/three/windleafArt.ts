import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import type {DeskBotLocation, DeskBotObjectState, WindleafFrame} from '../deskbot/types.ts';
import {createSoftLightTexture, type SceneLifeContext} from './sceneLifeEffects.ts';
import {LowPolyBatch} from './lowPolyBatch.ts';
import {hasWindleaf, windleafHeightAt} from './windleafLayout.ts';
import {createWindleafLandscape} from './windleafLandscape.ts';
import {addWindleafPlaceDetails} from './windleafPlaceDetails.ts';
import {attachForestArrivalAnchors} from './forestArrival.ts';

const C={wood:0xa17b54,dark:0x554b3e,cream:0xe7dec4,teal:0x628e83,stone:0xa6afa0,jade:0xbde7b4};
const clamp=(n:number)=>Math.max(0,Math.min(1,n));

function branch(batch:LowPolyBatch,a:number[],b:number[],radius:number,color:number){
  const from=new THREE.Vector3(...a as [number,number,number]),to=new THREE.Vector3(...b as [number,number,number]);
  const direction=to.clone().sub(from),mid=from.clone().add(to).multiplyScalar(.5);
  const geometry=new THREE.CylinderGeometry(radius*.7,radius,direction.length(),5);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));
  batch.add(geometry,mid.x,mid.y,mid.z,color);
}

/** Folded leaf silhouette, shared by finite source leaves and collected samples. */
function leafGeometry(){
  const shape=new THREE.Shape();shape.moveTo(0,-.8);shape.lineTo(.48,-.25);shape.lineTo(.5,.35);shape.lineTo(0,.95);shape.lineTo(-.5,.35);shape.lineTo(-.48,-.25);shape.closePath();
  const g=new THREE.ExtrudeGeometry(shape,{depth:.07,bevelEnabled:false});g.rotateX(-Math.PI/2);return g;
}
function makeLeaf(geometry:THREE.BufferGeometry){
  const group=new THREE.Group();
  const body=new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({color:0x9cb97a,emissive:C.jade,emissiveIntensity:0,flatShading:true}));body.name='light-leaf-surface';body.castShadow=true;group.add(body);
  const veins=new LowPolyBatch();veins.box(.055,.025,1.35,0,.10,-.05,0xe5ffce);
  for(const z of [-.35,.05,.4])for(const side of [-1,1])veins.box(.035,.025,.43,side*.16,.11,z,0xe5ffce,side*.7);
  const mesh=veins.finish(group,'leaf-veins')!;mesh.material.emissive.setHex(0xb9c6a0);mesh.material.emissiveIntensity=.6;mesh.castShadow=false;
  return {group,body,veins:mesh};
}
function clothGeometry(level:number){
  const shape=new THREE.Shape();shape.moveTo(-1.35,0);shape.lineTo(1.35,0);shape.lineTo(1.35,-1.72);
  if(level>0){shape.lineTo(.9,-1.72);shape.lineTo(.74,-1.42);shape.lineTo(.54,-1.72);}
  shape.lineTo(-1.35,-1.72);shape.closePath();
  if(level===2){const hole=new THREE.Path();hole.moveTo(.25,-.62);hole.lineTo(.88,-.8);hole.lineTo(.62,-1.31);hole.lineTo(.25,-.62);shape.holes.push(hole);}
  return new THREE.ShapeGeometry(shape);
}

export function createWindleafScene(locations:readonly DeskBotLocation[]){
  if(!hasWindleaf(locations))return null;
  const root=new THREE.Group();root.name='windleaf-full-region';
  const landscape=createWindleafLandscape();root.add(landscape.root);
  const objects=new Map<string,THREE.Group>();
  function anchor(id:string,x:number,y:number){const p=mapToWorld(x,y),g=new THREE.Group();g.name=id;g.position.set(p.x,windleafHeightAt(x,y),p.z);g.userData.inspection_anchor=[0,1.5,0];g.userData.work_anchor=[0,0,2.8];root.add(g);objects.set(id,g);return g;}
  const source=anchor('windleaf-canopy',150,30),stone=anchor('windleaf-observation-stone',146,31),rack=anchor('windleaf-rack',190,65),basin=anchor('windleaf-rain-basin',197,69),table=anchor('windleaf-return-table',145,95),waymarker=anchor('windleaf-waymarker',122,47);
  source.userData.inspection_anchor=[0,4.2,.5];rack.userData.inspection_anchor=[0,1.8,.6];
  const geometry=leafGeometry(),softLight=createSoftLightTexture();

  // A recognisable forked crown, with a clear foreground observation space.
  const tree=new LowPolyBatch();branch(tree,[0,0,-1.6],[.2,4.4,-1.6],.72,C.wood);branch(tree,[.2,3,-1.6],[-3.8,6.5,-2],.42,C.wood);branch(tree,[0,3.4,-1.6],[3.1,7.5,-2.4],.44,C.wood);
  branch(tree,[-2.5,5.2,-2],[-4.6,6.4,-.3],.22,C.wood);branch(tree,[2,6,-2.2],[4.6,6.4,-.7],.23,C.wood);
  for(const [x,y,z,s,color] of [[-4,7,-2,2.7,0x8ca471],[-1.6,7.8,-3,2.8,0x9bb681],[2.1,8.6,-3.1,2.8,0x7f9b68],[4.5,7,-1.2,2.2,0x91ac77]])tree.rock(s!,x!,y!,z!,color!);
  for(let i=0;i<5;i++)branch(tree,[0,.5,-1.5],[Math.cos(i*1.3)*2.8,.05,-1.5+Math.sin(i*1.3)*1.5],.22,C.dark);
  tree.finish(source,'light-leaf-tree');
  const leafSlots=Array.from({length:8},(_,i)=>{const leaf=makeLeaf(geometry);leaf.group.position.set(-3.8+(i%4)*2.5,4.1+Math.floor(i/4)*1.45,-.3-Math.floor(i/4)*1.7);leaf.group.rotation.z=(i%2?1:-1)*.3;leaf.group.rotation.x=.25;leaf.group.name=`finite-light-leaf:${i}`;source.add(leaf.group);return leaf;});
  const folds=Array.from({length:3},(_,i)=>{
    const points=[-2.2,0,0, 0,-.55,.8, 2.1,.3,-.1, -2.2,0,0, 0,-.55,.8, -.4,-.8,-.3, 0,-.55,.8, 2.1,.3,-.1, .4,-.9,.5];
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.computeVertexNormals();
    const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:i===1?0xe0edbc:0xb0e6cb,transparent:true,opacity:0,side:THREE.DoubleSide,depthWrite:false}));mesh.name=`retained-wind-fold:${i}`;mesh.position.set(-2.5+i*2.5,4.7+(i%2)*1.4,.3);mesh.rotation.y=i*.7;source.add(mesh);return mesh;
  });
  const observation=new LowPolyBatch();observation.rock(1.6,0,.25,0,C.stone);observation.box(.9,.06,.7,0,.94,.25,C.cream);observation.box(.12,.06,.65,.28,1,.25,C.teal);observation.finish(stone,'observation-stone');

  // Three fixed positions remain empty until their actual owner installs a frame.
  const shelter=new LowPolyBatch();shelter.box(14,.18,10,0,0,-.5,C.wood);
  for(let i=0;i<9;i++)shelter.box(13.8,.018,.035,0,.181,-4.8+i*1.05,0x806443);
  for(const x of [-6,6])for(const z of [-4.8,-1.5])shelter.box(.28,4.3,.28,x,.18,z,C.dark);
  shelter.box(12.7,.25,.3,0,4.2,-1.5,C.wood);shelter.roof(15,3.6,1,0,4.42,-3.3,C.teal);
  rack.userData.roofDimensions={width:15,depth:3.6,height:1,baseY:4.42,centerZ:-3.3};
  shelter.box(10,.23,1.6,0,1.55,-3.25,C.wood);
  for(const x of [-4.5,4.5])shelter.box(.2,1.55,1.3,x,0,-3.25,C.dark);
  shelter.box(10,1.1,.15,0,2,-4.25,0xb99971);
  for(let i=0;i<5;i++){shelter.box(.10,.65,.1,-2.8+i*1.15,2.25,-4.08,C.dark);shelter.box(.4,.12,.14,-2.8+i*1.15,2.84,-4.07,0x959c8f);}
  for(const x of [-6,6])branch(shelter,[x,3,-1.5],[x+(x<0?1:-1),4.15,-1.5],.09,C.wood);
  for(let slot=0;slot<3;slot++)for(const x of [-1.3,1.3]){shelter.box(.5,.08,1.1,(slot-1)*3.9+x,.18,.6,C.dark);shelter.cylinder(.065,.04,(slot-1)*3.9+x,.26,.7,0xbbad89);}
  shelter.finish(rack,'wind-shelter');
  const fabrics=[0,1,2].map(clothGeometry);
  const frames=Array.from({length:3},(_,i)=>{
    const group=new THREE.Group();group.name=`leaf-frame-slot:${i}`;group.position.set((i-1)*3.9,.27,.6);group.userData.work_anchor=[0,0,2.35];group.userData.inspection_anchor=[0,1.6,0];rack.add(group);
    const frame=new LowPolyBatch();for(const x of [-1.5,1.5]){frame.box(.20,2.8,.22,x,0,-.15,C.wood);frame.box(.35,.18,1.35,x,0,.20,C.dark);branch(frame,[x,.35,.6],[x,1.65,-.15],.065,0xb69a6b);}
    frame.box(3.25,.21,.2,0,2.72,-.15,C.dark);frame.box(3.25,.16,1.6,0,.7,.5,C.wood);frame.box(3.25,.15,.10,0,.86,1.25,C.dark);frame.box(.24,.24,.25,1.5,2.3,-.15,C.teal);frame.finish(group,'collection-frame');
    const shutter=new THREE.Group();shutter.position.set(0,2.65,0);shutter.name='actual-leaf-shutter';group.add(shutter);
    const fabricMaterial=new THREE.MeshLambertMaterial({color:C.cream,side:THREE.DoubleSide,flatShading:true});
    const cloth=fabrics.map((g,index)=>{const m=new THREE.Mesh(g,fabricMaterial);m.name=index===0?'cloth-shutter':`cloth-wear:${index}`;m.castShadow=true;shutter.add(m);return m;});
    const patches=Array.from({length:3},(_,n)=>{const patch=new THREE.Group();patch.name=`retained-patch:${n}`;patch.position.set(n===0?.58:n===1?-.67:.15,n===0?-.93:n===1?-1.28:-.35,.025);shutter.add(patch);const b=new LowPolyBatch();b.box(.7,.56,.018,0,-.28,0,n===0?C.teal:n===1?0xb69a68:0x8b9d87);for(const x of [-.32,.32])for(const y of [-.21,.21])b.box(.08,.15,.022,x,y-.06,.014,C.cream);b.finish(patch,'patch-and-stitches');return patch;});
    const leaves=[-.77,.77].map(x=>{const leaf=makeLeaf(geometry);leaf.group.position.set(x,.88,.45);leaf.group.scale.setScalar(.83);leaf.group.rotation.y=x*.25;group.add(leaf.group);return leaf;});
    const record=new THREE.Group();record.name='actual-measurement-notebook';record.position.set(.55,.87,-.22);group.add(record);const note=new LowPolyBatch();note.box(.85,.06,.5,0,0,0,C.dark);note.box(.79,.045,.46,0,.06,0,C.cream);note.box(.06,.05,.45,-.22,.105,0,C.teal);note.finish(record,'record-pages');
    const tool=new THREE.Group();tool.name='actual-repair-tool';tool.position.set(1.2,1,.6);group.add(tool);const tm=new LowPolyBatch();tm.box(.1,.46,.1,0,0,0,C.dark);tm.box(.35,.12,.13,0,.4,0,0xb6b6a0);tm.finish(tool,'repair-tool');
    return {group,shutter,cloth,fabricMaterial,patches,leaves,record,tool,data:undefined as WindleafFrame|undefined};
  });

  // Genuine hollow ring: the water surface never sits under an opaque lid.
  const basinModel=new LowPolyBatch();basinModel.cylinder(1.22,.14,0,0,0,0x7c8c82);
  for(let i=0;i<8;i++){const angle=i/8*Math.PI*2;basinModel.box(.83,.9,.27,Math.sin(angle)*1.15,.12,Math.cos(angle)*1.15,i%2?0xa2ac9f:0xb2bbab,angle);}
  basinModel.finish(basin,'hollow-rain-basin');
  const basinWater=new THREE.Mesh(new THREE.CircleGeometry(1,8),new THREE.MeshLambertMaterial({color:0x77aeb4,side:THREE.DoubleSide}));basinWater.name='actual-basin-water';basinWater.rotation.x=-Math.PI/2;basin.add(basinWater);

  const returnModel=new LowPolyBatch();returnModel.box(7,.22,3,0,1.3,0,C.wood);for(const x of [-2.8,2.8])for(const z of [-1,1])returnModel.box(.2,1.3,.2,x,0,z,C.dark);
  returnModel.box(7,.22,.8,0,.5,2.2,C.wood);for(const x of [-2.7,2.7])returnModel.box(.2,.5,.8,x,0,2.2,C.dark);
  // Empty basket walls are fixtures; contents below always read the real stock.
  returnModel.box(3,.08,1.8,0,1.52,0,C.cream);for(const z of [-.9,.9])returnModel.box(3,.4,.08,0,1.6,z,C.wood);for(const x of [-1.5,1.5])returnModel.box(.08,.4,1.8,x,1.6,0,C.wood);returnModel.finish(table,'return-table');
  const stockResources=['wood','cloth','fasteners','light_leaf','leaf_frame_kit'] as const;
  const stores=stockResources.map((resource,i)=>{const g=new THREE.Group();g.name=`return-stock:${resource}`;g.position.set(-1.1+i*.55,1.63,0);table.add(g);const m=new LowPolyBatch();m.box(.43,.35,.7,0,0,0,[C.wood,C.teal,0x929c97,0xa4bf83,C.cream][i]!);m.finish(g,'finite-stored-material');return {group:g,resource};});
  const signs=new LowPolyBatch();signs.cylinder(.16,3,0,0,0,C.dark);signs.box(2.4,.55,.18,0,2.2,0,C.wood);signs.box(.6,.55,.2,1.15,2.2,0,C.teal);signs.box(.15,.55,.2,-.65,2.2,0,C.cream);signs.finish(waymarker,'repaired-waymarker');
  addWindleafPlaceDetails(objects);
  attachForestArrivalAnchors(objects);

  // These visibly old guide posts are authored background, never stock or a new route.
  const guide=new LowPolyBatch();for(const [x,y] of [[116,47.3],[121,53],[129,53],[141,92]]){const p=mapToWorld(x!,y!),h=windleafHeightAt(x!,y!);guide.box(.7,1.7,.65,p.x,h,p.z,0xa9af99);guide.box(.16,.4,.07,p.x+.1,h+1.1,p.z+.34,C.dark);guide.box(.35,.09,.07,p.x,h+1.35,p.z+.34,C.teal);}guide.finish(root,'authored-old-light-guide-posts');

  const flags:THREE.Group[]=[];
  for(const [x,y] of [[199,61],[124,52]]){const p=mapToWorld(x!,y!),h=windleafHeightAt(x!,y!),batch=new LowPolyBatch();batch.cylinder(.09,3.8,p.x,h,p.z,C.wood);batch.finish(root,'wind-ribbon-post');const g=new THREE.Group();g.position.set(p.x,h+3.4,p.z);const ribbon=new LowPolyBatch();ribbon.box(1.8,.38,.025,.8,0,0,0xc4b779);ribbon.finish(g,'wind-ribbon');root.add(g);flags.push(g);}
  const lamps: {mesh:THREE.Mesh<THREE.BoxGeometry,THREE.MeshBasicMaterial>,pool:THREE.Mesh<THREE.CircleGeometry,THREE.MeshBasicMaterial>,light:THREE.PointLight|null,working:boolean}[]=[];
  for(const [x,y,working] of [[185,68,true],[124,54,false],[144,98,false]] as const){
    const p=mapToWorld(x,y),h=windleafHeightAt(x,y),b=new LowPolyBatch();b.box(.14,2.9,.14,p.x,h,p.z,C.dark);b.box(.7,.12,.7,p.x,h+2.9,p.z,C.dark);b.box(.65,.08,.65,p.x,h+2.18,p.z,C.wood);b.finish(root,'local-lamp-housing');
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(.43,.57,.43),new THREE.MeshBasicMaterial({color:0x463f34}));mesh.name=working?'windleaf-work-lamp':`windleaf-path-lamp:${x}:${y}`;mesh.position.set(p.x,h+2.55,p.z);root.add(mesh);
    const pool=new THREE.Mesh(new THREE.CircleGeometry(working?5:2.8,16),new THREE.MeshBasicMaterial({map:softLight,color:0xf8ce79,transparent:true,opacity:0,depthWrite:false}));pool.rotation.x=-Math.PI/2;pool.position.set(p.x,h+.21,p.z);pool.name=working?'actual-work-light-pool':'path-light-pool';root.add(pool);
    const light=working?new THREE.PointLight(0xffd594,0,13,2):null;if(light){light.position.set(p.x,h+2.55,p.z);light.name='actual-work-local-light';light.castShadow=false;root.add(light);}lamps.push({mesh,pool,light,working});
  }
  let states=new Map<string,DeskBotObjectState>();
  function applyState(next:readonly DeskBotLocation[]){
    states=new Map(next.flatMap(p=>p.areas??[]).flatMap(a=>a.objects??[]).filter(o=>o.state).map(o=>[o.object_id,o.state!]));
    for(const [id,g] of objects)g.userData.state=states.get(id);
    const data=states.get('windleaf-rack')?.leaf_frames??[];
    for(const [i,m] of frames.entries()){
      m.data=data.find(f=>f.slot===i);m.group.visible=Boolean(m.data);m.group.userData.frame_id=m.data?.frame_id;m.group.userData.owner_id=m.data?.owner_id;
      if(!m.data)continue;const d=m.data,wear=d.condition<.45?2:d.condition<.78?1:0;
      m.cloth.forEach((c,j)=>c.visible=j===wear);m.fabricMaterial.color.setHex(C.cream).lerp(new THREE.Color(0x77867b),clamp(d.moisture)*.42);
      m.patches.forEach((p,j)=>p.visible=j<d.patches);m.record.visible=d.read_count>0;m.tool.visible=false;m.group.rotation.y=d.exposure==='leeward'?Math.PI:0;
      m.leaves.forEach(leaf=>{leaf.body.material.color.setHex(d.moisture>.8?0x6b9583:0x9dbb7c);leaf.body.material.emissiveIntensity=d.brightness*.8;leaf.veins.visible=d.pattern>.12;leaf.veins.scale.x=.35+clamp(d.pattern)*.65;});
    }
    const sourceState=states.get('windleaf-canopy'),count=Math.floor(sourceState?.stock?.light_leaf??0);
    leafSlots.forEach((leaf,i)=>{leaf.group.visible=i<count;leaf.body.material.emissiveIntensity=(sourceState?.charge??0)*.3;leaf.veins.visible=false;});
    const level=clamp(states.get('windleaf-rain-basin')?.water_level??0);basinWater.visible=level>.01;basinWater.position.y=.17+level*.69;basinWater.userData.level=level;
    stores.forEach(({group,resource})=>{const count=states.get('windleaf-return-table')?.stock?.[resource]??0;group.visible=count>0;group.scale.y=.7+Math.min(5,count)*.16;group.userData.quantity=count;});
  }
  applyState(locations);
  return {root,objects,applyState,update(time:number,night:number,wind:number,wet:number,reduced:boolean,context?:SceneLifeContext){
    landscape.update(time,wind,wet,reduced);
    flags.forEach((g,i)=>{g.rotation.y=reduced?0:Math.sin(time*1.3+i)*Math.min(wind,12)*.035;g.rotation.z=reduced?0:Math.sin(time*2+i)*Math.min(wind,12)*.025;});
    const trace=states.get('windleaf-canopy')?.wind_trace;
    folds.forEach((mesh,i)=>{mesh.visible=Boolean(trace?.active&&trace.intensity>0);mesh.material.opacity=clamp(trace?.intensity??0)*(.22+night*.15);mesh.rotation.z=reduced?0:Math.sin(time*.7+i)*.055;});
    for(const m of frames){if(!m.data)continue;const angle=m.data.shutter==='open'?-Math.PI*.46:m.data.shutter==='half'?-Math.PI*.22:0;m.shutter.rotation.x=angle+(reduced?0:Math.sin(time*1.8)*Math.min(wind,12)*.002);
      const activity=context?.activities.find(a=>a.status==='running'&&a.targetObjectId==='windleaf-rack'&&a.actorId===m.data!.owner_id);m.tool.visible=activity?.activityId==='leaf-repair';m.tool.rotation.z=reduced?0:Math.sin(time*4)*.18;
    }
    const working=Boolean(context?.activities.some(a=>a.status==='running'&&a.locationId==='windleaf-shelter'&&['care','craft','observe'].includes(a.kind)));
    for(const lamp of lamps){const power=night*(lamp.working?(working?1:0):.6),target=new THREE.Color(0x463f34).lerp(new THREE.Color(lamp.working?0xf0cf84:0xbaa26d),power);lamp.mesh.material.color.lerp(target,reduced?1:.06);lamp.pool.material.opacity=THREE.MathUtils.lerp(lamp.pool.material.opacity,power*.3,reduced?1:.06);if(lamp.light)lamp.light.intensity=THREE.MathUtils.lerp(lamp.light.intensity,power*12,reduced?1:.06);}
  }};
}
