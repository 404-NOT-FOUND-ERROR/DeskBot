import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { mapToWorld } from "@shared/world.ts";
import type { DeskBotLocation, DeskBotObjectState } from "../deskbot/types.ts";
import { sceneOperationAt, type SceneLightChannel } from './sceneLife.ts';
import { addShapingDetails, createSceneLifeEffects, createSoftLightTexture, type SceneLifeContext } from './sceneLifeEffects.ts';
import { createResourceSupplyEffects } from './resourceSupplyEffects.ts';
import {createProjectScene} from './projectScene.ts';

const C = { wood:0x997052, dark:0x5e5142, cream:0xe8dfc3, teal:0x508e86, soil:0x765b40, leaf:0x7eab59, water:0x6eabb2, red:0xb6513c };
const solidMaterial = () => new THREE.MeshLambertMaterial({ vertexColors:true });

/** Merge the opaque primitives of each authored facility into one draw call. */
class Model {
  parts: THREE.BufferGeometry[] = [];
  constructor(readonly parent: THREE.Group) {}
  add(geometry: THREE.BufferGeometry, x:number,y:number,z:number,color:number) {
    const g=geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose(); g.deleteAttribute("uv"); g.translate(x,y,z);
    const c=new THREE.Color(color), count=g.getAttribute("position").count;
    const colors=new Float32Array(count*3);
    for(let i=0;i<count;i++) c.toArray(colors,i*3);
    g.setAttribute("color",new THREE.BufferAttribute(colors,3)); this.parts.push(g);
  }
  box(w:number,h:number,d:number,x:number,y:number,z:number,color:number) { this.add(new THREE.BoxGeometry(w,h,d),x,y+h/2,z,color); }
  ball(r:number,x:number,y:number,z:number,color:number) { this.add(new THREE.IcosahedronGeometry(r,0),x,y,z,color); }
  cylinder(r:number,h:number,x:number,y:number,z:number,color:number) { this.add(new THREE.CylinderGeometry(r,r,h,12),x,y+h/2,z,color); }
  roof(w:number,d:number,h:number,x:number,y:number,z:number,color:number) {
    const shape=new THREE.Shape();shape.moveTo(-d/2,0);shape.lineTo(d/2,0);shape.lineTo(0,h);shape.closePath();
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:w,bevelEnabled:false});
    geometry.rotateY(Math.PI/2); geometry.translate(-w/2,0,0); this.add(geometry,x,y,z,color);
  }
  finish(name:string) {
    if(!this.parts.length)return;
    const geometry=mergeGeometries(this.parts,false)!;
    this.parts.forEach(g=>g.dispose()); this.parts=[];
    const mesh=new THREE.Mesh(geometry,solidMaterial()); mesh.name=name; mesh.castShadow=true;mesh.receiveShadow=true;
    this.parent.add(mesh);return mesh;
  }
}

export interface CompanionScenery {
  root: THREE.Group;
  objects: Map<string,THREE.Group>;
  water: THREE.Mesh[];
  lamps: THREE.Mesh[];
  trees: THREE.Group[];
  flags: THREE.Group[];
  applyState: (locations: readonly DeskBotLocation[]) => void;
  update: (time:number, night:number, wind:number, wetness:number, reducedMotion:boolean, context?:SceneLifeContext) => void;
}

export function buildCompanionScenery(locations: readonly DeskBotLocation[]): CompanionScenery {
  const root=new THREE.Group();root.name="morrowmere-authored-facilities";
  const objects=new Map<string,THREE.Group>(), water:THREE.Mesh[]=[], lamps:THREE.Mesh[]=[], trees:THREE.Group[]=[], flags:THREE.Group[]=[];
  const lifeEffects:{locationId:string;effect:ReturnType<typeof createSceneLifeEffects>}[]=[];
  const supplyEffects:{locationId:string;effect:NonNullable<ReturnType<typeof createResourceSupplyEffects>>}[]=[];
  const projectEffects:{locationId:string;effect:NonNullable<ReturnType<typeof createProjectScene>>}[]=[];
  const cloth:THREE.Group[]=[];
  const glowTexture=createSoftLightTexture();
  const stockSlots=new Map<string,THREE.Group[]>();
  const stockColors:Record<string,number>={water:C.water,seeds:0xc39b51,moss:C.leaf,wood:0xb89064,cloth:0x97aba1,fasteners:0x99a0a5,frame_kit:C.teal,trays:0x735e44,rations:0xd7bb77};
  const stockSpec:Record<string,{resources:string[];x:number;y:number;z:number}>={
    'seedling-rack':{resources:['seeds','moss','trays'],x:-5,y:.3,z:.1},
    'parts-drawers':{resources:['wood','cloth','fasteners','frame_kit'],x:1.9,y:.3,z:5.2},
    'shared-table':{resources:['rations'],x:.2,y:1.76,z:4},
    'trial-stove':{resources:['water'],x:-2.2,y:.3,z:3.5},
  };
  function lamp(parent:THREE.Group,x:number,z:number,height=3.8) {
    const m=new Model(parent);m.box(.18,height,.18,x,.3,z,C.dark);
    m.box(.86,.15,.86,x,height+.4,z,0x746d56);m.box(.86,.12,.86,x,height-.4,z,0xc4a268);
    m.box(.35,.26,.35,x,.3,z,0x9ba48d);m.finish("lamp-post");
    const glow=new THREE.Mesh(new THREE.OctahedronGeometry(.51,0),new THREE.MeshBasicMaterial({color:0xffdf8b,transparent:true,opacity:.3,depthWrite:false}));
    glow.scale.set(.7,1.1,.7);glow.position.set(x,height,z);glow.name='public-lantern';
    glow.userData={light_channel:'public',location_id:parent.userData.location_id,model:parent.userData.model};parent.add(glow);lamps.push(glow);
    // A small pool of warm light, without one shadow map per lamp.
    const pool=new THREE.Mesh(new THREE.CircleGeometry(2.6,24),new THREE.MeshBasicMaterial({color:0xffca69,map:glowTexture,transparent:true,opacity:0,depthWrite:false}));
    pool.rotation.x=-Math.PI/2;pool.position.set(x,.41,z);pool.name='public-light-pool';pool.userData={...glow.userData,pool:true};parent.add(pool);lamps.push(pool);
  }
  function tree(parent:THREE.Group,x:number,z:number,seed:number) {
    const group=new THREE.Group();group.position.set(x,.3,z);parent.add(group);trees.push(group);
    const m=new Model(group);m.box(.4,2.2,.4,0,0,0,C.wood);
    m.ball(1.6,0,3,0,seed%2 ? 0x659057 : 0x89a85e);m.ball(1.2,.5,4,0,0x93b56d);m.finish("wind-canopy");
  }
  function cottage(m:Model,x:number,z:number,roof=0x718d84,w=6,wall=C.cream) {
    m.box(w,3.5,5,x,.3,z,wall);m.roof(w+.5,5.8,2,x,3.8,z,roof);
    m.box(1.1,2.1,.12,x,.3,z+2.55,C.dark);
    for(const dx of [-w*.32,w*.32]) {
      m.box(1,1.15,.15,x+dx,1.7,z+2.56,0x7bada7);
      const glow=new THREE.Mesh(new THREE.PlaneGeometry(.8,.95),new THREE.MeshBasicMaterial({color:0xffdf99,transparent:true,opacity:0}));
      glow.position.set(x+dx,2.27,z+2.65);glow.name='occupied-window';
      glow.userData={light_channel:'window',location_id:m.parent.userData.location_id,model:m.parent.userData.model,variation:lamps.length};m.parent.add(glow);lamps.push(glow);
      // Mullions, sills, and lintels keep the window legible even with its room light off.
      m.box(1.25,.15,.3,x+dx,1.62,z+2.59,C.wood);m.box(.09,1.15,.08,x+dx,1.7,z+2.69,C.cream);
      m.box(1,.08,.08,x+dx,2.27,z+2.69,C.cream);
    }
  }
  function table(m:Model,x:number,z:number,w=4) {
    m.box(w,.25,1.8,x,1.5,z,C.wood);
    for(const dx of [-w*.4,w*.4])m.box(.25,1.2,.25,x+dx,.3,z,C.dark);
    for(const dz of [-1.4,1.4]) {m.box(w,.2,.55,x,.8,z+dz,C.wood);m.box(.25,.5,.55,x-w*.4,.3,z+dz,C.dark);m.box(.25,.5,.55,x+w*.4,.3,z+dz,C.dark);}
  }
  function pond(parent:THREE.Group,x:number,z:number,w:number,d:number) {
    const m=new Model(parent);m.box(w+.5,.25,d+.5,x,.32,z,0xbabfa1);m.finish("water-bank");
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,.08,d),new THREE.MeshStandardMaterial({color:C.water,roughness:.25,transparent:true,opacity:.88}));
    mesh.name="water-level-surface";mesh.position.set(x,.55,z);mesh.receiveShadow=true;parent.add(mesh);water.push(mesh);
    return mesh;
  }
  for(const place of locations) {
    const binding=place.presentation;
    if(!binding?.lot || !binding.model)continue;
    const group=new THREE.Group();const position=mapToWorld(binding.lot.x,binding.lot.y);
    group.position.set(position.x,0,position.z);group.name=`location:${place.location_id}`;
    group.userData.location_id=place.location_id;group.userData.model=binding.model;root.add(group);
    const m=new Model(group);
    const fixture=(id:string,build:(m:Model,g:THREE.Group)=>void) => {
      const object=place.areas?.flatMap(a=>a.objects??[]).find(o=>o.object_id===id);
      if(!object)return;
      const part=new THREE.Group();part.name=`object:${id}`;part.userData={object_id:id,area_id:object.area_id,state_scope:object.state_scope};group.add(part);objects.set(id,part);
      const fm=new Model(part);build(fm,part);fm.finish(id);
    };
    switch(binding.model) {
      case "nursery": {
        // The user's red barn lot is retained, now a seed store beside a greenhouse.
        cottage(m,3,-3,0x5b4937,5.7,C.red);
        m.box(2,2.6,.16,3,.3,-.42,0x893c2e);
        for(const x of [-6,-1])for(const z of [-6,-1])m.box(.13,3.4,.13,x,.3,z,C.teal);
        m.box(5.2,.15,.18,-3.5,3.65,-1,C.teal);m.box(5.2,.15,.18,-3.5,3.65,-6,C.teal);
        m.roof(5.4,5.5,1.5,-3.5,3.7,-3.5,0x97c7b1);
        const glass=new THREE.Mesh(new THREE.BoxGeometry(4.9,3.1,4.9),new THREE.MeshStandardMaterial({color:0x98d3cb,transparent:true,opacity:.27,depthWrite:false,roughness:.15}));
        glass.position.set(-3.5,1.95,-3.5);group.add(glass);
        fixture("garden-bed",(b,g)=>{
          const seedlings=new THREE.Group();seedlings.name="nursery-seedlings";seedlings.position.y=.83;g.add(seedlings);
          const plants=new Model(seedlings);
          const soilGroup=new THREE.Group();soilGroup.name="nursery-soil";g.add(soilGroup);const soil=new Model(soilGroup);
          for(let row=0;row<3;row++) {
            const z=1.9+row*1.8;b.box(10,.4,1.15,-1,.3,z,C.wood);soil.box(9.6,.13,.88,-1,.7,z,C.soil);
            for(let i=0;i<10;i++)plants.ball(.27,-5.3+i*.95,.13+(i%3)*.07,z,C.leaf);
          }
          plants.finish("nursery-plant-bodies");soil.finish("soil-moisture");g.userData.visual_channels={growth:"nursery-seedlings",health:"nursery-plant-bodies",moisture:"soil-moisture",quantity:"nursery-seedlings"};
        });
        fixture("seedling-rack",(b,g)=>{for(const x of [-5.3,-1.7])b.box(.15,2.5,.15,x,.3,-3.2,C.wood);
          for(const y of [.7,1.6,2.4]) {b.box(3.8,.14,1.3,-3.5,y,-3.2,C.wood);for(let i=0;i<5;i++){b.box(.42,.35,.42,-5+i*.75,y+.14,-3.2,0xa77850);b.ball(.24,-5+i*.75,y+.7,-3.2,C.leaf);}}
          // A real drying/sifting station beside the rack, reachable from the path.
          b.box(2.9,.18,1.3,-3.5,1.05,-.8,C.wood);
          for(const x of [-4.65,-2.35]) b.box(.15,.75,.15,x,.3,-.8,C.dark);
          b.box(2.65,.055,1.04,-3.5,1.23,-.8,0xcbb992);
          for(const z of [-1.38,-.22])b.box(2.9,.13,.07,-3.5,1.22,z,0xb88954);
          for(const x of [-4.92,-2.08])b.box(.07,.13,1.18,x,1.22,-.8,0xb88954);
          b.cylinder(.19,.22,-2,1.22,-1.1,C.cream);
          g.userData.workstations={'save-seeds':{standing:[-3.5,0,.9],facing:[-3.5,1.3,-.8]}};
        });
        const tank=new THREE.Mesh(new THREE.CylinderGeometry(.9,.9,1.8,12,1,true),new THREE.MeshLambertMaterial({color:C.teal,side:THREE.DoubleSide}));
        tank.position.set(6.2,1.2,4.8);group.add(tank);
        const tankWater=new THREE.Mesh(new THREE.CircleGeometry(.83,12),new THREE.MeshStandardMaterial({color:C.water,roughness:.25}));
        tankWater.name="nursery-collected-water";tankWater.rotation.x=-Math.PI/2;tankWater.position.set(6.2,1.2,4.8);group.add(tankWater);
        m.box(.15,.9,9,5.2,.3,1,C.teal);
        pond(group,5.25,1,.24,8.2);lamp(group,6,6);tree(group,-6.4,-6.8,0);break;
      }
      case "waterside": {
        const surface=pond(group,-1,0,10.5,12);
        surface.name="water-level:floating-frame";surface.userData={object_id:"floating-frame",visual_channel:"water_level",baseline_is_authored:true};
        for(let i=0;i<6;i++)m.box(3.7,.3,.8,5.4,.7,-2+i*.95,C.wood);
        // Gauge is geometry ready for step 4; no invented measured water value.
        m.box(.25,3,.25,-5.6,.3,4,C.cream);for(let i=0;i<8;i++)m.box(.5,.07,.08,-5.55,.6+i*.3,4.17,C.dark);
        fixture("floating-frame",(_b,g)=>{g.position.set(-1,.6,0);
          for(let i=0;i<4;i++){const plank=new THREE.Group();plank.name=`frame-plank:${i}`;g.add(plank);const p=new Model(plank);
            if(i<2)p.box(.3,.22,3,i===0?-2:2,0,0,C.wood);else p.box(4.3,.22,.3,0,0,i===2?-1.5:1.5,C.wood);p.finish("frame-wood");}
          const seedbedStation={standing:[2.4,0,1.5],facing:[-1,1.1,0]},pumpStation={standing:[5.4,0,7.0],facing:[5.4,1.3,5.6]};
          g.userData.workstations={'collect-water':{standing:[6.1,0,.6],facing:[5.2,1.8,-.75]},
            ...Object.fromEntries(['seedbed-survey','seedbed-plant','seedbed-inspect','seedbed-accept','seedbed-care','harvest-float-bed','sow-float-bed'].map(id=>[id,seedbedStation])),
            ...Object.fromEntries(['pump-install','pump-trial','pump-accept','pump-water','repair-pump'].map(id=>[id,pumpStation]))};
          g.userData.workstations['seedbed-survey']={standing:[4.5,0,1.5],facing:[-1,1.1,0]};
        });
        // Bank-mounted spring intake and gravity filter do not float with the decorative frame.
        m.box(3,.15,.62,5.2,.52,-5.2,C.dark);
        for(let i=0;i<7;i++)m.box(.055,1.08,.48,3.73+i*.42,.63,-5.2,C.wood);
        m.box(2.95,.11,.62,5.2,1.64,-5.2,C.cream);
        m.box(.17,.16,3.5,5.2,.6,-2.7,0xb9ab80);
        for(const x of [4.62,5.78])m.box(.13,2.3,.13,x,.3,-.75,C.wood);
        m.box(1.35,.15,.85,5.2,2.6,-.75,C.cream);
        for(let i=0;i<3;i++)m.cylinder(.42,.24,5.2,1.48+i*.37,-.75,i%2?0xbcb78b:0x819587);
        m.box(.12,.42,.12,5.2,1.05,-.75,C.teal);
        m.cylinder(.46,.55,5.2,.3,-.75,C.cream);
        m.box(.52,.065,.32,5.85,1.9,-.75,C.dark);
        const pointer=new THREE.Mesh(new THREE.BoxGeometry(.8,.1,.1),new THREE.MeshBasicMaterial({color:0xc85945}));
        pointer.name="water-level-pointer";pointer.position.set(-5.4,.55,4.25);group.add(pointer);
        fixture("post-rail",(b)=>{b.box(.18,2.3,.18,4.6,.3,4.2,C.wood);b.box(.18,2.3,.18,6.7,.3,4.2,C.wood);b.box(2.5,.2,.2,5.6,2.4,4.2,C.wood);b.box(.8,.8,.45,5.6,1.5,4.2,C.teal);});
        lamp(group,6,6);m.box(3,.15,2,5.4,.3,6,C.wood);break;
      }
      case "grove": {
        for(const [x,z] of [[-5,-5],[5,-5],[-5,3],[4,2]] as const)tree(group,x,z,x+z);
        fixture("light-sample-rack",(b)=>{b.box(.15,2.8,.15,-2,.3,-1,C.wood);b.box(.15,2.8,.15,2,.3,-1,C.wood);b.box(4.3,.15,.2,0,3,-1,C.wood);for(let i=0;i<5;i++)b.box(.45,.8,.1,-1.5+i*.75,1.8,-1,[0x88b99b,0xe1bc63,0x9d9cc3][i%3]!);});
        fixture("root-cushion",(b)=>{b.cylinder(1.5,.5,0,.3,4,C.wood);b.cylinder(1.25,.22,0,.8,4,0xb4bc82);});break;
      }
      case "square": {
        m.cylinder(6.5,.2,0,.3,0,0xe3d8ba);m.cylinder(1.1,.6,0,.5,0,C.dark);lamp(group,0,0,7);
        fixture("square-noticeboard",(b)=>{b.box(.2,2.8,.2,-5,.3,-3,C.wood);b.box(.2,2.8,.2,-2,.3,-3,C.wood);b.box(3.3,1.9,.2,-3.5,1.3,-3,C.wood);for(let i=0;i<3;i++)b.box(.7,.9,.05,-4.5+i,1.7,-2.87,C.cream);});
        fixture("square-steps",(b)=>{for(let i=0;i<3;i++)b.box(5,.3,3-i*.75,3,.3+i*.3,3,0xb8b09b);});
        for(const x of [-5,5])table(m,x,4,2);break;
      }
      case "shelter": {
        for(const x of [-3.3,3.3])for(const z of [-3,1])m.box(.2,3.2,.2,x,.3,z,C.wood);
        m.roof(7.6,5.2,1.3,0,3.5,-1,C.teal);
        fixture("shelter-bench",(b)=>{table(b,0,-1,5);});
        fixture("road-sign",(b,g)=>{b.box(.18,3.7,.18,-5,.3,3,C.wood);b.box(2,.5,.15,-4.4,3,3,C.teal);b.box(2,.5,.15,-5.6,2.3,3,0xba9c65);
          const flag=new THREE.Group();flag.position.set(-5,3.8,3);const fm=new Model(flag);fm.box(1.2,.45,.04,.6,0,0,0xe3c483);fm.finish("wind-ribbon");g.add(flag);flags.push(flag);});lamp(group,5,4);break;
      }
      case "market": {
        for(const x of [-3.4,3.4])for(const dx of [-1.7,1.7])m.box(.13,3.3,.13,x+dx,.3,-1,C.wood);
        fixture("market-canopy",(b,g)=>{for(const x of [-3.4,3.4]){b.box(3.7,.9,1.5,x,.3,-1,C.wood);for(let i=0;i<4;i++)b.box(.6,.3,.6,x-1.2+i*.8,1.2,-1,[0xc35f45,C.leaf,0xdaba66,C.teal][i]!);
          for(let i=0;i<6;i++){const strip=new THREE.Group();strip.name=`canopy-strip:${x}:${i}`;g.add(strip);cloth.push(strip);const fabric=new Model(strip);fabric.box(.62,.18,5,x-1.55+i*.62,3.6,-1,i%2?C.cream:C.teal);fabric.finish("canopy-fabric");}}
        });
        fixture("market-table",(b)=>table(b,0,5,4));lamp(group,6,6);break;
      }
      case "courtyard": {
        cottage(m,0,-3,0xb8734e,7);m.box(.7,3,.7,2,3.5,-3,C.wood);
        fixture("trial-stove",(b,g)=>{b.box(2.4,1.2,1.8,-4,.3,3,0xb6865c);b.cylinder(.6,.15,-4,1.5,3,C.dark);b.box(.6,1.4,.6,-4,1.5,2.3,C.dark);
          g.userData.workstations=Object.fromEntries(['soup-record-ratio','soup-cook-trial','soup-confirm-recipe','cook-leaf-soup'].map(id=>[id,{standing:[-4,0,5],facing:[-4,2,3]}]));});
        fixture("shared-table",(b,g)=>{table(b,2,4,5);g.userData.workstations=Object.fromEntries(['soup-serve-trial','soup-taste-trial'].map(id=>[id,{standing:[.7,0,5.55],facing:[.7,2,4]}]));});lamp(group,6,6);break;
      }
      case "workshop": {
        cottage(m,0,-3,C.teal,8);m.box(3,2.7,.2,0,.3,-.35,C.dark);
        fixture("repair-bench",(b,g)=>{table(b,-2,4,4);b.box(3.7,1.8,.15,-2,1.5,2.9,C.teal);for(let i=0;i<5;i++)b.box(.15,.8,.1,-3.3+i*.65,2,3,0xe3ddc9);
          g.userData.workstations=Object.fromEntries(['pump-survey','pump-assemble'].map(id=>[id,{standing:[-2.1,0,5.65],facing:[-2.1,2.2,4]}]));});
        fixture("parts-drawers",(b)=>{b.box(2.4,2.5,1.1,4,.3,3,C.wood);for(let i=0;i<3;i++)for(let j=0;j<3;j++){b.box(.72,.72,.08,3.2+j*.8,.42+i*.8,3.6,0xbcb492);b.box(.2,.08,.12,3.2+j*.8,.72+i*.8,3.68,C.dark);}});lamp(group,6,6);break;
      }
      case "home": {
        cottage(m,0,-2,0x748f82,7);m.box(6,.25,2.5,0,.3,2,C.wood);
        fixture("notice-tray",(b)=>{b.box(1.5,1.2,.6,-3,.3,3,C.wood);b.box(1.1,.03,.4,-3,1.51,3,C.cream);});
        fixture("keepsake-shelf",(b)=>{b.box(1.3,.8,.7,3,.3,3,C.wood);b.ball(.24,2.7,1.35,3,C.teal);b.ball(.19,3.3,1.35,3,0xd8b663);});lamp(group,5,4);break;
      }
      case "homes": {
        cottage(m,-3,-2,0x6e8b88,4.6);cottage(m,3,-2,0xad7865,4.6);
        fixture("homes-mailbox",(b)=>{for(let i=0;i<3;i++){b.box(.16,1.2,.16,-3+i*1.2,.3,4,C.wood);b.box(.9,.65,.7,-3+i*1.2,1.5,4,C.teal);b.box(.6,.06,.04,-3+i*1.2,1.8,4.37,C.dark);}});
        fixture("homes-doorplate",(b)=>{for(const x of [-3,3])b.box(.9,.5,.15,x+1.3,1.6,.6,C.wood);});lamp(group,6,6);break;
      }
    }
    addShapingDetails(group,m,binding.model);
    lifeEffects.push({locationId:place.location_id,effect:createSceneLifeEffects(group,binding.model,glowTexture)});
    const supply=createResourceSupplyEffects(group,binding.model);if(supply)supplyEffects.push({locationId:place.location_id,effect:supply});
    const projects=createProjectScene(group,binding.model);if(projects)projectEffects.push({locationId:place.location_id,effect:projects});
    if(['workshop','market','nursery'].includes(binding.model)) {
      const sign=new THREE.Mesh(new THREE.PlaneGeometry(binding.model==='market'?1.3:2,.18),new THREE.MeshBasicMaterial({color:0xf3d79c,transparent:true,opacity:0,depthWrite:false}));
      sign.name='closing-store-light';sign.position.set(binding.model==='market'?-3.4:0,binding.model==='market'?2.5:3.2,binding.model==='market'?1.25:-.2);
      sign.userData={light_channel:'sign',location_id:place.location_id,model:binding.model};group.add(sign);lamps.push(sign);
    }
    if(['workshop','courtyard','nursery','market'].includes(binding.model)) {
      const light=new THREE.Mesh(new THREE.CircleGeometry(1.6,24),new THREE.MeshBasicMaterial({color:0xffd89b,map:glowTexture,transparent:true,opacity:0,depthWrite:false}));
      light.name='active-task-light';light.rotation.x=-Math.PI/2;
      light.position.set(binding.model==='workshop'?-2:binding.model==='courtyard'?-4:0,binding.model==='workshop'?1.82:binding.model==='courtyard'?1.64:.84,binding.model==='workshop'?4:binding.model==='courtyard'?3:3.6);
      light.userData={light_channel:'work',location_id:place.location_id,model:binding.model,pool:true};group.add(light);lamps.push(light);
    }
    m.finish(`building:${binding.model}`);
    for(const [id,spec] of Object.entries(stockSpec)){
      const object=objects.get(id);if(!object || object.parent!==group)continue;
      spec.resources.forEach((resource,row)=>{
        const slots:THREE.Group[]=[];
        for(let i=0;i<6;i++){const slot=new THREE.Group();slot.name=`stock:${id}:${resource}:${i}`;slot.position.set(spec.x+i*.58,spec.y,spec.z+row*.64);slot.visible=false;object.add(slot);
          const sm=new Model(slot);sm.box(.46,.58,.46,0,0,0,stockColors[resource]!);sm.finish("stock-stack");slots.push(slot);}
        stockSlots.set(`${id}:${resource}`,slots);
      });
    }
    for(const id of ['seedling-rack','repair-bench','market-canopy','trial-stove']){
      const object=objects.get(id);if(!object || object.parent!==group)continue;
      const wear=new THREE.Group();wear.name=`wear:${id}`;wear.visible=false;object.add(wear);const wm=new Model(wear);
      const p=id==='repair-bench'?[-2,1.8,4]:id==='market-canopy'?[-3.4,1.23,-1]:id==='trial-stove'?[-4,1.51,3]:[-3.5,2.55,-3.2];
      for(let i=0;i<3;i++)wm.box(.06,.03,.5,p[0]!+i*.2,p[1]!,p[2]!+i*.12,C.dark);wm.finish("wear-cracks");
    }
  }
  function applyState(next:readonly DeskBotLocation[]) {
    const states=new Map<string,DeskBotObjectState>();
    for(const place of next)for(const area of place.areas??[])for(const object of area.objects??[])if(object.state){states.set(object.object_id,object.state);const group=objects.get(object.object_id);if(group)group.userData.state_scope='persistent_living';}
    const bed=states.get('garden-bed'),garden=objects.get('garden-bed');
    if(bed&&garden){const seedlings=garden.getObjectByName('nursery-seedlings')!;seedlings.visible=(bed.quantity??0)>0||(bed.dead_quantity??0)>0;seedlings.scale.y=.25+(bed.growth??0)*4.4;
      const plant=garden.getObjectByName('nursery-plant-bodies') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>;
      // State owns the final foliage color; tinting green vertex colors hides wilt.
      if(plant.material.vertexColors){plant.material.vertexColors=false;plant.material.needsUpdate=true;}
      plant.material.color.set(0x9e7847).lerp(new THREE.Color(C.leaf),bed.health??0);
      const soil=garden.getObjectByName('soil-moisture') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshLambertMaterial>;
      soil.material.color.set(0xffffff).lerp(new THREE.Color(0x695c49),bed.moisture??0);garden.userData.state=bed;
    }
    const waterside=states.get('floating-frame'),floating=objects.get('floating-frame');
    if(waterside&&floating){const surface=root.getObjectByName('water-level:floating-frame')!;surface.position.y=.38+(waterside.water_level??0)*.72;
      surface.scale.x=.78+(waterside.water_level??0)*.22;surface.scale.z=.78+(waterside.water_level??0)*.22;
      floating.position.y=surface.position.y+.05;floating.userData.condition=waterside.condition;
      root.getObjectByName('water-level-pointer')!.position.y=surface.position.y;
      floating.children.forEach((plank,i)=>{if(plank.name.startsWith('frame-plank:')){plank.visible=(waterside.condition??1)>.35||i!==1;plank.rotation.y=i===3?(1-(waterside.condition??1))*.22:0;}});
    }
    const rack=states.get('seedling-rack');if(rack){const fill=root.getObjectByName('nursery-collected-water');if(fill)fill.position.y=.36+Math.min(1,(rack.stock?.water??0)/(rack.capacity??24))*1.55;}
    for(const [key,slots] of stockSlots){const split=key.lastIndexOf(':'),id=key.slice(0,split),resource=key.slice(split+1),count=states.get(id)?.stock?.[resource]??0;
      slots.forEach((slot,i)=>{const units=Math.max(0,Math.min(4,count-i*4));slot.visible=units>0;slot.scale.y=.25+units*.1875;slot.userData.quantity=units;});
    }
    for(const [id,state] of states){const object=objects.get(id);if(!object)continue;object.userData.state=state;
      if(typeof state.condition==='number'){
        const wear=object.getObjectByName(`wear:${id}`);if(wear)wear.visible=state.condition<.65;
        object.children.filter(c=>c.name.startsWith('canopy-strip:')).forEach((strip,i)=>{strip.visible=state.condition!>.4 || i%6!==2;strip.userData.wear_rotation=(1-state.condition!)*.06*(i%2?1:-1);strip.rotation.z=strip.userData.wear_rotation;});
      }
    }
  }
  applyState(locations);
  return {root,objects,water,lamps,trees,flags,applyState,update(time,night,wind,wetness,reducedMotion,context) {
    const activitiesByLocation=new Map<string,SceneLifeContext['activities'][number][]>();
    for(const activity of context?.activities??[]) {const local=activitiesByLocation.get(activity.locationId)??[];local.push(activity);activitiesByLocation.set(activity.locationId,local);}
    for(const glow of lamps) {
      const mat=glow.material as THREE.MeshBasicMaterial,local=activitiesByLocation.get(glow.userData.location_id)??[];
      const view=sceneOperationAt(glow.userData.model,context?.minute??(night>.5?1200:720),night,local,glow.userData.variation??0);
      const channel=glow.userData.light_channel as SceneLightChannel,power=view[channel];
      mat.opacity=glow.userData.pool ? power*(channel==='work'?.19:.26) : channel==='public'?.06+power*.86:power*.94;
      glow.userData.operation={...view,minute:context?.minute};
    }
    trees.forEach((tree,i)=>{tree.rotation.z=reducedMotion ? 0 : Math.sin(time*1.6+i)*Math.min(wind/150,.09);});
    flags.forEach((flag,i)=>{flag.rotation.y=reducedMotion ? 0 : Math.sin(time*3+i)*Math.min(wind/8,1);});
    cloth.forEach((strip,i)=>{strip.rotation.z=(strip.userData.wear_rotation??0)+(reducedMotion?0:Math.sin(time*1.7+i*.5)*Math.min(wind/130,.045));});
    for(const mesh of water)(mesh.material as THREE.MeshStandardMaterial).roughness=.25-wetness*.12;
    const floating=objects.get("floating-frame");if(floating)floating.rotation.z=(1-(floating.userData.condition??1))*.06+(reducedMotion ? 0 : Math.sin(time*1.1)*.015);
    for(const {locationId,effect} of lifeEffects)effect.update(time,night,wind,reducedMotion,context?{...context,activities:activitiesByLocation.get(locationId)??[]}:undefined);
    for(const {locationId,effect} of supplyEffects)effect.update(time,reducedMotion,context?{...context,activities:activitiesByLocation.get(locationId)??[]}:undefined);
    for(const {locationId,effect} of projectEffects)effect.update(time,reducedMotion,context?{...context,activities:activitiesByLocation.get(locationId)??[]}:undefined);
  }};
}
