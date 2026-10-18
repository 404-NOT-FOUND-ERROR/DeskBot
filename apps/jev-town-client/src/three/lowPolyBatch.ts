import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
/** One opaque mesh per static group. Movable/interactive parts stay separate. */
export class LowPolyBatch {
  private parts:THREE.BufferGeometry[]=[];
  add(geometry:THREE.BufferGeometry,x:number,y:number,z:number,color:number,rotation=0){
    const g=geometry.index?geometry.toNonIndexed():geometry.clone();geometry.dispose();g.deleteAttribute('uv');
    if(rotation)g.rotateY(rotation);g.translate(x,y,z);
    const rgb=new THREE.Color(color),values=new Float32Array(g.getAttribute('position').count*3);
    for(let i=0;i<values.length;i+=3)rgb.toArray(values,i);
    g.setAttribute('color',new THREE.BufferAttribute(values,3));this.parts.push(g);
  }
  box(w:number,h:number,d:number,x:number,y:number,z:number,color:number,rotation=0){this.add(new THREE.BoxGeometry(w,h,d),x,y+h/2,z,color,rotation);}
  cylinder(r:number,h:number,x:number,y:number,z:number,color:number){this.add(new THREE.CylinderGeometry(r,r,h,8),x,y+h/2,z,color);}
  rock(r:number,x:number,y:number,z:number,color:number){this.add(new THREE.IcosahedronGeometry(r,0),x,y,z,color);}
  roof(w:number,d:number,h:number,x:number,y:number,z:number,color:number){
    const shape=new THREE.Shape();shape.moveTo(-d/2,0);shape.lineTo(d/2,0);shape.lineTo(0,h);shape.closePath();
    const g=new THREE.ExtrudeGeometry(shape,{depth:w,bevelEnabled:false});g.rotateY(Math.PI/2);g.translate(-w/2,0,0);this.add(g,x,y,z,color);
  }
  finish(parent:THREE.Group,name:string){
    if(!this.parts.length)return null;
    const g=mergeGeometries(this.parts,false)!;this.parts.forEach(p=>p.dispose());this.parts=[];
    const mesh=new THREE.Mesh(g,new THREE.MeshLambertMaterial({vertexColors:true,flatShading:true}));
    mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
}
