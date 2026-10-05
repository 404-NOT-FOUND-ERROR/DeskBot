import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Prebuilt authored geometry; formal project state alone decides what can be seen. */
class Parts {
  private pieces: THREE.BufferGeometry[] = [];
  constructor(private parent: THREE.Group) {}
  add(source: THREE.BufferGeometry, color: number, x: number, y: number, z: number) {
    const geometry = source.index ? source.toNonIndexed() : source.clone(); source.dispose();
    geometry.deleteAttribute('uv'); geometry.translate(x, y, z);
    const tint = new THREE.Color(color), colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); this.pieces.push(geometry);
  }
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: number) { this.add(new THREE.BoxGeometry(w,h,d),color,x,y,z); }
  cylinder(r: number, h: number, x: number, y: number, z: number, color: number) { this.add(new THREE.CylinderGeometry(r,r,h,12),color,x,y,z); }
  ball(r: number, x: number, y: number, z: number, color: number) { this.add(new THREE.IcosahedronGeometry(r,0),color,x,y,z); }
  finish(name: string) {
    const geometry = mergeGeometries(this.pieces,false)!; this.pieces.forEach(piece=>piece.dispose()); this.pieces=[];
    const mesh = new THREE.Mesh(geometry,new THREE.MeshLambertMaterial({vertexColors:true}));
    mesh.name=name; mesh.castShadow=true; mesh.receiveShadow=true; this.parent.add(mesh); return mesh;
  }
}
const C={wood:0xab8761,dark:0x586f65,brass:0xc8ab72,cream:0xe9dfc4,leaf:0x84b581,soil:0x77674b,teal:0x6b9f98};
const hiddenGroup=(parent:THREE.Group,name:string)=>{const group=new THREE.Group();group.name=name;group.visible=false;parent.add(group);return group;};

export function createFloatingSeedbedArtifact(parent: THREE.Group) {
  const bed=hiddenGroup(parent,'project-floating-seedbed');
  const frame=new Parts(bed);
  frame.box(3.25,.16,2.13,0,.31,0,C.wood);
  for(const x of [-1.47,1.47]) {frame.cylinder(.13,.55,x,.24,-.76,C.teal);frame.cylinder(.13,.55,x,.24,.76,C.teal);}
  for(const x of [-.78,.78]) {frame.box(1.32,.2,1.42,x,.47,0,C.cream);frame.box(1.13,.045,1.22,x,.58,0,C.soil);}
  frame.box(.35,.62,.06,1.34,.93,.82,C.dark);frame.box(.69,.29,.08,1.34,1.27,.82,C.cream);
  // A narrow access board reaches the existing bank deck instead of placing a worker in water.
  for(let i=0;i<7;i++)frame.box(.59,.12,1.05,1.75+i*.56,.24,1.5,C.wood);
  frame.finish('floating-seedbed-trays');
  const sprouts=hiddenGroup(bed,'floating-seedbed-sprouts'); const seedlings=new Parts(sprouts);
  seedlings.cylinder(.03,.25,0,.13,0,C.dark);seedlings.ball(.15,-.055,.26,0,C.leaf);seedlings.ball(.10,.08,.32,0,0xb5d9a0);
  const template=seedlings.finish('seedbed-plant-template');sprouts.remove(template);
  const plants=new THREE.InstancedMesh(template.geometry,template.material,12);plants.name='floating-seedbed-foliage';plants.frustumCulled=false;sprouts.add(plants);
  const seal=new THREE.Mesh(new THREE.OctahedronGeometry(.13,0),new THREE.MeshBasicMaterial({color:0xcde4b1}));seal.name='floating-seedbed-acceptance-seal';seal.position.set(1.34,1.27,.91);seal.visible=false;bed.add(seal);
  return {bed,sprouts,plants,seal};
}

export function createWaterPumpArtifact(parent: THREE.Group, name: string) {
  const pump=hiddenGroup(parent,name); const p=new Parts(pump);
  p.box(1.5,.13,.85,0,.11,0,C.wood);p.cylinder(.36,.52,0,.46,0,C.teal);
  p.cylinder(.39,.08,0,.76,0,C.brass);p.box(.16,.7,.16,-.57,.44,0,C.dark);
  p.box(.64,.13,.14,-.29,.85,0,C.brass);p.box(.13,.35,.13,.45,.58,0,C.brass);
  p.box(.13,.13,.44,.45,.39,.16,C.brass);p.box(.24,.045,.18,-.45,.99,0,C.cream);
  for(const x of [-.55,.55])p.box(.055,.06,.12,x,.19,.34,C.brass);
  p.finish('pump-body-and-intake');
  const rotor=new THREE.Group();rotor.name='water-pump-rotor';rotor.position.set(.04,.56,.34);pump.add(rotor);
  const gear=new Parts(rotor);const rim=new THREE.TorusGeometry(.25,.055,5,14); gear.add(rim,C.brass,0,0,0);
  gear.box(.37,.05,.065,0,0,0,C.cream);gear.box(.05,.37,.065,0,0,0,C.cream);gear.cylinder(.065,.13,0,0,0,C.brass);gear.finish('pump-crank-wheel');
  return {pump,rotor};
}

export function createRecipeArtifact(parent: THREE.Group) {
  const paper=hiddenGroup(parent,'project-leaf-recipe');paper.position.set(-3.8,2.55,2.7);
  const p=new Parts(paper);p.box(1.16,.77,.08,0,0,0,C.wood);p.box(.98,.60,.03,0,.01,.06,C.cream);
  for(let i=0;i<3;i++)p.box(.57-i*.1,.035,.014,-.05,.17-i*.14,.083,C.dark);
  p.ball(.07,.34,.16,.083,C.leaf);p.box(.18,.08,.04,0,.38,.09,C.brass);p.finish('recipe-paper-and-clip');
  const bowl=hiddenGroup(parent,'project-soup-tasting-bowl');bowl.position.set(.7,1.76,4.0);
  const dish=new Parts(bowl);dish.cylinder(.29,.18,0,.12,0,C.cream);dish.cylinder(.23,.035,0,.22,0,0xbccf91);
  for(const [x,z] of [[-.11,.03],[.09,-.08],[.03,.12]])dish.ball(.045,x!,.25,z!,C.leaf);
  dish.box(.52,.035,.04,.4,.23,.01,C.brass);dish.finish('last-actual-tasting-bowl');
  const nameplate=hiddenGroup(parent,'project-signature-dish-label');nameplate.position.set(2.6,1.94,4.0);
  const n=new Parts(nameplate);n.box(.75,.29,.045,0,0,0,C.dark);n.box(.61,.18,.03,0,.01,.04,C.cream);n.ball(.06,-.21,.03,.06,C.leaf);n.finish('signature-dish-nameplate');
  return {paper,bowl,nameplate};
}
