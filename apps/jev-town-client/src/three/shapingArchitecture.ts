import * as THREE from 'three';
import {shellVaultGeometry} from './moltedShellGeometry.ts';

export type ShellHouseKind='vault'|'split'|'lantern'|'petal';
export interface ArchitectureSink {
  add(geometry:THREE.BufferGeometry,x:number,y:number,z:number,color:number):void;
  box(w:number,h:number,d:number,x:number,y:number,z:number,color:number):void;
}
export interface ShellWindow {x:number;y:number;z:number;radius:number}
const C={rim:0xe9d9b2,inside:0x427b82,wall:0x8fb7a8,wood:0xa58b68,dark:0x546d65,brass:0xc7a267};

/** A small modular vocabulary, authored in local space with the door at +z.
 * These are architectural details, not invented inventory or resident deeds. */
export function addShellHouse(sink:ArchitectureSink,options:{kind:ShellHouseKind;width:number;height:number;depth:number;color:number;open?:boolean}) {
  const {kind,width:w,height:h,depth:d,color,open=false}=options;
  const windows:ShellWindow[]=[];
  const vault=(width:number,height:number,depth:number,x:number,y:number,z:number,tint=color,tilt=0)=>{
    const shell=shellVaultGeometry(width,height,depth,Math.min(.24,width*.055));
    for(const [g,c] of [[shell.outer,tint],[shell.inner,C.inside],[shell.rim,C.rim]] as const){g.rotateZ(tilt);sink.add(g,x,y,z,c);}
  };
  const rod=(a:THREE.Vector3,b:THREE.Vector3,r=.055,tint=C.wood)=>{
    const delta=b.clone().sub(a),g=new THREE.CylinderGeometry(r,r,delta.length(),5);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
    const p=a.clone().add(b).multiplyScalar(.5);sink.add(g,p.x,p.y,p.z,tint);
  };
  const sill=(x:number,y:number,z:number,r:number)=>{
    sink.add(new THREE.TorusGeometry(r+.065,.075,4,12),x,y,z,C.brass);
    sink.box(r*2.4,.10,.25,x,y-r-.12,z+.08,C.wood);
    windows.push({x,y,z:z+.025,radius:r});
  };
  // A closed facade with actual door and window holes gives the hollow roof a
  // room, while the workshop retains a genuine open bay.
  const facade=(height:number)=>{
    const wall=new THREE.Shape();wall.moveTo(-w*.48,0);
    for(let i=0;i<=14;i++){const a=Math.PI-i/14*Math.PI;wall.lineTo(Math.cos(a)*w*.48,Math.sin(a)*height);}
    wall.lineTo(w*.48,0);wall.closePath();
    const doorW=Math.min(1.05,w*.22),doorH=Math.min(1.85,h*.51);
    const door=new THREE.Path();door.moveTo(-doorW/2,0);door.lineTo(doorW/2,0);door.lineTo(doorW/2,doorH-doorW/2);
    door.absarc(0,doorH-doorW/2,doorW/2,0,Math.PI,false);door.closePath();wall.holes.push(door);
    for(const side of [-1,1]){
      const x=side*w*.28,y=height*.48,r=Math.min(.48,w*.082),hole=new THREE.Path();
      hole.absarc(x,y,r,0,Math.PI*2,false);wall.holes.push(hole);sill(x,y+.17,d*.48+.16,r);
    }
    const g=new THREE.ExtrudeGeometry(wall,{depth:.14,bevelEnabled:false,curveSegments:10});
    sink.add(g,0,.17,d*.48,C.wall);
    sink.box(doorW*.88,doorH*.8,.10,0,.17,d*.47,C.dark);
    sink.add(new THREE.TorusGeometry(doorW*.55,.065,4,10,Math.PI),0,.17+doorH-doorW/2,d*.48+.18,C.brass);
  };
  const mainHeight=kind==='petal'?h*.86:kind==='lantern'?h*.9:h;
  vault(w,mainHeight,d,0,.15,0);
  const base=new THREE.CylinderGeometry(1,1,.19,12);base.scale(w*.56,1,d*.63);
  sink.add(base,0,.10,0,0xb6b7a0);
  if(open){
    sink.box(w*.64,h*.52,.18,0,.15,-d*.34,C.wall);
    for(const side of [-1,1])sink.box(.14,h*.68,.14,side*w*.33,.15,d*.38,C.wood);
    sink.box(w*.72,.15,.16,0,h*.68,d*.38,C.brass);
  }else facade(mainHeight*.94);

  if(kind==='split'){
    // Offset second room and folded eave, visibly distinct from a scaled vault.
    const upper=new THREE.CylinderGeometry(w*.18,w*.23,h*.44,9);
    sink.add(upper,-w*.16,h*.79,-d*.12,C.wall);
    vault(w*.64,h*.5,d*.66,-w*.18,h*.63,-d*.16,0xd5b9ce,-.16);
    const cheek=new THREE.SphereGeometry(w*.23,10,6,0,Math.PI*2,0,Math.PI/2);cheek.scale(1,.8,1);
    sink.add(cheek,w*.39,.9,d*.06,C.rim);
    sink.add(new THREE.CylinderGeometry(w*.23,w*.23,.9,10),w*.39,.45,d*.06,C.wall);
  }else if(kind==='lantern'){
    // A compact roof lantern is a silhouette and lightwell, not a new power source.
    const x=-w*.18,z=-d*.14;
    sink.add(new THREE.CylinderGeometry(w*.15,w*.19,h*.4,8),x,h*.91,z,C.wall);
    for(let i=0;i<3;i++){
      const r=w*(.22-i*.035),g=new THREE.ConeGeometry(r,.32,8);g.scale(1,1,.8);
      sink.add(g,x,h*(1.04+i*.13),z,i%2?color:C.rim);
    }
    sink.add(new THREE.OctahedronGeometry(.20),x,h*1.43,z,C.brass);
  }else if(kind==='petal'){
    vault(w*.67,h*.72,d*.62,w*.22,.25,-d*.12,0xd4b7cd,-.21);
    const fin=new THREE.ConeGeometry(.75,h*.73,5);fin.scale(.34,1,1.3);fin.rotateZ(-.26);
    sink.add(fin,-w*.24,h*.83,-d*.16,0x79b1aa);
  }else{
    const fin=new THREE.ConeGeometry(.62,h*.65,5);fin.scale(.42,1,.9);fin.rotateZ(.28);
    sink.add(fin,w*.22,h*.85,-d*.25,0x7eafa4);
  }

  // The porch footprint is bounded so doors do not swallow the working yard.
  const awningWidth=w*(open?.88:.68),front=d*.5+1.2,back=d*.27;
  const vertices:number[]=[];
  const point=(u:number,v:number)=>[u*awningWidth/2,h*.61-.27*(1-u*u)+v*.16,(1-v)*back+v*front];
  for(let i=0;i<6;i++){
    const a=-1+i/3,b=-1+(i+1)/3;
    vertices.push(...point(a,0),...point(a,1),...point(b,0),...point(b,0),...point(a,1),...point(b,1));
  }
  const canopy=new THREE.BufferGeometry();canopy.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));canopy.computeVertexNormals();
  // Close the thin underside explicitly, keeping the global material single-sided.
  const underside=canopy.clone(),indices:number[]=[];
  for(let i=0;i<vertices.length/3;i+=3)indices.push(i,i+2,i+1);
  underside.setIndex(indices);underside.translate(0,-.035,0);underside.computeVertexNormals();
  sink.add(canopy,0,0,0,C.rim);sink.add(underside,0,0,0,C.rim);
  for(const side of [-1,1]){
    const x=side*awningWidth/2;
    rod(new THREE.Vector3(x,.15,front),new THREE.Vector3(x,h*.61+.17,front),.07);
    rod(new THREE.Vector3(x,h*.61+.17,front),new THREE.Vector3(x,h*.61,back),.055,C.brass);
    sink.add(new THREE.IcosahedronGeometry(.12,0),x,h*.61+.23,front,C.brass);
  }
  sink.box(w*.42,.12,.64,0,.14,front+.14,C.rim);
  // Low ledge and planted pot do not encode any harvestable inventory.
  sink.add(new THREE.CylinderGeometry(.24,.19,.42,7),w*.41,.27,front-.12,0xb59b7b);
  sink.add(new THREE.IcosahedronGeometry(.33,0),w*.41,.72,front-.12,0x84b28c);
  return {windows,kind};
}

/** A transformed drawing cursor keeps houses, facade openings and window lights
 * in one local coordinate frame before the shared landscape projection. */
export function architectureFrame(sink:ArchitectureSink,x:number,y:number,z:number,rotation=0):ArchitectureSink{
  return {
    add(g,a,b,c,color){g.rotateY(rotation);const px=x+Math.cos(rotation)*a+Math.sin(rotation)*c,pz=z-Math.sin(rotation)*a+Math.cos(rotation)*c;sink.add(g,px,y+b,pz,color);},
    box(w,h,d,a,b,c,color){const g=new THREE.BoxGeometry(w,h,d);this.add(g,a,b+h/2,c,color);},
  };
}
