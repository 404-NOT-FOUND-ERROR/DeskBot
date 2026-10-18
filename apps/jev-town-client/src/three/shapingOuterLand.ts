import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import {LowPolyBatch} from './lowPolyBatch.ts';
import {SHAPING_POOLS,shapingLogicalPoint,shapingCoastDistance,shapingLandmarkFootprint} from './shapingLandform.ts';
import {windleafHeightAt} from './windleafLayout.ts';
const hash=(i:number)=>{const v=Math.sin(i*127.1+7.3)*43758.5453;return v-Math.floor(v);};
/** Physical-map points are authored around the central settlement; convert
 * only at the render boundary. These landforms have no invented inventory. */
export function createShapingOuterLand(){
  const root=new THREE.Group();root.name='shaping-surrounding-biomes';root.userData.decorativeOnly=true;
  const stone=new LowPolyBatch(),plants=new LowPolyBatch(),petals=new LowPolyBatch(),details=new LowPolyBatch();
  const floating:THREE.Group[]=[],lights:THREE.Mesh[]=[],poolMeshes:THREE.Mesh<THREE.BufferGeometry,THREE.MeshBasicMaterial>[]=[];
  const point=(x:number,y:number)=>{const p=shapingLogicalPoint(x,y),w=mapToWorld(p.x,p.y);return {...w,h:windleafHeightAt(p.x,p.y),logical:p};};
  for(const [i,pool] of SHAPING_POOLS.entries()){
    const positions:number[]=[],color:number[]=[];
    for(let j=0;j<48;j++){
      const a=j*Math.PI/24,b=(j+1)*Math.PI/24;
      for(const [x,y] of [[pool.x,pool.y],[pool.x+Math.cos(a)*pool.rx,pool.y+Math.sin(a)*pool.ry],[pool.x+Math.cos(b)*pool.rx,pool.y+Math.sin(b)*pool.ry]]){
        const p=point(x!,y!);positions.push(p.x,-.46,p.z);new THREE.Color(i===1?0x80d7df:0x6ae2cd).toArray(color,color.length);
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));g.computeVertexNormals();
    const water=new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));water.name='refraction-pool-water';root.add(water);poolMeshes.push(water);
    for(let n=0;n<10;n++){
      const a=n*Math.PI*.2+.2,r=.65+hash(n+i*10)*.25,p=point(pool.x+Math.cos(a)*pool.rx*r,pool.y+Math.sin(a)*pool.ry*r);
      const leaf=new THREE.CylinderGeometry(1.4,1.2,.13,8,1,false,.3,5.5);plants.add(leaf,p.x,-.22,p.z,0x91c86e,n*.7);
      if(n%3===0){petals.rock(.5,p.x,.4,p.z,0xe5b4d0);details.cylinder(.08,1.4,p.x,-.3,p.z,0x83af8d);}
    }
  }
  // Oversized cupped flora: translucent-looking pure colour facets, hollow
  // silhouettes and leaning stems instead of a conventional round forest.
  for(let i=0;i<24;i++){
    const x=23+hash(i+12)*57,y=91+hash(i+99)*105,p=point(x,y);
    if(shapingCoastDistance(p.logical.x,p.logical.y)<9||p.h<0)continue;
    const h=3+hash(i+25)*5,r=2.6+hash(i+89)*2.5;
    plants.cylinder(.16,h,p.x,p.h,p.z,0x598d8e);
    const g=new THREE.ConeGeometry(r,h*.45,7,1,true);g.rotateX(Math.PI);g.scale(1,1,.7);
    petals.add(g,p.x,p.h+h,p.z,i%3===0?0xd8b9e8:i%3===1?0xa4e1c5:0xeada9c,i*.7);
    details.rock(.36,p.x,p.h+h+.2,p.z,0xffe69a);
  }
  // Broken fins on the northern ridge and south-facing star terraces.
  for(let i=0;i<65;i++){
    const south=i%2===0,x=south?94+hash(i+42)*91:69+hash(i+42)*131,y=south?216+hash(i+31)*29:32+hash(i+31)*38,p=point(x,y);
    if(shapingCoastDistance(p.logical.x,p.logical.y)<7||shapingLandmarkFootprint(p.logical.x,p.logical.y,-3))continue;
    const r=1.3+hash(i+44)*3.1,g=new THREE.IcosahedronGeometry(r,0);g.scale(.75,2.1+hash(i)*1.4,.6);g.rotateZ((hash(i+18)-.5)*.65);
    stone.add(g,p.x,p.h+r*1.2,p.z,south?0xb6abd1:0xb7c5d4);
    if(i%9===0){const ring=new THREE.TorusGeometry(r*1.8,.16,4,16);ring.rotateX(Math.PI*.38);details.add(ring,p.x,p.h+r*3.1,p.z,0xe7d6a6,i);}
  }
  // A ring of quieter woodland closes the western and southern views. Clear
  // gaps between stands reveal the next terrain instead of a perimeter fence.
  for(let i=0;i<220;i++){
    const angle=2.0+hash(i+301)*3.8,r=83+hash(i+305)*36,x=141+Math.cos(angle)*r,y=140+Math.sin(angle)*r*.86,p=point(x,y);
    if(shapingCoastDistance(p.logical.x,p.logical.y)<6||p.h<0||shapingLandmarkFootprint(p.logical.x,p.logical.y,2)||x<79&&y>83&&y<195)continue;
    const s=.9+hash(i+399)*1.5;
    plants.cylinder(.22*s,2.3*s,p.x,p.h,p.z,0x8d8873);
    const crown=new THREE.IcosahedronGeometry(1.7*s,0);crown.scale(1,1.2,1);
    plants.add(crown,p.x,p.h+3.3*s,p.z,y>210?(i%3?0xb2a3d5:0xdcbacb):(i%3?0x76c59a:0xb3d482));
  }
  for(let i=0;i<9;i++){
    const p=point(108+i*8,228+Math.sin(i)*8),g=new THREE.Group();g.position.set(p.x,p.h+5+hash(i+900)*8,p.z);g.name='suspended-old-form';g.userData.baseY=g.position.y;
    const rock=new THREE.Mesh(new THREE.IcosahedronGeometry(1.2+hash(i+905)*1.8,0),new THREE.MeshLambertMaterial({color:i%2?0xc0b3d9:0xa4c8ce}));rock.scale.set(1,1.65,.8);g.add(rock);
    const glow=new THREE.Mesh(new THREE.OctahedronGeometry(.25,0),new THREE.MeshBasicMaterial({color:0xd4fff4,transparent:true,opacity:.2}));glow.position.y=-2;g.add(glow);lights.push(glow);root.add(g);floating.push(g);
  }
  stone.finish(root,'peripheral-shell-fins');plants.finish(root,'surrounding-groves');
  const cups=petals.finish(root,'wetland-cupped-flora');if(cups){cups.material.side=THREE.DoubleSide;cups.userData.noOutline=true;}
  details.finish(root,'regional-small-forms');
  return {root,update(time:number,night:number,reduced:boolean){floating.forEach((p,i)=>{p.position.y=Number(p.userData.baseY)+(reduced?0:Math.sin(time*.3+i)*.32);});lights.forEach(l=>(l.material as THREE.MeshBasicMaterial).opacity=.2+night*.65);poolMeshes.forEach(p=>p.material.color.setRGB(1-night*.73,1-night*.57,1-night*.4));}};
}
