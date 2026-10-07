import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {createShapingFigure} from '../three/shapingFigures.ts';
import {disposeObject} from '../three/buildScene.ts';
import {shapingAppearanceKey,shapingAppearanceLabel,type ShapingAppearance} from '../three/shapingAppearance.ts';

/** The same authored builder as the town, in a separate presentation-only scene. */
export function RoleAppearancePreview({appearance,label='形象预览'}:{appearance:ShapingAppearance;label?:string}) {
  const host=useRef<HTMLDivElement>(null),[failed,setFailed]=useState(false);
  const key=shapingAppearanceKey(appearance);
  useEffect(()=>{
    if(!host.current)return;
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});}catch{setFailed(true);return;}
    setFailed(false);
    const element=host.current,scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-2.6,2.6,2.6,-2.6,.1,30);
    camera.position.set(4.6,3.0,7);camera.lookAt(0,1.8,0);
    scene.add(new THREE.HemisphereLight(0xfff5dc,0x547b70,2.2));
    const light=new THREE.DirectionalLight(0xfff9ee,2);light.position.set(3,6,5);scene.add(light);
    const figure=createShapingFigure('shaping-001',1,appearance);scene.add(figure.group);
    figure.updateLife?.(0,'idle',false,true);
    const plinth=new THREE.Mesh(new THREE.CylinderGeometry(1.05,1.2,.13,40),new THREE.MeshLambertMaterial({color:0xe5e8d8}));plinth.position.y=.31;scene.add(plinth);
    renderer.setPixelRatio(Math.min(2,window.devicePixelRatio||1));renderer.outputColorSpace=THREE.SRGBColorSpace;
    const canvas=renderer.domElement;canvas.setAttribute('aria-label',`${label}：${shapingAppearanceLabel(appearance)}`);canvas.setAttribute('role','img');element.appendChild(canvas);
    let angle=.1;
    const render=()=>{const width=Math.max(160,element.clientWidth);renderer.setSize(width,Math.round(width*.85),false);camera.left=-2.6;camera.right=2.6;camera.top=2.3;camera.bottom=-2.3;camera.updateProjectionMatrix();figure.group.rotation.y=angle;renderer.render(scene,camera);};
    const rotate=(event:PointerEvent)=>{if(event.buttons===1){angle+=event.movementX*.012;render();}};
    canvas.addEventListener('pointermove',rotate);render();
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(render):null;observer?.observe(element);
    return()=>{observer?.disconnect();canvas.removeEventListener('pointermove',rotate);disposeObject(figure.group);disposeObject(plinth);renderer.dispose();canvas.remove();};
  },[key,label]);
  return <div className="life-stage-figure"><div ref={host} className="life-stage-figure__canvas"/>{failed?<p className="life-empty">3D 预览暂不可用，形象说明仍可查看。</p>:null}<small>{shapingAppearanceLabel(appearance)} · 拖动可转动查看</small></div>;
}
