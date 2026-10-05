import * as THREE from "three";
import type { DeskBotEnvironment } from "../deskbot/types.ts";
import { sceneEnvironmentAt } from "./sceneEnvironment.ts";
import { disposeObject } from "./buildScene.ts";
import type { CompanionScenery } from "./companionScenery.ts";
import type { SceneLifeActivity } from '../deskbot/activityProjection.ts';
import { createSoftLightTexture } from './sceneLifeEffects.ts';

export function createEnvironmentEffects(scene:THREE.Scene, sky:THREE.HemisphereLight, sun:THREE.DirectionalLight, fill:THREE.DirectionalLight, scenery?:CompanionScenery, updateVegetation?:(time:number,wind:number,reducedMotion:boolean)=>void) {
  const root=new THREE.Group();root.name="morrowmere-weather";scene.add(root);
  const positions=new Float32Array(700*6);
  const rainGeometry=new THREE.BufferGeometry();rainGeometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  const rain=new THREE.LineSegments(rainGeometry,new THREE.LineBasicMaterial({color:0xd2ebf6,transparent:true,opacity:.65,depthWrite:false}));
  rain.name="rain-fall";rain.frustumCulled=false;root.add(rain);
  const snowGeometry=new THREE.BufferGeometry();snowGeometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(700*3),3));
  const snow=new THREE.Points(snowGeometry,new THREE.PointsMaterial({color:0xf4fbff,size:.22,transparent:true,opacity:.85,depthWrite:false}));snow.frustumCulled=false;root.add(snow);
  const wet=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshBasicMaterial({color:0x426b83,transparent:true,opacity:0,depthWrite:false}));
  wet.rotation.x=-Math.PI/2;wet.position.y=.025;root.add(wet);
  const clouds:THREE.Group[]=[];
  const cloudMaterial=new THREE.MeshLambertMaterial({color:0xd6dee0,transparent:true,opacity:0,depthWrite:false});
  for(let i=0;i<7;i++) {
    const cloud=new THREE.Group();cloud.position.set(i*21-60,22+(i%3)*4,(i*37)%120-60);
    for(let j=0;j<4;j++){const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(1,1),cloudMaterial);mesh.scale.set(3.6,1.1,2.5);mesh.position.set((j-1.5)*3,Math.sin(j)*.5,0);cloud.add(mesh);}
    root.add(cloud);clouds.push(cloud);
  }
  const starsGeometry=new THREE.BufferGeometry(),starPositions=new Float32Array(90*3);
  for(let i=0;i<90;i++){const a=i*2.39996,r=25+Math.sqrt(i/90)*70;starPositions.set([Math.cos(a)*r,32+(i%11)*1.1,Math.sin(a)*r],i*3);}
  starsGeometry.setAttribute('position',new THREE.BufferAttribute(starPositions,3));
  const stars=new THREE.Points(starsGeometry,new THREE.PointsMaterial({color:0xd3ede0,map:createSoftLightTexture(),size:.38,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending}));
  stars.name='shaping-night-particles';root.add(stars);
  const dayColor=new THREE.Color(0xe1e9d7),nightColor=new THREE.Color(0x182d46),stormColor=new THREE.Color(0x80949e),twilightColor=new THREE.Color(0xc7988a);
  const warm=new THREE.Color(0xfff0d8),cool=new THREE.Color(0x96b5eb),sunset=new THREE.Color(0xffb278),background=new THREE.Color();
  const hash=(i:number)=>{const n=Math.sin(i*127.1+31.3)*43758.5;return n-Math.floor(n);};
  return { update(environment:DeskBotEnvironment|undefined,seconds:number,reducedMotion:boolean,now=Date.now(),activities:readonly SceneLifeActivity[]=[]) {
    if(!environment){root.visible=false;return;}
    root.visible=true;
    const view=sceneEnvironmentAt(environment,now);
    background.copy(nightColor).lerp(dayColor,view.daylight).lerp(twilightColor,view.twilight*.3).lerp(stormColor,view.cloud*.35*view.daylight);
    scene.background=background;
    if(scene.fog instanceof THREE.Fog){scene.fog.color.copy(background);scene.fog.near=170;scene.fog.far=410-view.cloud*70;}
    else scene.fog=new THREE.Fog(background,170,410-view.cloud*70);
    sky.intensity=.46+view.daylight*.7;sky.color.copy(cool).lerp(warm,view.daylight);
    sky.groundColor.set(view.night>.5 ? 0x425e6d : 0x8fb07a);
    sun.intensity=(.3+view.daylight*2)*(1-view.cloud*.65);sun.color.copy(cool).lerp(warm,view.daylight).lerp(sunset,view.twilight*.75);
    fill.intensity=.27+view.daylight*.08;
    const angle=(view.minute-360)/720*Math.PI;
    // Keep an elevated illustration light and its camera outside the town.
    // Near-horizontal terrain shadows create long projection artifacts in this view.
    sun.position.set(-Math.cos(angle)*70,Math.max(70,Math.sin(angle)*90),55).multiplyScalar(3);
    wet.material.opacity=view.intensity*.16;
    // Clear skies must not become large translucent polygon panels over the town.
    cloudMaterial.opacity=Math.max(0,view.cloud-.28)/.72*.38;
    cloudMaterial.color.set(view.night>.5?0x738693:0xd6dee0);
    (stars.material as THREE.PointsMaterial).opacity=view.night*(1-view.cloud)*.55;
    const t=reducedMotion ? 0 : seconds;
    clouds.forEach((cloud,i)=>{cloud.visible=view.cloud>.28;cloud.position.x=((i*21+t*(.07+view.wind*.18)+60)%160)-80;});
    rain.visible=view.precipitation==="rain";snow.visible=view.precipitation==="snow";
    const count=Math.round(700*view.intensity);rainGeometry.setDrawRange(0,count*2);snowGeometry.setDrawRange(0,count);
    if(rain.visible||snow.visible) {
      const snowPositions=snowGeometry.getAttribute("position").array as Float32Array;
      for(let i=0;i<count;i++) {
        const x=((hash(i+1)*140+t*view.wind*.65)%140)-70;
        const z=hash(i+701)*140-70;
        const y=38-((hash(i+1401)*38+t*(rain.visible ? 20 : 2))%38);
        positions.set([x,y,z,x-view.wind*.018,y+1.25,z],i*6);snowPositions.set([x+Math.sin(t+i)*.4,y,z],i*3);
      }
      rainGeometry.getAttribute("position").needsUpdate=true;snowGeometry.getAttribute("position").needsUpdate=true;
    }
    scenery?.update(t,view.night,view.wind,view.intensity,reducedMotion,{minute:view.minute,daylight:view.daylight,activities});
    updateVegetation?.(t,view.wind,reducedMotion);
  }, dispose(){scene.remove(root);disposeObject(root);} };
}
