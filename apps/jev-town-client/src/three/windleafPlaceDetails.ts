import * as THREE from 'three';
import {LowPolyBatch} from './lowPolyBatch.ts';

const C={wood:0xa88358,edge:0x745c43,dark:0x554b3e,pale:0xc7a779,metal:0x818e87,stone:0x929d90,moss:0x79866b,clay:0xac9270};

/** Static joinery and communal fittings. None represents inventory or a resident's work. */
function beam(b:LowPolyBatch,a:[number,number,number],z:[number,number,number],width:number,color:number,depth=width){
  const from=new THREE.Vector3(...a),to=new THREE.Vector3(...z),delta=to.clone().sub(from);
  const g=new THREE.BoxGeometry(width,delta.length(),depth);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
  const p=from.add(to).multiplyScalar(.5);b.add(g,p.x,p.y,p.z,color);
}

function emptyCrate(b:LowPolyBatch,x:number,y:number,z:number,w:number,d:number,h:number){
  b.box(w,.08,d,x,y,z,C.edge);
  for(const dx of [-w/2+.055,w/2-.055])for(const dz of [-d/2+.055,d/2-.055])b.box(.11,h,.11,x+dx,y,z+dz,C.dark);
  for(let row=0;row<3;row++){
    const level=y+.12+row*(h-.16)/3;
    for(const dz of [-d/2,d/2])b.box(w,.13,.075,x,level,z+dz,C.wood);
    for(const dx of [-w/2,w/2])b.box(.075,.13,d,x+dx,level,z,C.wood);
  }
}

function emptyPot(b:LowPolyBatch,x:number,y:number,z:number,r:number,h:number){
  b.cylinder(r*.75,.055,x,y,z,C.clay);
  // An actual open top, so empty ceramic fittings never look like filled stock.
  for(let i=0;i<8;i++){
    const a=i*Math.PI/4;
    b.box(r*.8,h,r*.14,x+Math.sin(a)*r*.88,y,z+Math.cos(a)*r*.88,i%2?0xb19b7d:0xbca98a,a);
  }
}

function stool(b:LowPolyBatch,x:number,z:number){
  b.box(1.1,.18,.85,x,.77,z,C.wood);
  for(const dx of [-.4,.4])for(const dz of [-.29,.29])b.box(.13,.77,.13,x+dx,.18,z+dz,C.dark);
  for(const dx of [-.4,.4])b.box(.1,.1,.65,x+dx,.4,z,C.pale);
}

function fence(b:LowPolyBatch,x:number,z1:number,z2:number){
  for(const z of [z1,z2]){
    b.box(.23,1.35,.23,x,.18,z,C.dark);b.box(.3,.12,.3,x,1.48,z,C.pale);
  }
  for(const y of [.56,1.12])b.box(.13,.2,z2-z1,x,y,(z1+z2)/2,C.wood);
}

function shelterDetails(parent:THREE.Group){
  const b=new LowPolyBatch();
  const spec=parent.userData.roofDimensions as {width:number;depth:number;height:number;baseY:number;centerZ:number}|undefined;
  const roof=spec??{width:15,depth:4.8,height:1,baseY:4.42,centerZ:-3};
  const half=roof.width/2,ridge=roof.baseY+roof.height,back=roof.centerZ-roof.depth/2,front=roof.centerZ+roof.depth/2;
  // Coloured sheets lie on the original roof. Seams and cap reveal assembly at normal zoom.
  const panelColors=[0x668f84,0x719a8d,0x71958a,0x7b9f91,0x6e958a];
  for(let i=0;i<10;i++)for(const [za,ya,zb,yb] of [[back,roof.baseY,roof.centerZ,ridge],[roof.centerZ,ridge,front,roof.baseY]]){
    const x=-half+i*roof.width/10+.025,xx=-half+(i+1)*roof.width/10-.025;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([
      x,ya!+.018,za!, x,yb!+.018,zb!, xx,yb!+.018,zb!,
      x,ya!+.018,za!, xx,yb!+.018,zb!, xx,ya!+.018,za!,
    ],3));g.computeVertexNormals();b.add(g,0,0,0,panelColors[i%panelColors.length]!);
  }
  for(let i=0;i<=10;i++){
    const x=-half+i*roof.width/10;
    beam(b,[x,roof.baseY+.03,back],[x,ridge+.03,roof.centerZ],.045,0x54796f,.065);
    beam(b,[x,ridge+.03,roof.centerZ],[x,roof.baseY+.03,front],.045,0x54796f,.065);
  }
  b.box(roof.width+.12,.1,.18,0,ridge,roof.centerZ,0x567a6f);
  for(const z of [back,front])b.box(roof.width,.17,.15,0,roof.baseY-.12,z,C.edge);
  for(const x of [-6,6]){
    beam(b,[x,3.2,-4.8],[x,4.18,-3.7],.16,C.wood);
    beam(b,[x,3.12,-1.5],[x,4.18,-2.75],.16,C.wood);
    for(const z of [-4.8,-1.5]){
      b.box(.39,.15,.4,x,.18,z,C.edge);b.box(.3,.12,.3,x,3.95,z,C.pale);
      b.box(.055,.09,.31,x+.145,3.73,z,C.metal);
    }
  }
  // Workbench feet, a lower shelf, tenons and a permanent vice stay behind every slot.
  b.box(9.6,.15,1.18,0,.63,-3.25,C.edge);
  for(const x of [-4.5,4.5])beam(b,[x,.26,-3.25],[x+(x<0?1.25:-1.25),1.54,-3.25],.14,C.wood);
  for(const x of [-4.6,-3.1,-1.55,0,1.55,3.1,4.6])b.box(.032,.027,1.5,x,1.788,-3.25,C.edge);
  b.box(.95,.12,.63,-3.75,1.8,-2.88,C.metal);b.box(.3,.43,.58,-4.05,1.92,-2.88,C.dark);b.box(.22,.34,.58,-3.48,1.92,-2.88,C.metal);
  beam(b,[-3.85,2.08,-2.86],[-3.1,2.08,-2.86],.09,C.metal);
  beam(b,[-3.03,1.84,-2.86],[-3.03,2.32,-2.86],.07,C.dark);
  // Hook strip, triangular square, hand plane and empty ceramic measuring vessels.
  b.box(8.8,.18,.12,0,3.25,-4.12,C.edge);
  for(const x of [-3.7,-2.6,-1.5,-.4,.7,1.8,2.9,4]){
    b.box(.055,.24,.13,x,3.02,-3.99,C.metal);b.box(.055,.06,.2,x,3.01,-3.89,C.metal);
  }
  beam(b,[2.45,2.22,-4],[2.45,3.01,-4],.09,C.pale);
  beam(b,[2.45,2.22,-4],[3.17,2.22,-4],.09,C.pale);
  beam(b,[2.45,3.01,-4],[3.17,2.22,-4],.085,C.pale);
  b.box(.65,.17,.35,.4,1.79,-2.75,C.dark);b.box(.16,.19,.22,.5,1.96,-2.75,C.wood);
  emptyPot(b,1.95,1.79,-3.1,.25,.4);emptyPot(b,2.65,1.79,-3.05,.2,.29);
  emptyCrate(b,-2.7,.8,-3.22,1.3,.9,.55);emptyCrate(b,3.55,.8,-3.22,1.05,.8,.48);
  // Side fittings never overlap the three installation pads or front approach at z=3.
  stool(b,-5.45,-2.25);stool(b,5.45,-2.25);
  fence(b,-6.65,.85,3.4);fence(b,6.65,.85,3.4);
  b.box(3.6,.11,.65,0,.05,4.78,C.edge);b.box(3.5,.075,.58,0,0,5.3,C.wood);
  for(const x of [-1.4,1.4])for(const z of [4.65,5.25])b.cylinder(.045,.025,x,z<5?.165:.08,z,C.metal);
  b.finish(parent,'windleaf-shelter-fixed-details');
}

function observationDetails(parent:THREE.Group){
  const b=new LowPolyBatch();
  // Fixed ruler and carved notches are facilities, not a notebook or generated reading.
  for(let i=0;i<7;i++)b.box(i%3===0?.25:.14,.027,.045,-.55,.925,.62-i*.13,C.dark);
  b.box(.72,.075,.12,.15,.78,1.1,C.edge);
  for(const [x,z,r] of [[-1.3,.8,.24],[1.1,.7,.19],[.9,-.9,.27]] as const)b.rock(r,x,.05,z,C.stone);
  b.box(.36,.08,.1,-.73,.87,-.25,C.moss,.4);
  b.finish(parent,'windleaf-observation-fixed-details');
}

function returnDetails(parent:THREE.Group){
  const b=new LowPolyBatch();
  for(const x of [-3.1,-2.1,-1.1,0,1.1,2.1,3.1])b.box(.025,.018,2.9,x,1.527,0,C.edge);
  for(const x of [-2.8,2.8]){
    beam(b,[x,.12,-1],[x,.95,1],.13,C.wood);
    beam(b,[x,.12,1],[x,.95,-1],.13,C.wood);
    b.box(.35,.13,.35,x,1.05,-1,C.pale);b.box(.35,.13,.35,x,1.05,1,C.pale);
  }
  b.box(5.5,.13,.18,0,.38,-1,C.edge);
  b.box(.12,.026,.18,-3,1.53,1,C.metal);b.box(.12,.026,.18,3,1.53,1,C.metal);
  emptyCrate(b,-2,.02,-2.6,1.75,1.25,.78);emptyCrate(b,2.15,.02,-2.75,1.35,1.05,.67);
  // A low back enclosure leaves the return counter and its front bench entirely accessible.
  for(const x of [-4.5,0,4.5])b.box(.24,1.35,.24,x,0,-4.1,C.dark);
  for(const y of [.4,.97])b.box(9.1,.21,.16,0,y,-4.1,C.wood);
  for(const x of [-4.5,4.5])beam(b,[x,.3,-4.1],[x+(x<0?1.35:-1.35),1.12,-4.1],.11,C.pale);
  b.finish(parent,'windleaf-return-fixed-details');
}

function waymarkerDetails(parent:THREE.Group){
  const b=new LowPolyBatch();
  for(const [x,z,h] of [[-1.6,-.65,.9],[1.75,-.95,1.35],[2.25,-1.6,.55]] as const){
    b.box(.58,h,.53,x,0,z,C.stone);b.rock(.39,x,h,z,0xa1aa96);
    b.box(.1,.32,.02,x+.08,h-.34,z+.277,C.dark);b.box(.27,.045,.022,x,h-.1,z+.28,C.moss);
  }
  b.box(.55,.1,.52,0,0,0,C.edge);
  for(const x of [-.17,.17])b.cylinder(.035,.025,x,.11,.16,C.metal);
  // Existing repaired board gets joinery only; no new message, task or landmark label.
  b.box(.38,.66,.04,.89,2.16,-.13,C.edge);
  for(const x of [-.65,.85,1.17])for(const y of [2.31,2.66])b.box(.07,.07,.035,x,y,.115,C.metal);
  b.finish(parent,'windleaf-waymarker-fixed-details');
}

/** Adds one static batch per existing place, without creating destinations or saved state. */
export function addWindleafPlaceDetails(objects:Map<string,THREE.Group>):void{
  const places:[string,(parent:THREE.Group)=>void,string][]=[
    ['windleaf-rack',shelterDetails,'windleaf-shelter-fixed-details'],
    ['windleaf-observation-stone',observationDetails,'windleaf-observation-fixed-details'],
    ['windleaf-return-table',returnDetails,'windleaf-return-fixed-details'],
    ['windleaf-waymarker',waymarkerDetails,'windleaf-waymarker-fixed-details'],
  ];
  for(const [id,build,name] of places){
    const parent=objects.get(id);if(!parent||parent.getObjectByName(name))continue;
    build(parent);const mesh=parent.getObjectByName(name)!;mesh.userData.presentationOnly=true;mesh.userData.fixtureKind='communal-permanent-fitting';
  }
}
