import * as THREE from 'three';

export const SHAPING_RENDER_BOUNDS={min_x:-8,min_y:0,max_x:302,max_y:280};
const clamp=(v:number)=>Math.max(-1,Math.min(1,v));
function town(x:number,y:number){
  const u=clamp((x-58)/60),v=clamp((y-62)/60);
  // A bounded, low-frequency bend gives the settlement winding lanes rather
  // than rotated square blocks. The same bijection moves paths, feet, labels
  // and facilities; saved positions and admitted travel times stay canonical.
  const envelope=Math.exp(-((x-60)**2+(y-69)**2)/6200);
  const bendX=7.2*Math.sin((y-38)*.071)*envelope;
  const bendY=6.3*Math.sin((x-28)*.067)*envelope;
  return {x:135+(x-58)*Math.sqrt(1-.30*v*v)+6*Math.sin((y-62)*.035)+bendX,
    y:140+(y-62)*Math.sqrt(1-.24*u*u)+4*Math.sin((x-58)*.035)+bendY};
}
/** Canonical coordinates remain stable persistence keys. This continuous,
 * non-square presentation puts the town in the centre and bends the existing
 * forest into the eastern landscape ring. Geometry and travel use one mapping. */
export function projectShapingPoint(x:number,y:number){
  if(x<=112)return town(x,y);
  const cy=Math.max(0,Math.min(120,y)),inner=town(112,y),angle=(cy-60)/60*1.03,t=(x-112)/108;
  const outer={x:135+139*Math.cos(angle),y:140+123*Math.sin(angle)+(y-cy)*1.2};
  return {x:inner.x+(outer.x-inner.x)*t,y:inner.y+(outer.y-inner.y)*t};
}
export function unprojectShapingPoint(x:number,y:number){
  let a=x-135+58,b=y-140+62;
  if(x>190){a=112+(x-190)*1.4;b=60+(y-140)*.7;}
  for(let i=0;i<16;i++){
    const p=projectShapingPoint(a,b),px=projectShapingPoint(a+.01,b),py=projectShapingPoint(a,b+.01);
    const j00=(px.x-p.x)*100,j10=(px.y-p.y)*100,j01=(py.x-p.x)*100,j11=(py.y-p.y)*100,det=j00*j11-j10*j01;
    if(Math.abs(det)<.0001)break;
    const dx=x-p.x,dy=y-p.y;a+=(dx*j11-dy*j01)/det;b+=(dy*j00-dx*j10)/det;
    if(Math.abs(dx)+Math.abs(dy)<.00001)break;
  }
  return {x:a,y:b};
}
export function shapingWorldPoint(x:number,y:number){const p=projectShapingPoint(x,y);return {x:p.x-60,z:p.y-60};}
function projectVector(v:THREE.Vector3){const p=shapingWorldPoint(v.x+60,v.z+60);return v.set(p.x,v.y,p.z);}

/** Rebuild scenery coordinates once, retaining group identities and live state
 * handles. Instance animation is projected after each source-matrix update.
 * Cloning shared geometries prevents one facility from deforming another. */
export function projectShapingScenery(root:THREE.Group){
  root.updateWorldMatrix(true,true);
  const nodes:THREE.Object3D[]=[],before=new Map<THREE.Object3D,THREE.Matrix4>();
  root.traverse(o=>{nodes.push(o);before.set(o,o.matrixWorld.clone());});
  const oldGeometry=new Set<THREE.BufferGeometry>();
  const instances:{mesh:THREE.InstancedMesh;matrix:THREE.Matrix4;last:number}[]=[];
  const v=new THREE.Vector3();
  for(const node of nodes){
    if(node===root)continue;
    v.setFromMatrixPosition(before.get(node)!);projectVector(v);
    if(node.parent){node.parent.updateWorldMatrix(true,false);v.applyMatrix4(node.parent.matrixWorld.clone().invert());}
    node.position.copy(v);node.updateWorldMatrix(true,false);
    // Work and inspection points are semantic geometry too. Leaving them in
    // the old local space would put workers beside the newly bent workbench.
    const remap=(point:readonly number[],owner:THREE.Object3D)=>{
      const p=new THREE.Vector3(point[0],point[1],point[2]).applyMatrix4(before.get(owner)!);
      projectVector(p).applyMatrix4(owner.matrixWorld.clone().invert());return p.toArray();
    };
    for(const key of ['work_anchor','inspection_anchor','arrival_anchor']){
      if(Array.isArray(node.userData[key]))node.userData[key]=remap(node.userData[key],node);
    }
    if(node.userData.workstations&&node.parent){
      node.userData.workstations=Object.fromEntries(Object.entries(node.userData.workstations).map(([id,entry])=>{
        const point=entry as {standing:number[];facing:number[];standing_by_slot?:number[][]};
        return [id,{...point,standing:remap(point.standing,node.parent!),facing:remap(point.facing,node.parent!),
          ...(point.standing_by_slot?{standing_by_slot:point.standing_by_slot.map(p=>remap(p,node.parent!))}:{})}];
      }));
    }
    if(node instanceof THREE.InstancedMesh){instances.push({mesh:node,matrix:before.get(node)!,last:-1});continue;}
    if(!(node instanceof THREE.Mesh)||!node.geometry.getAttribute('position'))continue;
    const original=node.geometry,g=original.clone(),position=g.getAttribute('position'),inverse=node.matrixWorld.clone().invert();
    for(let i=0;i<position.count;i++){
      v.fromBufferAttribute(position,i).applyMatrix4(before.get(node)!);projectVector(v).applyMatrix4(inverse);position.setXYZ(i,v.x,v.y,v.z);
    }
    g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();node.geometry=g;oldGeometry.add(original);
  }
  oldGeometry.forEach(g=>g.dispose());
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
  function update(){
    for(const entry of instances){
      // Dormant task effects may mark their buffer dirty without writing a new
      // pose. Transforming that stale pose repeatedly would accumulate drift.
      if(!entry.mesh.visible)continue;
      if(entry.last===entry.mesh.instanceMatrix.version)continue;
      entry.mesh.updateWorldMatrix(true,false);const inverse=entry.mesh.matrixWorld.clone().invert();
      for(let i=0;i<entry.mesh.count;i++){
        entry.mesh.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
        position.applyMatrix4(entry.matrix);projectVector(position).applyMatrix4(inverse);
        matrix.compose(position,rotation,scale);entry.mesh.setMatrixAt(i,matrix);
      }
      entry.mesh.instanceMatrix.needsUpdate=true;entry.last=entry.mesh.instanceMatrix.version;entry.mesh.computeBoundingSphere();
    }
  }
  update();return {update};
}
