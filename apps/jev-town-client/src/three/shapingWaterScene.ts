import * as THREE from 'three';
import {mapToWorld} from '@shared/world.ts';
import {LowPolyBatch} from './lowPolyBatch.ts';
import {SHAPING_CROSSINGS,shapingChannelAt,shapingCrossingSamples} from './shapingWaterway.ts';
import {windleafHeightAt} from './windleafLayout.ts';
import {shapingCoastDistance} from './shapingLandform.ts';

export function createShapingWaterScene(){
  const root=new THREE.Group();root.name='old-shell-waterway';root.userData.decorativeOnly=true;
  const water:number[]=[],colors:number[]=[],foam:number[]=[],falls:number[]=[];
  const put=(target:number[],x:number,y:number,h:number)=>{const w=mapToWorld(x,y);target.push(w.x,h,w.z);};
  for(let y=-7;y<137;y+=.75){
    const a=shapingChannelAt(116,y),b=shapingChannelAt(116,y+.75);
    if(shapingCoastDistance(a.center,y)<1)continue;
    const ca=new THREE.Color(0x53d9d4),cb=new THREE.Color(0x96f1d4);
    const points=[[a.center-a.width,y,a.level],[b.center-b.width,y+.75,b.level],[a.center+a.width,y,a.level],
      [a.center+a.width,y,a.level],[b.center-b.width,y+.75,b.level],[b.center+b.width,y+.75,b.level]];
    for(const [x,z,h] of points){put(water,x!,z!,h!);const c=ca.clone().lerp(cb,(Math.sin(y*.13)+1)*.2);colors.push(c.r,c.g,c.b);}
    if(Math.floor(y*4)%17===0){
      put(foam,a.center-.8,y,a.level+.045);put(foam,a.center+.9,y+.16,a.level+.045);put(foam,a.center+.2,y+.3,a.level+.045);
    }
  }
  for(const y of [38,82]){
    const a=shapingChannelAt(116,y-.01),b=shapingChannelAt(116,y+.01);
    for(const [x,z,h] of [[a.center-a.width,y-.2,a.level],[b.center-b.width,y+.3,b.level],[a.center+a.width,y-.2,a.level],
      [a.center+a.width,y-.2,a.level],[b.center-b.width,y+.3,b.level],[b.center+b.width,y+.3,b.level]])put(falls,x!,z!,h!);
  }
  const mesh=(name:string,positions:number[],color:number,vertexColors?:number[])=>{
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
    if(vertexColors)g.setAttribute('color',new THREE.Float32BufferAttribute(vertexColors,3));
    const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color,vertexColors:!!vertexColors,side:THREE.DoubleSide}));m.name=name;root.add(m);return m;
  };
  const channel=mesh('shaping-channel-water',water,0xffffff,colors);
  const ripple=mesh('shaping-channel-ripples',foam,0xdbfff0);
  const cascade=mesh('shaping-channel-cascades',falls,0xc8ffee);
  const bridgeBatch=new LowPolyBatch(),banks=new LowPolyBatch();
  for(const bridge of SHAPING_CROSSINGS){
    const group=new THREE.Group();group.name=`bridge:${bridge.passageId}`;group.userData.passage_id=bridge.passageId;root.add(group);
    const samples=shapingCrossingSamples(bridge.points);
    for(let i=0;i<samples.length;i++){
      const p=samples[i]!,a=samples[Math.max(0,i-1)]!,b=samples[Math.min(samples.length-1,i+1)]!;
      const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,w=mapToWorld(p.x,p.y),height=windleafHeightAt(p.x,p.y),rotation=-Math.atan2(dy,dx);
      bridgeBatch.box(.56,.22,4.15,w.x,height-.17,w.z,i%3===0?0xf1d6a0:0xc9af80,rotation);
      if(i%6!==0)continue;
      for(const side of [-1,1]){
        const x=p.x-dy/length*side*1.95,y=p.y+dx/length*side*1.95,post=mapToWorld(x,y);
        bridgeBatch.cylinder(.12,1.75,post.x,height,post.z,0x807764);
        bridgeBatch.rock(.22,post.x,height+1.9,post.z,0xe6e9b1);
        const support=Math.max(.3,height-shapingChannelAt(x,y).level+.4);
        bridgeBatch.cylinder(.20,support,post.x,height-support,post.z,0x8c8f80);
        if(i+6<samples.length){
          const next=samples[i+6]!,nw=mapToWorld(next.x-dy/length*side*1.95,next.y+dx/length*side*1.95);
          const from=new THREE.Vector3(post.x,height+1.3,post.z),to=new THREE.Vector3(nw.x,windleafHeightAt(next.x,next.y)+1.3,nw.z),delta=to.clone().sub(from);
          const rail=new THREE.CylinderGeometry(.07,.07,delta.length(),5);rail.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()));
          const mid=from.add(to).multiplyScalar(.5);bridgeBatch.add(rail,mid.x,mid.y,mid.z,0xb5a17e);
        }
      }
    }
  }
  bridgeBatch.finish(root,'admitted-passage-bridges');
  // Low reeds and eroded plates trace the bank; no harvestable objects added.
  for(let i=0;i<180;i++){
    const y=1+i*.72,river=shapingChannelAt(116,y),side=i%2?1:-1,x=river.center+side*(river.width+1.4+(i%3)*.4);
    if(shapingCoastDistance(x,y)<5)continue;
    const w=mapToWorld(x,y),h=windleafHeightAt(x,y);
    if(i%7===0){const g=new THREE.IcosahedronGeometry(.7,0);g.scale(.8,1.5,.8);banks.add(g,w.x,h+.3,w.z,0xb3bacb);}
    else {banks.cylinder(.055,.8+(i%5)*.17,w.x,h,w.z,0x84ad6b);banks.rock(.13,w.x,h+1.1,w.z,0xd8cc83);}
  }
  banks.finish(root,'waterway-reeds-and-plates');
  return {root,update(time:number,night:number,reduced:boolean){
    channel.material.color.setRGB(1-night*.73,1-night*.57,1-night*.4);
    ripple.material.opacity=1-night*.7;ripple.material.transparent=true;
    cascade.material.opacity=1-night*.7;cascade.material.transparent=true;
    ripple.material.color.setHex(0xdbfff0).multiplyScalar(reduced?1:.94+.06*Math.sin(time*.8));
    cascade.material.color.setHex(0xc8ffee).multiplyScalar(reduced?1:.94+.06*Math.sin(time*1.7));
  }};
}
