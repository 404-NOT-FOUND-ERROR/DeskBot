import * as THREE from 'three';

/** A thick, open, faceted husk. The void is real geometry; the inner teal
 * material and rim are separate surfaces rather than a black painted doorway. */
export function shellVaultGeometry(width:number,height:number,depth:number,thickness=.32) {
  const outer:number[]=[],inner:number[]=[],rim:number[]=[];
  const angles=14,lengths=6;
  function point(u:number,v:number,inset:number):number[] {
    const theta=u*Math.PI;
    const taper=.78+.22*v;
    const r=(width/2-inset)*taper;
    return [Math.cos(theta)*r+Math.sin(v*Math.PI)*width*.065,
      Math.sin(theta)*(height-inset)*taper+.04,
      (v-.5)*depth+Math.sin(theta)*depth*.10*(1-v)];
  }
  function quad(out:number[],a:number[],b:number[],c:number[],d:number[],reverse=false) {
    if(reverse)out.push(...a,...c,...b,...b,...c,...d);
    else out.push(...a,...b,...c,...b,...d,...c);
  }
  for(let j=0;j<lengths;j++)for(let i=0;i<angles;i++) {
    const u=i/angles,v=j/lengths,un=(i+1)/angles,vn=(j+1)/lengths;
    // Front-face outward normals, checked with a solid-angle cross product.
    quad(outer,point(u,v,0),point(un,v,0),point(u,vn,0),point(un,vn,0));
    quad(inner,point(u,v,thickness),point(un,v,thickness),point(u,vn,thickness),point(un,vn,thickness),true);
  }
  for(let i=0;i<angles;i++)for(const v of [0,1]) {
    quad(rim,point(i/angles,v,0),point(i/angles,v,thickness),point((i+1)/angles,v,0),point((i+1)/angles,v,thickness),v===0);
  }
  const make=(positions:number[])=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;};
  return {outer:make(outer),inner:make(inner),rim:make(rim)};
}

/** Broken spiral plates, the old shapes that have become the district's
 * geology. Open centre and discontinuities remain visible from both banks. */
export function shellSpiralGeometry(radius:number,thickness:number,depth:number,turn=1.28) {
  const positions:number[]=[];
  const segments=29, layers=6;
  function p(t:number,inside:boolean,v:number) {
    const a=.16+t*Math.PI*(1.68+(turn-1.15)*.35);
    const swell=Math.sin(v*Math.PI),broken=.045*Math.sin(t*71)+.035*Math.cos(t*29);
    const r=radius*(1-.22*t+broken+swell*.10)-(inside?Math.max(thickness,radius*.28)*(1-.2*t):0);
    return [Math.cos(a)*r,Math.sin(a)*r+radius*.74,(v-.5)*depth*(1-.25*t)+Math.sin(a*2)*depth*.06];
  }
  function q(a:number[],b:number[],c:number[],d:number[]) {positions.push(...a,...b,...c,...b,...d,...c);}
  for(let i=0;i<segments;i++) {
    const a=i/segments,b=(i+1)/segments;
    for(let j=0;j<layers;j++){
      const v=j/layers,n=(j+1)/layers;
      q(p(a,false,v),p(b,false,v),p(a,false,n),p(b,false,n));
      q(p(a,true,v),p(a,true,n),p(b,true,v),p(b,true,n));
      if(i===0)q(p(a,false,v),p(a,false,n),p(a,true,v),p(a,true,n));
      if(i===segments-1)q(p(b,false,v),p(b,true,v),p(b,false,n),p(b,true,n));
    }
    q(p(a,false,0),p(a,true,0),p(b,false,0),p(b,true,0));
    q(p(a,false,1),p(b,false,1),p(a,true,1),p(b,true,1));
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();return g;
}
